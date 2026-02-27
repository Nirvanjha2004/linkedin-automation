import { ReactNode } from 'react';

interface HeaderProps {
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <div style={{
      padding: '24px 32px',
      borderBottom: '1px solid #f3f4f6',
      background: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
    }}>
      <div>
        <h1 style={{
          fontSize: '20px',
          fontWeight: 700,
          color: '#111827',
          margin: 0,
        }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{
            fontSize: '13px',
            color: '#6b7280',
            margin: '2px 0 0',
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}
