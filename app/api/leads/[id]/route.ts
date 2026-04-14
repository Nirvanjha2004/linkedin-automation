import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/leads/:id — update notes and/or tags
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Only allow updating notes and tags from this endpoint
    const update: Record<string, unknown> = {};
    if ('notes' in body) update.notes = body.notes ?? null;
    if ('tags'  in body) update.tags  = Array.isArray(body.tags) ? body.tags : [];

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Verify ownership: fetch campaign IDs belonging to this user
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('id')
      .eq('user_id', user.id);

    const campaignIds = (campaigns ?? []).map((c: { id: string }) => c.id);
    if (!campaignIds.length) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .update(update)
      .eq('id', id)
      .in('campaign_id', campaignIds)
      .select('id, notes, tags')
      .single();

    if (error || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ lead });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
