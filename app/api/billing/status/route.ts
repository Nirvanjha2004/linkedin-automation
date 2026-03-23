import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSubscription } from '@/lib/billing/entitlement';
import { PAID_PLAN_PRICING } from '@/lib/billing/constants';
import { BillingStatus } from '@/types';

// GET /api/billing/status
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sub = await getSubscription(user.id);

    const extraAccounts = Math.max(0, sub.peak_accounts - PAID_PLAN_PRICING.BASE_ACCOUNTS_INCLUDED);
    const estimatedNextInvoice = extraAccounts * PAID_PLAN_PRICING.PRICE_PER_EXTRA_ACCOUNT;

    const status: BillingStatus = {
      plan: sub.plan,
      subscription_status: sub.subscription_status,
      current_accounts: sub.current_accounts,
      peak_accounts: sub.peak_accounts,
      estimated_next_invoice: estimatedNextInvoice,
      grace_period_ends_at: sub.grace_period_ends_at ?? undefined,
      current_period_end: sub.current_period_end ?? undefined,
    };

    return NextResponse.json(status);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
