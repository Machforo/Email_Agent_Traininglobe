import React, { useState, useRef, useEffect } from 'react';
import {
  BarChart3,
  CheckCircle2,
  Users,
  Clock,
  Settings as SettingsIcon,
  ShieldCheck,
  LogOut,
  Sparkles,
  Menu,
  X,
  Bell,
  AlertTriangle,
  Eye,
  Check,
} from 'lucide-react';
import { usePermissions } from '../services/permissions';
import { formatRelativeTime } from '../services/formatters';

export default function Navbar({
  activeTab,
  setActiveTab,
  user,
  onLogout,
  pendingCount = 0,
  notifications = [],
  unreadNotificationsCount = 0,
  onNotificationClick,
  onDismissNotification,
  onMarkAllNotificationsRead,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifRef = useRef(null);
  const { isReadOnly } = usePermissions();

  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'approvals', label: 'Approvals', icon: CheckCircle2, badge: pendingCount },
    { id: 'leads', label: 'Leads', icon: Users },
    { id: 'scheduled', label: 'Scheduled', icon: Clock },
    { id: 'settings', label: isSuperAdmin ? 'Knowledge & Rules' : 'Knowledge', icon: SettingsIcon },
    { id: 'audit', label: 'Audit Trail', icon: ShieldCheck },
  ];

  const handleSelectTab = (tabId) => {
    setActiveTab(tabId);
    setMobileMenuOpen(false);
  };

  const roleLabel = isSuperAdmin ? 'Super Admin' : 'Staff Admin · View only';

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-6 lg:px-8 gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-semibold text-base tracking-tight text-slate-900 whitespace-nowrap">
                Traininglobe
              </span>
              <span className="hidden sm:inline-block rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200 whitespace-nowrap">
                AI Lead Nurturing
              </span>
            </div>
          </div>
        </div>

        {/* Desktop Navigation Tabs (Hidden under 1100px, visible at >= 1100px) */}
        <nav className="hidden min-[1100px]:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-medium'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`} />
                <span className="whitespace-nowrap">{item.label}</span>
                {item.badge > 0 && (
                  <span className="ml-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-amber-100 px-1 text-[11px] font-bold text-amber-800 border border-amber-200">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User profile, Notifications & Mobile Menu Trigger */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Notification Bell with Dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              title="Notifications & Delivery Reminders"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 hover:bg-slate-50 transition shadow-2xs shrink-0"
            >
              <Bell className="h-4 w-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-2xs">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>

            {/* Dropdown Menu */}
            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl p-0 overflow-hidden z-50 animate-fadeIn text-xs">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">Delivery Reminders</span>
                    {unreadNotificationsCount > 0 && (
                      <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold">
                        {unreadNotificationsCount} new
                      </span>
                    )}
                  </div>
                  {unreadNotificationsCount > 0 && onMarkAllNotificationsRead && (
                    <button
                      type="button"
                      onClick={() => {
                        onMarkAllNotificationsRead();
                      }}
                      className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-slate-400">
                      <Clock className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                      <p className="font-medium">No upcoming delivery reminders</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Reminders appear before scheduled dispatch</p>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const isUnread = !n.read_at;
                      return (
                        <div
                          key={n.id}
                          className={`p-3.5 transition flex items-start gap-3 hover:bg-slate-50 ${
                            isUnread ? 'bg-amber-50/50' : 'bg-white'
                          }`}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 mt-0.5">
                            <AlertTriangle className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-semibold text-slate-900 truncate">
                                {n.title || `Upcoming Delivery: ${n.lead_name}`}
                              </span>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {formatRelativeTime(n.created_at)}
                              </span>
                            </div>
                            <p className="text-slate-600 mt-0.5 leading-relaxed line-clamp-2">
                              {n.message}
                            </p>
                            <div className="mt-2 flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => {
                                  if (onNotificationClick) onNotificationClick(n);
                                  setNotificationsOpen(false);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                              >
                                <Eye className="h-3 w-3" />
                                <span>Review & Manage</span>
                              </button>
                              {onDismissNotification && (
                                <button
                                  type="button"
                                  onClick={() => onDismissNotification(n.id)}
                                  className="text-[11px] text-slate-400 hover:text-slate-600"
                                >
                                  Dismiss
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="hidden sm:flex flex-col text-right">
            <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
              {user?.name || 'Admin'}
            </span>
            <span className="text-xs text-slate-500 whitespace-nowrap font-medium">
              {roleLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={onLogout}
            title="Log out"
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition shadow-xs shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>

          {/* Mobile hamburger button (<1100px) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            className="flex min-[1100px]:hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition shadow-xs shrink-0"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile/Responsive Drawer Menu (<1100px) */}
      {mobileMenuOpen && (
        <div className="min-[1100px]:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-4 space-y-1 shadow-lg animate-fadeIn">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </div>
                {item.badge > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800 border border-amber-200">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">{user?.name || 'Admin'}</span>
              <span className="text-xs text-slate-500 whitespace-nowrap font-medium">{roleLabel}</span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
