import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Platform default — matches the constant in scheduler-v2 */
const DEFAULT_DAILY_CONNECTION_LIMIT = 20;

// GET /api/accounts - List LinkedIn accounts with live daily invite stats
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: accounts, error } = await supabase
      .from('linkedin_accounts')
      .select('id, user_id, name, email, profile_url, vanity_name, is_active, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!accounts?.length) return NextResponse.json({ accounts: [] });

    const accountIds = accounts.map((a) => a.id);

    // ── Midnight UTC (start of today) ──────────────────────────────────────
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    // ── Batch 1: count completed connection_requests today per account ──────
    // Fetch all matching rows and count in JS — Supabase doesn't expose GROUP BY,
    // but this is fine since a user typically has fewer than 20 accounts.
    const { data: todayActions } = await supabase
      .from('action_queue')
      .select('account_id')
      .in('account_id', accountIds)
      .eq('type', 'connection_request')
      .eq('status', 'completed')
      .gte('executed_at', todayStart);

    const sentTodayMap: Record<string, number> = {};
    for (const id of accountIds) sentTodayMap[id] = 0;
    for (const row of todayActions ?? []) {
      if (row.account_id) {
        sentTodayMap[row.account_id] = (sentTodayMap[row.account_id] ?? 0) + 1;
      }
    }

    // ── Batch 2: daily_limit per account (min across active campaigns) ──────
    const { data: campaignLimits } = await supabase
      .from('campaigns')
      .select('linkedin_account_id, daily_limit')
      .in('linkedin_account_id', accountIds)
      .eq('status', 'active');

    const limitMap: Record<string, number> = {};
    for (const id of accountIds) limitMap[id] = DEFAULT_DAILY_CONNECTION_LIMIT;
    for (const c of campaignLimits ?? []) {
      if (c.linkedin_account_id) {
        limitMap[c.linkedin_account_id] = Math.min(
          limitMap[c.linkedin_account_id],
          c.daily_limit ?? DEFAULT_DAILY_CONNECTION_LIMIT
        );
      }
    }

    // ── Merge stats into each account ──────────────────────────────────────
    const enriched = accounts.map((a) => ({
      ...a,
      daily_invites_sent: sentTodayMap[a.id] ?? 0,
      daily_limit: limitMap[a.id] ?? DEFAULT_DAILY_CONNECTION_LIMIT,
    }));

    return NextResponse.json({ accounts: enriched });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/accounts — deprecated. Use POST /api/accounts/connect instead.
export async function POST() {
  return NextResponse.json(
    { error: 'deprecated', message: 'Use POST /api/accounts/connect with your li_at cookie instead.' },
    { status: 410 }
  );
}