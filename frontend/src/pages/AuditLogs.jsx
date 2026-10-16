import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Edit3,
  Clock,
  Send,
  User,
  AlertCircle,
  FileText,
  Filter,
  ChevronLeft,
  ChevronRight,
  Code,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import {
  formatDateTime,
  formatRelativeTime,
  formatActionLabel,
} from '../services/formatters';

const ACTION_FILTERS = [
  'ALL',
  'APPROVE_EMAIL',
  'REJECT_DRAFT',
  'EDIT_DRAFT',
  'SCHEDULE_EMAIL',
  'RESCHEDULE_EMAIL',
  'DISPATCH_APPROVED_EMAIL',
  'EMAIL_SENT',
  'SYNC_ZOHO_CRM',
  'CSV_IMPORT',
  'OPT_OUT',
];

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('ALL'); // ALL | TODAY | 7DAYS | 30DAYS

  // Expanded JSON Modal
  const [activeJsonLog, setActiveJsonLog] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const data = await api.getAuditLogs(200);
      setLogs(data || []);
      setCurrentPage(1);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const getActionBadgeClass = (action) => {
    const act = (action || '').toUpperCase();
    if (act.includes('APPROVE') || act.includes('SENT') || act.includes('DISPATCH')) {
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    }
    if (act.includes('REJECT') || act.includes('OPT_OUT')) {
      return 'bg-rose-50 text-rose-800 border-rose-200';
    }
    if (act.includes('EDIT')) {
      return 'bg-amber-50 text-amber-800 border-amber-200';
    }
    if (act.includes('SCHEDULE')) {
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    }
    if (act.includes('SYNC') || act.includes('IMPORT')) {
      return 'bg-sky-50 text-sky-800 border-sky-200';
    }
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  // Helper to extract timestamp safely
  const getLogTimestamp = (log) => {
    return log.timestamp || log.created_at || log.ts || (log.$date ? log.$date : null);
  };

  // Helper for human-readable details summary
  const getDetailsSummary = (log) => {
    const d = log.details || {};
    if (d.to) {
      return `To ${d.to}${d.subject ? ` • "${d.subject}"` : ''}`;
    }
    if (d.reason) {
      return `Reason: "${d.reason}"${d.regenerate ? ' (Regeneration requested)' : ''}`;
    }
    if (d.new_scheduled_for) {
      return `Rescheduled for ${formatDateTime(d.new_scheduled_for)}`;
    }
    if (d.synced !== undefined) {
      return `${d.synced} leads synced from Zoho CRM`;
    }
    if (d.created !== undefined && d.skipped !== undefined) {
      return `Imported ${d.created} leads, skipped ${d.skipped} duplicates`;
    }
    if (d.email) {
      return `Email: ${d.email}`;
    }
    if (Object.keys(d).length === 0) {
      return '—';
    }
    return Object.entries(d)
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(', ');
  };

  const handleCopyId = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtered and paginated logs
  const filteredLogs = useMemo(() => {
    let result = logs;

    // Action filter
    if (actionFilter !== 'ALL') {
      result = result.filter((l) => l.action === actionFilter);
    }

    // Date filter
    if (dateFilter !== 'ALL') {
      const now = new Date();
      result = result.filter((l) => {
        const ts = getLogTimestamp(l);
        if (!ts) return false;
        const logDate = new Date(ts);
        const diffDays = (now - logDate) / (1000 * 60 * 60 * 24);
        if (dateFilter === 'TODAY') return diffDays <= 1;
        if (dateFilter === '7DAYS') return diffDays <= 7;
        if (dateFilter === '30DAYS') return diffDays <= 30;
        return true;
      });
    }

    // Search term
    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter((l) => {
        const actionStr = (l.action || '').toLowerCase();
        const userStr = (l.user_name || '').toLowerCase();
        const emailStr = (l.user_email || '').toLowerCase();
        const entityStr = (l.entity_type || '').toLowerCase();
        const detailsStr = JSON.stringify(l.details || {}).toLowerCase();
        return (
          actionStr.includes(term) ||
          userStr.includes(term) ||
          emailStr.includes(term) ||
          entityStr.includes(term) ||
          detailsStr.includes(term)
        );
      });
    }

    return result;
  }, [logs, actionFilter, dateFilter, search]);

  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-6 pb-16">
      {/* Page Header */}
      <PageHeader
        title="Security & Compliance Audit Trail"
        subtitle="Immutable ledger of all human approvals, edits, rejections, and dispatch events for regulatory compliance."
        actions={
          <button
            type="button"
            onClick={fetchLogs}
            className="btn-secondary text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            <span>Refresh Ledger</span>
          </button>
        }
      />

      {/* Filters Row: Search, Action Filter, Date Range */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by action, user, or details..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9.5 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Action Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 font-medium focus:border-indigo-600 focus:outline-none"
            >
              <option value="ALL">All Actions</option>
              {ACTION_FILTERS.filter((a) => a !== 'ALL').map((act) => (
                <option key={act} value={act}>
                  {formatActionLabel(act)}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter */}
          <select
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 font-medium focus:border-indigo-600 focus:outline-none"
          >
            <option value="ALL">All Time</option>
            <option value="TODAY">Last 24 Hours</option>
            <option value="7DAYS">Last 7 Days</option>
            <option value="30DAYS">Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-indigo-600" />
            Loading compliance ledger...
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No Audit Records Found"
            description={
              search || actionFilter !== 'ALL' || dateFilter !== 'ALL'
                ? 'No events match your current filter parameters.'
                : 'Compliance records will appear automatically when actions are authorized.'
            }
            className="border-0 py-16"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4">Actor</th>
                  <th className="py-3.5 px-4">Entity</th>
                  <th className="py-3.5 px-4">Summary</th>
                  <th className="py-3.5 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {paginatedLogs.map((log) => {
                  const rawTs = getLogTimestamp(log);
                  const formattedTs = formatDateTime(rawTs, false);
                  const relativeTs = formatRelativeTime(rawTs);
                  const badgeClass = getActionBadgeClass(log.action);
                  const actionLabel = formatActionLabel(log.action);
                  const detailsSummary = getDetailsSummary(log);

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Timestamp with Relative Tooltip */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div title={relativeTs}>
                          <span className="font-medium text-slate-800 block">
                            {formattedTs}
                          </span>
                          {relativeTs && (
                            <span className="text-[11px] text-slate-400 block">
                              {relativeTs}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Action Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeClass}`}
                        >
                          {actionLabel}
                        </span>
                      </td>

                      {/* Actor */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-semibold text-slate-900">
                            {log.user_name || 'System'}
                          </span>
                          {log.user_email && (
                            <span className="text-[11px] text-slate-500">
                              ({log.user_email})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Entity with Copy on Hover */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 font-mono text-[11px] text-slate-600">
                          <span>{log.entity_type}</span>
                          {log.entity_id && (
                            <button
                              type="button"
                              onClick={() => handleCopyId(log.entity_id)}
                              title={`Copy Entity ID: ${log.entity_id}`}
                              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-slate-500 hover:text-indigo-600 hover:bg-slate-100 transition"
                            >
                              <span>#{log.entity_id.slice(-6)}</span>
                              {copiedId === log.entity_id ? (
                                <Check className="h-3 w-3 text-emerald-600" />
                              ) : (
                                <Copy className="h-2.5 w-2.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Readable Summary */}
                      <td className="py-3.5 px-4 max-w-xs truncate text-slate-600">
                        <span title={detailsSummary}>{detailsSummary}</span>
                      </td>

                      {/* View JSON button */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setActiveJsonLog(log)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 hover:bg-slate-50 text-[11px] font-medium transition shadow-2xs"
                        >
                          <Code className="h-3 w-3" />
                          <span>View JSON</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer with Pagination */}
        {filteredLogs.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div>
              Showing{' '}
              <strong className="text-slate-900">
                {(currentPage - 1) * pageSize + 1}
              </strong>{' '}
              to{' '}
              <strong className="text-slate-900">
                {Math.min(currentPage * pageSize, filteredLogs.length)}
              </strong>{' '}
              of <strong className="text-slate-900">{filteredLogs.length}</strong> events
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 font-medium text-slate-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* JSON Viewer Modal / Drawer */}
      {activeJsonLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Code className="h-4 w-4 text-indigo-600" />
                Immutable Audit Record #{activeJsonLog.id || activeJsonLog._id}
              </h3>
              <button
                type="button"
                onClick={() => setActiveJsonLog(null)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <pre className="p-4 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs leading-relaxed overflow-x-auto">
                {JSON.stringify(activeJsonLog, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
              <span className="text-slate-500 font-mono text-[11px]">
                Recorded: {formatDateTime(getLogTimestamp(activeJsonLog), true)}
              </span>
              <button
                type="button"
                onClick={() => setActiveJsonLog(null)}
                className="btn-secondary text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
