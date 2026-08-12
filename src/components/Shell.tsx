'use client';

import {
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Paperclip,
  Settings,
  Shield,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/client';
import { cn, initials, relativeTime } from '@/lib/utils';
import { SmtpGate } from './SmtpGate';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  hasSmtp: boolean;
  smtpEmail: string | null;
};

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/prospects', label: 'Prospects', icon: Building2 },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle2, badge: 'approvals' },
  { href: '/sequences', label: 'Sequences', icon: Workflow },
  { href: '/inbox', label: 'Replies', icon: Inbox, badge: 'replies' },
  { href: '/templates', label: 'Templates', icon: FileText },
  { href: '/case-studies', label: 'Case studies', icon: Paperclip },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
];

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  const [counts, setCounts] = useState({ approvals: 0, replies: 0 });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    setTheme((localStorage.getItem('theme') as 'light' | 'dark') ?? null);
  }, []);

  // Poll the counters so the sidebar reflects work arriving from the background worker.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [drafts, replies, notif] = await Promise.all([
          api.get<{ drafts: unknown[] }>('/api/drafts?status=NEEDS_APPROVAL'),
          api.get<{ replies: unknown[] }>('/api/replies?handled=false'),
          api.get<{ notifications: Notification[]; unread: number }>('/api/notifications'),
        ]);
        if (cancelled) return;
        setCounts({ approvals: drafts.drafts.length, replies: replies.replies.length });
        setNotifications(notif.notifications);
        setUnread(notif.unread);
      } catch {
        /* transient — the next tick will retry */
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pathname]);

  useEffect(() => setMobileOpen(false), [pathname]);

  function toggleTheme() {
    const next =
      theme === 'dark'
        ? 'light'
        : theme === 'light'
          ? 'dark'
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'light'
            : 'dark';
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  }

  async function logout() {
    await api.post('/api/auth/logout');
    window.location.href = '/login';
  }

  async function markAllRead() {
    await api.patch('/api/notifications', { all: true });
    setUnread(0);
    setNotifications((n) => n.map((x) => ({ ...x, read: true })));
  }

  const nav = [...NAV];
  if (user.role === 'ADMIN') nav.push({ href: '/admin', label: 'Admin', icon: Shield });
  nav.push({ href: '/settings', label: 'Settings', icon: Settings });

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r bg-[var(--surface)] transition-transform lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2.5 border-b px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand)] text-white">
            <Mail size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">Outreach Agent</p>
            <p className="truncate text-[11px] text-[var(--text-muted)]">Traininglobe</p>
          </div>
          <button
            className="ml-auto rounded p-1 text-[var(--text-muted)] lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {nav.map(({ href, label, icon: Icon, ...rest }) => {
            const badgeKey = (rest as { badge?: string }).badge;
            const count = badgeKey ? counts[badgeKey as keyof typeof counts] : 0;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                  active
                    ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
                )}
              >
                <Icon size={17} />
                <span className="flex-1">{label}</span>
                {count > 0 && (
                  <span className="rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[11px] font-semibold">
              {initials(user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{user.name}</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">
                {user.smtpEmail ?? user.email}
              </p>
            </div>
            <button
              onClick={logout}
              className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
          {user.role === 'ADMIN' && (
            <div className="px-2 pb-1">
              <Badge tone="brand">Admin</Badge>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[248px]">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-[var(--surface)]/85 px-4 py-3 backdrop-blur lg:px-7">
          <button
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>

          <div className="flex-1" />

          <div className="relative">
            <button
              onClick={() => setBellOpen((o) => !o)}
              className="relative rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
              aria-label="Notifications"
            >
              <Bell size={17} />
              {unread > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[var(--danger)]" />
              )}
            </button>

            {bellOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                <div className="animate-fade-in absolute right-0 z-40 mt-2 w-[340px] overflow-hidden rounded-xl border bg-[var(--surface)] shadow-[var(--shadow-lg)]">
                  <div className="flex items-center justify-between border-b px-4 py-2.5">
                    <span className="text-[13px] font-semibold">Notifications</span>
                    {unread > 0 && (
                      <button
                        onClick={markAllRead}
                        className="text-[12px] text-[var(--brand)] hover:underline"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-[360px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-8 text-center text-[13px] text-[var(--text-muted)]">
                        Nothing yet.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <Link
                          key={n.id}
                          href={n.link ?? '#'}
                          onClick={() => setBellOpen(false)}
                          className={cn(
                            'block border-b px-4 py-3 last:border-0 hover:bg-[var(--surface-2)]',
                            !n.read && 'bg-[var(--brand-soft)]/40',
                          )}
                        >
                          <p className="text-[13px] font-medium">{n.title}</p>
                          {n.body && (
                            <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--text-muted)]">
                              {n.body}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                            {relativeTime(n.createdAt)}
                          </p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </header>

        <main className="flex-1 p-4 lg:p-7">
          {!user.hasSmtp && <SmtpGate userEmail={user.email} />}
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  );
}

export { Button };
