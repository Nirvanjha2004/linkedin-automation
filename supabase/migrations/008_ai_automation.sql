-- Per-user AI automation configuration
CREATE TABLE ai_automation_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  persona               TEXT NOT NULL DEFAULT '',
  meeting_objective     TEXT NOT NULL DEFAULT '',
  gcal_refresh_token    TEXT,           -- encrypted at rest via Supabase Vault or app-level AES
  gcal_token_error      BOOLEAN NOT NULL DEFAULT FALSE,
  meeting_duration_min  INTEGER NOT NULL DEFAULT 30
                          CHECK (meeting_duration_min >= 15 AND meeting_duration_min <= 120),
  timezone              TEXT NOT NULL DEFAULT 'UTC',
  default_ai_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending AI reply jobs (polled by worker)
CREATE TABLE ai_reply_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trigger_message_id    TEXT NOT NULL,  -- external_message_id of the inbound trigger
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retry_count           INTEGER NOT NULL DEFAULT 0,
  execute_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, status) -- partial unique enforced via partial index below
);

-- Partial unique index: at most one pending job per conversation
CREATE UNIQUE INDEX idx_ai_reply_jobs_one_pending
  ON ai_reply_jobs(conversation_id)
  WHERE status = 'pending';

-- Execution audit log
CREATE TABLE ai_automation_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trigger_message_id    TEXT,
  generated_reply       TEXT,
  status                TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'error')),
  error_message         TEXT,
  booking_stage         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_ai_reply_jobs_status_execute ON ai_reply_jobs(status, execute_at)
  WHERE status = 'pending';
CREATE INDEX idx_ai_reply_jobs_conversation ON ai_reply_jobs(conversation_id);
CREATE INDEX idx_ai_automation_logs_conversation ON ai_automation_logs(conversation_id);
CREATE INDEX idx_ai_automation_config_user ON ai_automation_config(user_id);

-- RLS
ALTER TABLE ai_automation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_reply_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ai_automation_config" ON ai_automation_config
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role full access ai_automation_config" ON ai_automation_config
  FOR ALL TO service_role USING (true);

CREATE POLICY "Users view own ai_reply_jobs" ON ai_reply_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access ai_reply_jobs" ON ai_reply_jobs
  FOR ALL TO service_role USING (true);

CREATE POLICY "Users view own ai_automation_logs" ON ai_automation_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access ai_automation_logs" ON ai_automation_logs
  FOR ALL TO service_role USING (true);
