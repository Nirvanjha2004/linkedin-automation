import { randomUUID } from 'crypto';
import { getSubscription, isEffectivelyPaid } from '@/lib/billing/entitlement';
import { googleCalendarClient } from '@/lib/google/calendar-client';
import { buildPrompt } from '@/lib/ai/prompt-builder';
import { parseSlotSelection } from '@/lib/ai/slot-parser';
import { createLinkedInClient } from '@/lib/linkedin/client';
import type {
  AIBookingStage,
  MessageHistoryItem,
  LeadContext,
  TimeSlot,
} from '@/types';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface AIHandlerInput {
  jobId: string;
  conversationId: string;
  userId: string;
  triggerMessageId: string;
}

export interface AIHandlerResult {
  status: 'sent' | 'skipped' | 'error';
  generatedReply?: string;
  errorMessage?: string;
}

// ── Supabase client type (admin client shape) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdminClient = any;

// ── Interest signal detection ─────────────────────────────────────────────────

const INTEREST_PHRASES = [
  'let me check',
  'available',
  'schedule',
  'book',
  'meeting',
  'calendar',
  'time',
];

function hasInterestSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return INTEREST_PHRASES.some((phrase) => lower.includes(phrase));
}

// ── Log writer ────────────────────────────────────────────────────────────────

async function writeLog(
  supabase: SupabaseAdminClient,
  params: {
    conversationId: string;
    userId: string;
    triggerMessageId?: string;
    generatedReply?: string;
    status: 'sent' | 'skipped' | 'error';
    errorMessage?: string;
    bookingStage?: string;
  }
): Promise<void> {
  await supabase.from('ai_automation_logs').insert({
    id: randomUUID(),
    conversation_id: params.conversationId,
    user_id: params.userId,
    trigger_message_id: params.triggerMessageId ?? null,
    generated_reply: params.generatedReply ?? null,
    status: params.status,
    error_message: params.errorMessage ?? null,
    booking_stage: params.bookingStage ?? null,
  });
}

// ── LLM call ──────────────────────────────────────────────────────────────────

type LLMCallResult =
  | { type: 'success'; reply: string }
  | { type: 'timeout' | 'non_retryable' | 'retryable'; message: string };

async function callLLM(prompt: string): Promise<LLMCallResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { type: 'non_retryable', message: 'GROQ_API_KEY is not set' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429 || response.status >= 500) {
      const text = await response.text().catch(() => '');
      return { type: 'retryable', message: `HTTP ${response.status}: ${text}` };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { type: 'non_retryable', message: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';

    if (!reply) {
      return { type: 'non_retryable', message: 'Empty response from LLM' };
    }

    return { type: 'success', reply };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const error = err as Error;
    if (error.name === 'AbortError') {
      return { type: 'timeout', message: 'LLM request timed out after 30 seconds' };
    }
    return { type: 'retryable', message: error.message };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function processAIReplyJob(
  supabase: SupabaseAdminClient,
  input: AIHandlerInput
): Promise<AIHandlerResult> {
  const { jobId, conversationId, userId, triggerMessageId } = input;

  console.log(`[AI Agent] 🤖 Processing job ${jobId} | conversation=${conversationId}`);

  // ── 6.1: Fetch conversation + guards ────────────────────────────────────────

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, ai_status, ai_booking_stage, external_conversation_id, linkedin_account_id, lead_id')
    .eq('id', conversationId)
    .single();

  if (convError || !conversation) {
    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      status: 'error',
      errorMessage: 'Conversation not found',
    });
    return { status: 'error', errorMessage: 'Conversation not found' };
  }

  if (conversation.ai_status !== 'active') {
    console.log(`[AI Agent] ⏭️  Skipping job ${jobId} — ai_status is '${conversation.ai_status}'`);
    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      status: 'skipped',
      bookingStage: conversation.ai_booking_stage,
    });
    return { status: 'skipped' };
  }

  // ── Billing entitlement check ────────────────────────────────────────────────

  const subscription = await getSubscription(userId);
  if (!isEffectivelyPaid(subscription)) {
    console.log(`[AI Agent] ⏭️  Skipping job ${jobId} — user not on paid plan`);
    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      status: 'skipped',
      errorMessage: 'User is not on a paid plan',
      bookingStage: conversation.ai_booking_stage,
    });
    return { status: 'skipped' };
  }

  // ── Fetch message history ────────────────────────────────────────────────────

  const { data: messagesRaw } = await supabase
    .from('messages')
    .select('id, content_text, direction, sent_at, metadata')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });

  const messageHistory: MessageHistoryItem[] = (messagesRaw ?? []).map(
    (m: { id: string; content_text: string; direction: string; sent_at: string; metadata?: Record<string, unknown> }) => ({
      id: m.id,
      content: m.content_text,
      direction: m.direction as 'inbound' | 'outbound',
      sent_at: m.sent_at,
      metadata: m.metadata,
    })
  );

  // ── Fetch lead profile ───────────────────────────────────────────────────────

  const { data: leadRaw } = await supabase
    .from('leads')
    .select('id, full_name, first_name, company, title, headline, location, public_profile_url')
    .eq('id', conversation.lead_id)
    .single();

  const lead: LeadContext = {
    id: leadRaw?.id ?? conversation.lead_id,
    full_name: leadRaw?.full_name ?? '',
    first_name: leadRaw?.first_name ?? undefined,
    company: leadRaw?.company ?? undefined,
    title: leadRaw?.title ?? undefined,
    headline: leadRaw?.headline ?? undefined,
    location: leadRaw?.location ?? undefined,
    linkedin_url: leadRaw?.public_profile_url ?? undefined,
  };

  // ── Fetch AI automation config ───────────────────────────────────────────────

  const { data: config } = await supabase
    .from('ai_automation_config')
    .select('persona, meeting_objective, meeting_duration_min, timezone, gcal_refresh_token, gcal_token_error')
    .eq('user_id', userId)
    .single();

  const persona: string = config?.persona ?? '';
  const meetingObjective: string = config?.meeting_objective ?? '';
  const meetingDurationMin: number = config?.meeting_duration_min ?? 30;
  const timezone: string = config?.timezone ?? 'UTC';
  const gcalRefreshToken: string | null = config?.gcal_refresh_token ?? null;

  // ── 6.2: Outbound message count guard ───────────────────────────────────────

  const outboundMessages = messageHistory.filter(
    (m) => m.direction === 'outbound' && (m.metadata as Record<string, unknown> | undefined)?.['source'] === 'ai_agent'
  );
  const outboundCount = outboundMessages.length;

  const hasInterest = messageHistory
    .filter((m) => m.direction === 'inbound')
    .some((m) => hasInterestSignal(m.content));

  const currentStage = conversation.ai_booking_stage as AIBookingStage;

  if (outboundCount >= 5 && !hasInterest && currentStage === 'qualifying') {
    console.log(`[AI Agent] 🛑 Closing conversation ${conversationId} — ${outboundCount} outbound msgs, no interest signal`);
    const closingMessage =
      'Thank you for your time! Feel free to reach out if you\'d like to connect in the future.';

    // Send closing message
    const sendResult = await sendLinkedInMessage(supabase, conversation, closingMessage);

    if (sendResult.success && sendResult.externalMessageId) {
      await persistMessage(supabase, {
        conversationId,
        userId,
        externalMessageId: sendResult.externalMessageId,
        contentText: closingMessage,
        sentAt: new Date().toISOString(),
      });
    }

    // Set ai_status = 'completed'
    await supabase
      .from('conversations')
      .update({ ai_status: 'completed' })
      .eq('id', conversationId);

    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      generatedReply: closingMessage,
      status: 'sent',
      bookingStage: currentStage,
    });

    return { status: 'sent', generatedReply: closingMessage };
  }

  // ── 6.4: Booking stage routing and LLM call ──────────────────────────────────

  let proposedSlots: TimeSlot[] = [];
  let nextStage: AIBookingStage = currentStage;

  // ── 6.6: Google Calendar — slot_proposal stage ───────────────────────────────

  if (currentStage === 'slot_proposal') {
    if (gcalRefreshToken) {
      console.log(`[AI Agent] 📅 Fetching available calendar slots for conversation ${conversationId}`);
      try {
        const allSlots = await googleCalendarClient.getAvailableSlots({
          refreshToken: gcalRefreshToken,
          durationMinutes: meetingDurationMin,
          timezone,
        });
        proposedSlots = allSlots.slice(0, 3);
        console.log(`[AI Agent] 📅 Got ${allSlots.length} slots, proposing ${proposedSlots.length} to lead`);
      } catch (err: unknown) {
        const error = err as Error;
        if (error.message.includes('Token refresh failed')) {
          await supabase
            .from('conversations')
            .update({ ai_status: 'error' })
            .eq('id', conversationId);

          await supabase
            .from('ai_automation_config')
            .update({ gcal_token_error: true })
            .eq('user_id', userId);

          await writeLog(supabase, {
            conversationId,
            userId,
            triggerMessageId,
            status: 'error',
            errorMessage: error.message,
            bookingStage: currentStage,
          });

          return { status: 'error', errorMessage: error.message };
        }
        // Non-token error — continue without slots
      }
    }
  }

  // ── 6.6: Google Calendar — slot_confirmation stage ───────────────────────────

  if (currentStage === 'slot_confirmation') {
    const latestInbound = [...messageHistory]
      .reverse()
      .find((m) => m.direction === 'inbound');

    if (latestInbound) {
      // Retrieve previously proposed slots from the last outbound AI message metadata
      const lastAIMessage = [...messageHistory]
        .reverse()
        .find(
          (m) =>
            m.direction === 'outbound' &&
            (m.metadata as Record<string, unknown> | undefined)?.['source'] === 'ai_agent'
        );

      const storedSlots: TimeSlot[] =
        ((lastAIMessage?.metadata as Record<string, unknown> | undefined)?.['proposed_slots'] as TimeSlot[] | undefined) ?? [];

      const parseResult = parseSlotSelection(latestInbound.content, storedSlots);

      if (parseResult.type === 'ambiguous') {
        // Ask for clarification
        const clarificationMessage =
          'I want to make sure I book the right time for you — could you clarify which slot you\'d prefer? Please mention the day or time you have in mind.';

        const sendResult = await sendLinkedInMessage(supabase, conversation, clarificationMessage);

        if (sendResult.success && sendResult.externalMessageId) {
          await persistMessage(supabase, {
            conversationId,
            userId,
            externalMessageId: sendResult.externalMessageId,
            contentText: clarificationMessage,
            sentAt: new Date().toISOString(),
            metadata: { source: 'ai_agent', proposed_slots: storedSlots },
          });
        }

        await writeLog(supabase, {
          conversationId,
          userId,
          triggerMessageId,
          generatedReply: clarificationMessage,
          status: 'sent',
          bookingStage: currentStage,
        });

        return { status: 'sent', generatedReply: clarificationMessage };
      }

      if (parseResult.type === 'selected' && gcalRefreshToken) {
        const selectedSlot = parseResult.slot;

        try {
          const eventResult = await googleCalendarClient.createEvent({
            refreshToken: gcalRefreshToken,
            title: `Meeting with ${lead.full_name}`,
            description: `Meeting with ${lead.full_name}${lead.linkedin_url ? `\nLinkedIn: ${lead.linkedin_url}` : ''}`,
            slot: selectedSlot,
            organizerEmail: userId, // userId is used as a proxy; real email would come from user profile
          });

          // Successful event creation
          const confirmationMessage = `Great news! I've booked our meeting for ${selectedSlot.label}. You should receive a calendar invite shortly. Looking forward to connecting!`;

          const sendResult = await sendLinkedInMessage(supabase, conversation, confirmationMessage);

          if (sendResult.success && sendResult.externalMessageId) {
            await persistMessage(supabase, {
              conversationId,
              userId,
              externalMessageId: sendResult.externalMessageId,
              contentText: confirmationMessage,
              sentAt: new Date().toISOString(),
              metadata: { source: 'ai_agent', event_id: eventResult.eventId },
            });
          }

          // Set ai_status = 'completed', update lead status
          await supabase
            .from('conversations')
            .update({ ai_status: 'completed', ai_booking_stage: 'done' })
            .eq('id', conversationId);

          await supabase
            .from('leads')
            .update({ status: 'completed' })
            .eq('id', conversation.lead_id);

          await writeLog(supabase, {
            conversationId,
            userId,
            triggerMessageId,
            generatedReply: confirmationMessage,
            status: 'sent',
            bookingStage: 'done',
          });

          return { status: 'sent', generatedReply: confirmationMessage };
        } catch (err: unknown) {
          const error = err as Error;

          if (error.message.includes('Token refresh failed')) {
            await supabase
              .from('conversations')
              .update({ ai_status: 'error' })
              .eq('id', conversationId);

            await supabase
              .from('ai_automation_config')
              .update({ gcal_token_error: true })
              .eq('user_id', userId);

            await writeLog(supabase, {
              conversationId,
              userId,
              triggerMessageId,
              status: 'error',
              errorMessage: error.message,
              bookingStage: currentStage,
            });

            return { status: 'error', errorMessage: error.message };
          }

          // Event creation failed — re-propose same slots
          await supabase
            .from('conversations')
            .update({ ai_booking_stage: 'slot_proposal' })
            .eq('id', conversationId);

          nextStage = 'slot_proposal';
          proposedSlots = storedSlots;
        }
      }
    }
  }

  // ── Build prompt and call LLM ────────────────────────────────────────────────

  const prompt = buildPrompt({
    persona,
    meetingObjective,
    lead,
    messageHistory,
    bookingStage: nextStage === 'slot_proposal' ? 'slot_proposal' : currentStage,
    proposedSlots: proposedSlots.length > 0 ? proposedSlots : undefined,
  });

  const llmResult = await callLLM(prompt);

  console.log(`[AI Agent] 🧠 LLM result for job ${jobId}: ${llmResult.type}`);

  if (llmResult.type === 'timeout' || llmResult.type === 'non_retryable') {
    console.log(`[AI Agent] ❌ LLM error (${llmResult.type}) for job ${jobId}: ${llmResult.message}`);
    await supabase
      .from('conversations')
      .update({ ai_status: 'error' })
      .eq('id', conversationId);

    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      status: 'error',
      errorMessage: llmResult.message,
      bookingStage: currentStage,
    });

    return { status: 'error', errorMessage: llmResult.message };
  }

  if (llmResult.type === 'retryable') {
    // Fetch current retry count
    const { data: jobRow } = await supabase
      .from('ai_reply_jobs')
      .select('retry_count')
      .eq('id', jobId)
      .single();

    const retryCount = (jobRow?.retry_count ?? 0) + 1;
    const now = new Date();

    if (retryCount >= 3) {
      await supabase
        .from('conversations')
        .update({ ai_status: 'error' })
        .eq('id', conversationId);

      await supabase
        .from('ai_reply_jobs')
        .update({ retry_count: retryCount, status: 'failed', error_message: llmResult.message })
        .eq('id', jobId);
    } else {
      const executeAt = new Date(now.getTime() + Math.pow(2, retryCount) * 60 * 1000).toISOString();
      await supabase
        .from('ai_reply_jobs')
        .update({
          retry_count: retryCount,
          status: 'pending',
          execute_at: executeAt,
          error_message: llmResult.message,
        })
        .eq('id', jobId);
    }

    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      status: 'error',
      errorMessage: llmResult.message,
      bookingStage: currentStage,
    });

    return { status: 'error', errorMessage: llmResult.message };
  }

  // ── LLM success ──────────────────────────────────────────────────────────────

  // At this point llmResult.type === 'success' (all other branches returned early)
  const generatedReply = (llmResult as { type: 'success'; reply: string }).reply;

  // ── Determine next booking stage ─────────────────────────────────────────────

  let updatedStage: AIBookingStage = currentStage;

  if (currentStage === 'qualifying') {
    if (hasInterestSignal(generatedReply)) {
      updatedStage = 'slot_proposal';
    }
  } else if (currentStage === 'slot_proposal' && proposedSlots.length > 0) {
    updatedStage = 'slot_confirmation';
  }

  // ── 6.8: Send message via LinkedIn ───────────────────────────────────────────

  const messageMetadata: Record<string, unknown> = { source: 'ai_agent' };
  if (proposedSlots.length > 0) {
    messageMetadata['proposed_slots'] = proposedSlots;
  }

  const sendResult = await sendLinkedInMessage(supabase, conversation, generatedReply);

  if (sendResult.success) {
    console.log(`[AI Agent] ✅ Message sent to lead in conversation ${conversationId} | stage=${updatedStage} | preview="${generatedReply.slice(0, 80)}..."`);
  }

  if (!sendResult.success) {
    await writeLog(supabase, {
      conversationId,
      userId,
      triggerMessageId,
      generatedReply,
      status: 'error',
      errorMessage: sendResult.errorMessage ?? 'Failed to send LinkedIn message',
      bookingStage: currentStage,
    });

    return { status: 'error', errorMessage: sendResult.errorMessage ?? 'Failed to send LinkedIn message' };
  }

  // ── Persist sent message ─────────────────────────────────────────────────────

  const sentAt = new Date().toISOString();
  await persistMessage(supabase, {
    conversationId,
    userId,
    externalMessageId: sendResult.externalMessageId ?? `ai-${randomUUID()}`,
    contentText: generatedReply,
    sentAt,
    metadata: messageMetadata,
  });

  // ── Update conversation stage ────────────────────────────────────────────────

  if (updatedStage !== currentStage) {
    await supabase
      .from('conversations')
      .update({ ai_booking_stage: updatedStage })
      .eq('id', conversationId);
  }

  // ── Write log ────────────────────────────────────────────────────────────────

  await writeLog(supabase, {
    conversationId,
    userId,
    triggerMessageId,
    generatedReply,
    status: 'sent',
    bookingStage: updatedStage,
  });

  return { status: 'sent', generatedReply };
}

// ── LinkedIn send helper ──────────────────────────────────────────────────────

async function sendLinkedInMessage(
  supabase: SupabaseAdminClient,
  conversation: {
    id: string;
    external_conversation_id: string | null;
    linkedin_account_id: string;
    lead_id: string;
  },
  message: string
): Promise<{ success: boolean; externalMessageId?: string; errorMessage?: string }> {
  const { data: accountRow } = await supabase
    .from('linkedin_accounts')
    .select('id, li_at, jsessionid, profile_urn')
    .eq('id', conversation.linkedin_account_id)
    .single();

  if (!accountRow?.li_at || !accountRow?.jsessionid || !accountRow?.profile_urn) {
    return { success: false, errorMessage: 'LinkedIn account credentials not found' };
  }

  const { data: leadRow } = await supabase
    .from('leads')
    .select('linkedin_url, provider_id')
    .eq('id', conversation.lead_id)
    .single();

  const client = createLinkedInClient(
    {
      li_at: accountRow.li_at,
      jsessionid: accountRow.jsessionid,
      profile_urn: accountRow.profile_urn,
    },
    async (newJsessionid: string) => {
      await supabase
        .from('linkedin_accounts')
        .update({ jsessionid: newJsessionid })
        .eq('id', accountRow.id);
    }
  );

  const result = await client.sendMessage({
    linkedin_url: leadRow?.linkedin_url ?? '',
    provider_id: leadRow?.provider_id ?? null,
    message,
    conversation_urn: conversation.external_conversation_id ?? undefined,
  });

  if (!result.success) {
    return { success: false, errorMessage: result.message ?? result.error };
  }

  const externalMessageId =
    client.extractMessageUrn(result.data) ??
    result.data?.value?.message?.entityUrn ??
    result.data?.message?.entityUrn ??
    undefined;

  return { success: true, externalMessageId };
}

// ── Message persistence helper ────────────────────────────────────────────────

async function persistMessage(
  supabase: SupabaseAdminClient,
  params: {
    conversationId: string;
    userId: string;
    externalMessageId: string;
    contentText: string;
    sentAt: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from('messages').insert({
    id: randomUUID(),
    conversation_id: params.conversationId,
    user_id: params.userId,
    external_message_id: params.externalMessageId,
    sender_type: 'linkedin_account',
    direction: 'outbound',
    content_text: params.contentText,
    content_html: `<p>${params.contentText}</p>`,
    metadata: params.metadata ?? { source: 'ai_agent' },
    sent_at: params.sentAt,
  });
}
