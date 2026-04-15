import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/messages/conversations/[id] - get one conversation and all messages
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select(`
        id,
        linkedin_account_id,
        lead_id,
        unread_count,
        last_message_at,
        leads!inner(id, full_name, first_name, last_name, profile_pic_url, status),
        linkedin_accounts!inner(id, name)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (conversationError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Reset unread count when conversation is opened
    if ((conversation as any).unread_count > 0) {
      await supabase
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', id)
        .eq('user_id', user.id);
    }

    const { data: messages, error: messageError } = await supabase
      .from('messages')
      .select('id, sender_type, direction, content_text, content_html, sent_at, external_message_id, metadata')
      .eq('conversation_id', id)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: true });

    if (messageError) throw messageError;

    const lead = Array.isArray(conversation.leads)
      ? conversation.leads[0]
      : conversation.leads;
    const account = Array.isArray(conversation.linkedin_accounts)
      ? conversation.linkedin_accounts[0]
      : conversation.linkedin_accounts;

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        linkedin_account_id: conversation.linkedin_account_id,
        lead_id: conversation.lead_id,
        unread_count: conversation.unread_count,
        last_message_at: conversation.last_message_at,
        lead: {
          id: lead?.id,
          name: lead?.full_name || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || 'Unknown lead',
          profile_pic_url: lead?.profile_pic_url,
          status: lead?.status,
        },
        account: {
          id: account?.id,
          name: account?.name,
        },
      },
      messages: messages ?? [],
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
