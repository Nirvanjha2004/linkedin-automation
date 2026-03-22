'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  RefreshCw,
  Send,
  Loader2,
  MessageSquare,
  CalendarDays,
  Bold,
  Italic,
  Underline,
  List,
  Link as LinkIcon,
} from 'lucide-react';
import { LinkedInAccount } from '@/types';

interface ConversationSummary {
  id: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
  lead: {
    id: string;
    name: string;
    profile_pic_url?: string | null;
    status: string;
  };
  account: {
    id: string;
    name: string;
  };
}

interface MessageItem {
  id: string;
  sender_type: 'linkedin_account' | 'lead';
  direction: 'outbound' | 'inbound';
  content_text: string;
  content_html?: string | null;
  sent_at: string;
}

interface ConversationDetails {
  id: string;
  lead: {
    id: string;
    name: string;
    profile_pic_url?: string | null;
    status: string;
  };
  account: {
    id: string;
    name: string;
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString();
}

function firstDayThirtyDaysAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split('T')[0];
}

function mergeConversations(
  existing: ConversationSummary[],
  incoming: ConversationSummary[]
): ConversationSummary[] {
  if (!existing.length) return incoming;
  if (!incoming.length) return existing;

  const next = [...existing];
  const indexById = new Map<string, number>();

  next.forEach((conversation, index) => {
    indexById.set(conversation.id, index);
  });

  for (const conversation of incoming) {
    const existingIndex = indexById.get(conversation.id);
    if (existingIndex === undefined) {
      indexById.set(conversation.id, next.length);
      next.push(conversation);
    } else {
      next[existingIndex] = conversation;
    }
  }

  return next;
}

export default function MessagesInbox() {
  const PAGE_SIZE = 25;

  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationDetails | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>(firstDayThirtyDaysAgo());
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const [loadingConversations, setLoadingConversations] = useState<boolean>(true);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState<boolean>(false);
  const [refreshingConversations, setRefreshingConversations] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [conversationPage, setConversationPage] = useState<number>(1);
  const [conversationPages, setConversationPages] = useState<number>(1);

  const editorRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<ConversationSummary[]>([]);
  const activeConversationRef = useRef<ConversationDetails | null>(null);
  const queryKeyRef = useRef<string>('');
  
  // Ref for auto-scrolling to the bottom of the chat
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sort messages chronologically (oldest first)
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
  }, [messages]);

  // Auto-scroll to the bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sortedMessages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/accounts');
      setAccounts(data.accounts || []);
    } catch {
      toast.error('Failed to load LinkedIn accounts');
    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const { data } = await axios.get(`/api/messages/conversations/${conversationId}`);
      setActiveConversation(data.conversation);
      setMessages(data.messages || []);
    } catch {
      toast.error('Failed to load conversation');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const fetchConversations = useCallback(async (nextPage = 1, append = false) => {
    const queryKey = `${selectedAccountId}|${fromDate}|${toDate}`;
    const queryChanged = queryKeyRef.current !== queryKey;

    if (append) {
      setLoadingMoreConversations(true);
    } else if (conversationsRef.current.length === 0) {
      setLoadingConversations(true);
    } else {
      setRefreshingConversations(true);
    }

    try {
      const params: Record<string, string> = {
        from: fromDate,
        to: toDate,
        page: String(nextPage),
        limit: String(PAGE_SIZE),
      };

      if (selectedAccountId !== 'all') {
        params.account_id = selectedAccountId;
      }

      const { data } = await axios.get('/api/messages/conversations', { params });
      const rows: ConversationSummary[] = data.conversations || [];

      const shouldReplace = !append && queryChanged;
      const nextConversations = shouldReplace
        ? rows
        : mergeConversations(conversationsRef.current, rows);

      setConversations(nextConversations);
      conversationsRef.current = nextConversations;
      queryKeyRef.current = queryKey;

      setConversationPage(data.page || nextPage);
      setConversationPages(data.pages || 1);

      if (!nextConversations.length) {
        setActiveConversation(null);
        activeConversationRef.current = null;
        setMessages([]);
        return;
      }

      const currentActiveConversation = activeConversationRef.current;
      if (!currentActiveConversation || !nextConversations.some((row) => row.id === currentActiveConversation.id)) {
        void loadConversation(nextConversations[0].id);
      }
    } catch {
      toast.error('Failed to load conversations');
    } finally {
      if (append) {
        setLoadingMoreConversations(false);
      } else {
        setLoadingConversations(false);
        setRefreshingConversations(false);
      }
    }
  }, [selectedAccountId, fromDate, toDate, loadConversation]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    setConversationPage(1);
    void fetchConversations(1, false);
  }, [fetchConversations]);

  const handleLoadMoreConversations = async () => {
    if (conversationPage >= conversationPages) return;
    await fetchConversations(conversationPage + 1, true);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await axios.post('/api/messages/sync', {
        account_id: selectedAccountId !== 'all' ? selectedAccountId : undefined,
      });
      toast.success('Messages synced successfully');
      setConversationPage(1);
      await fetchConversations(1, false);
    } catch {
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const composerPlainText = useMemo(() => {
    if (!editorRef.current) return '';
    return editorRef.current.textContent?.trim() || '';
  }, [messages]);

  const runEditorCommand = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'createLink') => {
    editorRef.current?.focus();

    if (command === 'createLink') {
      const url = window.prompt('Enter URL');
      if (!url) return;
      document.execCommand('createLink', false, url);
      return;
    }

    document.execCommand(command, false);
  };

  const handleSendMessage = async () => {
    if (!activeConversation || !editorRef.current) return;

    const contentHtml = editorRef.current.innerHTML.trim();
    const contentText = editorRef.current.textContent?.trim() || '';

    if (!contentText) {
      toast.error('Message cannot be empty');
      return;
    }

    setSending(true);
    try {
      const { data } = await axios.post('/api/messages/send', {
        conversation_id: activeConversation.id,
        content_html: contentHtml,
        content_text: contentText,
      });

      setMessages((prev) => [...prev, data.message]);
      editorRef.current.innerHTML = '';
      toast.success('Message sent');
      setConversationPage(1);
      await fetchConversations(1, false);
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Failed to send message';
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <select
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 bg-white"
            >
              <option value="all">All LinkedIn Accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <CalendarDays className="h-4 w-4" />
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700"
            />
            <span>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700"
            />
          </div>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync Now
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] h-[calc(100vh-220px)] min-h-[560px]">
        <div className="border-r border-gray-100 bg-gray-50/50 flex flex-col min-h-0 overflow-hidden">
          {loadingConversations && conversations.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <MessageSquare className="h-8 w-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">No conversations found for selected filters.</p>
            </div>
          ) : (
            <>
              {refreshingConversations && (
                <div className="px-4 py-2 border-b border-gray-100 bg-white text-xs text-gray-500 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                  Refreshing conversations...
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
                <ul className="divide-y divide-gray-100">
                  {conversations.map((conversation) => {
                    const active = activeConversation?.id === conversation.id;
                    return (
                      <li key={conversation.id}>
                        <button
                          onClick={() => void loadConversation(conversation.id)}
                          className={`w-full text-left px-4 py-3.5 transition-colors ${
                            active ? 'bg-blue-50' : 'hover:bg-gray-100'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-800 truncate">{conversation.lead.name}</p>
                            <span className="text-[11px] text-gray-400 shrink-0">
                              {formatDateTime(conversation.last_message_at)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 truncate">{conversation.last_message_preview || 'No messages yet'}</p>
                          <p className="mt-1 text-[11px] text-gray-400">{conversation.account.name}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {conversationPage < conversationPages && (
                <div className="p-3 border-t border-gray-100 bg-white">
                  <button
                    onClick={() => void handleLoadMoreConversations()}
                    disabled={loadingMoreConversations}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {loadingMoreConversations ? 'Loading...' : 'Load more conversations'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col min-h-0 h-full">
          {!activeConversation ? (
            <div className="flex-1 flex items-center justify-center text-center p-6">
              <div>
                <MessageSquare className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">Select a conversation to view messages.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-gray-100 px-5 py-4 bg-white">
                <p className="text-sm font-semibold text-gray-900">{activeConversation.lead.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">LinkedIn Account: {activeConversation.account.name}</p>
              </div>

              <div className="flex-1 min-h-0 p-5 space-y-3 overflow-y-auto scrollbar-hide bg-gradient-to-b from-white to-gray-50">
                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  </div>
                ) : sortedMessages.length === 0 ? (
                  <p className="text-sm text-gray-500">No messages yet.</p>
                ) : (
                  <>
                    {sortedMessages.map((message) => {
                      const outbound =
                        message.direction === 'outbound' ||
                        message.sender_type === 'linkedin_account';
                      const senderLabel = outbound ? activeConversation.account.name || 'You' : activeConversation.lead.name;
                      return (
                        <div
                          key={message.id}
                          className={`flex flex-col ${outbound ? 'items-end' : 'items-start'}`}
                        >
                          <p className={`mb-1 text-[11px] font-medium ${outbound ? 'text-blue-600' : 'text-gray-500'}`}>
                            {outbound ? 'You' : senderLabel}
                          </p>
                          <div
                            className={`max-w-[82%] rounded-xl px-3.5 py-2.5 shadow-sm border ${
                              outbound
                                ? 'bg-blue-600 border-blue-600 text-white rounded-br-sm'
                                : 'bg-white border-gray-200 text-gray-800 rounded-bl-sm'
                            }`}
                          >
                            {message.content_html ? (
                              <div
                                className="text-sm leading-relaxed break-words [overflow-wrap:anywhere]"
                                dangerouslySetInnerHTML={{ __html: message.content_html }}
                              />
                            ) : (
                              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content_text}</p>
                            )}
                            <p className={`mt-1 text-[11px] ${outbound ? 'text-blue-100' : 'text-gray-400'}`}>
                              {formatDateTime(message.sent_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {/* Auto-scroll target */}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              <div className="border-t border-gray-100 p-4 bg-white">
                <div className="mb-2 flex items-center gap-1">
                  <button onClick={() => runEditorCommand('bold')} className="p-1.5 rounded hover:bg-gray-100" title="Bold">
                    <Bold className="h-4 w-4 text-gray-600" />
                  </button>
                  <button onClick={() => runEditorCommand('italic')} className="p-1.5 rounded hover:bg-gray-100" title="Italic">
                    <Italic className="h-4 w-4 text-gray-600" />
                  </button>
                  <button onClick={() => runEditorCommand('underline')} className="p-1.5 rounded hover:bg-gray-100" title="Underline">
                    <Underline className="h-4 w-4 text-gray-600" />
                  </button>
                  <button onClick={() => runEditorCommand('insertUnorderedList')} className="p-1.5 rounded hover:bg-gray-100" title="Bullet List">
                    <List className="h-4 w-4 text-gray-600" />
                  </button>
                  <button onClick={() => runEditorCommand('createLink')} className="p-1.5 rounded hover:bg-gray-100" title="Insert Link">
                    <LinkIcon className="h-4 w-4 text-gray-600" />
                  </button>
                </div>

                <div
                  ref={editorRef}
                  contentEditable
                  className="min-h-[96px] max-h-[180px] overflow-y-auto scrollbar-hide rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 break-words [overflow-wrap:anywhere] focus:outline-none focus:border-blue-400"
                  suppressContentEditableWarning
                  data-placeholder="Write your reply..."
                />

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-gray-400 truncate">{composerPlainText ? `${composerPlainText.length} chars` : 'Rich text enabled'}</p>
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || !activeConversation}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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