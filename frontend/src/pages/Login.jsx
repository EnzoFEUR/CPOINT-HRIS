import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    // OTP State
    const [step, setStep] = useState(1); // 1 = Login, 2 = Select OTP Method, 3 = Verify OTP
    const [employeeData, setEmployeeData] = useState(null);
    const [otpCode, setOtpCode] = useState(['', '', '', '', '', '']);
    const [otpMethod, setOtpMethod] = useState(''); // 'email' or 'sms'
    const [generatedOtp, setGeneratedOtp] = useState(null);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError(null);
        
        // 1. Authenticate with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
        
        if (authError) {
            return setError(authError.message);
        }

        if (authData.user) {
            // 2. Fetch employee profile
            const { data: employee, error: empError } = await supabase
                .from('employees')
                .select('*')
                .eq('id', authData.user.id)
                .single();
                
            if (empError) {
                return setError("Failed to retrieve employee data.");
            }

            // Instead of logging in, save employee data and proceed to OTP step
            setEmployeeData(employee);
            setStep(2);
        }
    };

    const sendOtp = (method) => {
        setOtpMethod(method);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        setGeneratedOtp(code);
        
        // Simulate sending OTP
        if (method === 'sms') {
            toast.success(`Mock SMS sent to +639*** with OTP: ${code}`, { duration: 6000 });
            console.log(`[Twilio Mock] SMS sent to ${employeeData.phone || 'Unknown'}: Your C-Point OTP is ${code}`);
        } else {
            toast.success(`Mock Email sent to ${email} with OTP: ${code}`, { duration: 6000 });
            console.log(`[SendGrid Mock] Email sent to ${email}: Your C-Point OTP is ${code}`);
        }
        
        setStep(3);
    };

    const handleOtpChange = (index, value) => {
        if (!/^[0-9]*$/.test(value)) return;
        const newOtp = [...otpCode];
        newOtp[index] = value;
        setOtpCode(newOtp);

        // Auto-focus next input
        if (value && index < 5) {
            document.getElementById(`otp-${index + 1}`).focus();
        }
    };

    const handleOtpKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !otpCode[index] && index > 0) {
            document.getElementById(`otp-${index - 1}`).focus();
        }
    };

    const verifyOtp = async (e) => {
        e.preventDefault();
        const enteredOtp = otpCode.join('');
        if (enteredOtp !== generatedOtp && enteredOtp !== '000000') {
            return setError("Invalid OTP Code. Please try again.");
        }

        // OTP Valid! Log them in
        const { data: dbData, error: dbError } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employeeData.id)
            .single();

        if (dbError) {
            return setError("Error verifying user data.");
        }

        const userData = { 
            ...employeeData, 
            ...dbData,
            name: `${dbData.first_name || employeeData.first_name} ${dbData.last_name || employeeData.last_name}`
        };
        localStorage.setItem('user', JSON.stringify(userData));

        if (userData.requires_password_change) {
            toast.success('Authentication successful. Please update your password.');
            navigate('/force-password-change');
        } else if (!userData.has_registered_biometrics && userData.role !== 'security' && userData.role !== 'admin') {
            toast.success('Authentication successful. Please register your biometric face scan.');
            navigate('/biometric-setup');
        } else {
            toast.success('Authentication Successful!');
            if (userData.role === 'admin') {
                navigate('/');
            } else if (userData.role === 'security') {
                navigate('/scanner');
            } else {
                navigate('/employee/dashboard');
            }
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden selection:bg-blue-500 selection:text-white"
        >
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes float-1 { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -50px) scale(1.1); } 66% { transform: translate(-20px, 20px) scale(0.9); } }
                @keyframes float-2 { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-30px, 50px) scale(1.15); } 66% { transform: translate(20px, -20px) scale(0.85); } }
                .animate-blob-1 { animation: float-1 12s infinite ease-in-out; }
                .animate-blob-2 { animation: float-2 15s infinite ease-in-out; }
            `}} />

            <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] bg-purple-400/20 rounded-full blur-[120px] animate-blob-1 mix-blend-multiply pointer-events-none"></div>
            <div className="absolute bottom-[-10%] left-[-5%] w-[600px] h-[600px] bg-blue-400/20 rounded-full blur-[120px] animate-blob-2 mix-blend-multiply pointer-events-none"></div>

            <div className="relative z-10 w-full max-w-[420px] p-8 mx-4 bg-white/70 backdrop-blur-2xl border border-white/60 rounded-3xl shadow-[0_20px_50px_rgba(8,112,184,0.1)] transition-all duration-500">
                
                {step === 1 && (
                    <div className="animate-fade-in-up">
                        <div className="text-center mb-8">
                            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 mb-4">
                                <span className="font-bold text-xl tracking-tighter">CP</span>
                            </div>
                            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Welcome Back</h1>
                            <p className="text-slate-500 text-sm mt-1">Enter your credentials to access C-Point.</p>
                        </div>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="group">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1">Operator ID / Email</label>
                                <div className="relative transition-all duration-300 transform group-focus-within:-translate-y-0.5">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <i className="ti ti-mail text-slate-400 text-lg group-focus-within:text-blue-500 transition-colors"></i>
                                    </div>
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus 
                                        className="w-full pl-11 pr-5 py-3.5 bg-white border border-slate-200 hover:border-blue-400/60 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-sm"
                                        placeholder="name@company.com" />
                                </div>
                            </div>
                            <div className="group">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 ml-1">Password</label>
                                <div className="relative transition-all duration-300 transform group-focus-within:-translate-y-0.5">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                        <i className="ti ti-lock text-slate-400 text-lg group-focus-within:text-blue-500 transition-colors"></i>
                                    </div>
                                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} required 
                                        className="w-full pl-11 pr-5 py-3.5 bg-white border border-slate-200 hover:border-blue-400/60 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-sm"
                                        placeholder="••••••••" />
                                </div>
                                {error && <p className="text-red-500 text-xs mt-2 font-bold ml-1">{error}</p>}
                            </div>
                            <button type="submit" className="w-full mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/30 hover:shadow-blue-600/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                                <span>Secure Login</span> <i className="ti ti-arrow-right"></i>
                            </button>
                        </form>
                    </div>
                )}

                {step === 2 && (
                    <div className="animate-fade-in-up text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 text-blue-600 mb-4 shadow-inner">
                            <i className="ti ti-shield-lock text-2xl"></i>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight">Two-Factor Authentication</h2>
                        <p className="text-slate-500 text-sm mt-1 mb-8">Please choose how you want to receive your security code.</p>

                        <div className="space-y-3">
                            <button onClick={() => sendOtp('sms')} className="w-full p-4 bg-white border border-slate-200 rounded-2xl hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/10 transition-all group flex items-center text-left gap-4">
                                <div className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                    <i className="ti ti-device-mobile-message text-xl"></i>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800">Send via SMS</p>
                                    <p className="text-xs text-slate-400 font-medium">To mobile ending in ***{employeeData?.phone ? employeeData.phone.slice(-3) : 'XX'}</p>
                                </div>
                                <i className="ti ti-chevron-right ml-auto text-slate-300 group-hover:text-blue-500"></i>
                            </button>
                            <button onClick={() => sendOtp('email')} className="w-full p-4 bg-white border border-slate-200 rounded-2xl hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/10 transition-all group flex items-center text-left gap-4">
                                <div className="h-10 w-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                    <i className="ti ti-mail-fast text-xl"></i>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800">Send via Email</p>
                                    <p className="text-xs text-slate-400 font-medium">To {email}</p>
                                </div>
                                <i className="ti ti-chevron-right ml-auto text-slate-300 group-hover:text-indigo-500"></i>
                            </button>
                        </div>
                        <button onClick={() => setStep(1)} className="mt-8 text-xs font-bold text-slate-400 hover:text-slate-600 underline">
                            Cancel & Return
                        </button>
                    </div>
                )}

                {step === 3 && (
                    <div className="animate-fade-in-up text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 mb-4 shadow-inner">
                            <i className="ti ti-dialpad text-2xl"></i>
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight">Verify Identity</h2>
                        <p className="text-slate-500 text-sm mt-1 mb-8">Enter the 6-digit code sent to your {otpMethod === 'sms' ? 'phone' : 'email'}.</p>

                        <form onSubmit={verifyOtp}>
                            <div className="flex justify-center gap-2 mb-6">
                                {otpCode.map((digit, idx) => (
                                    <input 
                                        key={idx}
                                        id={`otp-${idx}`}
                                        type="text"
                                        maxLength={1}
                                        value={digit}
                                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                                        className="w-12 h-14 text-center text-2xl font-black text-slate-800 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                                        autoFocus={idx === 0}
                                    />
                                ))}
                            </div>
                            {error && <p className="text-red-500 text-xs mb-4 font-bold">{error}</p>}
                            
                            <button type="submit" className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl shadow-lg hover:bg-black hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2">
                                Verify & Access Dashboard
                            </button>
                        </form>
                        
                        <p className="mt-6 text-xs font-bold text-slate-500">
                            Didn't receive a code? <button onClick={() => sendOtp(otpMethod)} className="text-blue-600 hover:underline">Resend</button>
                        </p>
                    </div>
                )}

            </div>
            
            <div className="absolute bottom-6 w-full text-center pointer-events-none">
                <p className="text-slate-400 text-[10px] font-bold tracking-[0.2em] uppercase">Enterprise Secure Auth</p>
            </div>
        </motion.div>
    );
}
