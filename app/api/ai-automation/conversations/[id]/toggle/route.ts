import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSubscription, isEffectivelyPaid } from '@/lib/billing/entitlement';

// PATCH /api/ai-automation/conversations/[id]/toggle
// Body: { enabled: boolean }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Billing entitlement check
    const sub = await getSubscription(user.id);
    if (!isEffectivelyPaid(sub)) {
      return NextResponse.json({ error: 'AI automation requires a paid plan' }, { status: 402 });
    }

    const { id: conversationId } = await params;
    const body = await request.json();
    const { enabled } = body as { enabled: boolean };

    // Verify conversation belongs to user
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, ai_enabled, ai_status')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    let updatePayload: Record<string, unknown>;

    if (enabled) {
      // Check that Google Calendar is connected
      const { data: aiConfig } = await supabase
        .from('ai_automation_config')
        .select('gcal_refresh_token')
        .eq('user_id', user.id)
        .single();

      if (!aiConfig?.gcal_refresh_token) {
        return NextResponse.json(
          { error: 'Google Calendar must be connected before enabling AI automation' },
          { status: 400 }
        );
      }

      // Count inbound messages for this conversation
      const { count: inboundCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('direction', 'inbound');

      updatePayload = {
        ai_enabled: true,
        ai_status: (inboundCount ?? 0) > 0 ? 'active' : 'idle',
      };
    } else {
      updatePayload = {
        ai_enabled: false,
        ai_status: 'paused',
      };
    }

    const { data: updated, error: updateError } = await supabase
      .from('conversations')
      .update(updatePayload)
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .select('id, ai_enabled, ai_status')
      .single();

    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
