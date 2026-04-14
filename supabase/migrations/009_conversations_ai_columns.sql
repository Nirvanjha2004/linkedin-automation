ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_status        TEXT NOT NULL DEFAULT 'idle'
    CHECK (ai_status IN ('idle', 'active', 'paused', 'completed', 'error')),
  ADD COLUMN IF NOT EXISTS ai_booking_stage TEXT NOT NULL DEFAULT 'qualifying'
    CHECK (ai_booking_stage IN ('qualifying', 'slot_proposal', 'slot_confirmation', 'done'));

CREATE INDEX IF NOT EXISTS idx_conversations_ai_status
  ON conversations(ai_status) WHERE ai_enabled = TRUE;
