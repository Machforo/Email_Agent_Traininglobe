import React, { useState } from 'react';
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
} from 'lucide-react';
import { usePermissions } from '../services/permissions';

export default function Navbar({ activeTab, setActiveTab, user, onLogout, pendingCount = 0 }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isReadOnly } = usePermissions();

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

        {/* User profile & Mobile Menu Trigger */}
        <div className="flex items-center gap-2.5 shrink-0">
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
