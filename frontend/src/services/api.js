const API_BASE = '/api';

function getAuthHeader() {
  const token = localStorage.getItem('traininglobe_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    ...getAuthHeader(),
    ...options.headers,
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('traininglobe_token');
    localStorage.removeItem('traininglobe_user');
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (res.status === 403) {
    const errorData = await res.json().catch(() => ({}));
    const errorMsg = errorData.detail || 'Access denied: You do not have permission to perform this action.';
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('global-api-forbidden', { detail: { message: errorMsg } }));
    }
    const err = new Error(errorMsg);
    err.status = 403;
    throw err;
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMsg = errorData.detail || errorData.message || `Request failed (${res.status})`;
    const err = new Error(errorMsg);
    err.status = res.status;
    err.requestId = errorData.request_id;
    throw err;
  }

  return res.json();
}

export const api = {
  // Auth
  async login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('traininglobe_token', data.access_token);
    localStorage.setItem('traininglobe_user', JSON.stringify(data.user));
    return data;
  },
  logout() {
    localStorage.removeItem('traininglobe_token');
    localStorage.removeItem('traininglobe_user');
  },
  getMe: () => request('/auth/me'),
  listUsers: () => request('/auth/users'),
  createUser: (data) => request('/auth/users', { method: 'POST', body: JSON.stringify(data) }),

  // Reports & Analytics
  getMetrics: () => request('/reports/metrics'),

  // Leads
  listLeads: (status, search, ownerId, myLeads) => {
    const params = new URLSearchParams();
    if (status && status !== 'ALL') params.append('status', status);
    if (search) params.append('search', search);
    if (ownerId && ownerId !== 'ALL') params.append('owner_id', ownerId);
    if (myLeads) params.append('my_leads', 'true');
    return request(`/leads?${params.toString()}`);
  },
  getLead: (id) => request(`/leads/${id}`),
  createLead: (data) => request('/leads', { method: 'POST', body: JSON.stringify(data) }),
  updateLead: (id, data) => request(`/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLead: (id) => request(`/leads/${id}`, { method: 'DELETE' }),
  importCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/leads/import/csv', { method: 'POST', body: formData });
  },
  syncZoho: () => request('/leads/sync/zoho', { method: 'POST' }),

  // Approvals (Mandatory Human Gate)
  getApprovalQueue: () => request('/approvals'),
  approveDraft: (draftId, sendNow = true, scheduleTime = null) => {
    const params = new URLSearchParams({ send_now: sendNow });
    if (scheduleTime) params.append('schedule_time', scheduleTime);
    return request(`/approvals/${draftId}/approve?${params.toString()}`, { method: 'POST' });
  },
  editDraft: (draftId, data) =>
    request(`/approvals/${draftId}/edit`, { method: 'POST', body: JSON.stringify(data) }),
  rejectDraft: (draftId, data) =>
    request(`/approvals/${draftId}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  rescheduleDraft: (draftId, scheduledFor) =>
    request(`/approvals/${draftId}/reschedule`, { method: 'POST', body: JSON.stringify({ scheduled_for: scheduledFor }) }),
  cancelAllOverdue: () =>
    request('/approvals/cancel-all-overdue', { method: 'POST' }),

  // Emails & Threads
  getThread: (leadId) => request(`/emails/thread/${leadId}`),
  getScheduledEmails: () => request('/emails/scheduled'),
  simulateInboundReply: (data) =>
    request('/emails/inbound/webhook', { method: 'POST', body: JSON.stringify(data) }),

  // Settings & Knowledge Base
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  listKnowledgeBase: () => request('/settings/knowledge-base'),
  addKnowledgeBaseItem: (data) => request('/settings/knowledge-base', { method: 'POST', body: JSON.stringify(data) }),
  updateKnowledgeBaseItem: (id, data) => request(`/settings/knowledge-base/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKnowledgeBaseItem: (id) => request(`/settings/knowledge-base/${id}`, { method: 'DELETE' }),

  // Email Templates Library
  getTemplates: () => request('/settings/templates'),
  updateTemplate: (id, data) => request(`/settings/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  previewTemplate: (data) => request('/settings/templates/preview', { method: 'POST', body: JSON.stringify(data) }),

  // Audit Logs
  getAuditLogs: (limit = 100) => request(`/audit?limit=${limit}`),

  // Notifications & Scheduled Email Reminders
  getNotifications: (unreadOnly = false) => request(`/notifications?unread_only=${unreadOnly}`),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  dismissNotification: (id) => request(`/notifications/${id}/dismiss`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),
  verifyActionToken: (token) => request(`/notifications/verify-token?token=${encodeURIComponent(token)}`),
};
