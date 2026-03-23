'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  LayoutDashboard, Megaphone, Users, MessageSquare,
  BarChart3, Linkedin, Settings, LogOut, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard',           label: 'Overview',          icon: LayoutDashboard, exact: true },
  { href: '/dashboard/campaigns', label: 'Campaigns',         icon: Megaphone },
  { href: '/dashboard/leads',     label: 'All Leads',         icon: Users },
  { href: '/dashboard/messages',  label: 'Messages',          icon: MessageSquare },
  { href: '/dashboard/analytics', label: 'Analytics',         icon: BarChart3 },
  { href: '/dashboard/accounts',  label: 'LinkedIn Accounts', icon: Linkedin },
  { href: '/dashboard/settings',  label: 'Settings',          icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="w-[220px] min-w-[220px] h-screen bg-white border-r border-zinc-200 flex flex-col sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-zinc-100">
        <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 leading-none">OutreachAI</p>
            <p className="text-[11px] text-zinc-400 mt-0.5 leading-none">LinkedIn Automation</p>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5">
        {navItems.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors no-underline',
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
              )}
            >
              <item.icon className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-600' : 'text-zinc-400')} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-zinc-100">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-500 hover:bg-red-50 hover:text-red-600 transition-colors w-full text-left"
        >
          <LogOut className="h-4 w-4 shrink-0 text-zinc-400" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
