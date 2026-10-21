import React, { useState, useEffect } from 'react';
import {
  X,
  Building,
  Mail,
  Globe,
  Phone,
  Sparkles,
  Send,
  MessageSquare,
  Clock,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Bot,
  User,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import { usePermissions, Can } from '../services/permissions';
import {
  getLeadDisplayName,
  getLeadCompany,
  getLeadInitials,
  formatDateTime,
} from '../services/formatters';

const STATUS_OPTIONS = [
  'New Lead',
  'Draft Ready',
  'In Cadence',
  'Contacted',
  'Engaged',
  'Qualified',
  'Converted',
  'Follow-up Pending',
  'Opted Out',
  'Lost / Dormant',
];

export default function LeadDetailModal({ lead, onClose, onLeadUpdated }) {
  const { can, isReadOnly } = usePermissions();
  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [thread, setThread] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [currentLead, setCurrentLead] = useState(lead);

  // Inbound Simulator State
  const [simBody, setSimBody] = useState('');
  const [simSubject, setSimSubject] = useState(`Re: Partnership with Traininglobe`);
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState(null);

  useEffect(() => {
    fetchThread();
  }, [lead.id]);

  const fetchThread = async () => {
    try {
      setLoadingThread(true);
      const data = await api.getThread(lead.id);
      setThread(data || []);
    } catch (err) {
      console.error('Failed to load thread:', err);
    } finally {
      setLoadingThread(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    try {
      setUpdatingStatus(true);
      const updated = await api.updateLead(lead.id, { status: newStatus });
      setCurrentLead(updated);
      onLeadUpdated(updated);
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSimulateReply = async (presetText) => {
    const textToSend = presetText || simBody;
    if (!textToSend.trim()) return;

    try {
      setSimulating(true);
      setSimError(null);
      setSimResult(null);

      const res = await api.simulateInboundReply({
        from_email: currentLead.email,
        to_email: 'outreach@traininglobe.com',
        subject: simSubject,
        body_text: textToSend,
        body: textToSend,
        message_id: `sim-${Date.now()}`,
      });

      setSimResult(res);
      setSimBody('');
      // Refresh lead & thread
      const freshLead = await api.getLead(lead.id);
      setCurrentLead(freshLead);
      onLeadUpdated(freshLead);
      fetchThread();
    } catch (err) {
      setSimError(err.message || 'Failed to simulate reply');
    } finally {
      setSimulating(false);
    }
  };

  const displayName = getLeadDisplayName(currentLead);
  const companyName = getLeadCompany(currentLead);
  const initials = getLeadInitials(currentLead);
  const research = currentLead.research_data || currentLead.research || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold text-sm">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold text-slate-900">{displayName}</h2>
                <StatusBadge status={currentLead.status} />
                {currentLead.zoho_lead_id && (
                  <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-mono text-slate-600">
                    Zoho ID: {currentLead.zoho_lead_id}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {currentLead.extra_fields?.title ? `${currentLead.extra_fields.title} • ` : ''}
                {companyName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-slate-200 px-6 bg-slate-50/50 gap-2">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition ${
              activeSubTab === 'overview'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Lead Overview
          </button>
          <button
            onClick={() => setActiveSubTab('research')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition ${
              activeSubTab === 'research'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            AI Research Dossier
          </button>
          <button
            onClick={() => setActiveSubTab('thread')}
            className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition ${
              activeSubTab === 'thread'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Conversation History ({thread.length})
          </button>
          {can('emails:write') && (
            <button
              onClick={() => setActiveSubTab('simulator')}
              className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition ${
                activeSubTab === 'simulator'
                  ? 'border-amber-600 text-amber-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Bot className="h-3.5 w-3.5 text-amber-600" />
              Inbound Reply Simulator
            </button>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeSubTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 shadow-xs">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Contact Information
                  </h3>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex items-center gap-2.5 text-slate-700">
                      <Mail className="h-4 w-4 text-slate-400" />
                      <a href={`mailto:${currentLead.email}`} className="text-indigo-600 hover:underline">
                        {currentLead.email}
                      </a>
                    </div>
                    {currentLead.extra_fields?.phone && (
                      <div className="flex items-center gap-2.5 text-slate-700">
                        <Phone className="h-4 w-4 text-slate-400" />
                        <span>{currentLead.extra_fields.phone}</span>
                      </div>
                    )}
                    {currentLead.company_website && (
                      <div className="flex items-center gap-2.5 text-slate-700">
                        <Globe className="h-4 w-4 text-slate-400" />
                        <a
                          href={currentLead.company_website}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-indigo-600 hover:underline"
                        >
                          {currentLead.company_website}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                    <div className="flex items-center gap-2.5 text-slate-700">
                      <Building className="h-4 w-4 text-slate-400" />
                      <span>{companyName}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-700 pt-1 border-t border-slate-100">
                      <User className="h-4 w-4 text-slate-400" />
                      <span>Lead Owner: <strong className="text-slate-800">{currentLead.owner_name || 'Unassigned'}</strong></span>
                    </div>
                    {currentLead.approver_name && (
                      <div className="flex items-center gap-2.5 text-slate-700">
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                        <span>Approved by: <strong className="text-slate-800">{currentLead.approver_name}</strong></span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 shadow-xs">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Lifecycle & Cadence
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1 font-medium">Lifecycle Status</label>
                      {can('leads:write') ? (
                        <select
                          value={currentLead.status}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          disabled={updatingStatus}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                        >
                          {STATUS_OPTIONS.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="py-1">
                          <StatusBadge status={currentLead.status} />
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                        <span className="text-slate-500 block">Cadence Step</span>
                        <span className="font-semibold text-slate-900">
                          Step {currentLead.followup_count !== undefined ? currentLead.followup_count + 1 : 1} of {currentLead.max_followups || 3}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                        <span className="text-slate-500 block">Next Action</span>
                        <span className="font-semibold text-slate-900">
                          {currentLead.next_action_at
                            ? formatDateTime(currentLead.next_action_at)
                            : 'Follow-up pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Research Dossier Preview */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-5">
                <div className="flex items-center gap-2 text-indigo-700 font-semibold text-xs uppercase tracking-wider mb-1.5">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  Account Intelligence Summary
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {research.summary ||
                    currentLead.research_summary ||
                    'Lead has been registered. AI is standing by to prepare grounded outreach personalized to their business profile.'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: AI RESEARCH */}
          {activeSubTab === 'research' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-1.5">
                    Company Overview & Synthesis
                  </h4>
                  <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                    {research.summary || currentLead.research_summary || 'No detailed synthesis available yet.'}
                  </p>
                </div>

                {research.company_priorities && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Identified Needs & Talent Priorities
                    </h4>
                    <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                      {research.company_priorities}
                    </p>
                  </div>
                )}

                {research.recent_news && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                      Recent Trigger Events & Context
                    </h4>
                    <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                      {research.recent_news}
                    </p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                    Verified Source URLs
                  </h4>
                  {research.source_urls && research.source_urls.length > 0 ? (
                    <ul className="space-y-1 text-xs">
                      {research.source_urls.map((url, i) => (
                        <li key={i}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"
                          >
                            <Globe className="h-3 w-3" />
                            <span>{url}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-400">No external source links recorded</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: THREAD */}
          {activeSubTab === 'thread' && (
            <div className="space-y-4">
              {loadingThread ? (
                <div className="flex items-center justify-center py-12 text-slate-400 text-xs">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2 text-indigo-600" />
                  Loading conversation history...
                </div>
              ) : thread.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                  <Mail className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">No emails sent yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Check the Approval Queue to authorize the first outbound touch.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {thread.map((em) => {
                    const isInbound = em.direction === 'INBOUND' || em.direction === 'inbound';
                    return (
                      <div
                        key={em.id}
                        className={`rounded-xl border p-4 space-y-2.5 shadow-2xs ${
                          isInbound
                            ? 'border-amber-200 bg-amber-50/50'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isInbound ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-200">
                                <User className="h-3 w-3" /> Inbound Reply
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200">
                                <Send className="h-3 w-3" /> Outbound ({em.status})
                              </span>
                            )}
                            {em.detected_intent && (
                              <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 border border-purple-200">
                                Intent: {em.detected_intent}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            {formatDateTime(em.sent_at || em.created_at)}
                          </span>
                        </div>

                        <h4 className="text-sm font-semibold text-slate-900">{em.subject}</h4>
                        <div className="text-xs text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
                          {em.body_text || em.body || 'No content'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: INBOUND SIMULATOR */}
          {activeSubTab === 'simulator' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1.5">
                <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
                  <Bot className="h-4 w-4 text-amber-600" />
                  Prospect Response Simulator
                </div>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Test how the system's AI classifier detects prospect intent, halts cadences on opt-out,
                  or stages high-value meeting responses for sales reps.
                </p>
              </div>

              {/* Presets */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Quick Preset Replies
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleSimulateReply(
                        'Hi, we are actually looking to train 25 corporate managers next month. Can we get on a quick 15-minute call Tuesday at 2 PM?'
                      )
                    }
                    disabled={simulating}
                    className="text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-300 hover:bg-emerald-50/50 transition shadow-2xs text-xs"
                  >
                    <span className="font-semibold text-emerald-800 block mb-0.5">
                      ✓ Interested / Meeting Request
                    </span>
                    <span className="text-slate-500 text-[11px] line-clamp-1">
                      "Can we get on a quick 15-minute call Tuesday at 2 PM?"
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleSimulateReply(
                        'Could you send over your detailed curriculum for data science programs, along with the standard corporate pricing tier?'
                      )
                    }
                    disabled={simulating}
                    className="text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-300 hover:bg-indigo-50/50 transition shadow-2xs text-xs"
                  >
                    <span className="font-semibold text-indigo-700 block mb-0.5">
                      ? Asks a Question / Pricing
                    </span>
                    <span className="text-slate-500 text-[11px] line-clamp-1">
                      "Could you send over your detailed curriculum..."
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleSimulateReply(
                        'Please remove me from your email list and do not contact me again. Unsubscribe.'
                      )
                    }
                    disabled={simulating}
                    className="text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-rose-300 hover:bg-rose-50/50 transition shadow-2xs text-xs"
                  >
                    <span className="font-semibold text-rose-700 block mb-0.5">
                      ⛔ Opt-Out / Stop Cadence
                    </span>
                    <span className="text-slate-500 text-[11px] line-clamp-1">
                      "Please remove me from your email list..."
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleSimulateReply(
                        'We are currently in Q4 budget freeze, but please reach out to me in January when new budgets unlock.'
                      )
                    }
                    disabled={simulating}
                    className="text-left rounded-lg border border-slate-200 bg-white p-3 hover:border-amber-300 hover:bg-amber-50/50 transition shadow-2xs text-xs"
                  >
                    <span className="font-semibold text-amber-800 block mb-0.5">
                      ⏳ Contact Me Later
                    </span>
                    <span className="text-slate-500 text-[11px] line-clamp-1">
                      "Reach out to me in January when new budgets unlock."
                    </span>
                  </button>
                </div>
              </div>

              {/* Custom Input */}
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Subject</label>
                  <input
                    type="text"
                    value={simSubject}
                    onChange={(e) => setSimSubject(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Custom Reply Body</label>
                  <textarea
                    rows={4}
                    value={simBody}
                    onChange={(e) => setSimBody(e.target.value)}
                    placeholder="Type what the prospect wrote back..."
                    className="w-full rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none leading-relaxed"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleSimulateReply()}
                  disabled={simulating || !simBody.trim()}
                  className="flex items-center justify-center gap-2 w-full rounded-lg bg-amber-600 py-2.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition shadow-xs"
                >
                  {simulating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Classifying Intent & Updating Lead...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Simulate Inbound Reply
                    </>
                  )}
                </button>
              </div>

              {/* Simulation Result */}
              {simResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2 animate-fadeIn">
                  <div className="flex items-center gap-2 text-emerald-800 font-semibold text-xs">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    Reply Processed Successfully!
                  </div>
                  <div className="text-xs text-slate-700 space-y-1.5 pt-1">
                    <div>
                      <span className="text-slate-500">Classified Intent:</span>{' '}
                      <span className="font-bold text-slate-900 px-2 py-0.5 rounded-md bg-white border border-slate-200">
                        {simResult.detected_intent || simResult.intent}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Action Taken:</span>{' '}
                      <span className="text-slate-800">
                        {simResult.action_taken || `Updated status to "${simResult.new_lead_status}" & queued next draft for human approval`}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">New Lead Lifecycle Status:</span>{' '}
                      <span className="font-semibold text-indigo-700">{simResult.new_lead_status}</span>
                    </div>
                  </div>
                </div>
              )}

              {simError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-rose-600" />
                  <span>{simError}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
