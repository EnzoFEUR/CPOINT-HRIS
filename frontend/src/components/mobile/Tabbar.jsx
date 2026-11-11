import { Link, useLocation } from 'react-router-dom';

/**
 * Enterprise Mobile Tabbar
 * 5-item maximum bottom navigation dock adhering to mobile thumb reach constraints.
 * Safe-area inset bottom padding and high-contrast active indicator.
 */
export const Tabbar = ({
  tabs = [],
  className = '',
  maxWidth = 'max-w-md',
}) => {
  const location = useLocation();

  // Enforce 5-item maximum constraint
  const activeTabs = tabs.slice(0, 5);

  return (
    <div
      className={`lg:hidden fixed bottom-2.5 sm:bottom-4 inset-x-0 z-40 flex justify-center px-2.5 sm:px-4 pointer-events-none pb-[max(0.35rem,env(safe-area-inset-bottom))] ${className}`}
    >
      <nav
        role="navigation"
        aria-label="Mobile Navigation"
        className={`pointer-events-auto w-full ${maxWidth} bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl text-slate-400 border border-slate-800 rounded-2xl shadow-2xl p-1.5 flex items-center justify-between gap-1`}
      >
        {activeTabs.map((tab) => {
          const isActive = tab.isActive
            ? tab.isActive(location.pathname)
            : tab.exact
            ? location.pathname === tab.to
            : location.pathname.startsWith(tab.to);

          if (tab.onClick) {
            return (
              <button
                key={tab.key || tab.label}
                type="button"
                onClick={tab.onClick}
                className={`relative flex-1 min-w-0 py-2 px-1 flex flex-col items-center justify-center rounded-xl select-none transition-colors duration-100 cursor-pointer min-h-[44px] ${
                  isActive ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title={tab.label}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-accent rounded-xl shadow-xs" />
                )}
                {tab.icon && <i className={`ti ${tab.icon} text-lg relative z-10`} />}
                <span className="text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-1 font-medium">
                  {tab.label}
                </span>
                {tab.badge != null && tab.badge > 0 && (
                  <span className="absolute top-1 right-2 px-1 py-0.2 bg-warning text-slate-950 rounded-full text-[8px] font-black z-20">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          }

          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`relative flex-1 min-w-0 py-2 px-1 flex flex-col items-center justify-center rounded-xl select-none transition-colors duration-100 cursor-pointer min-h-[44px] ${
                isActive ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={tab.label}
            >
              {isActive && (
                <div className="absolute inset-0 bg-accent rounded-xl shadow-xs" />
              )}
              {tab.icon && <i className={`ti ${tab.icon} text-lg relative z-10`} />}
              <span className="text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-1 font-medium">
                {tab.label}
              </span>
              {tab.badge != null && tab.badge > 0 && (
                <span className="absolute top-1 right-2 px-1 py-0.2 bg-warning text-slate-950 rounded-full text-[8px] font-black z-20">
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default Tabbar;
