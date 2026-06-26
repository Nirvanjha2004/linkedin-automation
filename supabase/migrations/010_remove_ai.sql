-- Remove AI tables and columns
DROP TABLE IF EXISTS ai_automation_logs;
DROP TABLE IF EXISTS ai_reply_jobs;
DROP TABLE IF EXISTS ai_automation_config;

ALTER TABLE conversations
  DROP COLUMN IF EXISTS ai_enabled,
  DROP COLUMN IF EXISTS ai_status,
  DROP COLUMN IF EXISTS ai_booking_stage;
