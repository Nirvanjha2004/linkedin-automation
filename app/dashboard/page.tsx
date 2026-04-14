'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import {
  Megaphone, Users, UserCheck, MessageSquare,
  ArrowRight, Plus, Clock,
} from 'lucide-react';

interface DashboardData {
  total_campaigns: number;
  active_campaigns: number;
  total_leads: number;
  connections_sent: number;
  messages_sent: number;
  replied: number;
  recent_campaigns: Array<{
    id: string;
    name: string;
    status: string;
    actions_today: number;
    daily_limit: number;
    actions_total: number;
  }>;
}

// ─── Skeleton primitives ──────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-zinc-100 rounded animate-pulse', className)} />;
}

function DashboardSkeleton() {
  return (
    <div className="p-8 space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-zinc-200 p-5 flex flex-col gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>

      {/* Recent campaigns card */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-14" />
        </div>
        <div className="divide-y divide-zinc-50">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-5 py-3.5 flex items-center gap-4">
              <Skeleton className="h-3.5 flex-1 max-w-[200px]" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3.5 w-12 ml-auto" />
              <Skeleton className="h-3.5 w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DashboardData {
  total_campaigns: number;
  active_campaigns: number;
  total_leads: number;
  connections_sent: number;
  messages_sent: number;
  replied: number;
  recent_campaigns: Array<{
    id: string;
    name: string;
    status: string;
    actions_today: number;
    daily_limit: number;
    actions_total: number;
  }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/dashboard');
      setData({
        total_campaigns:   data.stats.total_campaigns,
        active_campaigns:  data.stats.active_campaigns,
        total_leads:       data.stats.total_leads,
        connections_sent:  data.stats.connections_sent,
        messages_sent:     data.stats.messages_sent,
        replied:           data.stats.replied,
        recent_campaigns:  data.recent_campaigns || [],
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="Your LinkedIn outreach at a glance"
        actions={
          <Link href="/dashboard/campaigns/new" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        }
      />

      <div className="p-8 space-y-6">
        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Campaigns"
                value={data?.total_campaigns ?? 0}
                sub={`${data?.active_campaigns ?? 0} active · Last 30 days`}
                icon={Megaphone}
                href="/dashboard/campaigns"
              />
              <StatCard
                label="Total Leads"
                value={data?.total_leads === 0 ? '—' : (data?.total_leads ?? '—')}
                sub="across all campaigns"
                icon={Users}
                iconColor="text-violet-600"
                iconBg="bg-violet-50"
                href="/dashboard/leads"
              />
              <StatCard
                label="Connections Accepted"
                value={data?.connections_sent === 0 ? '—' : (data?.connections_sent ?? '—')}
                sub="all time"
                icon={UserCheck}
                iconColor="text-emerald-600"
                iconBg="bg-emerald-50"
                href="/dashboard/analytics"
              />
              <StatCard
                label="Messages Sent"
                value={data?.messages_sent === 0 ? '—' : (data?.messages_sent ?? '—')}
                sub="all time"
                icon={MessageSquare}
                iconColor="text-amber-600"
                iconBg="bg-amber-50"
                href="/dashboard/analytics"
              />
            </div>

            {/* Recent Campaigns */}
            <SectionCard
              title="Recent Campaigns"
              actions={
                <Link href="/dashboard/campaigns" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline font-medium">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
              noPadding
            >
              {!data?.recent_campaigns.length ? (
                <EmptyState
                  icon={Clock}
                  title="No campaigns yet"
                  description="Create your first campaign to start automating LinkedIn outreach"
                  action={
                    <Link href="/dashboard/campaigns/new" className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                      <Plus className="h-4 w-4" /> Create Campaign
                    </Link>
                  }
                />
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      {['Campaign', 'Status', "Today's Actions", 'Total'].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-zinc-400 px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {data?.recent_campaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link href={`/dashboard/campaigns/${c.id}`} className="text-sm font-medium text-zinc-900 hover:text-indigo-600 transition-colors">
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5"><StatusBadge status={c.status} /></td>
                        <td className="px-5 py-3.5 text-sm text-zinc-600 tabular-nums">{c.actions_today}/{c.daily_limit}</td>
                        <td className="px-5 py-3.5 text-sm text-zinc-600 tabular-nums">{c.actions_total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
