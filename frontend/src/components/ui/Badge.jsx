import React from 'react';

const BADGE_VARIANTS = {
    present: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    late: 'bg-amber-50 text-amber-900 border-amber-300',
    warning: 'bg-amber-50 text-amber-900 border-amber-300',
    absent: 'bg-rose-50 text-rose-800 border-rose-300',
    danger: 'bg-rose-50 text-rose-800 border-rose-300',
    destructive: 'bg-rose-50 text-rose-800 border-rose-300',
    active: 'bg-blue-50 text-blue-800 border-blue-300',
    info: 'bg-blue-50 text-blue-800 border-blue-300',
    inactive: 'bg-slate-100 text-slate-700 border-slate-300',
    neutral: 'bg-slate-50 text-slate-700 border-slate-300',
    dark: 'bg-slate-900 text-slate-100 border-slate-700',
    terminated: 'bg-rose-100 text-rose-900 border-rose-300',
    suspended: 'bg-amber-100 text-amber-900 border-amber-300'
};

const DOT_COLORS = {
    present: 'bg-emerald-600',
    success: 'bg-emerald-600',
    late: 'bg-amber-600',
    warning: 'bg-amber-600',
    absent: 'bg-rose-600',
    danger: 'bg-rose-600',
    destructive: 'bg-rose-600',
    active: 'bg-blue-600',
    info: 'bg-blue-600',
    inactive: 'bg-slate-500',
    neutral: 'bg-slate-500',
    dark: 'bg-slate-300',
    terminated: 'bg-rose-600',
    suspended: 'bg-amber-600'
};

export const Badge = ({ 
    variant = 'neutral', 
    size = 'sm', 
    children, 
    withDot = true, 
    className = '' 
}) => {
    const v = String(variant).toLowerCase();
    const style = BADGE_VARIANTS[v] || BADGE_VARIANTS.neutral;
    const dot = DOT_COLORS[v] || DOT_COLORS.neutral;

    const sizeClasses = {
        xs: 'px-1.5 py-0.2 text-[10px]',
        sm: 'px-2 py-0.5 text-[11px]',
        md: 'px-2.5 py-1 text-xs'
    };

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border font-semibold tracking-wide select-none ${sizeClasses[size] || sizeClasses.sm} ${style} ${className}`}>
            {withDot && (
                <span className={`h-1.5 w-1.5 rounded-full ${dot} shrink-0`} />
            )}
            <span>{children}</span>
        </span>
    );
};

export default Badge;
