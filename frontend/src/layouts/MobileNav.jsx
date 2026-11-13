import React from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { isAdmin, isSecurity, isMedicalExempt } from '../routes/guards';
import { isOfflineFeatureActive } from '../routes/OfflineRouteGate.js';
import EmployeeAvatar from '../components/EmployeeAvatar';

export const MobileNav = ({
  user,
  sidebarOpen,
  setSidebarOpen,
  isStandalone,
  handleInstallApp,
  handleLogout
}) => {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const rawTab = searchParams.get('tab');

  const isSettingsActive =
    location.pathname.startsWith('/admin/settings') ||
    location.pathname.startsWith('/admin/payroll/statutory-settings') ||
    location.pathname === '/admin/holidays' ||
    location.pathname.startsWith('/admin/audit-logs') ||
    (location.pathname === '/admin/leaves' && rawTab === 'sil-policy');

  const isMoreActive =
    isSettingsActive ||
    location.pathname.startsWith('/admin/disciplinary') ||
    location.pathname.startsWith('/admin/attendance/calendar') ||
    location.pathname.startsWith('/admin/attendance/offline') ||
    location.pathname === '/scanner' ||
    location.pathname === '/profile' ||
    location.pathname.startsWith('/employee/profile');

  const isEmployeeHomeActive =
    location.pathname === '/employee/dashboard' ||
    (location.pathname === '/' && !isAdmin(user));
  const isEmployeeQrActive = location.pathname === '/employee/qr';
  const isEmployeeMenuActive =
    location.pathname.startsWith('/employee/documents') ||
    location.pathname.startsWith('/employee/policy-reports') ||
    location.pathname.startsWith('/employee/profile') ||
    location.pathname === '/profile' ||
    location.pathname === '/scanner';

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
      <div className="lg:hidden fixed bottom-2.5 sm:bottom-4 inset-x-0 z-40 flex justify-center px-2.5 sm:px-4 pointer-events-none pb-[max(0.35rem,env(safe-area-inset-bottom))]">
        <nav
          className={`pointer-events-auto w-full ${
            isAdmin(user) ? 'max-w-[460px]' : 'max-w-[320px] sm:max-w-[340px]'
          } bg-slate-900/95 backdrop-blur-md text-slate-400 border border-slate-800 rounded-2xl shadow-2xl p-1.5 flex items-center justify-between gap-0.5`}
        >
          {isAdmin(user) ? (
            <>
              {adminTabs.map(tab => {
                let isActive;
                if (tab.to === '/admin/payroll') {
                  isActive =
                    location.pathname.startsWith('/admin/payroll') &&
                    !location.pathname.startsWith('/admin/payroll/statutory-settings');
                } else if (tab.to === '/admin/leaves') {
                  isActive =
                    location.pathname.startsWith('/admin/leaves') && rawTab !== 'sil-policy';
                } else if (tab.to === '/admin/attendance') {
                  isActive =
                    location.pathname === '/admin/attendance' ||
                    (location.pathname.startsWith('/admin/attendance') &&
                      !location.pathname.includes('/calendar') &&
                      !location.pathname.includes('/offline'));
                } else if (tab.exact) {
                  isActive = location.pathname === tab.to;
                } else {
                  isActive = location.pathname.startsWith(tab.to);
                }

                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    className={`relative flex-1 min-w-0 py-1.5 px-0.5 flex flex-col items-center justify-center rounded-xl select-none transition-colors duration-100 ${
                      isActive ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={tab.label}
                  >
                    {isActive && (
                      <div className="absolute inset-0 bg-accent rounded-xl shadow-xs" />
                    )}
                    <i className={`ti ${tab.icon} text-lg relative z-10`} />
                    <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5 font-medium">
                      {tab.label}
                    </span>
                  </Link>
                );
              })}

              {/* More Apps Trigger */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className={`relative flex-1 min-w-0 py-1.5 px-0.5 flex flex-col items-center justify-center rounded-xl select-none transition-colors duration-100 cursor-pointer ${
                  sidebarOpen || isMoreActive ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="More Apps"
              >
                {(sidebarOpen || isMoreActive) && (
                  <div className="absolute inset-0 bg-accent rounded-xl shadow-xs" />
                )}
                <i className="ti ti-grid-dots text-lg relative z-10" />
                <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5 font-medium">
                  More
                </span>
              </button>
            </>
          ) : (
            <div className="flex items-center justify-between w-full relative">
              {/* Left: Portal Home */}
              <Link
                to="/employee/dashboard"
                className={`relative flex-1 min-w-0 py-1.5 px-1 flex flex-col items-center justify-center rounded-xl select-none transition-colors duration-100 ${
                  isEmployeeHomeActive ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Portal Home"
              >
                {isEmployeeHomeActive && (
                  <div className="absolute inset-0 bg-accent rounded-xl shadow-xs" />
                )}
                <i className="ti ti-smart-home text-lg relative z-10" />
                <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5 font-semibold">
                  Home
                </span>
              </Link>

              {/* Middle: Centered Elevated QR Code Button */}
              <div className="relative flex-1 flex flex-col items-center justify-center -mt-5 sm:-mt-6 group">
                <Link
                  to="/employee/qr"
                  className="relative flex flex-col items-center justify-center transition-colors duration-100 cursor-pointer"
                  title="My QR ID Pass"
                >
                  <div
                    className={`relative w-12 h-12 rounded-full flex items-center justify-center ring-4 ring-slate-900 transition-colors duration-100 ${
                      isEmployeeQrActive
                        ? 'bg-accent text-white shadow-lg shadow-accent/30 border border-white/30'
                        : isMedicalExempt(user)
                        ? 'bg-warning text-white shadow-2xs border border-warning/20'
                        : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 shadow-2xs border border-white/10'
                    }`}
                  >
                    <i className="ti ti-qrcode text-xl" />
                    {isMedicalExempt(user) && (
                      <span
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-warning border-2 border-slate-900 rounded-full flex items-center justify-center text-[7px] text-slate-950 font-black"
                        title="Medical Grace Active"
                      >
                        +
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-1 font-semibold ${
                      isEmployeeQrActive
                        ? 'text-white font-bold'
                        : isMedicalExempt(user)
                        ? 'text-warning font-bold'
                        : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    {isMedicalExempt(user) ? 'Grace Pass' : 'QR Code'}
                  </span>
                </Link>
              </div>

              {/* Right: Quick Navigation Menu */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className={`relative flex-1 min-w-0 py-1.5 px-1 flex flex-col items-center justify-center rounded-xl select-none transition-colors duration-100 cursor-pointer ${
                  sidebarOpen || isEmployeeMenuActive ? 'text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Quick Navigation Menu"
              >
                {(sidebarOpen || isEmployeeMenuActive) && (
                  <div className="absolute inset-0 bg-accent rounded-xl shadow-xs" />
                )}
                <i className="ti ti-grid-dots text-lg relative z-10" />
                <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5 font-semibold">
                  Menu
                </span>
              </button>
            </div>
          )}
        </nav>
      </div>

      {/* More apps sheet modal */}
      {sidebarOpen &&
        createPortal(
          <div className="lg:hidden fixed inset-0 z-[100] flex items-end justify-center p-0 overflow-hidden">
            <div
              className="fixed inset-0 w-screen h-screen min-h-[100dvh] bg-slate-950/80 backdrop-blur-xs transition-opacity"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 w-full max-w-lg bg-slate-900 border-t border-slate-800 rounded-t-3xl p-5 text-white shadow-2xl max-h-[88vh] overflow-y-auto touch-scroll pb-24">
              {/* Drag Pill Handle */}
              <div className="w-12 h-1.5 bg-slate-700/80 rounded-full mx-auto mb-4" />

              {/* Drawer Top Row: Title & Dismiss */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white tracking-tight">System Navigation</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-widest border border-slate-700/60">
                    {isAdmin(user) ? 'Admin Console' : 'Portal Menu'}
                  </span>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors duration-100 cursor-pointer border border-slate-700"
                  aria-label="Close Sheet"
                >
                  <i className="ti ti-x text-sm" />
                </button>
              </div>

              {/* User Identity Banner */}
              <div className="flex items-center gap-3 p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl mb-4">
                <EmployeeAvatar
                  employee={user}
                  size="h-11 w-11"
                  rounded="rounded-xl"
                  theme="dark"
                  border="border border-slate-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-white truncate">
                      {user?.name ||
                        `${user?.first_name || ''} ${user?.last_name || ''}`.trim() ||
                        (isAdmin(user) ? 'Administrator' : 'Employee')}
                    </p>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                        isAdmin(user)
                          ? 'bg-accent/20 text-accent border border-accent/30'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {user?.role || (isAdmin(user) ? 'Admin' : 'Staff')}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 truncate mt-0.5 font-mono">
                    {user?.company_id
                      ? `ID: ${user.company_id}`
                      : user?.department ||
                        user?.job_title ||
                        (isAdmin(user) ? 'Administrative Console' : 'Employee Portal')}
                  </p>
                </div>
              </div>

              {/* PWA Install Banner */}
              {!isStandalone && (
                <div className="mb-4 p-3.5 bg-accent/20 border border-accent/30 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <picture>
                      <source srcSet="/logo-icon.webp" type="image/webp" />
                      <img
                        src="/logo-icon.png"
                        alt="C-Point"
                        width="32"
                        height="32"
                        decoding="async"
                        className="w-8 h-8 rounded-lg object-contain bg-slate-800 p-1 shrink-0"
                      />
                    </picture>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">Install C-Point HRIS</p>
                      <p className="text-[9px] text-white/80 truncate">Add shortcut to home screen</p>
                    </div>
                  </div>
                  <button
                    onClick={handleInstallApp}
                    className="h-8 px-3 bg-accent hover:bg-accent text-white text-xs font-semibold rounded-lg shadow-2xs shrink-0 flex items-center gap-1 cursor-pointer transition-colors duration-100"
                  >
                    <i className="ti ti-download text-sm" /> Install
                  </button>
                </div>
              )}

              {/* Organized Drawer Links */}
              {isAdmin(user) ? (
                <div className="space-y-4 mb-5">
                  {/* Operations & Roster */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
                      Operations & Roster
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        to="/admin/disciplinary"
                        onClick={() => setSidebarOpen(false)}
                        className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-2.5 transition-colors duration-100 cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0">
                          <i className="ti ti-gavel text-lg" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">Disciplinary</p>
                          <p className="text-[9px] text-slate-400 truncate">Notices & infractions</p>
                        </div>
                      </Link>

                      <Link
                        to="/admin/attendance/calendar"
                        onClick={() => setSidebarOpen(false)}
                        className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-2.5 transition-colors duration-100 cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0">
                          <i className="ti ti-calendar text-lg" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">Roster Calendar</p>
                          <p className="text-[9px] text-slate-400 truncate">Workforce shifts</p>
                        </div>
                      </Link>

                      {isOfflineFeatureActive && (
                        <Link
                          to="/admin/attendance/offline"
                          onClick={() => setSidebarOpen(false)}
                          className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-2.5 transition-colors duration-100 cursor-pointer"
                        >
                          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
                            <i className="ti ti-device-watch text-lg" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">Offline Captures</p>
                            <p className="text-[9px] text-slate-400 truncate">Provisional kiosk punches</p>
                          </div>
                        </Link>
                      )}

                      {(isAdmin(user) || isSecurity(user)) && (
                        <Link
                          to="/scanner"
                          onClick={() => setSidebarOpen(false)}
                          className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-2.5 transition-colors duration-100 cursor-pointer"
                        >
                          <div className="w-8 h-8 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0">
                            <i className="ti ti-scan text-lg" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">AI Scanner</p>
                            <p className="text-[9px] text-slate-400 truncate">Gate terminal</p>
                          </div>
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* System Configuration Hub */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
                      System Administration
                    </p>
                    <Link
                      to="/admin/settings"
                      onClick={() => setSidebarOpen(false)}
                      className="w-full p-3.5 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center justify-between transition-colors duration-100 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center shrink-0 shadow-md shadow-accent/20">
                          <i className="ti ti-settings text-xl" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">Settings Hub</p>
                          <p className="text-[10px] text-slate-400 truncate">
                            Statutory tables, holidays, SIL policy & audit trail
                          </p>
                        </div>
                      </div>
                      <i className="ti ti-chevron-right text-sm text-slate-500 shrink-0 ml-2" />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 mb-5">
                  {/* Medical Grace Pass Banner if applicable */}
                  {isMedicalExempt(user) && (
                    <div className="p-3 bg-warning/10 border border-warning/30 rounded-xl flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-warning/20 text-warning flex items-center justify-center shrink-0">
                        <i className="ti ti-bandage text-lg" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-warning truncate">Medical Grace Active</p>
                        <p className="text-[9px] text-warning/80">Authorized grace period applied to attendance scans.</p>
                      </div>
                    </div>
                  )}

                  {/* Personnel & Self-Service Records */}
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">
                      Personnel & Records
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Link
                        to="/employee/documents"
                        onClick={() => setSidebarOpen(false)}
                        className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-3 transition-colors duration-100 cursor-pointer"
                      >
                        <div className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0">
                          <i className="ti ti-folders text-lg" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">Personnel Documents</p>
                          <p className="text-[9px] text-slate-400 truncate">201 files & request documents</p>
                        </div>
                      </Link>

                      <Link
                        to="/employee/policy-reports"
                        onClick={() => setSidebarOpen(false)}
                        className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-3 transition-colors duration-100 cursor-pointer"
                      >
                        <div className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0">
                          <i className="ti ti-scale text-lg" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">Policy & Incident Reports</p>
                          <p className="text-[9px] text-slate-400 truncate">Company policies & incident reports</p>
                        </div>
                      </Link>

                      {(isAdmin(user) || isSecurity(user)) && (
                        <Link
                          to="/scanner"
                          onClick={() => setSidebarOpen(false)}
                          className="p-3 bg-slate-800/40 hover:bg-slate-800 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-3 transition-colors duration-100 cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0">
                            <i className="ti ti-scan text-lg" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">AI Scanner</p>
                            <p className="text-[9px] text-slate-400 truncate">Premise attendance terminal</p>
                          </div>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Drawer Footer Actions: My Profile & Logout */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                <Link
                  to={isAdmin(user) ? '/profile' : '/employee/profile'}
                  onClick={() => setSidebarOpen(false)}
                  className="flex-1 h-10 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-semibold text-center text-slate-200 transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="ti ti-user-circle text-base" /> My Profile
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex-1 h-10 px-4 bg-danger-ink/40 hover:bg-danger-ink/70 border border-danger/50 text-danger rounded-xl text-xs font-semibold text-center transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="ti ti-power text-base" /> Sign Out
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export default React.memo(MobileNav);
