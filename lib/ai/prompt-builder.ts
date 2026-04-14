import type { PromptContext, MessageHistoryItem, TimeSlot } from '@/types';

function formatMessageHistory(history: MessageHistoryItem[]): string {
  if (history.length === 0) return '(no messages yet)';
  return history
    .map((msg) => {
      const role = msg.direction === 'inbound' ? 'Lead' : 'You';
      return `[${role}]: ${msg.content}`;
    })
    .join('\n');
}

function formatSlots(slots: TimeSlot[]): string {
  return slots.map((s, i) => `  ${i + 1}. ${s.label}`).join('\n');
}

function getMostRecentMessage(history: MessageHistoryItem[]): string {
  if (history.length === 0) return '(none)';
  return history[history.length - 1].content;
}

function buildQualifyingPrompt(ctx: PromptContext): string {
  const { persona, meetingObjective, lead, messageHistory } = ctx;
  const mostRecent = getMostRecentMessage(messageHistory);

  return `You are acting as the following persona:
${persona}

Your goal is to qualify leads and book meetings. Meeting objective:
${meetingObjective}

You are messaging ${lead.full_name}${lead.company ? ` from ${lead.company}` : ''}${lead.title ? `, ${lead.title}` : ''}.

Conversation history:
${formatMessageHistory(messageHistory)}

Most recent message from lead:
${mostRecent}

Instructions:
- Respond naturally and conversationally as the persona described above.
- Evaluate whether ${lead.first_name ?? lead.full_name} is interested in scheduling a meeting.
- If they express interest, transition toward proposing meeting times.
- If they decline or are clearly not interested, send a polite closing message.
- Keep your reply concise and professional.

Write your reply now:`;
}

function buildSlotProposalPrompt(ctx: PromptContext): string {
  const { persona, meetingObjective, lead, messageHistory, proposedSlots = [] } = ctx;
  const mostRecent = getMostRecentMessage(messageHistory);
  const slotsText = proposedSlots.length > 0
    ? formatSlots(proposedSlots)
    : '  (no slots available — inform the lead and ask them to check back in a few days)';

  return `You are acting as the following persona:
${persona}

Your goal is to book a meeting. Meeting objective:
${meetingObjective}

You are messaging ${lead.full_name}${lead.company ? ` from ${lead.company}` : ''}${lead.title ? `, ${lead.title}` : ''}.

Conversation history:
${formatMessageHistory(messageHistory)}

Most recent message from lead:
${mostRecent}

Available meeting slots:
${slotsText}

Instructions:
- Respond naturally and conversationally as the persona described above.
- Propose the available slots to ${lead.first_name ?? lead.full_name} in a friendly, natural way.
- Ask them to pick a time that works best for them.
- If no slots are listed, let them know you have no availability right now and suggest they check back in a few days.
- Keep your reply concise and professional.

Write your reply now:`;
}

function buildSlotConfirmationPrompt(ctx: PromptContext): string {
  const { persona, meetingObjective, lead, messageHistory, proposedSlots = [] } = ctx;
  const mostRecent = getMostRecentMessage(messageHistory);
  const slotsText = proposedSlots.length > 0
    ? formatSlots(proposedSlots)
    : '  (refer to the slot the lead selected)';

  return `You are acting as the following persona:
${persona}

Your goal is to confirm a meeting booking. Meeting objective:
${meetingObjective}

You are messaging ${lead.full_name}${lead.company ? ` from ${lead.company}` : ''}${lead.title ? `, ${lead.title}` : ''}.

Conversation history:
${formatMessageHistory(messageHistory)}

Most recent message from lead:
${mostRecent}

Previously proposed slots:
${slotsText}

Instructions:
- Respond naturally and conversationally as the persona described above.
- The lead has selected or is confirming a meeting slot.
- Confirm the selected time with ${lead.first_name ?? lead.full_name}, summarise the meeting details, and outline the next steps.
- Be warm and enthusiastic — a meeting is being booked!
- Keep your reply concise and professional.

Write your reply now:`;
}

/**
 * Constructs a complete LLM prompt from the given PromptContext.
 * Selects the appropriate template based on bookingStage.
 * Pure function — no side effects.
 */
export function buildPrompt(ctx: PromptContext): string {
  switch (ctx.bookingStage) {
    case 'qualifying':
      return buildQualifyingPrompt(ctx);
    case 'slot_proposal':
      return buildSlotProposalPrompt(ctx);
    case 'slot_confirmation':
      return buildSlotConfirmationPrompt(ctx);
    default:
      return buildQualifyingPrompt(ctx);
  }
}
