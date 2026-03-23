'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Campaign } from '@/types';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  Plus, Play, Pause, Trash2, Users, Settings,
  Loader2, Megaphone, MoreHorizontal, ArrowUpRight,
} from 'lucide-react';

// ─── Row action dropdown ──────────────────────────────────────────────────────

interface RowMenuProps {
  campaign: Campaign;
  onToggle: () => void;
  onDelete: () => void;
  loading: boolean;
}

function RowMenu({ campaign, onToggle, onDelete, loading }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isActive = campaign.status === 'active';
  const canToggle = campaign.status !== 'archived';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors disabled:opacity-40"
        aria-label="Campaign actions"
      >
        {loading
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <MoreHorizontal className="h-4 w-4" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-zinc-200 shadow-md z-20 py-1 overflow-hidden">
          <Link
            href={`/dashboard/campaigns/${campaign.id}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            <Users className="h-3.5 w-3.5 text-zinc-400" />
            View leads
          </Link>
          <Link
            href={`/dashboard/campaigns/${campaign.id}?tab=settings`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            <Settings className="h-3.5 w-3.5 text-zinc-400" />
            Edit settings
          </Link>

          {canToggle && (
            <>
              <div className="my-1 border-t border-zinc-100" />
              <button
                onClick={() => { onToggle(); setOpen(false); }}
                className={cn(
                  'flex items-center gap-2.5 px-3.5 py-2 text-sm w-full text-left transition-colors',
                  isActive
                    ? 'text-amber-700 hover:bg-amber-50'
                    : 'text-emerald-700 hover:bg-emerald-50'
                )}
              >
                {isActive
                  ? <><Pause className="h-3.5 w-3.5" /> Pause campaign</>
                  : <><Play className="h-3.5 w-3.5" /> Activate campaign</>}
              </button>
            </>
          )}

          <div className="my-1 border-t border-zinc-100" />
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 w-full text-left transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Progress bar for daily actions ──────────────────────────────────────────

function DailyProgress({ today, limit }: { today: number; limit: number }) {
  const pct = limit > 0 ? Math.min((today / limit) * 100, 100) : 0;
  const atLimit = today >= limit;
  const nearLimit = pct >= 70 && !atLimit;

  return (
    <div className="flex items-center gap-2.5 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            atLimit ? 'bg-red-400' : nearLimit ? 'bg-amber-400' : 'bg-indigo-400'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn(
        'text-xs tabular-nums font-medium shrink-0',
        atLimit ? 'text-red-600' : 'text-zinc-500'
      )}>
        {today}/{limit}
      </span>
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-zinc-50">
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-5 py-4">
          <div className="h-3.5 bg-zinc-100 rounded animate-pulse" style={{ width: `${[60, 20, 40, 30, 25][i]}%` }} />
        </td>
      ))}
      <td className="px-5 py-4">
        <div className="h-7 w-7 bg-zinc-100 rounded-lg animate-pulse ml-auto" />
      </td>
    </tr>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyCampaigns() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mb-4">
        <Megaphone className="h-6 w-6 text-indigo-400" />
      </div>
      <p className="text-sm font-semibold text-zinc-700 mb-1">No campaigns yet</p>
      <p className="text-sm text-zinc-400 max-w-xs mb-6">
        Create your first campaign to start automating LinkedIn outreach
      </p>
      <Link
        href="/dashboard/campaigns/new"
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Create Campaign
      </Link>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/campaigns');
      setCampaigns(data.campaigns || []);
    } catch {
      toast.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const updateStatus = async (id: string, status: string) => {
    setActionLoading(id);
    try {
      await axios.patch(`/api/campaigns/${id}`, { status });
      setCampaigns(prev =>
        prev.map(c => c.id === id ? { ...c, status: status as Campaign['status'] } : c)
      );
      toast.success(`Campaign ${status === 'active' ? 'activated' : 'paused'}`);
    } catch {
      toast.error('Failed to update campaign');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteCampaign = async (id: string) => {
    if (!confirm('Delete this campaign? All leads will be removed.')) return;
    setActionLoading(id);
    try {
      await axios.delete(`/api/campaigns/${id}`);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast.success('Campaign deleted');
    } catch {
      toast.error('Failed to delete campaign');
    } finally {
      setActionLoading(null);
    }
  };

  const activeCampaigns = campaigns.filter(c => c.status === 'active').length;

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle={
          !loading && campaigns.length
            ? `${campaigns.length} total · ${activeCampaigns} active`
            : undefined
        }
        actions={
          <Link
            href="/dashboard/campaigns/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        }
      />

      <div className="p-8">
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60">
                  <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-5 py-3">
                    Campaign
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                    Daily progress
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                    Total actions
                  </th>
                  <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                    Created
                  </th>
                  <th className="px-5 py-3 w-10" />
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-50">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyCampaigns />
                    </td>
                  </tr>
                ) : (
                  campaigns.map((campaign) => (
                    <tr
                      key={campaign.id}
                      className="group hover:bg-zinc-50/80 transition-colors"
                    >
                      {/* Name + description */}
                      <td className="px-5 py-4 max-w-xs">
                        <div className="flex items-start gap-3">
                          {/* Status indicator dot */}
                          <span
                            className={cn(
                              'mt-1.5 h-2 w-2 rounded-full shrink-0',
                              campaign.status === 'active'  && 'bg-emerald-400',
                              campaign.status === 'paused'  && 'bg-amber-400',
                              campaign.status === 'draft'   && 'bg-zinc-300',
                              campaign.status === 'archived'&& 'bg-zinc-200',
                              campaign.status === 'completed'&& 'bg-blue-400',
                            )}
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/campaigns/${campaign.id}`}
                              className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 hover:text-indigo-600 transition-colors group/link"
                            >
                              {campaign.name}
                              <ArrowUpRight className="h-3 w-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                            </Link>
                            {campaign.description && (
                              <p className="text-xs text-zinc-400 mt-0.5 truncate">
                                {campaign.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-4">
                        <StatusBadge status={campaign.status} />
                      </td>

                      {/* Daily progress bar */}
                      <td className="px-4 py-4">
                        <DailyProgress today={campaign.actions_today} limit={campaign.daily_limit} />
                      </td>

                      {/* Total actions */}
                      <td className="px-4 py-4">
                        <span className="text-sm text-zinc-700 tabular-nums font-medium">
                          {(campaign.actions_total || 0).toLocaleString()}
                        </span>
                      </td>

                      {/* Created date */}
                      <td className="px-4 py-4">
                        <span className="text-xs text-zinc-400">
                          {formatDate(campaign.created_at)}
                        </span>
                      </td>

                      {/* Row menu */}
                      <td className="px-5 py-4">
                        <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <RowMenu
                            campaign={campaign}
                            loading={actionLoading === campaign.id}
                            onToggle={() =>
                              updateStatus(
                                campaign.id,
                                campaign.status === 'active' ? 'paused' : 'active'
                              )
                            }
                            onDelete={() => deleteCampaign(campaign.id)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer count */}
          {!loading && campaigns.length > 0 && (
            <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50/40">
              <p className="text-xs text-zinc-400">
                {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
