import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useOtpCooldown } from '../utils/useOtpCooldown';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://cpoint-hris.onrender.com' : 'http://localhost:5000');

// Allow demo/preview code display whenever provided by server
const SHOW_DEMO_OTP = true;

export default function OtpVerificationModal({
    isOpen,
    onClose,
    onSuccess,
    email: propEmail,
    phone: propPhone,
    phoneMask: propPhoneMask
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
    const phone = propPhone || sessionUser?.phone || '09123456789';
    const phoneMask = propPhoneMask || (phone ? `***${phone.slice(-2)}` : '***89');

    // Scoped cooldown key based on identity
    const cooldownKey = `modal_otp_${(email || phone || 'global').toLowerCase().trim()}`;
    const { cooldown, isCooldown, startCooldown, clearCooldown } = useOtpCooldown(cooldownKey, 60);

    const [step, setStep] = useState('select');
    const [method, setMethod] = useState('email');
    const [digits, setDigits] = useState(['', '', '', '', '', '']);
    const [isSending, setIsSending] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [demoOtpCode, setDemoOtpCode] = useState(null);

    // Code expiration countdown (5 minutes)
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

    useEffect(() => {
        let timer;
        if (expiryTimer > 0) {
            timer = setInterval(() => {
                setExpiryTimer((prev) => (prev > 0 ? prev - 1 : 0));
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [expiryTimer]);

    useEffect(() => {
        if (isOpen) {
            setDigits(['', '', '', '', '', '']);
            setErrorMessage('');
            try {
                const exp = sessionStorage.getItem(`cpoint_modal_exp_${cooldownKey}`);
                const diff = exp ? Math.ceil((parseInt(exp, 10) - Date.now()) / 1000) : 0;
                if (diff > 0) {
                    setExpiryTimer(diff);
                    setStep('verify');
                } else {
                    setStep('select');
                    setDemoOtpCode(null);
                }
            } catch {
                setStep('select');
            }
        }
    }, [isOpen, cooldownKey]);

    // Handle Method Selection & OTP Dispatch
    const handleSelectMethod = async (selectedMethod) => {
        // If an active code was already dispatched to this method and has not expired (< 5 mins),
        // let the user proceed immediately to verify step without triggering a duplicate dispatch or cooldown
        if (expiryTimer > 0 && selectedMethod === method && step === 'select') {
            toast.success(`Resuming verification with your active code sent via ${method === 'sms' ? 'SMS' : 'Email'}`);
            setStep('verify');
            return;
        }

        if (isCooldown && selectedMethod === method && step === 'verify') {
            toast.error(`Please wait ${cooldown}s before requesting a new code.`);
            return;
        }

        if (isCooldown && selectedMethod !== method) {
            toast.error(`Please wait ${cooldown}s before switching dispatch channel, or use the code already sent.`);
            return;
        }

        setMethod(selectedMethod);
        setIsSending(true);
        setErrorMessage('');
        setDigits(['', '', '', '', '', '']);
        setDemoOtpCode(null);

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/otp/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: selectedMethod,
                    email,
                    phone,
                    purpose: 'modal_stepup'
                })
            });

            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; } catch {}

            if (response.status === 429 || !response.ok || !data.success) {
                if (data.retry_after) {
                    startCooldown(data.retry_after);
                }
                throw new Error(data.error || `Failed to dispatch ${selectedMethod === 'sms' ? 'SMS' : 'email'} verification code.`);
            }

            // Start persistent 60s cooldown
            startCooldown(data.cooldown || 60);

            // Persist 5-minute code expiration timestamp
            const expTime = Date.now() + 300 * 1000;
            try {
                sessionStorage.setItem(`cpoint_modal_exp_${cooldownKey}`, String(expTime));
            } catch {}
            setExpiryTimer(300);

            // Populate previewCode whenever returned by the backend
            if (data.previewCode) {
                setDemoOtpCode(data.previewCode);
            }

            toast.success(
                selectedMethod === 'sms'
                    ? `Verification code sent to ${phoneMask || 'your phone'}`
                    : `Verification code sent to ${email}`
            );
            setStep('verify');
            setTimeout(() => inputRefs.current[0]?.focus(), 150);
        } catch (err) {
            setErrorMessage(err.message || 'Failed to send verification code.');
            toast.error(err.message || 'Failed to send verification code.');
        } finally {
            setIsSending(false);
        }
    };

    // Verify OTP logic
    const verifyOtpCode = useCallback(async (codeToVerify) => {
        const code = codeToVerify || digits.join('');
        if (code.length !== 6) {
            setErrorMessage('Please enter a valid 6-digit code.');
            return;
        }

        setIsVerifying(true);
        setErrorMessage('');

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/otp/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method,
                    email,
                    identifier: method === 'sms' ? phone : email,
                    otp: code,
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
            onSuccess?.(data);
            onClose();
        } catch (err) {
            setErrorMessage(err.message || 'Invalid or expired code.');
            toast.error(err.message || 'Invalid or expired code.');
            setDigits(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
        } finally {
            setIsVerifying(false);
        }
    }, [digits, email, phone, method, onSuccess, onClose]);

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
                className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
                onClick={() => !isVerifying && !isSending && onClose()}
            />

            <div className="relative bg-white rounded-3xl p-8 shadow-2xl w-full max-w-md border border-slate-100 z-10 transition-all animate-in zoom-in-95 duration-200">
                
                {step === 'select' && (
                    <div className="space-y-6">
                        <div className="text-center space-y-2">
                            <div className="h-12 w-12 bg-blue-50 text-blue-600 rounded-2xl mx-auto flex items-center justify-center border border-blue-100 shadow-xs">
                                <i className="ti ti-shield-check text-2xl" />
                            </div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                                Two-Factor Authentication
                            </h2>
                            <p className="text-xs text-slate-500 font-medium">
                                Choose where to receive your security code
                            </p>
                        </div>

                        {/* Active Code Resume Card if valid (< 5 mins) */}
                        {expiryTimer > 0 && (
                            <div className="p-3.5 bg-blue-50/80 border border-blue-200/90 rounded-2xl text-left shadow-2xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        <span className="relative flex h-2 w-2">
                                        </span>
                                        <span>Code active via {method === 'sms' ? 'SMS' : 'Email'}</span>
                                    </span>
                                    <span className="text-[11px] font-mono font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded">
                                        {Math.floor(expiryTimer / 60)}:{String(expiryTimer % 60).padStart(2, '0')}
                                    </span>
                                </div>
                                <p className="text-[11px] text-slate-500 mb-2.5 leading-relaxed">
                                    A verification code is already active and valid for 5 minutes. You can enter the code already sent to your device.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setStep('verify')}
                                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                                >
                                    <span>Enter Existing Code</span>
                                    <i className="ti ti-arrow-right text-xs" />
                                </button>
                            </div>
                        )}

                        <div className="space-y-3 pt-1">
                            <button
                                type="button"
                                onClick={() => handleSelectMethod('sms')}
                                disabled={isSending}
                                className="w-full group p-4 bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 rounded-2xl transition-all flex items-center justify-between text-left cursor-pointer active:scale-98 shadow-xs disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="h-10 w-10 bg-slate-100 group-hover:bg-blue-50 text-slate-600 group-hover:text-blue-600 rounded-xl flex items-center justify-center transition-colors">
                                        <i className="ti ti-device-mobile text-lg" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-800">Send via SMS</h4>
                                        <p className="text-[11px] text-slate-400 font-medium">
                                            Mobile ending in {phoneMask || '***89'}
                                        </p>
                                    </div>
                                </div>
                                <i className="ti ti-chevron-right text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all text-sm" />
                            </button>

                            <button
                                type="button"
                                onClick={() => handleSelectMethod('email')}
                                disabled={isSending}
                                className="w-full group p-4 bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 rounded-2xl transition-all flex items-center justify-between text-left cursor-pointer active:scale-98 shadow-xs disabled:opacity-50"
                            >
                                <div className="flex items-center gap-3.5">
                                    <div className="h-10 w-10 bg-slate-100 group-hover:bg-blue-50 text-slate-600 group-hover:text-blue-600 rounded-xl flex items-center justify-center transition-colors">
                                        <i className="ti ti-mail text-lg" />
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-800">Send via Email</h4>
                                        <p className="text-[11px] text-slate-400 font-medium">
                                            {email}
                                        </p>
                                    </div>
                                </div>
                                <i className="ti ti-chevron-right text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all text-sm" />
                            </button>
                        </div>

                        <div className="text-center pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="text-xs text-slate-500 hover:text-slate-800 font-bold transition-colors cursor-pointer"
                            >
                                Return
                            </button>
                        </div>
                    </div>
                )}

                {step === 'verify' && (
                    <div className="space-y-6">
                        <div className="text-center space-y-2">
                            <div className="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center border border-emerald-100 shadow-xs">
                                <i className="ti ti-dialpad text-2xl" />
                            </div>
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                                Security Code
                            </h2>
                            <p className="text-xs text-slate-500 font-medium">
                                Enter the 6-digit code sent to your {method === 'sms' ? 'phone' : 'email'}
                            </p>
                        </div>

                        {/* Auto-fill Pill */}
                        {demoOtpCode && (
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setDigits(demoOtpCode.split(''));
                                        verifyOtpCode(demoOtpCode);
                                    }}
                                    className="px-3.5 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95"
                                >
                                    <i className="ti ti-bolt text-amber-600" />
                                    <span>Security Code: <strong className="font-mono text-sm tracking-wider font-bold text-amber-950">{demoOtpCode}</strong> (Autofill)</span>
                                </button>
                            </div>
                        )}

                        <div className="space-y-3">
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
                                        className={`w-full h-12 text-center font-mono font-extrabold text-xl rounded-2xl border outline-none transition-all ${
                                            errorMessage
                                                ? 'border-rose-400 bg-rose-50/50 text-rose-900 focus:ring-2 focus:ring-rose-500/20'
                                                : digit
                                                ? 'border-blue-500 bg-blue-50/20 text-blue-950'
                                                : 'border-slate-200 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                                        } disabled:opacity-50`}
                                    />
                                ))}
                            </div>

                            {errorMessage && (
                                <p className="text-xs text-rose-600 font-semibold flex items-center justify-center gap-1 pt-1 animate-in fade-in">
                                    <i className="ti ti-alert-circle text-sm" />
                                    <span>{errorMessage}</span>
                                </p>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => verifyOtpCode()}
                            disabled={isVerifying || isSending || digits.some((d) => !d)}
                            className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 active:scale-98 disabled:opacity-50 text-white font-bold rounded-2xl text-xs transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
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

                        <div className="text-xs text-slate-400 font-medium flex items-center justify-center gap-1.5 pt-1">
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
                                onClick={() => handleSelectMethod(method)}
                                disabled={isCooldown || isSending || isVerifying}
                                className="text-blue-600 hover:text-blue-700 font-bold disabled:text-slate-400 disabled:cursor-not-allowed cursor-pointer transition-colors"
                            >
                                {isSending ? 'Sending...' : isCooldown ? `Resend (${cooldown}s)` : 'Resend'}
                            </button>
                        </div>

                        <div className="text-center pt-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setStep('select');
                                    setDigits(['', '', '', '', '', '']);
                                    setErrorMessage('');
                                }}
                                className="text-xs text-slate-400 hover:text-slate-600 font-semibold transition-colors cursor-pointer"
                            >
                                Switch Method
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}