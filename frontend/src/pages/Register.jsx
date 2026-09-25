import React, { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { Link } from 'react-router-dom';
import { formatPhPhone, validatePhPhone, cleanPhPhone } from '../utils/phoneUtils';
import toast from 'react-hot-toast';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const phoneValidation = useMemo(() => validatePhPhone(phone), [phone]);

  // NIST Password Complexity Check
  const checks = {
    length: password.length >= 10,
    case: /[A-Z]/.test(password) && /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
  const isEntropyCompliant = Object.values(checks).every(Boolean);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    const phoneCheck = validatePhPhone(phone);
    if (!phoneCheck.isValid) {
      setError(phoneCheck.message || 'A valid 11-digit Philippine mobile phone number starting with 09 is required.');
      return;
    }

    if (!isEntropyCompliant) {
      setError('Password must be at least 10 characters long with uppercase, lowercase, number, and special character.');
      return;
    }

    setLoading(true);

    try {
      const cleanPhone = phoneCheck.cleanPhone;
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        phone: `+63${cleanPhone.slice(1)}`,
        options: {
          data: {
            name: name.trim(),
            first_name: name.trim().split(' ')[0] || '',
            last_name: name.trim().split(' ').slice(1).join(' ') || '',
            role: 'employee',
            phone: cleanPhone,
          },
        },
      });

      if (signUpError) {
        throw new Error(signUpError.message);
      }

      setMsg('Account registered successfully! Please check your email to verify your workplace account.');
      toast.success('Account created! Please check your email.');
    } catch (err) {
      console.error('[REGISTRATION_ERROR]', err);
      setError(err.message || 'Failed to complete registration.');
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
            <i className="ti ti-user-plus text-xl" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Create Account</h1>
          <p className="text-slate-500 text-xs mt-0.5">Register your workplace profile with 2FA protection</p>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-600 font-medium leading-relaxed">
            {error}
          </div>
        )}

        {/* Global Success Banner */}
        {msg ? (
          <div className="text-center py-4 space-y-3">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center text-xl mx-auto border border-emerald-200">
              <i className="ti ti-check" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">Registration Complete</h2>
            <p className="text-xs text-slate-600 leading-relaxed px-2">{msg}</p>
            <div className="pt-2">
              <Link
                to="/login"
                className="inline-block w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
              >
                Proceed to Login
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleRegister} className="space-y-3.5">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Full Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-user" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Juan Dela Cruz"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                />
              </div>
            </div>

            {/* Workplace Email */}
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
                  placeholder="juan@company.com"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                />
              </div>
            </div>

            {/* Mandatory Real Philippine Mobile Number */}
            <div>
              <div className="flex items-center justify-between mb-1 ml-0.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Mobile Number <span className="text-rose-500">*</span>
                </label>
                {phone && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-all ${
                    phoneValidation.isValid
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : phoneValidation.status === 'invalid_prefix'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {phoneValidation.isValid ? `✓ ${phoneValidation.carrier || 'Valid PH Mobile'}` : phoneValidation.message}
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500 text-xs font-bold font-mono">
                  🇵🇭 +63
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(formatPhPhone(e.target.value))}
                  required
                  placeholder="0917 123 4567"
                  className={`w-full pl-20 pr-3.5 py-2.5 bg-white border rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 font-mono transition-colors shadow-2xs ${
                    phone && phoneValidation.isValid
                      ? 'border-emerald-300 focus:border-emerald-600 focus:ring-emerald-600/15'
                      : phone && !phoneValidation.isValid
                      ? 'border-amber-300 focus:border-amber-600 focus:ring-amber-600/15'
                      : 'border-slate-300 focus:border-slate-900 focus:ring-slate-900/15'
                  }`}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i className="ti ti-lock" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs font-mono"
                />
              </div>

              {/* Password Requirements Check */}
              {password && (
                <div className="grid grid-cols-2 gap-1.5 pt-2 text-[10px]">
                  <span className={checks.length ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                    ✓ 10+ characters
                  </span>
                  <span className={checks.case ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                    ✓ Upper &amp; lower
                  </span>
                  <span className={checks.number ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                    ✓ Numeric digit
                  </span>
                  <span className={checks.special ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                    ✓ Special character
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !phoneValidation.isValid || !isEntropyCompliant}
              className="w-full mt-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold py-2.5 sm:py-3 rounded-lg shadow-xs transition-transform duration-75 flex items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <i className="ti ti-loader-2 animate-spin text-sm" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>Register Account</span>
              )}
            </button>
          </form>
        )}

        {/* Footer Back to Login */}
        <div className="mt-5 pt-4 border-t border-slate-100 text-center">
          <span className="text-xs text-slate-500 font-medium">Already have an account? </span>
          <Link
            to="/login"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>

      {/* Bottom spacer */}
      <div className="pb-2 sm:pb-4" />
    </div>
  );
}
