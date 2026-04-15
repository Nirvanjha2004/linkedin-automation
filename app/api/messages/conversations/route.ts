import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/messages/conversations - list conversations with account/date filters
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.max(1, Math.min(50, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('conversations')
      .select(`
        id,
        linkedin_account_id,
        lead_id,
        unread_count,
        last_message_at,
        updated_at,
        ai_enabled,
        ai_status,
        leads!inner(id, full_name, first_name, last_name, profile_pic_url, status),
        linkedin_accounts!inner(id, name)
      `, { count: 'exact' })
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (accountId) {
      query = query.eq('linkedin_account_id', accountId);
    }

    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        query = query.gte('last_message_at', fromDate.toISOString());
      }
    }

    if (to) {
      const toDate = new Date(`${to}T23:59:59.999Z`);
      if (!Number.isNaN(toDate.getTime())) {
        query = query.lte('last_message_at', toDate.toISOString());
      }
    }

    const { data: conversations, error, count } = await query;
    if (error) throw error;

    const conversationIds = (conversations ?? []).map((c: { id: string }) => c.id);

    let lastMessageMap = new Map<string, { content_text: string; sent_at: string }>();
    if (conversationIds.length) {
      const { data: messageRows } = await supabase
        .from('messages')
        .select('conversation_id, content_text, sent_at')
        .in('conversation_id', conversationIds)
        .order('sent_at', { ascending: false });

      for (const row of messageRows ?? []) {
        if (!lastMessageMap.has(row.conversation_id)) {
          lastMessageMap.set(row.conversation_id, {
            content_text: row.content_text,
            sent_at: row.sent_at,
          });
        }
      }
    }

    const result = (conversations ?? []).map((conversation: any) => {
      const lead = Array.isArray(conversation.leads) ? conversation.leads[0] : conversation.leads;
      const account = Array.isArray(conversation.linkedin_accounts)
        ? conversation.linkedin_accounts[0]
        : conversation.linkedin_accounts;
      const lastMessage = lastMessageMap.get(conversation.id);
      const leadName = lead?.full_name || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || 'Unknown lead';

      return {
        id: conversation.id,
        linkedin_account_id: conversation.linkedin_account_id,
        lead_id: conversation.lead_id,
        unread_count: conversation.unread_count,
        last_message_at: conversation.last_message_at,
        last_message_preview: lastMessage?.content_text ?? '',
        ai_enabled: conversation.ai_enabled ?? false,
        ai_status: conversation.ai_status ?? 'idle',
        lead: {
          id: lead?.id,
          name: leadName,
          profile_pic_url: lead?.profile_pic_url,
          status: lead?.status,
        },
        account: {
          id: account?.id,
          name: account?.name,
        },
      };
    });

    const total = count || 0;
    return NextResponse.json({
      conversations: result,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
