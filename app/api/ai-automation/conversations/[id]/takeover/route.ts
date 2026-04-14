import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/ai-automation/conversations/[id]/takeover
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: conversationId } = await params;

    // Verify conversation belongs to user
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Pause the conversation AI
    await supabase
      .from('conversations')
      .update({ ai_status: 'paused' })
      .eq('id', conversationId);

    // Cancel any pending AI reply jobs
    await supabase
      .from('ai_reply_jobs')
      .update({ status: 'failed' })
      .eq('conversation_id', conversationId)
      .eq('status', 'pending');

    return NextResponse.json({ success: true, ai_status: 'paused' });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
