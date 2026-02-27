'use client';

import { useState, useEffect, useCallback, use } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import CampaignForm from '@/components/campaigns/CampaignForm';
import CSVUploader from '@/components/leads/CSVUploader';
import LeadTable from '@/components/leads/LeadTable';
import { Campaign } from '@/types';
import { getStatusColor } from '@/lib/utils';
import { Play, Pause, Upload, Settings, Users, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    } catch {
      toast.error('Campaign not found');
    } finally {
      setLoading(false);
    }
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
    } catch {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="p-8 text-center text-gray-500">Campaign not found</div>
    );
  }

  const stats = (campaign as Campaign & { stats?: Record<string, number> }).stats || {};

  return (
    <div>
      <Header
        title={campaign.name}
        subtitle={campaign.description}
        actions={
          <div className="flex items-center gap-3">
            <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${getStatusColor(campaign.status)}`}>
              {campaign.status}
            </span>
            <button
              onClick={toggleStatus}
              disabled={actionLoading}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                campaign.status === 'active'
                  ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  : 'bg-green-50 text-green-700 hover:bg-green-100'
              )}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : campaign.status === 'active' ? (
                <><Pause className="h-4 w-4" /> Pause</>
              ) : (
                <><Play className="h-4 w-4" /> Activate</>
              )}
            </button>
          </div>
        }
      />

      <div className="p-8">
        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: 'Total Leads', value: stats.total_leads || 0 },
            { label: 'Pending', value: stats.pending || 0 },
            { label: 'Connected', value: stats.connected || 0 },
            { label: 'Messaged', value: stats.message_sent || 0 },
            { label: 'Replied', value: stats.replied || 0 },
            { label: 'Today', value: campaign.actions_today || 0 },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
          {[
            { key: 'leads' as Tab, label: 'Leads', icon: Users },
            { key: 'settings' as Tab, label: 'Settings', icon: Settings },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'leads' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">{stats.total_leads || 0} leads in this campaign</p>
              <button
                onClick={() => setShowUploader(!showUploader)}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <Upload className="h-4 w-4" />
                Upload CSV
              </button>
            </div>

            {showUploader && (
              <div className="mb-6">
                <CSVUploader
                  campaignId={campaign.id}
                  onSuccess={() => {
                    setShowUploader(false);
                    fetchCampaign();
                  }}
                />
              </div>
            )}

            <LeadTable campaignId={campaign.id} />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-3xl">
            <CampaignForm campaign={campaign} onSuccess={(updated) => setCampaign(updated)} />
          </div>
        )}
      </div>
    </div>
  );
}
