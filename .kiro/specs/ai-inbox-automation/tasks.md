# Implementation Plan: AI Inbox Automation

## Overview

Implement the AI-powered inbox automation layer on top of the existing LinkedIn messaging pipeline. The implementation follows the dependency order: database schema → TypeScript types → core library modules → sync pipeline hook → worker extension → API routes → UI updates → property-based tests.

## Tasks

- [x] 1. Database migrations
  - [x] 1.1 Create migration 008: AI automation tables
    - Create `supabase/migrations/008_ai_automation.sql`
    - Add `ai_automation_config` table with all columns and constraints from the design (`persona`, `meeting_objective`, `gcal_refresh_token`, `gcal_token_error`, `meeting_duration_min` CHECK 15–120, `timezone`, `default_ai_enabled`)
    - Add `ai_reply_jobs` table with `status` CHECK constraint, partial unique index `idx_ai_reply_jobs_one_pending` on `(conversation_id) WHERE status = 'pending'`, and composite index on `(status, execute_at)`
    - Add `ai_automation_logs` table with `status` CHECK constraint and indexes
    - Enable RLS on all three tables and add user + service-role policies
    - _Requirements: 1.1, 3.1, 3.2, 10.1_

  - [x] 1.2 Create migration 009: conversations table extensions
    - Create `supabase/migrations/009_conversations_ai_columns.sql`
    - Add `ai_enabled BOOLEAN NOT NULL DEFAULT FALSE` to `conversations`
    - Add `ai_status TEXT NOT NULL DEFAULT 'idle'` with CHECK constraint (`idle`, `active`, `paused`, `completed`, `error`)
    - Add `ai_booking_stage TEXT NOT NULL DEFAULT 'qualifying'` with CHECK constraint (`qualifying`, `slot_proposal`, `slot_confirmation`, `done`)
    - Add partial index `idx_conversations_ai_status ON conversations(ai_status) WHERE ai_enabled = TRUE`
    - _Requirements: 2.1, 5.2_

- [x] 2. TypeScript types
  - [x] 2.1 Add AI automation types to `types/index.ts`
    - Add `AIStatus`, `AIBookingStage`, `AIJobStatus`, `AILogStatus` union types
    - Add `AIAutomationConfig`, `AIReplyJob`, `AIAutomationLog` interfaces as specified in the design
    - Extend the existing `Conversation` interface with `ai_enabled`, `ai_status`, `ai_booking_stage` optional fields
    - Add `TimeSlot`, `LeadContext`, `MessageHistoryItem`, `PromptContext` interfaces needed by lib modules
    - _Requirements: 2.1, 1.1, 3.2, 10.1_

- [x] 3. Google Calendar client (`lib/google/calendar-client.ts`)
  - [x] 3.1 Implement token refresh helper
    - Create `lib/google/calendar-client.ts`
    - Implement internal `refreshAccessToken(refreshToken: string): Promise<string>` that POSTs to `https://oauth2.googleapis.com/token` and returns a short-lived access token held in memory only
    - _Requirements: 6.1_

  - [x] 3.2 Implement `getAvailableSlots`
    - Call Google Calendar free/busy API for the next 7 days using the refreshed access token
    - Filter results to slots of exactly `durationMinutes` within 08:00–18:00 in the configured `timezone`
    - Return `TimeSlot[]` sorted by start time
    - _Requirements: 6.2, 6.3_

  - [ ]* 3.3 Write property tests for `getAvailableSlots` (P13, P14)
    - **Property 13: Free/busy query always spans exactly 7 days** — for any `fc.date()` input, assert the time range passed to the API is `[T, T + 7 days]`
    - **Property 14: All returned slots respect duration and business hours** — for any `fc.record({ duration: fc.integer({ min: 15, max: 120 }), freeBusy: freeBusyArb })`, assert every returned slot has duration exactly `D` minutes and start/end within 08:00–18:00
    - **Validates: Requirements 6.2, 6.3**

  - [x] 3.4 Implement `createEvent`
    - Build event payload with title, description (lead name + LinkedIn URL), start/end from `TimeSlot`, organizer email
    - Call Google Calendar Events API with the refreshed access token
    - Return `{ eventId, htmlLink }`
    - _Requirements: 7.2_

  - [ ]* 3.5 Write property test for `createEvent` payload (P17)
    - **Property 17: Calendar event payload contains all required fields** — for any `fc.record({ slot: slotArb, lead: leadArb })`, assert the payload has non-empty `title`, lead name in `description`, lead LinkedIn URL in `description`, `start === slot.start`, `end === slot.end`, non-empty `organizerEmail`
    - **Validates: Requirements 7.2**

- [x] 4. AI prompt builder (`lib/ai/prompt-builder.ts`)
  - [x] 4.1 Implement `buildPrompt`
    - Create `lib/ai/prompt-builder.ts`
    - Accept `PromptContext` (persona, meetingObjective, lead, messageHistory, bookingStage, proposedSlots?)
    - Return a string prompt that includes all four required components: persona text, meeting objective, lead name, and most-recent message content
    - Select the appropriate prompt template based on `bookingStage` (qualifying / slot_proposal / slot_confirmation)
    - _Requirements: 4.4_

  - [ ]* 4.2 Write property test for `buildPrompt` (P9)
    - **Property 9: Prompt contains all required context components** — for any `fc.record({ persona: fc.string(), objective: fc.string(), lead: leadArb, history: fc.array(msgArb, { minLength: 1 }) })`, assert the returned string contains the persona text, meeting objective, lead name, and content of the most recent message
    - **Validates: Requirements 4.4**

- [x] 5. AI slot parser (`lib/ai/slot-parser.ts`)
  - [x] 5.1 Implement `parseSlotSelection`
    - Create `lib/ai/slot-parser.ts`
    - Accept `(leadMessage: string, proposedSlots: TimeSlot[]): SlotParseResult`
    - Match by ordinal ("first", "second", "third", "1", "2", "3"), time string, or date string against each slot's `label`
    - Return `{ type: 'selected', slot }` for unambiguous match, `{ type: 'ambiguous' }` for multiple matches, `{ type: 'none' }` for no match
    - _Requirements: 7.1, 7.6_

  - [ ]* 5.2 Write property test for `parseSlotSelection` (P16)
    - **Property 16: Unambiguous slot selection is always parsed correctly** — for any `fc.array(slotArb, { minLength: 1, maxLength: 3 })` and a message that unambiguously references exactly one slot, assert `{ type: 'selected' }` is returned; for zero or multiple references, assert `{ type: 'ambiguous' }` or `{ type: 'none' }`
    - **Validates: Requirements 7.1, 7.6**

- [x] 6. AI conversation handler (`lib/ai/conversation-handler.ts`)
  - [x] 6.1 Implement `processAIReplyJob` — context fetching and guards
    - Create `lib/ai/conversation-handler.ts`
    - Implement `processAIReplyJob(supabase, input: AIHandlerInput): Promise<AIHandlerResult>`
    - Fetch conversation + `ai_status` + `ai_booking_stage`; bail with `skipped` if not `active`
    - Check billing entitlement via `lib/billing/entitlement.ts`; mark job `skipped` if user is not on paid plan
    - Fetch full message history ordered `sent_at ASC`
    - Fetch lead profile fields (`full_name`, `first_name`, `company`, `title`, `headline`, `location`)
    - Fetch `ai_automation_config` for persona, objective, meeting duration, timezone
    - _Requirements: 4.1, 4.2, 4.3, 9.4_

  - [x] 6.2 Implement outbound message count guard and closing message
    - Count outbound messages with `metadata->>'source' = 'ai_agent'`
    - If count ≥ 5 with no interest signal, set `ai_status = 'completed'`, send closing message, write log
    - _Requirements: 5.5_

  - [ ]* 6.3 Write property test for outbound message count guard (P12)
    - **Property 12: Agent stops after 5 outbound messages without interest** — for any `fc.integer({ min: 0, max: 10 })` outbound count and no interest signal, assert `ai_status` becomes `'completed'` when count ≥ 5 and remains `'active'` when count < 5
    - **Validates: Requirements 5.5**

  - [x] 6.4 Implement booking stage routing and LLM call
    - Determine current `ai_booking_stage` and select prompt template via `buildPrompt`
    - Call LLM API (OpenAI/Anthropic) with 30-second timeout
    - On timeout or non-retryable error: set `ai_status = 'error'`, write log, return `{ status: 'error' }`
    - On retryable error: increment `retry_count`, reschedule with `execute_at = now + 2^retry_count minutes`; when `retry_count` reaches 3, set `ai_status = 'error'`
    - _Requirements: 4.4, 4.6, 10.4_

  - [ ]* 6.5 Write property test for retry backoff schedule (P20)
    - **Property 20: Retry backoff follows 2^retry_count schedule** — for any `fc.integer({ min: 0, max: 2 })` retry count N, assert `execute_at ≈ now + 2^N minutes` (within 1-second tolerance); at retry_count = 3, assert `ai_status = 'error'`
    - **Validates: Requirements 10.4**

  - [x] 6.6 Implement Google Calendar integration within handler
    - When `ai_booking_stage = 'slot_proposal'`: call `GoogleCalendarClient.getAvailableSlots`, select up to 3 slots, include in prompt
    - When `ai_booking_stage = 'slot_confirmation'`: call `parseSlotSelection` on the latest inbound message; if ambiguous, ask for clarification; if selected, call `createEvent`
    - On successful event creation: send confirmation message, set `ai_status = 'completed'`, update lead status to `completed`
    - On event creation failure: re-propose same slots
    - On token refresh failure: set `ai_status = 'error'`, set `gcal_token_error = true` on config
    - _Requirements: 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 6.7 Write property test for slot proposal count (P15)
    - **Property 15: Slot proposal count is at most 3** — for any `fc.array(slotArb, { minLength: 0, maxLength: 20 })`, assert the number of slots included in the proposal message is ≤ 3
    - **Validates: Requirements 6.4**

  - [x] 6.8 Implement message send, persistence, and log write
    - Send reply via existing LinkedIn send infrastructure (reuse pattern from `app/api/worker/route.ts`)
    - Persist sent message to `messages` table with `metadata: { source: 'ai_agent' }`
    - Write one record to `ai_automation_logs` for every job attempt (sent, skipped, or error)
    - Update `conversations.ai_booking_stage` and `ai_status` as needed
    - _Requirements: 4.5, 4.7, 10.1_

  - [ ]* 6.9 Write property test for execution log invariant (P21)
    - **Property 21: Execution log always written for every job attempt** — for any handler invocation result (`sent`, `skipped`, `error`), assert exactly one `ai_automation_logs` record is inserted with non-null `conversation_id`, `user_id`, `status`, and `created_at`
    - **Validates: Requirements 10.1**

- [x] 7. Checkpoint — core library complete
  - Ensure all non-optional tests pass. Verify `lib/google/calendar-client.ts`, `lib/ai/prompt-builder.ts`, `lib/ai/slot-parser.ts`, and `lib/ai/conversation-handler.ts` compile without errors. Ask the user if questions arise.

- [x] 8. Extend sync pipeline to enqueue AI reply jobs
  - [x] 8.1 Add AI job enqueue logic to `syncMessagesForUser`
    - In `lib/linkedin/message-sync.ts`, after inserting new inbound messages, check if the conversation has `ai_enabled = true` and `ai_status = 'active'`
    - If so, upsert a single `ai_reply_jobs` record with `status = 'pending'` using the partial unique index to enforce deduplication (one pending job per conversation)
    - Skip enqueue if `ai_status` is `paused` or `completed`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 8.2 Write property tests for job enqueue invariants (P5, P6, P7)
    - **Property 5: Inbound trigger creates exactly one pending job for active conversations** — for any `fc.array(fc.string(), { minLength: 1 })` of multiple trigger events on the same conversation, assert at most one `pending` job exists after all triggers
    - **Property 6: Job record contains all required fields** — for any valid trigger event, assert the created job has non-null `conversation_id`, `user_id`, `trigger_message_id`, `status = 'pending'`, `retry_count = 0`, `created_at`
    - **Property 7: No job created for paused or completed conversations** — for any inbound message on a conversation with `ai_status` in `['paused', 'completed']`, assert no job is created
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [ ]* 8.3 Write property test for message history sort order (P8)
    - **Property 8: Message history is always sorted ascending by sent_at** — for any `fc.array(fc.record({ sent_at: fc.date() }), { minLength: 1 })` inserted in arbitrary order, assert the array returned by the handler's fetch is strictly ascending by `sent_at`
    - **Validates: Requirements 4.1**

- [x] 9. Extend worker to process AI reply jobs
  - [x] 9.1 Add AI reply job polling to `app/api/worker/route.ts`
    - After the existing `action_queue` processing block, add a second block that queries `ai_reply_jobs` where `status = 'pending'` and `execute_at <= now`, ordered by `execute_at ASC`, limit 10
    - For each job: atomically claim it (`UPDATE ... SET status = 'processing' WHERE status = 'pending'`), acquire a Redis lock (`ai_reply_job:{jobId}`, TTL 5 min) via `lib/redis/lock-manager.ts`, call `processAIReplyJob`, release lock
    - Add a cleanup pass at worker startup: reset jobs stuck in `processing` for > 10 minutes back to `pending`
    - _Requirements: 3.1, 10.4_

- [x] 10. API routes — AI automation config and Google OAuth
  - [x] 10.1 Implement `GET /api/ai-automation/config`
    - Create `app/api/ai-automation/config/route.ts`
    - Require authenticated session; fetch `ai_automation_config` for the user (return defaults if not found)
    - Never return `gcal_refresh_token` in the response body; return `gcal_connected: boolean` instead
    - _Requirements: 1.4_

  - [x] 10.2 Implement `PATCH /api/ai-automation/config`
    - In the same route file, handle PATCH
    - Validate `meeting_duration_min` is between 15 and 120 inclusive; return 400 if not
    - Upsert `ai_automation_config` for the user
    - _Requirements: 1.2, 1.4_

  - [ ]* 10.3 Write property test for meeting duration validation (P2)
    - **Property 2: Meeting duration validation is a closed interval** — for any `fc.integer()`, assert the validator accepts `d` iff `15 <= d <= 120`; values 14, 121, 0, negative, and very large must be rejected
    - **Validates: Requirements 1.2**

  - [x] 10.4 Implement Google OAuth routes
    - Create `app/api/ai-automation/google/connect/route.ts` — build Google OAuth authorization URL with `calendar` scope and redirect to it
    - Create `app/api/ai-automation/google/callback/route.ts` — exchange authorization code for tokens, store `refresh_token` in `ai_automation_config`, redirect to settings page
    - _Requirements: 1.3, 6.1_

- [x] 11. API routes — conversation AI controls
  - [x] 11.1 Implement `PATCH /api/ai-automation/conversations/[id]/toggle`
    - Create `app/api/ai-automation/conversations/[id]/toggle/route.ts`
    - Require authenticated session and paid billing entitlement (return 402 for free plan)
    - When enabling: check `gcal_refresh_token` exists (return 400 if not); count inbound messages; set `ai_enabled = true`, `ai_status = 'active'` if inbound count > 0 else `'idle'`
    - When disabling: set `ai_enabled = false`, `ai_status = 'paused'`
    - _Requirements: 1.3, 2.2, 2.3, 9.1, 9.2_

  - [ ]* 11.2 Write property test for AI enable status logic (P3)
    - **Property 3: AI enable sets correct initial status** — for any `fc.record({ hasInbound: fc.boolean() })`, assert enabling AI sets `ai_status = 'active'` when `hasInbound = true` and `'idle'` when `hasInbound = false`
    - **Validates: Requirements 2.2**

  - [x] 11.3 Implement `POST /api/ai-automation/conversations/[id]/takeover`
    - Create `app/api/ai-automation/conversations/[id]/takeover/route.ts`
    - Atomically set `ai_status = 'paused'` and cancel pending jobs (`UPDATE ai_reply_jobs SET status = 'failed' WHERE conversation_id = ? AND status = 'pending'`) in a single transaction
    - _Requirements: 8.1, 8.2_

  - [x] 11.4 Implement `POST /api/ai-automation/conversations/[id]/resume`
    - Create `app/api/ai-automation/conversations/[id]/resume/route.ts`
    - Set `ai_status = 'active'`; do NOT create jobs for messages that arrived during the paused period (only future inbound messages will trigger jobs)
    - _Requirements: 8.3, 8.5_

  - [x] 11.5 Implement `GET /api/ai-automation/conversations/[id]/logs`
    - Create `app/api/ai-automation/conversations/[id]/logs/route.ts`
    - Require authenticated session; verify the conversation belongs to the requesting user
    - Return `ai_automation_logs` for the conversation ordered by `created_at DESC`
    - _Requirements: 10.3_

  - [x] 11.6 Extend `POST /api/messages/send` to trigger takeover on manual send
    - In `app/api/messages/send/route.ts`, after sending the message, if the conversation has `ai_status = 'active'`, atomically set `ai_status = 'paused'` and cancel pending AI jobs before returning
    - _Requirements: 8.1_

- [x] 12. Billing webhook — pause AI on subscription downgrade
  - [x] 12.1 Extend billing webhook to pause active AI conversations
    - In `app/api/billing/webhook/route.ts`, when a subscription transitions to `inactive` or `canceled`, query all conversations for that user where `ai_status = 'active'` and bulk-update them to `ai_status = 'paused'`
    - _Requirements: 9.3_

- [x] 13. Checkpoint — backend complete
  - Ensure all non-optional tests pass. Verify all API routes return correct status codes for auth, billing, and validation errors. Ask the user if questions arise.

- [x] 14. MessagesInbox UI updates (`components/messages/MessagesInbox.tsx`)
  - [x] 14.1 Extend conversation data types and fetch AI status
    - Add `ai_enabled`, `ai_status` to the `ConversationSummary` and `ConversationDetails` local interfaces
    - Ensure the conversations API response includes these fields
    - _Requirements: 2.4_

  - [x] 14.2 Add AI toggle control to conversation list item
    - In `ConvItem`, add a small toggle switch that calls `PATCH /api/ai-automation/conversations/[id]/toggle`
    - Show a loading spinner while the toggle request is in flight
    - _Requirements: 2.4_

  - [x] 14.3 Add AI status indicator to chat header
    - In the chat header, display the current `ai_status` as a colored badge (`active` = green, `paused` = yellow, `error` = red, `completed` = gray)
    - When `ai_status = 'error'`, show a human-readable error description fetched from the latest `ai_automation_logs` entry
    - _Requirements: 2.4, 10.2_

  - [x] 14.4 Add "Take over" and "Resume AI" buttons to chat header
    - When `ai_status = 'active'`: show "Take over" button that calls `POST /api/ai-automation/conversations/[id]/takeover`
    - When `ai_status = 'paused'`: show "Resume AI" button that calls `POST /api/ai-automation/conversations/[id]/resume`
    - _Requirements: 8.2, 8.3_

  - [x] 14.5 Add AI message badge to `MessageBubble`
    - Extend `MessageItem` interface with `metadata?: { source?: string }`
    - In `MessageBubble`, when `msg.metadata?.source === 'ai_agent'`, render a small "AI" badge below the bubble timestamp
    - _Requirements: 2.5, 4.7_

  - [ ]* 14.6 Write property test for AI message badge rendering (P4)
    - **Property 4: AI message indicator is always present for AI-sourced messages** — for any message record where `metadata.source === 'ai_agent'`, assert the rendered `MessageBubble` contains an AI indicator element; for any other source value, assert no indicator is rendered
    - **Validates: Requirements 2.5, 4.7**

- [x] 15. Settings page UI for AI automation config (`app/dashboard/settings/page.tsx`)
  - [x] 15.1 Add AI Automation section to settings page
    - Fetch `GET /api/ai-automation/config` on mount
    - Render form fields: persona (textarea), meeting objective (textarea), meeting duration (number input, 15–120), timezone (select), default AI enabled (toggle)
    - On save, call `PATCH /api/ai-automation/config`; show validation error if duration is out of range
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 15.2 Add Google Calendar connection UI
    - Show "Connect Google Calendar" button that navigates to `GET /api/ai-automation/google/connect`
    - When `gcal_connected = true`, show "Connected" status and a "Disconnect" option
    - When `gcal_token_error = true`, show an error banner prompting the user to reconnect
    - _Requirements: 1.3, 6.6_

  - [ ]* 15.3 Write property test for config round-trip (P1)
    - **Property 1: Config round-trip preserves all fields** — for any valid `AIAutomationConfig` object written via the PATCH endpoint, assert reading it back via GET returns identical values for `persona`, `meeting_objective`, `meeting_duration_min`, `timezone`, `default_ai_enabled`, `gcal_token_error`
    - **Validates: Requirements 1.1**

- [x] 16. Final checkpoint — Ensure all tests pass
  - Run the full test suite. Verify all property-based tests execute at least 100 iterations each. Ensure all non-optional sub-tasks are complete and integrated. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests use [fast-check](https://github.com/dubzzz/fast-check) and must be tagged with `// Feature: ai-inbox-automation, Property N: <property_text>`
- Each property test runs a minimum of 100 iterations
- The `gcal_refresh_token` must never be returned in API responses — use `gcal_connected: boolean` as a proxy
- The partial unique index `idx_ai_reply_jobs_one_pending` enforces the one-pending-job-per-conversation invariant at the DB level; the application layer should rely on this rather than application-level locking
- The worker cleanup pass (reset `processing` jobs stuck > 10 min) must run before the main job polling loop
- All AI reply jobs use the existing Redis lock manager (`lib/redis/lock-manager.ts`) with key `ai_reply_job:{jobId}` and TTL 5 minutes
