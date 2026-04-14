# Requirements Document

## Introduction

This feature adds an AI-powered inbox automation layer to the existing LinkedIn messaging inbox. When a lead replies to a LinkedIn message, an AI agent automatically takes over the conversation: it reads the full conversation history and lead context, generates contextual replies, qualifies the lead, proposes available Google Calendar slots, and books a meeting once the lead confirms a time. Users can pause the AI at any point and resume manual control from the existing `MessagesInbox` UI.

The feature integrates with the existing message sync pipeline (`lib/linkedin/message-sync.ts`), the worker/scheduler infrastructure (`app/api/worker/route.ts`, `app/api/scheduler-v2/route.ts`), Supabase for persistence, and the billing/entitlement system (`lib/billing/`).

---

## Glossary

- **AI_Agent**: The automated conversational component that reads conversation history, generates replies, and drives the meeting-booking flow on behalf of the user.
- **Conversation**: An existing record in the `conversations` table linking a LinkedIn account, a lead, and a thread of messages.
- **Lead**: A prospect record in the `leads` table, enriched with profile data and tracked through a status lifecycle.
- **Inbox_Automation**: The per-conversation setting that enables or disables the AI_Agent for a given Conversation.
- **Takeover_Mode**: A state in which the AI_Agent is paused and the human user has manual control of a Conversation.
- **Google_Calendar**: The external calendar service used to fetch available time slots and create meeting events.
- **Booking_Flow**: The multi-turn sub-process in which the AI_Agent proposes time slots, the lead selects one, and a calendar event is created.
- **Slot**: A specific date-and-time interval fetched from Google_Calendar that is available for a meeting.
- **Confirmation_Message**: A LinkedIn message sent by the AI_Agent after a meeting is successfully booked, summarising the meeting details.
- **AI_Automation_Config**: A per-user configuration record that stores the AI persona, meeting objective, Google Calendar credentials, and default automation settings.
- **Sync_Pipeline**: The existing `syncMessagesForUser` function in `lib/linkedin/message-sync.ts` that pulls new messages from LinkedIn into the `messages` table.
- **Action_Queue**: The existing `action_queue` table and worker (`app/api/worker/route.ts`) that executes outbound LinkedIn actions by polling for ready records.
- **AI_Reply_Jobs**: A dedicated `ai_reply_jobs` table that stores pending AI reply jobs. The existing Vercel Cron-driven scheduler (`app/api/scheduler-v2/route.ts`) and worker (`app/api/worker/route.ts`) poll this table on each run (approximately every 3 minutes) to pick up and execute pending jobs.
- **Redis_Lock_Manager**: The `lib/redis/lock-manager.ts` utility that provides distributed locking and rate-limit tracking via Redis, used to prevent duplicate job execution across concurrent cron runs.

---

## Requirements

### Requirement 1: AI Automation Configuration

**User Story:** As a user, I want to configure the AI agent's persona, meeting objective, and Google Calendar connection, so that the AI can represent me accurately and book meetings on my behalf.

#### Acceptance Criteria

1. THE AI_Automation_Config SHALL store, per user: an AI persona description, a meeting objective description, a Google Calendar OAuth refresh token, a target meeting duration in minutes, and a default enabled/disabled state for new conversations.
2. WHEN a user saves an AI_Automation_Config, THE System SHALL validate that the meeting duration is between 15 and 120 minutes inclusive.
3. IF a user attempts to enable Inbox_Automation without a connected Google_Calendar, THEN THE System SHALL return an error message indicating that Google Calendar must be connected first.
4. THE System SHALL expose a settings API endpoint that allows authenticated users to read and update their AI_Automation_Config.
5. WHERE a user has not yet created an AI_Automation_Config, THE System SHALL treat Inbox_Automation as disabled for all Conversations belonging to that user.

---

### Requirement 2: Per-Conversation Automation Toggle

**User Story:** As a user, I want to enable or disable the AI agent per conversation, so that I can choose which leads the AI handles and which ones I manage manually.

#### Acceptance Criteria

1. THE System SHALL add an `ai_enabled` boolean field and an `ai_status` field to the `conversations` table, where `ai_status` can be one of: `idle`, `active`, `paused`, `completed`, `error`.
2. WHEN a user sets `ai_enabled` to true for a Conversation, THE System SHALL set `ai_status` to `active` if the Conversation has at least one inbound message, otherwise `idle`.
3. WHEN a user sets `ai_enabled` to false for a Conversation, THE System SHALL set `ai_status` to `paused` and enter Takeover_Mode for that Conversation.
4. THE MessagesInbox UI SHALL display the current `ai_status` for each Conversation and provide a toggle control to enable or disable Inbox_Automation.
5. WHILE `ai_status` is `active`, THE MessagesInbox UI SHALL display a visual indicator distinguishing AI-generated messages from manually sent messages.

---

### Requirement 3: Inbound Message Trigger

**User Story:** As a user, I want the AI agent to be triggered automatically when a lead replies, so that no inbound message goes unanswered while automation is enabled.

#### Acceptance Criteria

1. WHEN the Sync_Pipeline inserts a new inbound message into the `messages` table for a Conversation where `ai_enabled` is true and `ai_status` is `active`, THE System SHALL insert a pending job record into the `ai_reply_jobs` table, which the scheduler/worker will pick up on its next scheduled run (approximately every 3 minutes).
2. THE AI reply job record SHALL include: the `conversation_id`, the `user_id`, the `external_message_id` of the triggering inbound message, a `status` of `pending`, a `retry_count` of 0, and a `created_at` timestamp.
3. IF the Sync_Pipeline detects a new inbound message for a Conversation where `ai_status` is `paused` or `completed`, THEN THE System SHALL not insert an AI reply job record.
4. THE System SHALL deduplicate AI reply jobs so that at most one pending job record exists per Conversation at any given time.

---

### Requirement 4: AI Conversation Handler

**User Story:** As a user, I want the AI agent to read the full conversation history and lead context before replying, so that its responses are relevant and personalised.

#### Acceptance Criteria

1. WHEN the AI_Agent processes a reply job, THE AI_Agent SHALL fetch the full message history for the Conversation ordered by `sent_at` ascending.
2. WHEN the AI_Agent processes a reply job, THE AI_Agent SHALL fetch the Lead record associated with the Conversation, including: `full_name`, `first_name`, `company`, `title`, `headline`, and `location`.
3. WHEN the AI_Agent processes a reply job, THE AI_Agent SHALL fetch the user's AI_Automation_Config to obtain the persona description and meeting objective.
4. THE AI_Agent SHALL construct a prompt that includes the persona description, meeting objective, lead profile data, and full conversation history, and submit it to an LLM API to generate a reply.
5. WHEN the LLM API returns a reply, THE AI_Agent SHALL send the reply as an outbound LinkedIn message via the existing send-message infrastructure within 60 seconds of receiving the inbound trigger.
6. IF the LLM API returns an error or times out after 30 seconds, THEN THE AI_Agent SHALL set `ai_status` to `error` for the Conversation and NOT send any message.
7. THE AI_Agent SHALL store each generated reply in the `messages` table with a `metadata` field containing `{ "source": "ai_agent" }` to distinguish it from manually sent messages.

---

### Requirement 5: Lead Qualification

**User Story:** As a user, I want the AI agent to qualify leads during the conversation, so that I only book meetings with leads who meet my criteria.

#### Acceptance Criteria

1. THE AI_Agent SHALL evaluate each inbound message to determine whether the lead has expressed interest in scheduling a meeting, based on the conversation context and the user's meeting objective.
2. WHEN the AI_Agent determines that the lead is ready to book a meeting, THE AI_Agent SHALL transition the Booking_Flow to the slot-proposal stage.
3. WHEN the AI_Agent determines that the lead is not interested or has explicitly declined, THE AI_Agent SHALL set `ai_status` to `completed` for the Conversation and send a polite closing message.
4. THE AI_Agent SHALL NOT transition to the Booking_Flow until the lead has sent at least one inbound message expressing interest.
5. IF the AI_Agent has sent 5 or more outbound messages in a Conversation without the lead expressing interest, THEN THE AI_Agent SHALL set `ai_status` to `completed` and stop sending further messages.

---

### Requirement 6: Google Calendar Integration

**User Story:** As a user, I want the AI agent to fetch my real availability from Google Calendar, so that it only proposes times when I am actually free.

#### Acceptance Criteria

1. THE System SHALL implement a Google_Calendar client that uses the stored OAuth refresh token to obtain a valid access token before each API call.
2. WHEN the Booking_Flow reaches the slot-proposal stage, THE Google_Calendar client SHALL query the user's primary calendar for free/busy information over the next 7 calendar days.
3. THE Google_Calendar client SHALL return a list of available Slots, where each Slot is a contiguous free interval of exactly the configured meeting duration, falling within the hours 08:00–18:00 in the user's configured timezone.
4. THE AI_Agent SHALL propose a maximum of 3 Slots to the lead in a single message, formatted as human-readable date and time strings.
5. IF the Google_Calendar client returns fewer than 1 available Slot, THEN THE AI_Agent SHALL inform the lead that no slots are currently available and ask them to check back in a few days.
6. IF the Google_Calendar OAuth token is expired and cannot be refreshed, THEN THE System SHALL set `ai_status` to `error` for the Conversation and notify the user via a flag on the AI_Automation_Config record.

---

### Requirement 7: Meeting Booking Flow

**User Story:** As a user, I want the AI agent to book a meeting on Google Calendar once the lead picks a time slot, so that the meeting is confirmed without any manual action from me.

#### Acceptance Criteria

1. WHEN the lead replies with a message selecting one of the proposed Slots, THE AI_Agent SHALL parse the lead's selection and identify the corresponding Slot.
2. WHEN a Slot is identified from the lead's reply, THE Google_Calendar client SHALL create a calendar event with: the meeting title derived from the AI_Automation_Config meeting objective, the lead's name and LinkedIn URL in the event description, the start and end times of the selected Slot, and the user as the event organiser.
3. WHEN the calendar event is successfully created, THE AI_Agent SHALL send a Confirmation_Message to the lead via LinkedIn containing the meeting date, time, and a summary of the next steps.
4. WHEN the calendar event is successfully created, THE System SHALL set `ai_status` to `completed` for the Conversation and update the Lead `status` to `completed`.
5. IF the Google_Calendar client fails to create the event, THEN THE AI_Agent SHALL inform the lead that there was a scheduling issue and propose the same Slots again.
6. THE Booking_Flow SHALL handle the case where the lead's reply is ambiguous by asking the lead to clarify which Slot they prefer before attempting to create an event.

---

### Requirement 8: Human Takeover Mode

**User Story:** As a user, I want to pause the AI and take over a conversation manually at any time, so that I can handle sensitive or complex situations myself.

#### Acceptance Criteria

1. WHEN a user sends a manual message in a Conversation where `ai_status` is `active`, THE System SHALL automatically set `ai_status` to `paused` and cancel any pending AI reply job for that Conversation.
2. THE MessagesInbox UI SHALL provide a "Take over" button that sets `ai_status` to `paused` for the active Conversation without requiring the user to send a message.
3. WHEN `ai_status` is `paused`, THE MessagesInbox UI SHALL display a "Resume AI" button that sets `ai_status` back to `active` and re-enables automatic AI replies for subsequent inbound messages.
4. WHILE `ai_status` is `paused`, THE System SHALL NOT enqueue any AI reply jobs for that Conversation, even if new inbound messages arrive.
5. WHEN a user resumes AI automation for a Conversation, THE System SHALL NOT retroactively reply to inbound messages that arrived during the paused period.

---

### Requirement 9: Billing Entitlement for AI Automation

**User Story:** As a user, I want AI inbox automation to be gated behind the paid plan, so that the feature is sustainable and appropriately monetised.

#### Acceptance Criteria

1. WHEN a user on the free plan attempts to enable Inbox_Automation for any Conversation, THE System SHALL return an error indicating that AI inbox automation requires a paid subscription.
2. WHEN a user on the paid plan enables Inbox_Automation, THE System SHALL allow the operation without restriction.
3. IF a user's subscription transitions from paid to inactive or canceled while one or more Conversations have `ai_status` of `active`, THEN THE System SHALL set `ai_status` to `paused` for all such Conversations.
4. THE System SHALL check entitlement at the time of each AI reply job execution and skip the job if the user no longer has a paid subscription.

---

### Requirement 10: Observability and Error Handling

**User Story:** As a user, I want to see the status of the AI agent per conversation and be notified of errors, so that I can intervene when something goes wrong.

#### Acceptance Criteria

1. THE System SHALL record each AI reply job execution in an `ai_automation_logs` table with: `conversation_id`, `user_id`, `trigger_message_id`, `generated_reply`, `status` (one of `sent`, `skipped`, `error`), `error_message`, and `created_at`.
2. WHEN `ai_status` is set to `error` for a Conversation, THE MessagesInbox UI SHALL display an error indicator on that Conversation and a human-readable error description.
3. THE System SHALL expose an API endpoint that returns the `ai_automation_logs` for a given Conversation, accessible only to the authenticated owner of that Conversation.
4. IF an AI reply job fails, THE System SHALL increment the `retry_count` column on the `ai_reply_jobs` record and reschedule it with exponential backoff (2^retry_count minutes). WHEN `retry_count` reaches 3, THE System SHALL set `ai_status` to `error` for the Conversation and log the final error message in `ai_automation_logs`.
