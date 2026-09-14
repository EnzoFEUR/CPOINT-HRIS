import React, { lazy } from 'react';
import { Navigate } from 'react-router-dom';

const Dashboard = lazy(() => import('../pages/Dashboard'));

export const getRole = (user) => (user?.role || '').toLowerCase();

export const isSecurity = (user) => {
  const r = getRole(user);
  return r === 'security' || r === 'guard' || r === 'security_guard';
};

export const isAdmin = (user) => {
  const r = getRole(user);
  return r === 'admin' || r === 'superadmin' || r === 'super_admin' || r === 'hr' || r === 'hr_manager';
};

export const getUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return (raw && raw !== 'undefined') ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const getPageTitle = (pathname) => {
  if (pathname === '/') return 'Dashboard';

  // Payroll
  if (pathname === '/admin/payroll/statutory-settings') return 'Statutory Settings';
  if (pathname === '/admin/payroll') return 'Payroll Ledger';
  if (pathname === '/admin/payroll/process') return 'Payroll Calculator';
  if (pathname.startsWith('/admin/payroll/')) return 'Payslip Details';

  // Employee
  if (pathname === '/admin/employees') return 'Employee Directory';
  if (pathname === '/admin/employees/create') return 'Add New Employee';
  if (pathname.startsWith('/admin/employees/') && pathname.endsWith('/edit')) return 'Edit Employee';
  if (pathname.startsWith('/admin/employees/') && pathname.endsWith('/qr')) return 'Employee QR Pass';
  if (pathname.startsWith('/admin/employees/')) return 'Employee Profile';

  // Archive & Documents
  if (pathname === '/admin/archive') return 'Employee Archive';
  if (pathname.startsWith('/admin/archive/')) return 'Archived Employee Profile';
  if (pathname === '/admin/documents') return 'Document Archive';

  // Attendance & Others
  if (pathname === '/admin/attendance') return 'Attendance Logs';
  if (pathname === '/admin/attendance/calendar') return 'Attendance Calendar';
  if (pathname === '/admin/leaves') return 'Leave Requests';
  if (pathname === '/admin/disciplinary') return 'Disciplinary Records';
  if (pathname === '/admin/audit-logs') return 'Audit Trail';

  // Employee Portal
  if (pathname === '/employee/dashboard') return 'Employee Portal';
  if (pathname === '/employee/qr') return 'My Digital QR';
  if (pathname === '/employee/scanner') return 'Self Scanner';
  if (pathname === '/employee/profile') return 'My Profile';

  const segment = pathname.split('/').filter(Boolean).pop() || 'Dashboard';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(segment)) {
    return 'Details';
  }
  return 'Dashboard';
};

// Route Guard: Protected Routes
export const ProtectedRoute = ({ children, allowedRoles = null, requireBiometrics = false }) => {
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
    // Support aliases: e.g. 'super_admin' <=> 'superadmin', 'hr_manager' <=> 'hr'
    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase().replace(/_/g, ''));
    const normalizedRole = role.replace(/_/g, '');
    const hasRole = normalizedAllowed.includes(normalizedRole);

    if (!hasRole) {
      if (isSecurity(user)) return <Navigate to="/scanner" replace />;
      if (isAdmin(user)) return <Navigate to="/" replace />;
      return <Navigate to="/employee/dashboard" replace />;
    }
  }

  return children;
};

// Route Guard: Public-Only Routes (Redirects already authenticated users)
export const PublicOnlyRoute = ({ children }) => {
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
export const RootRoute = () => {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.requires_password_change) return <Navigate to="/force-password-change" replace />;
  if (!user.has_registered_biometrics && !isSecurity(user) && !isAdmin(user)) return <Navigate to="/biometric-setup" replace />;
  if (isSecurity(user)) return <Navigate to="/scanner" replace />;
  if (isAdmin(user)) return <Dashboard />;
  return <Navigate to="/employee/dashboard" replace />;
};
