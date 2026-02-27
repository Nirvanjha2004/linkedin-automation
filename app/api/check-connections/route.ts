import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getUnipileClient } from '@/lib/unipile/client';

/**
 * POST /api/check-connections
 *
 * For each active LinkedIn account:
 *  1. Fetch last 20 accepted relations from Unipile (1 API call per account)
 *  2. Load all connection_sent leads for that account from DB (1 DB query)
 *  3. Cross-reference in memory using provider_id — no extra API calls
 *  4. Mark matched leads as connected
 *
 * Run via cron every 20 minutes.
 */
export async function POST() {
  const supabase = createAdminClient();
  const unipile = getUnipileClient();
  const currentTime = new Date();

  try {
    // 1. Get all active LinkedIn accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('linkedin_accounts')
      .select('id, unipile_account_id')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accounts?.length) {
      return NextResponse.json({ message: 'No active accounts', updated: 0 });
    }

    let totalUpdated = 0;
    const results: { accountId: string; checked: number; accepted: number; error?: string }[] = [];

    for (const account of accounts) {
      try {
        // 2. Get active campaign IDs for this account
        const { data: campaigns } = await supabase
          .from('campaigns')
          .select('id')
          .eq('linkedin_account_id', account.id)
          .eq('status', 'active');

        if (!campaigns?.length) continue;

        const campaignIds = campaigns.map((c) => c.id);

        // 3. Get connection_sent leads that have a provider_id already stored
        //    (provider_id is stored during sendConnectionRequest via enrichLead)
        const { data: sentLeads, error: leadsError } = await supabase
          .from('leads')
          .select('id, provider_id, campaign_id')
          .eq('status', 'connection_sent')
          .in('campaign_id', campaignIds)
          .not('provider_id', 'is', null); // Only leads we have a provider_id for

        if (leadsError || !sentLeads?.length) {
          results.push({ accountId: account.id, checked: 0, accepted: 0 });
          continue;
        }

        // 4. Fetch the last 20 accepted relations from Unipile — 1 API call only
        const relationsResult = await unipile.getAllRelations(account.unipile_account_id);
        if (!relationsResult.success) {
          results.push({ accountId: account.id, checked: 0, accepted: 0, error: relationsResult.error });
          continue;
        }
        console.log("The relations result are : ", relationsResult.data)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const relations: any[] = relationsResult.data?.items ?? relationsResult.data?.relations ?? [];
        if (!relations.length) {
          results.push({ accountId: account.id, checked: sentLeads.length, accepted: 0 });
          continue;
        }

        // 5. Build a Set of provider_ids from relations — O(1) lookup
        const connectedIds = new Set<string>(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          relations.map((r: any) => r.member_id).filter(Boolean)
        );

        // 6. Cross-reference in memory — no extra API calls
        const acceptedLeadIds = sentLeads
          .filter((lead) => lead.provider_id && connectedIds.has(lead.provider_id))
          .map((lead) => lead.id);

        if (!acceptedLeadIds.length) {
          results.push({ accountId: account.id, checked: sentLeads.length, accepted: 0 });
          continue;
        }

        // 7. Batch update all accepted leads in one query
        await supabase
          .from('leads')
          .update({
            status: 'connected',
            connected_at: currentTime.toISOString(),
            last_action_at: currentTime.toISOString(),
          })
          .in('id', acceptedLeadIds);

        // 8. Batch insert action logs
        await supabase.from('action_logs').insert(
          sentLeads
            .filter((l) => acceptedLeadIds.includes(l.id))
            .map((l) => ({
              campaign_id: l.campaign_id,
              lead_id: l.id,
              action_type: 'connection_accepted',
              status: 'completed',
            }))
        );

        totalUpdated += acceptedLeadIds.length;
        results.push({ accountId: account.id, checked: sentLeads.length, accepted: acceptedLeadIds.length });

      } catch (err: unknown) {
        const error = err as Error;
        results.push({ accountId: account.id, checked: 0, accepted: 0, error: error.message });
      }
    }

    return NextResponse.json({
      success: true,
      total_updated: totalUpdated,
      results,
      timestamp: currentTime.toISOString(),
    });

  } catch (err: unknown) {
    const error = err as Error;
    console.error('check-connections error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'check_connections_ready', timestamp: new Date().toISOString() });
}