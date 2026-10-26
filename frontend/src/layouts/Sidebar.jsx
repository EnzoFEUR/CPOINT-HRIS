import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { isAdmin, isSecurity, isMedicalExempt } from '../routes/guards';
import { isOfflineFeatureActive } from '../routes/OfflineRouteGate.js';
import { offlineApi } from '../utils/offlineAttendanceSync';
import sidebarCover from '../assets/sidebar-cover.jpg';
import EmployeeAvatar from '../components/EmployeeAvatar';

export const Sidebar = ({ user, handleLogout }) => {
  const location = useLocation();
  const queryClient = useQueryClient();

  const isAttendanceActive = location.pathname.includes('/admin/attendance');
  const [attendanceDropdownOpen, setAttendanceDropdownOpen] = useState(isAttendanceActive);

  const isLeavesPath = location.pathname.startsWith('/admin/leaves');
  const [leavesDropdownOpen, setLeavesDropdownOpen] = useState(isLeavesPath);

  const [previousLeavesPath, setPreviousLeavesPath] = useState(isLeavesPath);
  if (previousLeavesPath !== isLeavesPath) {
    setPreviousLeavesPath(isLeavesPath);
    if (isLeavesPath) setLeavesDropdownOpen(true);
  }

  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get('tab') || 'requests';
  const isApprovalsActive = isLeavesPath && (!searchParams.get('tab') || currentTab === 'requests');
  const isCashoutsActive = isLeavesPath && (currentTab === 'cashouts' || currentTab === 'cashout');
  const isPolicyActive = isLeavesPath && currentTab === 'sil-policy';

  // Enterprise real-time count badges (<5ms head count, zero payload)
  const { data: leaveCounts = { pendingLeaves: 0, pendingCash: 0 } } = useQuery({
    queryKey: ['sidebarLeaveCounts'],
    queryFn: async () => {
      try {
        const [leavesRes, cashRes] = await Promise.all([
          supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
          supabase.from('sil_cash_out_requests').select('*', { count: 'exact', head: true }).in('status', ['requested', 'needs_correction'])
        ]);
        return {
          pendingLeaves: leavesRes.count || 0,
          pendingCash: cashRes.count || 0
        };
      } catch {
        return { pendingLeaves: 0, pendingCash: 0 };
      }
    },
    enabled: Boolean(isAdmin(user)),
    staleTime: 30000,
    refetchOnWindowFocus: true
  });

  // Real-time synchronization for leave requests & cash-outs
  useEffect(() => {
    if (!isAdmin(user)) return;
    const channel = supabase.channel('realtime:sidebar-leaves-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['sidebarLeaveCounts'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_cash_out_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['sidebarLeaveCounts'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user]);

  // Offline provisional captures pending count (zero overhead, real-time sync)
  const { data: offlineStats } = useQuery({
    queryKey: ['sidebarOfflinePendingCount'],
    queryFn: async () => {
      try {
        const res = await offlineApi('/stats');
        return res?.counts || null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(isAdmin(user) && isOfflineFeatureActive),
    staleTime: 15000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true
  });
  const offlinePendingCount = offlineStats?.needs_review || 0;

  // Real-time listener for offline attendance mutations across tabs
  useEffect(() => {
    if (!isAdmin(user) || !isOfflineFeatureActive) return;
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('cpoint_offline_attendance_channel');
      channel.onmessage = () => {
        queryClient.invalidateQueries({ queryKey: ['sidebarOfflinePendingCount'] });
      };
      return () => channel.close();
    }
  }, [queryClient, user]);

  const totalPendingLeaves = (leaveCounts?.pendingLeaves || 0) + (leaveCounts?.pendingCash || 0);

  const topAdminNavItems = [
    { route: '/admin/employees', icon: 'ti-users-group', label: 'Employees' },
    { route: '/admin/payroll', icon: 'ti-wallet', label: 'Payroll Ledger' }
  ];

  const bottomAdminNavItems = [
    { route: '/admin/disciplinary', icon: 'ti-gavel', label: 'Disciplinary' },
    { route: '/admin/audit-logs', icon: 'ti-history', label: 'Audit Trail' },
  ];

  return (
    <aside className="hidden lg:flex fixed inset-y-4 left-4 z-50 w-72 rounded-2xl border border-slate-800 text-slate-300 flex-col shadow-lg bg-slate-900">
      {/* Brand header: photo that fades into the sidebar surface, logo centered on top */}
      <div className="relative h-40 shrink-0 overflow-hidden rounded-t-[15px]">
        <img
          src={sidebarCover}
          alt=""
          width="288"
          height="160"
          decoding="async"
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover object-[50%_16%] saturate-[0.6] pointer-events-none"
        />
        {/* Flat slate-900 tint over the whole photo so it shares the sidebar's color */}
        <div aria-hidden="true" className="absolute inset-0 bg-slate-900/55" />
        {/* Vertical fade that resolves into the sidebar surface (#0f172a) */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(15,23,42,0)_0%,rgba(15,23,42,0.45)_55%,#0f172a_100%)]"
        />
        <div className="relative z-10 flex h-full items-center justify-center px-8 pb-3">
          <Link
            to="/"
            aria-label="C-Point HRIS home"
            className="flex items-center justify-center rounded-md cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <picture>
              <source srcSet="/logo-crop.webp" type="image/webp" />
              <img
                src="/logo-crop.png"
                alt="C-Point HRIS"
                width="200"
                height="60"
                decoding="async"
                className="h-15 w-auto max-w-[200px] object-contain select-none pointer-events-none drop-shadow-[0_2px_8px_rgba(15,23,42,0.55)]"
              />
            </picture>
          </Link>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-2 px-4 space-y-1.5 overflow-y-auto pb-6 custom-scrollbar">
        <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Overview</p>

        {isAdmin(user) ? (
          <Link
            to="/"
            className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${
              location.pathname === '/'
                ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
            }`}
          >
            <i className="ti ti-smart-home text-xl"></i>
            <span className="ml-3 font-medium tracking-wide">Dashboard</span>
          </Link>
        ) : (
          <>
            <Link
              to="/employee/dashboard"
              className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${
                location.pathname === '/employee/dashboard' || location.pathname === '/'
                  ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
              }`}
            >
              <i className="ti ti-smart-home text-xl"></i>
              <span className="ml-3 font-medium tracking-wide">My Portal</span>
            </Link>

            {[
              { to: '/employee/documents', icon: 'ti-folders', label: 'Personnel Documents' },
              { to: '/employee/policy-reports', icon: 'ti-scale', label: 'Policy & Incident Reports' },
            ].map(item => (
              <Link key={item.to} to={item.to} className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${location.pathname === item.to ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'}`}>
                <i className={`ti ${item.icon} text-xl shrink-0`} aria-hidden="true" />
                <span className="ml-3 font-medium tracking-wide">{item.label}</span>
              </Link>
            ))}

            <Link
              to="/employee/qr"
              className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors mt-1 ${
                location.pathname === '/employee/qr'
                  ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
              }`}
            >
              <i className="ti ti-qrcode text-xl"></i>
              <span className="ml-3 font-medium tracking-wide">Digital Pass (QR)</span>
              {isMedicalExempt(user) && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-warning/20 text-warning border border-warning/30 flex items-center gap-1">
                  <i className="ti ti-bandage text-xs" />
                  Grace
                </span>
              )}
            </Link>
          </>
        )}

        <div className="pt-5 pb-2">
          <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Workspace</p>
        </div>

        {isAdmin(user) ? (
          <>
            {/* Attendance submenu */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setAttendanceDropdownOpen(!attendanceDropdownOpen)}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl cursor-pointer ${
                  isAttendanceActive ? 'bg-slate-800/50 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <div className="flex items-center">
                  <i className={`ti ti-clock-hour-4 text-xl ${isAttendanceActive ? 'text-accent' : ''}`}></i>
                  <span className="ml-3 font-medium tracking-wide">Time & Attendance</span>
                </div>
                <i className={`ti ti-chevron-down text-sm transition-transform ${attendanceDropdownOpen ? 'rotate-180' : ''}`}></i>
              </button>

              {attendanceDropdownOpen && (
                <div className="flex flex-col gap-1 pl-4 pr-2 pt-1">
                  <Link
                    to="/admin/attendance"
                    className={`flex items-center px-4 py-2.5 rounded-xl ${
                      location.pathname === '/admin/attendance' ? 'bg-accent text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <i className="ti ti-list-details text-lg"></i>
                    <span className="ml-3 text-sm font-medium">Daily Logs</span>
                  </Link>
                  <Link
                    to="/admin/attendance/calendar"
                    className={`flex items-center px-4 py-2.5 rounded-xl ${
                      location.pathname === '/admin/attendance/calendar' ? 'bg-accent text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <i className="ti ti-calendar text-lg"></i>
                    <span className="ml-3 text-sm font-medium">Calendar View</span>
                  </Link>
                  {isOfflineFeatureActive && (
                    <Link
                      to="/admin/attendance/offline"
                      className={`flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${
                        location.pathname === '/admin/attendance/offline'
                          ? 'bg-accent text-white shadow-md font-bold'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center min-w-0">
                        <i className="ti ti-device-watch text-lg shrink-0"></i>
                        <span className="ml-3 text-sm font-medium truncate">Offline Captures</span>
                      </div>
                      {offlinePendingCount > 0 && (
                        <span className="ml-2 px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                          {offlinePendingCount}
                        </span>
                      )}
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Top workspace items: Employees, Payroll Ledger */}
            {topAdminNavItems.map(item => (
              <Link
                key={item.label}
                to={item.route}
                className={`flex items-center px-4 py-3.5 rounded-2xl mt-1 ${
                  location.pathname.startsWith(item.route)
                    ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <i className={`ti ${item.icon} text-xl`}></i>
                <span className="ml-3 font-medium tracking-wide">{item.label}</span>
              </Link>
            ))}

            {/* Leave Requests Submenu Dropdown */}
            <div className="space-y-1 mt-1">
              <button
                type="button"
                onClick={() => setLeavesDropdownOpen(!leavesDropdownOpen)}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl cursor-pointer transition-colors ${
                  isLeavesPath ? 'bg-slate-800/50 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <div className="flex items-center min-w-0">
                  <i className={`ti ti-plane-departure text-xl shrink-0 ${isLeavesPath ? 'text-accent' : ''}`}></i>
                  <span className="ml-3 font-medium tracking-wide truncate">Leave Requests</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {totalPendingLeaves > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-warning/20 text-warning border border-warning/30 tabular-nums">
                      {totalPendingLeaves}
                    </span>
                  )}
                  <i className={`ti ti-chevron-down text-sm transition-transform duration-200 ${leavesDropdownOpen ? 'rotate-180' : ''}`}></i>
                </div>
              </button>

              {leavesDropdownOpen && (
                <div className="flex flex-col gap-1 pl-4 pr-2 pt-1">
                  <Link
                    to="/admin/leaves"
                    className={`flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${
                      isApprovalsActive
                        ? 'bg-accent text-white shadow-md font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center min-w-0">
                      <i className="ti ti-calendar text-lg shrink-0"></i>
                      <span className="ml-3 text-sm font-medium truncate">Leave Approvals</span>
                    </div>
                    {(leaveCounts?.pendingLeaves || 0) > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                        isApprovalsActive
                          ? 'bg-white/20 text-white'
                          : 'bg-warning/20 text-warning border border-warning/30'
                      }`}>
                        {leaveCounts.pendingLeaves}
                      </span>
                    )}
                  </Link>

                  <Link
                    to="/admin/leaves?tab=cashouts"
                    className={`flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors ${
                      isCashoutsActive
                        ? 'bg-accent text-white shadow-md font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center min-w-0">
                      <i className="ti ti-cash text-lg shrink-0"></i>
                      <span className="ml-3 text-sm font-medium truncate">SIL Cash-Outs</span>
                    </div>
                    {(leaveCounts?.pendingCash || 0) > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                        isCashoutsActive
                          ? 'bg-white/20 text-white'
                          : 'bg-accent/20 text-accent border border-accent/30'
                      }`}>
                        {leaveCounts.pendingCash}
                      </span>
                    )}
                  </Link>

                  <Link
                    to="/admin/leaves?tab=sil-policy"
                    className={`flex items-center px-4 py-2.5 rounded-xl transition-colors ${
                      isPolicyActive
                        ? 'bg-accent text-white shadow-md font-bold'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <i className="ti ti-shield-check text-lg shrink-0"></i>
                    <span className="ml-3 text-sm font-medium truncate">Statutory SIL Policy</span>
                  </Link>
                </div>
              )}
            </div>

            {/* Bottom workspace items: Disciplinary, Audit Trail */}
            {bottomAdminNavItems.map(item => (
              <Link
                key={item.label}
                to={item.route}
                className={`flex items-center px-4 py-3.5 rounded-2xl mt-1 ${
                  location.pathname.startsWith(item.route)
                    ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <i className={`ti ${item.icon} text-xl`}></i>
                <span className="ml-3 font-medium tracking-wide">{item.label}</span>
              </Link>
            ))}
          </>
        ) : (
          <div className="space-y-1">
            <Link
              to="/employee/profile"
              className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${
                location.pathname === '/employee/profile' || location.pathname === '/profile'
                  ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
              }`}
            >
              <i className="ti ti-user-circle text-xl"></i>
              <span className="ml-3 font-medium tracking-wide">Profile</span>
            </Link>

            {isSecurity(user) && (
              <Link
                to="/scanner"
                className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${
                  location.pathname === '/scanner'
                    ? 'bg-accent text-white shadow-lg shadow-accent/20 font-bold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <i className="ti ti-scan text-xl"></i>
                <span className="ml-3 font-medium tracking-wide">Gate Scanner</span>
              </Link>
            )}
          </div>
        )}
      </nav>

      {/* User profile */}
      <div className="p-4 mt-auto border-t border-slate-800 bg-slate-950/40 rounded-b-2xl shrink-0">
        <Link
          to={isAdmin(user) ? "/profile" : "/employee/profile"}
          className="flex items-center p-3 rounded-xl mb-2 cursor-pointer hover:bg-white/5 transition-colors"
        >
          <div className="relative shrink-0">
            <EmployeeAvatar employee={user} size="h-10 w-10" rounded="rounded-xl" theme="dark" border="border border-slate-700" />
          </div>
          <div className="ml-3 overflow-hidden min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate hover:text-accent">
              {user?.name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Employee'}
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold truncate mt-0.5">
              {user?.job_title || user?.department || user?.role || 'Staff'}
            </p>
          </div>
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center px-4 py-2.5 text-xs font-bold text-danger-ink bg-danger/10 rounded-xl hover:text-white hover:bg-danger transition-all cursor-pointer"
        >
          <i className="ti ti-power mr-2 text-base"></i> Sign Out
        </button>
      </div>
    </aside>
  );
};

export default React.memo(Sidebar);
