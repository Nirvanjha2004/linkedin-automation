import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createLinkedInClient } from '@/lib/linkedin/client';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// POST /api/messages/send - send message from UI and persist it locally
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const conversationId = body?.conversation_id as string;
    const contentHtml = String(body?.content_html || '').trim();
    const contentText = String(body?.content_text || stripHtml(contentHtml)).trim();

    if (!conversationId || !contentText) {
      return NextResponse.json({ error: 'conversation_id and content are required' }, { status: 400 });
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select(`
        id,
        user_id,
        linkedin_account_id,
        lead_id,
        external_conversation_id,
        linkedin_accounts!inner(id, li_at, jsessionid, profile_urn),
        leads!inner(id, linkedin_url, provider_id, status)
      `)
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .eq('leads.status', 'message_sent')
      .single();

    if (conversationError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const account = Array.isArray(conversation.linkedin_accounts)
      ? conversation.linkedin_accounts[0]
      : conversation.linkedin_accounts;
    const lead = Array.isArray(conversation.leads)
      ? conversation.leads[0]
      : conversation.leads;

    if (!account?.li_at || !account?.jsessionid || !account?.profile_urn) {
      return NextResponse.json({ error: 'LinkedIn account credentials are missing' }, { status: 400 });
    }

    const linkedInClient = createLinkedInClient({
      li_at: account.li_at,
      jsessionid: account.jsessionid,
      profile_urn: account.profile_urn,
    });

    const linkedInResponse = await linkedInClient.sendMessage({
      linkedin_url: lead.linkedin_url,
      provider_id: lead.provider_id,
      message: contentText,
      conversation_urn: conversation.external_conversation_id,
    });

    if (!linkedInResponse.success) {
      return NextResponse.json(
        { error: linkedInResponse.message || 'Failed to send LinkedIn message', code: linkedInResponse.error },
        { status: 502 }
      );
    }

    const externalMessageId =
      linkedInClient.extractMessageUrn(linkedInResponse?.data) ||
      linkedInResponse?.data?.value?.message?.entityUrn ||
      linkedInResponse?.data?.message?.entityUrn ||
      `local-${randomUUID()}`;

    const conversationUrn =
      conversation.external_conversation_id ||
      linkedInClient.extractConversationUrn(linkedInResponse?.data);

    const sentAt = new Date().toISOString();

    const { data: inserted, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        external_message_id: externalMessageId,
        sender_type: 'linkedin_account',
        direction: 'outbound',
        content_text: contentText,
        content_html: contentHtml || `<p>${contentText}</p>`,
        metadata: { source: 'ui_send' },
        sent_at: sentAt,
      })
      .select('id, sender_type, direction, content_text, content_html, sent_at, external_message_id, metadata')
      .single();

    if (insertError) throw insertError;

    await supabase
      .from('conversations')
      .update({
        last_message_at: sentAt,
        last_external_message_id: externalMessageId,
        external_conversation_id: conversationUrn,
      })
      .eq('id', conversationId)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, message: inserted });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
