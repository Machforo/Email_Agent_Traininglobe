import React from 'react';

export default function StatCard({
  label,
  value,
  icon: Icon,
  badgeText,
  badgeType = 'warning', // warning | info | success
  iconColor = 'text-indigo-600',
  iconBg = 'bg-indigo-50',
  onClick,
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-xl p-5 shadow-xs transition-all duration-150 hover:border-slate-300 hover:shadow-sm ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              {value}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {Icon && (
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </div>

      {badgeText && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              badgeType === 'warning'
                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                : badgeType === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
            }`}
          >
            {badgeText}
          </span>
        </div>
      )}
    </div>
  );
}
