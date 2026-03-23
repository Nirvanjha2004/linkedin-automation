'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Clock, Calendar, MessageSquare, Users, ChevronDown, Plus, Trash2, Loader2, Info } from 'lucide-react';
import { Campaign, LinkedInAccount, TimeWindow } from '@/types';
import { DAY_NAMES, TIMEZONES, cn } from '@/lib/utils';
import { SectionCard } from '@/components/ui/section-card';
import { UpgradeModal } from '@/components/billing/UpgradeModal';

interface CampaignFormProps {
  campaign?: Campaign;
  onSuccess?: (campaign: Campaign) => void;
}

const DEFAULT_SCHEDULE = {
  time_windows: [{ start_time: '09:00', end_time: '17:00' }],
  days_of_week: [1, 2, 3, 4, 5],
  timezone: 'UTC',
};

const inputCls = 'w-full px-3 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white';
const labelCls = 'block text-sm font-medium text-zinc-700 mb-1.5';

export default function CampaignForm({ campaign, onSuccess }: CampaignFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState<{ reason: string; cost: number } | null>(null);
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [name, setName] = useState(campaign?.name || '');
  const [description, setDescription] = useState(campaign?.description || '');
  const [linkedinAccountId, setLinkedinAccountId] = useState(campaign?.linkedin_account_id || '');
  const [priority, setPriority] = useState(campaign?.priority || 1);
  const [dailyLimit, setDailyLimit] = useState(campaign?.daily_limit || 20);
  const [schedule, setSchedule] = useState(campaign?.schedule || DEFAULT_SCHEDULE);
  const [templates, setTemplates] = useState(campaign?.message_templates || {
    connection_request: '', initial_message: '', follow_up_1: '', follow_up_2: '', follow_up_delay_days: 3,
  });

  const isEditing = !!campaign?.id;

  useEffect(() => {
    axios.get('/api/accounts').then(({ data }) => setAccounts(data.accounts || [])).catch(() => {});
  }, []);

  const toggleDay = (day: number) => {
    const days = schedule.days_of_week;
    const newDays = days.includes(day) ? days.filter((d: number) => d !== day) : [...days, day].sort((a, b) => a - b);
    setSchedule({ ...schedule, days_of_week: newDays });
  };

  const updateTimeWindow = (idx: number, field: keyof TimeWindow, value: string) => {
    const windows = [...schedule.time_windows];
    windows[idx] = { ...windows[idx], [field]: value };
    setSchedule({ ...schedule, time_windows: windows });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkedinAccountId) { toast.error('Please select a LinkedIn account'); return; }
    if (!schedule.days_of_week.length) { toast.error('Please select at least one operational day'); return; }
    setLoading(true);
    try {
      const payload = { name, description, linkedin_account_id: linkedinAccountId, priority, daily_limit: dailyLimit, schedule, message_templates: templates };
      let response;
      if (isEditing) {
        response = await axios.patch(`/api/campaigns/${campaign!.id}`, payload);
        toast.success('Campaign updated');
      } else {
        response = await axios.post('/api/campaigns', payload);
        toast.success('Campaign created');
      }
      if (onSuccess) onSuccess(response.data.campaign);
      else router.push(`/dashboard/campaigns/${response.data.campaign.id}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; reason?: string; upgrade_required?: boolean; estimated_monthly_cost?: number } } };
      if (e?.response?.data?.upgrade_required) {
        setUpgradeModal({
          reason: e.response.data.reason || 'You have reached your free plan limits.',
          cost: e.response.data.estimated_monthly_cost ?? 10,
        });
      } else {
        toast.error(e?.response?.data?.error || 'Something went wrong');
      }
    } finally { setLoading(false); }
  };

  const connReqLen = templates.connection_request?.length || 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {upgradeModal && (
        <UpgradeModal
          open
          onClose={() => setUpgradeModal(null)}
          reason={upgradeModal.reason}
          estimatedMonthlyCost={upgradeModal.cost}
        />
      )}
      {/* Campaign Details */}
      <SectionCard title="Campaign Details">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className={labelCls}>Campaign Name <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required className={inputCls} placeholder="e.g. SaaS Founders Outreach Q1" />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Optional campaign notes..." />
          </div>
          <div>
            <label className={labelCls}>LinkedIn Account <span className="text-red-500">*</span></label>
            <div className="relative">
              <select value={linkedinAccountId} onChange={e => setLinkedinAccountId(e.target.value)} required className={`${inputCls} appearance-none pr-8`}>
                <option value="">Select account...</option>
                {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}{!acc.is_active && ' (Inactive)'}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            </div>
            {!accounts.length && (
              <p className="text-xs text-amber-600 mt-1">No accounts connected. <a href="/dashboard/accounts" className="underline">Connect one first.</a></p>
            )}
          </div>
          <div>
            <label className={labelCls}>Priority <span className="text-xs text-zinc-400 font-normal">(higher = runs first)</span></label>
            <input type="number" value={priority} onChange={e => setPriority(parseInt(e.target.value))} min={1} max={10} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Daily Action Limit</label>
            <input type="number" value={dailyLimit} onChange={e => setDailyLimit(parseInt(e.target.value))} min={1} max={100} className={inputCls} />
          </div>
        </div>
      </SectionCard>

      {/* Schedule */}
      <SectionCard title="Operational Schedule">
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Timezone</label>
            <div className="relative max-w-xs">
              <select value={schedule.timezone} onChange={e => setSchedule({ ...schedule, timezone: e.target.value })} className={`${inputCls} appearance-none pr-8`}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className={labelCls}><Calendar className="inline h-3.5 w-3.5 mr-1" />Active Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAY_NAMES.map((day, idx) => (
                <button key={idx} type="button" onClick={() => toggleDay(idx)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    schedule.days_of_week.includes(idx) ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                  )}>
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={`${labelCls} mb-0`}><Clock className="inline h-3.5 w-3.5 mr-1" />Time Windows</label>
              <button type="button" onClick={() => setSchedule({ ...schedule, time_windows: [...schedule.time_windows, { start_time: '09:00', end_time: '17:00' }] })}
                className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add window
              </button>
            </div>
            <div className="space-y-2">
              {schedule.time_windows.map((window: TimeWindow, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-10">From</span>
                  <input type="time" value={window.start_time} onChange={e => updateTimeWindow(idx, 'start_time', e.target.value)} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <span className="text-xs text-zinc-500">to</span>
                  <input type="time" value={window.end_time} onChange={e => updateTimeWindow(idx, 'end_time', e.target.value)} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  {schedule.time_windows.length > 1 && (
                    <button type="button" onClick={() => setSchedule({ ...schedule, time_windows: schedule.time_windows.filter((_: TimeWindow, i: number) => i !== idx) })}
                      className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
              <Info className="h-3 w-3" /> Actions only run within these windows
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Message Templates */}
      <SectionCard title="Message Templates" description={`Use {{first_name}}, {{company}}, {{title}} for personalization`}>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={`${labelCls} mb-0`}>Connection Request Note <span className="text-xs text-zinc-400 font-normal">(optional, max 300 chars)</span></label>
              <span className={cn('text-xs', connReqLen > 300 ? 'text-red-500' : 'text-zinc-400')}>{connReqLen}/300</span>
            </div>
            <textarea value={templates.connection_request || ''} onChange={e => setTemplates({ ...templates, connection_request: e.target.value })} maxLength={300} rows={3} className={`${inputCls} resize-none`} placeholder="Hi {{first_name}}, I'd love to connect..." />
          </div>
          <div>
            <label className={labelCls}>Initial Message <span className="text-xs text-zinc-400 font-normal">(sent after connection accepted)</span></label>
            <textarea value={templates.initial_message || ''} onChange={e => setTemplates({ ...templates, initial_message: e.target.value })} rows={4} className={`${inputCls} resize-none`} placeholder="Hi {{first_name}}, thanks for connecting!..." />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Follow-up #1</label>
              <textarea value={templates.follow_up_1 || ''} onChange={e => setTemplates({ ...templates, follow_up_1: e.target.value })} rows={3} className={`${inputCls} resize-none`} placeholder="Hi {{first_name}}, just following up..." />
            </div>
            <div>
              <label className={labelCls}>Follow-up #2</label>
              <textarea value={templates.follow_up_2 || ''} onChange={e => setTemplates({ ...templates, follow_up_2: e.target.value })} rows={3} className={`${inputCls} resize-none`} placeholder="Hi {{first_name}}, one last message..." />
            </div>
          </div>
          <div>
            <label className={labelCls}>Days between follow-ups</label>
            <input type="number" value={templates.follow_up_delay_days || 3} onChange={e => setTemplates({ ...templates, follow_up_delay_days: parseInt(e.target.value) })} min={1} max={30} className={`${inputCls} w-28`} />
          </div>
        </div>
      </SectionCard>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={() => router.back()} className="px-4 py-2.5 border border-zinc-200 rounded-lg text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" />{isEditing ? 'Saving...' : 'Creating...'}</> : isEditing ? 'Save Changes' : 'Create Campaign'}
        </button>
      </div>
    </form>
  );
}
