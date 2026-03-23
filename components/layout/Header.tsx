import { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';

interface HeaderProps {
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
}

// Thin wrapper kept for backward compat with existing page imports
export default function Header({ title, subtitle, actions }: HeaderProps) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} />;
}
