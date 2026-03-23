'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { User, Key, Shield, Save, Loader2 } from 'lucide-react';

const inputCls = 'w-full px-3 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

export default function SettingsPage() {
  const [user, setUser] = useState<{ email?: string; user_metadata?: { full_name?: string } } | null>(null);
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetchUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    setFullName(user?.user_metadata?.full_name || '');
  }, [supabase]);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const saveProfile = async () => {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (error) toast.error(error.message);
    else toast.success('Profile updated');
    setSaving(false);
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your account and preferences" />

      <div className="p-8 max-w-2xl space-y-5">
        <SectionCard title="Profile" description="Update your display name">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Full Name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">Email</label>
              <input type="email" value={user?.email || ''} disabled className={`${inputCls} bg-zinc-50 text-zinc-400 cursor-not-allowed`} />
            </div>
            <button
              onClick={saveProfile}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </SectionCard>

        <SectionCard title="LinkedIn Safety Limits" description="Enforced automatically to protect your account">
          <div className="divide-y divide-zinc-100">
            {[
              ['Max connections per hour', '20'],
              ['Max connections per day', '200'],
              ['Min delay between actions', '30–90 seconds'],
              ['Connection note max length', '300 characters'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2.5">
                <span className="text-sm text-zinc-600">{label}</span>
                <span className="text-sm font-semibold text-zinc-900 tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="API Configuration" description="Credentials are managed via environment variables">
          <div className="bg-zinc-50 rounded-lg p-4 space-y-1.5 text-xs font-mono text-zinc-500">
            <p>UNIPILE_API_KEY=configured</p>
            <p>UPSTASH_REDIS=configured</p>
            <p>SUPABASE=configured</p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
