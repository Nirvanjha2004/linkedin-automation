import Sidebar from '@/components/layout/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: '#f9fafb',
    }}>
      <Sidebar />
      <main style={{
        flex: 1,
        overflowY: 'auto',
        minWidth: 0,
      }}>
        {children}
      </main>
    </div>
  );
}
