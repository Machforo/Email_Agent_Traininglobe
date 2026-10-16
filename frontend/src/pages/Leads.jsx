import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
  Plus,
  Upload,
  RefreshCw,
  ExternalLink,
  Mail,
  Building,
  Trash2,
  Eye,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import LeadDetailModal from './LeadDetailModal';
import { usePermissions, Can } from '../services/permissions';
import {
  getLeadDisplayName,
  getLeadCompany,
  getLeadInitials,
  formatDateTime,
  formatRelativeTime,
} from '../services/formatters';

const STATUS_FILTERS = [
  'ALL',
  'Draft Ready',
  'New Lead',
  'In Cadence',
  'Contacted',
  'Engaged',
  'Qualified',
  'Converted',
  'Follow-up Pending',
  'Opted Out',
  'Lost / Dormant',
];

export default function Leads() {
  const { can, isReadOnly } = usePermissions();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedLead, setSelectedLead] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Modals & Dialogs
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Form states
  const [addForm, setAddForm] = useState({
    name: '',
    email: '',
    company_name: '',
    company_website: '',
    phone: '',
    title: '',
  });
  const [addingLead, setAddingLead] = useState(false);

  // Import CSV State
  const [csvFile, setCsvFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Zoho Sync
  const [syncingZoho, setSyncingZoho] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    fetchLeads();
  }, [statusFilter]);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const filter = statusFilter === 'ALL' ? null : statusFilter;
      const data = await api.listLeads(filter, search);
      setLeads(data || []);
      setCurrentPage(1);
    } catch (err) {
      console.error('Failed to load leads:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchLeads();
  };

  // Status counts for filter pills
  const statusCounts = useMemo(() => {
    const counts = { ALL: leads.length };
    leads.forEach((l) => {
      const st = l.status || 'New Lead';
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [leads]);

  // Paginated records
  const filteredLeads = useMemo(() => {
    if (!search.trim()) return leads;
    const term = search.toLowerCase();
    return leads.filter((l) => {
      const name = getLeadDisplayName(l).toLowerCase();
      const comp = getLeadCompany(l).toLowerCase();
      const em = (l.email || '').toLowerCase();
      return name.includes(term) || comp.includes(term) || em.includes(term);
    });
  }, [leads, search]);

  const totalPages = Math.ceil(filteredLeads.length / pageSize) || 1;
  const paginatedLeads = filteredLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleAddLead = async (e) => {
    e.preventDefault();
    try {
      setAddingLead(true);
      await api.createLead({
        name: addForm.name,
        email: addForm.email,
        company_name: addForm.company_name || addForm.email.split('@')[1] || 'Company',
        company_website: addForm.company_website || null,
        extra_fields: {
          phone: addForm.phone,
          title: addForm.title,
        },
      });
      setIsAddOpen(false);
      setAddForm({
        name: '',
        email: '',
        company_name: '',
        company_website: '',
        phone: '',
        title: '',
      });
      showNotification('success', 'Lead registered! AI research and first touch draft queued.');
      fetchLeads();
    } catch (err) {
      alert(`Failed to add lead: ${err.message}`);
    } finally {
      setAddingLead(false);
    }
  };

  const handleImportCSV = async (e) => {
    e.preventDefault();
    if (!csvFile) return;

    try {
      setImporting(true);
      const res = await api.importCSV(csvFile);
      setImportResult(res);
      showNotification('success', `Imported ${res.created} leads (${res.skipped} skipped duplicates)`);
      fetchLeads();
    } catch (err) {
      alert(`CSV Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleSyncZoho = async () => {
    try {
      setSyncingZoho(true);
      const res = await api.syncZoho();
      showNotification(
        'success',
        res.dry_run
          ? `Zoho CRM [Dry-Run]: ${res.message || 'Synced leads cleanly'}`
          : `Zoho CRM: ${res.synced} leads synced`
      );
      fetchLeads();
    } catch (err) {
      showNotification('error', `Zoho sync failed: ${err.message}`);
    } finally {
      setSyncingZoho(false);
    }
  };

  const confirmDeleteLead = async () => {
    if (!leadToDelete) return;
    try {
      setDeleting(true);
      await api.deleteLead(leadToDelete.id);
      setLeads((prev) => prev.filter((l) => l.id !== leadToDelete.id));
      showNotification('success', 'Lead and associated drafts removed');
      setLeadToDelete(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const downloadSampleCSV = () => {
    const csvContent =
      'name,email,company_name,company_website,phone,title\n' +
      'Arun Sharma,arun.sharma@techmatrix.in,TechMatrix Solutions,https://techmatrix.in,+91 98765 43210,Head of Talent\n' +
      'Priya Nair,priya.nair@innovatetech.com,InnovateTech Labs,https://innovatetech.com,+91 98111 22334,VP Engineering\n';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'traininglobe_leads_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper for determining meaningful next action text
  const getNextActionText = (lead) => {
    if (lead.status === 'Draft Ready') return 'Awaiting admin approval';
    if (lead.status === 'Opted Out') return 'Halted (suppressed)';
    if (lead.status === 'Converted') return 'Converted customer';
    if (lead.next_action_at || lead.next_followup_at) {
      const date = lead.next_action_at || lead.next_followup_at;
      return `Follow-up ${formatRelativeTime(date)}`;
    }
    if (lead.status === 'Contacted' || lead.status === 'In Cadence') {
      return 'Follow-up in 3 days';
    }
    if (lead.status === 'Replied' || lead.status === 'Engaged') {
      return 'Reply draft ready';
    }
    return 'Researching account';
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

      {/* Page Header with Action Buttons */}
      <PageHeader
        title="Lead Portfolio & Cadences"
        subtitle="Manage accounts, trigger AI profile research, and monitor lifecycle progression."
        actions={
          <Can permission="leads:write">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleSyncZoho}
                disabled={syncingZoho}
                className="btn-secondary text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${syncingZoho ? 'animate-spin text-indigo-600' : ''}`} />
                <span>{syncingZoho ? 'Syncing...' : 'Sync Zoho CRM'}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportOpen(true)}
                className="btn-secondary text-xs"
              >
                <Upload className="h-3.5 w-3.5 text-slate-500" />
                <span>Import CSV</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAddOpen(true)}
                className="btn-primary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add New Lead</span>
              </button>
            </div>
          </Can>
        }
      />

      {/* Search Bar and Horizontally Scrollable Status Pills */}
      <div className="space-y-3">
        <form onSubmit={handleSearchSubmit} className="relative max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by contact name, company, or email..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9.5 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
          />
        </form>

        {/* Status Filters: 8px gaps, horizontal scroll, counts */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 no-scrollbar">
          {STATUS_FILTERS.map((st) => {
            const isSelected = statusFilter === st;
            const count = statusCounts[st] || 0;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>{st}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isSelected ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Leads Table Container */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
            <RefreshCw className="h-5 w-5 animate-spin mr-2 text-indigo-600" />
            Loading lead records...
          </div>
        ) : filteredLeads.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No Leads Found"
            description={
              search
                ? `No leads matched your search query "${search}". Try adjusting your filters.`
                : 'Your portfolio has no leads under this filter. Add a new lead or import a CSV file to get started.'
            }
            actionText={can('leads:write') ? "Add New Lead" : null}
            onAction={can('leads:write') ? () => setIsAddOpen(true) : null}
            className="border-0 py-16"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4">Contact & Company</th>
                  <th className="py-3.5 px-4">Email</th>
                  <th className="py-3.5 px-4">Lifecycle Status</th>
                  <th className="py-3.5 px-4">Cadence</th>
                  <th className="py-3.5 px-4">Next Action</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {paginatedLeads.map((lead) => {
                  const displayName = getLeadDisplayName(lead);
                  const companyName = getLeadCompany(lead);
                  const initials = getLeadInitials(lead);
                  const cadenceStep = lead.followup_count !== undefined ? lead.followup_count + 1 : lead.cadence_step || 1;
                  const maxCadence = lead.max_followups || 3;
                  const nextAction = getNextActionText(lead);

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* Name & Company */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-100 font-bold text-indigo-700 text-xs">
                            {initials}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 block group-hover:text-indigo-600 transition-colors">
                              {displayName}
                            </span>
                            <span className="text-slate-500 text-[11px] block mt-0.5">
                              {lead.extra_fields?.title ? `${lead.extra_fields.title} • ` : ''}
                              {companyName}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="font-medium text-slate-700">{lead.email}</span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <StatusBadge status={lead.status} />
                      </td>

                      {/* Cadence */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-800">
                            Step {cadenceStep} of {maxCadence}
                          </span>
                          {lead.research_summary && (
                            <span className="flex items-center gap-1 text-[10px] text-indigo-600 font-medium">
                              <Sparkles className="h-2.5 w-2.5" /> AI Researched
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Next Action */}
                      <td className="py-3.5 px-4 text-slate-600">
                        <span className="font-medium text-slate-700">{nextAction}</span>
                      </td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-4 text-right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedLead(lead)}
                            title="View Lead Details"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:bg-slate-50 transition shadow-2xs"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <Can permission="leads:write">
                            <button
                              type="button"
                              onClick={() => setLeadToDelete(lead)}
                              title="Delete Lead"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition shadow-2xs"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </Can>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer with Pagination / "Showing X of Y" */}
        {filteredLeads.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <div>
              Showing{' '}
              <strong className="text-slate-900">
                {(currentPage - 1) * pageSize + 1}
              </strong>{' '}
              to{' '}
              <strong className="text-slate-900">
                {Math.min(currentPage * pageSize, filteredLeads.length)}
              </strong>{' '}
              of <strong className="text-slate-900">{filteredLeads.length}</strong> leads
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

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!leadToDelete}
        title="Delete Lead & Associated Drafts?"
        message={`Are you sure you want to remove ${
          leadToDelete ? getLeadDisplayName(leadToDelete) : 'this lead'
        } (${leadToDelete?.email})? All associated email drafts and conversation history will be permanently deleted.`}
        confirmText="Delete Lead"
        cancelText="Cancel"
        type="danger"
        loading={deleting}
        onConfirm={confirmDeleteLead}
        onCancel={() => setLeadToDelete(null)}
      />

      {/* MODAL: Add Lead */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Plus className="h-4 w-4 text-indigo-600" />
                Add Target Lead
              </h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleAddLead} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Full Name *
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Vikram Malhotra"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Work Email *
                </label>
                <input
                  required
                  type="email"
                  placeholder="name@company.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Acme Tech"
                    value={addForm.company_name}
                    onChange={(e) => setAddForm({ ...addForm, company_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Job Title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. VP of Engineering"
                    value={addForm.title}
                    onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Company Website
                  </label>
                  <input
                    type="url"
                    placeholder="https://company.com"
                    value={addForm.company_website}
                    onChange={(e) => setAddForm({ ...addForm, company_website: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={addForm.phone}
                    onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 text-xs">
                💡 Upon creation, the agent automatically conducts company research and drafts the first email for your review in the Approval Queue.
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingLead}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {addingLead ? 'Registering & Researching...' : 'Register Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Import CSV */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Upload className="h-4 w-4 text-indigo-600" />
                Import Leads from CSV
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsImportOpen(false);
                  setImportResult(null);
                }}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleImportCSV} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-2">
                  Select CSV File
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files[0])}
                  className="block w-full text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 file:cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={downloadSampleCSV}
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline font-medium"
                >
                  <Download className="h-3.5 w-3.5" /> Download Sample Template
                </button>
              </div>

              {importResult && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 text-xs">
                  ✓ Created: {importResult.created} | Skipped: {importResult.skipped}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsImportOpen(false);
                    setImportResult(null);
                  }}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={importing || !csvFile}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {importing ? 'Importing...' : 'Upload & Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lead Detail & Inbound Simulator Modal */}
      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onLeadUpdated={(updated) => {
            setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
          }}
        />
      )}
    </div>
  );
}
