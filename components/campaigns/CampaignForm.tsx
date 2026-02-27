'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  Clock, Calendar, MessageSquare, Users, ChevronDown, 
  Plus, Trash2, Loader2, Info
} from 'lucide-react';
import { Campaign, LinkedInAccount, TimeWindow } from '@/types';
import { DAY_NAMES, TIMEZONES, cn } from '@/lib/utils';

interface CampaignFormProps {
  campaign?: Campaign;
  onSuccess?: (campaign: Campaign) => void;
}

const DEFAULT_SCHEDULE = {
  time_windows: [{ start_time: '09:00', end_time: '17:00' }],
  days_of_week: [1, 2, 3, 4, 5],
  timezone: 'UTC',
};

export default function CampaignForm({ campaign, onSuccess }: CampaignFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  
  const [name, setName] = useState(campaign?.name || '');
  const [description, setDescription] = useState(campaign?.description || '');
  const [linkedinAccountId, setLinkedinAccountId] = useState(campaign?.linkedin_account_id || '');
  const [priority, setPriority] = useState(campaign?.priority || 1);
  const [dailyLimit, setDailyLimit] = useState(campaign?.daily_limit || 20);
  const [schedule, setSchedule] = useState(campaign?.schedule || DEFAULT_SCHEDULE);
  const [templates, setTemplates] = useState(campaign?.message_templates || {
    connection_request: '',
    initial_message: '',
    follow_up_1: '',
    follow_up_2: '',
    follow_up_delay_days: 3,
  });

  const isEditing = !!campaign?.id;

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const { data } = await axios.get('/api/accounts');
      setAccounts(data.accounts || []);
    } catch {
      // Ignore
    }
  };

  const toggleDay = (day: number) => {
    const days = schedule.days_of_week;
    const newDays = days.includes(day) 
      ? days.filter((d: number) => d !== day)
      : [...days, day].sort((a, b) => a - b);
    setSchedule({ ...schedule, days_of_week: newDays });
  };

  const updateTimeWindow = (idx: number, field: keyof TimeWindow, value: string) => {
    const windows = [...schedule.time_windows];
    windows[idx] = { ...windows[idx], [field]: value };
    setSchedule({ ...schedule, time_windows: windows });
  };

  const addTimeWindow = () => {
    setSchedule({
      ...schedule,
      time_windows: [...schedule.time_windows, { start_time: '09:00', end_time: '17:00' }],
    });
  };

  const removeTimeWindow = (idx: number) => {
    if (schedule.time_windows.length <= 1) return;
    const windows = schedule.time_windows.filter((_: TimeWindow, i: number) => i !== idx);
    setSchedule({ ...schedule, time_windows: windows });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkedinAccountId) {
      toast.error('Please select a LinkedIn account');
      return;
    }
    if (schedule.days_of_week.length === 0) {
      toast.error('Please select at least one operational day');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name,
        description,
        linkedin_account_id: linkedinAccountId,
        priority,
        daily_limit: dailyLimit,
        schedule,
        message_templates: templates,
      };

      let response;
      if (isEditing) {
        response = await axios.patch(`/api/campaigns/${campaign!.id}`, payload);
        toast.success('Campaign updated!');
      } else {
        response = await axios.post('/api/campaigns', payload);
        toast.success('Campaign created!');
      }

      if (onSuccess) {
        onSuccess(response.data.campaign);
      } else {
        router.push(`/dashboard/campaigns/${response.data.campaign.id}`);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr?.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const connectionRequestLength = templates.connection_request?.length || 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Info */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-600" />
          Campaign Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Campaign Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. SaaS Founders Outreach Q1"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Optional campaign notes..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              LinkedIn Account <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={linkedinAccountId}
                onChange={(e) => setLinkedinAccountId(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
              >
                <option value="">Select account...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} {!acc.is_active && '(Inactive)'}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
            {accounts.length === 0 && (
              <p className="text-xs text-orange-500 mt-1">
                No LinkedIn accounts connected.{' '}
                <a href="/dashboard/accounts" className="underline">Connect one first.</a>
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Priority
              <span className="text-xs text-gray-400 ml-1">(higher = runs first if conflict)</span>
            </label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value))}
              min={1}
              max={10}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Daily Action Limit
              <span className="text-xs text-gray-400 ml-1">(max per day)</span>
            </label>
            <input
              type="number"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(parseInt(e.target.value))}
              min={1}
              max={100}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Scheduling */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
          <Clock className="h-4 w-4 text-blue-600" />
          Operational Schedule
        </h2>

        {/* Timezone */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
          <div className="relative">
            <select
              value={schedule.timezone}
              onChange={(e) => setSchedule({ ...schedule, timezone: e.target.value })}
              className="w-full max-w-xs px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none max-w-xs" />
          </div>
        </div>

        {/* Days of week */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Calendar className="h-4 w-4 inline mr-1" />
            Active Days
          </label>
          <div className="flex gap-2 flex-wrap">
            {DAY_NAMES.map((day, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  schedule.days_of_week.includes(idx)
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                )}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        {/* Time Windows */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Time Windows
            </label>
            <button
              type="button"
              onClick={addTimeWindow}
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add window
            </button>
          </div>
          <div className="space-y-3">
            {schedule.time_windows.map((window: TimeWindow, idx: number) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-16">From</span>
                <input
                  type="time"
                  value={window.start_time}
                  onChange={(e) => updateTimeWindow(idx, 'start_time', e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-500">to</span>
                <input
                  type="time"
                  value={window.end_time}
                  onChange={(e) => updateTimeWindow(idx, 'end_time', e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {schedule.time_windows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTimeWindow(idx)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
            <Info className="h-3 w-3" />
            Campaign will only send actions within these time windows
          </p>
        </div>
      </div>

      {/* Message Templates */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-blue-600" />
          Message Templates
        </h2>
        <p className="text-xs text-gray-400 mb-5">
          Use <code className="bg-gray-100 px-1 rounded">{'{{first_name}}'}</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{company}}'}</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{title}}'}</code> for personalization
        </p>

        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700">
                Connection Request Note
                <span className="text-xs text-gray-400 ml-1">(optional, max 300 chars)</span>
              </label>
              <span className={cn(
                'text-xs',
                connectionRequestLength > 300 ? 'text-red-500' : 'text-gray-400'
              )}>
                {connectionRequestLength}/300
              </span>
            </div>
            <textarea
              value={templates.connection_request || ''}
              onChange={(e) => setTemplates({ ...templates, connection_request: e.target.value })}
              maxLength={300}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Hi {{first_name}}, I'd love to connect and learn more about your work at {{company}}..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Initial Message
              <span className="text-xs text-gray-400 ml-1">(sent after connection accepted)</span>
            </label>
            <textarea
              value={templates.initial_message || ''}
              onChange={(e) => setTemplates({ ...templates, initial_message: e.target.value })}
              rows={4}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Hi {{first_name}}, thanks for connecting! I noticed you're a {{title}} at {{company}}..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Follow-up #1
              </label>
              <textarea
                value={templates.follow_up_1 || ''}
                onChange={(e) => setTemplates({ ...templates, follow_up_1: e.target.value })}
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Hi {{first_name}}, just following up..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Follow-up #2
              </label>
              <textarea
                value={templates.follow_up_2 || ''}
                onChange={(e) => setTemplates({ ...templates, follow_up_2: e.target.value })}
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Hi {{first_name}}, one last message..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Days between follow-ups
            </label>
            <input
              type="number"
              value={templates.follow_up_delay_days || 3}
              onChange={(e) => setTemplates({ ...templates, follow_up_delay_days: parseInt(e.target.value) })}
              min={1}
              max={30}
              className="w-32 px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isEditing ? 'Saving...' : 'Creating...'}
            </>
          ) : (
            isEditing ? 'Save Changes' : 'Create Campaign'
          )}
        </button>
      </div>
    </form>
  );
}
