'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { 
  Megaphone, Users, UserCheck, MessageSquare, 
  TrendingUp, ArrowRight, Play, Clock, Loader2 
} from 'lucide-react';
import { getStatusColor } from '@/lib/utils';

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
      const { data: campaignsData } = await axios.get('/api/campaigns');
      const campaigns = campaignsData.campaigns || [];
      
      const dashboard: DashboardData = {
        total_campaigns: campaigns.length,
        active_campaigns: campaigns.filter((c: { status: string }) => c.status === 'active').length,
        total_leads: 0,
        connections_sent: 0,
        messages_sent: 0,
        replied: 0,
        recent_campaigns: campaigns.slice(0, 5),
      };
      
      setData(dashboard);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const stats = [
    {
      label: 'Total Campaigns',
      value: data?.total_campaigns ?? 0,
      sub: `${data?.active_campaigns ?? 0} active`,
      icon: Megaphone,
      color: '#2563eb',
      bg: '#eff6ff',
      href: '/dashboard/campaigns',
    },
    {
      label: 'Total Leads',
      value: data?.total_leads ?? 0,
      sub: 'across all campaigns',
      icon: Users,
      color: '#7c3aed',
      bg: '#f5f3ff',
      href: '/dashboard/leads',
    },
    {
      label: 'Connections Sent',
      value: data?.connections_sent ?? 0,
      sub: 'LinkedIn invites',
      icon: UserCheck,
      color: '#059669',
      bg: '#ecfdf5',
      href: '/dashboard/analytics',
    },
    {
      label: 'Messages Sent',
      value: data?.messages_sent ?? 0,
      sub: 'total messages',
      icon: MessageSquare,
      color: '#d97706',
      bg: '#fffbeb',
      href: '/dashboard/analytics',
    },
  ];

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle="Your LinkedIn outreach overview"
        actions={
          <Link
            href="/dashboard/campaigns/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
              background: '#2563eb',
              color: 'white',
              borderRadius: '8px',
              fontSize: '13.5px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <Play style={{ width: '14px', height: '14px' }} />
            New Campaign
          </Link>
        }
      />

      <div style={{ padding: '32px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
            <Loader2 style={{ width: '24px', height: '24px', color: '#2563eb', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '32px',
            }}>
              {stats.map((stat) => (
                <Link
                  key={stat.label}
                  href={stat.href}
                  style={{
                    background: 'white',
                    borderRadius: '12px',
                    border: '1px solid #f3f4f6',
                    padding: '20px',
                    textDecoration: 'none',
                    display: 'block',
                    transition: 'box-shadow 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                >
                  <div style={{
                    background: stat.bg,
                    borderRadius: '10px',
                    padding: '10px',
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '12px',
                  }}>
                    <stat.icon style={{ width: '20px', height: '20px', color: stat.color }} />
                  </div>
                  <p style={{ fontSize: '28px', fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
                    {stat.value.toLocaleString()}
                  </p>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#374151', margin: '0 0 2px' }}>
                    {stat.label}
                  </p>
                  <p style={{ fontSize: '12px', color: '#9ca3af', margin: 0 }}>{stat.sub}</p>
                </Link>
              ))}
            </div>

            {/* Recent Campaigns */}
            <div style={{
              background: 'white',
              borderRadius: '12px',
              border: '1px solid #f3f4f6',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid #f9fafb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp style={{ width: '16px', height: '16px', color: '#2563eb' }} />
                  Recent Campaigns
                </h2>
                <Link href="/dashboard/campaigns" style={{ fontSize: '13px', color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  View all <ArrowRight style={{ width: '14px', height: '14px' }} />
                </Link>
              </div>

              {data?.recent_campaigns.length === 0 ? (
                <div style={{ padding: '48px', textAlign: 'center' }}>
                  <Clock style={{ width: '40px', height: '40px', color: '#d1d5db', margin: '0 auto 12px' }} />
                  <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 16px' }}>No campaigns yet</p>
                  <Link
                    href="/dashboard/campaigns/new"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 16px',
                      background: '#eff6ff',
                      color: '#2563eb',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    Create your first campaign
                  </Link>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f9fafb' }}>
                      {['Campaign', 'Status', "Today's Actions", 'Total'].map(h => (
                        <th key={h} style={{
                          textAlign: 'left',
                          padding: '10px 20px',
                          fontSize: '12px',
                          fontWeight: 500,
                          color: '#6b7280',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.recent_campaigns.map((campaign) => (
                      <tr key={campaign.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                        <td style={{ padding: '12px 20px' }}>
                          <Link href={`/dashboard/campaigns/${campaign.id}`} style={{
                            fontSize: '14px',
                            fontWeight: 500,
                            color: '#111827',
                            textDecoration: 'none',
                          }}>
                            {campaign.name}
                          </Link>
                        </td>
                        <td style={{ padding: '12px 20px' }}>
                          <span style={{
                            fontSize: '12px',
                            padding: '3px 10px',
                            borderRadius: '99px',
                            fontWeight: 500,
                          }} className={getStatusColor(campaign.status)}>
                            {campaign.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 20px', fontSize: '14px', color: '#374151' }}>
                          {campaign.actions_today}/{campaign.daily_limit}
                        </td>
                        <td style={{ padding: '12px 20px', fontSize: '14px', color: '#374151' }}>
                          {campaign.actions_total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
