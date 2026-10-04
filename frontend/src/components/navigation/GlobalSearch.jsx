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
        className="md:hidden text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-md h-9 w-9 flex items-center justify-center cursor-pointer shadow-2xs transition-colors duration-100"
        aria-label="Search"
      >
        <i className="ti ti-search text-base"></i>
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
          className="h-9 pl-8 pr-8 bg-white border border-slate-200 rounded-md text-xs focus:border-blue-600 focus:ring-1 focus:ring-blue-600 w-60 focus:w-72 font-medium text-slate-700 outline-none shadow-2xs transition-all duration-100"
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
        <div className="fixed inset-x-4 top-16 md:absolute md:inset-auto md:top-full md:right-0 md:mt-2 md:w-80 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="p-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Quick Navigation</p>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
              }}
              className="w-7 h-7 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 flex items-center justify-center cursor-pointer transition-colors duration-100"
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
              className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-2xs transition-colors duration-100"
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
                  className="flex items-center gap-3 p-2.5 hover:bg-slate-50 transition-colors duration-100 cursor-pointer group"
                >
                  <div className="h-7 w-7 bg-slate-100 text-slate-600 rounded-md flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors duration-100">
                    <i className={`ti ${item.icon} text-sm`}></i>
                  </div>
                  <span className="text-xs font-semibold text-slate-700">{item.label}</span>
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
