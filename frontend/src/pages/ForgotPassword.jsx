import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { API_BASE_URL } from '../utils/api';
import { useOtpCooldown } from '../utils/useOtpCooldown';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [restored] = useState(() => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
      const expires = parsed.email && sessionStorage.getItem(`cpoint_forgot_exp_${parsed.email}`);
      return { ...parsed, remaining: Math.max(0, Math.ceil((Number(expires) - Date.now()) / 1000)) || 0 };
    } catch { return {}; }
  });
  const [email, setEmail] = useState(restored.email || '');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [method, setMethod] = useState(restored.method || 'email'); // 'totp' | 'email' | 'key'
  const [step, setStep] = useState(restored.step === 2 ? 2 : 1);
  const [challengeId, setChallengeId] = useState(restored.challengeId || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [maskedPhone, setMaskedPhone] = useState(restored.email || '');
  
  // OTP state (for SMS flow)
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [previewCode, setPreviewCode] = useState(restored.previewCode || null);
  const otpInputsRef = useRef([]);
  const forgotSendLockRef = useRef(false);
  const lastForgotClickRef = useRef(0);
  const navigate = useNavigate();

  const { cooldown, isCooldown, startCooldown } = useOtpCooldown(
    'pwd_reset_dest_email_' + (email.trim().toLowerCase() || 'global'),
    60
  );

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

  // Handle Form Submission for Step 1 or Direct Dispatch
  const handleRequestReset = async (e, isResend = false, targetMethodOverride = null) => {
    if (e) e.preventDefault();

    const activeMethod = targetMethodOverride || method;

    // Double-click protection: Synchronous ref lock + 1500ms time throttle
    const now = Date.now();
    if (forgotSendLockRef.current || loading || (now - lastForgotClickRef.current < 1500)) {
      return;
    }
    lastForgotClickRef.current = now;
    forgotSendLockRef.current = true;

    // Cooldown only applies to outbound network gateways (email/sms), never offline TOTP or local Key
    const isOutboundGateway = activeMethod === 'email' || activeMethod === 'sms';

    if (!isResend && isOutboundGateway && cooldown > 0) {
      forgotSendLockRef.current = false;
      try {
        const saved = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
        if (saved.email && saved.email === email.trim().toLowerCase() && expiryTimer > 0) {
          toast.success('Resuming verification with your active code');
          setStep(2);
          return;
        }
      } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
      toast.error(`Please wait ${cooldown}s before requesting a new code, or enter your active code.`);
      return;
    }

    if (isResend && isOutboundGateway && cooldown > 0) {
      forgotSendLockRef.current = false;
      toast.error(`Please wait ${cooldown}s before requesting a new code.`);
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    // PATH 1: Google Authenticator (TOTP) - Zero dispatch delay, 100% offline generation
    if (activeMethod === 'totp') {
      try {
        setMethod('totp');
        setStep(2);
        try {
          sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
            email: email.trim().toLowerCase(),
            method: 'totp',
            step: 2
          }));
        } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
      } finally {
        forgotSendLockRef.current = false;
        setLoading(false);
      }
      return;
    }

    // PATH 2: Emergency Master Key Recovery (100% In-Browser UI, Zero CMD)
    if (activeMethod === 'key') {
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
        navigate('/reset-password', {
          replace: true,
          state: { resetTicket: data.resetTicket, email },
        });
      } catch (err) {
        console.error('[EMERGENCY_KEY_ERROR]', err);
        setError(err.message || 'Invalid Master Recovery Key.');
      } finally {
        forgotSendLockRef.current = false;
        setLoading(false);
      }
      return;
    }

    // PATH 3: Standard Dispatch (Email OTP)
    try {
      const targetIdentifier = email.trim().toLowerCase();
      const res = await fetch(`${API_BASE_URL}/api/auth/security/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetIdentifier, method: 'email', challengeId: isResend ? challengeId : undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.retry_after) {
          startCooldown(data.retry_after);
        }
        if (data.code === 'CHALLENGE_EXPIRED') {
          setChallengeId(null);
          setExpiryTimer(0);
          try {
            const saved = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
            sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({ ...saved, challengeId: null }));
            sessionStorage.removeItem(`cpoint_forgot_exp_${email.trim().toLowerCase()}`);
          } catch { /* Retry remains available without browser storage. */ }
        }
        throw new Error(data.error || 'Failed to dispatch security instructions.');
      }

      if (data.challengeId) setChallengeId(data.challengeId);
      startCooldown(data.cooldown || 60);

      const activeSeconds = data.expiresIn || 300;
      const expTime = Date.now() + activeSeconds * 1000;
      try {
        sessionStorage.setItem(`cpoint_forgot_exp_${email.trim().toLowerCase()}`, String(expTime));
      } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
      setExpiryTimer(activeSeconds);

      const resolvedMasked = email.trim().toLowerCase();
      const resolvedPreview = data.previewCode || null;

      setMaskedPhone(resolvedMasked);
      setPreviewCode(resolvedPreview);
      setMethod('email');
      setStep(2);

      // Persist step 2 recovery session so reloading or returning doesn't reset it
      try {
        sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
          email: email.trim().toLowerCase(),
          method: 'email',
          maskedPhone: resolvedMasked,
          previewCode: resolvedPreview,
          challengeId: data.challengeId || challengeId,
          step: 2
        }));
      } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }

      toast.success('If this account is eligible, check its registered inbox for a verification code.');
    } catch (err) {
      console.error('[FORGOT_PASSWORD_ERROR]', err);
      setError(err.message || 'Unable to connect to security authentication service.');
    } finally {
      forgotSendLockRef.current = false;
      setLoading(false);
    }
  };

  // Seamless Method Switching in Step 1
  const handleSelectMethod = (selectedMethod) => {
    setMethod(selectedMethod);
    setError(null);
  };

  // Seamless Method Switching in Step 2: Switch to Email
  const handleSwitchToEmailInStep2 = async () => {
    if (loading) return;
    setError(null);
    setOtp(['', '', '', '', '', '']);

    // Only resume a recovery code; a login or step-up cooldown does not imply one exists.
    if (expiryTimer > 0) {
      setMethod('email');
      try {
        const saved = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
        sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
          ...saved,
          method: 'email'
        }));
      } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
      toast.success('Switched to Email OTP. If eligible, enter the code from your registered inbox.');
      setTimeout(() => otpInputsRef.current[0]?.focus(), 50);
      return;
    }

    // Cooldown elapsed or fresh session: dispatch email code now
    await handleRequestReset(null, false, 'email');
    setTimeout(() => otpInputsRef.current[0]?.focus(), 50);
  };

  // Seamless Method Switching in Step 2: Switch to Authenticator
  const handleSwitchToTotpInStep2 = () => {
    if (loading) return;
    setError(null);
    setOtp(['', '', '', '', '', '']);
    setMethod('totp');
    try {
      const saved = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
      sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
        ...saved,
        method: 'totp'
      }));
    } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
    toast.success('Switched to Google Authenticator. Enter the 6-digit code from your app.');
    setTimeout(() => otpInputsRef.current[0]?.focus(), 50);
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
          method,
          challengeId
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed. Please check the code.');
      }

      toast.success('Identity verified. Redirecting to password reset...');
      try {
        sessionStorage.removeItem('cpoint_forgot_pwd_session');
        sessionStorage.removeItem(`cpoint_forgot_exp_${email.trim().toLowerCase()}`);
      } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
      navigate('/reset-password', {
        replace: true,
        state: { resetTicket: data.resetTicket, email },
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
              <source srcSet="/logo-dark.webp" type="image/webp" />
              <img 
                src="/logo-dark.png" 
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
          <div role="alert" className="mb-4 p-2.5 bg-danger-subtle border border-danger/20 rounded-md text-xs text-danger-ink font-medium leading-relaxed">
            {error}
          </div>
        )}

        {/* Global Success Banner */}
        {successMsg && (
          <div className="mb-4 p-2.5 bg-surface-muted border border-line rounded-md text-xs text-ink font-medium leading-relaxed">
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
                    <span>Recovery request active</span>
                  </span>
                  <span className="text-[11px] font-mono font-medium text-slate-700 bg-slate-200/80 px-1.5 py-0.5 rounded-sm">
                    {cooldown}s cooldown
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                  If this account is eligible, check its registered inbox. Recovery codes expire after 5 minutes.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMethod('email');
                      setStep(2);
                    }}
                    className="flex-1 h-8 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100 cursor-pointer"
                  >
                    <span>Enter Email Code</span>
                    <i className="ti ti-arrow-right text-xs" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMethod('totp');
                      setStep(2);
                    }}
                    className="h-8 px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-1 transition-colors duration-100 cursor-pointer"
                  >
                    <span>Use Authenticator</span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1 ml-0.5">
                <label htmlFor="recovery-identifier" className="block text-xs font-semibold text-slate-700">Workplace Email or Employee ID</label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-mail" />
                </div>
                <input maxLength={254}
                  id="recovery-identifier"
                  type="text"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  required
                  autoFocus
                  placeholder="name@company.com or CP-2026-..."
                  className="w-full h-9 pl-9 pr-3 bg-white border border-slate-300 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs"
                />
              </div>
            </div>

            {/* Segmented Control for Recovery Method */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Recovery Method</label>
              <div className="grid grid-cols-3 p-0.5 bg-slate-100 rounded-md border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => handleSelectMethod('totp')}
                  className={`h-7 font-medium rounded-sm transition-colors duration-100 cursor-pointer ${
                    method === 'totp'
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Verify with Google Authenticator"
                >
                  Authenticator
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectMethod('email')}
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
                  onClick={() => handleSelectMethod('key')}
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
                  <input maxLength={1024}
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
                (cooldown > 0 && (method === 'email' || method === 'sms'))
              }
              aria-busy={loading}
              className="w-full h-10 mt-2 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer bg-slate-900 hover:bg-slate-800"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Processing...</span>
                </>
              ) : cooldown > 0 && (method === 'email' || method === 'sms') ? (
                <span>Resend in {cooldown}s</span>
              ) : method === 'key' ? (
                <span>Verify Master Key</span>
              ) : method === 'totp' ? (
                <span>Continue with Authenticator</span>
              ) : (
                <span>Send Email Code</span>
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
                ) : (
                  <>If this account is eligible, enter the 6-digit code sent to its registered email.</>
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
                  Check your registered inbox and spam folder. If you cannot recover your account, contact HR.
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

            {/* In-Step 2 Real-Time Omnichannel Switcher */}
            <div className="pt-2 border-t border-slate-100 flex flex-col items-center justify-center">
              {method === 'totp' ? (
                <button
                  type="button"
                  onClick={handleSwitchToEmailInStep2}
                  disabled={loading}
                  className="text-xs text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1.5 transition-colors duration-100 cursor-pointer disabled:opacity-50"
                >
                  <i className="ti ti-mail text-slate-500" />
                  <span>Don't have your Authenticator app? <span className="font-semibold text-slate-900 underline">Send code to email</span></span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSwitchToTotpInStep2}
                  disabled={loading}
                  className="text-xs text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1.5 transition-colors duration-100 cursor-pointer disabled:opacity-50"
                >
                  <i className="ti ti-shield-lock text-slate-500" />
                  <span>Prefer your Authenticator app? <span className="font-semibold text-slate-900 underline">Use Authenticator</span></span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setOtp(['', '', '', '', '', '']);
                  setError(null);
                  try {
                    const saved = JSON.parse(sessionStorage.getItem('cpoint_forgot_pwd_session') || '{}');
                    sessionStorage.setItem('cpoint_forgot_pwd_session', JSON.stringify({
                      ...saved,
                      step: 1
                    }));
                  } catch { /* Retain the existing fallback when optional browser state is unavailable. */ }
                }}
                className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
              >
                &larr; Back
              </button>

              {method === 'totp' ? (
                <div className="flex items-center gap-1.5 text-slate-500 font-medium text-xs">
                  <span>Updates every 30s • Offline</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-slate-500 font-medium text-xs">
                  {expiryTimer > 0 ? (
                    <>
                      <span>Didn't receive the email?</span>
                      <button
                        type="button"
                        onClick={() => handleRequestReset(null, true, 'email')}
                        disabled={cooldown > 0 || loading}
                        style={{ pointerEvents: (cooldown > 0 || loading) ? 'none' : 'auto' }}
                        className="text-slate-700 hover:text-slate-900 hover:underline font-semibold disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        {loading ? 'Sending...' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-danger-ink font-semibold">Code expired.</span>
                      <span className="text-slate-300">•</span>
                      <button
                        type="button"
                        onClick={() => handleRequestReset(null, true, 'email')}
                        disabled={loading}
                        style={{ pointerEvents: loading ? 'none' : 'auto' }}
                        className="text-slate-700 hover:text-slate-900 hover:underline font-semibold cursor-pointer transition-colors"
                      >
                        {loading ? 'Sending...' : 'Request a new code'}
                      </button>
                    </>
                  )}
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
