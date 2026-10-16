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

export default function ScheduledQueue() {
  const { can, isReadOnly } = usePermissions();
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals & Dialogs
  const [rescheduleItem, setRescheduleItem] = useState(null);
  const [newDateTime, setNewDateTime] = useState('');
  const [itemToSendNow, setItemToSendNow] = useState(null);
  const [itemToCancel, setItemToCancel] = useState(null);

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
          } else if (action === 'send_now' && !isReadOnly) {
            setItemToSendNow(item);
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
      const data = await api.getScheduledEmails();
      setScheduled(data || []);
    } catch (err) {
      console.error('Failed to load scheduled queue:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSendNow = async () => {
    if (!itemToSendNow) return;
    try {
      setActionLoading(true);
      await api.approveDraft(itemToSendNow.id, true);
      showNotification('success', 'Email dispatched immediately via Zoho Mail integration');
      setItemToSendNow(null);
      fetchScheduled();
    } catch (err) {
      showNotification('error', `Dispatch failed: ${err.message}`);
    } finally {
      setActionLoading(false);
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

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

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
        subtitle="Approved emails pending automated dispatch during business hours. Fully cancelable or editable prior to release."
        actions={
          <button
            type="button"
            onClick={fetchScheduled}
            className="btn-secondary text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            <span>Refresh Queue</span>
          </button>
        }
      />

      {/* Queue Listing */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-indigo-600" />
            Loading scheduled messages...
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
              const relativeTimeStr = formatRelativeTime(item.scheduled_for);
              const formattedTime = formatDateTime(item.scheduled_for, true);

              return (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs transition-all duration-150 hover:border-slate-300 hover:shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5"
                >
                  <div className="space-y-2.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                        <Clock className="h-3 w-3 text-amber-600" />
                        {relativeTimeStr || 'Pending time'}
                      </span>
                      <span className="text-xs text-slate-500">
                        Deliver at:{' '}
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
                    <p className="text-xs text-slate-600 line-clamp-2 bg-slate-50 p-3 rounded-lg border border-slate-200 font-sans leading-relaxed">
                      {item.body_text || item.body || item.body_html?.replace(/<[^>]+>/g, '')}
                    </p>
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
                        onClick={() => setItemToSendNow(item)}
                        disabled={actionLoading}
                        className="btn-success text-xs font-semibold shadow-xs"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Send Now</span>
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

      {/* Confirmation Modal for Send Now */}
      <ConfirmDialog
        isOpen={!!itemToSendNow}
        title="Dispatch Scheduled Email Now?"
        message={`Are you sure you want to bypass the scheduled window and immediately dispatch this email to ${itemToSendNow?.lead_email || 'the recipient'}?`}
        confirmText="Send Immediately"
        cancelText="Cancel"
        type="success"
        loading={actionLoading}
        onConfirm={handleConfirmSendNow}
        onCancel={() => setItemToSendNow(null)}
      />

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
