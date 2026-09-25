import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { API_BASE_URL } from '../utils/api';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState('sms'); // 'sms' | 'email'
  const [step, setStep] = useState(1); // 1 = Input & Method, 2 = Verify SMS OTP
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [maskedPhone, setMaskedPhone] = useState('');
  
  // OTP state (for 2FA SMS flow)
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

  // Handle Dispatch Request
  const handleRequestReset = async (e) => {
    if (e) e.preventDefault();
    if (cooldown > 0) return;

    setError(null);
    setSuccessMsg(null);
    setLoading(true);

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

      setCooldown(60); // 60s cooldown

      if (method === 'sms') {
        setMaskedPhone(data.maskedPhone || 'your registered corporate phone');
        if (data.previewCode) setPreviewCode(data.previewCode);
        setStep(2);
        toast.success(`Security code dispatched to ${data.maskedPhone || 'your phone'}`);
      } else {
        // Fallback or explicit email link
        try {
          await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
            redirectTo: `${window.location.origin}/reset-password`,
          });
        } catch {}

        setSuccessMsg(
          data.message ||
            'If an active workplace account matches that email, security instructions have been dispatched. Please check your inbox and spam folder.'
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

    // Auto-advance cursor
    if (value && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
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
      return setError('Please enter the complete 6-digit security code.');
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

      toast.success('Identity verified! Redirecting to secure password reset...');
      
      // Navigate to /reset-password with single-use cryptographic reset ticket
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50/80 relative p-4 font-sans">
      {/* Background Subtle Gradient Glow */}
      <div className="absolute inset-0 bg-radial from-blue-50/40 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-[460px] p-6 sm:p-8 bg-white border border-slate-200/90 rounded-2xl shadow-xl shadow-slate-900/5">
        
        {/* Enterprise Shield Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-md shadow-slate-900/10 mb-3.5">
            <i className="ti ti-shield-lock text-2xl" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Account Recovery
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1 max-w-xs">
            Zero-Trust Identity Verification Protocol &middot; NIST SP 800-63B Compliant
          </p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200/80 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 animate-in fade-in duration-200">
            <i className="ti ti-alert-circle text-base shrink-0 mt-0.5" />
            <div className="flex-1 font-semibold">{error}</div>
          </div>
        )}

        {/* Global Success Banner */}
        {successMsg && (
          <div className="mb-5 p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800 animate-in fade-in duration-200">
            <i className="ti ti-circle-check text-base shrink-0 mt-0.5 text-emerald-600" />
            <div className="flex-1 font-medium leading-relaxed">{successMsg}</div>
          </div>
        )}

        {/* STEP 1: Email & Recovery Method Selection */}
        {step === 1 && (
          <form onSubmit={handleRequestReset} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Workplace Email
              </label>
              <div className="relative">
                <i className="ti ti-mail absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="admin@cpoint.com"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/60 hover:bg-white focus:bg-white border border-slate-200 focus:border-slate-900 rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none transition-all focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
            </div>

            {/* Out-of-Band Method Switcher */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Verification Channel
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod('sms')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    method === 'sms'
                      ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/10'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                    <i className="ti ti-device-mobile text-base text-blue-600" />
                    <span>2-Step SMS OTP</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
                    Fastest (via Mobile Phone)
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    method === 'email'
                      ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-600/10'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                    <i className="ti ti-mail-fast text-base text-blue-600" />
                    <span>Email Link</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
                    Recovery Token to Inbox
                  </p>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || cooldown > 0}
              className="w-full min-h-[46px] py-3 bg-slate-900 hover:bg-black active:scale-[0.99] text-white font-extrabold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-lg" />
                  <span>Verifying Authorization...</span>
                </>
              ) : cooldown > 0 ? (
                <>
                  <i className="ti ti-clock text-base" />
                  <span>Resend in {cooldown}s</span>
                </>
              ) : (
                <>
                  <i className="ti ti-shield-check text-base" />
                  <span>{method === 'sms' ? 'Dispatch SMS Security Code' : 'Send Recovery Link'}</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* STEP 2: 6-Digit SMS OTP Verification */}
        {step === 2 && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="bg-blue-50/70 border border-blue-200/80 p-3.5 rounded-xl text-xs text-blue-900 flex items-start gap-2.5">
              <i className="ti ti-device-mobile-message text-lg text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Enter 6-Digit Verification Code</p>
                <p className="text-[11px] text-blue-800/80 mt-0.5">
                  Dispatched to corporate mobile <span className="font-mono font-bold">{maskedPhone}</span>. Valid for 5 minutes.
                </p>
              </div>
            </div>

            {/* Development / Simulation 1-Click Autofill Banner */}
            {previewCode && (
              <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900">
                <span className="font-medium text-[11px] truncate">
                  Test Sandbox Code: <strong className="font-mono font-bold">{previewCode}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const digits = previewCode.split('');
                    setOtp(digits);
                    handleVerifyOtp(previewCode);
                  }}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg shadow-2xs transition-colors shrink-0 cursor-pointer"
                >
                  1-Click Autofill
                </button>
              </div>
            )}

            {/* 6-Digit OTP Boxes */}
            <div className="flex justify-between items-center gap-1.5 sm:gap-2 onpaste={handlePasteOtp}">
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
                  className="w-12 h-13 sm:w-14 sm:h-14 text-center font-mono font-black text-xl bg-slate-50/80 focus:bg-white border border-slate-300 focus:border-blue-600 rounded-xl outline-none focus:ring-4 focus:ring-blue-600/10 transition-all text-slate-900"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => handleVerifyOtp()}
              disabled={loading || otp.join('').length < 6}
              className="w-full min-h-[46px] py-3 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-extrabold rounded-xl text-xs sm:text-sm shadow-md shadow-blue-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-lg" />
                  <span>Validating Security Ticket...</span>
                </>
              ) : (
                <>
                  <i className="ti ti-key text-base" />
                  <span>Verify Identity &amp; Proceed</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setOtp(['', '', '', '', '', '']);
                }}
                className="text-slate-500 hover:text-slate-800 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <i className="ti ti-arrow-left text-sm" /> Change Method
              </button>

              <button
                type="button"
                onClick={() => handleRequestReset()}
                disabled={cooldown > 0 || loading}
                className="text-blue-600 hover:text-blue-700 font-bold disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend Code'}
              </button>
            </div>
          </div>
        )}

        {/* Footer Back to Login */}
        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
          <Link
            to="/login"
            className="text-slate-700 hover:text-slate-900 font-bold flex items-center gap-1.5 transition-colors"
          >
            <i className="ti ti-arrow-left text-sm" /> Back to Login
          </Link>
          <span className="text-[10px] text-slate-400 font-mono">Secured by C-Point Guard</span>
        </div>
      </div>
    </div>
  );
}
