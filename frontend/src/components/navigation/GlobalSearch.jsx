import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isAdmin, isSecurity } from '../../routes/guards';

export const GlobalSearch = ({ user }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const containerRef = useRef(null);
  const location = useLocation();

  const searchIndex = useMemo(() => {
    if (isAdmin(user)) {
      return [
        { label: 'Admin Dashboard', route: '/', icon: 'ti-smart-home' },
        { label: 'Employees Directory', route: '/admin/employees', icon: 'ti-users-group' },
        { label: 'Payroll Ledger', route: '/admin/payroll', icon: 'ti-wallet' },
        { label: 'Compute Payroll', route: '/admin/payroll/process', icon: 'ti-calculator' },
        { label: 'Statutory Settings', route: '/admin/payroll/statutory-settings', icon: 'ti-adjustments-horizontal' },
        { label: 'Leave Approvals', route: '/admin/leaves', icon: 'ti-plane-departure' },
        { label: 'Disciplinary & Notices', route: '/admin/disciplinary', icon: 'ti-alert-triangle' },
        { label: 'Audit Trail', route: '/admin/audit-logs', icon: 'ti-history' },
        { label: 'Attendance Daily Logs', route: '/admin/attendance', icon: 'ti-list-details' },
        { label: 'Calendar Roster', route: '/admin/attendance/calendar', icon: 'ti-calendar' },
        { label: 'Gate Terminal Scanner', route: '/scanner', icon: 'ti-scan' },
        { label: 'My Profile', route: '/profile', icon: 'ti-user-circle' },
      ];
    }
    if (isSecurity(user)) {
      return [
        { label: 'Gate Terminal Scanner', route: '/scanner', icon: 'ti-scan' },
        { label: 'My Profile', route: '/profile', icon: 'ti-user-circle' },
      ];
    }
    return [
      { label: 'My Portal', route: '/employee/dashboard', icon: 'ti-smart-home' },
      { label: 'My Digital Pass (QR)', route: '/employee/qr', icon: 'ti-qrcode' },
      { label: 'My Profile', route: '/profile', icon: 'ti-user-circle' },
    ];
  }, [user]);

  const filteredSearch = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return searchIndex.filter(item => item.label.toLowerCase().includes(query));
  }, [searchQuery, searchIndex]);

  // Close on route change
  useEffect(() => {
    setShowSearch(false);
    setSearchQuery('');
  }, [location.pathname]);

  // Click outside and Escape key handler
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSearch(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowSearch(false);
      }
      // Ctrl+K or Cmd+K shortcut
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Mobile Quick Search Button */}
      <button
        onClick={() => setShowSearch(!showSearch)}
        className="md:hidden p-2 text-slate-500 hover:text-blue-600 tap-active bg-slate-100/80 rounded-xl h-9 w-9 flex items-center justify-center cursor-pointer"
        aria-label="Search"
      >
        <i className="ti ti-search text-lg"></i>
      </button>

      {/* Desktop Search Bar */}
      <div className="relative hidden md:block">
        <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none"></i>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSearch(true);
          }}
          onFocus={() => setShowSearch(true)}
          placeholder="Search everywhere... (Ctrl+K)"
          className="pl-8 pr-8 py-1.5 bg-slate-100/90 border-none rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 w-60 transition-all focus:w-72 font-medium text-slate-700 outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setShowSearch(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
            title="Clear search"
          >
            <i className="ti ti-x text-xs" />
          </button>
        )}
      </div>

      {/* Search dropdown (Desktop & Mobile Modal) */}
      {showSearch && (
        <div className="fixed inset-x-4 top-16 md:absolute md:inset-auto md:top-full md:right-0 md:mt-2 md:w-80 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-50">
          <div className="p-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Quick Navigation</p>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
              }}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              title="Close Search (Esc)"
            >
              <i className="ti ti-x text-base"></i>
            </button>
          </div>
          <div className="p-2 md:hidden">
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type a page or tool..."
              className="w-full px-3 py-2 bg-slate-100 rounded-xl text-xs font-medium text-slate-800 outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filteredSearch.length > 0 ? (
              filteredSearch.map(item => (
                <Link
                  key={item.route}
                  to={item.route}
                  onClick={() => {
                    setShowSearch(false);
                    setSearchQuery('');
                  }}
                  className="flex items-center gap-3 p-2.5 hover:bg-blue-50/50 transition-colors cursor-pointer group"
                >
                  <div className="h-7 w-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <i className={`ti ${item.icon} text-sm`}></i>
                  </div>
                  <span className="text-xs font-bold text-slate-700">{item.label}</span>
                </Link>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-500 font-bold">
                {searchQuery ? `No results found for "${searchQuery}"` : 'Type above to search...'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(GlobalSearch);
