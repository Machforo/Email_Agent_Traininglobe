import React from 'react';

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionText,
  onAction,
  className = '',
}) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-10 text-center flex flex-col items-center justify-center space-y-3 ${className}`}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 border border-slate-200 text-slate-400 mb-1">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {actionText && onAction && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onAction}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 transition"
          >
            {actionText}
          </button>
        </div>
      )}
    </div>
  );
}
