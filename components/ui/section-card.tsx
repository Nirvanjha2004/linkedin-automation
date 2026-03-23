import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function SectionCard({ title, description, actions, children, className, noPadding }: SectionCardProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-zinc-200 overflow-hidden', className)}>
      {(title || actions) && (
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3">
          <div>
            {title && <p className="text-sm font-semibold text-zinc-900">{title}</p>}
            {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
    </div>
  );
}
