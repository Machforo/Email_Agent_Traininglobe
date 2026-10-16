// Utility helpers for formatting dates, names, companies, and badges

export function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'object' && val.$date) {
    val = val.$date;
  }
  const date = new Date(val);
  return isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(val, includeTimezone = false) {
  const date = parseDate(val);
  if (!date) return '—';

  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // '0' should be '12'

  let formatted = `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;

  if (includeTimezone) {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const shortTz = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')?.value || tz;
      formatted += ` ${shortTz}`;
    } catch {
      // fallback
    }
  }

  return formatted;
}

export function formatRelativeTime(val) {
  const date = parseDate(val);
  if (!date) return '';

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absDiff = Math.abs(diffMs);

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (isPast) {
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  } else {
    if (days > 0) return `in ${days}d ${hours % 24}h`;
    if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `in ${minutes}m`;
    return 'Due now';
  }
}

export function getLeadDisplayName(lead) {
  if (!lead) return 'Unknown Contact';
  if (lead.name && lead.name.trim()) return lead.name.trim();

  const combined = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
  if (combined) return combined;

  if (lead.email) {
    return lead.email.split('@')[0];
  }
  return 'Unknown Contact';
}

export function getLeadCompany(lead) {
  if (!lead) return '—';
  if (lead.company_name && lead.company_name.trim()) return lead.company_name.trim();
  if (lead.company && lead.company.trim()) return lead.company.trim();

  if (lead.email && lead.email.includes('@')) {
    const domain = lead.email.split('@')[1];
    return domain;
  }
  return '—';
}

export function getLeadInitials(lead) {
  const name = getLeadDisplayName(lead);
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1 && parts[0].length >= 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return 'L';
}

export function formatCategoryName(category) {
  if (!category) return 'General';
  // convert APPROVED_CLAIMS -> Approved Claims, USP -> USP
  return category
    .split('_')
    .map((word) => {
      if (word.toUpperCase() === 'USP') return 'USP';
      if (word.toUpperCase() === 'ROI') return 'ROI';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function formatActionLabel(action) {
  if (!action) return 'Action';
  const mapping = {
    APPROVE_EMAIL: 'Approved Email',
    REJECT_DRAFT: 'Draft Rejected',
    EDIT_DRAFT: 'Draft Edited',
    SCHEDULE_EMAIL: 'Email Scheduled',
    RESCHEDULE_EMAIL: 'Rescheduled Email',
    DISPATCH_APPROVED_EMAIL: 'Email Dispatched',
    EMAIL_SENT: 'Email Dispatched',
    SYNC_ZOHO_CRM: 'Synced Zoho CRM',
    SYNC_ZOHO: 'Synced Zoho CRM',
    CSV_IMPORT: 'Imported CSV Leads',
    OPT_OUT: 'Prospect Opt-Out',
  };
  if (mapping[action]) return mapping[action];

  return action
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
