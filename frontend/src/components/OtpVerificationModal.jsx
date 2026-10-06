import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useOtpCooldown } from '../utils/useOtpCooldown';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://cpoint-hris.onrender.com' : 'http://localhost:5000');

export default function OtpVerificationModal({
    isOpen,
    onClose,
    onSuccess,
    email: propEmail,
    initialMethod,
    title = 'Two-Factor Authentication',
    subtitle = 'Choose where to receive your security code',
    description
}) {
    // Resolve logged-in user details from local session storage if not explicitly passed via props
    const sessionUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem('user') || localStorage.getItem('authUser') || '{}');
        } catch {
            return {};
        }
    }, []);

    const email = propEmail || sessionUser?.email || '';

    // Scoped cooldown key based on identity
    const cooldownKey = `modal_otp_${(email || 'global').toLowerCase().trim()}`;
    const { cooldown, isCooldown, startCooldown, clearCooldown } = useOtpCooldown(cooldownKey, 60);

    // TOTP status detection
    const [hasTotp, setHasTotp] = useState(() => {
        return Boolean(
            sessionUser?.totp_enabled ||
            sessionUser?.has_totp ||
            sessionUser?._auth_metadata?.totp_enabled
        );
    });

    const [step, setStep] = useState('select');
    const [method, setMethod] = useState(initialMethod || (hasTotp ? 'totp' : 'email'));
    const [digits, setDigits] = useState(['', '', '', '', '', '']);
    const [isSending, setIsSending] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [backupMode, setBackupMode] = useState(false);
    const [backupCode, setBackupCode] = useState('');

    // Code expiration countdown for Email (5 minutes)
    const [expiryTimer, setExpiryTimer] = useState(() => {
        try {
            const exp = sessionStorage.getItem(`cpoint_modal_exp_${cooldownKey}`);
            if (!exp) return 0;
            const diff = Math.ceil((parseInt(exp, 10) - Date.now()) / 1000);
            return diff > 0 ? diff : 0;
        } catch {
            return 0;
        }
    });

    const inputRefs = useRef([]);
    const sendLockRef = useRef(false);
    const verifyLockRef = useRef(false);
    const lastSendClickRef = useRef(0);

    // Live background verification of TOTP status when modal opens
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;

        const checkTotpStatus = async () => {
            try {
                const targetId = email || sessionUser?.id || sessionUser?.company_id;
                if (!targetId) return;
                const res = await fetch(`${API_BASE_URL}/api/auth/totp/status?identifier=${encodeURIComponent(targetId)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (isMounted && typeof data.enabled === 'boolean') {
                        setHasTotp(Boolean(data.enabled));
                    }
                }
            } catch {
                // Keep local state fallback
            }
        };

        checkTotpStatus();
        return () => {
            isMounted = false;
        };
    }, [isOpen, email, sessionUser]);

    useEffect(() => {
        let timer;
        if (expiryTimer > 0) {
            timer = setInterval(() => {
                setExpiryTimer((prev) => {
                    if (prev <= 1) {
                        try {
                            sessionStorage.removeItem(`cpoint_modal_exp_${cooldownKey}`);
                        } catch {}
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [expiryTimer, cooldownKey]);

    useEffect(() => {
        if (isOpen) {
            setDigits(['', '', '', '', '', '']);
            setErrorMessage('');
            setBackupMode(false);
            setBackupCode('');

            try {
                const exp = sessionStorage.getItem(`cpoint_modal_exp_${cooldownKey}`);
                const diff = exp ? Math.ceil((parseInt(exp, 10) - Date.now()) / 1000) : 0;
                if (diff > 0) {
                    setExpiryTimer(diff);
                } else {
                    setExpiryTimer(0);
                }
            } catch {
                setExpiryTimer(0);
            }
            setStep('select');
        }
    }, [isOpen, cooldownKey]);

    // Handle Method Selection (Zero dispatch wait, zero premature Brevo quota consumption)
    const handleSelectMethod = (selectedMethod) => {
        setErrorMessage('');
        setDigits(['', '', '', '', '', '']);
        setBackupMode(false);
        setBackupCode('');

        if (selectedMethod === 'totp') {
            if (!hasTotp) {
                toast.error('Google Authenticator is not registered on this account.');
                return;
            }
            setMethod('totp');
            setStep('verify');
            setTimeout(() => inputRefs.current[0]?.focus(), 150);
            return;
        }

        if (selectedMethod === 'email') {
            setMethod('email');
            setStep('verify');
            if (expiryTimer > 0) {
                setTimeout(() => inputRefs.current[0]?.focus(), 150);
            }
        }
    };

    // Explicit Manual Email OTP Dispatch (Dispatches only upon user manual click to preserve Brevo credits)
    const handleSendEmailOtp = async (isResend = false, isMock = false) => {
        // Double-click protection: Synchronous ref lock + 1500ms time throttle
        const now = Date.now();
        if (sendLockRef.current || isSending || (now - lastSendClickRef.current < 1500)) {
            return;
        }
        lastSendClickRef.current = now;
        sendLockRef.current = true;

        if (isCooldown && !isMock) {
            sendLockRef.current = false;
            toast.error(`Please wait ${cooldown}s before requesting a new code.`);
            return;
        }

        setIsSending(true);
        setErrorMessage('');
        setDigits(['', '', '', '', '', '']);
        setBackupMode(false);

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/otp/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: 'email',
                    email,
                    purpose: 'modal_stepup',
                    mock: isMock
                })
            });

            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}

            if (response.status === 429 || !response.ok || !data.success) {
                if (data.retry_after) {
                    startCooldown(data.retry_after);
                }
                throw new Error(data.error || 'Failed to dispatch email verification code.');
            }

            // Start persistent cooldown (shorter for mock testing)
            startCooldown(data.cooldown || (isMock ? 5 : 60));

            // Persist code expiration timestamp
            const activeSeconds = data.expiresIn || 300;
            const expTime = Date.now() + activeSeconds * 1000;
            try {
                sessionStorage.setItem(`cpoint_modal_exp_${cooldownKey}`, String(expTime));
            } catch {}
            setExpiryTimer(activeSeconds);

            if (isMock && data.previewCode) {
                const previewDigits = data.previewCode.split('');
                setDigits(previewDigits);
                toast.success(`Mock OTP: ${data.previewCode} (for testing only)`);
            } else {
                toast.success(
                    isResend
                        ? `Verification code resent to ${email}`
                        : `Verification code sent to ${email}`
                );
            }

            setTimeout(() => inputRefs.current[0]?.focus(), 150);
        } catch (err) {
            setErrorMessage(err.message || 'Failed to send verification code.');
            toast.error(err.message || 'Failed to send verification code.');
        } finally {
            sendLockRef.current = false;
            setIsSending(false);
        }
    };

    // Verify OTP logic (Branching for TOTP vs Email)
    const verifyOtpCode = useCallback(async (codeToVerify) => {
        if (verifyLockRef.current || isVerifying) {
            return;
        }
        verifyLockRef.current = true;

        const isTotpMethod = method === 'totp';
        const targetCode = backupMode ? backupCode.trim() : (codeToVerify || digits.join(''));

        if (!backupMode && targetCode.length !== 6) {
            verifyLockRef.current = false;
            setErrorMessage('Please enter a valid 6-digit code.');
            return;
        }

        if (backupMode && !targetCode) {
            verifyLockRef.current = false;
            setErrorMessage('Please enter an emergency backup code.');
            return;
        }

        setIsVerifying(true);
        setErrorMessage('');

        try {
            if (isTotpMethod) {
                // Route to TOTP verification endpoint (<15ms response)
                const response = await fetch(`${API_BASE_URL}/api/auth/totp/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        identifier: email || sessionUser?.email,
                        email: email || sessionUser?.email,
                        code: targetCode,
                        isBackupCode: backupMode || targetCode.startsWith('CP-') || targetCode.length > 6
                    })
                });

                const text = await response.text();
                let data = {};
                try { data = text ? JSON.parse(text) : {}; } catch {}

                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Invalid authenticator code.');
                }

                toast.success(data.message || 'Identity verified successfully');
                if (onSuccess) {
                    onSuccess(data);
                } else {
                    onClose?.();
                }
            } else {
                // Route to standard Email OTP verification
                const response = await fetch(`${API_BASE_URL}/api/auth/otp/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        method: 'email',
                        email,
                        identifier: email,
                        otp: targetCode,
                        purpose: 'modal_stepup'
                    })
                });

                const text = await response.text();
                let data = {};
                try { data = text ? JSON.parse(text) : {}; } catch {}

                if (!response.ok || !data.success) {
                    throw new Error(data.error || 'Invalid verification code.');
                }

                try {
                    sessionStorage.removeItem(`cpoint_modal_exp_${cooldownKey}`);
                    clearCooldown();
                } catch {}

                toast.success('Identity verified successfully');
                if (onSuccess) {
                    onSuccess(data);
                } else {
                    onClose?.();
                }
            }
        } catch (err) {
            setErrorMessage(err.message || 'Invalid or expired code.');
            toast.error(err.message || 'Invalid or expired code.');
            if (!backupMode) {
                setDigits(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            }
        } finally {
            verifyLockRef.current = false;
            setIsVerifying(false);
        }
    }, [digits, email, method, backupMode, backupCode, sessionUser, cooldownKey, clearCooldown, onSuccess, onClose]);

    const handleInputChange = (index, value) => {
        const cleanVal = value.replace(/\D/g, '');
        if (!cleanVal && value !== '') return;

        const newDigits = [...digits];
        newDigits[index] = cleanVal.slice(-1);
        setDigits(newDigits);
        setErrorMessage('');

        if (cleanVal && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }

        if (newDigits.every((d) => d !== '') && cleanVal) {
            verifyOtpCode(newDigits.join(''));
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowLeft' && index > 0) {
            inputRefs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowRight' && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handlePaste = (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (!pastedData) return;

        const newDigits = [...digits];
        for (let i = 0; i < pastedData.length; i++) {
            newDigits[i] = pastedData[i];
        }
        setDigits(newDigits);
        setErrorMessage('');

        const nextFocusIndex = Math.min(pastedData.length, 5);
        inputRefs.current[nextFocusIndex]?.focus();

        if (pastedData.length === 6) {
            verifyOtpCode(pastedData);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 font-sans">
            <div
                aria-hidden="true"
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-[6px] transition-opacity duration-200 animate-in fade-in"
                onClick={() => !isVerifying && !isSending && onClose()}
            />

            <div className="relative bg-white rounded-xl p-6 shadow-2xl w-full max-w-md border border-slate-200 z-10 transition-all duration-100">

                {step === 'select' && (
                    <div className="space-y-5">
                        <div className="text-center space-y-1.5 pr-6 pl-6">
                            <div className="h-11 w-11 bg-accent-subtle text-accent rounded-lg mx-auto flex items-center justify-center border border-accent/20 shadow-2xs">
                                <i className="ti ti-shield-check text-xl" />
                            </div>
                            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                                {title}
                            </h2>
                            <p className="text-xs text-slate-500 font-medium leading-relaxed">
                                {description || subtitle}
                            </p>
                        </div>

                        {/* Active Code Resume Card if valid (< 5 mins) */}
                        {expiryTimer > 0 && method === 'email' && (
                            <div className="p-3 bg-accent-subtle/80 border border-accent/20 rounded-md text-left shadow-2xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        <span className="relative flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                                        </span>
                                        <span>Code active via Email</span>
                                    </span>
                                    <span className="text-[11px] font-mono font-bold text-accent bg-accent-subtle/80 px-2 py-0.5 rounded">
                                        {Math.floor(expiryTimer / 60)}:{String(expiryTimer % 60).padStart(2, '0')}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                                    A verification code is already active. You can enter the code already sent to your email.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setStep('verify')}
                                    className="w-full h-8 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100 cursor-pointer"
                                >
                                    <span>Enter Existing Code</span>
                                    <i className="ti ti-arrow-right text-xs" />
                                </button>
                            </div>
                        )}

                        <div className="space-y-2 pt-1">
                            {/* Option 1: Google Authenticator (TOTP) */}
                            <button
                                type="button"
                                onClick={() => handleSelectMethod('totp')}
                                disabled={!hasTotp || isSending}
                                className={`w-full group p-3 rounded-md transition-all duration-100 flex items-center justify-between text-left shadow-2xs border ${
                                    hasTotp
                                        ? 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300 cursor-pointer'
                                        : 'bg-slate-50/70 border-slate-200 opacity-55 cursor-not-allowed'
                                }`}
                            >
                                <div className="flex items-center gap-3 min-w-0 pr-2">
                                    <div className={`h-9 w-9 rounded-md flex items-center justify-center shrink-0 transition-colors duration-100 ${
                                        hasTotp
                                            ? 'bg-slate-100 group-hover:bg-accent-subtle text-slate-700 group-hover:text-accent'
                                            : 'bg-slate-200 text-slate-400'
                                    }`}>
                                        <i className="ti ti-shield-lock text-lg" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-xs font-bold text-slate-800">
                                                Google Authenticator
                                            </h4>
                                        </div>
                                        <p className="text-[11px] text-slate-500 font-medium truncate">
                                            {hasTotp
                                                ? 'Instant 6-digit cryptographic token'
                                                : 'Not configured on this account'}
                                        </p>
                                    </div>
                                </div>
                                <div className="shrink-0 flex items-center gap-1.5">
                                    {hasTotp ? (
                                        <span className="px-2 py-0.5 text-[10px] font-bold text-ink bg-surface-muted rounded border border-line flex items-center gap-1">
                                            <i className="ti ti-bolt text-[11px]" />
                                            <span>Instant (0s)</span>
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 text-[10px] font-bold text-slate-500 bg-slate-100 rounded border border-slate-200">
                                            Not Registered
                                        </span>
                                    )}
                                    <i className={`ti ti-chevron-right text-sm transition-colors ${hasTotp ? 'text-slate-400 group-hover:text-slate-600' : 'text-slate-300'}`} />
                                </div>
                            </button>

                            {/* Option 2: Send via Email */}
                            <button
                                type="button"
                                onClick={() => handleSelectMethod('email')}
                                disabled={isSending}
                                style={{ pointerEvents: isSending ? 'none' : 'auto' }}
                                className="w-full group p-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-md transition-colors duration-100 flex items-center justify-between text-left cursor-pointer shadow-2xs disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3 min-w-0 pr-2">
                                    <div className="h-9 w-9 bg-slate-100 group-hover:bg-accent-subtle text-slate-600 group-hover:text-accent rounded-md flex items-center justify-center shrink-0 transition-colors duration-100">
                                        <i className="ti ti-mail text-lg" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-bold text-slate-800">Send via Email</h4>
                                            {expiryTimer > 0 && (
                                                <span className="text-[10px] font-mono font-bold text-accent bg-accent-subtle border border-accent/20 px-1.5 py-0.5 rounded">
                                                    Active ({Math.floor(expiryTimer / 60)}:{String(expiryTimer % 60).padStart(2, '0')})
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 font-medium truncate">
                                            {expiryTimer > 0 ? `Code active for ${email}` : `Send code to ${email}`}
                                        </p>
                                    </div>
                                </div>
                                <i className="ti ti-chevron-right text-slate-400 group-hover:text-slate-600 transition-colors text-sm shrink-0" />
                            </button>
                        </div>

                        <div className="text-center pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-xs text-slate-500 hover:text-slate-800 font-semibold transition-colors duration-100 cursor-pointer"
                            >
                                Return
                            </button>
                        </div>
                    </div>
                )}

                {step === 'verify' && (
                    <div className="space-y-5">
                        {method === 'email' && expiryTimer === 0 ? (
                            <div className="space-y-4">
                                <div className="text-center space-y-1.5 pr-6 pl-6">
                                    <div className="h-11 w-11 rounded-lg mx-auto flex items-center justify-center border shadow-2xs bg-accent-subtle text-accent border-accent/20">
                                        <i className="ti ti-mail text-xl" />
                                    </div>
                                    <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                                        Email Verification
                                    </h2>
                                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                                        Click below to send a 6-digit security code to your registered email address.
                                    </p>
                                </div>

                                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md shadow-2xs text-left">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-xs font-semibold text-slate-700">Email</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <i className="ti ti-mail-check text-accent text-base shrink-0" />
                                        <span className="font-mono text-xs font-bold text-slate-900 truncate">
                                            {email}
                                        </span>
                                    </div>
                                </div>

                                {errorMessage && (
                                    <p className="text-xs text-danger-ink font-semibold flex items-center justify-center gap-1 text-center">
                                        <i className="ti ti-alert-circle text-sm shrink-0" />
                                        <span>{errorMessage}</span>
                                    </p>
                                )}

                                <button
                                    type="button"
                                    onClick={() => handleSendEmailOtp(false, false)}
                                    disabled={isSending || isCooldown}
                                    style={{ pointerEvents: (isSending || isCooldown) ? 'none' : 'auto' }}
                                    className="w-full h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-md text-xs transition-colors duration-100 shadow-2xs cursor-pointer flex items-center justify-center gap-2"
                                >
                                    {isSending ? (
                                        <>
                                            <i className="ti ti-loader animate-spin text-base" />
                                            <span>Sending Code...</span>
                                        </>
                                    ) : isCooldown ? (
                                        <span>Wait {cooldown}s before sending</span>
                                    ) : (
                                        <>
                                            <i className="ti ti-send text-xs" />
                                            <span>Send Code</span>
                                        </>
                                    )}
                                </button>

                                <button
                                    type="button"
                                    disabled={isSending}
                                    onClick={() => handleSendEmailOtp(false, true)}
                                    className="w-full h-9 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 text-xs cursor-pointer mt-2 border border-slate-200 shadow-2xs"
                                >
                                    <i className="ti ti-flask text-sm text-slate-500" />
                                    <span>Test OTP</span>
                                </button>

                                <div className="text-center pt-1 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => {
                                             setStep('select');
                                            setDigits(['', '', '', '', '', '']);
                                            setErrorMessage('');
                                        }}
                                        className="text-xs text-slate-500 hover:text-slate-700 font-semibold transition-colors duration-100 cursor-pointer mt-1"
                                    >
                                        Switch Verification Method
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="text-center space-y-1.5 pr-6 pl-6">
                                    <div className={`h-11 w-11 rounded-lg mx-auto flex items-center justify-center border shadow-2xs ${
                                        method === 'totp'
                                            ? 'bg-accent-subtle text-accent border-accent/20'
                                            : 'bg-surface-muted text-ink border-line'
                                    }`}>
                                        <i className={`text-xl ti ${method === 'totp' ? 'ti-shield-lock' : 'ti-dialpad'}`} />
                                    </div>
                                    <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                                        {method === 'totp'
                                            ? (backupMode ? 'Emergency Recovery Code' : 'Authenticator Code')
                                            : 'Security Code'}
                                    </h2>
                                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                                        {method === 'totp'
                                            ? (backupMode
                                                ? 'Enter one of your 8 emergency backup codes (CP-XXXX-XXXX)'
                                                : 'Enter the 6-digit code displayed in Google Authenticator')
                                            : `Enter the 6-digit code sent to ${email}`}
                                    </p>
                                </div>

                                {/* TOTP Live Rotation Badge */}
                                {method === 'totp' && !backupMode && (
                                    <div className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-accent-subtle/70 border border-accent/20 rounded-md text-[11px] text-accent-strong font-medium">
                                        <i className="ti ti-clock-check text-accent text-sm" />
                                        <span>Tokens rotate automatically every 30 seconds</span>
                                    </div>
                                )}


                                <div className="space-y-3">
                                    {backupMode ? (
                                        <div>
                                            <input
                                                type="text"
                                                placeholder="CP-XXXX-XXXX"
                                                value={backupCode}
                                                onChange={(e) => {
                                                    setBackupCode(e.target.value.toUpperCase());
                                                    setErrorMessage('');
                                                }}
                                                disabled={isVerifying}
                                                className="w-full h-11 text-center font-mono font-bold text-base tracking-widest rounded-md border border-slate-200 bg-white focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none uppercase transition-colors"
                                            />
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-6 gap-2" onPaste={handlePaste}>
                                            {digits.map((digit, index) => (
                                                <input
                                                    key={index}
                                                    ref={(el) => (inputRefs.current[index] = el)}
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={1}
                                                    value={digit}
                                                    onChange={(e) => handleInputChange(index, e.target.value)}
                                                    onKeyDown={(e) => handleKeyDown(index, e)}
                                                    disabled={isSending || isVerifying}
                                                    className={`w-full h-11 text-center font-mono font-bold text-lg rounded-md border outline-none transition-colors duration-100 ${
                                                        errorMessage
                                                            ? 'border-danger bg-danger-subtle/50 text-danger-ink focus:ring-1 focus:ring-danger/20'
                                                            : digit
                                                            ? 'border-accent bg-accent-subtle/20 text-accent-strong'
                                                            : 'border-slate-200 bg-white focus:border-accent focus:ring-1 focus:ring-accent/20'
                                                    } disabled:opacity-50`}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {errorMessage && (
                                        <p className="text-xs text-danger-ink font-semibold flex items-center justify-center gap-1 pt-1 text-center">
                                            <i className="ti ti-alert-circle text-sm shrink-0" />
                                            <span>{errorMessage}</span>
                                        </p>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => verifyOtpCode()}
                                    disabled={isVerifying || isSending || (backupMode ? !backupCode.trim() : digits.some((d) => !d))}
                                    style={{ pointerEvents: (isVerifying || isSending) ? 'none' : 'auto' }}
                                    className="w-full h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-md text-xs transition-colors duration-100 shadow-2xs cursor-pointer flex items-center justify-center gap-2"
                                >
                                    {isVerifying ? (
                                        <>
                                            <i className="ti ti-loader animate-spin text-base" />
                                            <span>Verifying...</span>
                                        </>
                                    ) : (
                                        <span>Verify & Proceed</span>
                                    )}
                                </button>

                                {/* Method Specific Controls: Resend for Email, Backup code toggle for TOTP */}
                                {method === 'totp' ? (
                                    <div className="text-center pt-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setBackupMode(!backupMode);
                                                setErrorMessage('');
                                                setDigits(['', '', '', '', '', '']);
                                                setBackupCode('');
                                            }}
                                            className="text-xs text-accent hover:text-accent-strong font-semibold transition-colors cursor-pointer"
                                        >
                                            {backupMode ? 'Use 6-digit authenticator code' : 'Use emergency recovery code'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-500 font-medium flex items-center justify-center gap-1.5 pt-1">
                                        <span>
                                            Code expires in{' '}
                                            <strong className="text-slate-700 font-mono">
                                                {expiryTimer > 0
                                                    ? `${Math.floor(expiryTimer / 60)}:${(expiryTimer % 60)
                                                          .toString()
                                                          .padStart(2, '0')}`
                                                    : '0:00'}
                                            </strong>
                                        </span>
                                        <span>•</span>
                                        <button
                                            type="button"
                                            onClick={() => handleSendEmailOtp(true)}
                                            disabled={isCooldown || isSending || isVerifying}
                                            style={{ pointerEvents: (isCooldown || isSending || isVerifying) ? 'none' : 'auto' }}
                                            className="text-accent hover:text-accent font-bold disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                        >
                                            {isSending ? 'Sending...' : isCooldown ? `Resend (${cooldown}s)` : 'Resend'}
                                        </button>
                                    </div>
                                )}

                                {/* In-Step 1-Click Omnichannel Switcher */}
                                <div className="pt-2 border-t border-slate-100 flex flex-col items-center justify-center">
                                    {method === 'totp' ? (
                                        <button
                                            type="button"
                                            disabled={isSending || isVerifying}
                                            onClick={() => {
                                                setErrorMessage('');
                                                setDigits(['', '', '', '', '', '']);
                                                setBackupMode(false);
                                                setBackupCode('');
                                                setMethod('email');
                                                if (expiryTimer > 0) {
                                                    toast.success(`Switched to Email OTP. Enter the code sent to ${email}.`);
                                                    setTimeout(() => inputRefs.current[0]?.focus(), 150);
                                                }
                                            }}
                                            className="text-xs text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1.5 transition-colors duration-100 cursor-pointer disabled:opacity-50"
                                        >
                                            <i className="ti ti-mail text-slate-500" />
                                            <span>Don't have your Authenticator app? <span className="font-semibold text-slate-900 underline">Use Email OTP</span></span>
                                        </button>
                                    ) : (
                                        hasTotp && (
                                            <button
                                                type="button"
                                                disabled={isSending || isVerifying}
                                                onClick={() => {
                                                    setErrorMessage('');
                                                    setDigits(['', '', '', '', '', '']);
                                                    setBackupMode(false);
                                                    setBackupCode('');
                                                    setMethod('totp');
                                                    toast.success('Switched to Google Authenticator. Enter the 6-digit code from your app.');
                                                    setTimeout(() => inputRefs.current[0]?.focus(), 150);
                                                }}
                                                className="text-xs text-slate-600 hover:text-slate-900 font-medium inline-flex items-center gap-1.5 transition-colors duration-100 cursor-pointer disabled:opacity-50"
                                            >
                                                <i className="ti ti-shield-lock text-slate-500" />
                                                <span>Prefer your Authenticator app? <span className="font-semibold text-slate-900 underline">Use Authenticator</span></span>
                                            </button>
                                        )
                                    )}
                                </div>

                                <div className="text-center pt-1 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStep('select');
                                            setDigits(['', '', '', '', '', '']);
                                            setBackupMode(false);
                                            setBackupCode('');
                                            setErrorMessage('');
                                        }}
                                        className="text-xs text-slate-500 hover:text-slate-700 font-semibold transition-colors duration-100 cursor-pointer mt-1"
                                    >
                                        Switch Verification Method
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}