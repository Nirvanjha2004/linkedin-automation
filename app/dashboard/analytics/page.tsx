'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import {
  TrendingUp, Users, MessageSquare, UserCheck,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampaignStat {
  id: string;
  name: string;
  status: string;
  actions_today: number;
  actions_total: number;
  stats?: {
    total_leads: number;
    connected: number;
    message_sent: number;
    replied: number;
    failed: number;
  };
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const SERIES = [
  { key: 'connected', label: 'Connected', color: '#6366f1' },
  { key: 'messaged',  label: 'Messaged',  color: '#8b5cf6' },
  { key: 'replied',   label: 'Replied',   color: '#10b981' },
] as const;

const PIE_COLORS = ['#6366f1', '#10b981', '#8b5cf6', '#f59e0b'];

// ─── Stat card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  trend?: 'up' | 'down' | 'neutral';
  trendLabel?: string;
}

function KpiCard({ label, value, sub, icon: Icon, iconColor, iconBg, trend, trendLabel }: KpiCardProps) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const trendColor = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-500' : 'text-zinc-400';

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>
        {trend && trendLabel && (
          <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', trendColor)}>
            <TrendIcon className="h-3.5 w-3.5" />
            {trendLabel}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-semibold text-zinc-900 tabular-nums leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-sm font-medium text-zinc-600 mt-1">{label}</p>
        {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('bg-white rounded-xl border border-zinc-200 overflow-hidden', className)}>
      <div className="px-5 pt-5 pb-4 border-b border-zinc-100">
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
        {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

type RechartsPayloadItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
};

function BarTooltip({ active, payload, label }: TooltipProps<number, string> & { label?: string; payload?: RechartsPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl shadow-md px-3.5 py-3 text-xs min-w-[130px]">
      <p className="font-semibold text-zinc-700 mb-2 truncate max-w-[160px]">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-zinc-500">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
            {String(p.name ?? '')}
          </span>
          <span className="font-semibold text-zinc-800 tabular-nums">{p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: TooltipProps<number, string> & { payload?: RechartsPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const fill = (p.payload?.fill as string | undefined) ?? p.color;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl shadow-md px-3.5 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: fill }} />
        <span className="text-zinc-600">{String(p.name ?? '')}</span>
        <span className="font-semibold text-zinc-900 tabular-nums ml-1">{p.value?.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ─── Chart legend ─────────────────────────────────────────────────────────────

function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map(item => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: item.color }} />
          <span className="text-xs text-zinc-500">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Rate pill ────────────────────────────────────────────────────────────────

function RatePill({ rate }: { rate: number }) {
  const color =
    rate >= 30 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
    rate >= 15 ? 'bg-amber-50 text-amber-700 ring-amber-200' :
                 'bg-zinc-100 text-zinc-500 ring-zinc-200';
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset tabular-nums', color)}>
      {rate}%
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-zinc-100 rounded animate-pulse', className)} />;
}

function PageSkeleton() {
  return (
    <div className="p-8 space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          </div>
        ))}
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[1, 2].map(i => (
          <div key={i} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-zinc-100 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="p-5">
              <Skeleton className="h-[260px] w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-zinc-100">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="divide-y divide-zinc-50">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-5 py-3.5 flex items-center gap-4">
              <Skeleton className="h-3.5 flex-1 max-w-[200px]" />
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-3.5 w-12 ml-auto" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAnalytics() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mb-4">
        <TrendingUp className="h-6 w-6 text-indigo-400" />
      </div>
      <p className="text-sm font-semibold text-zinc-700 mb-1">No data yet</p>
      <p className="text-sm text-zinc-400 max-w-xs">
        Create and activate campaigns to start seeing analytics here
      </p>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
      {children}
    </p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [campaigns, setCampaigns] = useState<CampaignStat[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/campaigns');
      const cams: CampaignStat[] = data.campaigns || [];

      // Fetch all leads in one shot instead of N+1 per-campaign requests
      const { data: leadsData } = await axios.get('/api/leads?limit=10000');
      const allLeads: Array<{ campaign_id: string; status: string }> = leadsData.leads || [];

      // Group lead counts by campaign_id
      type LeadStats = { total_leads: number; connected: number; message_sent: number; replied: number; failed: number };
      const leadsByCampaign = new Map<string, LeadStats>();
      for (const lead of allLeads) {
        if (!leadsByCampaign.has(lead.campaign_id)) {
          leadsByCampaign.set(lead.campaign_id, {
            total_leads: 0, connected: 0, message_sent: 0, replied: 0, failed: 0,
          });
        }
        const s = leadsByCampaign.get(lead.campaign_id)!;
        s.total_leads++;
        if (lead.status === 'connected')                                          s.connected++;
        // message_sent covers all statuses that come after the initial message
        if (['message_sent', 'followup_1_sent', 'followup_2_sent',
             'replied', 'completed'].includes(lead.status))                       s.message_sent++;
        if (lead.status === 'replied')                                            s.replied++;
        if (lead.status === 'failed')                                             s.failed++;
      }

      const withStats = cams.map((c) => ({
        ...c,
        stats: leadsByCampaign.get(c.id) ?? {
          total_leads: 0, connected: 0, message_sent: 0, replied: 0, failed: 0,
        },
      }));

      setCampaigns(withStats);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived metrics ──────────────────────────────────────────────────────────

  const totalLeads     = campaigns.reduce((s, c) => s + (c.stats?.total_leads || 0), 0);
  const totalConnected = campaigns.reduce((s, c) => s + (c.stats?.connected    || 0), 0);
  const totalMessaged  = campaigns.reduce((s, c) => s + (c.stats?.message_sent || 0), 0);
  const totalReplied   = campaigns.reduce((s, c) => s + (c.stats?.replied      || 0), 0);
  const connectionRate = totalLeads     > 0 ? Math.round((totalConnected / totalLeads)     * 100) : 0;
  const replyRate      = totalConnected > 0 ? Math.round((totalReplied   / totalConnected) * 100) : 0;

  const barData = campaigns.map(c => ({
    name:      c.name.length > 16 ? c.name.slice(0, 16) + '…' : c.name,
    connected: c.stats?.connected    || 0,
    messaged:  c.stats?.message_sent || 0,
    replied:   c.stats?.replied      || 0,
  }));

  const pieData = [
    { name: 'Connected', value: totalConnected },
    { name: 'Messaged',  value: totalMessaged  },
    { name: 'Replied',   value: totalReplied   },
    { name: 'Pending',   value: Math.max(0, totalLeads - totalConnected) },
  ].filter(d => d.value > 0);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return (
    <div>
      <PageHeader title="Analytics" subtitle="Campaign performance overview" />
      <PageSkeleton />
    </div>
  );

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Campaign performance overview" />

      <div className="p-8 space-y-10">

        {/* ── KPI row ── */}
        <section>
          <SectionLabel>Overview</SectionLabel>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Leads"
              value={totalLeads}
              sub="across all campaigns"
              icon={Users}
              iconColor="text-indigo-600"
              iconBg="bg-indigo-50"
            />
            <KpiCard
              label="Connected"
              value={totalConnected}
              sub={`${connectionRate}% connection rate`}
              icon={UserCheck}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-50"
              trend={connectionRate >= 20 ? 'up' : connectionRate > 0 ? 'neutral' : undefined}
              trendLabel={connectionRate > 0 ? `${connectionRate}%` : undefined}
            />
            <KpiCard
              label="Messaged"
              value={totalMessaged}
              sub="initial messages sent"
              icon={MessageSquare}
              iconColor="text-violet-600"
              iconBg="bg-violet-50"
            />
            <KpiCard
              label="Reply Rate"
              value={`${replyRate}%`}
              sub={`${totalReplied} replies received`}
              icon={TrendingUp}
              iconColor="text-emerald-600"
              iconBg="bg-emerald-50"
              trend={replyRate >= 15 ? 'up' : replyRate > 0 ? 'neutral' : undefined}
              trendLabel={replyRate > 0 ? `${replyRate}%` : undefined}
            />
          </div>
        </section>

        {campaigns.length === 0 ? (
          <EmptyAnalytics />
        ) : (
          <>
            {/* ── Charts ── */}
            <section>
              <SectionLabel>Performance</SectionLabel>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Bar chart */}
                <ChartCard
                  title="Actions by Campaign"
                  description="Connected, messaged, and replied per campaign"
                >
                  <ChartLegend items={SERIES.map(s => ({ label: s.label, color: s.color }))} />
                  <div className="mt-5">
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart
                        data={barData}
                        margin={{ top: 4, right: 4, left: -24, bottom: barData.length > 3 ? 48 : 8 }}
                        barCategoryGap="28%"
                        barGap={2}
                      >
                        <CartesianGrid
                          strokeDasharray="0"
                          stroke="#f4f4f5"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 11, fill: '#a1a1aa' }}
                          axisLine={false}
                          tickLine={false}
                          angle={barData.length > 3 ? -35 : 0}
                          textAnchor={barData.length > 3 ? 'end' : 'middle'}
                          interval={0}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#a1a1aa' }}
                          axisLine={false}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip content={<BarTooltip />} cursor={{ fill: '#f4f4f5', radius: 4 }} />
                        {SERIES.map(s => (
                          <Bar
                            key={s.key}
                            dataKey={s.key}
                            name={s.label}
                            fill={s.color}
                            radius={[3, 3, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>

                {/* Pie chart */}
                <ChartCard
                  title="Lead Status Distribution"
                  description="Breakdown of all leads by current status"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="46%"
                        innerRadius={60}
                        outerRadius={95}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={PIE_COLORS[i % PIE_COLORS.length]}
                            stroke="white"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: '12px', color: '#71717a', paddingTop: '8px' }}
                        formatter={(value) => (
                          <span style={{ color: '#52525b' }}>{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </section>

            {/* ── Breakdown table ── */}
            <section>
              <SectionLabel>Campaign breakdown</SectionLabel>
              <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-100 bg-zinc-50/60">
                        <th className="text-left text-xs font-medium text-zinc-400 uppercase tracking-wide px-5 py-3">
                          Campaign
                        </th>
                        <th className="text-right text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                          Leads
                        </th>
                        <th className="text-right text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                          Connected
                        </th>
                        <th className="text-right text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                          Messaged
                        </th>
                        <th className="text-right text-xs font-medium text-zinc-400 uppercase tracking-wide px-4 py-3">
                          Replied
                        </th>
                        <th className="text-right text-xs font-medium text-zinc-400 uppercase tracking-wide px-5 py-3">
                          Conn. rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {campaigns.map((c) => {
                        const total = c.stats?.total_leads || 0;
                        const conn  = c.stats?.connected   || 0;
                        const rate  = total > 0 ? Math.round((conn / total) * 100) : 0;
                        return (
                          <tr key={c.id} className="hover:bg-zinc-50/80 transition-colors group">
                            {/* Name + status dot */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <span className={cn(
                                  'h-2 w-2 rounded-full shrink-0',
                                  c.status === 'active'   && 'bg-emerald-400',
                                  c.status === 'paused'   && 'bg-amber-400',
                                  c.status === 'draft'    && 'bg-zinc-300',
                                  c.status === 'archived' && 'bg-zinc-200',
                                  c.status === 'completed'&& 'bg-blue-400',
                                )} />
                                <span className="text-sm font-medium text-zinc-900 truncate max-w-[200px]">
                                  {c.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-sm text-zinc-600 tabular-nums">{total.toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-sm font-medium text-indigo-600 tabular-nums">{conn.toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-sm text-violet-600 tabular-nums">{(c.stats?.message_sent || 0).toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="text-sm text-emerald-600 tabular-nums">{(c.stats?.replied || 0).toLocaleString()}</span>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <RatePill rate={rate} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Totals footer */}
                    <tfoot>
                      <tr className="border-t border-zinc-200 bg-zinc-50/60">
                        <td className="px-5 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                          Total
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-zinc-700 tabular-nums">
                          {totalLeads.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-indigo-700 tabular-nums">
                          {totalConnected.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-violet-700 tabular-nums">
                          {totalMessaged.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-emerald-700 tabular-nums">
                          {totalReplied.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <RatePill rate={connectionRate} />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </section>

          </>
        )}
      </div>
    </div>
  );
}
