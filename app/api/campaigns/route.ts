import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/campaigns - List user's campaigns
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ campaigns: campaigns || [] });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/campaigns - Create campaign
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, linkedin_account_id, schedule, message_templates, priority, daily_limit, total_limit } = body;

    if (!name) {
      return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        name,
        description,
        linkedin_account_id,
        schedule: schedule || {
          time_windows: [{ start_time: '09:00', end_time: '17:00' }],
          days_of_week: [1, 2, 3, 4, 5],
          timezone: 'UTC',
        },
        message_templates: message_templates || {},
        priority: priority || 1,
        daily_limit: daily_limit || 20,
        total_limit: total_limit || null,
        status: 'draft',
        actions_today: 0,
        actions_total: 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
