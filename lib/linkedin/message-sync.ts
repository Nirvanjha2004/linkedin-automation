import { randomUUID } from 'crypto';
import { createLinkedInClient } from '@/lib/linkedin/client';

type SupabaseClientLike = {
  from: (table: string) => {
    select: (query: string, options?: Record<string, unknown>) => any;
    insert: (values: Record<string, unknown> | Record<string, unknown>[]) => any;
    upsert: (values: Record<string, unknown> | Record<string, unknown>[], options?: Record<string, unknown>) => any;
    update: (values: Record<string, unknown>) => any;
    eq: (column: string, value: unknown) => any;
    in: (column: string, values: unknown[]) => any;
    not: (column: string, operator: string, value: unknown) => any;
    gte: (column: string, value: string) => any;
    lte: (column: string, value: string) => any;
    order: (column: string, options?: Record<string, unknown>) => any;
    limit: (count: number) => any;
    maybeSingle: () => any;
    single: () => any;
  };
};

interface SyncOptions {
  userId: string;
  accountId?: string;
}

interface ParsedConversation {
  conversationUrn: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessageUrn: string | null;
  participantProfileUrn: string | null;
}

interface ParsedMessage {
  messageUrn: string;
  senderProfileUrn: string | null;
  senderType: 'linkedin_account' | 'lead';
  direction: 'outbound' | 'inbound';
  contentText: string;
  contentHtml: string;
  sentAt: string;
}

function normalizeProfileUrn(value: string | null | undefined): string | null {
  if (!value) return null;

  let urn = value.trim().replace(/^"|"$/g, '');
  if (!urn) return null;

  if (urn.includes('%')) {
    try {
      urn = decodeURIComponent(urn);
    } catch {
      // Keep original when decoding fails.
    }
  }

  if (urn.startsWith('urn:li:member:')) {
    urn = `urn:li:fsd_profile:${urn.replace('urn:li:member:', '')}`;
  }

  if (urn.startsWith('urn:li:fs_miniProfile:')) {
    urn = `urn:li:fsd_profile:${urn.replace('urn:li:fs_miniProfile:', '')}`;
  }

  return urn;
}

function extractMailboxSyncToken(payload: unknown): string | null {
  const visited = new Set<unknown>();

  function walk(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    if (visited.has(value)) return null;
    visited.add(value);

    const obj = value as Record<string, unknown>;
    const direct = obj.newSyncToken;
    if (typeof direct === 'string' && direct.trim()) return direct;

    for (const child of Object.values(obj)) {
      if (typeof child === 'string') continue;
      const found = walk(child);
      if (found) return found;
    }

    return null;
  }

  return walk(payload);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ✅ FIXED: Added 'visited' Set to prevent stack overflows from circular references
function collectObjects(
  value: unknown,
  predicate: (obj: Record<string, unknown>) => boolean,
  output: Record<string, unknown>[],
  visited = new Set<unknown>()
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, predicate, output, visited);
    return;
  }

  const obj = value as Record<string, unknown>;
  if (predicate(obj)) output.push(obj);
  for (const child of Object.values(obj)) {
    collectObjects(child, predicate, output, visited);
  }
}

// ✅ FIXED: Added 'visited' Set to prevent stack overflows from circular references
function collectStringsByPrefix(
  value: unknown, 
  prefix: string, 
  output: Set<string>,
  visited = new Set<unknown>()
): void {
  if (typeof value === 'string') {
    if (value.startsWith(prefix)) output.add(value);
    return;
  }

  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectStringsByPrefix(item, prefix, output, visited);
    return;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    collectStringsByPrefix(child, prefix, output, visited);
  }
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  if (typeof value === 'number') {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

function parseConversationPayload(payload: unknown, accountProfileUrn: string): ParsedConversation[] {
  const conversationObjects: Record<string, unknown>[] = [];
  collectObjects(
    payload,
    (obj) => typeof obj.entityUrn === 'string' && obj.entityUrn.startsWith('urn:li:msg_conversation:'),
    conversationObjects
  );

  const byUrn = new Map<string, ParsedConversation>();

  for (const obj of conversationObjects) {
    const conversationUrn = String(obj.entityUrn);
    const unreadCount = typeof obj.unreadCount === 'number'
      ? obj.unreadCount
      : obj.read === false
        ? 1
        : 0;

    const lastMessageAt =
      toIsoDate(obj.lastActivityAt) ||
      toIsoDate(obj.lastUpdatedAt) ||
      toIsoDate(obj.modifiedAt) ||
      toIsoDate(obj.createdAt) ||
      null;

    const messageUrns = new Set<string>();
    collectStringsByPrefix(obj, 'urn:li:msg_message:', messageUrns);
    const profileUrns = new Set<string>();
    collectStringsByPrefix(obj, 'urn:li:fsd_profile:', profileUrns);

    const participantProfileUrn = Array.from(profileUrns).find((urn) => urn !== accountProfileUrn) ?? null;

    byUrn.set(conversationUrn, {
      conversationUrn,
      unreadCount,
      lastMessageAt,
      lastMessageUrn: Array.from(messageUrns)[0] ?? null,
      participantProfileUrn,
    });
  }

  return Array.from(byUrn.values());
}

function parseMessagePayload(payload: unknown, accountProfileUrn: string): ParsedMessage[] {
  const messageObjects: Record<string, unknown>[] = [];
  collectObjects(
    payload,
    (obj) =>
      (typeof obj.entityUrn === 'string' && obj.entityUrn.startsWith('urn:li:msg_message:')) ||
      (typeof obj.$type === 'string' && obj.$type.toLowerCase().includes('messengermessage')),
    messageObjects
  );

  const byUrn = new Map<string, ParsedMessage>();

  for (const obj of messageObjects) {
    const messageUrn =
      (typeof obj.entityUrn === 'string' ? obj.entityUrn : null) ||
      (typeof obj.dashEntityUrn === 'string' ? obj.dashEntityUrn : null);

    if (!messageUrn) continue;

    const text =
      (obj.body as { text?: string } | undefined)?.text ||
      ((obj.message as { body?: { text?: string } } | undefined)?.body?.text) ||
      (typeof obj.text === 'string' ? obj.text : '');

    if (!text.trim()) continue;

    const sentAt =
      toIsoDate(obj.createdAt) ||
      toIsoDate(obj.sentAt) ||
      toIsoDate(obj.lastModifiedAt) ||
      new Date().toISOString();

    const profileUrns = new Set<string>();
    collectStringsByPrefix(obj, 'urn:li:fsd_profile:', profileUrns);

    const senderProfileUrn =
      (obj.sender as { entityUrn?: string } | undefined)?.entityUrn ||
      (obj.from as { entityUrn?: string } | undefined)?.entityUrn ||
      Array.from(profileUrns)[0] ||
      null;

    const outbound = senderProfileUrn === accountProfileUrn;

    byUrn.set(messageUrn, {
      messageUrn,
      senderProfileUrn,
      senderType: outbound ? 'linkedin_account' : 'lead',
      direction: outbound ? 'outbound' : 'inbound',
      contentText: text.trim(),
      contentHtml: `<p>${escapeHtml(text.trim())}</p>`,
      sentAt,
    });
  }

  return Array.from(byUrn.values()).sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
  );
}

export async function syncMessagesForUser(
  supabase: SupabaseClientLike,
  options: SyncOptions
): Promise<{ syncedAccounts: number; newConversations: number; newMessages: number; readStatusChanges: number }> {
  const { userId, accountId } = options;

  let accountsQuery = supabase
    .from('linkedin_accounts')
    .select('id, li_at, jsessionid, profile_urn')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (accountId) {
    accountsQuery = accountsQuery.eq('id', accountId);
  }

  const { data: accounts, error: accountsError } = await accountsQuery;
  if (accountsError) throw accountsError;
  if (!accounts?.length) {
    return { syncedAccounts: 0, newConversations: 0, newMessages: 0, readStatusChanges: 0 };
  }

  let newConversations = 0;
  let newMessages = 0;
  let readStatusChanges = 0;
  let syncedAccounts = 0;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    try {
      syncedAccounts += 1;

      const diagnostics = {
        mailboxConversations: 0,
        existingConversationMatches: 0,
        insertedConversations: 0,
        fallbackLeadMatches: 0,
        skippedNoParticipantUrn: 0,
        skippedLeadNotMapped: 0,
        conversationsWithoutLocalAfterUpsert: 0,
        conversationsToFetchMessages: 0,
        skippedMessageFetchNoLocal: 0,
        skippedMessageFetchNotNewer: 0,
        messageFetchFailed: 0,
        parsedMessagesTotal: 0,
        incrementalMessagesTotal: 0,
        duplicateMessagesSkipped: 0,
        insertedMessages: 0,
      };

      if (!account.li_at || !account.jsessionid || !account.profile_urn) {
        throw new Error('Missing LinkedIn credentials for account sync');
      }

      const client = createLinkedInClient(
        {
          li_at: account.li_at,
          jsessionid: account.jsessionid,
          profile_urn: account.profile_urn,
        },
        async (newJsessionid) => {
          await supabase
            .from('linkedin_accounts')
            .update({ jsessionid: newJsessionid })
            .eq('id', account.id);
        }
      );

      const { data: leadRows } = await supabase
        .from('leads')
        .select(`
          id,
          provider_id,
          campaigns!inner(user_id, linkedin_account_id)
        `)
        .eq('campaigns.user_id', userId)
        .not('provider_id', 'is', null)
        .limit(5000);

      const leadByProfileUrn = new Map<string, string>();
      const fallbackLeadByProfileUrn = new Map<string, string>();
      for (const lead of leadRows ?? []) {
        const normalized = normalizeProfileUrn(lead.provider_id);
        if (!normalized) continue;

        // Keep an account-scoped map first for strict matching.
        const campaignAccountId =
          (lead.campaigns as { linkedin_account_id?: string } | null)?.linkedin_account_id ?? null;
        if (campaignAccountId === account.id) {
          leadByProfileUrn.set(normalized, lead.id);
        }

        // Keep a user-wide fallback map for campaign-association edge cases.
        if (!fallbackLeadByProfileUrn.has(normalized)) {
          fallbackLeadByProfileUrn.set(normalized, lead.id);
        }
      }

      const unmatchedParticipantUrns = new Set<string>();

      const { data: localConversations, error: localConversationError } = await supabase
        .from('conversations')
        .select('id, lead_id, external_conversation_id, unread_count, last_message_at')
        .eq('user_id', userId)
        .eq('linkedin_account_id', account.id)
        .not('external_conversation_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(500);

      if (localConversationError) throw localConversationError;

      const byUrn = new Map<string, { id: string; lead_id: string; unread_count: number; last_message_at: string | null }>();
      for (const row of localConversations ?? []) {
        if (!row.external_conversation_id) continue;
        byUrn.set(row.external_conversation_id, {
          id: row.id,
          lead_id: row.lead_id,
          unread_count: row.unread_count,
          last_message_at: row.last_message_at,
        });
      }

      const discoveredConversations = new Map<string, ParsedConversation>();

      const { data: existingSyncState } = await supabase
        .from('message_sync_state')
        .select('last_sync_cursor')
        .eq('linkedin_account_id', account.id)
        .maybeSingle();

      let nextSyncCursor: string | null = existingSyncState?.last_sync_cursor ?? null;

      let mailboxResponse = await client.fetchMailboxConversations(
        nextSyncCursor ? { syncToken: nextSyncCursor } : undefined
      );

      if (!mailboxResponse.success) {
        throw new Error(mailboxResponse.message || 'Failed to fetch mailbox conversations');
      }

      const parsedMailboxRows = parseConversationPayload(mailboxResponse.data, account.profile_urn);
      for (const row of parsedMailboxRows) {
        discoveredConversations.set(row.conversationUrn, row);
      }

      const returnedSyncToken = extractMailboxSyncToken(mailboxResponse.data);
      if (returnedSyncToken) {
        nextSyncCursor = returnedSyncToken;
      }

      const parsedConversations = Array.from(discoveredConversations.values());
      diagnostics.mailboxConversations = parsedConversations.length;

      for (const parsed of parsedConversations) {
        let local = byUrn.get(parsed.conversationUrn);
        if (local) diagnostics.existingConversationMatches += 1;

        if (!local && parsed.participantProfileUrn) {
          const normalizedParticipantUrn = normalizeProfileUrn(parsed.participantProfileUrn) ?? '';
          let leadId = leadByProfileUrn.get(normalizedParticipantUrn);
          if (!leadId) {
            leadId = fallbackLeadByProfileUrn.get(normalizedParticipantUrn);
            if (leadId) diagnostics.fallbackLeadMatches += 1;
          }

          if (leadId) {
            const { data: insertedConversation, error: insertConversationError } = await supabase
              .from('conversations')
              .insert({
                user_id: userId,
                linkedin_account_id: account.id,
                lead_id: leadId,
                external_conversation_id: parsed.conversationUrn,
                unread_count: parsed.unreadCount,
                last_message_at: parsed.lastMessageAt,
                last_external_message_id: parsed.lastMessageUrn,
              })
              .select('id, lead_id, unread_count, last_message_at')
              .single();

            if (!insertConversationError && insertedConversation) {
              local = insertedConversation;
              byUrn.set(parsed.conversationUrn, {
                id: insertedConversation.id,
                lead_id: insertedConversation.lead_id,
                unread_count: insertedConversation.unread_count,
                last_message_at: insertedConversation.last_message_at,
              });
              newConversations += 1;
              diagnostics.insertedConversations += 1;
            }
          } else {
            diagnostics.skippedLeadNotMapped += 1;
            unmatchedParticipantUrns.add(normalizedParticipantUrn || parsed.participantProfileUrn);
          }
        } else if (!local) {
          diagnostics.skippedNoParticipantUrn += 1;
        }

        if (!local) {
          diagnostics.conversationsWithoutLocalAfterUpsert += 1;
          continue;
        }

        if (local.unread_count !== parsed.unreadCount) {
          readStatusChanges += 1;
        }

        await supabase
          .from('conversations')
          .update({
            unread_count: parsed.unreadCount,
            last_message_at: parsed.lastMessageAt ?? local.last_message_at,
            last_external_message_id: parsed.lastMessageUrn,
          })
          .eq('id', local.id)
          .eq('user_id', userId);
      }

      // ✅ FIXED: N+1 Rate Limit Bomb Prevention
      // ONLY fetch messages for conversations where the mailbox payload shows a newer timestamp
      // than what we currently have stored in the local database.
      const conversationsToFetch: ParsedConversation[] = [];
      for (const parsed of parsedConversations) {
        const local = byUrn.get(parsed.conversationUrn);
        if (!local) {
          diagnostics.skippedMessageFetchNoLocal += 1;
          continue;
        }

        if (!local.last_message_at || !parsed.lastMessageAt) {
          conversationsToFetch.push(parsed);
          continue;
        }

        if (new Date(parsed.lastMessageAt).getTime() > new Date(local.last_message_at).getTime()) {
          conversationsToFetch.push(parsed);
        } else {
          diagnostics.skippedMessageFetchNotNewer += 1;
        }
      }
      diagnostics.conversationsToFetchMessages = conversationsToFetch.length;

      for (const parsed of conversationsToFetch) {
        const local = byUrn.get(parsed.conversationUrn)!;
        const messageResponse = await client.fetchConversationMessages(parsed.conversationUrn);
        
        if (!messageResponse.success) {
          diagnostics.messageFetchFailed += 1;
          continue;
        }

        const parsedMessages = parseMessagePayload(messageResponse.data, account.profile_urn);
        diagnostics.parsedMessagesTotal += parsedMessages.length;
        const sinceIso = local.last_message_at;
        const incrementalMessages = sinceIso
          ? parsedMessages.filter((msg) => new Date(msg.sentAt).getTime() > new Date(sinceIso).getTime())
          : parsedMessages;
        diagnostics.incrementalMessagesTotal += incrementalMessages.length;

        if (!incrementalMessages.length) continue;

        const externalMessageIds = incrementalMessages.map((msg) => msg.messageUrn);
        const { data: existingMessages } = await supabase
          .from('messages')
          .select('external_message_id')
          .eq('conversation_id', local.id)
          .in('external_message_id', externalMessageIds);

        const existingSet = new Set((existingMessages ?? []).map((row: { external_message_id: string }) => row.external_message_id));

        const rowsToInsert = incrementalMessages
          .filter((msg) => !existingSet.has(msg.messageUrn))
          .map((msg) => ({
            id: randomUUID(),
            conversation_id: local.id,
            user_id: userId,
            external_message_id: msg.messageUrn,
            sender_type: msg.senderType,
            direction: msg.direction,
            content_text: msg.contentText,
            content_html: msg.contentHtml,
            metadata: {
              source: 'linkedin_voyager',
              sender_profile_urn: msg.senderProfileUrn,
            },
            sent_at: msg.sentAt,
          }));

        diagnostics.duplicateMessagesSkipped += incrementalMessages.length - rowsToInsert.length;

        if (!rowsToInsert.length) continue;

        const { error: insertError } = await supabase
          .from('messages')
          .insert(rowsToInsert);
        if (insertError) throw insertError;

        newMessages += rowsToInsert.length;
        diagnostics.insertedMessages += rowsToInsert.length;

        const latest = rowsToInsert[rowsToInsert.length - 1];
        await supabase
          .from('conversations')
          .update({
            last_message_at: latest.sent_at,
            last_external_message_id: latest.external_message_id,
          })
          .eq('id', local.id)
          .eq('user_id', userId);
      }

      console.log(
        `[MessageSync][account=${account.id}] ${JSON.stringify(diagnostics)}`
      );

      if (unmatchedParticipantUrns.size > 0) {
        const unmatched = Array.from(unmatchedParticipantUrns).slice(0, 15);
        const mappedSample = Array.from(leadByProfileUrn.keys()).slice(0, 15);
        const fallbackMappedSample = Array.from(fallbackLeadByProfileUrn.keys()).slice(0, 15);
        console.log(
          `[MessageSync][account=${account.id}] unmatchedParticipantUrns=${JSON.stringify(unmatched)} mappedLeadUrnsSample=${JSON.stringify(mappedSample)} fallbackMappedLeadUrnsSample=${JSON.stringify(fallbackMappedSample)}`
        );
      }

      await supabase
        .from('message_sync_state')
        .upsert({
          linkedin_account_id: account.id,
          user_id: userId,
          last_sync_cursor: nextSyncCursor,
          last_synced_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error: null,
        }, { onConflict: 'linkedin_account_id' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      await supabase
        .from('message_sync_state')
        .upsert({
          linkedin_account_id: account.id,
          user_id: userId,
          last_synced_at: new Date().toISOString(),
          last_error: message,
        }, { onConflict: 'linkedin_account_id' });
    }
  }

  return {
    syncedAccounts,
    newConversations,
    newMessages,
    readStatusChanges,
  };
}