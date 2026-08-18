import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from './supabaseClient';
import toast, { Toaster } from 'react-hot-toast';
import { fetchWithAuth } from './utils/api';

// Auth Pages (Lazy Loaded)
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const ForcePasswordChange = lazy(() => import('./pages/ForcePasswordChange'));
const BiometricSetup = lazy(() => import('./pages/BiometricSetup'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));

// Core Flow Pages (Lazy Loaded)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scanner = lazy(() => import('./pages/Scanner'));
const EmployeeDashboard = lazy(() => import('./pages/EmployeeDashboard'));

// Admin / Attendance
const AttendanceIndex = lazy(() => import('./pages/admin/attendance/Index'));
const AttendanceCalendar = lazy(() => import('./pages/admin/attendance/Calendar'));

// Admin / Employees
const EmployeeIndex = lazy(() => import('./pages/admin/employees/Index'));
const EmployeeCreate = lazy(() => import('./pages/admin/employees/Create'));
const EmployeeEdit = lazy(() => import('./pages/admin/employees/Edit'));
const EmployeeShow = lazy(() => import('./pages/admin/employees/Show'));
const EmployeeQrPrint = lazy(() => import('./pages/admin/employees/QrPrint'));

// Admin / Payroll
const PayrollIndex = lazy(() => import('./pages/admin/payroll/Index'));
const PayrollCreate = lazy(() => import('./pages/admin/payroll/Create'));
const PayrollShow = lazy(() => import('./pages/admin/payroll/Show'));

// Admin / Audit Logs
const AuditLogsIndex = lazy(() => import('./pages/admin/audit-logs/Index'));

// Admin / Leaves
const LeavesIndex = lazy(() => import('./pages/admin/leaves/Index'));

// Admin / Shifts
const ShiftsIndex = lazy(() => import('./pages/admin/shifts/Index'));

// Admin / Disciplinary
const DisciplinaryIndex = lazy(() => import('./pages/admin/disciplinary/Index'));

// Employee
const MyQr = lazy(() => import('./pages/employee/MyQr'));
const EmployeeScanner = lazy(() => import('./pages/employee/Scanner'));

import './index.css';

const RouteLoadingFallback = () => (
  <div className="w-full h-full min-h-[300px] relative flex items-center justify-center">
    {/* Sleek Top Progress Bar */}
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2.5px] bg-gradient-to-r from-blue-600 via-cyan-400 to-indigo-600 shadow-[0_0_12px_rgba(59,130,246,0.6)] animate-pulse" />
    <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/80 backdrop-blur-md border border-white/10 rounded-full shadow-lg text-slate-300 text-xs font-medium">
      <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
      <span>Loading...</span>
    </div>
  </div>
);

const getRole = (user) => (user?.role || '').toLowerCase();
const isSecurity = (user) => {
    const r = getRole(user);
    return r === 'security' || r === 'guard' || r === 'security_guard';
};
const isAdmin = (user) => {
    const r = getRole(user);
    return r === 'admin' || r === 'superadmin' || r === 'hr';
};

const AuthGuard = ({ children }) => {
    const navigate = useNavigate();
    const location = useLocation();
    
    let user = null;
    try {
        const raw = localStorage.getItem('user');
        user = (raw && raw !== 'undefined') ? JSON.parse(raw) : null;
    } catch {
        user = null;
    }

    const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/scanner'];
    const isPublic = publicRoutes.includes(location.pathname);
    
    useEffect(() => {
        if (!user && !isPublic) {
            navigate('/login', { replace: true });
            return;
        }

        if (user) {
            if (user.requires_password_change) {
                if (location.pathname !== '/force-password-change') {
                    navigate('/force-password-change', { replace: true });
                }
                return;
            } else if (!user.has_registered_biometrics && !isSecurity(user) && !isAdmin(user)) {
                if (location.pathname !== '/biometric-setup') {
                    navigate('/biometric-setup', { replace: true });
                }
                return;
            }

            // Role-based root routing to prevent Dashboard flashing
            if (location.pathname === '/') {
                if (isSecurity(user)) {
                    navigate('/scanner', { replace: true });
                } else if (!isAdmin(user)) {
                    navigate('/employee/dashboard', { replace: true });
                }
                return;
            }

            // Strictly protect all /admin/* routes from non-admin accounts
            if (location.pathname.startsWith('/admin') && !isAdmin(user)) {
                toast.error('Access Denied: Admin privileges required.');
                navigate(isSecurity(user) ? '/scanner' : '/employee/dashboard', { replace: true });
                return;
            }

            // Strictly protect /scanner from non-authorized personnel (security & admin only)
            if (location.pathname === '/scanner' && !isAdmin(user) && !isSecurity(user)) {
                toast.error('Access Denied: Gate scanner is restricted to authorized personnel.');
                navigate('/employee/dashboard', { replace: true });
                return;
            }
        }
    }, [navigate, location.pathname, isPublic]);

    if (!user && !isPublic) {
        return null;
    }

    return children;
};

const getPageTitle = (pathname) => {
  if (pathname === '/') return 'Dashboard';
  
  // Payroll Routes
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
  if (pathname === '/admin/shifts') return 'Shift Schedules';
  if (pathname === '/admin/disciplinary') return 'Disciplinary Records';
  if (pathname === '/admin/audit-logs') return 'Audit Trail';

  // Employee Routes
  if (pathname === '/employee/dashboard') return 'Employee Portal';
  if (pathname === '/employee/qr') return 'My Digital QR';
  if (pathname === '/employee/scanner') return 'Self Scanner';
  if (pathname === '/profile') return 'My Profile';

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
        path: '/admin/shifts'
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

// Extract or generate employee profile picture / initials
const getNotificationAvatar = (notif) => {
  let initials = 'CP';
  let avatarSrc = notif.sender_avatar || null;

  if (!avatarSrc && notif.company_id && (notif.sender_id || notif.target)) {
    const id = notif.sender_id || notif.target;
    avatarSrc = `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${notif.company_id}/${id}.jpg`;
  }

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

  return { avatarSrc, initials };
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

  // PWA Install State & Platform Detection
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [browserType, setBrowserType] = useState('other'); // 'samsung', 'ios', 'chrome_android', 'desktop'

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
      toast.success('C-Point HRIS installed to your Home Screen!', { icon: '🎉' });
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

  // Fetch initial notifications
  useEffect(() => {
    if (user?.id) {
      fetchWithAuth(`/api/notifications?user_id=${user.id}&role=${user.role}`)
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) setNotifications(data);
        })
        .catch(console.error);
    }
  }, [user]);

  const searchIndex = isAdmin(user) ? [
    { label: 'Admin Dashboard', route: '/', icon: 'ti-smart-home' },
    { label: 'Employees Directory', route: '/admin/employees', icon: 'ti-users-group' },
    { label: 'Shift Engine & Scheduling', route: '/admin/shifts', icon: 'ti-calendar-time' },
    { label: 'Payroll Ledger', route: '/admin/payroll', icon: 'ti-wallet' },
    { label: 'Compute Payroll', route: '/admin/payroll/process', icon: 'ti-calculator' },
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
    setSidebarOpen(false); // close on route change
  }, [location.pathname]);

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

    if (user?.role !== 'admin') {
      targetPath = '/employee/dashboard';
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
            const avatar = getNotificationAvatar(notif);
            
            toast.custom((t) => (
              <div 
                onClick={() => { toast.dismiss(t.id); handleNotificationClick(notif); }}
                className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-md w-full bg-slate-900/95 backdrop-blur-xl shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-white/10 p-4 gap-3.5 cursor-pointer hover:bg-slate-800 transition-all border border-slate-700/50`}
              >
                <div className="relative h-11 w-11 shrink-0">
                  {avatar.avatarSrc ? (
                    <img 
                      src={avatar.avatarSrc} 
                      onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      alt={notif.sender_name || 'Sender'}
                      className="w-full h-full object-cover rounded-xl shadow-sm border border-slate-700"
                    />
                  ) : null}
                  <div 
                    className={`w-full h-full rounded-xl flex items-center justify-center font-black text-sm shadow-inner ${visuals.bg}`}
                    style={{ display: avatar.avatarSrc ? 'none' : 'flex' }}
                  >
                    {avatar.initials}
                  </div>
                  <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center text-[9px] text-white shadow-sm ring-1 ring-slate-900 ${visuals.badge}`}>
                    <i className={`ti ${visuals.icon}`} />
                  </span>
                </div>
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
            
            if (window.location.pathname.includes('/employee/dashboard')) {
                window.dispatchEvent(new Event('refresh_dashboard'));
            }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(broadcastChannel);
    };
  }, [user]);

  const markAllRead = async () => {
      setNotifications(prev => prev.map(n => ({...n, read: true})));
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
          <div className="flex items-center gap-4 group cursor-pointer">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">CP</div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide">C-Point</h1>
              <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5">HRIS</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 mt-6 px-4 space-y-1.5 overflow-y-auto pb-6 custom-scrollbar">
          <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Overview</p>
          
          <Link to="/" className={`flex items-center px-4 py-3.5 rounded-2xl group ${location.pathname === '/' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:text-white'}`}>
            <i className="ti ti-smart-home text-xl group-hover:scale-110 transition-transform duration-300"></i>
            <span className="ml-3 font-medium tracking-wide">Dashboard</span>
          </Link>

          <div className="pt-6 pb-2">
            <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Workspace</p>
          </div>

          {user.role === 'admin' ? (
            <>
              {/* Attendance submenu */}
              <div className="space-y-1">
                <button 
                  onClick={() => setAttendanceDropdownOpen(!attendanceDropdownOpen)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl group transition-all duration-300 ${isAttendanceActive ? 'bg-slate-800/50 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/30'}`}
                >
                  <div className="flex items-center">
                    <i className={`ti ti-clock-hour-4 text-xl group-hover:scale-110 transition-transform duration-300 ${isAttendanceActive ? 'text-blue-400' : ''}`}></i>
                    <span className="ml-3 font-medium tracking-wide">Time & Attendance</span>
                  </div>
                  <i className={`ti ti-chevron-down text-sm transition-transform duration-300 ${attendanceDropdownOpen ? 'rotate-180' : ''}`}></i>
                </button>

                {attendanceDropdownOpen && (
                  <div className="flex flex-col gap-1 pl-4 pr-2 pt-1 animate-fade-in-up">
                    <Link to="/admin/attendance" className={`flex items-center px-4 py-2.5 rounded-xl group transition-all duration-300 ${location.pathname === '/admin/attendance' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                      <i className="ti ti-list-details text-lg group-hover:scale-110 transition-transform duration-300"></i>
                      <span className="ml-3 text-sm font-medium">Daily Logs</span>
                    </Link>
                    <Link to="/admin/attendance/calendar" className={`flex items-center px-4 py-2.5 rounded-xl group transition-all duration-300 ${location.pathname === '/admin/attendance/calendar' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                      <i className="ti ti-calendar text-lg group-hover:scale-110 transition-transform duration-300"></i>
                      <span className="ml-3 text-sm font-medium">Calendar View</span>
                    </Link>
                  </div>
                )}
              </div>

              {/* Nav links */}
              {[
                { route: '/admin/employees', icon: 'ti-users-group', label: 'Employees' },
                { route: '/admin/shifts', icon: 'ti-calendar-time', label: 'Shift Engine' },
                { route: '/admin/payroll', icon: 'ti-wallet', label: 'Payroll Ledger' },
                { route: '/admin/leaves', icon: 'ti-plane-departure', label: 'Leave Approvals' },
                { route: '/admin/disciplinary', icon: 'ti-gavel', label: 'Disciplinary' },
                { route: '/admin/audit-logs', icon: 'ti-history', label: 'Audit Trail' }
              ].map(item => (
                <Link key={item.label} to={item.route} className={`flex items-center px-4 py-3.5 rounded-2xl group mt-1 ${location.pathname.startsWith(item.route) ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:text-white'}`}>
                  <i className={`ti ${item.icon} text-xl group-hover:scale-110 transition-transform duration-300`}></i>
                  <span className="ml-3 font-medium tracking-wide">{item.label}</span>
                </Link>
              ))}
            </>
          ) : (
            <Link to="/profile" className="flex items-center px-4 py-3.5 rounded-2xl text-slate-400 hover:text-white group">
              <i className="ti ti-user-circle text-xl group-hover:scale-110 transition-transform duration-300"></i>
              <span className="ml-3 font-medium tracking-wide">My Profile</span>
            </Link>
          )}

        </nav>

        {/* User profile */}
        <div className="p-4 mt-auto border-t border-white/5 bg-slate-900/20 rounded-b-[2rem] shrink-0">
          <Link to="/profile" className="flex items-center p-3 rounded-2xl group mb-2 cursor-pointer hover:bg-white/5">
            <div className="relative">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold shadow-lg">
                {user.name ? user.name.charAt(0) : (user.first_name ? user.first_name.charAt(0) : '?')}
              </div>
              <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 bg-green-500 border-2 border-[#0B132B] rounded-full"></span>
            </div>
            <div className="ml-3 overflow-hidden">
              <p className="text-sm font-bold text-white truncate group-hover:text-blue-400 transition-colors">{user.name || `${user.first_name} ${user.last_name}`}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mt-0.5">{user.role}</p>
            </div>
          </Link>
          <button onClick={handleLogout} className="w-full flex items-center justify-center px-4 py-3 text-sm font-bold text-red-400 bg-red-500/10 rounded-xl group hover:text-white hover:bg-red-500/20 transition-all">
            <i className="ti ti-power mr-2 text-lg group-hover:animate-pulse"></i> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen w-full transition-all duration-500 ease-in-out lg:pl-[320px]">
        <div className="flex flex-col flex-1 w-full max-w-7xl mx-auto">
          
          {/* Header */}
          <header className="flex items-center justify-between px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top,0px))] pb-3 sm:py-3.5 sticky top-0 sm:top-4 z-30 bg-white/90 sm:bg-white/70 backdrop-blur-xl shadow-xs sm:shadow-sm border-b sm:border border-slate-200/70 sm:border-slate-200/60 sm:rounded-2xl sm:mx-4 lg:mx-8 transition-all duration-300 touch-none select-none overscroll-none">
            <div className="flex items-center gap-3">
              <div className="lg:hidden flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-xs shadow-sm">
                CP
              </div>
              <div>
                <h2 className="text-base sm:text-2xl font-black text-slate-800 tracking-tight capitalize leading-tight">
                  {getPageTitle(location.pathname)}
                </h2>
                <p className="text-[11px] text-slate-400 font-medium hidden sm:block mt-0.5">{currentDate}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 relative">

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
                  className="pl-8 pr-4 py-1.5 bg-slate-100/90 border-none rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 w-60 transition-all focus:w-72 font-medium text-slate-700" 
                />
              </div>

              {/* Search dropdown (Desktop & Mobile Modal) */}
              {showSearch && (
                <div className="fixed inset-x-4 top-16 md:absolute md:inset-auto md:top-full md:right-0 md:mt-2 md:w-80 bg-white/95 backdrop-blur-2xl border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in-up">
                  <div className="p-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Quick Navigation</p>
                    <button onClick={() => setShowSearch(false)} className="md:hidden text-slate-400 hover:text-slate-700 p-1">
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
                      <Link key={item.route} to={item.route} onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="flex items-center gap-3 p-2.5 hover:bg-blue-50/50 transition-colors cursor-pointer group">
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

              {/* Notifications Bell */}
              <button 
                onClick={() => { setShowNotifications(!showNotifications); setShowSearch(false); }}
                className={`relative p-2 transition-all rounded-xl tap-active shadow-xs border border-slate-200/50 h-9 w-9 flex items-center justify-center ${showNotifications ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 bg-slate-100/80'}`}
                aria-label="View Notifications"
              >
                <i className="ti ti-bell text-lg"></i>
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-red-500 rounded-full border-2 border-white shadow-xs animate-pulse"></span>
                )}
              </button>

              {/* Notification panel */}
              {showNotifications && (
                <div className="fixed inset-x-4 top-16 sm:absolute sm:inset-auto sm:top-full sm:right-0 sm:mt-3 sm:w-96 bg-white/95 backdrop-blur-2xl border border-slate-200/80 rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in-up">
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
                      const avatar = getNotificationAvatar(notif);
                      return (
                        <div 
                          key={notif.id}
                          onClick={() => handleNotificationClick(notif)}
                          className={`p-3.5 hover:bg-slate-50/80 transition-colors flex items-start gap-3 cursor-pointer ${!notif.read ? 'bg-blue-50/30' : ''}`}
                        >
                          <div className="relative h-9 w-9 shrink-0">
                            {avatar.avatarSrc ? (
                              <img 
                                src={avatar.avatarSrc} 
                                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                alt=""
                                className="w-full h-full object-cover rounded-xl border border-slate-200"
                              />
                            ) : null}
                            <div 
                              className={`w-full h-full rounded-xl flex items-center justify-center font-black text-xs shadow-inner ${visuals.bg}`}
                              style={{ display: avatar.avatarSrc ? 'none' : 'flex' }}
                            >
                              {avatar.initials}
                            </div>
                            <span className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full flex items-center justify-center text-[8px] text-white shadow-xs ring-1 ring-white ${visuals.badge}`}>
                              <i className={`ti ${visuals.icon}`} />
                            </span>
                          </div>
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
                            <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0 shadow-xs animate-pulse" />
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
                </div>
              )}
            </div>
          </header>

          {/* Page Main Content */}
          <main className="flex-1 p-3.5 sm:p-6 lg:p-8 mt-1 sm:mt-2 w-full relative pb-28 lg:pb-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, scale: 0.99, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.99, y: -6 }}
                transition={{ type: "spring", stiffness: 450, damping: 30 }}
                className="w-full h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* ═══════════════════════════════════════════════════════
              MODERN MOBILE FLOATING DOCK (Island Style)
              ═══════════════════════════════════════════════════════ */}
          {/* ═══════════════════════════════════════════════════════
              MODERN DYNAMIC MOBILE FLOATING DOCK (Multi-Resolution Fluid Island)
              ═══════════════════════════════════════════════════════ */}
          <div className="lg:hidden fixed bottom-2.5 sm:bottom-4 inset-x-0 z-40 flex justify-center px-2 sm:px-4 pointer-events-none pb-[max(0.35rem,env(safe-area-inset-bottom))]">
            <nav className="pointer-events-auto w-full max-w-[460px] bg-slate-900/90 backdrop-blur-2xl text-slate-400 border border-white/15 rounded-2xl sm:rounded-3xl shadow-2xl p-1 sm:p-1.5 flex items-center justify-between gap-0.5 sm:gap-1 shadow-slate-950/50 ring-1 ring-white/10">
              {user.role === 'admin' ? (
                <>
                  {[
                    { to: '/', label: 'Home', icon: 'ti-smart-home', exact: true },
                    { to: '/admin/employees', label: 'Staff', icon: 'ti-users-group' },
                    { to: '/admin/attendance', label: 'Logs', icon: 'ti-clock-hour-4' },
                    { to: '/admin/shifts', label: 'Shifts', icon: 'ti-calendar-time' },
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
                        className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-0.5 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl transition-all select-none tap-active ${
                          isActive ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title={tab.label}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="mobileActiveDockPill"
                            className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40"
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                          />
                        )}
                        <i className={`ti ${tab.icon} text-lg sm:text-xl relative z-10 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                        <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5">
                          {tab.label}
                        </span>
                      </Link>
                    );
                  })}

                  {/* More Apps Trigger */}
                  <button 
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className={`relative flex-1 min-w-0 py-1.5 sm:py-2 px-0.5 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl transition-all select-none tap-active ${
                      sidebarOpen ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="More Apps"
                  >
                    {sidebarOpen && (
                      <motion.div
                        layoutId="mobileActiveDockPill"
                        className="absolute inset-0 bg-purple-600 rounded-xl sm:rounded-2xl shadow-md shadow-purple-500/40"
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                      />
                    )}
                    <i className={`ti ti-grid-dots text-lg sm:text-xl relative z-10 transition-transform duration-200 ${sidebarOpen ? 'scale-110' : ''}`} />
                    <span className="text-[8px] sm:text-[9px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5">
                      More
                    </span>
                  </button>
                </>
              ) : (
                <>
                  {[
                    { to: '/employee/dashboard', label: 'Portal', icon: 'ti-smart-home', exact: true },
                    { to: '/employee/qr', label: 'My Pass', icon: 'ti-qrcode' },
                    ...(isSecurity(user) ? [{ to: '/scanner', label: 'Scan', icon: 'ti-scan' }] : []),
                    { to: '/profile', label: 'Profile', icon: 'ti-user' }
                  ].map(tab => {
                    const isActive = tab.exact 
                      ? location.pathname === tab.to 
                      : location.pathname.startsWith(tab.to);

                    return (
                      <Link 
                        key={tab.to}
                        to={tab.to} 
                        className={`relative flex-1 min-w-0 py-2 sm:py-2.5 px-1 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl transition-all select-none tap-active ${
                          isActive ? 'text-white font-black' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="mobileEmpActiveDockPill"
                            className="absolute inset-0 bg-blue-600 rounded-xl sm:rounded-2xl shadow-md shadow-blue-500/40"
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                          />
                        )}
                        <i className={`ti ${tab.icon} text-xl relative z-10 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`} />
                        <span className="text-[9px] sm:text-[10px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5">
                          {tab.label}
                        </span>
                      </Link>
                    );
                  })}

                  <button 
                    onClick={handleLogout}
                    className="relative flex-1 min-w-0 py-2 sm:py-2.5 px-1 flex flex-col items-center justify-center rounded-xl sm:rounded-2xl transition-all select-none tap-active text-red-400 hover:text-red-300"
                  >
                    <i className="ti ti-power text-xl relative z-10" />
                    <span className="text-[9px] sm:text-[10px] tracking-tight truncate max-w-full text-center relative z-10 leading-none mt-0.5">
                      Logout
                    </span>
                  </button>
                </>
              )}
            </nav>
          </div>

          {/* ═══════════════════════════════════════════════════════
              MOBILE FLOATING DOCK: "MORE APPS" SHEET MODAL (With Drag Gestures)
              ═══════════════════════════════════════════════════════ */}
          <AnimatePresence>
            {sidebarOpen && (
              <div className="lg:hidden fixed inset-0 z-50 flex items-end justify-center p-0">
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-slate-950/75 backdrop-blur-md"
                  onClick={() => setSidebarOpen(false)}
                />
                <motion.div 
                  initial={{ y: "100%" }} 
                  animate={{ y: 0 }} 
                  exit={{ y: "100%" }}
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0.05, bottom: 0.5 }}
                  onDragEnd={(e, info) => {
                    if (info.offset.y > 100 || info.velocity.y > 500) {
                      setSidebarOpen(false);
                    }
                  }}
                  transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                  className="relative w-full max-w-lg bg-slate-900/95 backdrop-blur-2xl border-t border-white/15 rounded-t-3xl p-5 text-white shadow-2xl z-10 max-h-[85vh] overflow-y-auto touch-scroll pb-24"
                >
                  {/* Drag Pill Handle */}
                  <div className="w-12 h-1.5 bg-slate-700/80 rounded-full mx-auto mb-4 cursor-grab active:cursor-grabbing" />
                  
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
                    <div className="mb-4 p-3.5 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border border-blue-500/30 rounded-2xl flex items-center justify-between gap-3">
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
                    <Link 
                      to="/admin/disciplinary" 
                      onClick={() => setSidebarOpen(false)}
                      className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                    >
                      <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
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

                    {(isAdmin(user) || isSecurity(user)) && (
                      <Link 
                        to="/scanner" 
                        onClick={() => setSidebarOpen(false)}
                        className="p-3.5 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 flex items-center gap-3 tap-active transition-all"
                      >
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
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
                      to="/profile" 
                      onClick={() => setSidebarOpen(false)}
                      className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-center text-slate-300 tap-active"
                    >
                      My Profile
                    </Link>
                    <button 
                      onClick={handleLogout}
                      className="flex-1 py-3 px-4 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-xl text-xs font-bold text-center tap-active flex items-center justify-center gap-1.5"
                    >
                      <i className="ti ti-power" /> Sign Out
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Universal PWA Installation Guide Modal (Samsung Internet, Chrome, iOS Safari, Desktop) */}
          <AnimatePresence>
            {showInstallGuide && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                  onClick={() => setShowInstallGuide(false)}
                />
                <motion.div 
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  className="relative w-full max-w-md bg-slate-900 border border-white/15 rounded-3xl p-5 sm:p-6 text-white shadow-2xl z-10 space-y-4 max-h-[90vh] overflow-y-auto"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center font-black text-base text-white shadow-lg shadow-blue-500/30 shrink-0">
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
                      className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-xs sm:text-sm rounded-2xl shadow-lg shadow-blue-600/30 tap-active flex items-center justify-center gap-2"
                    >
                      <i className="ti ti-download text-base" /> 1-Tap Quick Install
                    </button>
                  )}

                  {/* Browser Selector Tabs */}
                  <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                    <button
                      onClick={() => setBrowserType('samsung')}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${browserType === 'samsung' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      Samsung
                    </button>
                    <button
                      onClick={() => setBrowserType('chrome_android')}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${browserType === 'chrome_android' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      Chrome
                    </button>
                    <button
                      onClick={() => setBrowserType('ios')}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${browserType === 'ios' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      iPhone / iPad
                    </button>
                    <button
                      onClick={() => setBrowserType('desktop')}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${browserType === 'desktop' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
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
                          <p>Tap the <span className="font-bold text-white"><i className="ti ti-menu-2 inline text-sm text-blue-400" /> Menu (☰)</span> button at the bottom right corner.</p>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                          <p>Tap <span className="font-bold text-white"><i className="ti ti-plus inline text-sm text-emerald-400" /> + Add page to</span> (or the Install icon).</p>
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
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function App() {
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
      <AuthGuard>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            {/* Auth */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            
            {/* Force Setup Routes */}
            <Route path="/force-password-change" element={<ForcePasswordChange />} />
            <Route path="/biometric-setup" element={<BiometricSetup />} />
            <Route path="/verify-email" element={<VerifyEmail />} />

            {/* Global/Shared */}
            <Route path="/" element={<MainLayout><Dashboard /></MainLayout>} />
            <Route path="/scanner" element={<Scanner />} />

            {/* Admin - Employees */}
            <Route path="/admin/employees" element={<MainLayout><EmployeeIndex /></MainLayout>} />
            <Route path="/admin/employees/create" element={<MainLayout><EmployeeCreate /></MainLayout>} />
            <Route path="/admin/employees/:id/edit" element={<MainLayout><EmployeeEdit /></MainLayout>} />
            <Route path="/admin/employees/:id" element={<MainLayout><EmployeeShow /></MainLayout>} />
            <Route path="/admin/employees/:id/qr" element={<EmployeeQrPrint />} />

            {/* Admin - Attendance */}
            <Route path="/admin/attendance" element={<MainLayout><AttendanceIndex /></MainLayout>} />
            <Route path="/admin/attendance/calendar" element={<MainLayout><AttendanceCalendar /></MainLayout>} />

            {/* Admin - Payroll */}
            <Route path="/admin/payroll" element={<MainLayout><PayrollIndex /></MainLayout>} />
            <Route path="/admin/payroll/process" element={<MainLayout><PayrollCreate /></MainLayout>} />
            <Route path="/admin/payroll/:id" element={<MainLayout><PayrollShow /></MainLayout>} />

            {/* Admin - Audit Logs */}
            <Route path="/admin/audit-logs" element={<MainLayout><AuditLogsIndex /></MainLayout>} />

            {/* Admin - Leaves */}
            <Route path="/admin/leaves" element={<MainLayout><LeavesIndex /></MainLayout>} />

            {/* Admin - Shifts */}
            <Route path="/admin/shifts" element={<MainLayout><ShiftsIndex /></MainLayout>} />

            {/* Admin - Disciplinary */}
            <Route path="/admin/disciplinary" element={<MainLayout><DisciplinaryIndex /></MainLayout>} />

            {/* Employee */}
            <Route path="/employee/dashboard" element={<MainLayout><EmployeeDashboard /></MainLayout>} />
            <Route path="/employee/qr" element={<MainLayout><MyQr /></MainLayout>} />
            <Route path="/employee/scanner" element={<MainLayout><EmployeeScanner /></MainLayout>} />
          </Routes>
        </Suspense>
      </AuthGuard>
    </Router>
  );
}

export default App;
