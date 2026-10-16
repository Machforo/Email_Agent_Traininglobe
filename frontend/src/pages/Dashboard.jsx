import React, { useState, useEffect } from 'react';
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
  Calendar,
  XCircle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Mail,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePermissions, Can } from '../services/permissions';
import { formatDateTime } from '../services/formatters';

export default function Dashboard({ metrics, onNavigateTab, user }) {
  const { isReadOnly } = usePermissions();

  // Upcoming Deliveries State
  const [scheduledDeliveries, setScheduledDeliveries] = useState([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [deliveryActionLoading, setDeliveryActionLoading] = useState(false);
  const [itemToSendNow, setItemToSendNow] = useState(null);
  const [itemToCancel, setItemToCancel] = useState(null);
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [newDateTime, setNewDateTime] = useState('');
  const [toastMsg, setToastMsg] = useState(null);

  const fetchUpcomingDeliveries = async () => {
    try {
      setLoadingDeliveries(true);
      const data = await api.getScheduledEmails();
      setScheduledDeliveries(data || []);
    } catch (err) {
      console.error('Failed to load upcoming deliveries:', err);
    } finally {
      setLoadingDeliveries(false);
    }
  };

  useEffect(() => {
    fetchUpcomingDeliveries();
    const interval = setInterval(fetchUpcomingDeliveries, 30000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (type, message) => {
    setToastMsg({ type, message });
    setTimeout(() => setToastMsg(null), 5000);
  };

  const handleConfirmSendNow = async () => {
    if (!itemToSendNow) return;
    try {
      setDeliveryActionLoading(true);
      await api.approveDraft(itemToSendNow.id, true);
      showToast('success', 'Email dispatched immediately via Zoho Mail');
      setItemToSendNow(null);
      fetchUpcomingDeliveries();
    } catch (err) {
      showToast('error', `Dispatch failed: ${err.message}`);
    } finally {
      setDeliveryActionLoading(false);
    }
  };

  const handleRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!newDateTime || !rescheduleItem) return;
    try {
      setDeliveryActionLoading(true);
      const isoTime = new Date(newDateTime).toISOString();
      await api.rescheduleDraft(rescheduleItem.id, isoTime);
      showToast('success', 'Delivery time rescheduled and reminder recalculated');
      setRescheduleItem(null);
      setNewDateTime('');
      fetchUpcomingDeliveries();
    } catch (err) {
      showToast('error', `Reschedule failed: ${err.message}`);
    } finally {
      setDeliveryActionLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!itemToCancel) return;
    try {
      setDeliveryActionLoading(true);
      await api.rejectDraft(itemToCancel.id, {
        reason: 'Cancelled by admin from Dashboard upcoming deliveries card',
        regenerate: false,
      });
      showToast('success', 'Scheduled delivery cancelled');
      setItemToCancel(null);
      fetchUpcomingDeliveries();
    } catch (err) {
      showToast('error', `Cancellation failed: ${err.message}`);
    } finally {
      setDeliveryActionLoading(false);
    }
  };

  // Filter deliveries within next 24 hours
  const now = new Date();
  const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const next24hDeliveries = scheduledDeliveries
    .filter((item) => {
      if (!item.scheduled_for) return false;
      const t = new Date(item.scheduled_for);
      return t <= next24Hours;
    })
    .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));

  const formatCountdown = (isoStr) => {
    if (!isoStr) return 'Pending time';
    const diffMs = new Date(isoStr).getTime() - Date.now();
    if (diffMs <= 0) return 'Due now';
    const diffMins = Math.floor(diffMs / (60 * 1000));
    if (diffMins < 60) return `in ${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const remMins = diffMins % 60;
    return `in ${hours}h ${remMins > 0 ? `${remMins}m` : ''}`.trim();
  };

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

      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-md animate-fadeIn ${
            toastMsg.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {toastMsg.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-600" />
          )}
          <span>{toastMsg.message}</span>
        </div>
      )}

      {/* Upcoming Deliveries Card (Next 24 Hours) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Clock className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Upcoming Deliveries (Next 24 Hours)
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {next24hDeliveries.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Approved emails held for release. Scheduled outreach requires explicit admin release ('Send Now') before dispatch.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchUpcomingDeliveries}
              disabled={loadingDeliveries}
              title="Refresh upcoming queue"
              className="btn-secondary text-xs p-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${loadingDeliveries ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('scheduled')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition"
            >
              <span>View Full Scheduled Queue</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {next24hDeliveries.length === 0 ? (
          <div className="py-8 text-center bg-slate-50/70 border border-dashed border-slate-200 rounded-xl">
            <Clock className="h-8 w-8 text-slate-400 mx-auto mb-2" />
            <h4 className="text-xs font-semibold text-slate-700">No Outreach Scheduled in Next 24 Hours</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Approved emails scheduled for future release will appear here with live countdowns.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {next24hDeliveries.slice(0, 5).map((item) => {
              const countdown = formatCountdown(item.scheduled_for);
              const formattedTime = formatDateTime(item.scheduled_for, true);

              return (
                <div
                  key={item.id}
                  className="py-4 first:pt-1 last:pb-1 flex flex-col md:flex-row md:items-center justify-between gap-4 transition hover:bg-slate-50/50 rounded-lg px-2"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {countdown === 'Due now' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          <CheckCircle className="h-3 w-3 text-emerald-600" />
                          Ready to Send
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          <Clock className="h-3 w-3 text-amber-600" />
                          {countdown}
                        </span>
                      )}
                      <span className="text-xs text-slate-600 font-medium">
                        Target time: <strong className="text-slate-800">{formattedTime}</strong>
                      </span>
                      {item.lead_company && (
                        <span className="text-xs text-slate-400">• {item.lead_company}</span>
                      )}
                      {item.approver_name && (
                        <span className="text-xs text-slate-400">• Approved by {item.approver_name}</span>
                      )}
                    </div>

                    <h4 className="text-xs font-semibold text-slate-900 truncate">
                      {item.lead_name ? `${item.lead_name} — ` : ''}{item.subject}
                    </h4>

                    <p className="text-[11px] text-slate-500 line-clamp-1 font-sans">
                      {item.body_text || item.body || item.body_html?.replace(/<[^>]+>/g, '')}
                    </p>
                  </div>

                  {/* Actions: Super Admin gets full controls, Staff Admin gets read-only badge */}
                  {!isReadOnly ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setRescheduleItem(item);
                          setNewDateTime(
                            item.scheduled_for
                              ? new Date(item.scheduled_for).toISOString().slice(0, 16)
                              : ''
                          );
                        }}
                        disabled={deliveryActionLoading}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
                      >
                        <Calendar className="h-3.5 w-3.5 text-indigo-600" />
                        <span>Reschedule</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setItemToSendNow(item)}
                        disabled={deliveryActionLoading}
                        className="btn-success text-xs py-1.5 px-3 font-semibold shadow-xs"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Send Now</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setItemToCancel(item)}
                        disabled={deliveryActionLoading}
                        title="Cancel scheduled delivery"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition shadow-2xs"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 italic shrink-0">
                      Scheduled (Read-only)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Dialogs and Reschedule Modal */}
      <ConfirmDialog
        isOpen={!!itemToSendNow}
        title="Send Scheduled Email Immediately?"
        message={`Are you sure you want to release this email to ${itemToSendNow?.lead_email || 'the recipient'} immediately, bypassing the scheduled countdown?`}
        confirmText="Send Now"
        cancelText="Cancel"
        type="success"
        loading={deliveryActionLoading}
        onConfirm={handleConfirmSendNow}
        onCancel={() => setItemToSendNow(null)}
      />

      <ConfirmDialog
        isOpen={!!itemToCancel}
        title="Cancel Scheduled Delivery?"
        message="Are you sure you want to cancel this scheduled delivery? The email will be rejected and removed from automated dispatch."
        confirmText="Cancel Delivery"
        cancelText="Keep Scheduled"
        type="danger"
        loading={deliveryActionLoading}
        onConfirm={handleConfirmCancel}
        onCancel={() => setItemToCancel(null)}
      />

      {rescheduleItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                Reschedule Delivery
              </h3>
              <button
                type="button"
                onClick={() => setRescheduleItem(null)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleRescheduleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  New Delivery Date & Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={newDateTime}
                  onChange={(e) => setNewDateTime(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                Subject: <strong className="text-slate-900">{rescheduleItem.subject}</strong>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRescheduleItem(null)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deliveryActionLoading || !newDateTime}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {deliveryActionLoading ? 'Updating...' : 'Save New Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
