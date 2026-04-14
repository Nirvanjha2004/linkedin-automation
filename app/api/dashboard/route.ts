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

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [campaignsRes, leadsRes] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, name, status, actions_today, actions_total, daily_limit, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),

      supabase
        .from('leads')
        .select('status, connection_sent_at, message_sent_at, campaigns!inner(user_id)')
        .eq('campaigns.user_id', user.id),
    ]);

    const campaigns = campaignsRes.data ?? [];
    const leads = leadsRes.data ?? [];

    // Count leads whose connection/message was sent in the last 30 days
    const connections_sent = leads.filter(
      (l) => l.connection_sent_at && l.connection_sent_at >= thirtyDaysAgo
    ).length;

    const messages_sent = leads.filter(
      (l) =>
        l.message_sent_at && l.message_sent_at >= thirtyDaysAgo
    ).length;

    const replied = leads.filter((l) => l.status === 'replied').length;

    return NextResponse.json({
      stats: {
        total_campaigns: campaigns.length,
        active_campaigns: campaigns.filter((c) => c.status === 'active').length,
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
