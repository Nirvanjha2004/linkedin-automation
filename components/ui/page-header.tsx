import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('px-8 py-5 border-b border-zinc-200 bg-white flex items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-zinc-900 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
