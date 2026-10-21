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
  FileText,
  UserCheck,
  Check,
  X,
  Eye,
} from 'lucide-react';
import { api } from '../services/api';
import PageHeader from '../components/PageHeader';
import Tabs from '../components/Tabs';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { formatCategoryName } from '../services/formatters';
import { usePermissions, Can } from '../services/permissions';

const CATEGORIES = [
  'ABOUT',
  'APPROVED_CLAIMS',
  'SERVICES',
  'REFERENCE_CLIENTS',
  'RESTRICTIONS',
  'USP',
];

const SERVICE_LINES = [
  'Enterprise AI Workshops',
  'Campus Placement',
  'Corporate Onboarding',
];

export default function Settings() {
  const { can, isReadOnly } = usePermissions();
  const [activeTab, setActiveTab] = useState('knowledge');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notification, setNotification] = useState(null);

  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    default_sender_name: 'Pallabi Hansda',
    default_sender_designation: 'Business Development Manager',
    company_legal_name: 'Traininglobe Consultancy Pvt. Ltd.',
    enable_lead_owner_override: true,
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
    // Safe Integration Indicators (Connected / Not connected)
    zoho_status: 'Not connected',
    llm_status: 'Not connected',
    database_status: 'Connected',
  });

  // Knowledge Base State
  const [kbItems, setKbItems] = useState([]);
  const [isAddKbOpen, setIsAddKbOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [deletingKb, setDeletingKb] = useState(false);
  const [savingKb, setSavingKb] = useState(false);

  const [kbForm, setKbForm] = useState({
    category: 'ABOUT',
    title: '',
    content: '',
    service_line: 'Enterprise AI Workshops',
    status: 'Pending verification',
    approved_for_outreach: false,
    region: '',
    source: '',
  });

  // Email Templates State
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [editingTemplateModal, setEditingTemplateModal] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    subject_template: '',
    body_template: '',
    description: '',
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  // Sample lead for interactive template preview
  const [sampleLead, setSampleLead] = useState({
    lead_name: 'Tamara Fayad',
    company: 'QIG',
    industry: 'Industrial, Marine & Financial Services',
    company_paragraph:
      'With QIG continuing its digital transformation across its diversified industrial, technology, marine, property and financial-services portfolio, we see strong potential for practical AI capability building across its businesses.',
    topics:
      'Generative AI & Enterprise Documentation Automation, Microsoft 365 Copilot, AI Strategy & Governance, Enterprise Data Science & Predictive AI, Agentic AI & Talent Enablement, and Executive Leadership Strategy',
    impact:
      'Our practical workshops typically boost employee productivity by 10%-40% while delivering immediate business ROI and operational capability gains.',
    reference_clients:
      'Our experience includes programs with QatarEnergy, Saudi Aramco helping organizations build practical enterprise AI capabilities.',
    track_record_statement:
      'Across the GCC region, we have delivered 500+ corporate cohorts and upskilled 15,000+ professionals with a 98% satisfaction rating.',
    reply_body:
      'Regarding your query on live simulation sandbox environments, all participants work in dedicated cloud sandboxes executing real prompts and workflow automation.',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [settingsData, kbData, tplData] = await Promise.all([
        can('settings:read') ? api.getSettings().catch(() => null) : Promise.resolve(null),
        api.listKnowledgeBase().catch(() => []),
        api.getTemplates().catch(() => []),
      ]);

      if (settingsData) {
        const extraRecipients = Array.isArray(settingsData.reminder_email_recipients)
          ? settingsData.reminder_email_recipients.join(', ')
          : '';
        setSettingsForm({
          default_sender_name: settingsData.default_sender_name || 'Pallabi Hansda',
          default_sender_designation: settingsData.default_sender_designation || 'Business Development Manager',
          company_legal_name: settingsData.company_legal_name || 'Traininglobe Consultancy Pvt. Ltd.',
          enable_lead_owner_override:
            settingsData.enable_lead_owner_override !== undefined ? settingsData.enable_lead_owner_override : true,
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
          reminder_send_immediately_if_due:
            settingsData.reminder_send_immediately_if_due !== undefined ? settingsData.reminder_send_immediately_if_due : true,
          zoho_status: settingsData.zoho_status || 'Not connected',
          llm_status: settingsData.llm_status || 'Not connected',
          database_status: settingsData.database_status || 'Connected',
        });
      }

      setKbItems(kbData || []);
      setTemplates(tplData || []);
      if (tplData && tplData.length > 0) {
        setSelectedTemplate(tplData[0]);
        runPreview(tplData[0]);
      }
    } catch (err) {
      console.error('Failed to load settings data:', err);
    } finally {
      setLoading(false);
    }
  };

  const runPreview = async (template) => {
    if (!template) return;
    try {
      const res = await api.previewTemplate({
        template_id: template.id,
        subject_template: template.subject_template,
        body_template: template.body_template,
        sample_lead: sampleLead,
      });
      setPreviewResult(res);
    } catch (err) {
      console.error('Preview error:', err);
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
        default_sender_name: settingsForm.default_sender_name || 'Pallabi Hansda',
        default_sender_designation: settingsForm.default_sender_designation || 'Business Development Manager',
        company_legal_name: settingsForm.company_legal_name || 'Traininglobe Consultancy Pvt. Ltd.',
        enable_lead_owner_override: settingsForm.enable_lead_owner_override,
        default_send_time: settingsForm.default_send_time || '18:00',
        timezone: settingsForm.timezone || 'Asia/Kolkata',
        business_hours_start: settingsForm.business_hours_start || 9,
        business_hours_end: settingsForm.business_hours_end || 19,
        daily_send_limit: settingsForm.daily_limit || settingsForm.daily_send_limit || 50,
        followup_intervals_days: settingsForm.followup_intervals_days || [3, 5, 7],
        max_followups: settingsForm.max_followups || 3,
        dry_run_mode: settingsForm.dry_run_mode,
        reminder_enabled: settingsForm.reminder_enabled,
        reminder_lead_minutes: parseInt(settingsForm.reminder_lead_minutes, 10) || 30,
        reminder_email_recipients: recipientList,
        reminder_channels: settingsForm.reminder_channels || ['email', 'dashboard'],
        reminder_send_immediately_if_due: settingsForm.reminder_send_immediately_if_due,
      };

      await api.updateSettings(payload);
      showNotification('success', 'Sender identity and governance rules updated successfully.');
    } catch (err) {
      showNotification('error', `Failed to update settings: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // Toggle Verification status directly
  const handleToggleVerify = async (item) => {
    try {
      const nextStatus = item.status === 'Verified' ? 'Pending verification' : 'Verified';
      const updated = await api.updateKnowledgeBaseItem(item.id, { status: nextStatus });
      setKbItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      showNotification(
        'success',
        `Fact status changed to "${nextStatus}". ${nextStatus === 'Verified' ? 'Agent may now use this in drafts.' : 'Excluded from drafts until verified.'}`
      );
    } catch (err) {
      showNotification('error', `Failed to update status: ${err.message}`);
    }
  };

  const openAddKb = () => {
    setEditingItem(null);
    setKbForm({
      category: 'ABOUT',
      title: '',
      content: '',
      service_line: 'Enterprise AI Workshops',
      status: 'Pending verification',
      approved_for_outreach: false,
      region: '',
      source: '',
    });
    setIsAddKbOpen(true);
  };

  const openEditKb = (item) => {
    setEditingItem(item);
    setKbForm({
      category: item.category || 'ABOUT',
      title: item.title || '',
      content: item.content || '',
      service_line: item.service_line || 'Enterprise AI Workshops',
      status: item.status || 'Pending verification',
      approved_for_outreach: !!item.approved_for_outreach,
      region: item.region || '',
      source: item.source || '',
    });
    setIsAddKbOpen(true);
  };

  const handleSaveKb = async (e) => {
    e.preventDefault();
    try {
      setSavingKb(true);
      if (editingItem) {
        const updated = await api.updateKnowledgeBaseItem(editingItem.id, kbForm);
        setKbItems((prev) => prev.map((i) => (i.id === editingItem.id ? updated : i)));
        showNotification('success', 'Knowledge claim updated successfully');
      } else {
        const newItem = await api.addKnowledgeBaseItem(kbForm);
        setKbItems((prev) => [newItem, ...prev]);
        showNotification(
          'success',
          kbForm.status === 'Verified'
            ? 'Verified knowledge claim added for AI grounding.'
            : 'Knowledge claim added with "Pending verification" status.'
        );
      }
      setIsAddKbOpen(false);
    } catch (err) {
      showNotification('error', `Failed to save claim: ${err.message}`);
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
      showNotification('error', `Delete failed: ${err.message}`);
    } finally {
      setDeletingKb(false);
    }
  };

  // Template Editing Handlers
  const openEditTemplate = (tpl) => {
    setSelectedTemplate(tpl);
    setTemplateForm({
      name: tpl.name || '',
      subject_template: tpl.subject_template || '',
      body_template: tpl.body_template || '',
      description: tpl.description || '',
    });
    setEditingTemplateModal(true);
  };

  const handleSaveTemplate = async (e) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    try {
      setSavingTemplate(true);
      const updated = await api.updateTemplate(selectedTemplate.id, templateForm);
      setTemplates((prev) => prev.map((t) => (t.id === selectedTemplate.id ? updated : t)));
      setSelectedTemplate(updated);
      await runPreview(updated);
      setEditingTemplateModal(false);
      showNotification('success', 'Email template updated successfully.');
    } catch (err) {
      showNotification('error', `Failed to update template: ${err.message}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const showNotification = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const getCategoryBadgeClass = (category) => {
    const cat = (category || '').toUpperCase();
    if (cat.includes('RESTRICT')) return 'bg-rose-50 text-rose-800 border-rose-200';
    if (cat.includes('APPROVE') || cat.includes('CLAIM')) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (cat.includes('REFERENCE') || cat.includes('CLIENT')) return 'bg-purple-50 text-purple-800 border-purple-200';
    if (cat.includes('SERVICE')) return 'bg-sky-50 text-sky-800 border-sky-200';
    if (cat.includes('ABOUT')) return 'bg-indigo-50 text-indigo-800 border-indigo-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const settingTabs = can('settings:read')
    ? [
        { id: 'knowledge', label: 'Grounding Knowledge', badge: kbItems.length },
        { id: 'templates', label: 'Email Templates', badge: templates.length },
        { id: 'system', label: 'Dispatch & Cadence Rules' },
      ]
    : [
        { id: 'knowledge', label: 'Grounding Knowledge', badge: kbItems.length },
        { id: 'templates', label: 'Email Templates', badge: templates.length },
      ];

  return (
    <div className="space-y-6 pb-16">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border p-4 shadow-lg text-xs font-semibold animate-fadeIn ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
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
        title={can('settings:read') ? 'Knowledge Base & System Rules' : 'Verified Knowledge Base & Templates'}
        subtitle={
          can('settings:read')
            ? 'Manage verifiable facts for hallucination-free AI generation, configure templates, and manage sender identity.'
            : 'Review verified corporate claims and reference templates used to anchor AI email drafts.'
        }
        actions={
          <Tabs
            tabs={settingTabs}
            activeTab={activeTab}
            onChange={(tab) => {
              setActiveTab(tab);
              if (tab === 'templates' && templates.length > 0 && !selectedTemplate) {
                setSelectedTemplate(templates[0]);
                runPreview(templates[0]);
              }
            }}
            variant="segmented"
          />
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
          {/* Info Banner: Zero-Hallucination & Verification Requirement */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-900 font-semibold text-sm">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                Zero-Hallucination & Verification Gate
              </div>
              <p className="text-xs text-indigo-800 max-w-2xl leading-relaxed">
                The drafting agent uses a fact in drafts <strong>ONLY</strong> after a Super Admin marks it "Verified".
                Unverified claims, numbers, and reference clients are strictly excluded.
              </p>
            </div>
            <Can permission="knowledge:write">
              <button
                type="button"
                onClick={openAddKb}
                className="btn-primary text-xs font-semibold shrink-0 shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Grounding Fact</span>
              </button>
            </Can>
          </div>

          {/* Facts Grid */}
          {kbItems.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No Grounding Claims in Knowledge Base"
              description="Add verified claims, course modules, or corporate metrics to anchor AI draft generation."
              actionText={can('knowledge:write') ? 'Add Grounding Fact' : null}
              onAction={can('knowledge:write') ? openAddKb : null}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {kbItems.map((item) => {
                const formattedCategory = formatCategoryName(item.category);
                const categoryStyle = getCategoryBadgeClass(item.category);
                const isVerified = item.status === 'Verified';

                return (
                  <div
                    key={item.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between gap-4 hover:border-slate-300 hover:shadow-sm transition"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${categoryStyle}`}
                          >
                            {formattedCategory}
                          </span>
                          {item.service_line && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              {item.service_line}
                            </span>
                          )}
                          {item.region && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                              {item.region} Only
                            </span>
                          )}
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                          {isVerified ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
                              <ShieldCheck className="h-3 w-3 text-emerald-600" />
                              <span>Verified</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                              <Clock className="h-3 w-3 text-amber-600" />
                              <span>Pending verification</span>
                            </span>
                          )}

                          <Can permission="knowledge:write">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleToggleVerify(item)}
                                title={isVerified ? 'Mark as Pending verification' : 'Verify this fact for outreach'}
                                className={`px-2 py-1 rounded text-[11px] font-semibold border transition ${
                                  isVerified
                                    ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                }`}
                              >
                                {isVerified ? 'Unverify' : 'Verify'}
                              </button>
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
                      </div>

                      <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>

                      <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                        {item.content}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100 gap-2">
                      <span>
                        Source: <span className="font-mono text-slate-600">{item.source || 'Verified Training Registry'}</span>
                      </span>
                      {item.approved_for_outreach !== undefined && (
                        <span
                          className={`font-semibold ${
                            item.approved_for_outreach ? 'text-indigo-600' : 'text-slate-400'
                          }`}
                        >
                          {item.approved_for_outreach ? '✓ Approved for outreach' : '✗ Outreach flag off'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : activeTab === 'templates' ? (
        /* EMAIL TEMPLATES TAB */
        <div className="space-y-6">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-900 font-semibold text-sm">
                <FileText className="h-4 w-4 text-indigo-600" />
                Template Library & Live Interactive Preview
              </div>
              <p className="text-xs text-indigo-800 leading-relaxed max-w-2xl">
                The agent writes drafts using these reference structures and placeholders.
                Available placeholders:{' '}
                <code className="bg-indigo-100/70 text-indigo-900 px-1.5 py-0.5 rounded font-mono text-[11px]">
                  &#123;lead_name&#125;, &#123;company&#125;, &#123;company_paragraph&#125;, &#123;topics&#125;,
                  &#123;impact&#125;, &#123;reference_clients&#125;, &#123;sender_name&#125;, &#123;designation&#125;, &#123;company_legal_name&#125;
                </code>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Template Selector List */}
            <div className="lg:col-span-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Available Templates ({templates.length})
              </h3>
              {templates.map((tpl) => {
                const isSelected = selectedTemplate?.id === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => {
                      setSelectedTemplate(tpl);
                      runPreview(tpl);
                    }}
                    className={`cursor-pointer p-4 rounded-xl border transition-all text-xs space-y-2 ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/20 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 text-sm">{tpl.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        {tpl.kind}
                      </span>
                    </div>
                    <p className="text-slate-500 leading-snug line-clamp-2">{tpl.description}</p>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
                      <span className="text-indigo-600 font-medium">{tpl.service_line}</span>
                      <Can permission="knowledge:write">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditTemplate(tpl);
                          }}
                          className="btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1"
                        >
                          <Edit3 className="h-3 w-3" />
                          <span>Edit Template</span>
                        </button>
                      </Can>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live Interactive Preview */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-slate-900">
                    Live Lead Preview: <span className="text-indigo-600">{selectedTemplate?.name}</span>
                  </h3>
                </div>
                {previewResult && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {previewResult.word_count} words
                  </span>
                )}
              </div>

              {previewResult ? (
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                      Rendered Subject
                    </span>
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-900">
                      {previewResult.rendered_subject}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
                      Rendered Email Body (Sample Lead: {sampleLead.lead_name} @ {sampleLead.company})
                    </span>
                    <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-lg text-xs leading-relaxed text-slate-800 whitespace-pre-wrap font-sans">
                      {previewResult.rendered_body}
                    </div>
                  </div>

                  {previewResult.used_placeholders && previewResult.used_placeholders.length > 0 && (
                    <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-slate-700">Substituted Placeholders:</span>
                      {previewResult.used_placeholders.map((p) => (
                        <span key={p} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                          &#123;{p}&#125;
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400">
                  Select a template to generate live sample preview.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* SYSTEM RULES TAB */
        <div className="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="pb-4 border-b border-slate-100 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-indigo-600" />
                Sender Identity & Cadence Governance
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Configure sender signature blocks, delivery business hours, quotas, and automated admin warning reminders.
              </p>
            </div>
            {isReadOnly && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300 shrink-0">
                <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                View only
              </span>
            )}
          </div>

          {/* System & Integration Connections Health */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                Integrations & Service Connections
              </div>
              {isReadOnly && (
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  View only
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Safe connection indicators for external services. API secrets, tokens, and database credentials are strictly hidden.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">Zoho CRM</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  settingsForm.zoho_status === 'Connected'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {settingsForm.zoho_status}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">LLM Provider</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  settingsForm.llm_status === 'Connected'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {settingsForm.llm_status}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">Database</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  settingsForm.database_status === 'Connected'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}>
                  {settingsForm.database_status}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-6 text-xs">
            {/* Sender & Signature Configuration Card */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 space-y-4">
              <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
                <UserCheck className="h-4 w-4 text-indigo-600" />
                Configurable Sender & Signature Block
              </div>
              <p className="text-[11px] text-slate-500">
                Replaces generic signatures across all outreach and follow-up emails with verified corporate credentials.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Default Sender Name *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isReadOnly}
                    value={settingsForm.default_sender_name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, default_sender_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 bg-white disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Default Sender Designation *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isReadOnly}
                    value={settingsForm.default_sender_designation}
                    onChange={(e) => setSettingsForm({ ...settingsForm, default_sender_designation: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 bg-white disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Company Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isReadOnly}
                    value={settingsForm.company_legal_name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, company_legal_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 bg-white disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="enable_lead_owner_override"
                    disabled={isReadOnly}
                    checked={settingsForm.enable_lead_owner_override}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, enable_lead_owner_override: e.target.checked })
                    }
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                  />
                  <label htmlFor="enable_lead_owner_override" className="text-xs text-slate-700 cursor-pointer">
                    Enable Sales Rep Override (Assigned account owner name appears in their own lead drafts)
                  </label>
                </div>
              </div>
            </div>

            {/* Daily Limits & Business Hours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Daily Sending Limit (Emails/Day)
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  disabled={isReadOnly}
                  value={settingsForm.daily_limit}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, daily_limit: parseInt(e.target.value, 10) || 50 })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Default Send Time (Batch Schedule)
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={settingsForm.default_send_time}
                  onChange={(e) => setSettingsForm({ ...settingsForm, default_send_time: e.target.value })}
                  placeholder="18:00"
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-3 focus:ring-indigo-100 font-mono disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Business Hours Window
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    disabled={isReadOnly}
                    value={settingsForm.business_hours_start}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, business_hours_start: parseInt(e.target.value, 10) || 9 })
                    }
                    className="w-1/2 rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 font-mono text-center disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                  <span className="text-slate-400 font-semibold">to</span>
                  <input
                    type="number"
                    min="0"
                    max="23"
                    disabled={isReadOnly}
                    value={settingsForm.business_hours_end}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, business_hours_end: parseInt(e.target.value, 10) || 19 })
                    }
                    className="w-1/2 rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 font-mono text-center disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Operating Timezone
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={settingsForm.timezone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                />
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
                    disabled={isReadOnly}
                    checked={settingsForm.reminder_enabled}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, reminder_enabled: e.target.checked })
                    }
                    className="sr-only peer disabled:cursor-not-allowed"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {settingsForm.reminder_enabled && (
                <div className="space-y-4 pt-2 border-t border-indigo-100">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                        Advance Warning Lead Time (Minutes)
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="1440"
                        disabled={isReadOnly}
                        value={settingsForm.reminder_lead_minutes}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            reminder_lead_minutes: parseInt(e.target.value, 10) || 30,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 bg-white disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                        Alert Channels
                      </label>
                      <div className="flex items-center gap-4 pt-2">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={isReadOnly}
                            checked={settingsForm.reminder_channels.includes('email')}
                            onChange={(e) => {
                              const curr = [...settingsForm.reminder_channels];
                              if (e.target.checked) curr.push('email');
                              else {
                                const idx = curr.indexOf('email');
                                if (idx >= 0) curr.splice(idx, 1);
                              }
                              setSettingsForm({ ...settingsForm, reminder_channels: curr });
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                          />
                          <span className="text-slate-700">Email</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={isReadOnly}
                            checked={settingsForm.reminder_channels.includes('dashboard')}
                            onChange={(e) => {
                              const curr = [...settingsForm.reminder_channels];
                              if (e.target.checked) curr.push('dashboard');
                              else {
                                const idx = curr.indexOf('dashboard');
                                if (idx >= 0) curr.splice(idx, 1);
                              }
                              setSettingsForm({ ...settingsForm, reminder_channels: curr });
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                          />
                          <span className="text-slate-700">Dashboard Pop-up Alert</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                      Additional Super Admin Alert Recipients (Comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="admin2@trainingglobe.com, ops@trainingglobe.com"
                      disabled={isReadOnly}
                      value={settingsForm.reminder_email_recipients_str}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          reminder_email_recipients_str: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 bg-white disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="reminder_immediate_due"
                      disabled={isReadOnly}
                      checked={settingsForm.reminder_send_immediately_if_due}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          reminder_send_immediately_if_due: e.target.checked,
                        })
                      }
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
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

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              {isReadOnly ? (
                <span className="text-xs text-slate-500 italic">
                  View-only access: Changes are made by a Super Admin.
                </span>
              ) : (
                <div />
              )}
              <Can permission="settings:write">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="btn-primary text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  <span>{savingSettings ? 'Saving...' : 'Save Settings & Sender Profile'}</span>
                </button>
              </Can>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Category
                  </label>
                  <select
                    value={kbForm.category}
                    onChange={(e) => setKbForm({ ...kbForm, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900"
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
                    Service Line
                  </label>
                  <select
                    value={kbForm.service_line}
                    onChange={(e) => setKbForm({ ...kbForm, service_line: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900"
                  >
                    {SERVICE_LINES.map((sl) => (
                      <option key={sl} value={sl}>
                        {sl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Fact Title / Concept *
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Workshop Topics / Track Record"
                  value={kbForm.title}
                  onChange={(e) => setKbForm({ ...kbForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900"
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
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Verification Status
                  </label>
                  <select
                    value={kbForm.status}
                    onChange={(e) => setKbForm({ ...kbForm, status: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900"
                  >
                    <option value="Verified">Verified (Active in drafts)</option>
                    <option value="Pending verification">Pending verification (Restricted)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Region Constraint
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. GCC, Global, or None"
                    value={kbForm.region}
                    onChange={(e) => setKbForm({ ...kbForm, region: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="approved_for_outreach"
                  checked={kbForm.approved_for_outreach}
                  onChange={(e) => setKbForm({ ...kbForm, approved_for_outreach: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <label htmlFor="approved_for_outreach" className="text-xs text-slate-700 cursor-pointer">
                  Approved for outreach (Required for Reference Clients to appear in emails)
                </label>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Documentation Source
                </label>
                <input
                  type="text"
                  placeholder="e.g. GCC Delivery Registry / Syllabus"
                  value={kbForm.source}
                  onChange={(e) => setKbForm({ ...kbForm, source: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900"
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

      {/* MODAL: Edit Email Template */}
      {editingTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-indigo-600" />
                Edit Template: {selectedTemplate?.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingTemplateModal(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Subject Template Line *
                </label>
                <input
                  type="text"
                  required
                  value={templateForm.subject_template}
                  onChange={(e) => setTemplateForm({ ...templateForm, subject_template: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Body Template with Placeholders *
                </label>
                <textarea
                  required
                  rows={12}
                  value={templateForm.body_template}
                  onChange={(e) => setTemplateForm({ ...templateForm, body_template: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-3 text-xs text-slate-900 leading-relaxed font-mono whitespace-pre-wrap"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingTemplateModal(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="btn-primary text-xs font-semibold disabled:opacity-50"
                >
                  {savingTemplate ? 'Saving...' : 'Save Template'}
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
