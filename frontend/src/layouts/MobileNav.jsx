import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { isAdmin, isSecurity } from '../routes/guards';

export const MobileNav = ({
  user,
  sidebarOpen,
  setSidebarOpen,
  isStandalone,
  handleInstallApp,
  handleLogout
}) => {
  const location = useLocation();

  const adminTabs = [
    { to: '/', label: 'Home', icon: 'ti-smart-home', exact: true },
    { to: '/admin/employees', label: 'Staff', icon: 'ti-users-group' },
    { to: '/admin/attendance', label: 'Logs', icon: 'ti-clock-hour-4' },
    { to: '/admin/payroll', label: 'Payroll', icon: 'ti-wallet' },
    { to: '/admin/leaves', label: 'Leaves', icon: 'ti-plane-departure' }
  ];

  return (
    <>
      {/* Mobile navigation dock */}
      <div className="lg:hidden fixed bottom-2.5 sm:bottom-4 inset-x-0 z-40 flex justify-center px-2 sm:px-4 pointer-events-none pb-[max(0.35rem,env(safe-area-inset-bottom))]">
        <nav
          className={`pointer-events-auto w-full ${
            isAdmin(user) ? 'max-w-[460px]' : 'max-w-[320px] sm:max-w-[340px]'
          } bg-slate-900 text-slate-400 border border-slate-800 rounded-xl sm:rounded-2xl shadow-xl p-1 sm:p-1.5 flex items-center justify-between gap-0.5 sm:gap-1`}
        >
          {isAdmin(user) ? (
            <>
              {adminTabs.map(tab => {
                const isActive = tab.exact
                  ? location.pathname === tab.to
                  : location.pathname.startsWith(tab.to);

                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-0.5 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active ${
                      isActive ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={tab.label}
                  >
                    {isActive && (
                      <div className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40" />
                    )}
                    <i className={`ti ${tab.icon} text-lg sm:text-xl relative z-10 ${isActive ? 'scale-110' : ''}`} />
                    <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5">
                      {tab.label}
                    </span>
                  </Link>
                );
              })}

              {/* More Apps Trigger */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-0.5 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active cursor-pointer ${
                  sidebarOpen ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="More Apps"
              >
                {sidebarOpen && (
                  <div className="absolute inset-0 bg-purple-600 rounded-xl sm:rounded-2xl shadow-md shadow-purple-500/40" />
                )}
                <i className={`ti ti-grid-dots text-lg sm:text-xl relative z-10 ${sidebarOpen ? 'scale-110' : ''}`} />
                <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5">
                  More
                </span>
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between w-full relative">
              {/* Left: Portal Home */}
              <Link
                to="/employee/dashboard"
                className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-1 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active transition-all ${
                  location.pathname === '/employee/dashboard' ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Portal Home"
              >
                {location.pathname === '/employee/dashboard' && (
                  <div className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40" />
                )}
                <i
                  className={`ti ti-smart-home text-lg sm:text-xl relative z-10 ${
                    location.pathname === '/employee/dashboard' ? 'scale-110' : ''
                  }`}
                />
                <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5 font-bold">
                  Home
                </span>
              </Link>

              {/* Middle: Centered Elevated QR Code Button */}
              <div className="relative flex-1 flex flex-col items-center justify-center -mt-5 sm:-mt-6 group">
                <Link
                  to="/employee/qr"
                  className="relative flex flex-col items-center justify-center tap-active"
                  title="My QR ID Pass"
                >
                  <div
                    className={`relative w-12 h-12 sm:w-13 sm:h-13 rounded-full flex items-center justify-center ring-4 ring-slate-900 transition-transform active:scale-95 ${
                      location.pathname === '/employee/qr'
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40 border border-white/30'
                        : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 shadow-md border border-white/10'
                    }`}
                  >
                    <i className={`ti ti-qrcode text-xl sm:text-2xl ${location.pathname === '/employee/qr' ? 'scale-110' : ''}`} />
                  </div>
                  <span
                    className={`text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-1 font-bold ${
                      location.pathname === '/employee/qr' ? 'text-white font-black' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    QR Code
                  </span>
                </Link>
              </div>

              {/* Right: Quick Navigation Menu */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-1 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active transition-all cursor-pointer ${
                  sidebarOpen ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Quick Navigation Menu"
              >
                {sidebarOpen && (
                  <div className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40" />
                )}
                <i className={`ti ti-grid-dots text-lg sm:text-xl relative z-10 ${sidebarOpen ? 'scale-110' : ''}`} />
                <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5 font-bold">
                  Menu
                </span>
              </button>
            </div>
          )}
        </nav>
      </div>

      {/* More apps sheet modal */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end justify-center p-0">
          <div
            className="absolute inset-0 bg-slate-950/70"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative w-full max-w-lg bg-slate-900 border-t border-slate-800 rounded-t-2xl p-5 text-white shadow-2xl z-10 max-h-[85vh] overflow-y-auto touch-scroll pb-24">
            {/* Drag Pill Handle */}
            <div className="w-12 h-1.5 bg-slate-700/80 rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-black tracking-tight text-white">System Tools & Modules</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Quick Launch Center</p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white tap-active cursor-pointer"
                aria-label="Close Sheet"
              >
                <i className="ti ti-x text-sm" />
              </button>
            </div>

            {/* PWA Install Banner */}
            {isAdmin(user) && !isStandalone && (
              <div className="mb-4 p-3.5 bg-blue-600/20 border border-blue-500/30 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm shadow-md shadow-blue-500/30 shrink-0">
                    CP
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white truncate">Install C-Point App</p>
                    <p className="text-[9px] text-blue-200 truncate">Run fullscreen without browser bars</p>
                  </div>
                </div>
                <button
                  onClick={handleInstallApp}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl shadow-md shadow-blue-600/30 shrink-0 tap-active flex items-center gap-1 cursor-pointer"
                >
                  <i className="ti ti-download text-sm" /> Install
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 mb-5">
              {isAdmin(user) ? (
                <>
                  <Link
                    to="/admin/payroll/statutory-settings"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-adjustments-horizontal text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Statutory Settings</p>
                      <p className="text-[9px] text-slate-400 truncate">SSS, PhilHealth rates</p>
                    </div>
                  </Link>

                  <Link
                    to="/admin/disciplinary"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-gavel text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Disciplinary</p>
                      <p className="text-[9px] text-slate-400 truncate">Notices & infractions</p>
                    </div>
                  </Link>

                  <Link
                    to="/admin/audit-logs"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-history text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Audit Trail</p>
                      <p className="text-[9px] text-slate-400 truncate">Security history</p>
                    </div>
                  </Link>

                  <Link
                    to="/admin/attendance/calendar"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-calendar text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Calendar</p>
                      <p className="text-[9px] text-slate-400 truncate">Workforce roster</p>
                    </div>
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/employee/dashboard"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-smart-home text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">My Portal</p>
                      <p className="text-[9px] text-slate-400 truncate">Home & Shifts</p>
                    </div>
                  </Link>

                  <Link
                    to="/employee/qr"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-qrcode text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Digital Pass</p>
                      <p className="text-[9px] text-slate-400 truncate">Premise attendance QR</p>
                    </div>
                  </Link>

                  <Link
                    to="/employee/profile"
                    onClick={() => setSidebarOpen(false)}
                    className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                      <i className="ti ti-user-circle text-xl" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Profile</p>
                      <p className="text-[9px] text-slate-400 truncate">Personnel Record</p>
                    </div>
                  </Link>
                </>
              )}

              {(isAdmin(user) || isSecurity(user)) && (
                <Link
                  to="/scanner"
                  onClick={() => setSidebarOpen(false)}
                  className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <i className="ti ti-scan text-xl" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">AI Scanner</p>
                    <p className="text-[9px] text-slate-400 truncate">Gate terminal</p>
                  </div>
                </Link>
              )}
            </div>

            <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
              <Link
                to={isAdmin(user) ? "/profile" : "/employee/profile"}
                onClick={() => setSidebarOpen(false)}
                className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-center text-slate-300 tap-active"
              >
                My Profile
              </Link>
              <button
                onClick={handleLogout}
                className="flex-1 py-3 px-4 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 rounded-xl text-xs font-bold text-center tap-active flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <i className="ti ti-power" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default React.memo(MobileNav);
