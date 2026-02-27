import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

const MIN_DELAY_MS = 30 * 1000;
const MAX_DELAY_MS = 90 * 1000;

function randomDelayMs(): number {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
}

/** Returns ISO timestamp for N days ago */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

type Campaign = {
  id: string;
  linkedin_account_id: string;
  message_templates: {
    connection_request?: string;
    initial_message?: string;
    follow_up_1?: string;
    follow_up_2?: string;
    follow_up_delay_days?: number;
  };
  daily_limit: number;
  actions_today: number;
};

type QueueAction = {
  type: string;
  leadId: string;
  campaignId: string;
  payload: Record<string, unknown>;
  fromStatus: string;
};

/**
 * POST /api/scheduler-v2
 *
 * Runs every 3 minutes. Per account, picks ONE action to queue — in priority order:
 *  1. pending lead         → connection_request
 *  2. connected lead       → send_message      (initial message, immediate)
 *  3. message_sent lead    → send_followup_1   (after follow_up_delay_days)
 *  4. followup_1_sent lead → send_followup_2   (after follow_up_delay_days)
 */
export async function POST() {
  const supabase = createAdminClient();

  try {
    // 1. Get all active LinkedIn accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('linkedin_accounts')
      .select('id, unipile_account_id, is_active')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accounts?.length) {
      return NextResponse.json({ message: 'No active accounts', queued: 0 });
    }

    // 2. Fetch all active campaigns for those accounts
    const accountIds = accounts.map((a) => a.id);
    const { data: campaigns, error: campaignsError } = await supabase
      .from('campaigns')
      .select('id, linkedin_account_id, message_templates, daily_limit, actions_today')
      .eq('status', 'active')
      .in('linkedin_account_id', accountIds);

    if (campaignsError) throw campaignsError;
    if (!campaigns?.length) {
      return NextResponse.json({ message: 'No active campaigns', queued: 0 });
    }

    // Group campaigns by account
    const campaignsByAccount = new Map<string, Campaign[]>();
    for (const c of campaigns) {
      if (!c.linkedin_account_id) continue;
      if (!campaignsByAccount.has(c.linkedin_account_id)) {
        campaignsByAccount.set(c.linkedin_account_id, []);
      }
      campaignsByAccount.get(c.linkedin_account_id)!.push(c as Campaign);
    }

    const currentTime = new Date();
    let totalQueued = 0;
    const results: { accountId: string; status: string; action?: string; reason?: string }[] = [];

    for (const account of accounts) {
      const accountCampaigns = campaignsByAccount.get(account.id);
      if (!accountCampaigns?.length) continue;

      try {
        // 3. Enforce per-account cooldown (30–90s between actions)
        const { data: lastAction } = await supabase
          .from('action_queue')
          .select('executed_at')
          .eq('account_id', account.id)
          .eq('status', 'completed')
          .order('executed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastSentTime = lastAction?.executed_at ? new Date(lastAction.executed_at) : new Date(0);
        const nextAllowedTime = new Date(lastSentTime.getTime() + randomDelayMs());

        if (currentTime < nextAllowedTime) {
          results.push({ accountId: account.id, status: 'skipped', reason: 'cooldown' });
          continue;
        }

        // 4. Skip if already something queued/processing for this account
        const { count: pendingCount } = await supabase
          .from('action_queue')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', account.id)
          .in('status', ['queued', 'processing']);

        if ((pendingCount ?? 0) > 0) {
          results.push({ accountId: account.id, status: 'skipped', reason: 'already_queued' });
          continue;
        }

        const campaignIds = accountCampaigns.map((c) => c.id);

        // 5. Find the highest-priority action to queue
        const action = await findNextAction(supabase, account, accountCampaigns, campaignIds);

        if (!action) {
          results.push({ accountId: account.id, status: 'skipped', reason: 'nothing_to_do' });
          continue;
        }

        // 6. Atomically claim the lead (prevents double-queuing on concurrent runs)
        const { error: claimError } = await supabase
          .from('leads')
          .update({ status: 'processing' })
          .eq('id', action.leadId)
          .eq('status', action.fromStatus);

        if (claimError) {
          results.push({ accountId: account.id, status: 'error', reason: claimError.message });
          continue;
        }

        // 7. Insert into action_queue
        const { error: queueError } = await supabase
          .from('action_queue')
          .insert({
            account_id: account.id,
            lead_id: action.leadId,
            campaign_id: action.campaignId,
            type: action.type,
            execute_at: currentTime.toISOString(),
            status: 'queued',
            payload: action.payload,
          });

        if (queueError) {
          // Rollback lead claim on queue insert failure
          await supabase.from('leads').update({ status: action.fromStatus }).eq('id', action.leadId);
          results.push({ accountId: account.id, status: 'error', reason: queueError.message });
          continue;
        }

        totalQueued++;
        results.push({ accountId: account.id, status: 'queued', action: action.type });

      } catch (err: unknown) {
        results.push({ accountId: account.id, status: 'error', reason: (err as Error).message });
      }
    }

    return NextResponse.json({
      success: true,
      accounts_checked: accounts.length,
      actions_queued: totalQueued,
      results,
      timestamp: currentTime.toISOString(),
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Scheduler-v2 error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Finds the highest-priority action for an account.
 * Priority: connection_request > send_message > send_followup_1 > send_followup_2
 */
async function findNextAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  account: { id: string; unipile_account_id: string },
  campaigns: Campaign[],
  campaignIds: string[],
): Promise<QueueAction | null> {

  // ── Priority 1: pending → connection_request ──────────────────────────────
  const { data: pendingLead } = await supabase
    .from('leads')
    .select('id, linkedin_url, campaign_id')
    .in('campaign_id', campaignIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pendingLead) {
    const campaign = campaigns.find((c) => c.id === pendingLead.campaign_id);
    return {
      type: 'connection_request',
      leadId: pendingLead.id,
      campaignId: pendingLead.campaign_id,
      fromStatus: 'pending',
      payload: {
        linkedin_url: pendingLead.linkedin_url,
        unipile_account_id: account.unipile_account_id,
        message: campaign?.message_templates?.connection_request ?? null,
      },
    };
  }

  // ── Priority 2: connected → send_message (initial message, immediate) ─────
  for (const campaign of campaigns) {
    if (!campaign.message_templates?.initial_message) continue;

    const { data: lead } = await supabase
      .from('leads')
      .select('id, linkedin_url, campaign_id, provider_id, first_name, last_name, full_name, company, title')
      .eq('campaign_id', campaign.id)
      .eq('status', 'connected')
      .order('connected_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (lead) {
      return {
        type: 'send_message',
        leadId: lead.id,
        campaignId: lead.campaign_id,
        fromStatus: 'connected',
        payload: {
          linkedin_url: lead.linkedin_url,
          unipile_account_id: account.unipile_account_id,
          provider_id: lead.provider_id ?? undefined,
          template: campaign.message_templates.initial_message,
          lead: { first_name: lead.first_name, last_name: lead.last_name, full_name: lead.full_name, company: lead.company, title: lead.title },
        },
      };
    }
  }

  // ── Priority 3: message_sent → send_followup_1 (after delay) ─────────────
  for (const campaign of campaigns) {
    if (!campaign.message_templates?.follow_up_1) continue;
    const cutoff = daysAgo(campaign.message_templates?.follow_up_delay_days ?? 3);

    const { data: lead } = await supabase
      .from('leads')
      .select('id, linkedin_url, campaign_id, provider_id, first_name, last_name, full_name, company, title')
      .eq('campaign_id', campaign.id)
      .eq('status', 'message_sent')
      .lt('message_sent_at', cutoff)
      .order('message_sent_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (lead) {
      return {
        type: 'send_followup_1',
        leadId: lead.id,
        campaignId: lead.campaign_id,
        fromStatus: 'message_sent',
        payload: {
          linkedin_url: lead.linkedin_url,
          unipile_account_id: account.unipile_account_id,
          provider_id: lead.provider_id ?? undefined,
          template: campaign.message_templates.follow_up_1,
          lead: { first_name: lead.first_name, last_name: lead.last_name, full_name: lead.full_name, company: lead.company, title: lead.title },
        },
      };
    }
  }

  // ── Priority 4: followup_1_sent → send_followup_2 (after delay) ──────────
  for (const campaign of campaigns) {
    if (!campaign.message_templates?.follow_up_2) continue;
    const cutoff = daysAgo(campaign.message_templates?.follow_up_delay_days ?? 3);

    const { data: lead } = await supabase
      .from('leads')
      .select('id, linkedin_url, campaign_id, provider_id, first_name, last_name, full_name, company, title')
      .eq('campaign_id', campaign.id)
      .eq('status', 'followup_1_sent')
      .lt('follow_up_1_sent_at', cutoff)
      .order('follow_up_1_sent_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (lead) {
      return {
        type: 'send_followup_2',
        leadId: lead.id,
        campaignId: lead.campaign_id,
        fromStatus: 'followup_1_sent',
        payload: {
          linkedin_url: lead.linkedin_url,
          unipile_account_id: account.unipile_account_id,
          provider_id: lead.provider_id ?? undefined,
          template: campaign.message_templates.follow_up_2,
          lead: { first_name: lead.first_name, last_name: lead.last_name, full_name: lead.full_name, company: lead.company, title: lead.title },
        },
      };
    }
  }

  return null;
}

export async function GET() {
  return NextResponse.json({ status: 'scheduler_v2_ready', timestamp: new Date().toISOString() });
}