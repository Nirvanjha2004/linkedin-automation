import type { Metadata } from 'next';
import './globals.css';
import ToasterProvider from './toaster-provider';

export const metadata: Metadata = {
  title: 'LinkedIn Outreach Platform',
  description: 'Automate your LinkedIn outreach campaigns',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <ToasterProvider />
      </body>
    </html>
  );
}
