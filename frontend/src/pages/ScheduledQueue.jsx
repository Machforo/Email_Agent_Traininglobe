import React, { useState, useEffect } from 'react';
import {
  Clock,
  Calendar,
  Send,
  XCircle,
  RefreshCw,
  User,
  CheckCircle,
  AlertCircle,
  Mail,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { usePermissions, Can } from '../services/permissions';
import {
  formatDateTime,
  formatRelativeTime,
} from '../services/formatters';

export default function ScheduledQueue({ user }) {
  const { can, isReadOnly } = usePermissions();
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modals & Dialogs
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [newDateTime, setNewDateTime] = useState('');
  const [itemToCancel, setItemToCancel] = useState(null);
  const [showCancelAllOverdueModal, setShowCancelAllOverdueModal] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    fetchScheduled();
  }, []);

  // Handle deep linking from reminder emails or notification click
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search && scheduled.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const emailId = params.get('email_id');
      const action = params.get('action');

      if (emailId) {
        const item = scheduled.find((s) => s.id === emailId);
        if (item) {
          if (action === 'reschedule' && !isReadOnly) {
            setRescheduleItem(item);
            setNewDateTime(
              item.scheduled_for
                ? new Date(item.scheduled_for).toISOString().slice(0, 16)
                : ''
            );
          } else if (action === 'cancel' && !isReadOnly) {
            setItemToCancel(item);
          }
          // Clean URL so refresh does not re-open modal
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    }
  }, [scheduled, isReadOnly]);

  const fetchScheduled = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getScheduledEmails();
      setScheduled(data || []);
    } catch (err) {
      console.error('Failed to load scheduled queue:', err);
      setError(err.message || "We couldn't load scheduled deliveries. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRescheduleSubmit = async (e) => {
    e.preventDefault();
    if (!newDateTime || !rescheduleItem) return;

    try {
      setActionLoading(true);
      const isoTime = new Date(newDateTime).toISOString();
      await api.rescheduleDraft(rescheduleItem.id, isoTime);
      showNotification('success', 'Delivery time rescheduled successfully');
      setRescheduleItem(null);
      setNewDateTime('');
      fetchScheduled();
    } catch (err) {
      alert(`Reschedule failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!itemToCancel) return;
    try {
      setActionLoading(true);
      await api.rejectDraft(itemToCancel.id, {
        reason: 'Cancelled by admin from Scheduled Queue',
        regenerate: false,
      });
      showNotification('success', 'Scheduled delivery cancelled');
      setItemToCancel(null);
      fetchScheduled();
    } catch (err) {
      alert(`Cancel failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelAllOverdue = async () => {
    try {
      setActionLoading(true);
      const res = await api.cancelAllOverdue();
      showNotification('success', res.message || 'Cancelled overdue scheduled deliveries');
      setShowCancelAllOverdueModal(false);
      fetchScheduled();
    } catch (err) {
      alert(`Cancel all overdue failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const overdueItems = scheduled.filter((item) => {
    if (!item.scheduled_for) return false;
    const sched = new Date(item.scheduled_for).getTime();
    return sched <= Date.now() - 2 * 60 * 1000;
  });

  return (
    <div className="space-y-6 pb-16">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-md animate-fadeIn ${
            notification.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-600" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Scheduled Delivery Queue"
        subtitle="Approved emails are sent automatically at the scheduled time. You can reschedule or cancel them before then."
        actions={
          <div className="flex items-center gap-2.5">
            {can('emails:write') && overdueItems.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCancelAllOverdueModal(true)}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition shadow-2xs"
              >
                <XCircle className="h-3.5 w-3.5 text-rose-600" />
                <span>Cancel All Overdue ({overdueItems.length})</span>
              </button>
            )}
            <button
              type="button"
              onClick={fetchScheduled}
              className="btn-secondary text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              <span>Refresh Queue</span>
            </button>
          </div>
        }
      />

      {/* Queue Listing */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-indigo-600" />
            Loading scheduled messages...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white rounded-xl border border-slate-200">
            <div className="h-12 w-12 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mb-3 shadow-xs">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Failed to load scheduled queue</h3>
            <p className="text-xs text-slate-500 max-w-sm mb-4 leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={fetchScheduled}
              className="btn-primary text-xs inline-flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Try Again</span>
            </button>
          </div>
        ) : scheduled.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No Scheduled Deliveries"
            description="When approving drafts in the Approval Queue, select 'Schedule for Later' to stage emails for delivery during optimal business hours."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {scheduled.map((item) => {
              const now = Date.now();
              const schedTime = item.scheduled_for ? new Date(item.scheduled_for).getTime() : 0;
              const isPast = schedTime && schedTime <= now;
              const elapsedMinutes = schedTime ? (now - schedTime) / 60000 : 0;
              const isSendingSoon = isPast && elapsedMinutes <= 2;
              const isOverdue = isPast && elapsedMinutes > 2;
              const relativeTimeStr = formatRelativeTime(item.scheduled_for);
              const formattedTime = formatDateTime(item.scheduled_for, true);

              return (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs transition-all duration-150 hover:border-slate-300 hover:shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5"
                >
                  <div className="space-y-2.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {isSendingSoon ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-800"
                          title="Currently being picked up by the automated background scheduler"
                        >
                          <RefreshCw className="h-3 w-3 animate-spin text-sky-600" />
                          Sending soon
                        </span>
                      ) : isOverdue ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-800 cursor-help"
                          title={item.overdue_reason || 'Scheduled delivery window has passed. Waiting for active business hours window or dispatcher retry.'}
                        >
                          <AlertCircle className="h-3 w-3 text-rose-600" />
                          Overdue
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          <Clock className="h-3 w-3 text-amber-600" />
                          {relativeTimeStr || 'Pending time'}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        Target time:{' '}
                        <strong className="text-slate-800 font-medium">
                          {formattedTime}
                        </strong>
                      </span>
                      {item.approver_name && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          • Authorized by{' '}
                          <span className="text-slate-700 font-semibold">{item.approver_name}</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-semibold text-slate-900">{item.subject}</h3>
                    <div className="text-xs text-slate-700 whitespace-pre-wrap max-h-56 overflow-y-auto bg-slate-50 p-3.5 rounded-lg border border-slate-200 font-sans leading-relaxed">
                      {item.body_text || item.body || item.body_html?.replace(/<[^>]+>/g, '') || (
                        <span className="text-amber-700 italic">Empty body (flagged for review)</span>
                      )}
                    </div>
                  </div>

                  <Can permission="emails:write">
                    <div className="flex items-center gap-2.5 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
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
                        disabled={actionLoading}
                        className="btn-secondary text-xs"
                      >
                        <Calendar className="h-3.5 w-3.5 text-indigo-600" />
                        <span>Reschedule</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setItemToCancel(item)}
                        disabled={actionLoading}
                        title="Cancel scheduled delivery"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition shadow-2xs"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                  </Can>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Cancel Delivery */}
      <ConfirmDialog
        isOpen={!!itemToCancel}
        title="Cancel Scheduled Delivery?"
        message="Are you sure you want to cancel this scheduled delivery? The email will be removed from the delivery queue and marked as Rejected."
        confirmText="Cancel Delivery"
        cancelText="Keep Scheduled"
        type="danger"
        loading={actionLoading}
        onConfirm={handleConfirmCancel}
        onCancel={() => setItemToCancel(null)}
      />

      {/* Confirmation Modal for Cancel All Overdue */}
      <ConfirmDialog
        isOpen={showCancelAllOverdueModal}
        title="Cancel All Overdue Deliveries?"
        message={`Are you sure you want to cancel all ${overdueItems.length} overdue scheduled emails? This action will mark them as Cancelled/Rejected and will be logged in the audit trail.`}
        confirmText={`Cancel All (${overdueItems.length})`}
        cancelText="Keep Scheduled"
        type="danger"
        loading={actionLoading}
        onConfirm={handleCancelAllOverdue}
        onCancel={() => setShowCancelAllOverdueModal(false)}
      />



      {/* Reschedule Modal */}
      {rescheduleItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                Change Delivery Time
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
                  disabled={actionLoading || !newDateTime}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {actionLoading ? 'Updating...' : 'Save New Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
