
const BADGE_VARIANTS = {
    present: 'bg-slate-900 text-white border-slate-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    success: 'bg-success-subtle text-success-ink border-success/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    approved: 'bg-success-subtle text-success-ink border-success/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    late: 'bg-warning-subtle text-warning-ink border-warning/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    warning: 'bg-warning-subtle text-warning-ink border-warning/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    needs_review: 'bg-warning-subtle text-warning-ink border-warning/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    pending: 'bg-warning-subtle text-warning-ink border-warning/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    absent: 'bg-danger-subtle text-danger-ink border-danger/20 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    danger: 'bg-danger-subtle text-danger-ink border-danger/20 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    destructive: 'bg-danger-subtle text-danger-ink border-danger/20 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    rejected: 'bg-danger-subtle text-danger-ink border-danger/20 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    cancelled: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80',
    active: 'bg-accent-subtle text-accent-strong border-accent/20 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
    info: 'bg-accent-subtle text-accent-strong border-accent/20 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
    inactive: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/80 dark:text-slate-400 dark:border-slate-700/80',
    neutral: 'bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60',
    dark: 'bg-slate-900 text-slate-100 border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600',
    terminated: 'bg-danger-subtle text-danger-ink border-danger/20 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    suspended: 'bg-warning-subtle text-warning-ink border-warning/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    action_required: 'bg-danger-subtle text-danger-ink border-danger/20 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    acknowledged: 'bg-surface-muted text-ink border-line dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60',
    resolved: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80',
    cleared: 'bg-success-subtle text-success-ink border-success/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    overturned: 'bg-success-subtle text-success-ink border-success/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    dismissed: 'bg-surface-muted text-ink border-line dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60',
    grace: 'bg-warning-subtle text-warning-ink border-warning/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    pakyawan: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
    teal: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30',
    leave: 'bg-surface-muted text-ink border-line dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700/70',
    paid_leave: 'bg-accent-subtle text-accent-strong border-accent/20 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
    unpaid_leave: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/70 dark:text-slate-400 dark:border-slate-700/70'
};

const DOT_COLORS = {
    present: 'bg-slate-400 dark:bg-emerald-400',
    success: 'bg-success dark:bg-emerald-400',
    approved: 'bg-success dark:bg-emerald-400',
    late: 'bg-warning dark:bg-amber-400',
    warning: 'bg-warning dark:bg-amber-400',
    needs_review: 'bg-warning dark:bg-amber-400',
    pending: 'bg-warning dark:bg-amber-400',
    absent: 'bg-danger dark:bg-rose-500',
    danger: 'bg-danger dark:bg-rose-500',
    destructive: 'bg-danger dark:bg-rose-500',
    rejected: 'bg-danger dark:bg-rose-500',
    cancelled: 'bg-slate-400 dark:bg-slate-500',
    active: 'bg-accent dark:bg-blue-400',
    info: 'bg-accent dark:bg-blue-400',
    inactive: 'bg-slate-500 dark:bg-slate-500',
    neutral: 'bg-slate-500 dark:bg-slate-400',
    dark: 'bg-slate-300 dark:bg-slate-300',
    terminated: 'bg-danger dark:bg-rose-500',
    suspended: 'bg-warning dark:bg-amber-400',
    action_required: 'bg-danger dark:bg-rose-500',
    acknowledged: 'bg-ink-subtle dark:bg-slate-400',
    resolved: 'bg-slate-500 dark:bg-slate-400',
    cleared: 'bg-success dark:bg-emerald-400',
    overturned: 'bg-success dark:bg-emerald-400',
    dismissed: 'bg-ink-subtle dark:bg-slate-400',
    grace: 'bg-warning dark:bg-amber-400',
    pakyawan: 'bg-purple-500 dark:bg-purple-400',
    purple: 'bg-purple-500 dark:bg-purple-400',
    teal: 'bg-teal-500 dark:bg-teal-400',
    leave: 'bg-slate-500 dark:bg-slate-400',
    paid_leave: 'bg-accent dark:bg-blue-400',
    unpaid_leave: 'bg-slate-400 dark:bg-slate-500'
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
            {withDot && v !== 'acknowledged' && (
                <span className={`h-1.5 w-1.5 rounded-full ${dot} shrink-0`} />
            )}
            <span>{children}</span>
        </span>
    );
};

export default Badge;
