import { type LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      <div className="w-12 h-12 rounded-xl bg-zinc-100 flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-zinc-400" />
      </div>
      <p className="text-sm font-semibold text-zinc-700 mb-1">{title}</p>
      {description && <p className="text-sm text-zinc-400 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
