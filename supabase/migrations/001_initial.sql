-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- LinkedIn Accounts table
CREATE TABLE IF NOT EXISTS linkedin_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  unipile_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  profile_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, unipile_account_id)
);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  linkedin_account_id UUID REFERENCES linkedin_accounts(id) ON DELETE RESTRICT,
  schedule JSONB NOT NULL DEFAULT '{
    "time_windows": [{"start_time": "09:00", "end_time": "17:00"}],
    "days_of_week": [1,2,3,4,5],
    "timezone": "UTC"
  }',
  message_templates JSONB NOT NULL DEFAULT '{}',
  priority INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  daily_limit INTEGER DEFAULT 20,
  total_limit INTEGER,
  actions_today INTEGER DEFAULT 0,
  actions_total INTEGER DEFAULT 0,
  last_reset_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  linkedin_url TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  company TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  custom_fields JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending','connection_sent','connected','message_sent',
    'replied','followup_sent','completed','failed','skipped'
  )),
  connection_sent_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  message_sent_at TIMESTAMPTZ,
  follow_up_1_sent_at TIMESTAMPTZ,
  follow_up_2_sent_at TIMESTAMPTZ,
  last_action_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, linkedin_url)
);

-- Action Queue table
CREATE TABLE IF NOT EXISTS action_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('connect','message','follow_up')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','skipped')),
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Action Logs table (audit trail)
CREATE TABLE IF NOT EXISTS action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_linkedin_account ON campaigns(linkedin_account_id);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_action_queue_campaign_id ON action_queue(campaign_id);
CREATE INDEX IF NOT EXISTS idx_action_queue_status ON action_queue(status);
CREATE INDEX IF NOT EXISTS idx_action_queue_scheduled ON action_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_action_logs_campaign_id ON action_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_user_id ON linkedin_accounts(user_id);

-- Row Level Security
ALTER TABLE linkedin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage own linkedin_accounts" ON linkedin_accounts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own campaigns" ON campaigns
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage leads in own campaigns" ON leads
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view action_queue for own campaigns" ON action_queue
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can view action_logs for own campaigns" ON action_logs
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  );

-- Service role bypass (for API routes)
CREATE POLICY "Service role full access linkedin_accounts" ON linkedin_accounts
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access campaigns" ON campaigns
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access leads" ON leads
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access action_queue" ON action_queue
  FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access action_logs" ON action_logs
  FOR ALL TO service_role USING (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_linkedin_accounts_updated_at BEFORE UPDATE ON linkedin_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Daily actions reset function (called by scheduler)
CREATE OR REPLACE FUNCTION reset_daily_action_counts()
RETURNS void AS $$
BEGIN
  UPDATE campaigns 
  SET actions_today = 0, last_reset_date = CURRENT_DATE
  WHERE last_reset_date < CURRENT_DATE OR last_reset_date IS NULL;
END;
$$ language 'plpgsql';
