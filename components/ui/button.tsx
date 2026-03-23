import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:     'bg-indigo-600 text-white hover:bg-indigo-700',
        secondary:   'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
        outline:     'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50',
        ghost:       'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        success:     'bg-emerald-600 text-white hover:bg-emerald-700',
        warning:     'bg-amber-50 text-amber-700 hover:bg-amber-100',
      },
      size: {
        sm:   'h-8 px-3 text-xs',
        md:   'h-9 px-4',
        lg:   'h-10 px-5',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
