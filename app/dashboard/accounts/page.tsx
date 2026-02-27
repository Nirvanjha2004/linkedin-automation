'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import { LinkedInAccount } from '@/types';
import { Linkedin, Plus, CheckCircle, XCircle, ExternalLink, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// ─── Daily Invite Progress Bar ───────────────────────────────────────────────

function DailyInviteBar({ sent, limit }: { sent: number; limit: number }) {
  const pct = limit > 0 ? Math.min((sent / limit) * 100, 100) : 0;
  const atLimit = sent >= limit;
  const nearLimit = pct >= 70 && !atLimit;

  // Compute "resets in X hours" (midnight UTC)
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const hoursUntilReset = Math.ceil((midnight.getTime() - now.getTime()) / (1000 * 60 * 60));

  const barColor = atLimit
    ? 'bg-red-500'
    : nearLimit
    ? 'bg-amber-400'
    : 'bg-blue-500';

  const labelColor = atLimit
    ? 'text-red-600'
    : nearLimit
    ? 'text-amber-600'
    : 'text-gray-500';

  return (
    <div className="mt-3 mb-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {atLimit && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
          <span className={`text-xs font-medium ${labelColor}`}>
            {atLimit ? 'Daily limit reached' : nearLimit ? 'Approaching limit' : 'Invites today'}
          </span>
        </div>
        <span className={`text-xs font-semibold tabular-nums ${labelColor}`}>
          {sent} / {limit}
        </span>
      </div>

      {/* Track */}
      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Resets in X hours — only shown when at/near limit */}
      {(atLimit || nearLimit) && (
        <p className="text-[10px] text-gray-400 mt-1">
          Resets in ~{hoursUntilReset}h (midnight UTC)
        </p>
      )}
    </div>
  );
}

function AccountsContent() {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const searchParams = useSearchParams();

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/accounts');
      setAccounts(data.accounts || []);
    } catch {
      toast.error('Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      if (searchParams.get('connected') === 'true') {
        // Sync newly connected Unipile account into Supabase
        try {
          await axios.post('/api/accounts/sync');
        } catch {
          // ignore sync errors, still show success
        }
        toast.success('LinkedIn account connected successfully!');
      }
      if (searchParams.get('error') === 'true') {
        toast.error('Failed to connect LinkedIn account');
      }
      await fetchAccounts();
    };
    init();
  }, [fetchAccounts, searchParams]);

  const connectAccount = async () => {
    setConnecting(true);
    try {
      const { data } = await axios.post('/api/accounts/link');
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      toast.error('Failed to get connection link');
      setConnecting(false);
    }
  };

  const deleteAccount = async (id: string) => {
    if (!confirm('Remove this LinkedIn account? Any campaigns using it will be affected.')) return;
    try {
      await axios.delete(`/api/accounts/${id}`);
      setAccounts(prev => prev.filter(a => a.id !== id));
      toast.success('Account removed');
    } catch {
      toast.error('Failed to remove account');
    }
  };

  return (
    <div>
      <Header
        title="LinkedIn Accounts"
        subtitle="Connect your LinkedIn accounts to run campaigns"
        actions={
          <button
            onClick={connectAccount}
            disabled={connecting}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Connect Account
          </button>
        }
      />

      <div className="p-8">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <div className="bg-blue-50 rounded-xl p-4 w-fit mx-auto mb-4">
              <Linkedin className="h-10 w-10 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No LinkedIn accounts connected</h3>
            <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">
              Connect your LinkedIn account via Unipile to start running automated outreach campaigns
            </p>
            <button
              onClick={connectAccount}
              disabled={connecting}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Connect LinkedIn Account
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {accounts.map((account) => {
              const atLimit = account.daily_invites_sent >= account.daily_limit;
              return (
                <div
                  key={account.id}
                  className={`bg-white rounded-xl border p-6 transition-colors ${
                    atLimit ? 'border-red-200' : 'border-gray-100'
                  }`}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-lg p-2 ${atLimit ? 'bg-red-50' : 'bg-blue-50'}`}>
                        <Linkedin className={`h-6 w-6 ${atLimit ? 'text-red-500' : 'text-blue-600'}`} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{account.name}</p>
                        {account.email && (
                          <p className="text-xs text-gray-400">{account.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {account.is_active ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400" />
                      )}
                    </div>
                  </div>

                  {/* Daily invite progress bar */}
                  <DailyInviteBar
                    sent={account.daily_invites_sent ?? 0}
                    limit={account.daily_limit ?? 20}
                  />

                  {/* Footer row */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      account.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {account.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <div className="flex items-center gap-1">
                      {account.profile_url && (
                        <a
                          href={account.profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => deleteAccount(account.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add more */}
            <button
              onClick={connectAccount}
              disabled={connecting}
              className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 p-6 flex flex-col items-center justify-center gap-3 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              {connecting ? (
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              ) : (
                <Plus className="h-6 w-6 text-gray-400" />
              )}
              <span className="text-sm text-gray-500">Connect another account</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>}>
      <AccountsContent />
    </Suspense>
  );
}