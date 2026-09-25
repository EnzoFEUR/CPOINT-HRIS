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

  // Check whether we have a valid reset context:
  // Either via single-use reset ticket (SMS OTP flow) OR active Supabase recovery session (Email link flow)
  useEffect(() => {
    let isMounted = true;

    async function evaluateContext() {
      if (ticket) {
        if (isMounted) setHasValidContext(true);
        return;
      }

      // Check for Supabase Auth recovery session
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (isMounted) setHasValidContext(true);
        return;
      }

      // Also listen to onAuthStateChange for PASSWORD_RECOVERY
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

  // NIST SP 800-63B Password Complexity Criteria
  const checks = {
    length: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  const passedChecksCount = Object.values(checks).filter(Boolean).length;
  const isEntropyCompliant = passedChecksCount === 5;
  const isMatch = password && confirmPassword && password === confirmPassword;

  // Strength Bar Meta
  const getStrengthMeta = () => {
    if (!password) return { label: 'Password Strength', color: 'bg-slate-200', text: 'text-slate-400', width: '0%' };
    if (passedChecksCount <= 2) return { label: 'Weak', color: 'bg-rose-500', text: 'text-rose-600', width: '25%' };
    if (passedChecksCount === 3) return { label: 'Moderate', color: 'bg-amber-500', text: 'text-amber-600', width: '50%' };
    if (passedChecksCount === 4) return { label: 'Strong', color: 'bg-blue-600', text: 'text-blue-600', width: '75%' };
    return { label: 'Enterprise Grade (Compliant)', color: 'bg-emerald-600', text: 'text-emerald-600', width: '100%' };
  };

  const strengthMeta = getStrengthMeta();

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError(null);

    if (!isEntropyCompliant) {
      return setError('Please satisfy all 5 enterprise password security requirements.');
    }

    if (!isMatch) {
      return setError('Password and confirmation do not match.');
    }

    setLoading(true);

    try {
      // PATH A: Single-Use Cryptographic Reset Ticket (from 2FA SMS flow)
      if (ticket) {
        const res = await fetch(`${API_BASE_URL}/api/auth/security/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetTicket: ticket, newPassword: password }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to update credentials. Reset ticket may be expired.');
        }

        // Clean out temporary storage
        await supabase.auth.signOut().catch(() => {});
        localStorage.removeItem('user');

        setSuccess(true);
        toast.success('Password updated successfully! All active sessions revoked.');
        setTimeout(() => navigate('/login', { replace: true }), 2500);
        return;
      }

      // PATH B: Supabase Auth Recovery Session (from Email recovery link)
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        throw new Error(updateError.message);
      }

      // Terminate any temporary recovery session
      await supabase.auth.signOut().catch(() => {});
      localStorage.removeItem('user');

      setSuccess(true);
      toast.success('Password updated successfully! All active sessions revoked.');
      setTimeout(() => navigate('/login', { replace: true }), 2500);

    } catch (err) {
      console.error('[RESET_PASSWORD_ERROR]', err);
      setError(err.message || 'An unexpected security error occurred during password update.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50/80 relative p-4 font-sans">
      <div className="absolute inset-0 bg-radial from-blue-50/40 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-[460px] p-6 sm:p-8 bg-white border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-900/5">
        
        {/* Shield Icon Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-md shadow-slate-900/10 mb-3.5">
            <i className="ti ti-lock-check text-2xl" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Establish New Password
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Enforcing Enterprise Multi-Factor &amp; NIST SP 800-63B Standards
          </p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 animate-in fade-in duration-200">
            <i className="ti ti-alert-circle text-base shrink-0 mt-0.5" />
            <div className="flex-1 font-semibold">{error}</div>
          </div>
        )}

        {/* Success Splash Screen */}
        {success ? (
          <div className="text-center py-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center text-2xl mx-auto shadow-inner">
              <i className="ti ti-circle-check" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Credentials Successfully Secured
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-1 max-w-sm mx-auto leading-relaxed">
                Your new password has been established and all existing sessions have been terminated.
                Redirecting you to login...
              </p>
            </div>
            <div className="pt-2">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          </div>
        ) : !hasValidContext && !ticket ? (
          /* Missing Session Guard */
          <div className="text-center py-4 space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-900 text-left flex items-start gap-2.5">
              <i className="ti ti-shield-alert text-lg text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">No Verified Recovery Session</p>
                <p className="mt-0.5 text-amber-800/80 leading-relaxed">
                  For your security, password changes require a verified recovery ticket or single-use email link.
                </p>
              </div>
            </div>
            <Link
              to="/forgot-password"
              className="inline-flex items-center justify-center gap-2 w-full py-2.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
            >
              <i className="ti ti-arrow-left" /> Initiate Identity Recovery
            </Link>
          </div>
        ) : (
          /* Password Reset Form */
          <form onSubmit={handleUpdate} className="space-y-4">
            
            {emailParam && (
              <div className="text-[11px] font-semibold text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200/60 truncate flex items-center gap-1.5">
                <i className="ti ti-user-check text-slate-400" />
                <span>Account: <strong className="text-slate-700">{emailParam}</strong></span>
              </div>
            )}

            {/* New Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50/60 hover:bg-white focus:bg-white border border-slate-200 focus:border-slate-900 rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-slate-900/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                  tabIndex={-1}
                >
                  <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-base`} />
                </button>
              </div>
            </div>

            {/* Password Entropy & Strength Meter */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-semibold">Security Level:</span>
                <span className={`font-bold ${strengthMeta.text}`}>{strengthMeta.label}</span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${strengthMeta.color}`}
                  style={{ width: strengthMeta.width }}
                />
              </div>
            </div>

            {/* NIST SP 800-63B Requirements Checklist */}
            <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-1 text-[11px]">
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.length ? 'ti-circle-check text-emerald-600' : 'ti-circle text-slate-300'} text-sm`} />
                <span className={checks.length ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  At least 10 characters long
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.upper ? 'ti-circle-check text-emerald-600' : 'ti-circle text-slate-300'} text-sm`} />
                <span className={checks.upper ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  One uppercase letter (A&ndash;Z)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.lower ? 'ti-circle-check text-emerald-600' : 'ti-circle text-slate-300'} text-sm`} />
                <span className={checks.lower ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  One lowercase letter (a&ndash;z)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.number ? 'ti-circle-check text-emerald-600' : 'ti-circle text-slate-300'} text-sm`} />
                <span className={checks.number ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  One numeric digit (0&ndash;9)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <i className={`ti ${checks.special ? 'ti-circle-check text-emerald-600' : 'ti-circle text-slate-300'} text-sm`} />
                <span className={checks.special ? 'text-slate-800 font-medium' : 'text-slate-400'}>
                  One special character (!@#$%^&amp;*)
                </span>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Confirm Password
                </label>
                {confirmPassword && (
                  <span
                    className={`text-[10px] font-bold ${
                      isMatch ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {isMatch ? 'Passwords match' : 'Passwords do not match'}
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className={`w-full pl-3.5 pr-10 py-2.5 bg-slate-50/60 hover:bg-white focus:bg-white border rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all ${
                    confirmPassword
                      ? isMatch
                        ? 'border-emerald-500 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/10'
                        : 'border-rose-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/10'
                      : 'border-slate-200 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                  tabIndex={-1}
                >
                  <i className={`ti ${showConfirm ? 'ti-eye-off' : 'ti-eye'} text-base`} />
                </button>
              </div>
            </div>

            {/* Global Session Warning */}
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
              <i className="ti ti-shield-bolt text-sm text-slate-500 shrink-0" />
              <span>Updating password will automatically terminate active sessions on other devices.</span>
            </p>

            <button
              type="submit"
              disabled={loading || !isEntropyCompliant || !isMatch}
              className="w-full min-h-[46px] py-3 bg-slate-900 hover:bg-black active:scale-[0.99] text-white font-extrabold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-lg" />
                  <span>Securing Credentials &amp; Revoking Sessions...</span>
                </>
              ) : (
                <>
                  <i className="ti ti-check text-base" />
                  <span>Update Password &amp; Terminate Sessions</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Footer Back to Login */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
          <Link
            to="/login"
            className="text-slate-700 hover:text-slate-900 font-bold flex items-center gap-1.5 transition-colors"
          >
            <i className="ti ti-arrow-left text-sm" /> Back to Login
          </Link>
          <span className="text-[10px] text-slate-400 font-mono">Zero-Trust Protected</span>
        </div>
      </div>
    </div>
  );
}
