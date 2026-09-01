import React from 'react';

export const MetricCard = ({ 
    label, 
    value, 
    change, 
    trend = 'neutral', // 'up' | 'down' | 'neutral'
    icon,
    subtitle 
}) => {
    const trendClasses = {
        up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        down: 'bg-rose-50 text-rose-700 border-rose-200',
        neutral: 'bg-slate-50 text-slate-600 border-slate-200'
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {label}
                </span>
                {icon && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-600 border border-slate-200">
                        {icon}
                    </div>
                )}
            </div>
            
            <div className="mt-3 flex items-baseline justify-between gap-2">
                <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
                    {value}
                </span>
                {change && (
                    <span className={`inline-flex items-center gap-0.5 rounded-sm border px-2 py-0.5 text-xs font-semibold tabular-nums ${trendClasses[trend] || trendClasses.neutral}`}>
                        {trend === 'up' && '↑ '}
                        {trend === 'down' && '↓ '}
                        {change}
                    </span>
                )}
            </div>

            {subtitle && (
                <p className="mt-1 text-xs text-slate-400">
                    {subtitle}
                </p>
            )}
        </div>
    );
};

export default MetricCard;
