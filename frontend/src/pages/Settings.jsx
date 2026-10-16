import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  Save,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  Clock,
  Send,
  Sparkles,
  Bell,
  Mail,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import Tabs from '../components/Tabs';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { formatCategoryName } from '../services/formatters';
import { usePermissions, Can } from '../services/permissions';

const CATEGORIES = ['Approved Claims', 'Restrictions', 'Program', 'Metric', 'Client', 'USP', 'Company', 'Policy'];

export default function Settings() {
  const { can, isReadOnly } = usePermissions();
  const [activeTab, setActiveTab] = useState('knowledge');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notification, setNotification] = useState(null);

  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    daily_limit: 50,
    daily_send_limit: 50,
    send_window_start: '09:00',
    send_window_end: '18:00',
    business_hours_start: 9,
    business_hours_end: 19,
    timezone: 'Asia/Kolkata',
    followup_interval_days: 3,
    followup_intervals_days: [3, 5, 7],
    max_followups: 4,
    dry_run_mode: true,
    default_send_time: '18:00',
    // Scheduled Email Reminders
    reminder_enabled: true,
    reminder_lead_minutes: 30,
    reminder_email_recipients_str: '',
    reminder_channels: ['email', 'dashboard'],
    reminder_send_immediately_if_due: true,
  });

  // Knowledge Base State
  const [kbItems, setKbItems] = useState([]);
  const [isAddKbOpen, setIsAddKbOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [deletingKb, setDeletingKb] = useState(false);

  const [kbForm, setKbForm] = useState({
    category: 'Approved Claims',
    title: '',
    content: '',
    source: '',
  });
  const [savingKb, setSavingKb] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [settingsData, kbData] = await Promise.all([
        can('settings:read') ? api.getSettings().catch(() => null) : Promise.resolve(null),
        api.listKnowledgeBase().catch(() => []),
      ]);

      if (settingsData) {
        const extraRecipients = Array.isArray(settingsData.reminder_email_recipients)
          ? settingsData.reminder_email_recipients.join(', ')
          : '';
        setSettingsForm({
          daily_limit: settingsData.daily_send_limit || settingsData.daily_limit || 50,
          daily_send_limit: settingsData.daily_send_limit || settingsData.daily_limit || 50,
          send_window_start: settingsData.send_window_start || '09:00',
          send_window_end: settingsData.send_window_end || '18:00',
          business_hours_start: settingsData.business_hours_start !== undefined ? settingsData.business_hours_start : 9,
          business_hours_end: settingsData.business_hours_end !== undefined ? settingsData.business_hours_end : 19,
          timezone: settingsData.timezone || 'Asia/Kolkata',
          followup_interval_days: settingsData.followup_interval_days || 3,
          followup_intervals_days: settingsData.followup_intervals_days || [3, 5, 7],
          max_followups: settingsData.max_followups || 4,
          dry_run_mode: settingsData.dry_run_mode !== undefined ? settingsData.dry_run_mode : true,
          default_send_time: settingsData.default_send_time || '18:00',
          reminder_enabled: settingsData.reminder_enabled !== undefined ? settingsData.reminder_enabled : true,
          reminder_lead_minutes: settingsData.reminder_lead_minutes || 30,
          reminder_email_recipients_str: extraRecipients,
          reminder_channels: settingsData.reminder_channels || ['email', 'dashboard'],
          reminder_send_immediately_if_due: settingsData.reminder_send_immediately_if_due !== undefined ? settingsData.reminder_send_immediately_if_due : true,
        });
      }

      setKbItems(kbData || []);
    } catch (err) {
      console.error('Failed to load settings data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      setSavingSettings(true);
      const recipientList = settingsForm.reminder_email_recipients_str
        ? settingsForm.reminder_email_recipients_str
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];

      const payload = {
        default_send_time: settingsForm.default_send_time || '18:00',
        timezone: settingsForm.timezone || 'Asia/Kolkata',
        business_hours_start: settingsForm.business_hours_start || 9,
        business_hours_end: settingsForm.business_hours_end || 19,
        daily_send_limit: settingsForm.daily_limit || settingsForm.daily_send_limit || 50,
        followup_intervals_days: settingsForm.followup_intervals_days || [3, 5, 7],
        max_followups: settingsForm.max_followups || 3,
        dry_run_mode: settingsForm.dry_run_mode,
        reminder_enabled: Boolean(settingsForm.reminder_enabled),
        reminder_lead_minutes: parseInt(settingsForm.reminder_lead_minutes) || 30,
        reminder_email_recipients: recipientList,
        reminder_channels: settingsForm.reminder_channels || ['email', 'dashboard'],
        reminder_send_immediately_if_due: Boolean(settingsForm.reminder_send_immediately_if_due),
      };

      await api.updateSettings(payload);
      showNotification('success', 'System dispatch and reminder rules updated successfully');
    } catch (err) {
      showNotification('error', `Failed to update settings: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  const openAddKb = () => {
    setEditingItem(null);
    setKbForm({
      category: 'Approved Claims',
      title: '',
      content: '',
      source: '',
    });
    setIsAddKbOpen(true);
  };

  const openEditKb = (item) => {
    setEditingItem(item);
    setKbForm({
      category: item.category || 'Approved Claims',
      title: item.title || '',
      content: item.content || '',
      source: item.source || '',
    });
    setIsAddKbOpen(true);
  };

  const handleSaveKb = async (e) => {
    e.preventDefault();
    try {
      setSavingKb(true);
      if (editingItem) {
        // Delete old and add new or update
        await api.deleteKnowledgeBaseItem(editingItem.id).catch(() => {});
        const newItem = await api.addKnowledgeBaseItem(kbForm);
        setKbItems((prev) => [newItem, ...prev.filter((i) => i.id !== editingItem.id)]);
        showNotification('success', 'Knowledge claim updated successfully');
      } else {
        const newItem = await api.addKnowledgeBaseItem(kbForm);
        setKbItems((prev) => [newItem, ...prev]);
        showNotification('success', 'Verified knowledge claim added for AI grounding');
      }
      setIsAddKbOpen(false);
    } catch (err) {
      alert(`Failed to save claim: ${err.message}`);
    } finally {
      setSavingKb(false);
    }
  };

  const confirmDeleteKb = async () => {
    if (!itemToDelete) return;
    try {
      setDeletingKb(true);
      await api.deleteKnowledgeBaseItem(itemToDelete.id);
      setKbItems((prev) => prev.filter((item) => item.id !== itemToDelete.id));
      showNotification('success', 'Knowledge claim removed from grounding store');
      setItemToDelete(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingKb(false);
    }
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const getCategoryBadgeClass = (category) => {
    const cat = (category || '').toLowerCase();
    if (cat.includes('restrict')) {
      return 'bg-rose-50 text-rose-800 border-rose-200';
    }
    if (cat.includes('approve') || cat.includes('claim')) {
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    }
    if (cat.includes('metric') || cat.includes('roi')) {
      return 'bg-sky-50 text-sky-800 border-sky-200';
    }
    if (cat.includes('program') || cat.includes('course')) {
      return 'bg-indigo-50 text-indigo-800 border-indigo-200';
    }
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const settingTabs = can('settings:read')
    ? [
        { id: 'knowledge', label: 'Grounding Knowledge', badge: kbItems.length },
        { id: 'system', label: 'Dispatch & Cadence Rules' },
      ]
    : [{ id: 'knowledge', label: 'Grounding Knowledge', badge: kbItems.length }];

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
        title={can('settings:read') ? "Knowledge Base & System Rules" : "Verified Knowledge Base"}
        subtitle={
          can('settings:read')
            ? "Manage verifiable facts for hallucination-free AI generation and configure sending governance."
            : "Review verified corporate claims and guidelines used to anchor AI email drafts."
        }
        actions={
          can('settings:read') ? (
            <Tabs
              tabs={settingTabs}
              activeTab={activeTab}
              onChange={setActiveTab}
              variant="segmented"
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700">
              <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
              <span>{kbItems.length} Verified Facts</span>
            </span>
          )
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mr-2 text-indigo-600" />
          Loading configuration...
        </div>
      ) : activeTab === 'knowledge' ? (
        /* KNOWLEDGE BASE TAB */
        <div className="space-y-6">
          {/* Info Banner: Zero-Hallucination Guarantee */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-900 font-semibold text-sm">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                Zero-Hallucination Strict Grounding Guarantee
              </div>
              <p className="text-xs text-indigo-800 max-w-2xl leading-relaxed">
                The AI service injects only confirmed corporate facts into LLM prompt contexts.
                Claims, statistics, and course names outside this verified repository will never be invented.
              </p>
            </div>
            <Can permission="knowledge:write">
              <button
                type="button"
                onClick={openAddKb}
                className="btn-primary text-xs font-semibold shrink-0 shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Verified Fact</span>
              </button>
            </Can>
          </div>

          {/* 2-Column Responsive Grid with Equal Heights */}
          {kbItems.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No Grounding Claims in Knowledge Base"
              description="Add verified claims, course modules, or corporate metrics to anchor AI draft generation."
              actionText={can('knowledge:write') ? "Add Verified Fact" : null}
              onAction={can('knowledge:write') ? openAddKb : null}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {kbItems.map((item) => {
                const formattedCategory = formatCategoryName(item.category);
                const categoryStyle = getCategoryBadgeClass(item.category);

                return (
                  <div
                    key={item.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between gap-4 hover:border-slate-300 hover:shadow-sm transition"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${categoryStyle}`}
                        >
                          {formattedCategory}
                        </span>

                        <Can permission="knowledge:write">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditKb(item)}
                              title="Edit claim"
                              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-slate-50 transition"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setItemToDelete(item)}
                              title="Delete claim"
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </Can>
                      </div>

                      <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>

                      <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                        {item.content}
                      </p>
                    </div>

                    {item.source && (
                      <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100 truncate">
                        Source verification: <span className="font-mono text-slate-600">{item.source}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* SYSTEM RULES TAB */
        <div className="max-w-2xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="pb-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <SettingsIcon className="h-5 w-5 text-indigo-600" />
              Sending Policy & Business Hours Governance
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Configure business delivery hours, daily quotas to protect domain reputation, and follow-up cadences.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Daily Sending Limit (Emails/Day)
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={settingsForm.daily_limit}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, daily_limit: parseInt(e.target.value) || 50 })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Protects sender domain reputation and prevents rate limit triggers.
                </span>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Timezone
                </label>
                <input
                  type="text"
                  value={settingsForm.timezone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  e.g., Asia/Kolkata, America/New_York, UTC
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Dispatch Window Start
                </label>
                <input
                  type="time"
                  value={settingsForm.send_window_start}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, send_window_start: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Dispatch Window End
                </label>
                <input
                  type="time"
                  value={settingsForm.send_window_end}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, send_window_end: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Follow-up Interval (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settingsForm.followup_interval_days}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      followup_interval_days: parseInt(e.target.value) || 3,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Spacing between cadence steps for non-responders.
                </span>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Max Follow-ups per Lead
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settingsForm.max_followups}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      max_followups: parseInt(e.target.value) || 4,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Halts cadence automatically after max steps are reached.
                </span>
              </div>
            </div>

            {/* Scheduled Email Reminders (Super Admin Alerting) */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-slate-900 text-xs sm:text-sm">
                  <Bell className="h-4 w-4 text-indigo-600" />
                  Scheduled Email Reminders (Super Admin Alerting)
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.reminder_enabled}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, reminder_enabled: e.target.checked })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              <p className="text-[11px] text-slate-600 leading-relaxed">
                Super Admins receive advance warnings before scheduled target times. In accordance with zero-unauthorized-delivery governance, scheduled emails are never sent automatically by the agent and require explicit manual release ('Send Now').
              </p>

              {settingsForm.reminder_enabled && (
                <div className="space-y-4 pt-3 border-t border-indigo-100">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                        Advance Warning Time (Minutes)
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="1440"
                        value={settingsForm.reminder_lead_minutes}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            reminder_lead_minutes: parseInt(e.target.value) || 30,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 bg-white"
                      />
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Allowed 5 to 1440 mins (default: 30 minutes before delivery).
                      </span>
                    </div>

                    <div>
                      <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                        Notification Channels
                      </label>
                      <div className="flex items-center gap-5 pt-2">
                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settingsForm.reminder_channels.includes('email')}
                            onChange={(e) => {
                              const newChannels = e.target.checked
                                ? [...settingsForm.reminder_channels, 'email']
                                : settingsForm.reminder_channels.filter((c) => c !== 'email');
                              setSettingsForm({ ...settingsForm, reminder_channels: newChannels });
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <Mail className="h-3.5 w-3.5 text-slate-500" />
                          <span>Zoho Email</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settingsForm.reminder_channels.includes('dashboard')}
                            onChange={(e) => {
                              const newChannels = e.target.checked
                                ? [...settingsForm.reminder_channels, 'dashboard']
                                : settingsForm.reminder_channels.filter((c) => c !== 'dashboard');
                              setSettingsForm({ ...settingsForm, reminder_channels: newChannels });
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <Bell className="h-3.5 w-3.5 text-slate-500" />
                          <span>Dashboard Pop-up</span>
                        </label>
                      </div>
                      <span className="text-[11px] text-slate-500 mt-1 block">
                        Both channels enabled by default.
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold uppercase tracking-wider text-slate-700 mb-1">
                      Additional Super Admin Emails (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. admin2@traininglobe.com, ops@traininglobe.com"
                      value={settingsForm.reminder_email_recipients_str}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          reminder_email_recipients_str: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 bg-white"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      The approving Super Admin is always notified by default. Add additional emails separated by commas.
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="reminder_immediate_due"
                      checked={settingsForm.reminder_send_immediately_if_due}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          reminder_send_immediately_if_due: e.target.checked,
                        })
                      }
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="reminder_immediate_due" className="text-xs text-slate-700 cursor-pointer">
                      Send reminder immediately if scheduled delivery is closer than the warning lead time
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <div className="flex items-center gap-2 font-semibold text-amber-900 text-xs mb-1">
                <ShieldCheck className="h-4 w-4 text-amber-600" />
                CAN-SPAM & Opt-Out Compliance
              </div>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Every dispatched email automatically attaches the Traininglobe physical address and a single-click unsubscribe link.
                Prospect opt-outs immediately update the global suppression list and halt all cadence steps.
              </p>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="btn-primary text-xs font-semibold shadow-xs disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{savingSettings ? 'Saving...' : 'Save Dispatch Rules'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Add / Edit Knowledge Claim */}
      {isAddKbOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Plus className="h-4 w-4 text-indigo-600" />
                {editingItem ? 'Edit Grounding Fact' : 'Add Grounding Fact to Knowledge Base'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddKbOpen(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSaveKb} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Category
                </label>
                <select
                  value={kbForm.category}
                  onChange={(e) => setKbForm({ ...kbForm, category: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Fact Title / Concept *
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Enterprise Corporate Upskilling Bootcamps"
                  value={kbForm.title}
                  onChange={(e) => setKbForm({ ...kbForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Detailed Content & Verification *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Provide precise verified claims, course modules, or statistics..."
                  value={kbForm.content}
                  onChange={(e) => setKbForm({ ...kbForm, content: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 leading-relaxed"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Documentation Source / URL
                </label>
                <input
                  type="text"
                  placeholder="e.g. https://traininglobe.com/courses"
                  value={kbForm.source}
                  onChange={(e) => setKbForm({ ...kbForm, source: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddKbOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingKb}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {savingKb ? 'Saving...' : 'Save to Grounding Base'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!itemToDelete}
        title="Remove Claim from Grounding Base?"
        message={`Are you sure you want to remove "${itemToDelete?.title}"? The AI model will no longer reference this claim when synthesizing email outreach.`}
        confirmText="Remove Claim"
        cancelText="Cancel"
        type="danger"
        loading={deletingKb}
        onConfirm={confirmDeleteKb}
        onCancel={() => setItemToDelete(null)}
      />
    </div>
  );
}
