-- Billing: user_subscriptions table
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Plan state
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'paid')),
  subscription_status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (subscription_status IN ('inactive', 'active', 'past_due', 'canceled')),

  -- Stripe references
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,

  -- Billing cycle tracking
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Account usage counters (anti-abuse peak tracking)
  current_accounts INTEGER NOT NULL DEFAULT 0,
  peak_accounts INTEGER NOT NULL DEFAULT 0,

  -- Grace period after payment failure
  grace_period_ends_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at trigger
CREATE TRIGGER update_user_subscriptions_updated_at
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscription row
CREATE POLICY "Users can read own subscription" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role has full access (used by API routes and webhook handler)
CREATE POLICY "Service role full access user_subscriptions" ON user_subscriptions
  FOR ALL TO service_role USING (true);

-- Index for fast lookups by stripe_customer_id (used in webhook handler)
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer
  ON user_subscriptions(stripe_customer_id);
