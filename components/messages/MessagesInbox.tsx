'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  RefreshCw, Send, Loader2, MessageSquare, CalendarDays,
  Bold, Italic, Underline, List, Link as LinkIcon, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AIStatus, LinkedInAccount } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationSummary {
  id: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
  lead: { id: string; name: string; profile_pic_url?: string | null; status: string };
  account: { id: string; name: string };
  ai_enabled?: boolean;
  ai_status?: AIStatus; // 'idle' | 'active' | 'paused' | 'completed' | 'error'
}

interface MessageItem {
  id: string;
  sender_type: 'linkedin_account' | 'lead';
  direction: 'outbound' | 'inbound';
  content_text: string;
  content_html?: string | null;
  sent_at: string;
  metadata?: { source?: string; [key: string]: unknown };
}

interface ConversationDetails {
  id: string;
  lead: { id: string; name: string; profile_pic_url?: string | null; status: string };
  account: { id: string; name: string };
  ai_enabled?: boolean;
  ai_status?: AIStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShort(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isThisYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
}

function fmtTime(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

function mergeConversations(
  existing: ConversationSummary[],
  incoming: ConversationSummary[],
): ConversationSummary[] {
  if (!existing.length) return incoming;
  const next = [...existing];
  const idx = new Map(next.map((c, i) => [c.id, i]));
  for (const c of incoming) {
    const i = idx.get(c.id);
    if (i === undefined) { idx.set(c.id, next.length); next.push(c); }
    else next[i] = c;
  }
  return next;
}

// Group messages by calendar date for date separators
function groupByDate(messages: MessageItem[]): Array<{ date: string; items: MessageItem[] }> {
  const groups: Array<{ date: string; items: MessageItem[] }> = [];
  for (const msg of messages) {
    const d = new Date(msg.sent_at);
    const key = Number.isNaN(d.getTime()) ? 'Unknown' : d.toDateString();
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.items.push(msg);
    else groups.push({ date: key, items: [msg] });
  }
  return groups;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-indigo-100 text-indigo-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
];

function nameColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <div className={cn('rounded-full font-semibold flex items-center justify-center shrink-0', cls, nameColor(name))}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

// ─── Conversation list item ───────────────────────────────────────────────────

function ConvItem({
  conv,
  active,
  onClick,
  onToggleAI,
  togglingAI,
}: {
  conv: ConversationSummary;
  active: boolean;
  onClick: () => void;
  onToggleAI: (id: string, enabled: boolean) => Promise<void>;
  togglingAI: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3.5 transition-colors flex items-start gap-3',
        active ? 'bg-indigo-50 border-l-2 border-indigo-500' : 'border-l-2 border-transparent hover:bg-zinc-50',
      )}
    >
      <Avatar name={conv.lead.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 mb-0.5">
          <p className={cn('text-sm truncate leading-snug', active ? 'font-semibold text-indigo-700' : 'font-medium text-zinc-800')}>
            {conv.lead.name}
          </p>
          <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">{fmtShort(conv.last_message_at)}</span>
        </div>
        <p className="text-xs text-zinc-500 truncate leading-snug">
          {conv.last_message_preview || 'No messages yet'}
        </p>
        <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{conv.account.name}</p>
      </div>
      {conv.unread_count > 0 && (
        <span className="shrink-0 h-4 min-w-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
          {conv.unread_count}
        </span>
      )}
      <div
        className="shrink-0 flex items-center"
        onClick={(e) => { e.stopPropagation(); void onToggleAI(conv.id, !conv.ai_enabled); }}
      >
        {togglingAI ? (
          <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
        ) : (
          <div className={cn(
            'w-7 h-4 rounded-full transition-colors relative',
            conv.ai_enabled ? 'bg-indigo-500' : 'bg-zinc-200'
          )}>
            <div className={cn(
              'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
              conv.ai_enabled ? 'translate-x-3.5' : 'translate-x-0.5'
            )} />
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Conversation list skeleton ───────────────────────────────────────────────

function ConvSkeleton() {
  return (
    <div className="px-4 py-3.5 flex items-start gap-3 border-l-2 border-transparent">
      <div className="h-8 w-8 rounded-full bg-zinc-100 animate-pulse shrink-0" />
      <div className="flex-1 space-y-2 pt-0.5">
        <div className="flex justify-between gap-2">
          <div className="h-3 bg-zinc-100 rounded animate-pulse w-28" />
          <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-10" />
        </div>
        <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-40" />
        <div className="h-2 bg-zinc-100 rounded animate-pulse w-20" />
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isOutbound,
  senderName,
}: {
  msg: MessageItem;
  isOutbound: boolean;
  senderName: string;
}) {
  return (
    <div className={cn('flex items-end gap-2', isOutbound ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar — only for inbound */}
      {!isOutbound && (
        <Avatar name={senderName} size="sm" />
      )}

      <div className={cn('flex flex-col gap-1', isOutbound ? 'items-end' : 'items-start', 'max-w-[72%]')}>
        {/* Bubble */}
        <div
          className={cn(
            'px-4 py-2.5 text-sm leading-relaxed break-words [overflow-wrap:anywhere]',
            isOutbound
              ? 'bg-indigo-600 text-white rounded-2xl rounded-br-sm shadow-sm'
              : 'bg-white text-zinc-800 rounded-2xl rounded-bl-sm border border-zinc-200 shadow-sm',
          )}
        >
          {msg.content_html ? (
            <div
              className={cn(
                'prose prose-sm max-w-none',
                isOutbound
                  ? '[&_a]:text-indigo-200 [&_strong]:text-white [&_em]:text-indigo-100'
                  : '[&_a]:text-indigo-600',
              )}
              dangerouslySetInnerHTML={{ __html: msg.content_html }}
            />
          ) : (
            <p className="whitespace-pre-wrap">{msg.content_text}</p>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[11px] text-zinc-400 px-1 tabular-nums">
          {fmtTime(msg.sent_at)}
        </span>
        {isOutbound && msg.metadata?.source === 'ai_agent' && (
          <span className="text-[10px] font-medium text-indigo-400 px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-100">
            AI
          </span>
        )}
      </div>

      {/* Spacer for outbound to keep bubble from touching edge */}
      {isOutbound && <div className="w-7 shrink-0" />}
    </div>
  );
}

// ─── Date separator ───────────────────────────────────────────────────────────

function DateSeparator({ dateStr }: { dateStr: string }) {
  const label = (() => {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return fmtDate(dateStr);
  })();

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-zinc-100" />
      <span className="text-[11px] font-medium text-zinc-400 shrink-0">{label}</span>
      <div className="flex-1 h-px bg-zinc-100" />
    </div>
  );
}

// ─── Message area skeleton ────────────────────────────────────────────────────

function MessageSkeleton() {
  return (
    <div className="flex-1 flex flex-col justify-end gap-4 p-6">
      {[
        { out: false, w: 'w-48' },
        { out: true,  w: 'w-64' },
        { out: false, w: 'w-56' },
        { out: true,  w: 'w-40' },
      ].map((s, i) => (
        <div key={i} className={cn('flex items-end gap-2', s.out ? 'flex-row-reverse' : 'flex-row')}>
          {!s.out && <div className="h-7 w-7 rounded-full bg-zinc-100 animate-pulse shrink-0" />}
          <div className={cn('h-10 rounded-2xl bg-zinc-100 animate-pulse', s.w)} />
          {s.out && <div className="w-7 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessagesInbox() {
  const PAGE_SIZE = 25;

  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationDetails | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const [selectedAccountId, setSelectedAccountId] = useState('all');
  const [fromDate, setFromDate] = useState(thirtyDaysAgo());
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);

  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [refreshingConversations, setRefreshingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [togglingAIConvId, setTogglingAIConvId] = useState<string | null>(null);
  const [aiActionLoading, setAiActionLoading] = useState(false);
  const [aiErrorMessage, setAiErrorMessage] = useState<string | null>(null);

  const [conversationPage, setConversationPage] = useState(1);
  const [conversationPages, setConversationPages] = useState(1);

  const editorRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<ConversationSummary[]>([]);
  const activeConversationRef = useRef<ConversationDetails | null>(null);
  const queryKeyRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()),
    [messages],
  );

  const messageGroups = useMemo(() => groupByDate(sortedMessages), [sortedMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sortedMessages]);

  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/accounts');
      setAccounts(data.accounts || []);
    } catch { toast.error('Failed to load accounts'); }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const { data } = await axios.get(`/api/messages/conversations/${id}`);
      setActiveConversation(data.conversation);
      setMessages(data.messages || []);
    } catch { toast.error('Failed to load conversation'); }
    finally { setLoadingMessages(false); }
  }, []);

  const fetchConversations = useCallback(async (nextPage = 1, append = false) => {
    const queryKey = `${selectedAccountId}|${fromDate}|${toDate}`;
    const queryChanged = queryKeyRef.current !== queryKey;

    if (append) setLoadingMoreConversations(true);
    else if (!conversationsRef.current.length) setLoadingConversations(true);
    else setRefreshingConversations(true);

    try {
      const params: Record<string, string> = {
        from: fromDate, to: toDate,
        page: String(nextPage), limit: String(PAGE_SIZE),
      };
      if (selectedAccountId !== 'all') params.account_id = selectedAccountId;

      const { data } = await axios.get('/api/messages/conversations', { params });
      const rows: ConversationSummary[] = data.conversations || [];
      const shouldReplace = !append && queryChanged;
      const next = shouldReplace ? rows : mergeConversations(conversationsRef.current, rows);

      setConversations(next);
      conversationsRef.current = next;
      queryKeyRef.current = queryKey;
      setConversationPage(data.page || nextPage);
      setConversationPages(data.pages || 1);

      if (!next.length) {
        setActiveConversation(null);
        activeConversationRef.current = null;
        setMessages([]);
        return;
      }
      const cur = activeConversationRef.current;
      if (!cur || !next.some(r => r.id === cur.id)) void loadConversation(next[0].id);
    } catch { toast.error('Failed to load conversations'); }
    finally {
      if (append) setLoadingMoreConversations(false);
      else { setLoadingConversations(false); setRefreshingConversations(false); }
    }
  }, [selectedAccountId, fromDate, toDate, loadConversation]);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => { setConversationPage(1); void fetchConversations(1, false); }, [fetchConversations]);

  // ── AI status error log ──────────────────────────────────────────────────────

  useEffect(() => {
    if (activeConversation?.ai_status === 'error') {
      axios.get(`/api/ai-automation/conversations/${activeConversation.id}/logs`)
        .then(({ data }) => {
          const errorLog = data.logs?.find((l: { status: string; error_message?: string }) => l.status === 'error');
          setAiErrorMessage(errorLog?.error_message ?? 'An error occurred');
        })
        .catch(() => setAiErrorMessage('An error occurred'));
    } else {
      setAiErrorMessage(null);
    }
  }, [activeConversation?.id, activeConversation?.ai_status]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleToggleAI = useCallback(async (convId: string, enabled: boolean) => {
    setTogglingAIConvId(convId);
    try {
      const { data } = await axios.patch<{ id: string; ai_enabled: boolean; ai_status: AIStatus }>(
        `/api/ai-automation/conversations/${convId}/toggle`,
        { enabled },
      );
      setConversations(prev => prev.map(c =>
        c.id === convId ? { ...c, ai_enabled: data.ai_enabled, ai_status: data.ai_status } : c
      ));
      if (activeConversation?.id === convId) {
        setActiveConversation(prev => prev ? { ...prev, ai_enabled: data.ai_enabled, ai_status: data.ai_status } : prev);
      }
      toast.success(data.ai_enabled ? 'AI automation enabled' : 'AI automation disabled');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error || 'Failed to toggle AI');
    } finally {
      setTogglingAIConvId(null);
    }
  }, [activeConversation]);

  const handleTakeover = useCallback(async () => {
    if (!activeConversation) return;
    setAiActionLoading(true);
    try {
      await axios.post(`/api/ai-automation/conversations/${activeConversation.id}/takeover`);
      setActiveConversation(prev => prev ? { ...prev, ai_status: 'paused' } : prev);
      setConversations(prev => prev.map(c =>
        c.id === activeConversation.id ? { ...c, ai_status: 'paused' } : c
      ));
      toast.success('Took over conversation');
    } catch { toast.error('Failed to take over'); }
    finally { setAiActionLoading(false); }
  }, [activeConversation]);

  const handleResumeAI = useCallback(async () => {
    if (!activeConversation) return;
    setAiActionLoading(true);
    try {
      await axios.post(`/api/ai-automation/conversations/${activeConversation.id}/resume`);
      setActiveConversation(prev => prev ? { ...prev, ai_status: 'active' } : prev);
      setConversations(prev => prev.map(c =>
        c.id === activeConversation.id ? { ...c, ai_status: 'active' } : c
      ));
      toast.success('AI automation resumed');
    } catch { toast.error('Failed to resume AI'); }
    finally { setAiActionLoading(false); }
  }, [activeConversation]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await axios.post('/api/messages/sync', {
        account_id: selectedAccountId !== 'all' ? selectedAccountId : undefined,
      });
      toast.success('Messages synced');
      setConversationPage(1);
      await fetchConversations(1, false);
    } catch { toast.error('Sync failed'); }
    finally { setSyncing(false); }
  };

  const runCmd = (cmd: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'createLink') => {
    editorRef.current?.focus();
    if (cmd === 'createLink') {
      const url = window.prompt('Enter URL');
      if (url) document.execCommand('createLink', false, url);
      return;
    }
    document.execCommand(cmd, false);
  };

  const handleSend = async () => {
    if (!activeConversation || !editorRef.current) return;
    const contentHtml = editorRef.current.innerHTML.trim();
    const contentText = editorRef.current.textContent?.trim() || '';
    if (!contentText) { toast.error('Message cannot be empty'); return; }
    setSending(true);
    try {
      const { data } = await axios.post('/api/messages/send', {
        conversation_id: activeConversation.id,
        content_html: contentHtml,
        content_text: contentText,
      });
      setMessages(prev => [...prev, data.message]);
      editorRef.current.innerHTML = '';
      toast.success('Message sent');
      setConversationPage(1);
      await fetchConversations(1, false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error || 'Failed to send message');
    } finally { setSending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 160px)', minHeight: '600px' }}>

      {/* ── Top toolbar ── */}
      <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Account selector */}
          <div className="relative">
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="h-8 appearance-none pl-3 pr-7 rounded-lg border border-zinc-200 text-xs text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:border-zinc-300 transition-colors"
            >
              <option value="all">All accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400 pointer-events-none" />
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <CalendarDays className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <input
              type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="h-8 rounded-lg border border-zinc-200 px-2.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:border-zinc-300 transition-colors"
            />
            <span className="text-zinc-300">–</span>
            <input
              type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="h-8 rounded-lg border border-zinc-200 px-2.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:border-zinc-300 transition-colors"
            />
          </div>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync
        </button>
      </div>

      {/* ── Body: sidebar + chat ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: conversation list ── */}
        <div className="w-[280px] shrink-0 border-r border-zinc-100 flex flex-col min-h-0">
          {/* List header */}
          <div className="px-4 py-2.5 border-b border-zinc-100 shrink-0">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
              Conversations
              {conversations.length > 0 && (
                <span className="ml-1.5 text-zinc-300 font-normal normal-case tracking-normal">
                  {conversations.length}
                </span>
              )}
            </p>
          </div>

          {/* List body */}
          {loadingConversations && !conversations.length ? (
            <div className="flex-1 overflow-hidden divide-y divide-zinc-50">
              {Array.from({ length: 6 }).map((_, i) => <ConvSkeleton key={i} />)}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <MessageSquare className="h-8 w-8 text-zinc-200 mb-2" />
              <p className="text-sm font-medium text-zinc-500 mb-0.5">No conversations</p>
              <p className="text-xs text-zinc-400">Try adjusting the date range</p>
            </div>
          ) : (
            <>
              {refreshingConversations && (
                <div className="px-4 py-2 border-b border-zinc-100 text-[11px] text-zinc-400 flex items-center gap-1.5 shrink-0">
                  <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
                  Refreshing...
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide divide-y divide-zinc-50">
                {conversations.map(conv => (
                  <ConvItem
                    key={conv.id}
                    conv={conv}
                    active={activeConversation?.id === conv.id}
                    onClick={() => void loadConversation(conv.id)}
                    onToggleAI={handleToggleAI}
                    togglingAI={togglingAIConvId === conv.id}
                  />
                ))}
              </div>
              {conversationPage < conversationPages && (
                <div className="p-3 border-t border-zinc-100 shrink-0">
                  <button
                    onClick={() => void fetchConversations(conversationPage + 1, true)}
                    disabled={loadingMoreConversations}
                    className="w-full h-8 rounded-lg border border-zinc-200 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 transition-colors"
                  >
                    {loadingMoreConversations
                      ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading...</span>
                      : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right: chat panel ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {!activeConversation ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mb-4">
                <MessageSquare className="h-7 w-7 text-zinc-400" />
              </div>
              <p className="text-sm font-semibold text-zinc-600 mb-1">No conversation selected</p>
              <p className="text-xs text-zinc-400">Pick a conversation from the left to start reading</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-5 py-3.5 border-b border-zinc-100 bg-white flex items-center gap-3 shrink-0">
                <Avatar name={activeConversation.lead.name} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate leading-snug">
                    {activeConversation.lead.name}
                  </p>
                  <p className="text-xs text-zinc-400 truncate leading-snug">
                    via {activeConversation.account.name}
                  </p>
                </div>
                {activeConversation.ai_status && activeConversation.ai_status !== 'idle' && (
                  <div className="ml-auto flex items-center gap-2">
                    <div className="flex flex-col items-end">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
                        activeConversation.ai_status === 'active' && 'bg-emerald-100 text-emerald-700',
                        activeConversation.ai_status === 'paused' && 'bg-amber-100 text-amber-700',
                        activeConversation.ai_status === 'error' && 'bg-red-100 text-red-700',
                        activeConversation.ai_status === 'completed' && 'bg-zinc-100 text-zinc-500',
                      )}>
                        <span className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          activeConversation.ai_status === 'active' && 'bg-emerald-500',
                          activeConversation.ai_status === 'paused' && 'bg-amber-500',
                          activeConversation.ai_status === 'error' && 'bg-red-500',
                          activeConversation.ai_status === 'completed' && 'bg-zinc-400',
                        )} />
                        AI {activeConversation.ai_status}
                      </span>
                      {activeConversation.ai_status === 'error' && aiErrorMessage && (
                        <p className="text-[11px] text-red-600 mt-0.5">{aiErrorMessage}</p>
                      )}
                    </div>
                    {activeConversation.ai_status === 'active' && (
                      <button
                        onClick={handleTakeover}
                        disabled={aiActionLoading}
                        className="h-7 px-2.5 rounded-lg border border-zinc-200 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 transition-colors"
                      >
                        {aiActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Take over'}
                      </button>
                    )}
                    {activeConversation.ai_status === 'paused' && (
                      <button
                        onClick={handleResumeAI}
                        disabled={aiActionLoading}
                        className="h-7 px-2.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                      >
                        {aiActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resume AI'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Messages area */}
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide bg-zinc-50/40">
                {loadingMessages ? (
                  <MessageSkeleton />
                ) : sortedMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-sm text-zinc-400">No messages yet</p>
                  </div>
                ) : (
                  <div className="px-6 py-5 space-y-1">
                    {messageGroups.map(group => (
                      <div key={group.date}>
                        <DateSeparator dateStr={group.date} />
                        <div className="space-y-3 mt-1">
                          {group.items.map(msg => {
                            const isOutbound =
                              msg.direction === 'outbound' || msg.sender_type === 'linkedin_account';
                            return (
                              <MessageBubble
                                key={msg.id}
                                msg={msg}
                                isOutbound={isOutbound}
                                senderName={activeConversation.lead.name}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-zinc-100 bg-white shrink-0">
                {/* Formatting toolbar */}
                <div className="flex items-center gap-0.5 px-4 pt-3 pb-1 border-b border-zinc-50">
                  {([
                    ['bold', Bold, 'Bold'],
                    ['italic', Italic, 'Italic'],
                    ['underline', Underline, 'Underline'],
                    ['insertUnorderedList', List, 'Bullet list'],
                    ['createLink', LinkIcon, 'Insert link'],
                  ] as const).map(([cmd, Icon, label]) => (
                    <button
                      key={cmd}
                      onClick={() => runCmd(cmd)}
                      title={label}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>

                {/* Editable area */}
                <div className="px-4 py-3">
                  <div
                    ref={editorRef}
                    contentEditable
                    onKeyDown={handleKeyDown}
                    className={cn(
                      'min-h-[80px] max-h-[160px] overflow-y-auto scrollbar-hide',
                      'text-sm text-zinc-800 leading-relaxed',
                      'break-words [overflow-wrap:anywhere]',
                      'focus:outline-none',
                      'empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-400 empty:before:pointer-events-none',
                    )}
                    suppressContentEditableWarning
                    data-placeholder="Write a message… (⌘↵ to send)"
                  />
                </div>

                {/* Send row */}
                <div className="px-4 pb-3 flex items-center justify-between">
                  <p className="text-[11px] text-zinc-400">⌘↵ to send</p>
                  <button
                    onClick={handleSend}
                    disabled={sending || !activeConversation}
                    className="inline-flex items-center gap-2 h-8 px-4 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
