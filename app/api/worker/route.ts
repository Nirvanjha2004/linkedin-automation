import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { createLinkedInClient, LeadProfileData } from '@/lib/linkedin/client';
import { isValidCronRequest, cronUnauthorized } from '@/lib/cron-auth';
import { processAIReplyJob } from '@/lib/ai/conversation-handler';
import { getRedisClient } from '@/lib/redis/client';

/** Replaces {{first_name}}, {{last_name}}, {{full_name}}, {{company}}, {{title}} in a template */
function personalize(template: string, lead: Record<string, string | null | undefined>): string {
  return template
    .replace(/\{\{first_name\}\}/gi, lead.first_name || 'there')
    .replace(/\{\{last_name\}\}/gi, lead.last_name || '')
    .replace(/\{\{full_name\}\}/gi, lead.full_name || lead.first_name || 'there')
    .replace(/\{\{company\}\}/gi, lead.company || 'your company')
    .replace(/\{\{title\}\}/gi, lead.title || 'your role')
    .trim();
}

const MESSAGE_ACTION_TYPES = ['send_message', 'send_followup_1', 'send_followup_2'] as const;
type MessageActionType = typeof MESSAGE_ACTION_TYPES[number];

const MESSAGE_STATUS_MAP: Record<MessageActionType, { status: string; timestampField: string }> = {
  send_message:   { status: 'message_sent',   timestampField: 'message_sent_at' },
  send_followup_1: { status: 'followup_1_sent', timestampField: 'follow_up_1_sent_at' },
  send_followup_2: { status: 'followup_2_sent', timestampField: 'follow_up_2_sent_at' },
};

// POST /api/worker
// Polls action_queue every 30 seconds for ready actions and executes them immediately.
// No sleep delays — timing is handled by the scheduler.
export async function POST(request: NextRequest) {
  // if (!isValidCronRequest(request)) return cronUnauthorized();
  const supabase = createAdminClient();
  const currentTime = new Date();

  try {
    // Cleanup: reset AI reply jobs stuck in 'processing' for > 10 minutes
    const stuckCutoff = new Date(currentTime.getTime() - 10 * 60 * 1000).toISOString();
    await supabase
      .from('ai_reply_jobs')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .lte('updated_at', stuckCutoff);

    // 1. Fetch all queued actions whose execute_at time has passed
    const { data: readyActions, error: fetchError } = await supabase
      .from('action_queue')
      .select('id, account_id, lead_id, campaign_id, type, payload')
      .eq('status', 'queued')
      .lte('execute_at', currentTime.toISOString())
      .order('execute_at', { ascending: true })
      .limit(20);

    if (fetchError) throw fetchError;

    if (!readyActions?.length) {
      return NextResponse.json({ message: 'No actions ready', processed: 0 });
    }

    // 2. Batch-fetch all distinct account credentials for this batch
    const accountIds = [...new Set(readyActions.map((a) => a.account_id))];
    const { data: accountRows } = await supabase
      .from('linkedin_accounts')
      .select('id, li_at, jsessionid, profile_urn')
      .in('id', accountIds);

    // Index by id for O(1) lookup
    const accountMap = new Map((accountRows ?? []).map((a) => [a.id, a]));

    let processed = 0;
    let failed = 0;
    const results: { actionId: string; status: string; error?: string }[] = [];

    for (const action of readyActions) {
      try {
        // 3. Atomically claim the action — prevents duplicate execution
        const { error: claimError } = await supabase
          .from('action_queue')
          .update({ status: 'processing' })
          .eq('id', action.id)
          .eq('status', 'queued');

        if (claimError) {
          results.push({ actionId: action.id, status: 'skipped', error: 'claim_failed' });
          continue;
        }

        // 4. Resolve LinkedIn client for this account's credentials
        const creds = accountMap.get(action.account_id);
        if (!creds?.li_at || !creds?.jsessionid || !creds?.profile_urn) {
          await supabase.from('action_queue')
            .update({ status: 'failed', error_message: 'Account credentials not found' })
            .eq('id', action.id);
          await supabase.from('leads').update({ status: 'failed' }).eq('id', action.lead_id);
          results.push({ actionId: action.id, status: 'failed', error: 'missing_credentials' });
          failed++;
          continue;
        }

        const client = createLinkedInClient(creds, async (newJsessionid) => {
          creds.jsessionid = newJsessionid;
          await supabase.from('linkedin_accounts')
            .update({ jsessionid: newJsessionid })
            .eq('id', action.account_id);
        });

        // 5. Execute
        let success = false;
        let errorMsg = '';

        if (action.type === 'connection_request') {
          const result = await client.sendConnectionRequest({
            linkedin_url: action.payload.linkedin_url,
            message: action.payload.message ?? undefined,
          });

          // Always enrich lead from profile data when available
          if (result.profileData) {
            await enrichLead(supabase, action.lead_id, result.profileData, currentTime);
          }

          success = result.success;
          errorMsg = result.error ?? '';

          // Already invited recently — treat as connection_sent, no retry
          if (!success && result.alreadyInvited) {
            await supabase.from('action_queue')
              .update({ status: 'completed', executed_at: currentTime.toISOString(), error_message: 'already_invited_recently' })
              .eq('id', action.id);
            await supabase.from('leads')
              .update({ status: 'connection_sent', connection_sent_at: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
              .eq('id', action.lead_id);
            await supabase.from('action_logs').insert({
              campaign_id: action.campaign_id, lead_id: action.lead_id,
              action_type: action.type, status: 'skipped', error_message: 'already_invited_recently',
            });
            processed++;
            results.push({ actionId: action.id, status: 'skipped_already_invited' });
            continue;
          }

          // Already 1st-degree connection — advance to connected, no retry
          if (!success && result.alreadyConnected) {
            await supabase.from('action_queue')
              .update({ status: 'completed', executed_at: currentTime.toISOString(), error_message: 'already_connected' })
              .eq('id', action.id);
            await supabase.from('leads')
              .update({ status: 'connected', connected_at: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
              .eq('id', action.lead_id);
            await supabase.from('action_logs').insert({
              campaign_id: action.campaign_id, lead_id: action.lead_id,
              action_type: action.type, status: 'skipped', error_message: 'already_connected',
            });
            processed++;
            results.push({ actionId: action.id, status: 'skipped_already_connected' });
            continue;
          }
        } else if (MESSAGE_ACTION_TYPES.includes(action.type as MessageActionType)) {
          // ── Message / follow-up actions ─────────────────────────────────────
          const msgType = action.type as MessageActionType;
          const template = action.payload.template as string;
          const leadData = action.payload.lead as Record<string, string | null | undefined>;

          if (!template) {
            errorMsg = `No template configured for ${msgType}`;
          } else {
            const message = personalize(template, leadData);

            const { data: existingConversation } = await supabase
              .from('conversations')
              .select('external_conversation_id')
              .eq('linkedin_account_id', action.account_id)
              .eq('lead_id', action.lead_id)
              .maybeSingle();

            const result = await client.sendMessage({
              linkedin_url: action.payload.linkedin_url as string,
              provider_id: action.payload.provider_id as string | undefined,
              message,
              conversation_urn: existingConversation?.external_conversation_id ?? undefined,
            });
            success = result.success;
            errorMsg = result.error ?? '';

            if (success) {
              const { status: newStatus, timestampField } = MESSAGE_STATUS_MAP[msgType];

              const conversationUrn =
                existingConversation?.external_conversation_id ||
                client.extractConversationUrn(result.data);
              const messageUrn = client.extractMessageUrn(result.data);

              if (conversationUrn) {
                const { data: campaignRow } = await supabase
                  .from('campaigns')
                  .select('user_id')
                  .eq('id', action.campaign_id)
                  .maybeSingle();

                if (campaignRow?.user_id) {
                  const { data: conversationRow } = await supabase
                    .from('conversations')
                    .upsert({
                      user_id: campaignRow.user_id,
                      linkedin_account_id: action.account_id,
                      lead_id: action.lead_id,
                      external_conversation_id: conversationUrn,
                      last_external_message_id: messageUrn,
                      last_message_at: currentTime.toISOString(),
                    }, { onConflict: 'linkedin_account_id,lead_id' })
                    .select('id')
                    .single();

                  if (conversationRow?.id && messageUrn) {
                    await supabase
                      .from('messages')
                      .upsert({
                        conversation_id: conversationRow.id,
                        user_id: campaignRow.user_id,
                        external_message_id: messageUrn,
                        sender_type: 'linkedin_account',
                        direction: 'outbound',
                        content_text: message,
                        content_html: `<p>${message}</p>`,
                        metadata: { source: 'worker_send' },
                        sent_at: currentTime.toISOString(),
                      }, { onConflict: 'conversation_id,external_message_id' });
                  }
                }
              }

              await supabase.from('action_queue')
                .update({ status: 'completed', executed_at: currentTime.toISOString() })
                .eq('id', action.id);
              await supabase.from('leads')
                .update({ status: newStatus, [timestampField]: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
                .eq('id', action.lead_id);
              await supabase.from('action_logs').insert({
                campaign_id: action.campaign_id, lead_id: action.lead_id,
                action_type: action.type, status: 'completed',
              });
              processed++;
              results.push({ actionId: action.id, status: 'completed' });
              continue;
            }
          }
        } else {
          errorMsg = `Unknown action type: ${action.type}`;
        }

        if (success) {
          // 4a. Mark action completed
          await supabase.from('action_queue')
            .update({ status: 'completed', executed_at: currentTime.toISOString() })
            .eq('id', action.id);

          // 4b. Update lead status (connection_request success path)
          await supabase.from('leads')
            .update({ status: 'connection_sent', connection_sent_at: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
            .eq('id', action.lead_id);

          // 4c. Log the action
          await supabase.from('action_logs').insert({
            campaign_id: action.campaign_id, lead_id: action.lead_id,
            action_type: action.type, status: 'completed',
          });

          processed++;
          results.push({ actionId: action.id, status: 'completed' });
        } else {
          // 5. Retry logic with exponential backoff
          const { data: current } = await supabase
            .from('action_queue').select('retry_count').eq('id', action.id).single();

          const retryCount = (current?.retry_count ?? 0) + 1;
          const isFinal = retryCount >= 3;

          await supabase.from('action_queue').update({
            status: isFinal ? 'failed' : 'queued',
            retry_count: retryCount,
            error_message: errorMsg,
            execute_at: isFinal
              ? currentTime.toISOString()
              : new Date(currentTime.getTime() + Math.pow(2, retryCount) * 60 * 1000).toISOString(),
          }).eq('id', action.id);

          if (isFinal) {
            await supabase.from('leads')
              .update({ status: 'failed', last_action_at: currentTime.toISOString() })
              .eq('id', action.lead_id);
            await supabase.from('action_logs').insert({
              campaign_id: action.campaign_id, lead_id: action.lead_id,
              action_type: action.type, status: 'failed', error_message: errorMsg,
            });
          } else {
            await supabase.from('leads').update({ status: 'pending' }).eq('id', action.lead_id);
          }

          failed++;
          results.push({ actionId: action.id, status: isFinal ? 'failed' : 'retrying', error: errorMsg });
        }
      } catch (err: unknown) {
        const error = err as Error;
        failed++;
        results.push({ actionId: action.id, status: 'error', error: error.message });
        await supabase.from('action_queue')
          .update({ status: 'failed', error_message: error.message })
          .eq('id', action.id);
      }
    }

    // ── AI Reply Jobs ─────────────────────────────────────────────────────────
    // Poll ai_reply_jobs for pending jobs whose execute_at has passed
    const { data: pendingAIJobs } = await supabase
      .from('ai_reply_jobs')
      .select('id, conversation_id, user_id, trigger_message_id')
      .eq('status', 'pending')
      .lte('execute_at', currentTime.toISOString())
      .order('execute_at', { ascending: true })
      .limit(10);

    let aiProcessed = 0;
    let aiFailed = 0;

    for (const job of pendingAIJobs ?? []) {
      // Atomically claim the job
      const { error: claimError } = await supabase
        .from('ai_reply_jobs')
        .update({ status: 'processing', updated_at: currentTime.toISOString() })
        .eq('id', job.id)
        .eq('status', 'pending');

      if (claimError) continue;

      // Acquire Redis lock to prevent duplicate execution
      const redis = getRedisClient();
      const lockKey = `ai_reply_job:${job.id}`;
      const lockAcquired = await redis.set(lockKey, '1', { nx: true, ex: 300 });

      if (!lockAcquired) continue;

      try {
        const result = await processAIReplyJob(supabase, {
          jobId: job.id,
          conversationId: job.conversation_id,
          userId: job.user_id,
          triggerMessageId: job.trigger_message_id,
        });

        if (result.status === 'sent' || result.status === 'skipped') {
          await supabase
            .from('ai_reply_jobs')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', job.id);
          aiProcessed++;
        } else {
          // 'error' — the handler already updated retry_count / status / ai_status
          // Only mark as failed if the handler didn't reschedule it
          const { data: jobState } = await supabase
            .from('ai_reply_jobs')
            .select('status')
            .eq('id', job.id)
            .single();
          if (jobState?.status === 'processing') {
            await supabase
              .from('ai_reply_jobs')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', job.id);
          }
          aiFailed++;
        }
      } catch (err: unknown) {
        const error = err as Error;
        await supabase
          .from('ai_reply_jobs')
          .update({ status: 'failed', error_message: error.message, updated_at: new Date().toISOString() })
          .eq('id', job.id);
        aiFailed++;
      } finally {
        await redis.del(lockKey);
      }
    }

    return NextResponse.json({
      success: true,
      total_ready: readyActions.length,
      processed,
      failed,
      results,
      ai_processed: aiProcessed,
      ai_failed: aiFailed,
      timestamp: currentTime.toISOString(),
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Worker error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Enriches a lead row with data from the Unipile profile response.
 * Only updates fields that are currently null/empty to avoid overwriting
 * data the user manually set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichLead(supabase: any, leadId: string, profile: LeadProfileData, currentTime: Date) {
  const update: Record<string, unknown> = { enriched_at: currentTime.toISOString() };

  if (profile.provider_id)      update.provider_id       = profile.provider_id;
  if (profile.first_name)       update.first_name        = profile.first_name;
  if (profile.last_name)        update.last_name         = profile.last_name;
  if (profile.full_name)        update.full_name         = profile.full_name;
  if (profile.headline)         update.headline          = profile.headline;
  if (profile.location)         update.location          = profile.location;
  if (profile.profile_pic_url)  update.profile_pic_url   = profile.profile_pic_url;
  if (profile.public_profile_url) update.public_profile_url = profile.public_profile_url;
  if (profile.company)          update.company           = profile.company;
  if (profile.title)            update.title             = profile.title;

  if (Object.keys(update).length > 1) {
    await supabase.from('leads').update(update).eq('id', leadId);
  }
}

// Vercel Cron Jobs send GET requests — delegate to the POST handler
export async function GET(request: NextRequest) {
  return POST(request);
}