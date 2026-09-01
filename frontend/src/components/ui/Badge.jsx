import React from 'react';

const BADGE_VARIANTS = {
    present: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    late: 'bg-amber-50 text-amber-700 border-amber-200',
    absent: 'bg-rose-50 text-rose-700 border-rose-200',
    active: 'bg-blue-50 text-blue-700 border-blue-200',
    warning: 'bg-orange-50 text-orange-700 border-orange-200',
    inactive: 'bg-slate-100 text-slate-600 border-slate-200',
    neutral: 'bg-slate-50 text-slate-700 border-slate-200'
};

const DOT_COLORS = {
    present: 'bg-emerald-500',
    late: 'bg-amber-500',
    absent: 'bg-rose-500',
    active: 'bg-blue-500',
    warning: 'bg-orange-500',
    inactive: 'bg-slate-400',
    neutral: 'bg-slate-500'
};

export const Badge = ({ variant = 'neutral', children, withDot = true, className = '' }) => {
    const v = String(variant).toLowerCase();
    const style = BADGE_VARIANTS[v] || BADGE_VARIANTS.neutral;
    const dot = DOT_COLORS[v] || DOT_COLORS.neutral;

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${style} ${className}`}>
            {withDot && (
                <span className={`h-1.5 w-1.5 rounded-full ${dot} shrink-0`} />
            )}
            {children}
        </span>
    );
};

export default Badge;
