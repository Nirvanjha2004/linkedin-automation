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

type LinkedInAccountRow = {
  id: string;
  li_at: string | null;
  jsessionid: string | null;
  profile_urn: string | null;
};

type ConversationRow = {
  id: string;
  lead_id: string;
  external_conversation_id: string;
  unread_count: number;
  last_message_at: string | null;
  last_external_message_id: string | null;
};

type ExistingMessageRow = {
  external_message_id: string;
  sender_type: 'linkedin_account' | 'lead';
  direction: 'outbound' | 'inbound';
};

type LeadCampaign = {
  linkedin_account_id?: string | null;
};

type LeadRow = {
  id: string;
  provider_id: string | null;
  campaigns: LeadCampaign | LeadCampaign[] | null;
};

type LocalConversationState = {
  id: string;
  lead_id: string;
  unread_count: number;
  last_message_at: string | null;
  last_external_message_id: string | null;
};

type LeadIndexRow = {
  preferred?: string;
  fallback?: string;
};

const MESSAGE_URN_PREFIXES = ['urn:li:msg_message:', 'urn:li:messenger_message:'] as const;
const PROFILE_URN_PREFIXES = [
  'urn:li:msg_messagingParticipant:',
  'urn:li:messagingMember:',
  'urn:li:fsd_profile:',
  'urn:li:member:',
  'urn:li:fs_miniProfile:',
] as const;

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

  // ✅ Strip both known messaging wrappers
  if (urn.startsWith('urn:li:msg_messagingParticipant:')) {
    urn = urn.replace('urn:li:msg_messagingParticipant:', '');
  }
  if (urn.startsWith('urn:li:messagingMember:')) {
    urn = urn.replace('urn:li:messagingMember:', '');
  }

  if (urn.startsWith('urn:li:member:')) {
    urn = `urn:li:fsd_profile:${urn.replace('urn:li:member:', '')}`;
  } else if (urn.startsWith('urn:li:fs_miniProfile:')) {
    urn = `urn:li:fsd_profile:${urn.replace('urn:li:fs_miniProfile:', '')}`;
  }

  return urn;
}

function walkPayload(value: unknown, visitor: (value: unknown) => boolean | void, visited = new Set<unknown>()): boolean {
  const shouldStop = visitor(value);
  if (shouldStop === true) return true;

  if (!value || typeof value !== 'object') return false;
  if (visited.has(value)) return false;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (walkPayload(item, visitor, visited)) return true;
    }
    return false;
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (walkPayload(child, visitor, visited)) return true;
  }

  return false;
}

function hasAnyPrefix(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function extractMailboxSyncToken(payload: unknown): string | null {
  let token: string | null = null;
  walkPayload(payload, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const direct = (node as Record<string, unknown>).newSyncToken;
    if (typeof direct === 'string' && direct.trim()) {
      token = direct;
      return true;
    }
  });
  return token;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectObjects(value: unknown, predicate: (obj: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  walkPayload(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const obj = node as Record<string, unknown>;
    if (predicate(obj)) output.push(obj);
  });
  return output;
}

function collectStringsByPrefixes(value: unknown, prefixes: readonly string[]): Set<string> {
  const output = new Set<string>();
  walkPayload(value, (node) => {
    if (typeof node === 'string' && hasAnyPrefix(node, prefixes)) {
      output.add(node);
    }
  });
  return output;
}

function findFirstStringByPrefixes(value: unknown, prefixes: readonly string[]): string | null {
  let found: string | null = null;
  walkPayload(value, (node) => {
    if (typeof node === 'string' && hasAnyPrefix(node, prefixes)) {
      found = node;
      return true;
    }
  });
  return found;
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

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractConversationPayloadFields(value: unknown): { lastMessageUrn: string | null; profileUrns: string[] } {
  let lastMessageUrn: string | null = null;
  const profileUrns = new Set<string>();

  walkPayload(value, (node) => {
    if (typeof node !== 'string') return;
    if (!lastMessageUrn && hasAnyPrefix(node, MESSAGE_URN_PREFIXES)) {
      lastMessageUrn = node;
      return;
    }
    if (hasAnyPrefix(node, PROFILE_URN_PREFIXES)) {
      profileUrns.add(node);
    }
  });

  return {
    lastMessageUrn,
    profileUrns: Array.from(profileUrns),
  };
}

function extractSenderProfileUrn(obj: Record<string, unknown>): string | null {
  const senderData = obj.sender ?? obj.from;
  const senderEntityUrn = (senderData as { entityUrn?: unknown } | undefined)?.entityUrn;

  if (typeof senderEntityUrn === 'string' && hasAnyPrefix(senderEntityUrn, PROFILE_URN_PREFIXES)) {
    return senderEntityUrn;
  }

  return (
    findFirstStringByPrefixes(senderData, PROFILE_URN_PREFIXES) ||
    findFirstStringByPrefixes(obj, PROFILE_URN_PREFIXES)
  );
}

function normalizeCampaign(lead: LeadRow): LeadCampaign | null {
  const campaign = lead.campaigns;
  if (!campaign) return null;
  return Array.isArray(campaign) ? campaign[0] ?? null : campaign;
}

function buildLeadIndex(leadRows: LeadRow[] | null | undefined, accountId: string): Map<string, LeadIndexRow> {
  const index = new Map<string, LeadIndexRow>();

  for (const lead of leadRows ?? []) {
    const normalized = normalizeProfileUrn(lead.provider_id);
    if (!normalized) continue;

    const current = index.get(normalized) ?? {};
    if (!current.fallback) {
      current.fallback = lead.id;
    }

    const campaignAccountId = normalizeCampaign(lead)?.linkedin_account_id ?? null;
    if (campaignAccountId === accountId) {
      current.preferred = lead.id;
    }

    index.set(normalized, current);
  }

  return index;
}

function resolveLeadIdFromIndex(leadIndex: Map<string, LeadIndexRow>, participantProfileUrn: string | null): string | null {
  const normalized = normalizeProfileUrn(participantProfileUrn);
  if (!normalized) return null;

  const row = leadIndex.get(normalized);
  if (!row) return null;

  return row.preferred ?? row.fallback ?? null;
}

function shouldFetchMessages(
  parsed: ParsedConversation,
  local: LocalConversationState,
  newlyInsertedConversationUrns: Set<string>
): boolean {
  if (newlyInsertedConversationUrns.has(parsed.conversationUrn)) {
    return true;
  }

  if (!local.last_external_message_id || !local.last_message_at) {
    return true;
  }

  if (parsed.lastMessageUrn && local.last_external_message_id !== parsed.lastMessageUrn) {
    return true;
  }

  if (!local.last_message_at || !parsed.lastMessageAt) {
    return true;
  }

  return new Date(parsed.lastMessageAt).getTime() > new Date(local.last_message_at).getTime();
}

function pickMessageText(obj: Record<string, unknown>): string | null {
  const attributedBody = obj.attributedBody as { text?: string } | undefined;
  const body = obj.body as { text?: string } | undefined;
  const messageObj = obj.message as Record<string, unknown> | undefined;

  const messageBody = messageObj?.body as { text?: string } | undefined;
  const messageAttributedBody = messageObj?.attributedBody as { text?: string } | undefined;

  const direct = firstString(
    attributedBody?.text,
    body?.text,
    messageAttributedBody?.text,
    messageBody?.text,
    obj.text,
    obj.plainText,
    obj.renderedBody,
    obj.localizedBodyText
  );
  if (direct) return direct;

  const nestedCandidates: string[] = [];
  const renderContentUnions = (obj.renderContentUnions as unknown[]) ?? [];
  for (const item of renderContentUnions) {
    if (typeof item === 'object' && item !== null) {
      const text = firstString(
        (item as Record<string, unknown>).text,
        ((item as Record<string, unknown>).body as { text?: string } | undefined)?.text,
        ((item as Record<string, unknown>).attributedBody as { text?: string } | undefined)?.text
      );
      if (text) nestedCandidates.push(text);
    }
  }

  return nestedCandidates.find((value) => value.trim().length > 0) ?? null;
}

function parseConversationPayload(payload: unknown, accountProfileUrn: string): ParsedConversation[] {
  const normalizedAccountProfileUrn = normalizeProfileUrn(accountProfileUrn) ?? accountProfileUrn;
  const conversationObjects = collectObjects(
    payload,
    (obj) => typeof obj.entityUrn === 'string' && obj.entityUrn.startsWith('urn:li:msg_conversation:')
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

    const extracted = extractConversationPayloadFields(obj);

    const normalizedProfileUrns = extracted.profileUrns
      .map((urn) => normalizeProfileUrn(urn) ?? urn)
      .filter(Boolean);

    const participantProfileUrn = normalizedProfileUrns.find((urn) => urn !== normalizedAccountProfileUrn) ?? null;

    byUrn.set(conversationUrn, {
      conversationUrn,
      unreadCount,
      lastMessageAt,
      lastMessageUrn: extracted.lastMessageUrn,
      participantProfileUrn,
    });
  }

  return Array.from(byUrn.values());
}

function parseMessagePayload(payload: unknown, accountProfileUrn: string): ParsedMessage[] {
  const normalizedAccountProfileUrn = normalizeProfileUrn(accountProfileUrn) ?? accountProfileUrn;
  const messageObjects = collectObjects(
    payload,
    (obj) =>
      (typeof obj.entityUrn === 'string' && obj.entityUrn.startsWith('urn:li:msg_message:')) ||
      (typeof obj.entityUrn === 'string' && obj.entityUrn.startsWith('urn:li:messenger_message:')) ||
      (typeof obj.dashEntityUrn === 'string' && obj.dashEntityUrn.startsWith('urn:li:msg_message:')) ||
      (typeof obj.dashEntityUrn === 'string' && obj.dashEntityUrn.startsWith('urn:li:messenger_message:')) ||
      (typeof obj.$type === 'string' && obj.$type.toLowerCase().includes('messengermessage'))
  );

  const byUrn = new Map<string, ParsedMessage>();

  for (const obj of messageObjects) {
    const messageUrn =
      (typeof obj.entityUrn === 'string' ? obj.entityUrn : null) ||
      (typeof obj.dashEntityUrn === 'string' ? obj.dashEntityUrn : null);

    if (!messageUrn) continue;

    const text = pickMessageText(obj) ?? '';

    if (!text.trim()) continue;

    const messageObj = obj.message as Record<string, unknown> | undefined;
    
    const sentAt =
      toIsoDate(obj.deliveredAt) ||
      toIsoDate(obj.createdAt) ||
      toIsoDate(obj.time) ||
      toIsoDate(obj.timestamp) ||
      toIsoDate(messageObj?.createdAt) ||
      toIsoDate(messageObj?.time) ||
      toIsoDate(obj.sentAt) ||
      toIsoDate(obj.lastModifiedAt) ||
      new Date().toISOString();

    const senderProfileUrnRaw = extractSenderProfileUrn(obj);

    const senderProfileUrn = normalizeProfileUrn(senderProfileUrnRaw) ?? senderProfileUrnRaw;

    const outbound = senderProfileUrn === normalizedAccountProfileUrn;

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

  for (const account of accounts as LinkedInAccountRow[]) {
    const accountIdValue = String(account.id);

    try {
      syncedAccounts += 1;

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
            .eq('id', accountIdValue);
        }
      );

      const { data: existingSyncState } = await supabase
        .from('message_sync_state')
        .select('last_sync_cursor')
        .eq('linkedin_account_id', accountIdValue)
        .maybeSingle();

      let nextSyncCursor: string | null = existingSyncState?.last_sync_cursor ?? null;

      let mailboxResponse = await client.fetchMailboxConversations(
        nextSyncCursor ? { syncToken: nextSyncCursor } : undefined
      );

      if (!mailboxResponse.success) {
        throw new Error(mailboxResponse.message || 'Failed to fetch mailbox conversations');
      }

      const parsedMailboxRows = parseConversationPayload(mailboxResponse.data, account.profile_urn);
      const discoveredConversations = new Map(parsedMailboxRows.map((row) => [row.conversationUrn, row]));

      const returnedSyncToken = extractMailboxSyncToken(mailboxResponse.data);
      if (returnedSyncToken) {
        nextSyncCursor = returnedSyncToken;
      }

      const parsedConversations = Array.from(discoveredConversations.values());
      const mailboxUrns = parsedConversations.map((c) => c.conversationUrn);

      let localConversations: ConversationRow[] = [];
      if (mailboxUrns.length > 0) {
        const { data: matchedConversations, error: localConversationError } = await supabase
          .from('conversations')
          .select('id, lead_id, external_conversation_id, unread_count, last_message_at, last_external_message_id')
          .eq('user_id', userId)
          .eq('linkedin_account_id', accountIdValue)
          .in('external_conversation_id', mailboxUrns);

        if (localConversationError) throw localConversationError;
        localConversations = (matchedConversations ?? []) as ConversationRow[];
      }

      const byUrn = new Map<string, LocalConversationState>();
      for (const row of localConversations) {
        if (!row.external_conversation_id) continue;
        byUrn.set(row.external_conversation_id, {
          id: row.id,
          lead_id: row.lead_id,
          unread_count: row.unread_count,
          last_message_at: row.last_message_at,
          last_external_message_id: row.last_external_message_id,
        });
      }

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

      const leadIndex = buildLeadIndex((leadRows ?? []) as LeadRow[], accountIdValue);

      const newlyInsertedConversationUrns = new Set<string>();

      for (const parsed of parsedConversations) {
        let local = byUrn.get(parsed.conversationUrn);

        if (!local && parsed.participantProfileUrn) {
          const leadId = resolveLeadIdFromIndex(leadIndex, parsed.participantProfileUrn);

          if (leadId) {
            const { data: insertedConversation, error: insertConversationError } = await supabase
              .from('conversations')
              .insert({
                user_id: userId,
                linkedin_account_id: accountIdValue,
                lead_id: leadId,
                external_conversation_id: parsed.conversationUrn,
                unread_count: parsed.unreadCount,
                last_message_at: parsed.lastMessageAt,
                last_external_message_id: parsed.lastMessageUrn,
              })
              .select('id, lead_id, unread_count, last_message_at')
              .single();

            if (!insertConversationError && insertedConversation) {
              local = {
                id: insertedConversation.id,
                lead_id: insertedConversation.lead_id,
                unread_count: insertedConversation.unread_count,
                last_message_at: insertedConversation.last_message_at,
                last_external_message_id: parsed.lastMessageUrn,
              };
              byUrn.set(parsed.conversationUrn, {
                id: insertedConversation.id,
                lead_id: insertedConversation.lead_id,
                unread_count: insertedConversation.unread_count,
                last_message_at: insertedConversation.last_message_at,
                last_external_message_id: parsed.lastMessageUrn,
              });
              newlyInsertedConversationUrns.add(parsed.conversationUrn);
              newConversations += 1;
            }
          }
        }

        if (!local) {
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

      const conversationsToFetch: ParsedConversation[] = [];
      for (const parsed of parsedConversations) {
        const local = byUrn.get(parsed.conversationUrn);
        if (!local) continue;
        if (shouldFetchMessages(parsed, local, newlyInsertedConversationUrns)) {
          conversationsToFetch.push(parsed);
        }
      }

      for (const parsed of conversationsToFetch) {
        const local = byUrn.get(parsed.conversationUrn)!;

        let messageResponse = await client.fetchConversationMessages(parsed.conversationUrn);

        if (!messageResponse.success) {
          const fallbackResponse = await client.fetchConversationsByIds([parsed.conversationUrn]);
          if (fallbackResponse.success) {
            messageResponse = fallbackResponse;
          }
        }

        if (!messageResponse.success) {
          continue;
        }

        const parsedMessages = parseMessagePayload(messageResponse.data, account.profile_urn);

        const isNewConversation = newlyInsertedConversationUrns.has(parsed.conversationUrn);
        const sinceIso = isNewConversation ? null : local.last_message_at;
        
        const incrementalMessages = sinceIso
          ? parsedMessages.filter((msg) => new Date(msg.sentAt).getTime() >= new Date(sinceIso).getTime())
          : parsedMessages;

        if (!incrementalMessages.length) continue;

        const externalMessageIds = incrementalMessages.map((msg) => msg.messageUrn);
        const { data: existingMessages } = await supabase
          .from('messages')
          .select('external_message_id, sender_type, direction')
          .eq('conversation_id', local.id)
          .in('external_message_id', externalMessageIds);

        const existingByExternalId = new Map<string, ExistingMessageRow>(
          (existingMessages ?? []).map((row: ExistingMessageRow) => [row.external_message_id, row])
        );
        const existingSet = new Set(existingByExternalId.keys());

        const rowsToCorrect = incrementalMessages.filter((msg) => {
          const existing = existingByExternalId.get(msg.messageUrn);
          if (!existing) return false;
          return existing.sender_type !== msg.senderType || existing.direction !== msg.direction;
        });

        if (rowsToCorrect.length) {
          await Promise.all(
            rowsToCorrect.map((msg) =>
              supabase
                .from('messages')
                .update({
                  sender_type: msg.senderType,
                  direction: msg.direction,
                })
                .eq('conversation_id', local.id)
                .eq('external_message_id', msg.messageUrn)
            )
          );
        }

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

        if (!rowsToInsert.length) continue;

        const { error: insertError } = await supabase
          .from('messages')
          .insert(rowsToInsert);

        if (insertError) {
          throw insertError;
        }

        newMessages += rowsToInsert.length;

        const latest = rowsToInsert[rowsToInsert.length - 1];
        await supabase
          .from('conversations')
          .update({
            last_message_at: latest.sent_at,
            last_external_message_id: latest.external_message_id,
          })
          .eq('id', local.id)
          .eq('user_id', userId);

        byUrn.set(parsed.conversationUrn, {
          ...local,
          last_message_at: latest.sent_at,
          last_external_message_id: latest.external_message_id,
        });
      }

      await supabase
        .from('message_sync_state')
        .upsert({
          linkedin_account_id: accountIdValue,
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
          linkedin_account_id: accountIdValue,
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