import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { API_BASE_URL } from '../utils/api';
import toast from 'react-hot-toast';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const ticket = searchParams.get('ticket');
  const emailParam = searchParams.get('email');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hasValidContext, setHasValidContext] = useState(false);

  const navigate = useNavigate();

  // Evaluate validity of context: ticket from SMS/Emergency OR Supabase recovery session
  useEffect(() => {
    let isMounted = true;

    async function evaluateContext() {
      if (ticket) {
        if (isMounted) setHasValidContext(true);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (isMounted) setHasValidContext(true);
        return;
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          if (isMounted) setHasValidContext(true);
        }
      });

      return () => {
        subscription?.unsubscribe();
      };
    }

    evaluateContext();

    return () => {
      isMounted = false;
    };
  }, [ticket]);

  // NIST Password Complexity Checkpoints
  const checks = {
    length: password.length >= 10,
    case: /[A-Z]/.test(password) && /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  const passedCount = Object.values(checks).filter(Boolean).length;
  const isEntropyCompliant = passedCount === 4;
  const isMatch = password && confirmPassword && password === confirmPassword;

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!isEntropyCompliant) {
      return setError('Please satisfy all password complexity requirements.');
    }

    if (!isMatch) {
      return setError('Passwords do not match.');
    }

    setLoading(true);

    try {
      if (ticket) {
        const res = await fetch(`${API_BASE_URL}/api/auth/security/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetTicket: ticket, newPassword: password }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update password.');
        }

        await supabase.auth.signOut().catch(() => {});
        localStorage.removeItem('user');

        setSuccess(true);
        toast.success('Password updated successfully!');
        setTimeout(() => navigate('/login', { replace: true }), 2000);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      await supabase.auth.signOut().catch(() => {});
      localStorage.removeItem('user');

      setSuccess(true);
      toast.success('Password updated successfully!');
      setTimeout(() => navigate('/login', { replace: true }), 2000);

    } catch (err) {
      console.error('[RESET_PASSWORD_ERROR]', err);
      setError(err.message || 'Error updating password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] w-screen flex flex-col justify-between items-center bg-slate-50 select-none p-4 sm:p-6 overflow-y-auto">
      <div className="pt-2 sm:pt-4" />

      {/* Corporate Auth Card (Aligned with Login.jsx) */}
      <div className="relative z-10 w-full max-w-[390px] bg-white border border-slate-200 rounded-xl shadow-xs p-6 sm:p-7">
        
        {/* Header */}
        <div className="text-center mb-5 sm:mb-6">
          <div className="inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-slate-900 text-white shadow-xs mb-2.5">
            <i className="ti ti-lock-check text-xl" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Set New Password</h1>
          <p className="text-slate-500 text-xs mt-0.5">Create a secure password for your account</p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-600 font-medium leading-relaxed">
            {error}
          </div>
        )}

        {/* Success View */}
        {success ? (
          <div className="text-center py-4 space-y-3">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-xl mx-auto border border-emerald-200">
              <i className="ti ti-check" />
            </div>
            <h2 className="text-base font-bold text-slate-900">Password Updated</h2>
            <p className="text-xs text-slate-500">Redirecting to login portal...</p>
          </div>
        ) : !hasValidContext && !ticket ? (
          /* Missing Session Guard */
          <div className="text-center py-3 space-y-3">
            <p className="text-xs text-slate-600 leading-relaxed">
              No active recovery session found. Please request a new password reset link.
            </p>
            <Link
              to="/forgot-password"
              className="inline-block w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
            >
              Back to Recovery
            </Link>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleUpdate} className="space-y-3.5">
            {emailParam && (
              <p className="text-xs text-slate-500 font-medium truncate ml-0.5">
                Account: <span className="font-semibold text-slate-800">{emailParam}</span>
              </p>
            )}

            {/* New Password Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">New Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-lock" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-sm`} />
                </button>
              </div>
            </div>

            {/* Compact Requirements Checklist */}
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-1 text-[11px]">
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.length ? 'ti-check text-emerald-600' : 'ti-point text-slate-400'} text-xs`} />
                <span className={checks.length ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  10+ characters
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.case ? 'ti-check text-emerald-600' : 'ti-point text-slate-400'} text-xs`} />
                <span className={checks.case ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  Upper &amp; lowercase letters
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.number ? 'ti-check text-emerald-600' : 'ti-point text-slate-400'} text-xs`} />
                <span className={checks.number ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  At least one number (0&ndash;9)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.special ? 'ti-check text-emerald-600' : 'ti-point text-slate-400'} text-xs`} />
                <span className={checks.special ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  At least one special character
                </span>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <div className="flex items-center justify-between mb-1 ml-0.5">
                <label className="block text-xs font-semibold text-slate-700">Confirm Password</label>
                {confirmPassword && (
                  <span className={`text-[10px] font-semibold ${isMatch ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {isMatch ? 'Matches' : 'Does not match'}
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-lock" />
                </div>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                  tabIndex={-1}
                >
                  <i className={`ti ${showConfirm ? 'ti-eye-off' : 'ti-eye'} text-sm`} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !isEntropyCompliant || !isMatch}
              className="w-full mt-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold py-2.5 sm:py-3 rounded-lg shadow-xs transition-transform duration-75 flex items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Updating...</span>
                </>
              ) : (
                <span>Update Password</span>
              )}
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-slate-100 text-center">
          <Link
            to="/login"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
          >
            Back to Login
          </Link>
        </div>
      </div>

      <div className="pb-2 sm:pb-4" />
    </div>
  );
}
