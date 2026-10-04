import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { API_BASE_URL } from '../utils/api';
import { useOtpCooldown } from '../utils/useOtpCooldown';
import toast from 'react-hot-toast';
import logoDark from '../assets/logo-dark.png';
import logoDarkWebp from '../assets/logo-dark.webp';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [method, setMethod] = useState('totp'); // 'totp' | 'email' | 'key'
  const [step, setStep] = useState(1); // 1 = Request, 2 = Verify Code
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [maskedPhone, setMaskedPhone] = useState('');
  
  // OTP state (for SMS flow)
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [previewCode, setPreviewCode] = useState(null);
  const otpInputsRef = useRef([]);
  const navigate = useNavigate();

  // Enterprise persistent OTP cooldown hook (persists across page reloads/navigation)
  const { cooldown, isCooldown, startCooldown, clearCooldown } = useOtpCooldown(
    'forgot_pwd_' + (email.trim().toLowerCase() || 'global'),
    60
  );

  // Real-time workplace account verification
  const [accountStatus, setAccountStatus] = useState(null); // null | 'checking' | 'verified' | 'not_found' | 'no_email' | 'inactive'
  const [accountInfo, setAccountInfo] = useState(null);

  // Real-time low-latency workplace account existence check (<15ms)
  useEffect(() => {
    const query = email.trim();
    if (!query || query.length < 3) {
      setAccountStatus(null);
      setAccountInfo(null);
      return;
    }

    setAccountStatus('checking');
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/security/verify-workplace-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: query }),
          signal: controller.signal
        });
        const data = await res.json();

        if (!data.exists) {
          setAccountStatus('not_found');
          setAccountInfo({ error: data.error || 'No registered workplace account found.' });
        } else if (!data.eligible) {
          if (data.hasEmail === false) {
            setAccountStatus('no_email');
          } else {
            setAccountStatus('inactive');
          }
          setAccountInfo(data);
        } else {
          setAccountStatus('verified');
          setAccountInfo(data);
          if (data.has_totp) {
            setMethod('totp');
          } else {
            setMethod('email');
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setAccountStatus(null);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [email]);

  // 5-minute code expiration timer
  const [expiryTimer, setExpiryTimer] = useState(() => {
    try {
      const exp = sessionStorage.getItem(`cpoint_forgot_exp_${email.trim().toLowerCase() || 'global'}`);
      if (!exp) return 0;
      const diff = Math.ceil((parseInt(exp, 10) - Date.now()) / 1000);
      return diff > 0 ? diff : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    let timer;
    if (expiryTimer > 0) {
      timer = setInterval(() => {
        setExpiryTimer((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [expiryTimer]);

  // Restore active recovery step if page is refreshed or navigated back
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('cpoint_forgot_pwd_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.email) {
          setEmail(parsed.email);
          const exp = sessionStorage.getItem(`cpoint_forgot_exp_${parsed.email}`);
          if (exp) {
            const diff = Math.ceil((parseInt(exp, 10) - Date.now()) / 1000);
            if (diff > 0) setExpiryTimer(diff);
          }
        }
        if (parsed.method) setMethod(parsed.method);
        if (parsed.maskedPhone) setMaskedPhone(parsed.maskedPhone);
        if (parsed.previewCode) setPreviewCode(parsed.previewCode);
        if (parsed.step === 2) setStep(2);
      }
    } catch {}
  }, []);

  // Handle Form Submission for Step 1
  const handleRequestReset = async (e, isResend = false) => {
    if (e) e.preventDefault();
    if (!isResend && cooldown > 0 && method !== 'key') {
      try {
        const saved = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
        if (saved.email && saved.email === email.trim().toLowerCase()) {
          toast.success('Resuming verification with your active code');
          setStep(2);
          return;
        }
      } catch {}
      toast.error(`Please wait ${cooldown}s before requesting a new code, or enter your active code.`);
      return;
    }

    if (isResend && cooldown > 0) {
      toast.error(`Please wait ${cooldown}s before requesting a new code.`);
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    // PATH 1: Google Authenticator (TOTP) - Zero dispatch delay
    if (method === 'totp') {
      if (accountStatus === 'not_found') {
        const msg = 'No registered workplace account matches this email or Employee ID.';
        setError(msg);
        toast.error(msg);
        setLoading(false);
        return;
      }
      setStep(2);
      try {
        sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
          email: email.trim().toLowerCase(),
          method: 'totp',
          step: 2
        }));
      } catch {}
      setLoading(false);
      return;
    }

    // PATH 2: Emergency Master Key Recovery (100% In-Browser UI, Zero CMD)
    if (method === 'key') {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/security/verify-emergency-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            recoveryKey: recoveryKey.trim(),
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Emergency key verification failed.');
        }

        toast.success('Identity verified. Redirecting to password reset...');
        navigate(`/reset-password?ticket=${data.resetTicket}&email=${encodeURIComponent(email)}`, {
          replace: true,
        });
      } catch (err) {
        console.error('[EMERGENCY_KEY_ERROR]', err);
        setError(err.message || 'Invalid Master Recovery Key.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // PATH 2: Standard Dispatch (SMS OTP or Email Link)
    try {
      if (!isResend) {
        if (accountStatus === 'not_found') {
          const msg = 'No registered workplace account matches this email or Employee ID. You can only reset password if you have a registered account.';
          setError(msg);
          toast.error(msg);
          setLoading(false);
          return;
        }
        if (accountStatus === 'no_email') {
          const msg = 'This account does not have a registered workplace email on file. Please contact HR or your supervisor for an in-person credential reset.';
          setError(msg);
          toast.error(msg);
          setLoading(false);
          return;
        }
        if (accountStatus === 'inactive') {
          const msg = `This workplace account is currently ${accountInfo?.status || 'inactive'}. Password recovery is unavailable. Please contact HR.`;
          setError(msg);
          toast.error(msg);
          setLoading(false);
          return;
        }
      }

      const targetIdentifier = accountInfo?.email || email.trim().toLowerCase();
      const res = await fetch(`${API_BASE_URL}/api/auth/security/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetIdentifier, method }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.retry_after) {
          startCooldown(data.retry_after);
        }
        throw new Error(data.error || 'Failed to dispatch security instructions.');
      }

      startCooldown(data.cooldown || 60);

      const activeSeconds = data.expiresIn || 300;
      const expTime = Date.now() + activeSeconds * 1000;
      try {
        sessionStorage.setItem(`cpoint_forgot_exp_${email.trim().toLowerCase()}`, String(expTime));
      } catch {}
      setExpiryTimer(activeSeconds);

      const resolvedMasked = method === 'sms' 
        ? (data.maskedPhone || 'your registered corporate phone')
        : email.trim().toLowerCase();
      const resolvedPreview = data.previewCode || null;

      setMaskedPhone(resolvedMasked);
      setPreviewCode(resolvedPreview);
      setStep(2);

      // Persist step 2 recovery session so reloading or returning doesn't reset it
      try {
        sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
          email: email.trim().toLowerCase(),
          method,
          maskedPhone: resolvedMasked,
          previewCode: resolvedPreview,
          step: 2
        }));
      } catch {}

      toast.success(
        isResend
          ? `Verification code resent to ${resolvedMasked}`
          : (method === 'sms' 
              ? `Verification code sent to ${resolvedMasked}`
              : `Verification code dispatched to ${resolvedMasked}`)
      );
    } catch (err) {
      console.error('[FORGOT_PASSWORD_ERROR]', err);
      setError(err.message || 'Unable to connect to security authentication service.');
    } finally {
      setLoading(false);
    }
  };

  // OTP Input Handlers
  const handleOtpChange = (index, value) => {
    if (value && !/^\d+$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    if (newOtp.every((digit) => digit !== '') && index === 5) {
      handleVerifyOtp(newOtp.join(''));
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handlePasteOtp = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newOtp = [...otp];
    for (let i = 0; i < pasted.length; i++) {
      newOtp[i] = pasted[i];
    }
    setOtp(newOtp);

    if (pasted.length === 6) {
      handleVerifyOtp(pasted);
    } else {
      otpInputsRef.current[pasted.length]?.focus();
    }
  };

  // Verify OTP & Navigate to Reset Password
  const handleVerifyOtp = async (codeToVerify) => {
    const code = codeToVerify || otp.join('');
    if (code.length < 6) {
      return setError('Please enter the complete 6-digit code.');
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/security/verify-reset-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: email.trim().toLowerCase(), 
          otp: code,
          method
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed. Please check the code.');
      }

      toast.success('Identity verified. Redirecting to password reset...');
      clearCooldown();
      try {
        sessionStorage.removeItem('cpoint_forgot_pwd_session');
        sessionStorage.removeItem(`cpoint_forgot_exp_${email.trim().toLowerCase()}`);
      } catch {}
      navigate(`/reset-password?ticket=${data.resetTicket}&email=${encodeURIComponent(email)}`, {
        replace: true,
      });
    } catch (err) {
      console.error('[OTP_VERIFY_ERROR]', err);
      setError(err.message || 'Invalid or expired security code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] w-screen flex flex-col justify-between items-center bg-slate-50 select-none p-4 sm:p-6 overflow-y-auto">
      <div className="pt-2 sm:pt-4" />

      {/* Corporate Auth Card (Aligned with Login.jsx) */}
      <div className="relative z-10 w-full max-w-[390px] bg-white border border-slate-200 rounded-xl shadow-xl p-6 sm:p-7">
        
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center mb-4">
            <picture>
              <source srcSet={logoDarkWebp} type="image/webp" />
              <img 
                src={logoDark} 
                alt="C-Point HRIS" 
                width="200"
                height="44"
                decoding="async"
                className="h-10 sm:h-11 w-auto max-w-[200px] object-contain select-none" 
              />
            </picture>
          </div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Account Recovery</h1>
          <p className="text-slate-500 text-xs mt-1">Verify your identity to reset your password</p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700 font-medium leading-relaxed">
            {error}
          </div>
        )}

        {/* Global Success Banner */}
        {successMsg && (
          <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 font-medium leading-relaxed">
            {successMsg}
          </div>
        )}

        {/* STEP 1: Input and Method Selection */}
        {step === 1 && (
          <form onSubmit={handleRequestReset} className="space-y-3.5">
            {/* Active Code Resume Card */}
            {isCooldown && maskedPhone && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-left shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <span>Code active via {method === 'sms' ? 'SMS' : 'Email'}</span>
                  </span>
                  <span className="text-[11px] font-mono font-medium text-slate-700 bg-slate-200/80 px-1.5 py-0.5 rounded-sm">
                    {cooldown}s cooldown
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                  Your security code was dispatched to {maskedPhone} and remains valid for 5 minutes.
                </p>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full h-9 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100 cursor-pointer"
                >
                  <span>Enter Existing Code</span>
                  <i className="ti ti-arrow-right text-xs" />
                </button>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1 ml-0.5">
                <label className="block text-xs font-semibold text-slate-700">Workplace Email or Employee ID</label>
                {accountStatus === 'checking' && (
                  <span className="text-[10px] text-slate-500 font-medium flex items-center gap-1">
                    <i className="ti ti-loader-2 animate-spin text-[11px]" />
                    <span>Verifying...</span>
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-mail" />
                </div>
                <input
                  type="text"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  required
                  autoFocus
                  placeholder="name@company.com or CP-2026-..."
                  className={`w-full h-9 pl-9 pr-3 bg-white border rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none transition-colors duration-100 shadow-2xs ${
                    accountStatus === 'verified'
                      ? 'border-emerald-500 focus:border-emerald-600'
                      : accountStatus === 'not_found'
                      ? 'border-rose-400 focus:border-rose-500 bg-rose-50/20'
                      : accountStatus === 'no_email'
                      ? 'border-amber-400 focus:border-amber-500 bg-amber-50/20'
                      : 'border-slate-300 focus:border-slate-500'
                  }`}
                />
              </div>

              {/* Real-Time Workplace Account Verification Feedback */}
              {accountStatus === 'verified' && accountInfo && (
                <div className="mt-2 p-2.5 bg-emerald-50/90 border border-emerald-200 rounded-md text-xs text-emerald-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <i className="ti ti-circle-check text-emerald-600 text-base shrink-0" />
                      <div>
                        <span className="font-bold text-slate-900">{accountInfo.name}</span>
                        <span className="text-[11px] text-emerald-700 block">
                          {accountInfo.company_id ? `${accountInfo.company_id} • ` : ''}{accountInfo.role?.toUpperCase()} • Active Account
                        </span>
                        {accountInfo.email && accountInfo.email !== email.trim().toLowerCase() && (
                          <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                            Work Email: {accountInfo.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-sm border border-emerald-200 shrink-0">
                      Verified
                    </span>
                  </div>
                </div>
              )}

              {accountStatus === 'not_found' && (
                <div className="mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-700 flex items-start gap-2">
                  <i className="ti ti-alert-circle text-rose-500 text-base shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-rose-800 block">No Registered Account Found</span>
                    <span className="text-[11px] text-rose-600 leading-relaxed block mt-0.5">
                      You can only reset your password if you have a registered workplace account. Please check your spelling or contact HR.
                    </span>
                  </div>
                </div>
              )}

              {accountStatus === 'no_email' && accountInfo && (
                <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 flex items-start gap-2">
                  <i className="ti ti-alert-triangle text-amber-600 text-base shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-amber-900 block">{accountInfo.name} ({accountInfo.company_id})</span>
                    <span className="text-[11px] text-amber-700 leading-relaxed block mt-0.5">
                      This employee account does not have a registered workplace email on file. Please contact HR or your supervisor for an in-person credential reset.
                    </span>
                  </div>
                </div>
              )}

              {accountStatus === 'inactive' && accountInfo && (
                <div className="mt-2 p-2.5 bg-slate-100 border border-slate-300 rounded-md text-xs text-slate-700 flex items-start gap-2">
                  <i className="ti ti-ban text-slate-500 text-base shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-900 block">{accountInfo.name} ({accountInfo.company_id})</span>
                    <span className="text-[11px] text-slate-600 leading-relaxed block mt-0.5">
                      This account is currently {accountInfo.status || 'inactive'}. Password recovery is disabled. Please contact System Administration.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Segmented Control for Recovery Method */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Recovery Method</label>
              <div className="grid grid-cols-3 p-0.5 bg-slate-100 rounded-md border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setMethod('totp')}
                  className={`h-7 font-medium rounded-sm transition-colors duration-100 cursor-pointer ${
                    method === 'totp'
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Authenticator
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className={`h-7 font-medium rounded-sm transition-colors duration-100 cursor-pointer ${
                    method === 'email'
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Email OTP
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('key')}
                  className={`h-7 font-medium rounded-sm transition-colors duration-100 cursor-pointer ${
                    method === 'key'
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Emergency Master Recovery Key"
                >
                  Master Key
                </button>
              </div>
            </div>

            {/* Emergency Master Key Input (Only visible when Master Key selected) */}
            {method === 'key' && (
              <div className="space-y-1 pt-0.5">
                <div className="flex items-center justify-between ml-0.5">
                  <label className="block text-xs font-semibold text-slate-700">Master Passphrase</label>
                  <button
                    type="button"
                    onClick={() => setRecoveryKey('CPOINT-RECOVERY-2026')}
                    className="text-[10px] text-slate-600 hover:text-slate-900 hover:underline font-semibold cursor-pointer"
                  >
                    Demo key
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                    <i className="ti ti-key" />
                  </div>
                  <input
                    type="password"
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    required={method === 'key'}
                    placeholder="Enter Master Recovery Key"
                    className="w-full h-9 pl-9 pr-3 bg-white border border-slate-300 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs font-mono"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                (cooldown > 0 && method !== 'key' && method !== 'totp') ||
                accountStatus === 'checking' ||
                accountStatus === 'not_found' ||
                accountStatus === 'no_email' ||
                accountStatus === 'inactive'
              }
              className={`w-full h-10 mt-2 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer ${
                accountStatus === 'not_found'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : accountStatus === 'no_email'
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : accountStatus === 'inactive'
                  ? 'bg-slate-500 hover:bg-slate-600'
                  : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Processing...</span>
                </>
              ) : accountStatus === 'checking' ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Checking Directory...</span>
                </>
              ) : accountStatus === 'not_found' ? (
                <>
                  <i className="ti ti-ban text-sm" />
                  <span>No Registered Account</span>
                </>
              ) : accountStatus === 'no_email' ? (
                <>
                  <i className="ti ti-alert-triangle text-sm" />
                  <span>No Workplace Email on File</span>
                </>
              ) : accountStatus === 'inactive' ? (
                <>
                  <i className="ti ti-lock text-sm" />
                  <span>Account Inactive</span>
                </>
              ) : cooldown > 0 && method !== 'key' && method !== 'totp' ? (
                <span>Resend in {cooldown}s</span>
              ) : method === 'key' ? (
                <span>Verify Master Key</span>
              ) : method === 'totp' ? (
                <span>Continue with Authenticator</span>
              ) : (
                <span>Dispatch Email Code</span>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: 6-Digit Authenticator / Email OTP Verification */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs text-slate-600">
                {method === 'totp' ? (
                  <>Enter the 6-digit code from your <span className="font-semibold text-slate-900">Google Authenticator</span> app</>
                ) : method === 'email' ? (
                  <>Enter the 6-digit code sent to your email <span className="font-semibold text-slate-900">{maskedPhone}</span></>
                ) : (
                  <>Enter the 6-digit code sent to <span className="font-semibold text-slate-900">{maskedPhone}</span></>
                )}
              </p>
            </div>

            {/* Test Sandbox 1-Click Code (for SMS or Simulation) */}
            {previewCode && (
              <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-800 shadow-2xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-semibold text-slate-700 shrink-0">Demo Code:</span>
                  <strong className="font-mono text-sm tracking-wider text-slate-950 font-bold">{previewCode}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const digits = previewCode.split('');
                    setOtp(digits);
                    handleVerifyOtp(previewCode);
                  }}
                  className="h-7 px-2.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold rounded-md shadow-2xs transition-colors duration-100 cursor-pointer shrink-0"
                >
                  1-Click Autofill
                </button>
              </div>
            )}

            {/* Real Brevo Email Notice */}
            {method === 'email' && !previewCode && (
              <div className="flex items-start gap-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700">
                <i className="ti ti-mail-check text-base text-slate-800 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Real-time security code dispatched via Brevo Mail Gateway. Please check your inbox and spam folder.
                </p>
              </div>
            )}

            {/* 6 Digit Input Boxes */}
            <div className="flex justify-between items-center gap-1.5 sm:gap-2">
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (otpInputsRef.current[idx] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  onPaste={handlePasteOtp}
                  className="w-10 h-11 sm:w-11 sm:h-12 text-center font-mono font-bold text-base bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => handleVerifyOtp()}
              disabled={loading || otp.join('').length < 6}
              className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify &amp; Continue</span>
              )}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setOtp(['', '', '', '', '', '']);
                }}
                className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
              >
                &larr; Back
              </button>

              {method === 'totp' ? (
                <div className="flex items-center gap-1.5 text-slate-500 font-medium text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Updates every 30s • Offline</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-slate-400 font-medium text-xs">
                  <span>
                    Expires in{' '}
                    <strong className="text-slate-700 font-mono">
                      {expiryTimer > 0
                        ? `${Math.floor(expiryTimer / 60)}:${String(expiryTimer % 60).padStart(2, '0')}`
                        : '0:00'}
                    </strong>
                  </span>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleRequestReset(null, true)}
                    disabled={cooldown > 0 || loading}
                    className="text-slate-700 hover:text-slate-900 hover:underline font-semibold disabled:text-slate-400 disabled:no-underline cursor-pointer"
                  >
                    {cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend code'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Back to Login */}
        <div className="mt-5 pt-4 border-t border-slate-100 text-center">
          <Link
            to="/login"
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 hover:underline transition-colors duration-100"
          >
            Back to Login
          </Link>
        </div>
      </div>

      {/* Bottom spacer */}
      <div className="pb-2 sm:pb-4" />
    </div>
  );
}
