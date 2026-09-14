import React from 'react';
import { useLocation } from 'react-router-dom';
import { getPageTitle } from '../routes/guards';
import HeaderClock from '../components/navigation/HeaderClock';
import GlobalSearch from '../components/navigation/GlobalSearch';
import NotificationBell from '../components/notifications/NotificationBell';

export const Header = ({ user, setSidebarOpen }) => {
  const location = useLocation();

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-3 sm:py-3.5 sticky top-0 sm:top-4 z-30 bg-white shadow-xs sm:shadow-sm border-b sm:border border-slate-200 sm:rounded-xl sm:mx-4 lg:mx-8 touch-none select-none overscroll-none">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl bg-slate-900 text-white shadow-xs tap-active cursor-pointer hover:bg-slate-800 transition-colors"
          title="Open Navigation"
          aria-label="Open Navigation"
        >
          <i className="ti ti-menu-2 text-base" />
        </button>
        <div>
          <h2 className="text-base sm:text-2xl font-black text-slate-800 tracking-tight capitalize leading-tight">
            {getPageTitle(location.pathname)}
          </h2>
          {/* Isolated Clock: zero layout re-renders */}
          <HeaderClock />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 relative">
        <GlobalSearch user={user} />
        <NotificationBell user={user} />
      </div>
    </header>
  );
};

export default React.memo(Header);
