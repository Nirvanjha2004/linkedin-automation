import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_CONFIG = {
  persona: '',
  meeting_objective: '',
  meeting_duration_min: 30,
  timezone: 'UTC',
  default_ai_enabled: false,
  gcal_token_error: false,
};

// GET /api/ai-automation/config
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('ai_automation_config')
      .select('persona, meeting_objective, meeting_duration_min, timezone, default_ai_enabled, gcal_token_error, gcal_refresh_token')
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({
        ...DEFAULT_CONFIG,
        gcal_connected: false,
      });
    }

    const { gcal_refresh_token, ...rest } = data;

    return NextResponse.json({
      ...rest,
      gcal_connected: gcal_refresh_token !== null,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/ai-automation/config
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { persona, meeting_objective, meeting_duration_min, timezone, default_ai_enabled } = body;

    if (meeting_duration_min !== undefined) {
      if (meeting_duration_min < 15 || meeting_duration_min > 120) {
        return NextResponse.json(
          { error: 'meeting_duration_min must be between 15 and 120' },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, unknown> = { user_id: user.id };
    if (persona !== undefined) updates.persona = persona;
    if (meeting_objective !== undefined) updates.meeting_objective = meeting_objective;
    if (meeting_duration_min !== undefined) updates.meeting_duration_min = meeting_duration_min;
    if (timezone !== undefined) updates.timezone = timezone;
    if (default_ai_enabled !== undefined) updates.default_ai_enabled = default_ai_enabled;

    const { data, error } = await supabase
      .from('ai_automation_config')
      .upsert(updates, { onConflict: 'user_id' })
      .select('persona, meeting_objective, meeting_duration_min, timezone, default_ai_enabled, gcal_token_error, gcal_refresh_token')
      .single();

    if (error) throw error;

    const { gcal_refresh_token, ...rest } = data;

    return NextResponse.json({
      ...rest,
      gcal_connected: gcal_refresh_token !== null,
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
