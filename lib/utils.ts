import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** @deprecated Use StatusBadge component instead */
export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-zinc-100 text-zinc-600',
    draft: 'bg-zinc-100 text-zinc-600',
    active: 'bg-emerald-100 text-emerald-700',
    paused: 'bg-amber-100 text-amber-700',
    completed: 'bg-blue-100 text-blue-700',
    archived: 'bg-zinc-100 text-zinc-500',
    connection_sent: 'bg-blue-100 text-blue-700',
    connected: 'bg-emerald-100 text-emerald-700',
    message_sent: 'bg-violet-100 text-violet-700',
    replied: 'bg-emerald-100 text-emerald-700',
    followup_sent: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    skipped: 'bg-zinc-100 text-zinc-500',
  };
  return colors[status] || 'bg-zinc-100 text-zinc-600';
}
