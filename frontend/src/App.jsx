import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from './supabaseClient';
import toast, { Toaster } from 'react-hot-toast';

const AuthGuard = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/scanner'];

    if (!user) {
      if (!publicRoutes.includes(location.pathname)) {
        navigate('/login');
      }
      return;
    }

    if (user.requires_password_change) {
      if (location.pathname !== '/force-password-change') {
        navigate('/force-password-change');
      }
      return;
    } else if (!user.has_registered_biometrics && user.role !== 'security' && user.role !== 'admin') {
      if (location.pathname !== '/biometric-setup') {
        navigate('/biometric-setup');
      }
      return;
    }

    // Role-based root routing to prevent Dashboard flashing
    if (location.pathname === '/') {
      if (user.role === 'security') {
        navigate('/scanner', { replace: true });
      } else if (user.role !== 'admin') {
        navigate('/employee/dashboard', { replace: true });
      }
    }
  }, [navigate, location.pathname]);

  return children;
};

// Auth Pages
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ForcePasswordChange from './pages/ForcePasswordChange';
import BiometricSetup from './pages/BiometricSetup';
import VerifyEmail from './pages/VerifyEmail';

// Core Flow Pages
import Dashboard from './pages/Dashboard';
import Scanner from './pages/Scanner';
import ProcessPayroll from './pages/admin/ProcessPayroll';
import EmployeeDashboard from './pages/EmployeeDashboard';

// Admin / Attendance
import AttendanceIndex from './pages/admin/attendance/Index';
import AttendanceCalendar from './pages/admin/attendance/Calendar';

// Admin / Employees
import EmployeeIndex from './pages/admin/employees/Index';
import EmployeeCreate from './pages/admin/employees/Create';
import EmployeeEdit from './pages/admin/employees/Edit';
import EmployeeShow from './pages/admin/employees/Show';
import EmployeeQrPrint from './pages/admin/employees/QrPrint';

// Admin / Payroll
import PayrollIndex from './pages/admin/payroll/Index';
import PayrollShow from './pages/admin/payroll/Show';
import StatutorySettings from './pages/admin/payroll/StatutorySettings';

// Admin / Audit Logs
import AuditLogsIndex from './pages/admin/audit-logs/Index';

// Admin / Leaves
import LeavesIndex from './pages/admin/leaves/Index';

// Admin / Shifts
import ShiftsIndex from './pages/admin/shifts/Index';

// Admin / Disciplinary
import DisciplinaryIndex from './pages/admin/disciplinary/Index';

// Employee
import MyQr from './pages/employee/MyQr';
import EmployeeScanner from './pages/employee/Scanner';

import './index.css';

function MainLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Current user from localStorage
  const [user] = useState(() => JSON.parse(localStorage.getItem('user')) || { name: 'Admin User', role: 'admin' });

  const isAttendanceActive = location.pathname.includes('/admin/attendance');
  const [attendanceDropdownOpen, setAttendanceDropdownOpen] = useState(isAttendanceActive);

  // Header state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);

  // Fetch initial notifications
  useEffect(() => {
    if (user?.id) {
      fetch(`http://localhost:5000/api/notifications?user_id=${user.id}&role=${user.role}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setNotifications(data);
        })
        .catch(console.error);
    }
  }, [user]);

  const searchIndex = [
    { label: 'Dashboard', route: '/', icon: 'ti-smart-home' },
    { label: 'Employees Directory', route: '/admin/employees', icon: 'ti-users-group' },
    { label: 'Payroll Processing', route: '/admin/payroll', icon: 'ti-wallet' },
    { label: 'Statutory Settings', route: '/admin/payroll/statutory-settings', icon: 'ti-settings' },
    { label: 'Leave Approvals', route: '/admin/leaves', icon: 'ti-plane-departure' },
    { label: 'Audit Trail', route: '/admin/audit-logs', icon: 'ti-history' },
    { label: 'Attendance Daily Logs', route: '/admin/attendance', icon: 'ti-list-details' },
    { label: 'My Profile', route: '/profile', icon: 'ti-user-circle' },
  ];

  const filteredSearch = searchQuery ? searchIndex.filter(item => item.label.toLowerCase().includes(searchQuery.toLowerCase())) : [];

  useEffect(() => {
    setSidebarOpen(false); // close on route change
  }, [location.pathname]);

  // Real-time notification listener
  useEffect(() => {
    if (!user || !user.id) return;

    const broadcastChannel = supabase
      .channel('system-notifications')
      .on('broadcast', { event: 'NEW_NOTIFICATION' }, (payload) => {
        const notif = payload.payload;
        // Check if notif is for me
        if (notif.target === user.id || (user.role === 'admin' && notif.target === 'admin')) {
          toast(notif.text, {
            icon: notif.type === 'leave' ? <i className="ti ti-plane-departure text-xl text-teal-400" /> : notif.type === 'shift' ? <i className="ti ti-calendar-time text-xl text-cyan-400" /> : notif.type === 'payroll' ? <i className="ti ti-cash text-xl text-emerald-400" /> : <i className="ti ti-bell-ringing text-xl text-blue-400" />,
            duration: 6000
          });
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
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetch('http://localhost:5000/api/notifications/read-all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden animate-fade-in"
        ></div>
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-4 left-4 z-50 w-72 rounded-[2rem] glass-sidebar text-slate-300 flex flex-col shadow-2xl shadow-slate-900/20 transition-transform duration-500 bg-slate-900 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-[150%]'}`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }}
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
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden ml-auto text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <i className="ti ti-x text-2xl"></i>
          </button>
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
                { route: '/admin/payroll', icon: 'ti-wallet', label: 'Payroll' },
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
          <button onClick={handleLogout} className="w-full flex items-center justify-center px-4 py-3 text-sm font-bold text-red-400 bg-red-500/10 rounded-xl group hover:text-white hover:bg-red-500/20">
            <i className="ti ti-power mr-2 text-lg group-hover:animate-pulse"></i> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen w-full transition-all duration-500 ease-in-out lg:pl-[320px]">
        <div className="flex flex-col flex-1 w-full max-w-7xl mx-auto">

          {/* Header */}
          <header className="flex items-center justify-between px-6 py-4 mt-4 mx-4 lg:mx-8 sticky top-4 z-30 bg-white/70 backdrop-blur-xl shadow-sm border border-slate-200/60 rounded-2xl transition-all duration-300">
            <div className="flex items-center gap-4">
              <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-slate-500 hover:text-slate-800 lg:hidden transition-transform active:scale-95 bg-slate-100/50 rounded-xl">
                <i className="ti ti-menu-2 text-2xl"></i>
              </button>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight capitalize">
                  {location.pathname === '/' ? 'Dashboard' : location.pathname.split('/').pop().replace('-', ' ')}
                </h2>
                <p className="text-xs text-slate-400 font-medium hidden sm:block mt-0.5">{currentDate}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 relative">

              {/* Search */}
              <div className="relative hidden md:block">
                <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setShowSearch(true); setShowNotifications(false); }}
                  onFocus={() => { setShowSearch(true); setShowNotifications(false); }}
                  placeholder="Search everywhere..."
                  className="pl-9 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500/20 w-64 transition-all focus:w-80"
                />

                {/* Search results */}
                {showSearch && searchQuery && (
                  <div className="absolute top-full right-0 mt-2 w-full bg-white/90 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-50 animate-fade-in-up">
                    <div className="p-2 border-b border-slate-100 bg-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">Quick Results</p>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {filteredSearch.length > 0 ? filteredSearch.map(item => (
                        <Link key={item.route} to={item.route} onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors cursor-pointer group">
                          <div className="h-8 w-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <i className={`ti ${item.icon}`}></i>
                          </div>
                          <span className="text-sm font-bold text-slate-700">{item.label}</span>
                        </Link>
                      )) : (
                        <div className="p-4 text-center text-xs text-slate-500 font-bold">No results found for "{searchQuery}"</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Notifications */}
              <button
                onClick={() => { setShowNotifications(!showNotifications); setShowSearch(false); }}
                className={`relative p-2.5 transition-all rounded-xl active:scale-95 shadow-sm border border-slate-200/50 ${showNotifications ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50 bg-slate-100'}`}
              >
                <i className="ti ti-bell text-xl"></i>
                {notifications.some(n => !n.read) && (
                  <span className="absolute top-2 right-2 h-2.5 w-2.5 bg-red-500 rounded-full border-2 border-white shadow-sm animate-pulse"></span>
                )}
              </button>

              {/* Notification panel */}
              {showNotifications && (
                <div className="absolute top-full right-0 mt-3 w-80 bg-white/90 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in-up">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800">Notifications</h3>
                    <button
                      onClick={markAllRead}
                      className="text-[10px] font-bold text-blue-600 hover:underline uppercase tracking-wider"
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length > 0 ? notifications.map(notif => (
                      <div key={notif.id} className={`p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3 ${!notif.read ? 'bg-blue-50/30' : ''}`}>
                        <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${notif.read ? 'bg-slate-300' : 'bg-blue-500'}`}></div>
                        <div>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{notif.title}</p>
                          <p className="text-sm text-slate-700 font-medium leading-snug mt-0.5">{notif.text}</p>
                          <p className="text-[10px] text-slate-400 font-bold mt-2">{new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    )) : (
                      <div className="p-8 text-center flex flex-col items-center opacity-50">
                        <i className="ti ti-bell-off text-3xl mb-2 text-slate-400"></i>
                        <span className="text-xs font-bold text-slate-500">All caught up!</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6 lg:p-8 mt-2 w-full relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -10 }}
                transition={{ type: "spring", stiffness: 500, damping: 30, mass: 0.5 }}
                className="w-full h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
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
          <Route path="/admin/payroll/process" element={<MainLayout><ProcessPayroll /></MainLayout>} />

          {/* Statutory Settings (Must be before dynamic :id route) */}
          <Route path="/admin/payroll/statutory-settings" element={<MainLayout><StatutorySettings /></MainLayout>} />
          <Route path="/payroll/statutory-settings" element={<MainLayout><StatutorySettings /></MainLayout>} />

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
      </AuthGuard>
    </Router>
  );
}

export default App;