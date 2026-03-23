'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Lead } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import {
  ExternalLink, Loader2, ChevronLeft, ChevronRight,
  Users, MapPin, ChevronDown, Search,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadTableProps {
  campaignId?: string;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

// Deterministic color from name so the same person always gets the same color
const AVATAR_COLORS = [
  ['bg-indigo-100 text-indigo-700', 'border-indigo-200'],
  ['bg-violet-100 text-violet-700', 'border-violet-200'],
  ['bg-emerald-100 text-emerald-700', 'border-emerald-200'],
  ['bg-amber-100 text-amber-700', 'border-amber-200'],
  ['bg-rose-100 text-rose-700', 'border-rose-200'],
  ['bg-sky-100 text-sky-700', 'border-sky-200'],
  ['bg-teal-100 text-teal-700', 'border-teal-200'],
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function LeadAvatar({ lead }: { lead: Lead }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = lead.full_name || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || '?';
  const initial = name[0].toUpperCase();
  const [bg, border] = avatarColor(name);

  if (lead.profile_pic_url && !imgFailed) {
    return (
      <img
        src={lead.profile_pic_url}
        alt={name}
        onError={() => setImgFailed(true)}
        className="h-8 w-8 rounded-full object-cover shrink-0 bg-zinc-100 border border-zinc-200"
      />
    );
  }
  return (
    <div className={cn('h-8 w-8 rounded-full text-xs font-semibold shrink-0 flex items-center justify-center border', bg, border)}>
      {initial}
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-50">
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-zinc-100 animate-pulse shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="h-3 bg-zinc-100 rounded animate-pulse w-32" />
            <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-48" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="space-y-1.5">
          <div className="h-3 bg-zinc-100 rounded animate-pulse w-24" />
          <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-32" />
        </div>
      </td>
      <td className="px-4 py-3.5"><div className="h-5 bg-zinc-100 rounded-full animate-pulse w-20" /></td>
      <td className="px-4 py-3.5"><div className="h-3 bg-zinc-100 rounded animate-pulse w-28" /></td>
      <td className="px-4 py-3.5"><div className="h-3.5 w-3.5 bg-zinc-100 rounded animate-pulse" /></td>
    </tr>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',                label: 'All statuses' },
  { value: 'pending',         label: 'Pending' },
  { value: 'connection_sent', label: 'Connection sent' },
  { value: 'connected',       label: 'Connected' },
  { value: 'message_sent',    label: 'Message sent' },
  { value: 'replied',         label: 'Replied' },
  { value: 'followup_sent',   label: 'Follow-up sent' },
  { value: 'completed',       label: 'Completed' },
  { value: 'failed',          label: 'Failed' },
  { value: 'skipped',         label: 'Skipped' },
];

// Status dot colors for the select option indicator
const STATUS_DOT: Record<string, string> = {
  pending:          'bg-zinc-400',
  connection_sent:  'bg-blue-400',
  connected:        'bg-emerald-400',
  message_sent:     'bg-violet-400',
  replied:          'bg-emerald-500',
  followup_sent:    'bg-amber-400',
  completed:        'bg-blue-500',
  failed:           'bg-red-400',
  skipped:          'bg-zinc-300',
};

interface FilterBarProps {
  total: number;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  loading: boolean;
}

function FilterBar({ total, statusFilter, onStatusChange, loading }: FilterBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-zinc-100">
      {/* Left: count */}
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-sm text-zinc-500">
          {loading ? (
            <span className="inline-block h-3 w-16 bg-zinc-100 rounded animate-pulse" />
          ) : (
            <><span className="font-medium text-zinc-700">{total.toLocaleString()}</span> lead{total !== 1 ? 's' : ''}</>
          )}
        </span>
      </div>

      {/* Right: status filter */}
      <div className="relative">
        {/* Active dot indicator */}
        {statusFilter && (
          <span className={cn('absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full z-10', STATUS_DOT[statusFilter] ?? 'bg-zinc-400')} />
        )}
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className={cn(
            'h-8 appearance-none border border-zinc-200 rounded-lg text-xs text-zinc-700 bg-white',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
            'pr-7 transition-colors hover:border-zinc-300',
            statusFilter ? 'pl-7' : 'pl-3',
          )}
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  onPrev: () => void;
  onNext: () => void;
}

function Pagination({ page, pages, total, perPage, onPrev, onNext }: PaginationProps) {
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 bg-zinc-50/40">
      <p className="text-xs text-zinc-400">
        Showing <span className="font-medium text-zinc-600">{from}–{to}</span> of{' '}
        <span className="font-medium text-zinc-600">{total.toLocaleString()}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          disabled={page === 1}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <span className="px-2.5 py-1.5 text-xs text-zinc-400 tabular-nums">
          {page} / {pages}
        </span>
        <button
          onClick={onNext}
          disabled={page === pages}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PER_PAGE = 50;

export default function LeadTable({ campaignId }: LeadTableProps) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
      if (campaignId) params.append('campaign_id', campaignId);
      if (statusFilter) params.append('status', statusFilter);
      const { data } = await axios.get(`/api/leads?${params}`);
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [campaignId, page, statusFilter]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleStatusChange = (v: string) => {
    setStatusFilter(v);
    setPage(1);
  };

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <FilterBar
        total={total}
        statusFilter={statusFilter}
        onStatusChange={handleStatusChange}
        loading={loading}
      />

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/60">
              <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-5 py-3 min-w-[220px]">
                Person
              </th>
              <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3 min-w-[180px]">
                Company
              </th>
              <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3 w-[140px]">
                Status
              </th>
              <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3 w-[160px]">
                Last action
              </th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-50">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center mb-3">
                      <Users className="h-5 w-5 text-zinc-400" />
                    </div>
                    <p className="text-sm font-medium text-zinc-600 mb-1">
                      {statusFilter ? 'No leads match this filter' : 'No leads yet'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {statusFilter ? 'Try a different status filter' : 'Upload a CSV to get started'}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              leads.map((lead) => {
                const name = lead.full_name || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || '—';
                return (
                  <tr key={lead.id} className="group hover:bg-zinc-50/80 transition-colors">

                    {/* Person: avatar + name + headline */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <LeadAvatar lead={lead} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900 truncate leading-snug">
                            {name}
                          </p>
                          {lead.headline ? (
                            <p className="text-xs text-zinc-400 truncate max-w-[200px] mt-0.5 leading-snug">
                              {lead.headline}
                            </p>
                          ) : lead.location ? (
                            <p className="text-xs text-zinc-400 flex items-center gap-1 mt-0.5">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              {lead.location}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Company + title */}
                    <td className="px-4 py-3.5">
                      {lead.company ? (
                        <p className="text-sm text-zinc-700 truncate max-w-[180px] leading-snug">
                          {lead.company}
                        </p>
                      ) : (
                        <span className="text-sm text-zinc-300">—</span>
                      )}
                      {lead.title && (
                        <p className="text-xs text-zinc-400 truncate max-w-[180px] mt-0.5 leading-snug">
                          {lead.title}
                        </p>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <StatusBadge status={lead.status} />
                    </td>

                    {/* Last action timestamp */}
                    <td className="px-4 py-3.5">
                      {lead.last_action_at ? (
                        <span className="text-xs text-zinc-400 tabular-nums">
                          {formatDateTime(lead.last_action_at)}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-300">—</span>
                      )}
                    </td>

                    {/* LinkedIn link — visible on hover */}
                    <td className="px-4 py-3.5">
                      <a
                        href={lead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open LinkedIn profile"
                        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center h-7 w-7 rounded-lg text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && pages > 1 && (
        <Pagination
          page={page}
          pages={pages}
          total={total}
          perPage={PER_PAGE}
          onPrev={() => setPage(p => Math.max(1, p - 1))}
          onNext={() => setPage(p => Math.min(pages, p + 1))}
        />
      )}
    </div>
  );
}
