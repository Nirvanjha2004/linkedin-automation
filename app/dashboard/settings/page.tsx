'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  User, CreditCard, Plug, Shield, Loader2,
  Copy, Eye, EyeOff, Check, AlertTriangle,
  ChevronRight, Zap,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = 'profile' | 'billing' | 'integrations' | 'security';

interface UserData {
  email?: string;
  user_metadata?: { full_name?: string };
  last_sign_in_at?: string;
}

// ─── Input ────────────────────────────────────────────────────────────────────

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-zinc-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 border border-zinc-200 rounded-lg text-sm bg-white text-zinc-900 ' +
  'placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow';

const disabledInputCls =
  'w-full px-3 py-2.5 border border-zinc-100 rounded-lg text-sm bg-zinc-50 text-zinc-400 cursor-not-allowed';

// ─── Section card ─────────────────────────────────────────────────────────────

function SettingsSection({
  title, description, children, footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-zinc-100">
        <p className="text-base font-semibold text-zinc-900">{title}</p>
        {description && <p className="text-sm text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
      {footer && (
        <div className="px-6 py-4 bg-zinc-50/60 border-t border-zinc-100 flex items-center justify-end gap-3">
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── Danger zone card ─────────────────────────────────────────────────────────

function DangerSection({
  title, description, action,
}: { title: string; description: string; action: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div>
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

// ─── API key row ──────────────────────────────────────────────────────────────

function ApiKeyRow({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const masked = value.slice(0, 8) + '•'.repeat(24) + value.slice(-4);

  return (
    <div className="flex items-center gap-3 py-3 border-b border-zinc-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-500 mb-1">{label}</p>
        <p className="text-xs font-mono text-zinc-700 truncate">
          {visible ? value : masked}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setVisible(v => !v)}
          className="h-7 w-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
          title={visible ? 'Hide' : 'Reveal'}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={copy}
          className="h-7 w-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  open, title, description, confirmLabel, onConfirm, onCancel, destructive,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-white rounded-xl border border-zinc-200 shadow-xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900">{title}</p>
            <p className="text-sm text-zinc-500 mt-1">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'profile',      label: 'Profile',      icon: User      },
  { id: 'billing',      label: 'Billing',       icon: CreditCard },
  { id: 'integrations', label: 'Integrations',  icon: Plug      },
  { id: 'security',     label: 'Security',      icon: Shield    },
];

// ─── Sections ─────────────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: UserData | null }) {
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || '');
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    setFullName(user?.user_metadata?.full_name || '');
  }, [user]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (error) toast.error(error.message);
    else toast.success('Profile updated');
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Personal information"
        description="Update your name and email address"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setFullName(user?.user_metadata?.full_name || '')}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </>
        }
      >
        <Field label="Full name" hint="This is your display name across the app">
          <input
            type="text"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            className={inputCls}
            placeholder="Your name"
          />
        </Field>
        <Field label="Email address" hint="Email cannot be changed here — contact support">
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className={disabledInputCls}
          />
        </Field>
      </SettingsSection>

      <SettingsSection
        title="LinkedIn safety limits"
        description="These limits are enforced automatically to protect your LinkedIn account"
      >
        <div className="divide-y divide-zinc-50">
          {[
            ['Max connections per hour',    '20'],
            ['Max connections per day',     '200'],
            ['Min delay between actions',   '30–90 seconds'],
            ['Connection note max length',  '300 characters'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <span className="text-sm text-zinc-600">{label}</span>
              <span className="text-sm font-semibold text-zinc-900 tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

function BillingSection() {
  return (
    <div className="space-y-5">
      <SettingsSection title="Current plan" description="You are on the free plan">
        <div className="flex items-center justify-between p-4 rounded-lg bg-indigo-50 border border-indigo-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Zap className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-indigo-900">Free plan</p>
              <p className="text-xs text-indigo-600 mt-0.5">Up to 3 campaigns · 500 leads</p>
            </div>
          </div>
          <Button size="sm">Upgrade plan</Button>
        </div>

        <div className="space-y-3 pt-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Usage this month</p>
          {[
            { label: 'Campaigns', used: 2, max: 3 },
            { label: 'Leads',     used: 312, max: 500 },
          ].map(({ label, used, max }) => {
            const pct = Math.round((used / max) * 100);
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-zinc-600">{label}</span>
                  <span className="text-xs text-zinc-500 tabular-nums">{used} / {max}</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-indigo-500'
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Payment method" description="Manage your billing information">
        <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-200 bg-zinc-50/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white border border-zinc-200 flex items-center justify-center">
              <CreditCard className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm text-zinc-500">No payment method added</p>
              <p className="text-xs text-zinc-400 mt-0.5">Required for paid plans</p>
            </div>
          </div>
          <Button variant="outline" size="sm">Add card</Button>
        </div>
      </SettingsSection>
    </div>
  );
}

function IntegrationsSection() {
  const MOCK_KEYS = [
    { label: 'UNIPILE_API_KEY',   value: 'uni_live_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    { label: 'UPSTASH_REDIS_URL', value: 'rediss://default:xxxxxxxxxxxxxxxx@us1.upstash.io:6379' },
  ];

  return (
    <div className="space-y-5">
      <SettingsSection
        title="API keys"
        description="These credentials are used to connect your integrations"
      >
        <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100 px-4">
          {MOCK_KEYS.map(k => (
            <ApiKeyRow key={k.label} label={k.label} value={k.value} />
          ))}
        </div>
        <p className="text-xs text-zinc-400">
          Keys are read from environment variables and cannot be edited here. Contact your admin to rotate them.
        </p>
      </SettingsSection>

      <SettingsSection title="Connected services" description="Active integrations for your account">
        {[
          { name: 'LinkedIn via Unipile', status: 'Connected', color: 'text-emerald-600 bg-emerald-50 ring-emerald-200' },
          { name: 'Upstash Redis',        status: 'Connected', color: 'text-emerald-600 bg-emerald-50 ring-emerald-200' },
          { name: 'Supabase',             status: 'Connected', color: 'text-emerald-600 bg-emerald-50 ring-emerald-200' },
          { name: 'QStash',               status: 'Connected', color: 'text-emerald-600 bg-emerald-50 ring-emerald-200' },
        ].map(({ name, status, color }) => (
          <div key={name} className="flex items-center justify-between py-2.5 border-b border-zinc-50 last:border-0">
            <div className="flex items-center gap-2.5">
              <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-sm text-zinc-700">{name}</span>
            </div>
            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset', color)}>
              {status}
            </span>
          </div>
        ))}
      </SettingsSection>
    </div>
  );
}

function SecuritySection({ user }: { user: UserData | null }) {
  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [saving, setSaving]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const supabase = createClient();

  const changePassword = async () => {
    if (newPw !== confirmPw) { toast.error('Passwords do not match'); return; }
    if (newPw.length < 8)    { toast.error('Password must be at least 8 characters'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) toast.error(error.message);
    else { toast.success('Password updated'); setCurrentPw(''); setNewPw(''); setConfirmPw(''); }
    setSaving(false);
  };

  const lastLogin = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString(undefined, {
        dateStyle: 'medium', timeStyle: 'short',
      })
    : 'Unknown';

  return (
    <div className="space-y-5">
      <SettingsSection
        title="Change password"
        description="Use a strong password of at least 8 characters"
        footer={
          <Button size="sm" onClick={changePassword} disabled={saving || !newPw}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Update password
          </Button>
        }
      >
        <Field label="Current password">
          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className={inputCls} placeholder="••••••••" />
        </Field>
        <Field label="New password" hint="Minimum 8 characters">
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className={inputCls} placeholder="••••••••" />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            className={cn(inputCls, confirmPw && newPw !== confirmPw && 'border-red-300 focus:ring-red-400')}
            placeholder="••••••••"
          />
          {confirmPw && newPw !== confirmPw && (
            <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
          )}
        </Field>
      </SettingsSection>

      <SettingsSection title="Session info" description="Details about your current session">
        <div className="divide-y divide-zinc-50">
          <div className="flex items-center justify-between py-3 first:pt-0">
            <span className="text-sm text-zinc-600">Last sign in</span>
            <span className="text-sm font-medium text-zinc-900">{lastLogin}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-zinc-600">Email</span>
            <span className="text-sm font-medium text-zinc-900">{user?.email || '—'}</span>
          </div>
        </div>
      </SettingsSection>

      <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-red-100 bg-red-50/40">
          <p className="text-sm font-semibold text-red-700">Danger zone</p>
          <p className="text-xs text-red-500 mt-0.5">These actions are permanent and cannot be undone</p>
        </div>
        <div className="px-6 divide-y divide-zinc-50">
          <DangerSection
            title="Delete account"
            description="Permanently delete your account and all associated data"
            action={
              <Button variant="destructive" size="sm" onClick={() => setShowConfirm(true)}>
                Delete account
              </Button>
            }
          />
        </div>
      </div>

      <ConfirmModal
        open={showConfirm}
        title="Delete your account?"
        description="This will permanently delete your account, campaigns, and all data. This action cannot be undone."
        confirmLabel="Yes, delete account"
        destructive
        onConfirm={() => { setShowConfirm(false); toast.error('Account deletion is disabled in this environment'); }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [active, setActive] = useState<Section>('profile');
  const [user, setUser] = useState<UserData | null>(null);
  const supabase = createClient();

  const fetchUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
  }, [supabase]);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-8 py-5 border-b border-zinc-200 bg-white">
        <h1 className="text-xl font-semibold text-zinc-900">Settings</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Manage your account and preferences</p>
      </div>

      {/* 2-column layout */}
      <div className="flex flex-1 min-h-0">

        {/* Left nav */}
        <aside className="w-52 shrink-0 border-r border-zinc-200 bg-white px-3 py-4 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                active === id
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', active === id ? 'text-indigo-600' : 'text-zinc-400')} />
              {label}
              {active === id && <ChevronRight className="h-3.5 w-3.5 ml-auto text-indigo-400" />}
            </button>
          ))}
        </aside>

        {/* Right panel */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl space-y-5">
            {active === 'profile'      && <ProfileSection user={user} />}
            {active === 'billing'      && <BillingSection />}
            {active === 'integrations' && <IntegrationsSection />}
            {active === 'security'     && <SecuritySection user={user} />}
          </div>
        </main>

      </div>
    </div>
  );
}
