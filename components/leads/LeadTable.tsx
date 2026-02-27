'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Lead } from '@/types';
import { formatDateTime, getStatusColor } from '@/lib/utils';
import { ExternalLink, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

interface LeadTableProps {
  campaignId?: string;
}

/** Small circular avatar — shows profile pic if available, initials fallback otherwise */
function LeadAvatar({ lead }: { lead: Lead }) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = (lead.first_name?.[0] ?? lead.full_name?.[0] ?? '?').toUpperCase();

  if (lead.profile_pic_url && !imgFailed) {
    return (
      <img
        src={lead.profile_pic_url}
        alt={lead.full_name ?? ''}
        onError={() => setImgFailed(true)}
        className="h-8 w-8 rounded-full object-cover shrink-0 bg-gray-100 border border-gray-200"
      />
    );
  }

  return (
    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold shrink-0 flex items-center justify-center border border-blue-200">
      {initial}
    </div>
  );
}

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
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (campaignId) params.append('campaign_id', campaignId);
      if (statusFilter) params.append('status', statusFilter);

      const { data } = await axios.get(`/api/leads?${params}`);
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [campaignId, page, statusFilter]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const STATUS_OPTIONS = [
    'pending', 'connection_sent', 'connected', 'message_sent',
    'replied', 'followup_sent', 'completed', 'failed', 'skipped',
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Filters */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <p className="text-sm text-gray-500">{total} leads total</p>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {leads.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No leads found. Upload a CSV to get started.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Company / Title</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">Last Action</th>
                  <th className="text-left text-xs font-medium text-gray-500 px-4 py-3">LinkedIn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                    {/* Name + avatar */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <LeadAvatar lead={lead} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {lead.full_name || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || '—'}
                          </p>
                          {lead.headline && (
                            <p className="text-xs text-gray-400 truncate max-w-[180px]">{lead.headline}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-600">{lead.company || '—'}</p>
                      {lead.title && <p className="text-xs text-gray-400">{lead.title}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(lead.status)}`}>
                        {lead.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {formatDateTime(lead.last_action_at)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={lead.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">Page {page} of {pages}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 hover:bg-gray-100 rounded-lg disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-500" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="p-1.5 hover:bg-gray-100 rounded-lg disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="h-4 w-4 text-gray-500" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}