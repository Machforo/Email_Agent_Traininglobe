import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit3,
  XCircle,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Send,
  Calendar,
  MessageSquare,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { getLeadInitials } from '../services/formatters';
import { usePermissions, Can } from '../services/permissions';

export default function ApprovalQueue({ queue = [], onRefresh, user }) {
  const { can, isReadOnly } = usePermissions();
  const [selectedItem, setSelectedItem] = useState(null);
  const [expandedResearch, setExpandedResearch] = useState({});

  // Modals
  const [editModal, setEditModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [confirmApproveModal, setConfirmApproveModal] = useState(false);

  // Form states
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [regenerate, setRegenerate] = useState(true);
  const [scheduleTime, setScheduleTime] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState(null);

  const toggleResearch = (id) => {
    setExpandedResearch((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openApproveConfirm = (item) => {
    setSelectedItem(item);
    setConfirmApproveModal(true);
  };

  const handleConfirmApproveImmediate = async () => {
    if (!selectedItem) return;
    setActionLoading(true);
    setFeedbackMsg(null);
    try {
      await api.approveDraft(selectedItem.draft.id, true);
      setFeedbackMsg({ type: 'success', text: 'Email approved and dispatched successfully via Zoho!' });
      setConfirmApproveModal(false);
      onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const openEdit = (item) => {
    setSelectedItem(item);
    setEditSubject(item.draft?.subject || '');
    setEditBody(item.draft?.body || '');
    setEditModal(true);
  };

  const handleSaveEdit = async (approveNow = false) => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      await api.editDraft(selectedItem.draft.id, {
        subject: editSubject,
        body: editBody,
        approve_now: approveNow,
      });
      setFeedbackMsg({
        type: 'success',
        text: approveNow ? 'Draft edited and approved for dispatch!' : 'Draft edits saved successfully.',
      });
      setEditModal(false);
      onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const openReject = (item) => {
    setSelectedItem(item);
    setRejectReason('');
    setRegenerate(true);
    setRejectModal(true);
  };

  const handleConfirmReject = async () => {
    if (!selectedItem || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.rejectDraft(selectedItem.draft.id, {
        reason: rejectReason,
        regenerate: regenerate,
      });
      setFeedbackMsg({
        type: 'success',
        text: regenerate
          ? 'Draft rejected. Fresh grounded draft regenerated with your feedback.'
          : 'Draft rejected and archived.',
      });
      setRejectModal(false);
      onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const openSchedule = (item) => {
    setSelectedItem(item);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    setScheduleTime(tomorrow.toISOString().slice(0, 16));
    setScheduleModal(true);
  };

  const handleConfirmSchedule = async () => {
    if (!selectedItem || !scheduleTime) return;
    setActionLoading(true);
    try {
      await api.approveDraft(selectedItem.draft.id, false, new Date(scheduleTime).toISOString());
      setFeedbackMsg({
        type: 'success',
        text: 'Email scheduled for delivery during configured business hours.',
      });
      setScheduleModal(false);
      onRefresh();
    } catch (err) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };


  return (
    <div className="space-y-6 pb-16">
      {/* Page Header */}
      <PageHeader
        title="Mandatory Human Approval Queue"
        subtitle="Review, fine-tune, or authorize AI-generated drafts. No email can be dispatched without explicit admin approval."
        actions={
          <button
            type="button"
            onClick={onRefresh}
            className="btn-secondary text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            <span>Refresh Queue</span>
          </button>
        }
      />

      {/* Notification Toast */}
      {feedbackMsg && (
        <div
          className={`flex items-center gap-3 rounded-xl border p-4 text-sm shadow-xs animate-fadeIn ${
            feedbackMsg.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          )}
          <span className="flex-1 font-medium">{feedbackMsg.text}</span>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Empty State */}
      {queue.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="All Caught Up! Queue is Clear"
          description="There are currently no AI drafts awaiting human approval. When target leads are researched or cadences advance, drafts will appear here for authorization."
        />
      ) : (
        /* Draft Cards Listing (16-24px gaps, clean light borders) */
        <div className="space-y-6">
          {queue.map((item) => {
            const draft = item.draft || {};
            const leadName = item.lead_name || 'Contact';
            const companyName = item.company_name || 'Company';
            const initials = getLeadInitials({ name: leadName, email: item.lead_email });
            const isResearchOpen = !!expandedResearch[draft.id];
            const confidencePct = Math.round((draft.confidence_score || 0.95) * 100);

            return (
              <div
                key={draft.id}
                className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden transition-all duration-150 hover:border-slate-300 hover:shadow-sm"
              >
                {/* 1. Card Header */}
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold text-sm">
                      {initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-900">{leadName}</h3>
                        {item.company_website ? (
                          <a
                            href={item.company_website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline font-medium"
                          >
                            <span>{companyName}</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-500 font-medium">{companyName}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
                        <span>{item.lead_email}</span>
                        <span>•</span>
                        <span className="font-medium text-slate-700">Lead Owner: {item.owner_name || 'Unassigned'}</span>
                        {item.approver_name && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-700 font-medium">Approved by: {item.approver_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                    {draft.service_line && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {draft.service_line}
                      </span>
                    )}
                    {draft.flagged_for_review && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300" title={draft.review_reason}>
                        <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                        <span>Review Required</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                      <span>{confidencePct}% Grounded</span>
                    </span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      {draft.kind === 'FIRST_TOUCH' ? 'Initial Outreach' : `Follow-up Step ${draft.stage || 1}`}
                    </span>
                  </div>
                </div>

                {/* 2. Research Collapsible Box */}
                {item.research_summary && (
                  <div className="px-6 pt-4 pb-2 bg-slate-50/50 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => toggleResearch(draft.id)}
                      className="flex items-center justify-between w-full text-left text-xs font-semibold text-slate-700 hover:text-slate-900 pb-2"
                    >
                      <div className="flex items-center gap-1.5 text-indigo-600">
                        <Info className="h-3.5 w-3.5" />
                        <span>Company Research Dossier & Verified Hooks</span>
                      </div>
                      {isResearchOpen ? (
                        <ChevronUp className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      )}
                    </button>

                    {isResearchOpen && (
                      <div className="pt-2 pb-3 text-xs text-slate-600 space-y-2 leading-relaxed animate-fadeIn">
                        <p>{item.research_summary}</p>
                        {item.sources && item.sources.length > 0 && (
                          <div className="pt-2 border-t border-slate-200/60 flex items-center gap-2 flex-wrap">
                            <span className="text-slate-400 font-medium">Source Evidence:</span>
                            {item.sources.map((src, i) => (
                              <a
                                key={i}
                                href={src}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                              >
                                <span>{src.replace(/^https?:\/\//, '').slice(0, 30)}...</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Draft Email Content */}
                <div className="p-6 space-y-3">
                  {draft.flagged_for_review && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-900">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">Review note: </span>
                        <span>{draft.review_reason || 'Service line or content requires confirmation before sending.'}</span>
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                      Subject Line
                    </span>
                    <h4 className="text-sm font-semibold text-slate-900 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      {draft.subject}
                    </h4>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                      Email Body (Strictly Grounded in Knowledge Base)
                    </span>
                    <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/70 text-slate-800 font-sans text-sm leading-relaxed whitespace-pre-wrap">
                      {draft.body ? (
                        draft.body
                      ) : (
                        <span className="italic text-rose-600 font-medium">
                          [Draft body is empty — click 'Regenerate longer' or 'Edit Content' to restore]
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 4. Action Bar (Super Admin) or Read-Only Status Indicator (Staff Admin) */}
                {can('approvals:write') ? (
                  <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        disabled={actionLoading}
                        className="btn-secondary text-xs"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Edit Content</span>
                      </button>


                      <button
                        type="button"
                        onClick={() => openReject(item)}
                        disabled={actionLoading}
                        className="btn-danger-outline text-xs"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Reject & Feedback</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => openSchedule(item)}
                        disabled={actionLoading}
                        className="btn-secondary text-xs"
                      >
                        <Calendar className="h-3.5 w-3.5 text-indigo-600" />
                        <span>Schedule Delivery</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openApproveConfirm(item)}
                        disabled={actionLoading}
                        className="btn-success text-xs font-semibold shadow-xs"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Approve & Send Now</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="px-6 py-3.5 bg-slate-50/70 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                      <span className="font-semibold text-slate-700">Status:</span>
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                        Awaiting Super Admin approval
                      </span>
                    </div>
                    <span className="text-slate-400 text-xs italic">Read-only view • Managed by Super Admin</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Confirm Send Now */}
      <ConfirmDialog
        isOpen={confirmApproveModal}
        title="Authorize & Dispatch Email Immediately?"
        message={`This will execute the mandatory human approval gatekeeper, record your admin signature (${user?.name || 'Admin'}), and send the email to ${selectedItem?.lead_email} through Zoho integration.`}
        confirmText="Approve & Send Now"
        cancelText="Cancel"
        type="success"
        loading={actionLoading}
        onConfirm={handleConfirmApproveImmediate}
        onCancel={() => setConfirmApproveModal(false)}
      />

      {/* MODAL 2: Edit Content */}
      {editModal && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-indigo-600" />
                Edit Outreach Content Prior to Approval
              </h3>
              <button
                type="button"
                onClick={() => setEditModal(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 text-xs pr-1">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold uppercase tracking-wider text-slate-600">
                    Subject Line
                  </label>
                  <span className="text-slate-400 font-mono text-[11px]">{editSubject.length} chars</span>
                </div>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold uppercase tracking-wider text-slate-600">
                    Email Body
                  </label>
                  <span className="text-slate-400 font-mono text-[11px]">{editBody.length} chars</span>
                </div>
                <textarea
                  rows={10}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 leading-relaxed focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 text-xs">
                💡 Edits are recorded in the immutable audit trail with your timestamp and user ID.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditModal(false)}
                className="btn-secondary text-xs"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => handleSaveEdit(false)}
                disabled={actionLoading}
                className="btn-secondary text-xs font-semibold"
              >
                Save Edits (Keep in Queue)
              </button>
              <button
                type="button"
                onClick={() => handleSaveEdit(true)}
                disabled={actionLoading}
                className="btn-success text-xs font-semibold"
              >
                Save & Dispatch Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Reject & Feedback */}
      {rejectModal && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-rose-600" />
                Reject Draft Outreach
              </h3>
              <button
                type="button"
                onClick={() => setRejectModal(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Reason for Rejection *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="e.g. Tone is too aggressive, emphasize corporate executive mentoring instead of junior bootcamps..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  id="regenCheckbox"
                  checked={regenerate}
                  onChange={(e) => setRegenerate(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <label htmlFor="regenCheckbox" className="text-xs text-slate-700 font-medium cursor-pointer">
                  Immediately regenerate a fresh draft taking this feedback into consideration
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setRejectModal(false)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={actionLoading || !rejectReason.trim()}
                className="btn-danger-outline text-xs font-semibold disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Schedule Delivery */}
      {scheduleModal && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                Schedule Delivery Window
              </h3>
              <button
                type="button"
                onClick={() => setScheduleModal(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Scheduled Delivery Date & Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                Draft will be authorized now and staged in the Scheduled Queue. You can cancel or reschedule any time prior to delivery.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setScheduleModal(false)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSchedule}
                disabled={actionLoading || !scheduleTime}
                className="btn-primary text-xs font-semibold disabled:opacity-50"
              >
                {actionLoading ? 'Scheduling...' : 'Authorize & Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
