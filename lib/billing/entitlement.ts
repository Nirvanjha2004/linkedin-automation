import { createAdminClient } from '@/lib/supabase/server';
import { UserSubscription } from '@/types';
import { FREE_PLAN_LIMITS, PAID_PLAN_PRICING, GRACE_PERIOD_DAYS } from './constants';

export type EntitlementResult =
  | { allowed: true }
  | { allowed: false; reason: string; upgrade_required: true; estimated_monthly_cost: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimatedMonthlyCost(peakAfterAction: number): number {
  const extra = Math.max(0, peakAfterAction - PAID_PLAN_PRICING.BASE_ACCOUNTS_INCLUDED);
  return extra * PAID_PLAN_PRICING.PRICE_PER_EXTRA_ACCOUNT;
}

function isGraceExpired(gracePeriodEndsAt?: string | null): boolean {
  if (!gracePeriodEndsAt) return true;
  return new Date(gracePeriodEndsAt) <= new Date();
}

// ── Core subscription access ──────────────────────────────────────────────────

/**
 * Fetches the user's subscription row, auto-creating a free default if none exists.
 */
export async function getSubscription(userId: string): Promise<UserSubscription> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Row not found — create free default
    const { data: created, error: insertError } = await supabase
      .from('user_subscriptions')
      .insert({ user_id: userId })
      .select('*')
      .single();

    if (insertError) throw new Error(`Failed to create subscription: ${insertError.message}`);
    return created as UserSubscription;
  }

  if (error) throw new Error(`Failed to fetch subscription: ${error.message}`);
  return data as UserSubscription;
}

// ── Effective plan check ──────────────────────────────────────────────────────

/**
 * Returns true if the user has full paid access:
 * - status is 'active', OR
 * - status is 'past_due' AND grace period has not yet expired
 */
export function isEffectivelyPaid(sub: UserSubscription): boolean {
  if (sub.subscription_status === 'active') return true;
  if (sub.subscription_status === 'past_due' && !isGraceExpired(sub.grace_period_ends_at)) {
    return true;
  }
  return false;
}

// ── Entitlement checks ────────────────────────────────────────────────────────

export async function checkCampaignCreate(userId: string): Promise<EntitlementResult> {
  const sub = await getSubscription(userId);
  if (isEffectivelyPaid(sub)) return { allowed: true };

  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to count campaigns: ${error.message}`);

  if ((count ?? 0) >= FREE_PLAN_LIMITS.MAX_CAMPAIGNS) {
    return {
      allowed: false,
      reason: `Free plan allows a maximum of ${FREE_PLAN_LIMITS.MAX_CAMPAIGNS} campaign.`,
      upgrade_required: true,
      estimated_monthly_cost: estimatedMonthlyCost(sub.current_accounts + 1),
    };
  }

  return { allowed: true };
}

export async function checkLeadUpload(userId: string, newLeadCount: number): Promise<EntitlementResult> {
  const sub = await getSubscription(userId);
  if (isEffectivelyPaid(sub)) return { allowed: true };

  const supabase = createAdminClient();

  // Fetch campaign IDs for this user first
  const { data: campaigns, error: campError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('user_id', userId);

  if (campError) throw new Error(`Failed to fetch campaigns: ${campError.message}`);

  const campaignIds = (campaigns ?? []).map((c: { id: string }) => c.id);

  if (campaignIds.length === 0) return { allowed: true };

  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .in('campaign_id', campaignIds);

  if (error) throw new Error(`Failed to count leads: ${error.message}`);

  const currentTotal = count ?? 0;
  if (currentTotal + newLeadCount > FREE_PLAN_LIMITS.MAX_LEADS) {
    return {
      allowed: false,
      reason: `Free plan allows a maximum of ${FREE_PLAN_LIMITS.MAX_LEADS} leads total. You currently have ${currentTotal}.`,
      upgrade_required: true,
      estimated_monthly_cost: estimatedMonthlyCost(sub.current_accounts + 1),
    };
  }

  return { allowed: true };
}

export async function checkAccountConnect(userId: string): Promise<EntitlementResult> {
  const sub = await getSubscription(userId);
  if (isEffectivelyPaid(sub)) return { allowed: true };

  if (sub.current_accounts >= FREE_PLAN_LIMITS.MAX_ACCOUNTS) {
    return {
      allowed: false,
      reason: `Free plan allows a maximum of ${FREE_PLAN_LIMITS.MAX_ACCOUNTS} connected LinkedIn account.`,
      upgrade_required: true,
      estimated_monthly_cost: estimatedMonthlyCost(sub.current_accounts + 1),
    };
  }

  return { allowed: true };
}

// ── Account counter mutations ─────────────────────────────────────────────────

/**
 * Increments or decrements current_accounts.
 * On +1: also updates peak_accounts = max(peak_accounts, new current_accounts).
 * On -1: peak_accounts is never reduced (anti-abuse).
 */
export async function updateAccountCounters(userId: string, delta: 1 | -1): Promise<void> {
  const supabase = createAdminClient();
  const sub = await getSubscription(userId);

  const newCurrent = Math.max(0, sub.current_accounts + delta);
  const newPeak = delta === 1
    ? Math.max(sub.peak_accounts, newCurrent)
    : sub.peak_accounts; // peak never decreases

  const { error } = await supabase
    .from('user_subscriptions')
    .update({ current_accounts: newCurrent, peak_accounts: newPeak })
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to update account counters: ${error.message}`);
}
