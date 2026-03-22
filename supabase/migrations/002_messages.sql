-- Messaging module (conversations + messages + sync state)

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  external_conversation_id TEXT,
  last_external_message_id TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(linkedin_account_id, lead_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  external_message_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('linkedin_account', 'lead')),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  content_text TEXT NOT NULL,
  content_html TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, external_message_id)
);

CREATE TABLE IF NOT EXISTS message_sync_state (
  linkedin_account_id UUID PRIMARY KEY REFERENCES linkedin_accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  last_sync_cursor TEXT,
  last_synced_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_account_id ON conversations(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_state_user_id ON message_sync_state(user_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversations" ON conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own messages" ON messages
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own message_sync_state" ON message_sync_state
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Service role full access conversations" ON conversations
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access messages" ON messages
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access message_sync_state" ON message_sync_state
  FOR ALL TO service_role USING (true);

-- Ensure trigger function exists even when this migration is run in isolation
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
DROP TRIGGER IF EXISTS update_message_sync_state_updated_at ON message_sync_state;

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_sync_state_updated_at BEFORE UPDATE ON message_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
