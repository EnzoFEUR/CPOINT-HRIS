/**
 * Enterprise Mobile Shell
 * Provides responsive viewport containment below the lg breakpoint.
 * Desktop layout (>= 1024px) remains strictly unchanged.
 */
export const MobileShell = ({
  children,
  header,
  footer,
  navbar,
  tabbar,
  stickyActionBar,
  className = '',
  containOverscroll = true,
  hasBottomBar = false,
}) => {
  const topBar = header || navbar;
  const bottomBar = footer || tabbar || stickyActionBar;
  const needsBottomPadding = hasBottomBar || Boolean(bottomBar);

  return (
    <div
      className={`min-h-[100dvh] flex flex-col bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 font-sans ${
        containOverscroll ? 'overscroll-y-contain' : ''
      } ${className}`}
    >
      {/* Top Navbar slot */}
      {topBar && <div className="shrink-0">{topBar}</div>}

      {/* Main content body with safe thumb scrolling and adaptive tablet width */}
      <main
        className={`flex-1 w-full max-w-lg mx-auto sm:max-w-xl md:max-w-2xl px-3.5 sm:px-6 py-3 sm:py-5 ${
          needsBottomPadding ? 'pb-24' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))]'
        }`}
      >
        {children}
      </main>

      {/* Bottom Sticky Action / Tab slot */}
      {bottomBar && <div className="shrink-0">{bottomBar}</div>}
    </div>
  );
};

export default MobileShell;
