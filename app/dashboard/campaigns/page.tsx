'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import { Campaign } from '@/types';
import { formatDate, getStatusColor } from '@/lib/utils';
import { 
  Plus, Play, Pause, Trash2, Users, Calendar, 
  MoreHorizontal, Loader2, Megaphone
} from 'lucide-react';

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
      setCampaigns(prev => prev.map(c => c.id === id ? { ...c, status: status as Campaign['status'] } : c));
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

  return (
    <div>
      <Header
        title="Campaigns"
        subtitle={`${campaigns.length} total campaigns`}
        actions={
          <Link
            href="/dashboard/campaigns/new"
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        }
      />

      <div className="p-8">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-20">
            <Megaphone className="h-12 w-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No campaigns yet</h3>
            <p className="text-gray-400 text-sm mb-6">Create your first campaign to start automating LinkedIn outreach</p>
            <Link
              href="/dashboard/campaigns/new"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Campaign
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 px-6 py-3.5">Campaign</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3.5">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3.5">Today</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3.5">Total</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3.5">Created</th>
                  <th className="text-right text-xs font-medium text-gray-500 px-6 py-3.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <Link href={`/dashboard/campaigns/${campaign.id}`} className="hover:underline">
                        <p className="text-sm font-medium text-gray-900">{campaign.name}</p>
                        {campaign.description && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{campaign.description}</p>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(campaign.status)}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">
                      {campaign.actions_today}/{campaign.daily_limit}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">
                      {campaign.actions_total || 0}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-400">
                      {formatDate(campaign.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {actionLoading === campaign.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                        ) : (
                          <>
                            {campaign.status === 'active' ? (
                              <button
                                onClick={() => updateStatus(campaign.id, 'paused')}
                                className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                                title="Pause"
                              >
                                <Pause className="h-4 w-4" />
                              </button>
                            ) : campaign.status !== 'archived' && (
                              <button
                                onClick={() => updateStatus(campaign.id, 'active')}
                                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                title="Activate"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            )}
                            <Link
                              href={`/dashboard/campaigns/${campaign.id}`}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="View leads"
                            >
                              <Users className="h-4 w-4" />
                            </Link>
                            <Link
                              href={`/dashboard/campaigns/${campaign.id}?tab=schedule`}
                              className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Schedule"
                            >
                              <Calendar className="h-4 w-4" />
                            </Link>
                            <button
                              onClick={() => deleteCampaign(campaign.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
