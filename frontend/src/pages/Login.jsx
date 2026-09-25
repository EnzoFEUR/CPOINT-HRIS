import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { setDisciplinaryCache, clearDisciplinaryCache } from '../utils/disciplinaryCache';
import { useOtpCooldown } from '../utils/useOtpCooldown';

export default function Login() {
    // Restore any active 2FA recovery session from page reload or navigation
    const savedSession = (() => {
        try {
            const raw = sessionStorage.getItem('cpoint_login_2fa_session');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    })();

    const [email, setEmail] = useState(savedSession?.email || '');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    // Multi-step authentication: 1 = Credentials, 2 = Choose OTP, 3 = Verify OTP
    const [step, setStep] = useState(savedSession?.step || 1);
    const [employeeData, setEmployeeData] = useState(savedSession?.employeeData || null);
    const [otpCode, setOtpCode] = useState(['', '', '', '', '', '']);
    const [otpMethod, setOtpMethod] = useState(savedSession?.otpMethod || '');
    const [generatedOtp, setGeneratedOtp] = useState(savedSession?.generatedOtp || null);

    // Enterprise persistent OTP cooldown hook (persists across page reloads/navigation/back button)
    const { cooldown, isCooldown, startCooldown, clearCooldown } = useOtpCooldown(
        'login_2fa_' + (email.trim().toLowerCase() || 'global'),
        60
    );

    // Dynamic 5-minute code expiration timer that survives refresh
    const [timer, setTimer] = useState(() => {
        if (savedSession?.expiresAt) {
            const diff = Math.ceil((savedSession.expiresAt - Date.now()) / 1000);
            return diff > 0 ? diff : 0;
        }
        return 300;
    });

    const handleReturnToLogin = () => {
        try {
            sessionStorage.removeItem('cpoint_login_2fa_session');
        } catch {}
        setStep(1);
        setOtpCode(['', '', '', '', '', '']);
        setGeneratedOtp(null);
        setError(null);
    };

    const handleSwitchMethod = () => {
        setStep(2);
        setError(null);
        try {
            const raw = sessionStorage.getItem('cpoint_login_2fa_session');
            if (raw) {
                const s = JSON.parse(raw);
                sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({ ...s, step: 2 }));
            }
        } catch {}
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        
        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
            
            if (authError) {
                setLoading(false);
                return setError(authError.message);
            }

            if (authData?.user) {
                const { data: employee, error: empError } = await supabase
                    .from('employees')
                    .select('*')
                    .eq('id', authData.user.id)
                    .single();
                    
                if (empError) {
                    setLoading(false);
                    return setError("Unable to retrieve employee account details.");
                }

                // Auto-reinstatement check for expired suspensions
                if (employee.role !== 'admin') {
                    const { data: discLogs } = await supabase
                        .from('disciplinary_logs')
                        .select('*')
                        .eq('employee_id', employee.id)
                        .eq('type', 'Suspension')
                        .eq('status', 'Active')
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (discLogs && discLogs.length > 0) {
                        const disc = discLogs[0];
                        const match = (disc.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
                        const endDateStr = match ? match[1] : null;
                        const todayStr = new Date().toISOString().split('T')[0];

                        if (endDateStr && todayStr > endDateStr) {
                            // Expired: auto reinstate
                            await supabase.from('disciplinary_logs').update({ status: 'Resolved' }).eq('id', disc.id);
                            await supabase.from('employees').update({ status: 'active', is_active: true }).eq('id', employee.id);
                            employee.status = 'active';
                            employee.is_active = true;
                        }
                    }
                }

                const empWithMeta = { 
                    ...employee, 
                    _auth_metadata: authData.user.user_metadata 
                };

                setEmployeeData(empWithMeta);
                setLoading(false);
                setStep(2);

                try {
                    sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                        email,
                        employeeData: empWithMeta,
                        step: 2,
                        otpMethod: '',
                        generatedOtp: null
                    }));
                } catch {}
            }
        } catch (err) {
            setLoading(false);
            setError("Connection error. Please try again.");
        }
    };

    // Countdown timer for OTP expiry
    useEffect(() => {
        if (step !== 3 || timer <= 0) return;
        const interval = setInterval(() => {
            setTimer(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(interval);
    }, [step, timer]);

    const sendOtp = async (method) => {
        // If an active unexpired code is already dispatched to this method (within 5 mins),
        // let the user proceed immediately to Step 3 without triggering a duplicate dispatch or cooldown
        if (timer > 0 && method === otpMethod) {
            toast.success(`Resuming verification with your active code sent via ${method === 'sms' ? 'SMS' : 'Email'}`);
            setStep(3);
            return;
        }

        // If in active 60s cooldown and trying to dispatch via another method
        if (isCooldown && method !== otpMethod) {
            toast.error(`Please wait ${cooldown}s before requesting a code via ${method === 'sms' ? 'SMS' : 'Email'}, or use the code already sent.`);
            return;
        }

        setOtpMethod(method);
        setLoading(true);
        setError(null);
        
        try {
            const res = await fetchWithAuth('/api/auth/otp/send', {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    phone: employeeData?.phone,
                    user_id: employeeData?.id,
                    method,
                    purpose: 'login_2fa'
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                if (data.retry_after) {
                    startCooldown(data.retry_after);
                }
                throw new Error(data.error || 'Failed to dispatch verification code');
            }

            // Start enterprise 60s resend cooldown
            startCooldown(data.cooldown || 60);

            // Save and display preview / mock code whenever returned by server (simulation or demo)
            if (data.previewCode) {
                setGeneratedOtp(data.previewCode);
                toast.success(`Verification code: ${data.previewCode}`, { duration: 6000 });
            } else {
                setGeneratedOtp(null);
                toast.success(`Verification code sent via ${method === 'sms' ? 'SMS' : 'Email'}`);
            }

            const activeSeconds = data.expiresIn || 300;
            const codeExpiresAt = Date.now() + activeSeconds * 1000;
            setTimer(activeSeconds);
            setStep(3);

            try {
                sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                    email,
                    employeeData,
                    step: 3,
                    otpMethod: method,
                    generatedOtp: data.previewCode || null,
                    expiresAt: codeExpiresAt
                }));
            } catch {}
        } catch (err) {
            setError(err.message || 'Error sending verification code');
            toast.error(err.message || 'Failed to send verification code');
        } finally {
            setLoading(false);
        }
    };

    const handleOtpChange = (index, e) => {
        const rawValue = e.target.value;

        // Support mobile SMS autofill and paste
        if (rawValue.length > 1) {
            const digits = rawValue.replace(/\D/g, '').slice(0, 6).split('');
            if (digits.length > 0) {
                const newOtp = [...otpCode];
                digits.forEach((d, i) => {
                    if (index + i < 6) newOtp[index + i] = d;
                });
                setOtpCode(newOtp);
                const nextIndex = Math.min(index + digits.length, 5);
                const nextElem = document.getElementById(`otp-${nextIndex}`);
                if (nextElem) {
                    nextElem.focus();
                    nextElem.select();
                }
                return;
            }
        }

        const char = rawValue.slice(-1);
        if (char && !/^[0-9]$/.test(char)) return;

        const newOtp = [...otpCode];
        newOtp[index] = char;
        setOtpCode(newOtp);

        if (char && index < 5) {
            const nextElem = document.getElementById(`otp-${index + 1}`);
            if (nextElem) {
                nextElem.focus();
                nextElem.select();
            }
        }
    };

    const handleOtpKeyDown = (index, e) => {
        if (e.key === 'Backspace') {
            if (!otpCode[index] && index > 0) {
                const newOtp = [...otpCode];
                newOtp[index - 1] = '';
                setOtpCode(newOtp);
                const prevElem = document.getElementById(`otp-${index - 1}`);
                if (prevElem) {
                    prevElem.focus();
                    prevElem.select();
                }
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            document.getElementById(`otp-${index - 1}`)?.focus();
        } else if (e.key === 'ArrowRight' && index < 5) {
            document.getElementById(`otp-${index + 1}`)?.focus();
        }
    };

    const handleOtpPaste = (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (!pastedData) return;

        const digits = pastedData.split('');
        const newOtp = ['', '', '', '', '', ''];
        digits.forEach((d, i) => {
            if (i < 6) newOtp[i] = d;
        });
        setOtpCode(newOtp);
        const focusIdx = Math.min(digits.length - 1, 5);
        const target = document.getElementById(`otp-${focusIdx}`);
        if (target) {
            target.focus();
            target.select();
        }
    };

    const verifyOtp = async (e) => {
        e.preventDefault();
        const enteredOtp = otpCode.join('');
        if (enteredOtp.length < 6) {
            return setError("Please enter the complete 6-digit code.");
        }

        setLoading(true);
        setError(null);

        try {
            const res = await fetchWithAuth('/api/auth/otp/verify', {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    phone: employeeData?.phone,
                    identifier: otpMethod === 'sms' ? employeeData?.phone : email,
                    otp: enteredOtp,
                    purpose: 'login_2fa'
                })
            });

            const verifyData = await res.json();
            if (!res.ok || !verifyData.success) {
                setLoading(false);
                return setError(verifyData.error || "Invalid verification code. Please try again.");
            }

            const { data: dbData, error: dbError } = await supabase
                .from('employees')
                .select('*')
                .eq('id', employeeData.id)
                .single();

            if (dbError) {
                setLoading(false);
                return setError("Failed to verify user profile.");
            }

            const userData = { 
                ...employeeData, 
                ...dbData,
                has_registered_biometrics: employeeData._auth_metadata?.has_registered_biometrics || false,
                name: `${dbData.first_name || employeeData.first_name} ${dbData.last_name || employeeData.last_name}`
            };
            
            delete userData._auth_metadata;
            localStorage.setItem('user', JSON.stringify(userData));

            // Clear 2FA temporary session and cooldown upon successful authentication
            try {
                sessionStorage.removeItem('cpoint_login_2fa_session');
                clearCooldown();
            } catch {}

            // Prime disciplinary cache synchronously for instant zero-flash screen loading
            if (userData.status === 'inactive' || userData.is_active === false) {
                setDisciplinaryCache(userData.id, {
                    type: userData.is_terminated ? 'Termination' : 'Suspension',
                    record: null
                });
            } else {
                clearDisciplinaryCache(userData.id);
            }

            const role = (userData.role || '').toLowerCase();
            const isSecurityRole = role === 'security' || role === 'guard' || role === 'security_guard';
            const isAdminRole = role === 'admin' || role === 'superadmin' || role === 'hr';

            if (userData.requires_password_change) {
                toast.success('Please update your password.');
                navigate('/force-password-change');
            } else if (!userData.has_registered_biometrics && !isSecurityRole && !isAdminRole) {
                toast.success('Please complete your biometric enrollment.');
                navigate('/biometric-setup');
            } else {
                toast.success('Signed in successfully');
                if (isAdminRole) {
                    navigate('/');
                } else if (isSecurityRole) {
                    navigate('/scanner');
                } else {
                    navigate('/employee/dashboard');
                }
            }
        } catch (err) {
            setError(err.message || "Failed to verify code.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-[100dvh] w-screen flex flex-col justify-between items-center bg-slate-50 relative overflow-hidden select-none p-4 sm:p-6">
            {/* Top branding spacer */}
            <div className="pt-2 sm:pt-4" />

            {/* Login Card */}
            <div className="relative z-10 w-full max-w-[390px] bg-white border border-slate-200 rounded-xl shadow-xs p-6 sm:p-7">
                {step === 1 && (
                    <div>
                        <div className="text-center mb-5 sm:mb-6">
                            <div className="inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-blue-600 text-white shadow-xs mb-2.5">
                                <span className="font-black text-base sm:text-lg tracking-tight">CP</span>
                            </div>
                            <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Welcome to C-Point</h1>
                            <p className="text-slate-500 text-xs mt-0.5">Sign in to your workforce account</p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Workplace Email / Employee ID</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                                        <i className="ti ti-mail" />
                                    </div>
                                    <input 
                                        type="email" 
                                        value={email} 
                                        onChange={e => setEmail(e.target.value)} 
                                        required 
                                        autoFocus
                                        className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                                        placeholder="name@company.com" 
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1 ml-0.5">
                                    <label className="block text-xs font-semibold text-slate-700">Password</label>
                                    <Link 
                                        to="/forgot-password" 
                                        className="text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                                    >
                                        Forgot Password?
                                    </Link>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                                        <i className="ti ti-lock" />
                                    </div>
                                    <input 
                                        type="password" 
                                        value={password} 
                                        onChange={e => setPassword(e.target.value)} 
                                        required 
                                        className="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 transition-colors shadow-2xs"
                                        placeholder="••••••••" 
                                    />
                                </div>
                                {error && <p className="text-rose-600 text-xs mt-1.5 font-medium ml-0.5">{error}</p>}
                            </div>

                            <button 
                                type="submit" 
                                disabled={loading}
                                className="w-full mt-2 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold py-2.5 sm:py-3 rounded-lg shadow-xs transition-transform duration-75 flex items-center justify-center gap-2 text-xs sm:text-sm disabled:opacity-50 cursor-pointer"
                            >
                                {loading ? (
                                    <>
                                        <i className="ti ti-loader-2 animate-spin text-sm" />
                                        <span>Authenticating...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Login</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                )}

                {step === 2 && (
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 mb-2.5">
                            <i className="ti ti-shield-lock text-xl" />
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Two-Factor Authentication</h2>
                        <p className="text-slate-500 text-xs mt-0.5 mb-3.5 sm:mb-4">Choose where to receive your security code</p>

                        {/* Direct Jump to Active Verification if code is already in transit / valid (< 5 mins) */}
                        {timer > 0 && otpMethod && (
                            <div className="mb-3.5 p-3.5 bg-blue-50/80 border border-blue-200/90 rounded-xl text-left shadow-2xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        <span className="relative flex h-2 w-2">
                                        </span>
                                        <span>Code active via {otpMethod === 'sms' ? 'SMS' : 'Email'}</span>
                                    </span>
                                    <span className="text-[11px] font-mono font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded">
                                        {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
                                    Your 6-digit code was sent and remains valid for 5 minutes. You can enter the code already sent to your {otpMethod === 'sms' ? 'phone' : 'email'}.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep(3);
                                        try {
                                            const s = JSON.parse(sessionStorage.getItem('cpoint_login_2fa_session') || '{}');
                                            sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({ ...s, step: 3 }));
                                        } catch {}
                                    }}
                                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                                >
                                    <span>Enter Existing Code</span>
                                    <i className="ti ti-arrow-right text-xs" />
                                </button>
                            </div>
                        )}

                        <div className="space-y-2 sm:space-y-2.5">
                            <button 
                                onClick={() => sendOtp('sms')} 
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50/50 transition-colors flex items-center text-left gap-3 active:scale-[0.98] cursor-pointer"
                            >
                                <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
                                    <i className="ti ti-device-mobile-message text-base" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-semibold text-xs text-slate-900">Send via SMS</p>
                                    <p className="text-[11px] text-slate-500 truncate">Mobile ending in ***{employeeData?.phone ? employeeData.phone.slice(-3) : 'XX'}</p>
                                </div>
                                <i className="ti ti-chevron-right ml-auto text-slate-400 text-sm" />
                            </button>

                            <button 
                                onClick={() => sendOtp('email')} 
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-400 hover:bg-slate-50/50 transition-colors flex items-center text-left gap-3 active:scale-[0.98] cursor-pointer"
                            >
                                <div className="h-8 w-8 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shrink-0">
                                    <i className="ti ti-mail-fast text-base" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-semibold text-xs text-slate-900">Send via Email</p>
                                    <p className="text-[11px] text-slate-500 truncate">{email}</p>
                                </div>
                                <i className="ti ti-chevron-right ml-auto text-slate-400 text-sm" />
                            </button>
                        </div>

                        <button 
                            type="button"
                            onClick={handleReturnToLogin} 
                            className="mt-4 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                        >
                            Return to Login
                        </button>
                    </div>
                )}

                {step === 3 && (
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 mb-2.5">
                            <i className="ti ti-dialpad text-xl" />
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Security Code</h2>
                        <p className="text-slate-500 text-xs mt-0.5 mb-4">Enter the 6-digit code sent to your {otpMethod === 'sms' ? 'phone' : 'email'}</p>

                        <form onSubmit={verifyOtp}>
                            <div className="flex justify-center gap-1.5 sm:gap-2 mb-3">
                                {otpCode.map((digit, idx) => (
                                    <input 
                                        key={idx}
                                        id={`otp-${idx}`}
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        autoComplete={idx === 0 ? "one-time-code" : "off"}
                                        value={digit}
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) => handleOtpChange(idx, e)}
                                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                                        onPaste={handleOtpPaste}
                                        className="w-9 h-11 sm:w-11 sm:h-13 text-center text-lg sm:text-xl font-bold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900 transition-colors shadow-2xs font-mono"
                                        autoFocus={idx === 0}
                                    />
                                ))}
                            </div>

                            {generatedOtp && (
                                <div className="mb-3">
                                    <button 
                                        type="button"
                                        onClick={() => {
                                             const digits = generatedOtp.split('');
                                             setOtpCode(digits);
                                             document.getElementById('otp-5')?.focus();
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-semibold rounded-lg border border-amber-300 transition-colors cursor-pointer shadow-2xs w-full justify-between active:scale-[0.99]"
                                    >
                                        <div className="flex items-center gap-2">
                                             <i className="ti ti-bulb text-amber-600 text-sm" />
                                             <span>Security code: <strong className="font-mono text-sm tracking-wider text-amber-950 font-bold">{generatedOtp}</strong></span>
                                        </div>
                                        <span className="text-[11px] font-bold bg-amber-200/80 px-2 py-0.5 rounded text-amber-900">Autofill</span>
                                    </button>
                                </div>
                            )}

                            {error && <p className="text-rose-600 text-xs mb-3 font-medium">{error}</p>}
                            
                            <button 
                                type="submit" 
                                className="w-full bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold py-2.5 sm:py-3 rounded-lg shadow-xs transition-transform duration-75 flex items-center justify-center gap-2 text-xs sm:text-sm cursor-pointer"
                            >
                                Verify & Proceed
                            </button>
                        </form>
                        
                        <p className="mt-3.5 text-xs text-slate-500 flex items-center justify-center gap-1">
                            {timer > 0 ? (
                                <span>Code expires in <strong className="font-mono text-slate-700">{Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</strong></span>
                            ) : (
                                <span className="text-red-500 font-semibold">Code expired.</span>
                            )}
                            <span className="mx-1 text-slate-300">•</span>
                            <button 
                                type="button"
                                disabled={loading || isCooldown}
                                onClick={() => sendOtp(otpMethod)} 
                                className="text-blue-600 hover:underline font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            >
                                {isCooldown ? `Resend (${cooldown}s)` : 'Resend'}
                            </button>
                        </p>

                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-center gap-3">
                            <button 
                                type="button"
                                onClick={handleSwitchMethod} 
                                className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                            >
                                Switch Method
                            </button>
                            <span className="text-slate-200 text-xs">•</span>
                            <button 
                                type="button"
                                onClick={handleReturnToLogin} 
                                className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                            >
                                Return to Login
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="pb-2 text-center pointer-events-none">
                <p className="text-slate-400 text-[10px] font-semibold tracking-wider uppercase"> </p>
            </div>
        </div>
    );
}

