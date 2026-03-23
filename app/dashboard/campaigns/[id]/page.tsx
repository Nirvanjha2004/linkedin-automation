'use client';

import { useState, useEffect, useCallback, use } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge } from '@/components/ui/status-badge';
import CampaignForm from '@/components/campaigns/CampaignForm';
import CSVUploader from '@/components/leads/CSVUploader';
import LeadTable from '@/components/leads/LeadTable';
import { Campaign } from '@/types';
import { cn } from '@/lib/utils';
import {
  Play, Pause, Upload, Settings, Users, Loader2,
  UserCheck, MessageSquare, TrendingUp, X,
} from 'lucide-react';

type Tab = 'leads' | 'settings';

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('leads');
  const [showUploader, setShowUploader] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchCampaign = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/campaigns/${id}`);
      setCampaign(data.campaign);
    } catch { toast.error('Campaign not found'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);

  const toggleStatus = async () => {
    if (!campaign) return;
    setActionLoading(true);
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    try {
      await axios.patch(`/api/campaigns/${id}`, { status: newStatus });
      setCampaign({ ...campaign, status: newStatus as Campaign['status'] });
      toast.success(`Campaign ${newStatus === 'active' ? 'activated' : 'paused'}`);
    } catch { toast.error('Failed to update status'); }
    finally { setActionLoading(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" /></div>;
  if (!campaign) return <div className="p-8 text-center text-zinc-500">Campaign not found</div>;

  const stats = (campaign as Campaign & { stats?: Record<string, number> }).stats || {};

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={campaign.description}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={campaign.status} />
            <button
              onClick={toggleStatus}
              disabled={actionLoading}
              className={cn(
                'inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors',
                campaign.status === 'active'
                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              )}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" />
                : campaign.status === 'active' ? <><Pause className="h-4 w-4" /> Pause</>
                : <><Play className="h-4 w-4" /> Activate</>}
            </button>
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[
            { label: 'Total Leads', value: stats.total_leads || 0, icon: Users },
            { label: 'Pending', value: stats.pending || 0, icon: Users, iconColor: 'text-zinc-500', iconBg: 'bg-zinc-100' },
            { label: 'Connected', value: stats.connected || 0, icon: UserCheck, iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50' },
            { label: 'Messaged', value: stats.message_sent || 0, icon: MessageSquare, iconColor: 'text-violet-600', iconBg: 'bg-violet-50' },
            { label: 'Replied', value: stats.replied || 0, icon: TrendingUp, iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50' },
            { label: 'Today', value: campaign.actions_today || 0, icon: Play, iconColor: 'text-indigo-600', iconBg: 'bg-indigo-50' },
          ].map(s => (
            <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} iconColor={s.iconColor} iconBg={s.iconBg} />
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg w-fit">
          {([['leads', 'Leads', Users], ['settings', 'Settings', Settings]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all',
                activeTab === key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              )}
            >
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>

        {activeTab === 'leads' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-500">{stats.total_leads || 0} leads in this campaign</p>
              <button
                onClick={() => setShowUploader(!showUploader)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                {showUploader ? <><X className="h-4 w-4" /> Cancel</> : <><Upload className="h-4 w-4" /> Upload CSV</>}
              </button>
            </div>
            {showUploader && (
              <div className="mb-5">
                <CSVUploader campaignId={campaign.id} onSuccess={() => { setShowUploader(false); fetchCampaign(); }} />
              </div>
            )}
            <LeadTable campaignId={campaign.id} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-3xl">
            <CampaignForm campaign={campaign} onSuccess={updated => setCampaign(updated)} />
          </div>
        )}
      </div>
    </div>
  );
}
