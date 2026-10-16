import React from 'react';
import {
  Users,
  Send,
  MessageSquare,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { usePermissions } from '../services/permissions';

export default function Dashboard({ metrics, onNavigateTab, user }) {
  const { isReadOnly } = usePermissions();
  if (!metrics) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const { overview = {}, funnel = {}, intent_distribution = {} } = metrics;
  const pendingCount = overview.pending_approvals || 0;

  const kpis = [
    {
      label: 'Total Leads Managed',
      value: overview.total_leads || 0,
      icon: Users,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-50',
    },
    {
      label: 'Emails Dispatched',
      value: overview.emails_sent || 0,
      icon: Send,
      iconColor: 'text-sky-600',
      iconBg: 'bg-sky-50',
    },
    {
      label: 'Prospect Replies',
      value: overview.total_replies || 0,
      icon: MessageSquare,
      iconColor: 'text-indigo-600',
      iconBg: 'bg-indigo-50',
    },
    {
      label: 'Reply Rate',
      value: `${overview.reply_rate_percent || 0}%`,
      icon: TrendingUp,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
    },
    {
      label: 'Pending Human Approvals',
      value: pendingCount,
      icon: Clock,
      iconColor: pendingCount > 0 ? 'text-amber-600' : 'text-slate-500',
      iconBg: pendingCount > 0 ? 'bg-amber-50' : 'bg-slate-100',
      badgeText: pendingCount > 0 ? 'Action Required' : null,
      badgeType: 'warning',
      onClick: () => onNavigateTab('approvals'),
    },
    {
      label: 'Conversion Rate',
      value: `${overview.conversion_rate_percent || 0}%`,
      icon: CheckCircle,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
    },
  ];

  const intentColors = {
    Interested: 'bg-emerald-500',
    'Agrees to collaborate': 'bg-emerald-600',
    'Asks a question': 'bg-indigo-500',
    'Pricing concern': 'bg-amber-500',
    'Requests a proposal': 'bg-sky-500',
    'Contact me later': 'bg-purple-500',
    'No reply': 'bg-slate-400',
    'Not interested / asks to stop': 'bg-rose-500',
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <PageHeader
        title="Outreach Performance & Pipeline"
        subtitle={`Welcome back, ${user?.name || 'Admin'}. Here is your real-time cadence and engagement overview.`}
        actions={
          isReadOnly ? (
            <button
              type="button"
              onClick={() => onNavigateTab('approvals')}
              className="btn-secondary text-xs"
            >
              <Clock className="h-4 w-4 text-indigo-600" />
              <span>View Approval Queue</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigateTab('approvals')}
              className="btn-primary text-xs"
            >
              <Clock className="h-4 w-4" />
              <span>Open Approval Queue ({pendingCount})</span>
            </button>
          )
        }
      />

      {/* Light Amber Alert Card for Pending Approvals */}
      {pendingCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 sm:p-6 shadow-xs animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-amber-950">
                  {isReadOnly
                    ? `${pendingCount} draft${pendingCount > 1 ? 's are' : ' is'} awaiting approval by a Super Admin.`
                    : `${pendingCount} Draft${pendingCount > 1 ? 's' : ''} Awaiting Mandatory Human Approval`}
                </h3>
                <p className="mt-1 text-sm text-amber-800 leading-relaxed">
                  {isReadOnly
                    ? 'Autonomous outreach is paused for these leads until authorization by a Super Admin.'
                    : 'Autonomous outreach is paused for these leads. Every message requires explicit admin authorization before dispatch.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('approvals')}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 shadow-xs transition shrink-0"
            >
              <span>{isReadOnly ? 'View Approval Queue' : 'Review Approval Queue'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Grid (3x2 on desktop, 2 col on tablet, 1 col on mobile) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {kpis.map((kpi, idx) => (
          <StatCard
            key={idx}
            label={kpi.label}
            value={kpi.value}
            icon={kpi.icon}
            iconColor={kpi.iconColor}
            iconBg={kpi.iconBg}
            badgeText={kpi.badgeText}
            badgeType={kpi.badgeType}
            onClick={kpi.onClick}
          />
        ))}
      </div>

      {/* Lifecycle Funnel & Reply Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Lifecycle Funnel */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Lead Lifecycle Funnel</h2>
              <p className="text-xs text-slate-500 mt-0.5">Active status progression across your portfolio</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('leads')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition"
            >
              <span>View All Leads</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-4">
            {Object.entries(funnel).map(([statusName, count]) => {
              const maxCount = Math.max(...Object.values(funnel), 1);
              const percentage = Math.round((count / maxCount) * 100);

              return (
                <div key={statusName} className="flex items-center gap-4 text-xs">
                  <div className="w-36 shrink-0">
                    <StatusBadge status={statusName} />
                  </div>
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(percentage, 4)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right font-semibold text-slate-700">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Reply Intent Breakdown */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="mb-5 pb-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Reply Intent Analytics</h2>
              <p className="text-xs text-slate-500 mt-0.5">AI-classified incoming prospect responses</p>
            </div>

            {Object.keys(intent_distribution).length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No Inbound Replies Yet"
                description="When leads reply, AI classifies their intent and visualizes it here."
                className="border-0 p-4"
              />
            ) : (
              <div className="space-y-3.5">
                {Object.entries(intent_distribution).map(([intent, count]) => {
                  const maxIntentCount = Math.max(...Object.values(intent_distribution), 1);
                  const intentPct = Math.round((count / maxIntentCount) * 100);
                  const dotColor = intentColors[intent] || 'bg-slate-400';

                  return (
                    <div key={intent} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                          <span className="text-slate-700 font-medium">{intent}</span>
                        </div>
                        <span className="font-semibold text-slate-900">{count}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-indigo-600 h-full rounded-full"
                          style={{ width: `${Math.max(intentPct, 6)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
