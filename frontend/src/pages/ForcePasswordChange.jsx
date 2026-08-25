import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { motion } from 'framer-motion';

export default function ForcePasswordChange() {
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [error, setError] = useState(null);
    const [user, setUser] = useState(null);
    
    const navigate = useNavigate();

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        } else {
            navigate('/login');
        }
    }, [navigate]);

    // Validation checks
    const hasLength = () => password.length >= 8;
    const hasUppercase = () => /[A-Z]/.test(password);
    const hasLowercase = () => /[a-z]/.test(password);
    const hasNumber = () => /[0-9]/.test(password);
    const hasSpecial = () => /[^A-Za-z0-9]/.test(password);

    const isPasswordValid = () => hasLength() && hasUppercase() && hasLowercase() && hasNumber() && hasSpecial();

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!isPasswordValid()) return setError("Password does not meet all security requirements.");
        if (password !== passwordConfirmation) return setError("Passwords do not match.");

        try {
            const { error: authError } = await supabase.auth.updateUser({ password });
            if (authError) throw authError;

            // Update DB so progress is saved
            await fetchWithAuth('/api/attendance/password-changed', {
                method: 'POST',
                body: JSON.stringify({ employee_id: user.id })
            });

            // Update local storage so we don't get forced back here
            const currentUser = JSON.parse(localStorage.getItem('user'));
            if (currentUser) {
                currentUser.requires_password_change = false; // It's false now!
                localStorage.setItem('user', JSON.stringify(currentUser));
            }

            if (user.role === 'security' || user.role === 'admin') {
                toast.success("Password secured!");
                navigate(user.role === 'security' ? '/scanner' : '/');
            } else {
                toast.success("Password secured! Proceeding to Biometrics.");
                navigate('/biometric-setup');
            }
        } catch (err) {
            setError(err.message || "Failed to update password. Please try again.");
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('user');
        navigate('/login');
    };

    if (!user) return null;

    return (
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            className="bg-slate-50 min-h-screen flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-blue-500 selection:text-white"
        >
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes float-1 { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(30px, -50px) scale(1.1); } 66% { transform: translate(-20px, 20px) scale(0.9); } }
                @keyframes float-2 { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-30px, 50px) scale(1.2); } 66% { transform: translate(20px, -20px) scale(0.8); } }
                .animate-float-1 { animation: float-1 15s ease-in-out infinite; }
                .animate-float-2 { animation: float-2 18s ease-in-out infinite; animation-delay: -5s; }
            `}} />

            <div className="absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] bg-blue-500/20 rounded-full blur-3xl pointer-events-none animate-float-1 mix-blend-multiply"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40rem] h-[40rem] bg-indigo-500/20 rounded-full blur-3xl pointer-events-none animate-float-2 mix-blend-multiply"></div>

            <div className="w-full max-w-lg relative z-10 bg-white/60 backdrop-blur-3xl border border-white p-8 sm:p-10 rounded-[2.5rem] shadow-2xl shadow-blue-900/5">
                
                <div className="text-center mb-8">
                            <div className="h-16 w-16 bg-blue-600 rounded-[1.25rem] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/30 transform rotate-3">
                                <i className="ti ti-shield-lock text-3xl text-white transform -rotate-3"></i>
                            </div>
                            <h2 className="text-3xl font-black text-slate-800 tracking-tight">Security Setup</h2>
                            <p className="text-slate-500 mt-2 text-sm font-medium">Hello <span className="font-bold text-slate-700">{user.name}</span>, you must secure your account before proceeding.</p>
                        </div>

                        {error && (
                            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-bold flex items-center gap-3 border border-red-100 animate-fade-in">
                                <i className="ti ti-alert-circle text-lg"></i>
                                {error}
                            </div>
                        )}

                        <form onSubmit={handlePasswordSubmit} className="space-y-6">
                            <div className="space-y-4">
                                <div className="relative group">
                                    <i className="ti ti-lock absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors text-lg"></i>
                                    <input 
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-11 pr-12 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none"
                                        placeholder="Create new password"
                                        required
                                    />
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none">
                                        <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-lg`}></i>
                                    </button>
                                </div>
                                <div className="relative group">
                                    <i className="ti ti-lock-check absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors text-lg"></i>
                                    <input 
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        value={passwordConfirmation}
                                        onChange={(e) => setPasswordConfirmation(e.target.value)}
                                        className="w-full pl-11 pr-12 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none"
                                        placeholder="Confirm new password"
                                        required
                                    />
                                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none">
                                        <i className={`ti ${showConfirmPassword ? 'ti-eye-off' : 'ti-eye'} text-lg`}></i>
                                    </button>
                                </div>
                            </div>

                            {/* Password security requirements */}
                            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                                <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">Security Requirements</p>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className={`flex items-center gap-2 transition-colors ${hasLength() ? 'text-emerald-500 font-bold' : 'text-slate-400 font-medium'}`}>
                                        <i className={`ti ${hasLength() ? 'ti-circle-check-filled' : 'ti-circle'} text-lg`}></i>
                                        8+ Characters
                                    </div>
                                    <div className={`flex items-center gap-2 transition-colors ${hasUppercase() ? 'text-emerald-500 font-bold' : 'text-slate-400 font-medium'}`}>
                                        <i className={`ti ${hasUppercase() ? 'ti-circle-check-filled' : 'ti-circle'} text-lg`}></i>
                                        1 Uppercase
                                    </div>
                                    <div className={`flex items-center gap-2 transition-colors ${hasNumber() ? 'text-emerald-500 font-bold' : 'text-slate-400 font-medium'}`}>
                                        <i className={`ti ${hasNumber() ? 'ti-circle-check-filled' : 'ti-circle'} text-lg`}></i>
                                        1 Number
                                    </div>
                                    <div className={`flex items-center gap-2 transition-colors ${hasSpecial() ? 'text-emerald-500 font-bold' : 'text-slate-400 font-medium'}`}>
                                        <i className={`ti ${hasSpecial() ? 'ti-circle-check-filled' : 'ti-circle'} text-lg`}></i>
                                        1 Special Character
                                    </div>
                                </div>
                            </div>

                            <button type="submit" disabled={!isPasswordValid() || !password || password !== passwordConfirmation} className="w-full py-4 px-6 bg-slate-900 hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all active:scale-[0.98] shadow-lg shadow-slate-900/20 flex items-center justify-center gap-2">
                                Save Password & Continue
                                <i className="ti ti-arrow-right"></i>
                            </button>
                        </form>

                <div className="mt-8 pt-6 border-t border-slate-100 flex justify-center">
                    <button onClick={handleLogout} className="text-slate-400 hover:text-slate-600 text-sm font-bold flex items-center gap-2 transition-colors">
                        <i className="ti ti-logout"></i> Logout
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
