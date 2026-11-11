/**
 * Enterprise Mobile EmptyState
 * Clean zero-data placeholder for mobile feeds and list views.
 */
export const EmptyState = ({
  icon = 'ti-inbox',
  title = 'No records found',
  description = 'There are no active items to display at this time.',
  action,
  className = '',
}) => {
  return (
    <div
      className={`p-6 sm:p-8 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl text-center shadow-2xs space-y-3 ${className}`}
    >
      <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center text-2xl border border-slate-200/50 dark:border-slate-700/50">
        <i className={`ti ${icon}`} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 tracking-tight">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
};

export default EmptyState;
