import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ApprovalQueue from './pages/ApprovalQueue';
import Leads from './pages/Leads';
import ScheduledQueue from './pages/ScheduledQueue';
import Settings from './pages/Settings';
import AuditLogs from './pages/AuditLogs';
import { api } from './services/api';
import { PermissionProvider, usePermissions } from './services/permissions';
import { ShieldCheck, CheckCircle2, BookOpen, Info, AlertCircle, X } from 'lucide-react';

function AppContent({ user, setUser, onLogout }) {
  const { isReadOnly, hasPermission } = usePermissions();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [metrics, setMetrics] = useState(null);
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Listen to global 403 Forbidden events from api.js
  useEffect(() => {
    const handleForbidden = (e) => {
      showToast(e.detail?.message || 'Read-only access: your role cannot perform this action', 'warning');
    };
    window.addEventListener('global-api-forbidden', handleForbidden);
    return () => window.removeEventListener('global-api-forbidden', handleForbidden);
  }, []);

  // Poll / refresh metrics and approval queue
  const refreshCoreData = async () => {
    if (!localStorage.getItem('traininglobe_token')) return;
    try {
      const [metricsData, queueData] = await Promise.all([
        api.getMetrics().catch(() => null),
        api.getApprovalQueue().catch(() => []),
      ]);
      if (metricsData) setMetrics(metricsData);
      if (queueData) setApprovalQueue(queueData);
    } catch (err) {
      console.error('Failed to sync core dashboard data:', err);
    }
  };

  useEffect(() => {
    if (user) {
      refreshCoreData();
      const interval = setInterval(refreshCoreData, 20000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Route guard: check permission before navigating
  const handleNavigateTab = (tabId) => {
    // If navigating to restricted tabs
    if (tabId === 'rules' && isReadOnly) {
      showToast("You don't have permission to view that page", 'warning');
      setActiveTab('dashboard');
      return;
    }
    setActiveTab(tabId);
  };

  const pendingApprovalsCount = approvalQueue.length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Sticky Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={handleNavigateTab}
        user={user}
        onLogout={onLogout}
        pendingCount={pendingApprovalsCount}
      />

      {/* Slim, Light-Blue "View-only access" Banner for Staff Admin */}
      {isReadOnly && (
        <div className="bg-sky-50 border-b border-sky-200/80 px-4 py-2 text-xs text-sky-900 flex items-center justify-center gap-2 shadow-2xs">
          <Info className="h-4 w-4 text-sky-600 shrink-0" />
          <span>
            <strong className="font-semibold text-sky-950">View-only access:</strong> You can view your assigned leads and activity. Changes are made by a Super Admin.
          </span>
        </div>
      )}

      {/* Global Floating Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 text-xs sm:text-sm shadow-lg animate-fadeIn max-w-md ${
            toast.type === 'warning'
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : toast.type === 'error'
              ? 'border-rose-300 bg-rose-50 text-rose-900'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900'
          }`}
        >
          {toast.type === 'warning' ? (
            <Info className="h-4 w-4 text-amber-600 shrink-0" />
          ) : toast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          )}
          <span className="flex-1 font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-slate-700 ml-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Centered Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16">
        {activeTab === 'dashboard' && (
          <Dashboard
            metrics={metrics}
            onNavigateTab={handleNavigateTab}
            user={user}
          />
        )}

        {activeTab === 'approvals' && (
          <ApprovalQueue
            queue={approvalQueue}
            onRefresh={refreshCoreData}
            user={user}
          />
        )}

        {activeTab === 'leads' && <Leads />}

        {activeTab === 'scheduled' && <ScheduledQueue />}

        {activeTab === 'settings' && <Settings />}

        {activeTab === 'audit' && <AuditLogs />}
      </main>

      {/* Slim Light Gray Footer Status Bar */}
      <footer className="border-t border-slate-200 bg-white py-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Traininglobe AI Lead Nurturing</span>
            <span className="text-slate-300">•</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              100% Human Approval Gatekeeper Active
            </span>
          </div>

          <div className="flex items-center gap-3 text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />
              Zoho CRM & Mail Ready
            </span>
            <span className="text-slate-300">•</span>
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5 text-slate-400" />
              Grounding: Verified Knowledge Base
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('traininglobe_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
  };

  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <PermissionProvider user={user} onUserUpdate={setUser}>
      <AppContent user={user} setUser={setUser} onLogout={handleLogout} />
    </PermissionProvider>
  );
}
