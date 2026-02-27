import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// GET /api/campaigns/:id - Get campaign with stats
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Compute lead stats
    const { data: leadStats } = await supabase
      .from('leads')
      .select('status')
      .eq('campaign_id', id);

    const stats: Record<string, number> = {
      total_leads: leadStats?.length || 0,
      pending: 0,
      connection_sent: 0,
      connected: 0,
      message_sent: 0,
      replied: 0,
      followup_sent: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };

    leadStats?.forEach(({ status }) => {
      if (status in stats) stats[status]++;
    });

    const connectionRate = stats.total_leads > 0 
      ? stats.connected / stats.total_leads 
      : 0;
    const replyRate = stats.connected > 0 
      ? stats.replied / stats.connected 
      : 0;
    stats.connection_rate = Math.round(connectionRate * 100);
    stats.reply_rate = Math.round(replyRate * 100);

    return NextResponse.json({ campaign: { ...campaign, stats } });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/campaigns/:id - Update campaign
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    
    // Don't allow changing user_id
    delete body.user_id;
    delete body.id;

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update(body)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ campaign });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/campaigns/:id - Delete campaign
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
