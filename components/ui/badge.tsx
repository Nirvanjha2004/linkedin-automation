import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      variant: {
        default:     'bg-indigo-50 text-indigo-700 ring-indigo-200',
        secondary:   'bg-zinc-100 text-zinc-600 ring-zinc-200',
        destructive: 'bg-red-50 text-red-700 ring-red-200',
        outline:     'bg-transparent text-zinc-700 ring-zinc-300',
        success:     'bg-emerald-50 text-emerald-700 ring-emerald-200',
        warning:     'bg-amber-50 text-amber-700 ring-amber-200',
        info:        'bg-blue-50 text-blue-700 ring-blue-200',
        purple:      'bg-violet-50 text-violet-700 ring-violet-200',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
