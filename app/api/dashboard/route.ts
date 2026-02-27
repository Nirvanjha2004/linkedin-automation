import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/dashboard - Dashboard stats
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const today = new Date().toISOString().split('T')[0];

    const [campaignsRes, logsRes] = await Promise.all([
      supabase.from('campaigns')
        .select('id, status, actions_today, actions_total')
        .eq('user_id', user.id),
      supabase.from('action_logs')
        .select('action_type, status, executed_at, campaigns!inner(user_id)')
        .eq('campaigns.user_id', user.id)
        .gte('executed_at', `${today}T00:00:00Z`)
        .eq('status', 'completed'),
    ]);

    const campaigns = campaignsRes.data || [];
    const todayLogs = logsRes.data || [];

    const stats = {
      total_campaigns: campaigns.length,
      active_campaigns: campaigns.filter(c => c.status === 'active').length,
      connections_sent_today: todayLogs.filter(l => l.action_type === 'connect').length,
      messages_sent_today: todayLogs.filter(l => l.action_type === 'message').length,
      followups_sent_today: todayLogs.filter(l => l.action_type === 'follow_up').length,
      total_actions_today: todayLogs.length,
    };

    return NextResponse.json({ stats });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
