import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { createLinkedInClient } from '@/lib/linkedin/client';
import { isValidCronRequest, cronUnauthorized } from '@/lib/cron-auth';

/** Extracts fsd_profile URNs from LinkedIn recent-connections payload */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractConnectedProfileUrns(data: any): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const included: any[] = Array.isArray(data?.included) ? data.included : [];
  const urns = new Set<string>();

  for (const item of included) {
    const urn = typeof item?.entityUrn === 'string' ? item.entityUrn : null;
    if (urn?.startsWith('urn:li:fsd_profile:')) {
      urns.add(urn);
    }
  }

  return [...urns];
}

// POST /api/check-connections
// Polls each LinkedIn account's recent accepted connections and marks matching
// leads as connected when their provider_id is found.
export async function POST(request: NextRequest) {
  // if (!isValidCronRequest(request)) return cronUnauthorized();
  const supabase = createAdminClient();
  const currentTime = new Date();

  try {
    // 1) Load active accounts with credentials
    const { data: accountRows, error: accountsError } = await supabase
      .from('linkedin_accounts')
      .select('id, li_at, jsessionid, profile_urn')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accountRows?.length) {
      return NextResponse.json({
        success: true,
        accounts_checked: 0,
        leads_connected: 0,
        results: [],
        timestamp: currentTime.toISOString(),
      });
    }

    // 2) Load campaigns for account->lead scoping
    const accountIds = accountRows.map((a) => a.id);
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('id, linkedin_account_id')
      .in('linkedin_account_id', accountIds);

    if (campaignsError) throw campaignsError;

    const campaignsByAccount = new Map<string, string[]>();
    for (const campaign of campaigns ?? []) {
      if (!campaign.linkedin_account_id) continue;
      if (!campaignsByAccount.has(campaign.linkedin_account_id)) {
        campaignsByAccount.set(campaign.linkedin_account_id, []);
      }
      campaignsByAccount.get(campaign.linkedin_account_id)!.push(campaign.id);
    }

    let leadsConnected = 0;
    let failed = 0;
    const results: {
      accountId: string;
      status: 'updated' | 'no_campaigns' | 'no_connections' | 'error';
      matchedUrns?: number;
      leadsUpdated?: number;
      error?: string;
    }[] = [];

    for (const account of accountRows) {
      try {
        const campaignIds = campaignsByAccount.get(account.id) ?? [];
        if (!campaignIds.length) {
          results.push({ accountId: account.id, status: 'no_campaigns' });
          continue;
        }

        const client = createLinkedInClient(account, async (newJsessionid) => {
          account.jsessionid = newJsessionid;
          await supabase.from('linkedin_accounts')
            .update({ jsessionid: newJsessionid })
            .eq('id', account.id);
        });

        const recentConnections = await client.getRecentConnections();
        if (!recentConnections.success) {
          failed++;
          results.push({
            accountId: account.id,
            status: 'error',
            error: recentConnections.error ?? recentConnections.message ?? 'Unknown error',
          });
          continue;
        }

        const connectedUrns = extractConnectedProfileUrns(recentConnections.data);
        if (!connectedUrns.length) {
          results.push({ accountId: account.id, status: 'no_connections', matchedUrns: 0, leadsUpdated: 0 });
          continue;
        }

        const { data: updatedLeads, error: updateError } = await supabase
          .from('leads')
          .update({
            status: 'connected',
            connected_at: currentTime.toISOString(),
            last_action_at: currentTime.toISOString(),
          })
          .in('campaign_id', campaignIds)
          .eq('status', 'connection_sent')
          .in('provider_id', connectedUrns)
          .select('id, campaign_id');

        if (updateError) {
          failed++;
          results.push({ accountId: account.id, status: 'error', error: updateError.message });
          continue;
        }

        const updatedCount = updatedLeads?.length ?? 0;
        leadsConnected += updatedCount;

        if (updatedCount > 0) {
          await supabase.from('action_logs').insert(
            updatedLeads!.map((lead) => ({
              campaign_id: lead.campaign_id,
              lead_id: lead.id,
              action_type: 'check_connections',
              status: 'completed',
            }))
          );
        }

        results.push({
          accountId: account.id,
          status: 'updated',
          matchedUrns: connectedUrns.length,
          leadsUpdated: updatedCount,
        });
      } catch (err: unknown) {
        failed++;
        results.push({
          accountId: account.id,
          status: 'error',
          error: (err as Error).message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      accounts_checked: accountRows.length,
      leads_connected: leadsConnected,
      failed,
      results,
      timestamp: currentTime.toISOString(),
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Check-connections error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Vercel Cron Jobs send GET requests — delegate to the POST handler
export async function GET(request: NextRequest) {
  return POST(request);
}