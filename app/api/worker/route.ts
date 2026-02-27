import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getUnipileClient, LeadProfileData } from '@/lib/unipile/client';

/** Replaces {{first_name}}, {{last_name}}, {{full_name}}, {{company}}, {{title}} in a template */
function personalize(template: string, lead: Record<string, string | null | undefined>): string {
  return template
    .replace(/\{\{first_name\}\}/gi, lead.first_name || 'there')
    .replace(/\{\{last_name\}\}/gi, lead.last_name || '')
    .replace(/\{\{full_name\}\}/gi, lead.full_name || lead.first_name || 'there')
    .replace(/\{\{company\}\}/gi, lead.company || 'your company')
    .replace(/\{\{title\}\}/gi, lead.title || 'your role')
    .trim();
}

const MESSAGE_ACTION_TYPES = ['send_message', 'send_followup_1', 'send_followup_2'] as const;
type MessageActionType = typeof MESSAGE_ACTION_TYPES[number];

const MESSAGE_STATUS_MAP: Record<MessageActionType, { status: string; timestampField: string }> = {
  send_message:   { status: 'message_sent',   timestampField: 'message_sent_at' },
  send_followup_1: { status: 'followup_1_sent', timestampField: 'follow_up_1_sent_at' },
  send_followup_2: { status: 'followup_2_sent', timestampField: 'follow_up_2_sent_at' },
};

// POST /api/worker
// Polls action_queue every 30 seconds for ready actions and executes them immediately.
// No sleep delays — timing is handled by the scheduler.
export async function POST() {
  const supabase = createAdminClient();
  const unipile = getUnipileClient();
  const currentTime = new Date();

  try {
    // 1. Fetch all queued actions whose execute_at time has passed
    const { data: readyActions, error: fetchError } = await supabase
      .from('action_queue')
      .select('id, account_id, lead_id, campaign_id, type, payload')
      .eq('status', 'queued')
      .lte('execute_at', currentTime.toISOString())
      .order('execute_at', { ascending: true })
      .limit(20);

    if (fetchError) throw fetchError;

    if (!readyActions?.length) {
      return NextResponse.json({ message: 'No actions ready', processed: 0 });
    }

    let processed = 0;
    let failed = 0;
    const results: { actionId: string; status: string; error?: string }[] = [];

    for (const action of readyActions) {
      try {
        // 2. Atomically claim the action — prevents duplicate execution
        const { error: claimError } = await supabase
          .from('action_queue')
          .update({ status: 'processing' })
          .eq('id', action.id)
          .eq('status', 'queued');

        if (claimError) {
          results.push({ actionId: action.id, status: 'skipped', error: 'claim_failed' });
          continue;
        }

        // 3. Execute
        let success = false;
        let errorMsg = '';

        if (action.type === 'connection_request') {
          const result = await unipile.sendConnectionRequest({
            account_id: action.payload.unipile_account_id,
            linkedin_url: action.payload.linkedin_url,
            message: action.payload.message ?? undefined,
          });

          // Always enrich lead from profile data when available
          if (result.profileData) {
            await enrichLead(supabase, action.lead_id, result.profileData, currentTime);
          }

          success = result.success;
          errorMsg = result.error ?? '';

          // Already invited recently — treat as connection_sent, no retry
          if (!success && result.alreadyInvited) {
            await supabase.from('action_queue')
              .update({ status: 'completed', executed_at: currentTime.toISOString(), error_message: 'already_invited_recently' })
              .eq('id', action.id);
            await supabase.from('leads')
              .update({ status: 'connection_sent', connection_sent_at: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
              .eq('id', action.lead_id);
            await supabase.from('action_logs').insert({
              campaign_id: action.campaign_id, lead_id: action.lead_id,
              action_type: action.type, status: 'skipped', error_message: 'already_invited_recently',
            });
            processed++;
            results.push({ actionId: action.id, status: 'skipped_already_invited' });
            continue;
          }

          // Already 1st-degree connection — advance to connected, no retry
          if (!success && result.alreadyConnected) {
            await supabase.from('action_queue')
              .update({ status: 'completed', executed_at: currentTime.toISOString(), error_message: 'already_connected' })
              .eq('id', action.id);
            await supabase.from('leads')
              .update({ status: 'connected', connected_at: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
              .eq('id', action.lead_id);
            await supabase.from('action_logs').insert({
              campaign_id: action.campaign_id, lead_id: action.lead_id,
              action_type: action.type, status: 'skipped', error_message: 'already_connected',
            });
            processed++;
            results.push({ actionId: action.id, status: 'skipped_already_connected' });
            continue;
          }
        } else if (MESSAGE_ACTION_TYPES.includes(action.type as MessageActionType)) {
          // ── Message / follow-up actions ─────────────────────────────────────
          const msgType = action.type as MessageActionType;
          const template = action.payload.template as string;
          const leadData = action.payload.lead as Record<string, string | null | undefined>;

          if (!template) {
            errorMsg = `No template configured for ${msgType}`;
          } else {
            const message = personalize(template, leadData);
            const result = await unipile.sendMessage({
              account_id: action.payload.unipile_account_id as string,
              linkedin_url: action.payload.linkedin_url as string,
              provider_id: action.payload.provider_id as string | undefined,
              message,
            });
            success = result.success;
            errorMsg = result.error ?? '';

            if (success) {
              const { status: newStatus, timestampField } = MESSAGE_STATUS_MAP[msgType];
              await supabase.from('action_queue')
                .update({ status: 'completed', executed_at: currentTime.toISOString() })
                .eq('id', action.id);
              await supabase.from('leads')
                .update({ status: newStatus, [timestampField]: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
                .eq('id', action.lead_id);
              await supabase.from('action_logs').insert({
                campaign_id: action.campaign_id, lead_id: action.lead_id,
                action_type: action.type, status: 'completed',
              });
              processed++;
              results.push({ actionId: action.id, status: 'completed' });
              continue;
            }
          }
        } else {
          errorMsg = `Unknown action type: ${action.type}`;
        }

        if (success) {
          // 4a. Mark action completed
          await supabase.from('action_queue')
            .update({ status: 'completed', executed_at: currentTime.toISOString() })
            .eq('id', action.id);

          // 4b. Update lead status (connection_request success path)
          await supabase.from('leads')
            .update({ status: 'connection_sent', connection_sent_at: currentTime.toISOString(), last_action_at: currentTime.toISOString() })
            .eq('id', action.lead_id);

          // 4c. Log the action
          await supabase.from('action_logs').insert({
            campaign_id: action.campaign_id, lead_id: action.lead_id,
            action_type: action.type, status: 'completed',
          });

          processed++;
          results.push({ actionId: action.id, status: 'completed' });
        } else {
          // 5. Retry logic with exponential backoff
          const { data: current } = await supabase
            .from('action_queue').select('retry_count').eq('id', action.id).single();

          const retryCount = (current?.retry_count ?? 0) + 1;
          const isFinal = retryCount >= 3;

          await supabase.from('action_queue').update({
            status: isFinal ? 'failed' : 'queued',
            retry_count: retryCount,
            error_message: errorMsg,
            execute_at: isFinal
              ? currentTime.toISOString()
              : new Date(currentTime.getTime() + Math.pow(2, retryCount) * 60 * 1000).toISOString(),
          }).eq('id', action.id);

          if (isFinal) {
            await supabase.from('leads')
              .update({ status: 'failed', last_action_at: currentTime.toISOString() })
              .eq('id', action.lead_id);
            await supabase.from('action_logs').insert({
              campaign_id: action.campaign_id, lead_id: action.lead_id,
              action_type: action.type, status: 'failed', error_message: errorMsg,
            });
          } else {
            await supabase.from('leads').update({ status: 'pending' }).eq('id', action.lead_id);
          }

          failed++;
          results.push({ actionId: action.id, status: isFinal ? 'failed' : 'retrying', error: errorMsg });
        }
      } catch (err: unknown) {
        const error = err as Error;
        failed++;
        results.push({ actionId: action.id, status: 'error', error: error.message });
        await supabase.from('action_queue')
          .update({ status: 'failed', error_message: error.message })
          .eq('id', action.id);
      }
    }

    return NextResponse.json({
      success: true,
      total_ready: readyActions.length,
      processed,
      failed,
      results,
      timestamp: currentTime.toISOString(),
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Worker error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Enriches a lead row with data from the Unipile profile response.
 * Only updates fields that are currently null/empty to avoid overwriting
 * data the user manually set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichLead(supabase: any, leadId: string, profile: LeadProfileData, currentTime: Date) {
  const update: Record<string, unknown> = { enriched_at: currentTime.toISOString() };

  if (profile.provider_id)      update.provider_id       = profile.provider_id;
  if (profile.first_name)       update.first_name        = profile.first_name;
  if (profile.last_name)        update.last_name         = profile.last_name;
  if (profile.full_name)        update.full_name         = profile.full_name;
  if (profile.headline)         update.headline          = profile.headline;
  if (profile.location)         update.location          = profile.location;
  if (profile.profile_pic_url)  update.profile_pic_url   = profile.profile_pic_url;
  if (profile.public_profile_url) update.public_profile_url = profile.public_profile_url;
  if (profile.company)          update.company           = profile.company;
  if (profile.title)            update.title             = profile.title;

  if (Object.keys(update).length > 1) {
    await supabase.from('leads').update(update).eq('id', leadId);
  }
}

export async function GET() {
  return NextResponse.json({ status: 'worker_ready', timestamp: new Date().toISOString() });
}