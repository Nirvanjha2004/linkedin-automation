'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkedInAccount } from '@/types';
import {
  Linkedin, Plus, CheckCircle, XCircle, ExternalLink,
  Loader2, Trash2, AlertTriangle, Key, X, ChevronRight,
} from 'lucide-react';

function DailyInviteBar({ sent, limit }: { sent: number; limit: number }) {
  const pct = limit > 0 ? Math.min((sent / limit) * 100, 100) : 0;
  const atLimit = sent >= limit;
  const nearLimit = pct >= 70 && !atLimit;
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const hoursLeft = Math.ceil((midnight.getTime() - now.getTime()) / 3_600_000);
  const barColor = atLimit ? 'bg-red-500' : nearLimit ? 'bg-amber-400' : 'bg-indigo-500';
  const labelColor = atLimit ? 'text-red-600' : nearLimit ? 'text-amber-600' : 'text-zinc-500';

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-medium flex items-center gap-1 ${labelColor}`}>
          {atLimit && <AlertTriangle className="h-3 w-3" />}
          {atLimit ? 'Limit reached' : nearLimit ? 'Near limit' : 'Invites today'}
        </span>
        <span className={`text-xs font-semibold tabular-nums ${labelColor}`}>{sent}/{limit}</span>
      </div>
      <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {(atLimit || nearLimit) && (
        <p className="text-[11px] text-zinc-400 mt-1">Resets in ~{hoursLeft}h (midnight UTC)</p>
      )}
    </div>
  );
}

function ConnectModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [liAt, setLiAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liAt.trim()) return;
    setLoading(true); setError('');
    try {
      await axios.post('/api/accounts/connect', { li_at: liAt.trim() });
      toast.success('LinkedIn account connected');
      onSuccess(); onClose();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.message ?? err.response?.data?.error ?? 'Connection failed'
        : 'Connection failed';
      setError(msg);
    } finally { setLoading(false); }
  };

  const steps = [
    <>Open <strong>linkedin.com</strong> and log in</>,
    <>Press <kbd className="bg-zinc-100 border border-zinc-200 rounded px-1.5 py-0.5 text-xs font-mono">F12</kbd> to open DevTools</>,
    <>Go to <strong>Application</strong> → <strong>Cookies</strong> → <code className="bg-zinc-100 px-1 rounded text-xs">linkedin.com</code></>,
    <>Copy the value of the <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-indigo-600 text-xs">li_at</code> cookie</>,
  ];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-zinc-200 w-full max-w-md shadow-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 rounded-lg p-2"><Linkedin className="h-4 w-4 text-indigo-600" /></div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">Connect LinkedIn Account</p>
              <p className="text-xs text-zinc-400">Paste your session cookie below</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-5">
          <p className="text-xs font-medium text-zinc-700 mb-3">How to get your <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-indigo-600">li_at</code> cookie:</p>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-xs text-zinc-600">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          <label className="block text-xs font-medium text-zinc-700 mb-1.5">
            <Key className="inline h-3.5 w-3.5 mr-1 text-zinc-400" />li_at value
          </label>
          <textarea
            value={liAt}
            onChange={e => setLiAt(e.target.value)}
            placeholder="AQEDAUSxiWADNIPm..."
            rows={3}
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono text-zinc-800 placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
          {error && (
            <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors">Cancel</button>
            <button type="submit" disabled={loading || !liAt.trim()} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Connect <ChevronRight className="h-4 w-4" /></>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AccountsContent() {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/accounts');
      setAccounts(data.accounts || []);
    } catch { toast.error('Failed to load accounts'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const deleteAccount = async (id: string) => {
    if (!confirm('Remove this LinkedIn account? Campaigns using it will be affected.')) return;
    try {
      await axios.delete(`/api/accounts/${id}`);
      setAccounts(prev => prev.filter(a => a.id !== id));
      toast.success('Account removed');
    } catch { toast.error('Failed to remove account'); }
  };

  return (
    <div>
      {showModal && <ConnectModal onClose={() => setShowModal(false)} onSuccess={fetchAccounts} />}

      <PageHeader
        title="LinkedIn Accounts"
        subtitle="Connect your LinkedIn accounts to run campaigns"
        actions={
          <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
            <Plus className="h-4 w-4" /> Connect Account
          </button>
        }
      />

      <div className="p-8">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={Linkedin}
            title="No LinkedIn accounts connected"
            description="Connect your LinkedIn account using your session cookie to start running automated outreach campaigns"
            action={
              <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                <Plus className="h-4 w-4" /> Connect Account
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map(account => {
              const atLimit = account.daily_invites_sent >= account.daily_limit;
              return (
                <div key={account.id} className={`bg-white rounded-xl border p-5 ${atLimit ? 'border-red-200' : 'border-zinc-200'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-lg p-2 ${atLimit ? 'bg-red-50' : 'bg-indigo-50'}`}>
                        <Linkedin className={`h-5 w-5 ${atLimit ? 'text-red-500' : 'text-indigo-600'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{account.name}</p>
                        {account.email && <p className="text-xs text-zinc-400">{account.email}</p>}
                      </div>
                    </div>
                    {account.is_active
                      ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                      : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                  </div>

                  <DailyInviteBar sent={account.daily_invites_sent ?? 0} limit={account.daily_limit ?? 20} />

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ring-1 ring-inset ${account.is_active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-600 ring-red-200'}`}>
                      {account.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <div className="flex items-center gap-1">
                      {account.profile_url && (
                        <a href={account.profile_url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button onClick={() => deleteAccount(account.id)} className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              onClick={() => setShowModal(true)}
              className="bg-zinc-50 rounded-xl border-2 border-dashed border-zinc-200 p-5 flex flex-col items-center justify-center gap-2 hover:border-indigo-300 hover:bg-indigo-50 transition-colors min-h-[160px]"
            >
              <Plus className="h-5 w-5 text-zinc-400" />
              <span className="text-sm text-zinc-500">Connect another account</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" /></div>}>
      <AccountsContent />
    </Suspense>
  );
}
