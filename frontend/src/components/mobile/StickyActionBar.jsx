/**
 * Enterprise Mobile StickyActionBar
 * Anchors high-frequency primary CTAs within the mobile thumb zone (bottom 25% of viewport).
 * Enforces WCAG 2.5.5 minimum 44px touch targets and safe-area inset bottom padding.
 */
export const StickyActionBar = ({
  primaryAction,
  secondaryAction,
  className = '',
  children,
}) => {
  return (
    <div
      className={`lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800/80 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl ${className}`}
    >
      <div className="max-w-md mx-auto w-full">
        {children ? (
          children
        ) : (
          <div className="flex items-center gap-2.5">
            {secondaryAction && (
              <div className="shrink-0 min-w-[30%]">
                {secondaryAction}
              </div>
            )}
            {primaryAction && (
              <div className="flex-1 min-w-0">
                {primaryAction}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StickyActionBar;
