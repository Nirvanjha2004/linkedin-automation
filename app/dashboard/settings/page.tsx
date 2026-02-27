'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import { User, Key, Bell, Shield, Save, Loader2 } from 'lucide-react';

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
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName },
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Profile updated!');
    }
    setSaving(false);
  };

  return (
    <div>
      <Header title="Settings" subtitle="Manage your account and preferences" />

      <div className="p-8 max-w-2xl space-y-6">
        {/* Profile */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
            <User className="h-4 w-4 text-blue-600" />
            Profile
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>
            <button
              onClick={saveProfile}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </div>

        {/* Rate Limits Info */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-600" />
            LinkedIn Safety Limits
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-600">Max connections per hour</span>
              <span className="font-semibold text-gray-900">20</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-600">Max connections per day</span>
              <span className="font-semibold text-gray-900">200</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-600">Min delay between actions</span>
              <span className="font-semibold text-gray-900">30–90 seconds</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-600">Connection note max length</span>
              <span className="font-semibold text-gray-900">300 characters</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            These limits are enforced automatically to keep your LinkedIn account safe from restrictions.
          </p>
        </div>

        {/* API Keys Info */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Key className="h-4 w-4 text-blue-600" />
            API Configuration
          </h2>
          <p className="text-sm text-gray-500">
            API keys and service credentials are configured via environment variables. 
            Contact your administrator to update Unipile, Supabase, or Redis credentials.
          </p>
          <div className="mt-4 bg-gray-50 rounded-lg p-4 space-y-2 text-xs font-mono text-gray-500">
            <p>UNIPILE_API_KEY=configured</p>
            <p>UPSTASH_REDIS=configured</p>
            <p>SUPABASE=configured</p>
          </div>
        </div>
      </div>
    </div>
  );
}
