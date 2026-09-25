import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { API_BASE_URL } from '../utils/api';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [method, setMethod] = useState('sms'); // 'sms' | 'email' | 'key'
  const [step, setStep] = useState(1); // 1 = Request, 2 = Verify SMS OTP
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [maskedPhone, setMaskedPhone] = useState('');
  
  // OTP state (for SMS flow)
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [previewCode, setPreviewCode] = useState(null);
  const otpInputsRef = useRef([]);

  // Cooldown countdown timer (in seconds)
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();

  // Cooldown ticker
  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  // Handle Form Submission for Step 1
  const handleRequestReset = async (e) => {
    if (e) e.preventDefault();
    if (cooldown > 0 && method !== 'key') return;

    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    // PATH 1: Emergency Master Key Recovery (100% In-Browser UI, Zero CMD)
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
      const res = await fetch(`${API_BASE_URL}/api/auth/security/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), method }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch security instructions.');
      }

      setCooldown(60);

      if (method === 'sms') {
        setMaskedPhone(data.maskedPhone || 'your registered corporate phone');
        if (data.previewCode) setPreviewCode(data.previewCode);
        setStep(2);
        toast.success(`Verification code sent to ${data.maskedPhone || 'your phone'}`);
      } else {
        try {
          await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
            redirectTo: `${window.location.origin}/reset-password`,
          });
        } catch {}

        setSuccessMsg(
          data.message ||
            'If an active workplace account matches that email, security instructions have been dispatched.'
        );
        toast.success('Instructions dispatched to your inbox');
      }
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
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: code }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed. Please check the code.');
      }

      toast.success('Identity verified. Redirecting to password reset...');
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
      <div className="relative z-10 w-full max-w-[390px] bg-white border border-slate-200 rounded-xl shadow-xs p-6 sm:p-7">
        
        {/* Header */}
        <div className="text-center mb-5 sm:mb-6">
          <div className="inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-slate-900 text-white shadow-xs mb-2.5">
            <i className="ti ti-shield-lock text-xl" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Account Recovery</h1>
          <p className="text-slate-500 text-xs mt-0.5">Verify your identity to reset your password</p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-600 font-medium leading-relaxed">
            {error}
          </div>
        )}

        {/* Global Success Banner */}
        {successMsg && (
          <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium leading-relaxed">
            {successMsg}
          </div>
        )}

        {/* STEP 1: Input and Method Selection */}
        {step === 1 && (
          <form onSubmit={handleRequestReset} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Workplace Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-mail" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="name@company.com"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                />
              </div>
            </div>

            {/* Segmented Control for Recovery Method */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Recovery Method</label>
              <div className="grid grid-cols-3 p-1 bg-slate-100 rounded-lg border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setMethod('sms')}
                  className={`py-1.5 font-medium rounded-md transition-all cursor-pointer ${
                    method === 'sms'
                      ? 'bg-white text-slate-900 font-bold shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  SMS OTP
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className={`py-1.5 font-medium rounded-md transition-all cursor-pointer ${
                    method === 'email'
                      ? 'bg-white text-slate-900 font-bold shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Email Link
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('key')}
                  className={`py-1.5 font-medium rounded-md transition-all cursor-pointer ${
                    method === 'key'
                      ? 'bg-white text-slate-900 font-bold shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
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
                    className="text-[10px] text-blue-600 hover:underline font-semibold cursor-pointer"
                  >
                    Demo key
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                    <i className="ti ti-key" />
                  </div>
                  <input
                    type="password"
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    required={method === 'key'}
                    placeholder="Enter Master Recovery Key"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs font-mono"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (cooldown > 0 && method !== 'key')}
              className="w-full mt-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold py-2.5 sm:py-3 rounded-lg shadow-xs transition-transform duration-75 flex items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Processing...</span>
                </>
              ) : cooldown > 0 && method !== 'key' ? (
                <span>Resend in {cooldown}s</span>
              ) : method === 'key' ? (
                <span>Verify Master Key</span>
              ) : method === 'sms' ? (
                <span>Send SMS Code</span>
              ) : (
                <span>Send Email Link</span>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: 6-Digit SMS OTP Verification */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs text-slate-600">
                Enter the 6-digit code sent to <span className="font-semibold text-slate-900">{maskedPhone}</span>
              </p>
            </div>

            {/* Test Sandbox 1-Click Code (if available) */}
            {previewCode && (
              <div className="flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
                <span className="text-[11px] truncate">
                  Code: <strong className="font-mono">{previewCode}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const digits = previewCode.split('');
                    setOtp(digits);
                    handleVerifyOtp(previewCode);
                  }}
                  className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded cursor-pointer"
                >
                  Autofill
                </button>
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
                  className="w-10 h-11 sm:w-11 sm:h-12 text-center font-mono font-bold text-base sm:text-lg bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => handleVerifyOtp()}
              disabled={loading || otp.join('').length < 6}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold py-2.5 sm:py-3 rounded-lg shadow-xs transition-transform duration-75 flex items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
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

              <button
                type="button"
                onClick={() => handleRequestReset()}
                disabled={cooldown > 0 || loading}
                className="text-blue-600 hover:underline font-semibold disabled:text-slate-400 disabled:no-underline cursor-pointer"
              >
                {cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {/* Footer Back to Login */}
        <div className="mt-5 pt-4 border-t border-slate-100 text-center">
          <Link
            to="/login"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
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
