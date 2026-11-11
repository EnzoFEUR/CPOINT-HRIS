import React from 'react';
import { useLocation } from 'react-router-dom';
import { getPageTitle } from '../routes/guards';
import HeaderClock from '../components/navigation/HeaderClock';
import GlobalSearch from '../components/navigation/GlobalSearch';
import NotificationBell from '../components/notifications/NotificationBell';
import ThemeToggle from '../components/navigation/ThemeToggle';

export const Header = ({ user }) => {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-3 sm:py-3.5 sticky top-0 sm:top-4 z-30 sm:mt-4 bg-white/95 dark:bg-slate-900/90 backdrop-blur-md shadow-2xs border-b sm:border border-slate-200 dark:border-slate-800 sm:rounded-2xl sm:mx-4 lg:mx-8 touch-pan-y select-none overscroll-none print:hidden">
      <div className="min-w-0 flex-1 mr-2">
        {pageTitle && (
          <h2 className="text-base sm:text-2xl font-bold text-slate-800 dark:text-slate-100 tracking-tight capitalize leading-tight truncate">
            {pageTitle}
          </h2>
        )}
        {/* Isolated Clock: zero layout re-renders */}
        <HeaderClock />
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5 relative shrink-0">
        <GlobalSearch user={user} />
        <ThemeToggle />
        <NotificationBell key={user?.id} user={user} />
      </div>
    </header>
  );
};

export default React.memo(Header);
