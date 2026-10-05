import React from 'react';

const BADGE_VARIANTS = {
    present: 'bg-slate-900 text-white border-slate-800',
    success: 'bg-success-subtle text-success-ink border-success/20',
    late: 'bg-warning-subtle text-warning-ink border-warning/20',
    warning: 'bg-warning-subtle text-warning-ink border-warning/20',
    absent: 'bg-danger-subtle text-danger-ink border-danger/20',
    danger: 'bg-danger-subtle text-danger-ink border-danger/20',
    destructive: 'bg-danger-subtle text-danger-ink border-danger/20',
    active: 'bg-accent-subtle text-accent-strong border-accent/20',
    info: 'bg-accent-subtle text-accent-strong border-accent/20',
    inactive: 'bg-slate-100 text-slate-700 border-slate-300',
    neutral: 'bg-slate-50 text-slate-700 border-slate-300',
    dark: 'bg-slate-900 text-slate-100 border-slate-700',
    terminated: 'bg-danger-subtle text-danger-ink border-danger/20',
    suspended: 'bg-warning-subtle text-warning-ink border-warning/20',
    action_required: 'bg-danger-subtle text-danger-ink border-danger/20',
    acknowledged: 'bg-surface-muted text-ink border-line',
    resolved: 'bg-slate-100 text-slate-700 border-slate-200',
    cleared: 'bg-success-subtle text-success-ink border-success/20',
    overturned: 'bg-success-subtle text-success-ink border-success/20',
    dismissed: 'bg-accent-subtle text-accent border-accent/20',
    grace: 'bg-warning-subtle text-warning-ink border-warning/20',
    pakyawan: 'bg-accent-subtle text-accent border-accent/20',
    purple: 'bg-accent-subtle text-accent border-accent/20',
    teal: 'bg-surface-muted text-ink border-line'
};

const DOT_COLORS = {
    present: 'bg-slate-400',
    success: 'bg-success',
    late: 'bg-warning',
    warning: 'bg-warning',
    absent: 'bg-danger',
    danger: 'bg-danger',
    destructive: 'bg-danger',
    active: 'bg-accent',
    info: 'bg-accent',
    inactive: 'bg-slate-500',
    neutral: 'bg-slate-500',
    dark: 'bg-slate-300',
    terminated: 'bg-danger',
    suspended: 'bg-warning',
    action_required: 'bg-danger',
    acknowledged: 'bg-ink-subtle',
    resolved: 'bg-slate-500',
    cleared: 'bg-success',
    overturned: 'bg-success',
    dismissed: 'bg-accent',
    grace: 'bg-warning',
    pakyawan: 'bg-accent',
    purple: 'bg-accent',
    teal: 'bg-ink-subtle'
};

export const Badge = ({ 
    variant = 'neutral', 
    size = 'sm', 
    children, 
    withDot = false, 
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
