-- Add enrichment columns to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS provider_id TEXT,
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS profile_pic_url TEXT,
  ADD COLUMN IF NOT EXISTS public_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_provider_id ON leads(provider_id);
