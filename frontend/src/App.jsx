import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate, Outlet } from 'react-router-dom';
import { supabase } from './supabaseClient';
import toast, { Toaster } from 'react-hot-toast';
import { fetchWithAuth } from './utils/api';

// Auth Pages
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ForcePasswordChange from './pages/ForcePasswordChange';
import BiometricSetup from './pages/BiometricSetup';
import VerifyEmail from './pages/VerifyEmail';

// Lazy Loaded Core Flow Pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const EmployeeDashboard = lazy(() => import('./pages/EmployeeDashboard'));

// Heavy Scanner (Lazy Loaded for gate terminal only)
const Scanner = lazy(() => import('./pages/Scanner'));

// Admin / Attendance
const AttendanceIndex = lazy(() => import('./pages/admin/attendance/Index'));
const AttendanceCalendar = lazy(() => import('./pages/admin/attendance/Calendar'));

// Admin / Employees
const EmployeeIndex = lazy(() => import('./pages/admin/employees/Index'));
const EmployeeCreate = lazy(() => import('./pages/admin/employees/Create'));
const EmployeeEdit = lazy(() => import('./pages/admin/employees/Edit'));
const EmployeeShow = lazy(() => import('./pages/admin/employees/Show'));
const Documents = lazy(() => import('./pages/admin/documents/Documents'));
const EmployeeQrPrint = lazy(() => import('./pages/admin/employees/QrPrint'));

// Admin / Payroll
const StatutorySettings = lazy(() => import('./pages/admin/payroll/StatutorySettings'));
const PayrollIndex = lazy(() => import('./pages/admin/payroll/Index'));
const PayrollCreate = lazy(() => import('./pages/admin/payroll/Create'));
const PayrollShow = lazy(() => import('./pages/admin/payroll/Show'));

// Admin / Audit Logs
const AuditLogsIndex = lazy(() => import('./pages/admin/audit-logs/Index'));

// Admin / Leaves
const LeavesIndex = lazy(() => import('./pages/admin/leaves/Index'));

// Admin / Disciplinary
const DisciplinaryIndex = lazy(() => import('./pages/admin/disciplinary/Index'));

// Employee
const MyQr = lazy(() => import('./pages/employee/MyQr'));
const EmployeeScanner = lazy(() => import('./pages/employee/Scanner'));
const MyProfile = lazy(() => import('./pages/employee/MyProfile'));

import { isPushSupported, getNotificationPermission, subscribeUserToPush, sendTestPush } from './utils/pushNotifications';
import { SpeedInsights } from '@vercel/speed-insights/react';

import './index.css';

const getRole = (user) => (user?.role || '').toLowerCase();
const isSecurity = (user) => {
  const r = getRole(user);
  return r === 'security' || r === 'guard' || r === 'security_guard';
};
const isAdmin = (user) => {
  const r = getRole(user);
  return r === 'admin' || r === 'superadmin' || r === 'hr';
};

const getUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return (raw && raw !== 'undefined') ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// Route Guard: Protected Routes
const ProtectedRoute = ({ children, allowedRoles = null, requireBiometrics = false }) => {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.requires_password_change) {
    return <Navigate to="/force-password-change" replace />;
  }

  if (requireBiometrics && !user.has_registered_biometrics && !isSecurity(user) && !isAdmin(user)) {
    return <Navigate to="/biometric-setup" replace />;
  }

  if (allowedRoles) {
    const role = getRole(user);
    const hasRole = allowedRoles.some(r => r.toLowerCase() === role);
    if (!hasRole) {
      if (isSecurity(user)) return <Navigate to="/scanner" replace />;
      if (isAdmin(user)) return <Navigate to="/" replace />;
      return <Navigate to="/employee/dashboard" replace />;
    }
  }

  return children;
};

// Route Guard: Public-Only Routes (Redirects already authenticated users)
const PublicOnlyRoute = ({ children }) => {
  const user = getUser();
  if (user) {
    if (user.requires_password_change) return <Navigate to="/force-password-change" replace />;
    if (!user.has_registered_biometrics && !isSecurity(user) && !isAdmin(user)) return <Navigate to="/biometric-setup" replace />;
    if (isSecurity(user)) return <Navigate to="/scanner" replace />;
    if (isAdmin(user)) return <Navigate to="/" replace />;
    return <Navigate to="/employee/dashboard" replace />;
  }
  return children;
};

// Root Router: Dispatches user to their respective dashboard
const RootRoute = () => {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.requires_password_change) return <Navigate to="/force-password-change" replace />;
  if (!user.has_registered_biometrics && !isSecurity(user) && !isAdmin(user)) return <Navigate to="/biometric-setup" replace />;
  if (isSecurity(user)) return <Navigate to="/scanner" replace />;
  if (isAdmin(user)) return <Dashboard />;
  return <Navigate to="/employee/dashboard" replace />;
};

const getPageTitle = (pathname) => {
  if (pathname === '/') return 'Dashboard';

  // Payroll Routes
  if (pathname === '/admin/payroll/statutory-settings') return 'Statutory Settings';
  if (pathname === '/admin/payroll') return 'Payroll Ledger';
  if (pathname === '/admin/payroll/process') return 'Payroll Calculator';
  if (pathname.startsWith('/admin/payroll/')) return 'Payslip Details';

  // Employee Routes
  if (pathname === '/admin/employees') return 'Employee Directory';
  if (pathname === '/admin/employees/create') return 'Add New Employee';
  if (pathname.startsWith('/admin/employees/') && pathname.endsWith('/edit')) return 'Edit Employee';
  if (pathname.startsWith('/admin/employees/') && pathname.endsWith('/qr')) return 'Employee QR Pass';
  if (pathname.startsWith('/admin/employees/')) return 'Employee Profile';

  // Attendance Routes
  if (pathname === '/admin/attendance') return 'Attendance Logs';
  if (pathname === '/admin/attendance/calendar') return 'Attendance Calendar';

  // Other Admin Routes
  if (pathname === '/admin/leaves') return 'Leave Requests';
  if (pathname === '/admin/disciplinary') return 'Disciplinary Records';
  if (pathname === '/admin/audit-logs') return 'Audit Trail';

  // Employee Routes
  if (pathname === '/employee/dashboard') return 'Employee Portal';
  if (pathname === '/employee/qr') return 'My Digital QR';
  if (pathname === '/employee/scanner') return 'Self Scanner';
  if (pathname === '/employee/profile') return 'My Profile';

  const segment = pathname.split('/').filter(Boolean).pop() || 'Dashboard';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(segment)) {
    return 'Details';
  }
  return segment.replace(/-/g, ' ');
};

// Notification chime synthesizer
const playNotificationChime = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;
    // Note 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Note 2: A5 (880.00 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.08);
    gain2.gain.setValueAtTime(0.18, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.55);
  } catch (err) {
    // Audio autostart might be blocked if user has not interacted with DOM yet
  }
};

// Category Icon, Color & Route Mapping Helper
const getNotificationVisuals = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'payroll':
      return {
        icon: 'ti-cash-banknote',
        bg: 'bg-emerald-50 text-emerald-600 border-emerald-200/80',
        badge: 'bg-emerald-500',
        label: 'Payroll',
        path: '/admin/payroll'
      };
    case 'leave':
      return {
        icon: 'ti-plane-departure',
        bg: 'bg-blue-50 text-blue-600 border-blue-200/80',
        badge: 'bg-blue-500',
        label: 'Leave',
        path: '/admin/leaves'
      };
    case 'shift':
      return {
        icon: 'ti-calendar-time',
        bg: 'bg-purple-50 text-purple-600 border-purple-200/80',
        badge: 'bg-purple-500',
        label: 'Schedule',
        path: '/employee/dashboard'
      };
    case 'disciplinary':
    case 'warning':
      return {
        icon: 'ti-alert-triangle',
        bg: 'bg-amber-50 text-amber-600 border-amber-200/80',
        badge: 'bg-amber-500',
        label: 'Notice',
        path: '/admin/disciplinary'
      };
    case 'attendance':
      return {
        icon: 'ti-clock-check',
        bg: 'bg-teal-50 text-teal-600 border-teal-200/80',
        badge: 'bg-teal-500',
        label: 'Attendance',
        path: '/admin/attendance'
      };
    default:
      return {
        icon: 'ti-bell',
        bg: 'bg-slate-100 text-slate-600 border-slate-200',
        badge: 'bg-blue-500',
        label: 'General',
        path: '/'
      };
  }
};

// Extract or generate employee profile picture / initials with rich employee database matching
const getNotificationAvatar = (notif, employeeMap) => {
  let initials = 'CP';
  let avatarSrc = notif.sender_avatar || null;

  let matchedEmp = null;
  if (employeeMap && employeeMap.size > 0) {
    if (notif.sender_id && employeeMap.has(notif.sender_id)) {
      matchedEmp = employeeMap.get(notif.sender_id);
    } else if (notif.target && employeeMap.has(notif.target)) {
      matchedEmp = employeeMap.get(notif.target);
    } else {
      // Match by full name in title or text
      for (const [key, emp] of employeeMap.entries()) {
        if (typeof key === 'string' && key.includes(' ')) {
          if (
            (notif.title && notif.title.toLowerCase().includes(key)) ||
            (notif.text && notif.text.toLowerCase().includes(key))
          ) {
            matchedEmp = emp;
            break;
          }
        }
      }
    }
  }

  if (matchedEmp) {
    if (matchedEmp.avatar_url) {
      avatarSrc = matchedEmp.avatar_url;
    } else if (matchedEmp.biometric_baseline_path) {
      avatarSrc = matchedEmp.biometric_baseline_path.startsWith('http')
        ? matchedEmp.biometric_baseline_path
        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${matchedEmp.biometric_baseline_path.replace(/^\/+/, '')}`;
    }

    if (matchedEmp.first_name) {
      const f = matchedEmp.first_name[0] || '';
      const l = (matchedEmp.last_name && matchedEmp.last_name[0]) || '';
      initials = (f + l).toUpperCase() || 'CP';
    }
  }

  if (initials === 'CP') {
    if (notif.sender_name) {
      const parts = notif.sender_name.trim().split(' ').filter(Boolean);
      initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    } else if (notif.title && notif.title.includes(':')) {
      const namePart = notif.title.split(':')[1]?.trim() || '';
      const parts = namePart.split(' ').filter(Boolean);
      if (parts.length > 0) {
        initials = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
      }
    } else if (notif.text) {
      const match = notif.text.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
      if (match) {
        const parts = match[1].split(' ');
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
      }
    }
  }

  return { avatarSrc, initials };
};

const notifAvatarCache = new Map();

const NotificationAvatar = ({ avatarSrc, initials, visuals, size = 'h-11 w-11', textClass = 'text-sm', badgeClass = 'h-4 w-4 text-[9px] -bottom-1 -right-1', ringClass = 'ring-1 ring-slate-900' }) => {
  const initialStatus = avatarSrc ? notifAvatarCache.get(avatarSrc) : null;
  const [status, setStatus] = useState(() => initialStatus || 'loading');

  useEffect(() => {
    if (!avatarSrc) {
      setStatus('failed');
      return;
    }
    const cached = notifAvatarCache.get(avatarSrc);
    if (cached) setStatus(cached);
    else setStatus('loading');
  }, [avatarSrc]);

  const handleLoad = () => {
    if (avatarSrc) notifAvatarCache.set(avatarSrc, 'loaded');
    setStatus('loaded');
  };

  const handleError = () => {
    if (avatarSrc) notifAvatarCache.set(avatarSrc, 'failed');
    setStatus('failed');
  };

  const isLoaded = status === 'loaded';
  const isFailed = status === 'failed';

  return (
    <div className={`relative ${size} shrink-0`}>
      <div className={`w-full h-full rounded-xl flex items-center justify-center font-black ${textClass} shadow-inner select-none ${visuals.bg}`}>
        {initials}
      </div>
      {avatarSrc && !isFailed && (
        <img
          src={avatarSrc}
          onLoad={handleLoad}
          onError={handleError}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover rounded-xl ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          } ${isLoaded ? '' : 'transition-opacity duration-150'}`}
        />
      )}
      <span className={`absolute ${badgeClass} rounded-full flex items-center justify-center text-white shadow-sm ${ringClass} ${visuals.badge}`}>
        <i className={`ti ${visuals.icon}`} />
      </span>
    </div>
  );
};

function MainLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Current user from localStorage
  const [user] = useState(() => JSON.parse(localStorage.getItem('user')) || { name: 'Admin User', role: 'admin' });

  const isAttendanceActive = location.pathname.includes('/admin/attendance');
  const [attendanceDropdownOpen, setAttendanceDropdownOpen] = useState(isAttendanceActive);

  // Header state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [employeeMap, setEmployeeMap] = useState(new Map());

  const searchContainerRef = useRef(null);
  const notificationsContainerRef = useRef(null);

  // Load employee directory for avatar lookup
  useEffect(() => {
    supabase
      .from('employees')
      .select('id, company_id, first_name, last_name, biometric_baseline_path')
      .then(({ data }) => {
        if (Array.isArray(data)) {
          const map = new Map();
          data.forEach(emp => {
            map.set(emp.id, emp);
            if (emp.first_name && emp.last_name) {
              const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
              map.set(fullName, emp);
            }
          });
          setEmployeeMap(map);
        }
      });
  }, []);

  // PWA Install State & Platform Detection
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [browserType, setBrowserType] = useState('other'); // 'samsung', 'ios', 'chrome_android', 'desktop'
  const [pushStatus, setPushStatus] = useState(() => getNotificationPermission());

  useEffect(() => {
    if (user?.id && getNotificationPermission() === 'granted') {
      subscribeUserToPush(user.id, true).catch(() => {});
    }
  }, [user?.id]);

  useEffect(() => {
    // Check if app is already running in standalone mode (PWA installed)
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');
    setIsStandalone(Boolean(isStandaloneMode));

    // Detect browser / OS platform
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      setBrowserType('ios');
    } else if (/samsungbrowser/.test(ua)) {
      setBrowserType('samsung');
    } else if (/android/.test(ua) && /chrome/.test(ua)) {
      setBrowserType('chrome_android');
    } else {
      setBrowserType('desktop');
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setShowInstallGuide(false);
      toast.success('C-Point HRIS installed to your Home Screen!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
          setIsStandalone(true);
          setShowInstallGuide(false);
          return;
        }
      } catch (err) {
        console.warn('[PWA] Native prompt error:', err);
      }
    }
    // Fallback: If native prompt wasn't triggered, show tailored browser guide
    setShowInstallGuide(true);
  };

  // Fetch initial notifications with Supabase fallback
  useEffect(() => {
    if (!user?.id) return;
    let isCancelled = false;

    const loadNotifications = async () => {
      try {
        const res = await fetchWithAuth(`/api/notifications?user_id=${user.id}&role=${user.role}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && !isCancelled) {
            setNotifications(data);
            return;
          }
        }
      } catch (err) {
        console.warn('[NOTIFICATIONS] API fetch fallback to direct Supabase query:', err);
      }

      // Supabase query fallback
      try {
        let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
        if (user.role === 'admin') {
          query = query.or(`target.eq.admin,target.eq.${user.id}`);
        } else {
          query = query.eq('target', user.id);
        }
        const { data } = await query;
        if (Array.isArray(data) && !isCancelled) {
          setNotifications(data);
        }
      } catch (dbErr) {
        console.error('[NOTIFICATIONS] Direct DB query error:', dbErr);
      }
    };

    loadNotifications();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  const searchIndex = isAdmin(user) ? [
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
  ] : isSecurity(user) ? [
    { label: 'Gate Terminal Scanner', route: '/scanner', icon: 'ti-scan' },
    { label: 'My Profile', route: '/profile', icon: 'ti-user-circle' },
  ] : [
    { label: 'My Portal', route: '/employee/dashboard', icon: 'ti-smart-home' },
    { label: 'My Digital Pass (QR)', route: '/employee/qr', icon: 'ti-qrcode' },
    { label: 'My Profile', route: '/profile', icon: 'ti-user-circle' },
  ];

  const filteredSearch = searchQuery ? searchIndex.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase())) : [];

  useEffect(() => {
    setSidebarOpen(false);
    setShowSearch(false);
    setShowNotifications(false);
    setSearchQuery('');
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowSearch(false);
      }
      if (notificationsContainerRef.current && !notificationsContainerRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowSearch(false);
        setShowNotifications(false);
        setSidebarOpen(false);
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

  const handleNotificationClick = async (notif) => {
    // Optimistically mark as read locally
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
    setShowNotifications(false);

    try {
      await fetchWithAuth('/api/notifications/read-all', {
        method: 'PUT',
        body: JSON.stringify({ user_id: user?.id, role: user?.role })
      });
    } catch (err) {
      // fallback silently
    }

    const visuals = getNotificationVisuals(notif.type);
    let targetPath = visuals.path;

    const isAdmin = ['admin', 'superadmin', 'hr'].includes((user?.role || '').toLowerCase());

    if (!isAdmin) {
      if (notif.type === 'disciplinary' || notif.type === 'warning') {
        targetPath = '/employee/dashboard?view=disciplinary';
        window.dispatchEvent(new CustomEvent('open_disciplinary_modal', { detail: notif }));
      } else {
        targetPath = '/employee/dashboard';
      }
    }

    navigate(targetPath);
  };

  // Real-time notification listener
  useEffect(() => {
    if (!user || !user.id) return;

    const broadcastChannel = supabase
      .channel('system-notifications')
      .on('broadcast', { event: 'NEW_NOTIFICATION' }, (payload) => {
        const notif = payload.payload;
        // Check if notif is for me
        if (notif.target === user.id || (user.role === 'admin' && notif.target === 'admin')) {
          playNotificationChime();
          const visuals = getNotificationVisuals(notif.type);
          const avatar = getNotificationAvatar(notif, employeeMap);

          toast.custom((t) => (
            <div
              onClick={() => { toast.dismiss(t.id); handleNotificationClick(notif); }}
              className="max-w-md w-full bg-slate-900 shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-white/10 p-4 gap-3.5 cursor-pointer hover:bg-slate-800 border border-slate-700/50"
            >
              <NotificationAvatar
                avatarSrc={avatar.avatarSrc}
                initials={avatar.initials}
                visuals={visuals}
                size="h-11 w-11"
                textClass="text-sm"
                badgeClass="h-4 w-4 text-[9px] -bottom-1 -right-1"
                ringClass="ring-1 ring-slate-900"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/10 text-white">
                    {visuals.label}
                  </span>
                  <p className="text-xs font-bold text-slate-200 truncate">{notif.title || 'System Notification'}</p>
                </div>
                <p className="text-xs text-slate-300 font-medium mt-1 leading-snug">{notif.text}</p>
              </div>
            </div>
          ), { duration: 6000 });

          setNotifications(prev => [notif, ...prev]);

          // Broadcast global refresh events for immediate UI table sync
          window.dispatchEvent(new Event('refresh_dashboard'));
          window.dispatchEvent(new Event('refresh_leaves'));
          window.dispatchEvent(new Event('refresh_attendance'));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, [user]);

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetchWithAuth('/api/notifications/read-all', {
        method: 'PUT',
        body: JSON.stringify({ user_id: user.id, role: user.role })
      });
    } catch (err) { console.error(err); }
  };

  const [currentDate, setCurrentDate] = useState(() => new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDate(new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('user');
    window.location.href = '/login';
  };

  return (
    <div className="font-sans antialiased bg-slate-50 text-slate-800 selection:bg-blue-500 selection:text-white relative overflow-x-hidden min-h-screen">

      {/* Desktop Sidebar (Only visible on PC / lg+ screens) */}
      <aside
        className="hidden lg:flex fixed inset-y-4 left-4 z-50 w-72 rounded-[2rem] glass-sidebar text-slate-300 flex-col shadow-2xl shadow-slate-900/20 bg-slate-900"
      >
        {/* Logo */}
        <div className="flex items-center h-24 px-8 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-4 cursor-pointer">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20">CP</div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide">C-Point</h1>
              <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5">HRIS</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 mt-6 px-4 space-y-1.5 overflow-y-auto pb-6 custom-scrollbar">
          <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Overview</p>

          {isAdmin(user) ? (
            <Link to="/" className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${location.pathname === '/' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 font-bold' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'}`}>
              <i className="ti ti-smart-home text-xl"></i>
              <span className="ml-3 font-medium tracking-wide">Dashboard</span>
            </Link>
          ) : (
            <>
              <Link 
                to="/employee/dashboard" 
                className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors ${
                  location.pathname === '/employee/dashboard' || location.pathname === '/' 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 font-bold' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <i className="ti ti-smart-home text-xl"></i>
                <span className="ml-3 font-medium tracking-wide">My Portal</span>
              </Link>

              <Link 
                to="/employee/qr" 
                className={`flex items-center px-4 py-3.5 rounded-2xl transition-colors mt-1 ${
                  location.pathname === '/employee/qr' 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 font-bold' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/30'
                }`}
              >
                <i className="ti ti-qrcode text-xl"></i>
                <span className="ml-3 font-medium tracking-wide">Digital Pass (QR)</span>
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
                  onClick={() => setAttendanceDropdownOpen(!attendanceDropdownOpen)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl ${isAttendanceActive ? 'bg-slate-800/50 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'}`}
                >
                  <div className="flex items-center">
                    <i className={`ti ti-clock-hour-4 text-xl ${isAttendanceActive ? 'text-blue-400' : ''}`}></i>
                    <span className="ml-3 font-medium tracking-wide">Time & Attendance</span>
                  </div>
                  <i className={`ti ti-chevron-down text-sm ${attendanceDropdownOpen ? 'rotate-180' : ''}`}></i>
                </button>

                {attendanceDropdownOpen && (
                  <div className="flex flex-col gap-1 pl-4 pr-2 pt-1">
                    <Link to="/admin/attendance" className={`flex items-center px-4 py-2.5 rounded-xl ${location.pathname === '/admin/attendance' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                      <i className="ti ti-list-details text-lg"></i>
                      <span className="ml-3 text-sm font-medium">Daily Logs</span>
                    </Link>
                    <Link to="/admin/attendance/calendar" className={`flex items-center px-4 py-2.5 rounded-xl ${location.pathname === '/admin/attendance/calendar' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                      <i className="ti ti-calendar text-lg"></i>
                      <span className="ml-3 text-sm font-medium">Calendar View</span>
                    </Link>
                  </div>
                )}
              </div>

              {/* Nav links */}
              {[
                { route: '/admin/employees', icon: 'ti-users-group', label: 'Employees' },
                { route: '/admin/payroll', icon: 'ti-wallet', label: 'Payroll Ledger' },
                { route: '/admin/leaves', icon: 'ti-plane-departure', label: 'Leave Approvals' },
                { route: '/admin/disciplinary', icon: 'ti-gavel', label: 'Disciplinary' },
                { route: '/admin/audit-logs', icon: 'ti-history', label: 'Audit Trail' }
              ].map(item => (
                <Link key={item.label} to={item.route} className={`flex items-center px-4 py-3.5 rounded-2xl mt-1 ${location.pathname.startsWith(item.route) ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:text-white'}`}>
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
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 font-bold' 
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
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 font-bold' 
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
        <div className="p-4 mt-auto border-t border-white/5 bg-slate-900/40 rounded-b-[2rem] shrink-0">
          <Link to={isAdmin(user) ? "/profile" : "/employee/profile"} className="flex items-center p-3 rounded-2xl mb-2 cursor-pointer hover:bg-white/5 transition-colors">
            <div className="relative shrink-0">
              <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md">
                {user.name ? user.name.charAt(0).toUpperCase() : (user.first_name ? user.first_name.charAt(0).toUpperCase() : '?')}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-emerald-500 border-2 border-slate-900 rounded-full"></span>
            </div>
            <div className="ml-3 overflow-hidden min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate hover:text-blue-400">{user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Employee'}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold truncate mt-0.5">{user.job_title || user.department || user.role || 'Staff'}</p>
            </div>
          </Link>
          <button onClick={handleLogout} className="w-full flex items-center justify-center px-4 py-2.5 text-xs font-bold text-rose-400 bg-rose-500/10 rounded-xl hover:text-white hover:bg-rose-600 transition-all cursor-pointer">
            <i className="ti ti-power mr-2 text-base"></i> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen w-full lg:pl-[320px]">
        <div className="flex flex-col flex-1 w-full max-w-7xl mx-auto">

          {/* Header */}
          <header className="flex items-center justify-between px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-3 sm:py-3.5 sticky top-0 sm:top-4 z-30 bg-white/90 sm:bg-white/70 backdrop-blur-xl shadow-xs sm:shadow-sm border-b sm:border border-slate-200/70 sm:border-slate-200/60 sm:rounded-2xl sm:mx-4 lg:mx-8 touch-none select-none overscroll-none">
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
                <p className="text-[11px] text-slate-400 font-medium hidden sm:block mt-0.5">{currentDate}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 relative">

              {/* Search Container with click-outside Ref */}
              <div ref={searchContainerRef} className="relative">
                {/* Mobile Quick Search Button */}
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className="md:hidden p-2 text-slate-500 hover:text-blue-600 tap-active bg-slate-100/80 rounded-xl h-9 w-9 flex items-center justify-center"
                  aria-label="Search"
                >
                  <i className="ti ti-search text-lg"></i>
                </button>

                {/* Desktop Search */}
                <div className="relative hidden md:block">
                  <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); setShowNotifications(false); }}
                    onFocus={() => { setShowSearch(true); setShowNotifications(false); }}
                    placeholder="Search everywhere..."
                    className="pl-8 pr-8 py-1.5 bg-slate-100/90 border-none rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 w-60 transition-all focus:w-72 font-medium text-slate-700"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => { setSearchQuery(''); setShowSearch(false); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
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
                        onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                        className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"
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
                      {filteredSearch.length > 0 ? filteredSearch.map(item => (
                        <Link
                          key={item.route}
                          to={item.route}
                          onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                          className="flex items-center gap-3 p-2.5 hover:bg-blue-50/50 transition-colors cursor-pointer group"
                        >
                          <div className="h-7 w-7 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <i className={`ti ${item.icon} text-sm`}></i>
                          </div>
                          <span className="text-xs font-bold text-slate-700">{item.label}</span>
                        </Link>
                      )) : (
                        <div className="p-4 text-center text-xs text-slate-500 font-bold">
                          {searchQuery ? `No results found for "${searchQuery}"` : 'Type above to search...'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Notification Container with click-outside Ref */}
              <div ref={notificationsContainerRef} className="relative">
                {/* Notifications Bell */}
                <button
                  onClick={() => { setShowNotifications(!showNotifications); setShowSearch(false); }}
                  className={`relative p-2 transition-all rounded-xl tap-active shadow-xs border border-slate-200/50 h-9 w-9 flex items-center justify-center ${showNotifications ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 bg-slate-100/80'}`}
                  aria-label="View Notifications"
                >
                  <i className="ti ti-bell text-lg"></i>
                  {notifications.some(n => !n.read) && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full border-2 border-white shadow-xs"></span>
                  )}
                </button>

                {/* Notification panel */}
                {showNotifications && (
                  <div className="fixed inset-x-4 top-16 sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-3 sm:w-96 bg-white border border-slate-200/80 rounded-2xl shadow-2xl overflow-hidden z-50">
                    <div className="p-3.5 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-800 text-xs sm:text-sm">Notifications</h3>
                        {notifications.filter(n => !n.read).length > 0 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-black rounded-full bg-blue-500 text-white">
                            {notifications.filter(n => !n.read).length} new
                          </span>
                        )}
                      </div>
                      <button
                        onClick={markAllRead}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline uppercase tracking-wider"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 touch-scroll">
                      {notifications.length > 0 ? notifications.map(notif => {
                        const visuals = getNotificationVisuals(notif.type);
                        const avatar = getNotificationAvatar(notif, employeeMap);
                        return (
                          <div
                            key={notif.id}
                            onClick={() => handleNotificationClick(notif)}
                            className={`p-3.5 hover:bg-slate-50/80 transition-colors flex items-start gap-3 cursor-pointer ${!notif.read ? 'bg-blue-50/30' : ''}`}
                          >
                            <NotificationAvatar
                              avatarSrc={avatar.avatarSrc}
                              initials={avatar.initials}
                              visuals={visuals}
                              size="h-9 w-9"
                              textClass="text-xs"
                              badgeClass="h-3.5 w-3.5 text-[8px] -bottom-1 -right-1"
                              ringClass="ring-1 ring-white"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                  {visuals.label}
                                </span>
                                <p className="text-xs font-bold text-slate-800 truncate">{notif.title || 'System Alert'}</p>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
                                {notif.text}
                              </p>
                            </div>
                            {!notif.read ? (
                              <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0 shadow-xs" />
                            ) : (
                              <i className="ti ti-chevron-right text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity mt-1.5 text-xs" />
                            )}
                          </div>
                        );
                      }) : (
                        <div className="p-8 text-center flex flex-col items-center opacity-60">
                          <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                            <i className="ti ti-bell-off text-xl text-slate-400"></i>
                          </div>
                          <span className="text-xs font-bold text-slate-500">No notifications yet</span>
                          <p className="text-[10px] text-slate-400 mt-0.5">You're all caught up!</p>
                        </div>
                      )}
                    </div>

                    {/* Native Phone Lock-Screen Push Notifications Banner */}
                    <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <i className="ti ti-device-mobile-message text-sm"></i>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-800 leading-none">Phone Push Alerts</p>
                          <p className="text-[9px] text-slate-500 font-medium truncate mt-0.5">Lock-screen notifications</p>
                        </div>
                      </div>

                      {pushStatus === 'granted' ? (
                        <button
                          onClick={async () => {
                            await sendTestPush(user.id);
                          }}
                          className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[10px] font-bold rounded-lg shadow-2xs transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                          title="Send a test notification to your phone"
                        >
                          <i className="ti ti-bell-ringing text-blue-600"></i>
                          Test Buzz
                        </button>
                      ) : (
                        <button
                          onClick={async () => {
                            const res = await subscribeUserToPush(user.id);
                            if (res.success) setPushStatus('granted');
                          }}
                          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg shadow-sm shadow-blue-600/30 transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          <i className="ti ti-bell-plus"></i>
                          Enable
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 p-3.5 sm:p-6 lg:p-8 mt-1 sm:mt-2 w-full relative pb-28 lg:pb-8">
            <Suspense fallback={
              <div className="flex items-center justify-center min-h-[50vh] w-full">
                <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
              </div>
            }>
              {children || <Outlet />}
            </Suspense>
          </main>

          {/* Mobile navigation dock */}
          <div className="lg:hidden fixed bottom-2.5 sm:bottom-4 inset-x-0 z-40 flex justify-center px-2 sm:px-4 pointer-events-none pb-[max(0.35rem,env(safe-area-inset-bottom))]">
            <nav className={`pointer-events-auto w-full ${user.role === 'admin' ? 'max-w-[460px]' : 'max-w-[320px] sm:max-w-[340px]'} bg-slate-900/90 backdrop-blur-2xl text-slate-400 border border-white/15 rounded-2xl sm:rounded-3xl shadow-2xl p-1 sm:p-1.5 flex items-center justify-between gap-0.5 sm:gap-1 shadow-slate-950/50 ring-1 ring-white/10`}>
              {user.role === 'admin' ? (
                <>
                  {[
                    { to: '/', label: 'Home', icon: 'ti-smart-home', exact: true },
                    { to: '/admin/employees', label: 'Staff', icon: 'ti-users-group' },
                    { to: '/admin/attendance', label: 'Logs', icon: 'ti-clock-hour-4' },
                    { to: '/admin/payroll', label: 'Payroll', icon: 'ti-wallet' },
                    { to: '/admin/leaves', label: 'Leaves', icon: 'ti-plane-departure' }
                  ].map(tab => {
                    const isActive = tab.exact
                      ? location.pathname === tab.to
                      : location.pathname.startsWith(tab.to);

                    return (
                      <Link
                        key={tab.to}
                        to={tab.to}
                        className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-0.5 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active ${isActive ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        title={tab.label}
                      >
                        {isActive && (
                          <div
                            className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40"
                          />
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
                    className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-0.5 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active ${sidebarOpen ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    title="More Apps"
                  >
                    {sidebarOpen && (
                      <div
                        className="absolute inset-0 bg-purple-600 rounded-xl sm:rounded-2xl shadow-md shadow-purple-500/40"
                      />
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
                      <div
                        className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40"
                      />
                    )}
                    <i className={`ti ti-smart-home text-lg sm:text-xl relative z-10 ${location.pathname === '/employee/dashboard' ? 'scale-110' : ''}`} />
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
                      {/* Circular action button */}
                      <div
                        className={`relative w-12 h-12 sm:w-13 sm:h-13 rounded-full flex items-center justify-center ring-4 ring-slate-900 transition-transform active:scale-95 ${
                          location.pathname === '/employee/qr'
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/40 border border-white/30'
                            : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 shadow-md border border-white/10'
                        }`}
                      >
                        <i className={`ti ti-qrcode text-xl sm:text-2xl ${location.pathname === '/employee/qr' ? 'scale-110' : ''}`} />
                      </div>

                      {/* Micro Label */}
                      <span className={`text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-1 font-bold ${
                        location.pathname === '/employee/qr' ? 'text-white font-black' : 'text-slate-400 group-hover:text-slate-200'
                      }`}>
                        QR Code
                      </span>
                    </Link>
                  </div>

                  {/* Right: Quick Navigation Menu */}
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-1 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl select-none tap-active transition-all ${
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
                className="absolute inset-0 bg-slate-950/75 backdrop-blur-md"
                onClick={() => setSidebarOpen(false)}
              />
              <div
                className="relative w-full max-w-lg bg-slate-900 border-t border-white/15 rounded-t-3xl p-5 text-white shadow-2xl z-10 max-h-[85vh] overflow-y-auto touch-scroll pb-24"
              >
                {/* Drag Pill Handle */}
                <div className="w-12 h-1.5 bg-slate-700/80 rounded-full mx-auto mb-4" />

                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-black tracking-tight text-white">System Tools & Modules</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Quick Launch Center</p>
                  </div>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white tap-active"
                    aria-label="Close Sheet"
                  >
                    <i className="ti ti-x text-sm" />
                  </button>
                </div>

                  {/* PWA Install Banner (Discreetly visible for Admins only when not installed) */}
                  {user?.role === 'admin' && !isStandalone && (
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
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl shadow-md shadow-blue-600/30 shrink-0 tap-active flex items-center gap-1"
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

          {/* Universal PWA Installation Guide Modal (Samsung Internet, Chrome, iOS Safari, Desktop) */}
          {showInstallGuide && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                onClick={() => setShowInstallGuide(false)}
              />
              <div
                className="relative w-full max-w-md bg-slate-900 border border-white/15 rounded-3xl p-5 sm:p-6 text-white shadow-2xl z-10 space-y-4 max-h-[90vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center font-black text-base text-white shadow-lg shadow-blue-500/30 shrink-0">
                      CP
                    </div>
                    <div>
                      <h4 className="text-sm sm:text-base font-black tracking-tight">Install C-Point HRIS</h4>
                      <p className="text-[10px] text-blue-300 font-bold uppercase tracking-wider">Fast Fullscreen App</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowInstallGuide(false)}
                    className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white tap-active"
                    aria-label="Close modal"
                  >
                    <i className="ti ti-x text-base" />
                  </button>
                </div>

                {/* Direct Native Install Prompt (If available) */}
                {deferredPrompt && (
                  <button
                    onClick={handleInstallApp}
                    className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs sm:text-sm rounded-2xl shadow-lg shadow-blue-600/30 tap-active flex items-center justify-center gap-2"
                  >
                    <i className="ti ti-download text-base" /> 1-Tap Quick Install
                  </button>
                )}

                {/* Browser Selector Tabs */}
                <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                  <button
                    onClick={() => setBrowserType('samsung')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold ${browserType === 'samsung' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Samsung
                  </button>
                  <button
                    onClick={() => setBrowserType('chrome_android')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold ${browserType === 'chrome_android' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Chrome
                  </button>
                  <button
                    onClick={() => setBrowserType('ios')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold ${browserType === 'ios' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    iPhone / iPad
                  </button>
                  <button
                    onClick={() => setBrowserType('desktop')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold ${browserType === 'desktop' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    PC / Mac
                  </button>
                </div>

                {/* Step Instructions by Browser */}
                <div className="space-y-2.5 bg-white/5 p-4 rounded-2xl border border-white/5 text-xs text-slate-300">
                  {browserType === 'samsung' && (
                    <>
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                        <i className="ti ti-brand-android text-base" /> Samsung Internet Browser Steps:
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                        <p>Tap the <span className="font-bold text-white inline-flex items-center gap-1"><i className="ti ti-menu-2 inline text-sm text-blue-400" /> Menu</span> button at the bottom right corner.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                        <p>Tap <span className="font-bold text-white inline-flex items-center gap-1"><i className="ti ti-plus inline text-sm text-emerald-400" /> Add to Home screen</span> (or Install app).</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                        <p>Select <span className="font-bold text-white">Home screen</span> and tap <span className="font-bold text-white">Add</span>.</p>
                      </div>
                    </>
                  )}

                  {browserType === 'chrome_android' && (
                    <>
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                        <i className="ti ti-brand-chrome text-base" /> Google Chrome Android Steps:
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                        <p>Tap the <span className="font-bold text-white"><i className="ti ti-dots-vertical inline text-sm text-blue-400" /> Three Dots (⋮)</span> at the top right.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                        <p>Tap <span className="font-bold text-white"><i className="ti ti-download inline text-sm text-emerald-400" /> Install app</span> or <span className="font-bold text-white">Add to Home screen</span>.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                        <p>Confirm by tapping <span className="font-bold text-white">Install</span>.</p>
                      </div>
                    </>
                  )}

                  {browserType === 'ios' && (
                    <>
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                        <i className="ti ti-brand-apple text-base" /> Safari on iPhone / iPad Steps:
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                        <p>Tap the <span className="font-bold text-white"><i className="ti ti-share inline text-sm text-blue-400" /> Share</span> button at the bottom of Safari.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                        <p>Scroll down and tap <span className="font-bold text-white"><i className="ti ti-plus inline text-sm text-emerald-400" /> Add to Home Screen</span>.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                        <p>Tap <span className="font-bold text-white">Add</span> in the top right corner.</p>
                      </div>
                    </>
                  )}

                  {browserType === 'desktop' && (
                    <>
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                        <i className="ti ti-device-desktop text-base" /> Desktop (Chrome / Edge) Steps:
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                        <p>Look in the browser address bar on the right.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                        <p>Click the <span className="font-bold text-white"><i className="ti ti-download inline text-sm text-blue-400" /> Install C-Point HRIS</span> icon.</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                        <p>Click <span className="font-bold text-white">Install</span> to launch standalone window.</p>
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={() => setShowInstallGuide(false)}
                  className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl tap-active transition-all"
                >
                  Close Guide
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  // Global Biometric Photo & Avatar Protection (Anti-Save, Anti-Drag, Anti-New-Tab)
  useEffect(() => {
    const handleContextMenu = (e) => {
      if (
        e.target.tagName === 'IMG' ||
        e.target.closest('img') ||
        e.target.closest('[data-protected-photo]') ||
        e.target.closest('.protected-photo')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleDragStart = (e) => {
      if (e.target.tagName === 'IMG' || e.target.closest('img')) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
    document.addEventListener('dragstart', handleDragStart, { capture: true });

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      document.removeEventListener('dragstart', handleDragStart, { capture: true });
    };
  }, []);

  return (
    <Router>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            borderRadius: '9999px',
            background: 'rgba(15, 23, 42, 0.95)',
            color: '#fff',
            fontWeight: '700',
            padding: '12px 24px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            fontSize: '14px',
            letterSpacing: '-0.01em',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(12px)',
          },
          success: {
            iconTheme: {
              primary: '#34d399',
              secondary: '#064e3b',
            },
          },
          error: {
            iconTheme: {
              primary: '#f87171',
              secondary: '#7f1d1d',
            },
          },
        }}
      />
      <Routes>
        {/* Public / Auth */}
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route path="/forgot-password" element={<PublicOnlyRoute><ForgotPassword /></PublicOnlyRoute>} />
        <Route path="/reset-password" element={<PublicOnlyRoute><ResetPassword /></PublicOnlyRoute>} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Force Setup Routes */}
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="/biometric-setup" element={<ProtectedRoute><BiometricSetup /></ProtectedRoute>} />

        {/* Standalone Fullscreen Views */}
        <Route path="/scanner" element={
          <ProtectedRoute allowedRoles={['security', 'guard', 'security_guard', 'admin', 'superadmin', 'hr']}>
            <Suspense fallback={<div className="h-screen w-screen bg-black" />}><Scanner /></Suspense>
          </ProtectedRoute>
        } />
        <Route path="/admin/employees/:id/qr" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeQrPrint /></ProtectedRoute>} />

        {/* Authenticated Persistent Shell (Sidebar, Header, and Floating Dock NEVER unmount or flash) */}
        <Route element={<ProtectedRoute requireBiometrics><MainLayout /></ProtectedRoute>}>
          <Route path="/" element={<RootRoute />} />

          {/* Admin - Employees */}
          <Route path="/admin/employees" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeIndex /></ProtectedRoute>} />
          <Route path="/admin/employees/create" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeCreate /></ProtectedRoute>} />
          <Route path="/admin/employees/:id/edit" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeEdit /></ProtectedRoute>} />
          <Route path="/admin/employees/:id" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeShow /></ProtectedRoute>} />

          {/* Admin - Documents */}
          <Route path="/admin/documents" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><Documents /></ProtectedRoute>} />

          {/* Admin - Attendance */}
          <Route path="/admin/attendance" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><AttendanceIndex /></ProtectedRoute>} />
          <Route path="/admin/attendance/calendar" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><AttendanceCalendar /></ProtectedRoute>} />

          {/* Admin - Payroll */}
          <Route path="/admin/payroll/statutory-settings" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><StatutorySettings /></ProtectedRoute>} />
          <Route path="/admin/payroll" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><PayrollIndex /></ProtectedRoute>} />
          <Route path="/admin/payroll/process" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><PayrollCreate /></ProtectedRoute>} />
          <Route path="/admin/payroll/:id" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><PayrollShow /></ProtectedRoute>} />

          {/* Admin - Audit Logs */}
          <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><AuditLogsIndex /></ProtectedRoute>} />

          {/* Admin - Leaves */}
          <Route path="/admin/leaves" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><LeavesIndex /></ProtectedRoute>} />

          {/* Admin - Disciplinary */}
          <Route path="/admin/disciplinary" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><DisciplinaryIndex /></ProtectedRoute>} />

          {/* Employee Flow */}
          <Route path="/employee/dashboard" element={<EmployeeDashboard />} />
          <Route path="/employee/qr" element={<MyQr />} />
          <Route path="/employee/scanner" element={<EmployeeScanner />} />
          <Route path="/employee/profile" element={<MyProfile />} />
          <Route path="/profile" element={<MyProfile />} />
        </Route>
      </Routes>
      <SpeedInsights />
    </Router>
  );
}

export default App;