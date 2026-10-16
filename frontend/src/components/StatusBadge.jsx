import React from 'react';

export default function StatusBadge({ status, className = '' }) {
  if (!status) return null;

  const normalized = status.toString().trim();

  // Color mapping with soft tinted backgrounds and darker text
  let styleClasses = 'bg-slate-100 text-slate-700 border-slate-200';

  switch (normalized.toLowerCase()) {
    // Amber / Warning (Drafts & Pending)
    case 'draft ready':
    case 'draft':
    case 'follow-up pending':
    case 'followup_pending':
    case 'scheduled':
    case 'paused':
      styleClasses = 'bg-amber-50 text-amber-800 border-amber-200';
      break;

    // Indigo / Primary (Active Outreach / In Cadence)
    case 'in cadence':
    case 'contacted':
    case 'approved':
    case 'outbound':
      styleClasses = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      break;

    // Sky / Info (Replied / Engaged / Questions)
    case 'replied':
    case 'engaged':
    case 'inbound':
    case 'new lead':
    case 'new':
    case 'researched':
      styleClasses = 'bg-sky-50 text-sky-800 border-sky-200';
      break;

    // Green / Success (Qualified / Converted / Sent)
    case 'qualified':
    case 'converted':
    case 'sent':
    case 'delivered':
      styleClasses = 'bg-emerald-50 text-emerald-800 border-emerald-200';
      break;

    // Red / Danger (Opted out / Rejected / Failed / Lost)
    case 'opted out':
    case 'opt_out':
    case 'rejected':
    case 'failed':
    case 'bounced':
    case 'not interested':
    case 'lost / dormant':
    case 'lost':
      styleClasses = 'bg-rose-50 text-rose-800 border-rose-200';
      break;

    default:
      styleClasses = 'bg-slate-100 text-slate-700 border-slate-200';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styleClasses} ${className}`}
    >
      {normalized}
    </span>
  );
}
