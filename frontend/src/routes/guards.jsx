import { lazy } from 'react';
import { isBiometricSetupTestAccess } from '../utils/biometricSetupTestAccess.mjs';
import { getActiveMedicalGrace } from '../../../shared/medicalGrace.mjs';
import { Navigate } from 'react-router-dom';
import { getStoredUser } from '../utils/storedUser.mjs';
import { getRole, isSecurity, isAdmin, needsProfileCompletion } from '../utils/userAccess.mjs';

export { getRole, isSecurity, isAdmin } from '../utils/userAccess.mjs';

const Dashboard = lazy(() => import('../pages/Dashboard'));

export const isDisciplinaryExempt = (user) => {
  if (!user) return false;
  if (isAdmin(user) || isSecurity(user)) return true;

  const r = getRole(user).replace(/[\s_-]/g, '');
  const dept = (user?.department || '').toLowerCase();
  const title = (user?.job_title || user?.position || '').toLowerCase();
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.toLowerCase();

  const isAdminRoleOrTitle =
    ['admin', 'hr', 'hrmanager'].includes(r) ||
    r.includes('admin') || r.includes('hr') ||
    dept.includes('admin') || dept.includes('human resources') || dept.includes('hr') ||
    title.includes('admin') || title.includes('administrator') || title.includes('hr');

  const isGuardRoleOrTitle =
    ['security', 'guard', 'securityguard'].includes(r) ||
    r.includes('guard') || r.includes('security') ||
    dept.includes('security') ||
    title.includes('guard') || title.includes('security') || title.includes('gate attendant') || title.includes('watchman') ||
    name.includes('guard');

  return Boolean(isAdminRoleOrTitle || isGuardRoleOrTitle);
};

export const getUser = getStoredUser;

export const getPageTitle = (pathname) => {
  if (pathname === '/') return 'Dashboard';

  if (['/admin/employment-exit', '/employee/employment-exit'].includes(pathname)) return 'Employment Exit';

  // Payroll
  if (pathname === '/admin/payroll/statutory-settings') return 'Statutory Settings';
  if (pathname === '/admin/payroll') return 'Payroll Ledger';
  if (pathname === '/admin/payroll/retirement') return 'Retirement Pay';
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
  if (pathname === '/onboarding') return 'Employee Onboarding';
  if (pathname === '/employee/dashboard') return 'Employee Portal';
  if (pathname === '/employee/qr') return 'My Digital QR';
  if (pathname === '/employee/scanner') return 'Self Scanner';
  if (pathname === '/employee/documents') return 'Personnel Documents';
  if (pathname === '/employee/policy-reports') return 'Policy & Incident Reports';
  if (pathname === '/employee/profile') return 'My Profile';

  const segment = pathname.split('/').filter(Boolean).pop() || 'Dashboard';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(segment)) {
    return 'Details';
  }
  return 'Dashboard';
};

export const isMedicalExempt = user => Boolean(getActiveMedicalGrace(user));

// Route Guard: Protected Routes
export const ProtectedRoute = ({ children, allowedRoles = null, requireBiometrics = false }) => {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.requires_password_change) {
    return <Navigate to="/force-password-change" replace />;
  }

  if (needsProfileCompletion(user)) {
    return <Navigate to="/onboarding" replace />;
  }

  const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
  if (requireBiometrics && !hasBiometrics && !isMedicalExempt(user) && !isBiometricSetupTestAccess(user) && !isSecurity(user) && !isAdmin(user)) {
    return <Navigate to="/biometric-setup" replace />;
  }

  if (allowedRoles) {
    const role = getRole(user);
    // Support aliases: e.g. 'hr_manager' <=> 'hr', 'security_guard' <=> 'guard'
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

/**
 * Route Guard: Force Password Change Gatekeeper
 * Strictly limits access to authenticated users who actually require a mandatory password change.
 * - Unauthenticated: redirected to /login
 * - Already satisfied: redirected to scanner, admin root, onboarding, biometric-setup, or employee dashboard.
 */
export const ForcePasswordChangeRoute = ({ children }) => {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/force-password-change' }} />;
  }

  if (!user.requires_password_change) {
    if (isSecurity(user)) return <Navigate to="/scanner" replace />;
    if (isAdmin(user)) return <Navigate to="/" replace />;
    if (needsProfileCompletion(user)) return <Navigate to="/onboarding" replace />;
    const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
    if (!hasBiometrics && !isMedicalExempt(user) && !isBiometricSetupTestAccess(user)) return <Navigate to="/biometric-setup" replace />;
    return <Navigate to="/employee/dashboard" replace />;
  }

  return children;
};

/**
 * Route Guard: Employee Digital Onboarding Gatekeeper
 * Only regular employees who haven't completed essential profile information (phone, birth_date, address)
 * can access /onboarding.
 * - Security guards: permanently routed to /scanner
 * - Admins: routed to /
 * - Already completed: routed to /biometric-setup (if un-enrolled) or /employee/dashboard
 */
export const OnboardingRoute = ({ children }) => {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/onboarding' }} />;
  }

  if (user.requires_password_change) {
    return <Navigate to="/force-password-change" replace />;
  }

  if (isSecurity(user)) {
    return <Navigate to="/scanner" replace />;
  }

  if (isAdmin(user)) {
    return <Navigate to="/" replace />;
  }

  if (!needsProfileCompletion(user)) {
    const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
    if (!hasBiometrics && !isMedicalExempt(user) && !isBiometricSetupTestAccess(user)) {
      return <Navigate to="/biometric-setup" replace />;
    }
    return <Navigate to="/employee/dashboard" replace />;
  }

  return children;
};

/**
 * Route Guard: Biometric Registration Gatekeeper
 * Strictly limits access to un-enrolled regular employees registering their account.
 * - Security guards: permanently routed to /scanner
 * - Admins / HR: routed to /
 * - Medical exempt or already registered employees: routed to /employee/dashboard
 */
export const BiometricSetupRoute = ({ children }) => {
  const user = getUser();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/biometric-setup' }} />;
  }

  if (user.requires_password_change) {
    return <Navigate to="/force-password-change" replace />;
  }

  if (isSecurity(user)) {
    return <Navigate to="/scanner" replace />;
  }

  if (isAdmin(user)) {
    return <Navigate to="/" replace />;
  }

  if (needsProfileCompletion(user)) {
    return <Navigate to="/onboarding" replace />;
  }

  const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
  if (hasBiometrics || isMedicalExempt(user) || isBiometricSetupTestAccess(user)) {
    return <Navigate to="/employee/dashboard" replace />;
  }

  return children;
};

// Route Guard: Public-Only Routes (Redirects already authenticated users)
export const PublicOnlyRoute = ({ children }) => {
  const user = getUser();
  if (user) {
    if (user.requires_password_change) return <Navigate to="/force-password-change" replace />;
    if (isSecurity(user)) return <Navigate to="/scanner" replace />;
    if (isAdmin(user)) return <Navigate to="/" replace />;
    if (needsProfileCompletion(user)) return <Navigate to="/onboarding" replace />;
    const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
    if (!hasBiometrics && !isMedicalExempt(user) && !isBiometricSetupTestAccess(user)) return <Navigate to="/biometric-setup" replace />;
    return <Navigate to="/employee/dashboard" replace />;
  }
  return children;
};

// Root Router: Dispatches user to their respective dashboard
export const RootRoute = () => {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.requires_password_change) return <Navigate to="/force-password-change" replace />;
  if (isSecurity(user)) return <Navigate to="/scanner" replace />;
  if (isAdmin(user)) return <Dashboard />;
  if (needsProfileCompletion(user)) return <Navigate to="/onboarding" replace />;
  const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
  if (!hasBiometrics && !isMedicalExempt(user) && !isBiometricSetupTestAccess(user)) return <Navigate to="/biometric-setup" replace />;
  return <Navigate to="/employee/dashboard" replace />;
};
