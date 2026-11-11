import { useNavigate } from 'react-router-dom';

/**
 * Enterprise Mobile Navbar
 * iOS-inspired top navigation bar for sub-lg viewports.
 * Features:
 * - Smart back navigation or custom action on top-left
 * - Centered/left aligned title with optional subtitle
 * - Top-right action slot for overflow, filters, or controls
 * - Safe-area inset top padding
 */
export const Navbar = ({
  title,
  subtitle,
  showBack = false,
  onBack,
  backFallback = '/',
  rightAction,
  className = '',
}) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    const hasHistory =
      typeof window !== 'undefined' &&
      window.history.state &&
      typeof window.history.state.idx === 'number' &&
      window.history.state.idx > 0;

    if (hasHistory) {
      navigate(-1);
    } else {
      navigate(backFallback, { replace: true });
    }
  };

  return (
    <header
      className={`lg:hidden sticky top-0 z-30 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 px-4 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-3 transition-colors ${className}`}
    >
      <div className="flex items-center justify-between gap-3 max-w-lg mx-auto w-full">
        {/* Left: Back / Dismiss */}
        <div className="flex items-center gap-2 shrink-0 min-w-10">
          {showBack && (
            <button
              type="button"
              onClick={handleBack}
              className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-slate-200/60 dark:border-slate-700/60 active:scale-95"
              aria-label="Go back"
              title="Back"
            >
              <i className="ti ti-chevron-left text-lg font-bold" />
            </button>
          )}
        </div>

        {/* Center / Title */}
        <div className="min-w-0 flex-1 text-center">
          {title && (
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate leading-tight">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        {/* Right: Actions / Filter / Menu */}
        <div className="flex items-center justify-end gap-1.5 shrink-0 min-w-10">
          {rightAction}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
