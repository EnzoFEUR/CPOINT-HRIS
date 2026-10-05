import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { setDisciplinaryCache, clearDisciplinaryCache } from '../utils/disciplinaryCache';
import { useOtpCooldown } from '../utils/useOtpCooldown';
import { isSecurity, isAdmin, isMedicalExempt } from '../routes/guards';
import { broadcastAuthChange } from '../utils/authSession';
import {
  Mail,
  Loader2,
  ShieldCheck,
  ArrowRight,
  ChevronRight,
  KeyRound,
  Lightbulb,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldAlert,
  Send
} from 'lucide-react';
// Enterprise Anti-Brute-Force & Rate-Limiting Protection
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SEC = 30;

const getLockoutRemaining = () => {
    try {
        const raw = sessionStorage.getItem('cpoint_auth_lockout_until');
        if (!raw) return 0;
        const diff = Math.ceil((parseInt(raw, 10) - Date.now()) / 1000);
        return diff > 0 ? diff : 0;
    } catch {
        return 0;
    }
};

const recordFailedAttempt = () => {
    try {
        const attempts = parseInt(sessionStorage.getItem('cpoint_auth_failed_attempts') || '0', 10) + 1;
        sessionStorage.setItem('cpoint_auth_failed_attempts', String(attempts));
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            const until = Date.now() + (LOCKOUT_DURATION_SEC * 1000);
            sessionStorage.setItem('cpoint_auth_lockout_until', String(until));
            sessionStorage.removeItem('cpoint_auth_failed_attempts');
            return LOCKOUT_DURATION_SEC;
        }
    } catch {}
    return 0;
};

const clearFailedAttempts = () => {
    try {
        sessionStorage.removeItem('cpoint_auth_failed_attempts');
        sessionStorage.removeItem('cpoint_auth_lockout_until');
    } catch {}
};

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
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    // Security lockout countdown
    const [lockoutTimer, setLockoutTimer] = useState(() => getLockoutRemaining());
    const isLockedOut = lockoutTimer > 0;

    // Multi-step authentication: 1 = Credentials, 2 = Choose OTP, 3 = Verify OTP
    const [step, setStep] = useState(savedSession?.step || 1);
    const [employeeData, setEmployeeData] = useState(savedSession?.employeeData || null);
    const [otpCode, setOtpCode] = useState(['', '', '', '', '', '']);
    const [otpMethod, setOtpMethod] = useState(savedSession?.otpMethod || '');
    const [generatedOtp, setGeneratedOtp] = useState(savedSession?.generatedOtp || null);
    const [expiresAt, setExpiresAt] = useState(() => savedSession?.expiresAt || null);
    const [hasTotp, setHasTotp] = useState(() => {
        return Boolean(
            savedSession?.employeeData?.hasTotp ||
            savedSession?.employeeData?.totp_enabled ||
            savedSession?.employeeData?.has_totp ||
            (savedSession?.employeeData?._auth_metadata?.totp_enabled && savedSession?.employeeData?._auth_metadata?.totp_secret)
        );
    });

    const otpSendLockRef = useRef(false);
    const otpVerifyLockRef = useRef(false);
    const lastOtpClickRef = useRef(0);

    // Persistent 60s cooldown hook across page reloads and tab navigations
    const { cooldown, isCooldown, startCooldown, clearCooldown } = useOtpCooldown(
        'login_2fa_' + (email.trim().toLowerCase() || 'global'),
        60
    );

    // Calculate remaining seconds from target epoch timestamp
    const getSecondsRemaining = (targetEpoch) => {
        if (!targetEpoch) return 0;
        const diff = Math.ceil((targetEpoch - Date.now()) / 1000);
        return diff > 0 ? diff : 0;
    };

    const [timer, setTimer] = useState(() => getSecondsRemaining(savedSession?.expiresAt));
    const formattedTimer = `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}`;

    // Dynamic document title alignment
    useEffect(() => {
        if (step === 1) {
            document.title = 'Sign In | C-Point HRIS Enterprise';
        } else if (step === 2) {
            document.title = 'Two-Factor Authentication | C-Point HRIS Enterprise';
        } else if (step === 3) {
            document.title = 'Security Code Verification | C-Point HRIS Enterprise';
        }
    }, [step]);

    // Active lockout countdown timer
    useEffect(() => {
        if (lockoutTimer <= 0) return;
        const interval = setInterval(() => {
            const rem = getLockoutRemaining();
            setLockoutTimer(rem);
            if (rem <= 0) clearInterval(interval);
        }, 1000);
        return () => clearInterval(interval);
    }, [lockoutTimer]);

    // Cross-tab real-time authentication synchronization
    useEffect(() => {
        const handleStorage = (e) => {
            if (e.key === 'cpoint_auth_sync_event' && e.newValue) {
                try {
                    const data = JSON.parse(e.newValue);
                    if (data.type === 'LOGIN' && data.user) {
                        const u = data.user;
                        if (isAdmin(u)) navigate('/');
                        else if (isSecurity(u)) navigate('/scanner');
                        else navigate('/employee/dashboard');
                    }
                } catch {}
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, [navigate]);

    // Keyboard navigation (Escape key returns back cleanly)
    useEffect(() => {
        const handleGlobalKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (step === 3) handleSwitchMethod();
                else if (step === 2) handleReturnToLogin();
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [step]);

    // Real-time drift-free countdown across all steps and tab focus shifts
    useEffect(() => {
        const syncTimer = () => {
            if (expiresAt) {
                const rem = getSecondsRemaining(expiresAt);
                setTimer(rem);
            } else {
                setTimer(0);
            }
        };

        syncTimer();
        if (!expiresAt) return;

        const interval = setInterval(syncTimer, 1000);
        const handleVisibilityChange = () => {
            if (!document.hidden) syncTimer();
        };

        window.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', syncTimer);

        return () => {
            clearInterval(interval);
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', syncTimer);
        };
    }, [expiresAt]);

    // Synchronize active OTP status from server when on method selection
    useEffect(() => {
        if (step !== 2 || !email) return;

        let isMounted = true;
        const syncStatus = async () => {
            try {
                const res = await fetchWithAuth(`/api/auth/otp/status?identifier=${encodeURIComponent(email.trim().toLowerCase())}`);
                const data = await res.json();
                if (!isMounted || !res.ok || !data.success) return;

                if (data.hasActiveOtp && data.remainingSeconds > 0) {
                    const newExpiresAt = Date.now() + (data.remainingSeconds * 1000);
                    setExpiresAt(newExpiresAt);
                    setTimer(data.remainingSeconds);
                    if (data.method) {
                        setOtpMethod(data.method);
                    }
                    try {
                        const raw = sessionStorage.getItem('cpoint_login_2fa_session');
                        const s = raw ? JSON.parse(raw) : {};
                        sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                            ...s,
                            expiresAt: newExpiresAt,
                            otpMethod: data.method || s.otpMethod || 'email'
                        }));
                    } catch {}
                }

                if (data.isCooldown && data.cooldownRemaining > 0) {
                    startCooldown(data.cooldownRemaining);
                }

                if (typeof data.hasTotp === 'boolean') {
                    setHasTotp(data.hasTotp);
                    if (!data.hasTotp && otpMethod === 'totp') {
                        setOtpMethod('');
                    }
                }
            } catch (err) {
                // Silently fallback to client state
            }
        };

        syncStatus();
        return () => {
            isMounted = false;
        };
    }, [step, email, startCooldown]);

    const handleReturnToLogin = () => {
        try {
            sessionStorage.removeItem('cpoint_login_2fa_session');
        } catch {}
        setStep(1);
        setOtpCode(['', '', '', '', '', '']);
        setGeneratedOtp(null);
        setExpiresAt(null);
        setTimer(0);
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
        if (isLockedOut) {
            return setError(`Security backoff active. Please wait ${lockoutTimer} seconds.`);
        }

        const sanitizedEmail = email.trim().toLowerCase();
        if (!sanitizedEmail) {
            return setError("Please enter your corporate email.");
        }
        if (!password) {
            return setError("Please enter your password.");
        }

        setError(null);
        setLoading(true);
        
        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: sanitizedEmail,
                password
            });
            
            if (authError) {
                setLoading(false);
                const remLockout = recordFailedAttempt();
                if (remLockout > 0) {
                    setLockoutTimer(remLockout);
                    return setError(`Too many failed attempts. Security cooldown active for ${remLockout}s.`);
                }
                return setError("Invalid email or password. Please verify your credentials.");
            }

            // Authentication succeeded: clear failed counter and zero-out password from memory
            clearFailedAttempts();
            setPassword('');

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

                const existingExpiresAt = savedSession?.expiresAt;
                const hasExistingValidOtp = existingExpiresAt && (existingExpiresAt > Date.now());

                const meta = authData.user?.user_metadata || {};
                const userHasTotp = Boolean(meta.totp_enabled && meta.totp_secret);
                setHasTotp(userHasTotp);

                const empWithMeta = { 
                    ...employee, 
                    hasTotp: userHasTotp,
                    _auth_metadata: authData.user.user_metadata 
                };

                setEmployeeData(empWithMeta);
                setLoading(false);

                if (userHasTotp) {
                    setOtpMethod('totp');
                    setStep(3);
                    try {
                        sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                            email: sanitizedEmail,
                            employeeData: empWithMeta,
                            step: 3,
                            otpMethod: 'totp',
                            generatedOtp: null,
                            expiresAt: null
                        }));
                    } catch {}
                    return;
                }

                setStep(2);

                try {
                    sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                        email: sanitizedEmail,
                        employeeData: empWithMeta,
                        step: 2,
                        otpMethod: hasExistingValidOtp ? (savedSession.otpMethod || '') : '',
                        generatedOtp: hasExistingValidOtp ? (savedSession.generatedOtp || null) : null,
                        expiresAt: hasExistingValidOtp ? existingExpiresAt : null
                    }));
                } catch {}
            }
        } catch (err) {
            setLoading(false);
            setError("Connection error. Please try again.");
        }
    };

    const sendOtp = async (method, isResend = false, isMock = false) => {
        // Double-click protection: Synchronous ref lock + 1500ms time throttle
        const now = Date.now();
        if (otpSendLockRef.current || loading || (now - lastOtpClickRef.current < 1500)) {
            return;
        }
        lastOtpClickRef.current = now;
        otpSendLockRef.current = true;

        // Authenticator TOTP requires zero dispatch wait time
        if (method === 'totp') {
            otpSendLockRef.current = false;
            if (!hasTotp) {
                toast.error('Google Authenticator is not registered for this account.');
                return;
            }
            setOtpMethod('totp');
            setStep(3);
            try {
                const s = JSON.parse(sessionStorage.getItem('cpoint_login_2fa_session') || '{}');
                sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                    ...s,
                    step: 3,
                    otpMethod: 'totp',
                    expiresAt: null
                }));
            } catch {}
            return;
        }

        // If an active unexpired code is already dispatched to this method (within 5 mins),
        // let the user proceed immediately to Step 3 without triggering duplicate dispatch or errors
        if (!isResend && !isMock && step === 2 && timer > 0 && method === otpMethod) {
            otpSendLockRef.current = false;
            toast.success('Resuming verification with your active code sent via Email');
            setStep(3);
            try {
                const s = JSON.parse(sessionStorage.getItem('cpoint_login_2fa_session') || '{}');
                sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({ ...s, step: 3 }));
            } catch {}
            return;
        }

        // Anti-spam 60s cooldown check (bypassed if mock requested for testing)
        if (isCooldown && !isMock) {
            otpSendLockRef.current = false;
            if (timer > 0 && method === otpMethod) {
                toast.success('Enter the code already sent to your email');
                setStep(3);
                return;
            }
            if (isResend) {
                toast.error(`Please wait ${cooldown}s before requesting a new code.`);
                return;
            }
            toast.error(`Please wait ${cooldown}s before requesting a code via Email, or use the code already sent.`);
            return;
        }

        setOtpMethod('email');
        setLoading(true);
        setError(null);
        
        const sanitizedEmail = email.trim().toLowerCase();

        try {
            const res = await fetchWithAuth('/api/auth/otp/send', {
                method: 'POST',
                body: JSON.stringify({
                    email: sanitizedEmail,
                    user_id: employeeData?.id,
                    method: 'email',
                    purpose: 'login_2fa',
                    mock: isMock
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                if (data.retry_after) {
                    startCooldown(data.retry_after);
                }
                throw new Error(data.error || 'Failed to dispatch verification code');
            }

            // Start resend cooldown (shorter for mock testing)
            startCooldown(data.cooldown || (isMock ? 5 : 60));

            // Ensure generatedOtp is null so it never renders in the OTP enter screen
            setGeneratedOtp(null);

            if (isMock && data.previewCode) {
                const digits = data.previewCode.split('');
                setOtpCode(digits);
                toast.success(`Mock OTP: ${data.previewCode} (Brevo email skipped)`);
            } else {
                setOtpCode(['', '', '', '', '', '']);
                toast.success(
                    isResend
                        ? `Verification code resent to ${sanitizedEmail}`
                        : `Verification code sent to ${sanitizedEmail}`
                );
            }

            const activeSeconds = data.expiresIn || 300;
            const codeExpiresAt = Date.now() + activeSeconds * 1000;
            setExpiresAt(codeExpiresAt);
            setTimer(activeSeconds);
            setStep(3);

            try {
                sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({
                    email: sanitizedEmail,
                    employeeData,
                    step: 3,
                    otpMethod: method,
                    generatedOtp: null,
                    expiresAt: codeExpiresAt
                }));
            } catch {}
        } catch (err) {
            setError(err.message || 'Error sending verification code');
            toast.error(err.message || 'Failed to send verification code');
        } finally {
            otpSendLockRef.current = false;
            setLoading(false);
        }
    };

    const verifyOtpDirect = async (codeToVerify) => {
        if (otpVerifyLockRef.current || loading) return;
        otpVerifyLockRef.current = true;

        const enteredOtp = typeof codeToVerify === 'string' ? codeToVerify : otpCode.join('');
        if (enteredOtp.length < 6) {
            otpVerifyLockRef.current = false;
            return setError("Please enter the complete 6-digit code.");
        }

        setLoading(true);
        setError(null);

        const sanitizedEmail = email.trim().toLowerCase();

        try {
            const res = await fetchWithAuth('/api/auth/otp/verify', {
                method: 'POST',
                body: JSON.stringify({
                    email: sanitizedEmail,
                    identifier: sanitizedEmail,
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

            const isTotpActive = Boolean(
                employeeData?.hasTotp || 
                employeeData?._auth_metadata?.totp_enabled ||
                verifyData?.method === 'totp' ||
                otpMethod === 'totp'
            );

            const userData = { 
                ...employeeData, 
                ...dbData,
                totp_enabled: isTotpActive,
                has_totp: isTotpActive,
                has_registered_biometrics: Boolean(dbData?.has_registered_biometrics || dbData?.biometric_baseline_path || employeeData._auth_metadata?.has_registered_biometrics),
                name: `${dbData.first_name || employeeData.first_name} ${dbData.last_name || employeeData.last_name}`
            };
            
            delete userData._auth_metadata;
            localStorage.setItem('user', JSON.stringify(userData));

            // Clear 2FA temporary session, cooldown, and purge stale profile caches
            try {
                sessionStorage.removeItem('cpoint_login_2fa_session');
                Object.keys(sessionStorage).forEach((key) => {
                    if (key.startsWith('cpoint_my_profile_cache')) {
                        sessionStorage.removeItem(key);
                    }
                });
                sessionStorage.removeItem('cpoint_my_profile_cache');
                clearCooldown();
            } catch {}

            // Broadcast real-time authentication update to all open tabs
            broadcastAuthChange(userData);

            // Prime disciplinary cache synchronously for instant zero-flash screen loading
            if (userData.status === 'inactive' || userData.is_active === false) {
                setDisciplinaryCache(userData.id, {
                    type: userData.is_terminated ? 'Termination' : 'Suspension',
                    record: null
                });
            } else {
                clearDisciplinaryCache(userData.id);
            }

            const isSec = isSecurity(userData);
            const isAdm = isAdmin(userData);
            const needsBio = !userData.has_registered_biometrics && !userData.biometric_baseline_path && !isMedicalExempt(userData) && !isSec && !isAdm;

            if (userData.requires_password_change) {
                toast.success('Please update your password.');
                navigate('/force-password-change');
            } else if (needsBio) {
                toast.success('Please complete your biometric enrollment.');
                navigate('/biometric-setup');
            } else {
                toast.success('Signed in successfully');
                if (isAdm) {
                    navigate('/');
                } else if (isSec) {
                    navigate('/scanner');
                } else {
                    navigate('/employee/dashboard');
                }
            }
        } catch (err) {
            setError(err.message || "Failed to verify code.");
        } finally {
            otpVerifyLockRef.current = false;
            setLoading(false);
        }
    };

    const verifyOtp = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        verifyOtpDirect(otpCode.join(''));
    };

    const handleOtpChange = (index, e) => {
        const rawValue = e.target.value;

        // Support one-time code autofill and paste
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
                // Low-latency auto-submit when all 6 digits are complete
                if (newOtp.join('').length === 6) {
                    verifyOtpDirect(newOtp.join(''));
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

        // Low-latency auto-submit upon entering final 6th digit
        if (char && index === 5 && newOtp.join('').length === 6) {
            verifyOtpDirect(newOtp.join(''));
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
        // Zero-latency auto verification on paste
        if (newOtp.join('').length === 6) {
            verifyOtpDirect(newOtp.join(''));
        }
    };

    return (
        <main className="min-h-[100dvh] w-full bg-slate-50 text-slate-900 flex items-center justify-center p-3 sm:p-6 lg:p-10 select-none overflow-x-hidden relative">
            {/* Ambient luxury subtle lighting */}
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-slate-200/40 rounded-full blur-[128px] pointer-events-none" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-subtle/30 rounded-full blur-[128px] pointer-events-none" />

            {/* Main Master Container (Aligned to System Corner Radius: rounded-xl) */}
            <div className="relative z-10 w-full max-w-[920px] bg-white border border-slate-200 rounded-xl p-4 sm:p-6 lg:p-7 shadow-xl flex flex-col lg:flex-row items-stretch gap-6 lg:gap-8">
                
                {/* Left Hero Card with Shoemakers Background & Blue Gradient Overlay */}
                <div 
                    className="w-full lg:w-[45%] rounded-lg relative overflow-hidden flex flex-col justify-center items-center text-center p-8 sm:p-10 shadow-sm min-h-[260px] lg:min-h-[500px] bg-slate-950"
                >
                    {/* Background Workforce Image (Primary LCP Element) */}
                    <img 
                        src="/shoemakers.jpg" 
                        alt="C-Point Workforce" 
                        width="720"
                        height="480"
                        fetchPriority="high"
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none"
                    />

                    {/* Blue Gradient Overlays (Multi-layered for deep, rich enterprise blue tone & contrast) */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/75 to-slate-900/60 mix-blend-multiply pointer-events-none" />
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-900/40 via-slate-900/50 to-slate-950/85 pointer-events-none" />

                    {/* Subtle Blue Glow Highlights */}
                    <div className="absolute -top-20 -right-20 w-72 h-72 bg-accent/20 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute top-1/2 -left-20 w-64 h-64 bg-accent/15 rounded-full blur-3xl pointer-events-none" />

                    {/* Center Title and Description */}
                    <div className="relative z-10 w-full max-w-[320px] flex flex-col items-center">
                        <div className="mb-6 flex items-center justify-center">
                            <picture>
                                <source srcSet="/logo-crop.webp" type="image/webp" />
                                <img 
                                    src="/logo-crop.png" 
                                    alt="C-Point" 
                                    width="220"
                                    height="48"
                                    fetchPriority="high"
                                    decoding="async"
                                    className="h-10 sm:h-12 w-auto max-w-[220px] object-contain drop-shadow-md select-none pointer-events-none"
                                />
                            </picture>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight drop-shadow-sm">
                            Employee Portal
                        </h2>
                        <p className="text-xs sm:text-sm text-white/90 max-w-[260px] mx-auto mt-2.5 leading-relaxed drop-shadow-xs font-normal">
                            Access your attendance, payroll, and workplace records.
                        </p>
                    </div>
                </div>

                {/* Right Form Container (Clean Light Mode) */}
                <div className="w-full lg:w-[55%] flex flex-col justify-center px-2 sm:px-6 lg:px-7 py-3 sm:py-5">
                    {step === 1 && (
                        <div>
                            {/* Header */}
                            <div className="text-center mb-6">
                                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                                    Sign In Account
                                </h1>
                                <p className="text-xs text-slate-500 mt-1">
                                    Enter your corporate credentials to access your account
                                </p>
                            </div>

                            {/* Security Lockout Banner */}
                            {isLockedOut && (
                                <div role="alert" className="mb-4 p-2.5 rounded-md bg-warning-subtle border border-warning/20 text-warning-ink text-xs font-medium flex items-center gap-2 shadow-2xs">
                                    <ShieldAlert className="w-4 h-4 shrink-0 text-warning-ink" />
                                    <span>Too many failed login attempts. Security lock active for {lockoutTimer}s.</span>
                                </div>
                            )}

                            {/* Credentials Form */}
                            <form onSubmit={handleLogin} className="space-y-3.5">
                                <div>
                                    <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">
                                        Workplace Email
                                    </label>
                                    <input
                                        id="login-email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        autoFocus
                                        autoComplete="username"
                                        placeholder="corporate.email@company.com"
                                        className="w-full h-10 bg-white border border-slate-300 rounded-md px-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors shadow-2xs"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1 ml-0.5">
                                        <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                                            Password
                                        </label>
                                        <Link
                                            to="/forgot-password"
                                            className="text-xs font-semibold text-accent hover:text-accent hover:underline transition-colors"
                                        >
                                            Forgot password?
                                        </Link>
                                    </div>
                                    <div className="relative">
                                        <input
                                            id="login-password"
                                            type={showPassword ? 'text' : 'password'}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            autoComplete="current-password"
                                            placeholder="Enter your password"
                                            className="w-full h-10 bg-white border border-slate-300 rounded-md pl-3 pr-10 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors shadow-2xs"
                                        />
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={() => setShowPassword(prev => !prev)}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    {error && (
                                        <div role="alert" className="mt-2 p-2.5 rounded-md bg-danger-subtle border border-danger/20 text-danger-ink text-xs font-medium flex items-center gap-2 shadow-2xs">
                                            <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
                                            <span>{error}</span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading || isLockedOut}
                                    className="w-full h-10 mt-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-2xs transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                                            <span>Authenticating...</span>
                                        </>
                                    ) : isLockedOut ? (
                                        <span>Security Locked ({lockoutTimer}s)</span>
                                    ) : (
                                        <span>Sign In</span>
                                    )}
                                </button>
                            </form>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-slate-100 border border-slate-200 text-slate-800 mb-2.5 shadow-2xs">
                                <ShieldCheck className="w-5 h-5 text-slate-800" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                                Two-Factor Authentication
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5 mb-3.5">
                                Choose where to receive your 6-digit security code
                            </p>

                            {/* Active code banner */}
                            {timer > 0 && otpMethod && (
                                <div className="mb-3.5 p-3 bg-slate-50 border border-slate-200 rounded-md text-left shadow-2xs">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-700"></span>
                                            </span>
                                            <span>Code active via Email</span>
                                        </span>
                                        <span className="text-[11px] font-mono font-medium text-slate-700 bg-slate-200/80 px-1.5 py-0.5 rounded-sm">
                                            {formattedTimer}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
                                        Your 6-digit code remains valid for {formattedTimer}. You can enter the code already sent to your email.
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
                                        className="w-full h-9 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                    >
                                        <span>Enter Existing Code</span>
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}

                            {/* Method Selection Cards */}
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    disabled={!hasTotp}
                                    onClick={() => {
                                        if (hasTotp) sendOtp('totp');
                                    }}
                                    className={`w-full p-2.5 border rounded-md transition-all flex items-center text-left gap-2.5 shadow-2xs ${
                                        !hasTotp
                                            ? 'bg-slate-50/80 border-slate-200/80 opacity-55 cursor-not-allowed select-none'
                                            : otpMethod === 'totp'
                                                ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-400/30 cursor-pointer'
                                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50 cursor-pointer'
                                    }`}
                                >
                                    <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 shadow-2xs ${
                                        !hasTotp ? 'bg-slate-200 text-slate-400' : 'bg-slate-900 text-white'
                                    }`}>
                                        <ShieldCheck className={`w-4 h-4 ${!hasTotp ? 'text-slate-400' : 'text-white'}`} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <p className={`font-semibold text-xs ${!hasTotp ? 'text-slate-500' : 'text-slate-900'}`}>
                                                Google Authenticator
                                            </p>
                                            {!hasTotp && (
                                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-200/80 px-1.5 py-0.5 rounded-sm border border-slate-300/60">
                                                    Not Registered
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-400 truncate">
                                            {!hasTotp ? 'Not configured for this account' : 'Instant 6-digit code from your phone app'}
                                        </p>
                                    </div>
                                    <ChevronRight className={`w-4 h-4 shrink-0 ${!hasTotp ? 'text-slate-300' : 'text-slate-400'}`} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setOtpMethod('email');
                                        setStep(3);
                                        try {
                                            const s = JSON.parse(sessionStorage.getItem('cpoint_login_2fa_session') || '{}');
                                            sessionStorage.setItem('cpoint_login_2fa_session', JSON.stringify({ ...s, step: 3, otpMethod: 'email' }));
                                        } catch {}
                                    }}
                                    disabled={loading}
                                    style={{ pointerEvents: loading ? 'none' : 'auto' }}
                                    className={`w-full p-2.5 bg-white border rounded-md transition-colors flex items-center text-left gap-2.5 cursor-pointer shadow-2xs disabled:opacity-50 ${
                                        otpMethod === 'email' && timer > 0
                                            ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-400/30'
                                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                                    }`}
                                >
                                    <div className="h-8 w-8 rounded-md bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center shrink-0">
                                        <Mail className="w-4 h-4 text-slate-700" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <p className="font-semibold text-xs text-slate-900">Send via Email</p>
                                            {otpMethod === 'email' && timer > 0 && (
                                                <span className="text-[10px] font-mono font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-sm border border-slate-200">
                                                    Active ({formattedTimer})
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 truncate">
                                            {otpMethod === 'email' && timer > 0 ? `Code active for ${email}` : `Send code to ${email}`}
                                        </p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                </button>
                            </div>

                            {error && (
                                <div role="alert" className="mt-2.5 p-2.5 rounded-md bg-danger-subtle border border-danger/20 text-danger-ink text-xs font-medium flex items-center gap-2 text-left shadow-2xs">
                                    <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={handleReturnToLogin}
                                className="mt-4 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                            >
                                Return to Login
                            </button>
                        </div>
                    )}

                    {step === 3 && otpMethod === 'email' && timer === 0 ? (
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-slate-100 border border-slate-200 text-slate-800 mb-2.5 shadow-2xs">
                                <Mail className="w-5 h-5 text-slate-800" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                                Email Verification
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5 mb-3.5">
                                Click below to send a 6-digit security code to your registered email
                            </p>

                            <div className="mb-3.5 p-3 bg-slate-50 border border-slate-200 rounded-md text-left shadow-2xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-semibold text-slate-700"></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-accent shrink-0" />
                                    <span className="font-mono text-xs font-bold text-slate-900 truncate">
                                        {email}
                                    </span>
                                </div>
                            </div>

                            {error && (
                                <div role="alert" className="mb-3 p-2.5 rounded-md bg-danger-subtle border border-danger/20 text-danger-ink text-xs font-medium flex items-center gap-2 text-left shadow-2xs">
                                    <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                type="button"
                                disabled={loading || isCooldown}
                                style={{ pointerEvents: (loading || isCooldown) ? 'none' : 'auto' }}
                                onClick={() => sendOtp('email', false, false)}
                                className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-2xs transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer disabled:opacity-50"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                                        <span>Sending Code...</span>
                                    </>
                                ) : isCooldown ? (
                                    <span>Wait {cooldown}s before sending</span>
                                ) : (
                                    <>
                                        <Send className="w-3.5 h-3.5" />
                                        <span>Send Code</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                disabled={loading}
                                onClick={() => sendOtp('email', false, true)}
                                className="w-full h-9 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 text-xs cursor-pointer mt-2 border border-slate-200 shadow-2xs"
                            >
                                <i className="ti ti-flask text-sm text-slate-500" />
                                <span>Mock OTP (Skip Brevo Email)</span>
                            </button>

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
                    ) : step === 3 && (
                        <div className="text-center">
                            <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-slate-900 text-white mb-2.5 shadow-2xs">
                                {otpMethod === 'totp' ? (
                                    <ShieldCheck className="w-5 h-5 text-white" />
                                ) : (
                                    <KeyRound className="w-5 h-5 text-white" />
                                )}
                            </div>
                            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                                {otpMethod === 'totp' ? 'Authenticator 2FA' : 'Security Code'}
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5 mb-3.5">
                                {otpMethod === 'totp'
                                    ? 'Enter the 6-digit code from Google Authenticator or Microsoft Authenticator'
                                    : `Enter the 6-digit code sent to ${email}`}
                            </p>

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
                                            className="w-9 h-11 sm:w-10 sm:h-11 text-center text-base sm:text-lg font-bold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-500 transition-colors shadow-2xs font-mono"
                                            autoFocus={idx === 0}
                                        />
                                    ))}
                                </div>

                                {error && (
                                    <div role="alert" className="mb-3 p-2.5 rounded-md bg-danger-subtle border border-danger/20 text-danger-ink text-xs font-medium flex items-center gap-2 text-left shadow-2xs">
                                        <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-2xs transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer disabled:opacity-50"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                                            <span>Verifying...</span>
                                        </>
                                    ) : (
                                        <span>Verify & Proceed</span>
                                    )}
                                </button>
                            </form>

                            {otpMethod === 'totp' ? (
                                <p className="mt-3.5 text-[11px] text-slate-500 flex items-center justify-center gap-1.5 font-medium">
                                    <span>Code rotates every 30s • No cellular signal required</span>
                                </p>
                            ) : (
                                <p className="mt-3.5 text-xs text-slate-500 flex items-center justify-center gap-1">
                                    {timer > 0 ? (
                                        <span>Code expires in <strong className="font-mono text-slate-700">{formattedTimer}</strong></span>
                                    ) : (
                                        <span className="text-danger-ink font-semibold">Code expired.</span>
                                    )}
                                    <span className="mx-1 text-slate-300">•</span>
                                    <button
                                        type="button"
                                        disabled={loading || isCooldown}
                                        style={{ pointerEvents: (loading || isCooldown) ? 'none' : 'auto' }}
                                        onClick={() => sendOtp(otpMethod, true)}
                                        className="text-accent hover:underline font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                    >
                                        {isCooldown ? `Resend (${cooldown}s)` : 'Resend'}
                                    </button>
                                </p>
                            )}

                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-center gap-3">
                                {otpMethod === 'totp' ? (
                                    <button
                                        type="button"
                                        disabled={loading}
                                        style={{ pointerEvents: loading ? 'none' : 'auto' }}
                                        onClick={() => {
                                            setOtpMethod('email');
                                            setOtpCode(['', '', '', '', '', '']);
                                            setError(null);
                                        }}
                                        className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        Use Email Code Instead
                                    </button>
                                ) : hasTotp ? (
                                    <button
                                        type="button"
                                        disabled={loading}
                                        style={{ pointerEvents: loading ? 'none' : 'auto' }}
                                        onClick={() => {
                                            setOtpMethod('totp');
                                            setOtpCode(['', '', '', '', '', '']);
                                            setError(null);
                                            toast.success('Switched to Google Authenticator. Enter the code from your app.');
                                        }}
                                        className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        Use Authenticator Instead
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleSwitchMethod}
                                        className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                    >
                                        Switch Method
                                    </button>
                                )}
                                <span className="text-slate-200 text-xs">•</span>
                                <button
                                    type="button"
                                    onClick={handleSwitchMethod}
                                    className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                                >
                                    All Options
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
            </div>
        </main>
    );
}
