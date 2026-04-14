-- Track when a lead first replied so analytics can measure reply latency
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_replied_at ON leads(replied_at)
  WHERE replied_at IS NOT NULL;
