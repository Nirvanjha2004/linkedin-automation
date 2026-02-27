'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Header from '@/components/layout/Header';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { TrendingUp, Users, MessageSquare, UserCheck, Loader2 } from 'lucide-react';

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

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#6b7280'];

export default function AnalyticsPage() {
  const [campaigns, setCampaigns] = useState<CampaignStat[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/campaigns');
      const cams = data.campaigns || [];
      
      // Fetch stats for each campaign
      const withStats = await Promise.all(
        cams.map(async (c: CampaignStat) => {
          try {
            const { data: detail } = await axios.get(`/api/campaigns/${c.id}`);
            return { ...c, stats: detail.campaign.stats };
          } catch {
            return c;
          }
        })
      );
      setCampaigns(withStats);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalLeads = campaigns.reduce((s, c) => s + (c.stats?.total_leads || 0), 0);
  const totalConnected = campaigns.reduce((s, c) => s + (c.stats?.connected || 0), 0);
  const totalMessaged = campaigns.reduce((s, c) => s + (c.stats?.message_sent || 0), 0);
  const totalReplied = campaigns.reduce((s, c) => s + (c.stats?.replied || 0), 0);
  const connectionRate = totalLeads > 0 ? Math.round((totalConnected / totalLeads) * 100) : 0;
  const replyRate = totalConnected > 0 ? Math.round((totalReplied / totalConnected) * 100) : 0;

  const barData = campaigns.map(c => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + '...' : c.name,
    connected: c.stats?.connected || 0,
    messaged: c.stats?.message_sent || 0,
    replied: c.stats?.replied || 0,
  }));

  const pieData = [
    { name: 'Connected', value: totalConnected },
    { name: 'Messaged', value: totalMessaged },
    { name: 'Replied', value: totalReplied },
    { name: 'Pending', value: totalLeads - totalConnected },
  ].filter(d => d.value > 0);

  return (
    <div>
      <Header title="Analytics" subtitle="Campaign performance overview" />

      <div className="p-8 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { label: 'Total Leads', value: totalLeads, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Connected', value: `${totalConnected} (${connectionRate}%)`, icon: UserCheck, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Messaged', value: totalMessaged, icon: MessageSquare, color: 'text-purple-600', bg: 'bg-purple-50' },
                { label: 'Reply Rate', value: `${replyRate}%`, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              ].map((stat) => (
                <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-5">
                  <div className={`${stat.bg} rounded-lg p-2.5 w-fit mb-3`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {campaigns.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                <TrendingUp className="h-12 w-12 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">No campaign data yet. Create and activate campaigns to see analytics.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Bar chart */}
                <div className="bg-white rounded-xl border border-gray-100 p-6">
                  <h3 className="font-semibold text-gray-900 mb-5">Performance by Campaign</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis 
                        dataKey="name" 
                        tick={{ fontSize: 11 }} 
                        angle={-35} 
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="connected" fill="#3b82f6" name="Connected" radius={[4,4,0,0]} />
                      <Bar dataKey="messaged" fill="#8b5cf6" name="Messaged" radius={[4,4,0,0]} />
                      <Bar dataKey="replied" fill="#10b981" name="Replied" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Pie chart */}
                <div className="bg-white rounded-xl border border-gray-100 p-6">
                  <h3 className="font-semibold text-gray-900 mb-5">Lead Status Distribution</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="45%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                        labelLine={false}
                      >
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Campaign table */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="p-5 border-b border-gray-100">
                    <h3 className="font-semibold text-gray-900">Campaign Breakdown</h3>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs font-medium text-gray-500 px-5 py-3">Campaign</th>
                        <th className="text-right text-xs font-medium text-gray-500 px-4 py-3">Leads</th>
                        <th className="text-right text-xs font-medium text-gray-500 px-4 py-3">Connected</th>
                        <th className="text-right text-xs font-medium text-gray-500 px-4 py-3">Messaged</th>
                        <th className="text-right text-xs font-medium text-gray-500 px-4 py-3">Replied</th>
                        <th className="text-right text-xs font-medium text-gray-500 px-5 py-3">Conn. Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {campaigns.map((c) => {
                        const total = c.stats?.total_leads || 0;
                        const conn = c.stats?.connected || 0;
                        const rate = total > 0 ? Math.round((conn / total) * 100) : 0;
                        return (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 text-sm font-medium text-gray-900">{c.name}</td>
                            <td className="px-4 py-3 text-sm text-right text-gray-600">{total}</td>
                            <td className="px-4 py-3 text-sm text-right text-blue-600 font-medium">{conn}</td>
                            <td className="px-4 py-3 text-sm text-right text-purple-600">{c.stats?.message_sent || 0}</td>
                            <td className="px-4 py-3 text-sm text-right text-green-600">{c.stats?.replied || 0}</td>
                            <td className="px-5 py-3 text-sm text-right font-semibold text-gray-900">{rate}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
