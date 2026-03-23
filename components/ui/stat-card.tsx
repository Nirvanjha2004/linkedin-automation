import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  href?: string;
  className?: string;
}

export function StatCard({ label, value, sub, icon: Icon, iconColor = 'text-indigo-600', iconBg = 'bg-indigo-50', href, className }: StatCardProps) {
  const content = (
    <div className={cn('bg-white rounded-xl border border-zinc-200 p-5 flex flex-col gap-3', href && 'hover:border-zinc-300 hover:shadow-sm transition-all', className)}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
        <Icon className={cn('h-4 w-4', iconColor)} />
      </div>
      <div>
        <p className="text-2xl font-semibold text-zinc-900 tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        <p className="text-sm font-medium text-zinc-700 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  if (href) return <Link href={href} className="block no-underline">{content}</Link>;
  return content;
}
