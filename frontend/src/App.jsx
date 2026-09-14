import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { SpeedInsights } from '@vercel/speed-insights/react';

// Route Guards & Layouts
import { ProtectedRoute, PublicOnlyRoute, RootRoute } from './routes/guards';
import MainLayout from './layouts/MainLayout';
import useBiometricProtection from './utils/useBiometricProtection';
import './index.css';

// Auth Pages
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ForcePasswordChange from './pages/ForcePasswordChange';
import BiometricSetup from './pages/BiometricSetup';
import VerifyEmail from './pages/VerifyEmail';

// Lazy Loaded Core Flow Pages (Code-Split for sub-second initial loads)
const Dashboard = lazy(() => import('./pages/Dashboard'));
const EmployeeDashboard = lazy(() => import('./pages/EmployeeDashboard'));
const Scanner = lazy(() => import('./pages/Scanner'));

// Admin - Attendance
const AttendanceIndex = lazy(() => import('./pages/admin/attendance/Index'));
const AttendanceCalendar = lazy(() => import('./pages/admin/attendance/Calendar'));

// Admin - Employees
const EmployeeIndex = lazy(() => import('./pages/admin/employees/Index'));
const EmployeeCreate = lazy(() => import('./pages/admin/employees/Create'));
const EmployeeEdit = lazy(() => import('./pages/admin/employees/Edit'));
const EmployeeShow = lazy(() => import('./pages/admin/employees/Show'));
const EmployeeQrPrint = lazy(() => import('./pages/admin/employees/QrPrint'));

// Admin - Payroll
const StatutorySettings = lazy(() => import('./pages/admin/payroll/StatutorySettings'));
const PayrollIndex = lazy(() => import('./pages/admin/payroll/Index'));
const PayrollCreate = lazy(() => import('./pages/admin/payroll/Create'));
const PayrollShow = lazy(() => import('./pages/admin/payroll/Show'));

// Admin - Operations
const AuditLogsIndex = lazy(() => import('./pages/admin/audit-logs/Index'));
const LeavesIndex = lazy(() => import('./pages/admin/leaves/Index'));
const DisciplinaryIndex = lazy(() => import('./pages/admin/disciplinary/Index'));
const Documents = lazy(() => import('./pages/admin/documents/Documents'));

// Admin - Archive (Lazy loaded to keep initial bundle lean)
const EmployeeArchive = lazy(() => import('./pages/admin/archive/EmployeeArchive'));
const ArchivedEmployeeProfile = lazy(() => import('./pages/admin/archive/ArchivedEmployeeProfile'));

// Employee Portal Flow
const MyQr = lazy(() => import('./pages/employee/MyQr'));
const EmployeeScanner = lazy(() => import('./pages/employee/Scanner'));
const MyProfile = lazy(() => import('./pages/employee/MyProfile'));

function App() {
  // Global Biometric Photo & Avatar Protection (Anti-Save, Anti-Drag, Anti-New-Tab)
  useBiometricProtection();

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
        {/* Public / Authentication Flow */}
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route path="/forgot-password" element={<PublicOnlyRoute><ForgotPassword /></PublicOnlyRoute>} />
        <Route path="/reset-password" element={<PublicOnlyRoute><ResetPassword /></PublicOnlyRoute>} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Mandatory Setup Routes */}
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="/biometric-setup" element={<ProtectedRoute><BiometricSetup /></ProtectedRoute>} />

        {/* Standalone Fullscreen Terminal Views */}
        <Route
          path="/scanner"
          element={
            <ProtectedRoute allowedRoles={['security', 'guard', 'security_guard', 'admin', 'superadmin', 'hr']}>
              <Suspense fallback={<div className="h-screen w-screen bg-black" />}><Scanner /></Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/employees/:id/qr"
          element={
            <ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics>
              <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-600 rounded-full animate-spin" /></div>}>
                <EmployeeQrPrint />
              </Suspense>
            </ProtectedRoute>
          }
        />

        {/* Authenticated Persistent Shell */}
        <Route element={<ProtectedRoute requireBiometrics><MainLayout /></ProtectedRoute>}>
          <Route path="/" element={<RootRoute />} />

          {/* Admin - Employees Directory */}
          <Route path="/admin/employees" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeIndex /></ProtectedRoute>} />
          <Route path="/admin/employees/create" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeCreate /></ProtectedRoute>} />
          <Route path="/admin/employees/:id/edit" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeEdit /></ProtectedRoute>} />
          <Route path="/admin/employees/:id" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeShow /></ProtectedRoute>} />

          {/* Admin - Attendance */}
          <Route path="/admin/attendance" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><AttendanceIndex /></ProtectedRoute>} />
          <Route path="/admin/attendance/calendar" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><AttendanceCalendar /></ProtectedRoute>} />

          {/* Admin - Payroll Ledger & Processing */}
          <Route path="/admin/payroll/statutory-settings" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><StatutorySettings /></ProtectedRoute>} />
          <Route path="/admin/payroll" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><PayrollIndex /></ProtectedRoute>} />
          <Route path="/admin/payroll/process" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><PayrollCreate /></ProtectedRoute>} />
          <Route path="/admin/payroll/:id" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><PayrollShow /></ProtectedRoute>} />

          {/* Admin - Operations & Governance */}
          <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><AuditLogsIndex /></ProtectedRoute>} />
          <Route path="/admin/leaves" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><LeavesIndex /></ProtectedRoute>} />
          <Route path="/admin/disciplinary" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><DisciplinaryIndex /></ProtectedRoute>} />
          
          {/* Admin - Documents & Archive */}
          <Route path="/admin/documents" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><Documents /></ProtectedRoute>} />
          <Route path="/admin/archive" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><EmployeeArchive /></ProtectedRoute>} />
          <Route path="/admin/archive/:id" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'hr']} requireBiometrics><ArchivedEmployeeProfile /></ProtectedRoute>} />

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