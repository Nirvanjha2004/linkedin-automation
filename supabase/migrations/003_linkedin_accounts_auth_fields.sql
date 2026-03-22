-- Align linkedin_accounts schema with LinkedIn cookie-based auth flow

ALTER TABLE linkedin_accounts
  ADD COLUMN IF NOT EXISTS li_at TEXT,
  ADD COLUMN IF NOT EXISTS jsessionid TEXT,
  ADD COLUMN IF NOT EXISTS profile_urn TEXT,
  ADD COLUMN IF NOT EXISTS vanity_name TEXT;

-- Legacy unipile field is no longer required for LinkedIn cookie accounts
ALTER TABLE linkedin_accounts
  ALTER COLUMN unipile_account_id DROP NOT NULL;

-- Ensure one LinkedIn profile per user account record when profile_urn is present
CREATE UNIQUE INDEX IF NOT EXISTS idx_linkedin_accounts_user_profile_urn
  ON linkedin_accounts(user_id, profile_urn)
  WHERE profile_urn IS NOT NULL;

-- Helpful for account lookups by URN
CREATE INDEX IF NOT EXISTS idx_linkedin_accounts_profile_urn
  ON linkedin_accounts(profile_urn);
