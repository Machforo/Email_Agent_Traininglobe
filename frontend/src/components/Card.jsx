import React from 'react';

export default function Card({ children, className = '', padding = 'p-6', hover = false, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-slate-200 rounded-xl shadow-xs ${padding} ${
        hover ? 'transition-all duration-150 hover:border-slate-300 hover:shadow-sm cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
