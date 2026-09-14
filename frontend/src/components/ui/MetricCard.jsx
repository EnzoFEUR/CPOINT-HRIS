import React from 'react';

/**
 * Enterprise Production MetricCard
 * High-density operational KPI card with precision tabular typography and WCAG-compliant status badges.
 */
export const MetricCard = ({ 
    label, 
    value, 
    change, 
    trend = 'neutral', // 'up' | 'down' | 'neutral'
    icon, 
    subtitle,
    className = ''
}) => {
    const trendClasses = {
        up: 'bg-emerald-50 text-emerald-800 border-emerald-300',
        down: 'bg-rose-50 text-rose-800 border-rose-300',
        neutral: 'bg-slate-100 text-slate-700 border-slate-300'
    };

    return (
        <div className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs flex flex-col justify-between transition-colors hover:border-slate-300 ${className}`}>
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider truncate">
                    {label}
                </span>
                {icon && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                        {icon}
                    </div>
                )}
            </div>
            
            <div className="mt-3.5 flex items-baseline justify-between gap-2">
                <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
                    {value}
                </span>
                {change && (
                    <span className={`inline-flex items-center gap-0.5 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums select-none ${trendClasses[trend] || trendClasses.neutral}`}>
                        {trend === 'up' && '↑ '}
                        {trend === 'down' && '↓ '}
                        {change}
                    </span>
                )}
            </div>

            {subtitle && (
                <p className="mt-1.5 text-xs text-slate-500 font-medium leading-relaxed">
                    {subtitle}
                </p>
            )}
        </div>
    );
};

export default MetricCard;
