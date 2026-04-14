import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/dashboard
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [campaignsRes, leadsRes] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, name, status, actions_today, actions_total, daily_limit, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('leads')
        .select('status, campaigns!inner(user_id)')
        .eq('campaigns.user_id', user.id),
    ]);

    const campaigns = campaignsRes.data ?? [];
    const leads = leadsRes.data ?? [];

    const CONNECTED_STATUSES = ['connected', 'message_sent', 'followup_1_sent', 'followup_2_sent', 'replied', 'completed'];
    const MESSAGED_STATUSES  = ['message_sent', 'followup_1_sent', 'followup_2_sent', 'replied', 'completed'];

    const connections_sent = leads.filter((l: { status: string }) => CONNECTED_STATUSES.includes(l.status)).length;
    const messages_sent    = leads.filter((l: { status: string }) => MESSAGED_STATUSES.includes(l.status)).length;
    const replied          = leads.filter((l: { status: string }) => l.status === 'replied').length;

    return NextResponse.json({
      stats: {
        total_campaigns: campaigns.length,
        active_campaigns: campaigns.filter((c: { status: string }) => c.status === 'active').length,
        total_leads: leads.length,
        connections_sent,
        messages_sent,
        replied,
      },
      recent_campaigns: campaigns.slice(0, 5),
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
