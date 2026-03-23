import { Badge } from './badge';
import { type VariantProps } from 'class-variance-authority';
import { badgeVariants } from './badge';

type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];

const STATUS_MAP: Record<string, BadgeVariant> = {
  // Campaign statuses
  active:    'success',
  paused:    'warning',
  draft:     'secondary',
  archived:  'secondary',
  completed: 'info',
  // Lead statuses
  pending:          'secondary',
  connection_sent:  'info',
  connected:        'success',
  message_sent:     'purple',
  replied:          'success',
  followup_sent:    'warning',
  failed:           'destructive',
  skipped:          'secondary',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = STATUS_MAP[status] ?? 'secondary';
  return (
    <Badge variant={variant} className={className}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
