import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildPrompt } from './prompt-builder';
import type { PromptContext, LeadContext, MessageHistoryItem, TimeSlot } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    persona: 'You are Alex, a friendly sales rep at Acme Corp.',
    meetingObjective: 'Book a 30-minute product demo.',
    lead: {
      id: 'lead-1',
      full_name: 'Jane Doe',
      first_name: 'Jane',
      company: 'TechCo',
      title: 'CTO',
    },
    messageHistory: [
      { id: 'm1', content: 'Hi, I saw your message.', direction: 'inbound', sent_at: '2024-01-01T10:00:00Z' },
    ],
    bookingStage: 'qualifying',
    ...overrides,
  };
}

const slots: TimeSlot[] = [
  { start: '2024-01-15T14:00:00Z', end: '2024-01-15T14:30:00Z', label: 'Monday 15 Jan at 2:00 PM' },
  { start: '2024-01-16T10:00:00Z', end: '2024-01-16T10:30:00Z', label: 'Tuesday 16 Jan at 10:00 AM' },
];

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  describe('qualifying stage', () => {
    it('includes persona text', () => {
      const ctx = makeContext({ bookingStage: 'qualifying' });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain(ctx.persona);
    });

    it('includes meeting objective', () => {
      const ctx = makeContext({ bookingStage: 'qualifying' });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain(ctx.meetingObjective);
    });

    it('includes lead full name', () => {
      const ctx = makeContext({ bookingStage: 'qualifying' });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('Jane Doe');
    });

    it('includes most recent message content', () => {
      const ctx = makeContext({ bookingStage: 'qualifying' });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('Hi, I saw your message.');
    });

    it('includes all messages in history', () => {
      const ctx = makeContext({
        bookingStage: 'qualifying',
        messageHistory: [
          { id: 'm1', content: 'Hello there', direction: 'outbound', sent_at: '2024-01-01T09:00:00Z' },
          { id: 'm2', content: 'Hi, I saw your message.', direction: 'inbound', sent_at: '2024-01-01T10:00:00Z' },
        ],
      });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('Hello there');
      expect(prompt).toContain('Hi, I saw your message.');
    });
  });

  describe('slot_proposal stage', () => {
    it('includes persona, objective, lead name, and most recent message', () => {
      const ctx = makeContext({ bookingStage: 'slot_proposal', proposedSlots: slots });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain(ctx.persona);
      expect(prompt).toContain(ctx.meetingObjective);
      expect(prompt).toContain('Jane Doe');
      expect(prompt).toContain('Hi, I saw your message.');
    });

    it('includes proposed slot labels', () => {
      const ctx = makeContext({ bookingStage: 'slot_proposal', proposedSlots: slots });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('Monday 15 Jan at 2:00 PM');
      expect(prompt).toContain('Tuesday 16 Jan at 10:00 AM');
    });

    it('handles no slots gracefully', () => {
      const ctx = makeContext({ bookingStage: 'slot_proposal', proposedSlots: [] });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('no availability');
    });
  });

  describe('slot_confirmation stage', () => {
    it('includes persona, objective, lead name, and most recent message', () => {
      const ctx = makeContext({ bookingStage: 'slot_confirmation', proposedSlots: slots });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain(ctx.persona);
      expect(prompt).toContain(ctx.meetingObjective);
      expect(prompt).toContain('Jane Doe');
      expect(prompt).toContain('Hi, I saw your message.');
    });

    it('includes slot labels for reference', () => {
      const ctx = makeContext({ bookingStage: 'slot_confirmation', proposedSlots: slots });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('Monday 15 Jan at 2:00 PM');
    });
  });

  describe('edge cases', () => {
    it('handles empty message history', () => {
      const ctx = makeContext({ messageHistory: [] });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain(ctx.persona);
      expect(prompt).toContain(ctx.meetingObjective);
      expect(prompt).toContain('Jane Doe');
    });

    it('handles lead with no company or title', () => {
      const ctx = makeContext({
        lead: { id: 'l1', full_name: 'Bob Smith', first_name: 'Bob' },
      });
      const prompt = buildPrompt(ctx);
      expect(prompt).toContain('Bob Smith');
    });
  });
});

// ── Property-Based Test ───────────────────────────────────────────────────────
// Feature: ai-inbox-automation, Property 9: Prompt contains all required context components

describe('buildPrompt property tests', () => {
  const leadArb = fc.record({
    id: fc.string({ minLength: 1 }),
    full_name: fc.string({ minLength: 1 }),
    first_name: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    company: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    title: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  }) as fc.Arbitrary<LeadContext>;

  const msgArb = fc.record({
    id: fc.string({ minLength: 1 }),
    content: fc.string({ minLength: 1 }),
    direction: fc.constantFrom('inbound' as const, 'outbound' as const),
    sent_at: fc.date().map((d) => d.toISOString()),
  }) as fc.Arbitrary<MessageHistoryItem>;

  const stageArb = fc.constantFrom(
    'qualifying' as const,
    'slot_proposal' as const,
    'slot_confirmation' as const,
  );

  /**
   * Validates: Requirements 4.4
   *
   * For any combination of persona, meetingObjective, LeadContext, and
   * MessageHistoryItem[], the string returned by buildPrompt() must contain:
   *   1. the persona text
   *   2. the meeting objective text
   *   3. the lead's full name
   *   4. the content of the most recent message (when history is non-empty)
   */
  it('P9: prompt always contains persona, objective, lead name, and most-recent message', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),   // persona
        fc.string({ minLength: 1 }),   // meetingObjective
        leadArb,
        fc.array(msgArb, { minLength: 1 }),
        stageArb,
        (persona, meetingObjective, lead, messageHistory, bookingStage) => {
          const ctx: PromptContext = {
            persona,
            meetingObjective,
            lead,
            messageHistory,
            bookingStage,
          };
          const prompt = buildPrompt(ctx);
          const mostRecent = messageHistory[messageHistory.length - 1].content;

          return (
            prompt.includes(persona) &&
            prompt.includes(meetingObjective) &&
            prompt.includes(lead.full_name) &&
            prompt.includes(mostRecent)
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
