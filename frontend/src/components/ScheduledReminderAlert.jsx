import React, { useState } from 'react';
import {
  Clock,
  Send,
  Calendar,
  XCircle,
  Eye,
  AlertTriangle,
  X,
  CheckCircle2,
} from 'lucide-react';
import { usePermissions } from '../services/permissions';
import ConfirmDialog from './ConfirmDialog';

export default function ScheduledReminderAlert({
  notification,
  onDismiss,
  onView,
  onReschedule,
  onCancelSend,
  actionLoading = false,
}) {
  const { isReadOnly } = usePermissions();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleDateTime, setRescheduleDateTime] = useState('');

  if (!notification) return null;

  const {
    id,
    lead_name = 'Prospect',
    lead_company = 'Company',
    minutes_remaining = 30,
    formatted_time = '',
    scheduled_email_id,
  } = notification;

  const handleRescheduleSubmit = (e) => {
    e.preventDefault();
    if (!rescheduleDateTime) return;
    onReschedule(scheduled_email_id, new Date(rescheduleDateTime).toISOString());
    setShowRescheduleModal(false);
  };

  return (
    <>
      {/* Floating Alert Pop-up Banner / Card (Fixed Top-Right) */}
      <div className="fixed top-20 right-4 sm:right-8 z-50 w-full max-w-lg bg-white border border-amber-300 rounded-2xl shadow-2xl p-5 animate-slideDown overflow-hidden">
        {/* Amber accent top bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500" />

        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 shadow-2xs">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  <Clock className="h-3 w-3" />
                  Sends in {minutes_remaining} min
                </span>
                <span className="text-xs text-slate-500 font-medium">Scheduled Alert</span>
              </div>
              <h4 className="text-sm font-semibold text-slate-900 mt-1.5 leading-snug">
                Email to <strong className="text-indigo-950 font-bold">{lead_name}</strong> ({lead_company}) is scheduled.
              </h4>
              <p className="text-xs text-slate-600 mt-1">
                Target delivery: <span className="font-semibold text-slate-800">{formatted_time || 'configured time'}</span>. Automatically sends at target time unless rescheduled or cancelled.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onDismiss(id)}
            title="Dismiss notification"
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action Controls */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onView(scheduled_email_id);
              onDismiss(id);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-2xs"
          >
            <Eye className="h-3.5 w-3.5 text-slate-500" />
            <span>View Queue</span>
          </button>

          {!isReadOnly && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRescheduleModal(true)}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition shadow-2xs"
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Reschedule</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                disabled={actionLoading}
                title="Cancel this scheduled delivery"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition shadow-2xs"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal: Cancel Delivery */}
      <ConfirmDialog
        isOpen={confirmCancel}
        title="Cancel Scheduled Outreach?"
        message={`Are you sure you want to cancel the scheduled email to ${lead_name}? The email will be removed from the delivery queue and marked as Rejected.`}
        confirmText="Cancel Delivery"
        cancelText="Keep Scheduled"
        type="danger"
        loading={actionLoading}
        onConfirm={async () => {
          await onCancelSend(scheduled_email_id);
          setConfirmCancel(false);
          onDismiss(id);
        }}
        onCancel={() => setConfirmCancel(false)}
      />

      {/* Reschedule Datetime Modal */}
      {showRescheduleModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                Reschedule Delivery Time
              </h3>
              <button
                type="button"
                onClick={() => setShowRescheduleModal(false)}
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
                  value={rescheduleDateTime}
                  onChange={(e) => setRescheduleDateTime(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                Recipient: <strong className="text-slate-900">{lead_name} ({lead_company})</strong>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRescheduleModal(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !rescheduleDateTime}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {actionLoading ? 'Updating...' : 'Save New Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
