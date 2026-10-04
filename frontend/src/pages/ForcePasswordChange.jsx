import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { isSecurity, isAdmin, isMedicalExempt } from '../routes/guards';

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

            const isSec = isSecurity(user);
            const isAdm = isAdmin(user);
            const needsBio = !user.has_registered_biometrics && !user.biometric_baseline_path && !isMedicalExempt(user) && !isSec && !isAdm;

            if (isSec) {
                toast.success("Password secured!");
                navigate('/scanner');
            } else if (isAdm) {
                toast.success("Password secured!");
                navigate('/');
            } else if (needsBio) {
                toast.success("Password secured! Proceeding to Biometrics enrollment.");
                navigate('/biometric-setup');
            } else {
                toast.success("Password secured!");
                navigate('/employee/dashboard');
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
        <div className="bg-slate-50 min-h-screen flex items-center justify-center p-4 relative overflow-hidden select-none font-sans">
            <div className="w-full max-w-[390px] relative z-10 bg-white border border-slate-200 p-6 sm:p-7 rounded-lg shadow-xl">
                
                <div className="text-center mb-5 sm:mb-6">
                    <div className="h-10 w-10 bg-slate-900 rounded-md flex items-center justify-center mx-auto mb-2.5 shadow-2xs text-white">
                        <i className="ti ti-shield-lock text-lg"></i>
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 tracking-tight">Security Setup</h2>
                    <p className="text-slate-500 mt-0.5 text-xs">Hello <span className="font-semibold text-slate-800">{user.name}</span>, you must secure your account before proceeding.</p>
                </div>

                {error && (
                    <div className="mb-4 p-2.5 bg-rose-50 text-rose-700 rounded-md text-xs font-medium flex items-center gap-2 border border-rose-200">
                        <i className="ti ti-alert-circle text-base shrink-0"></i>
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handlePasswordSubmit} className="space-y-3.5">
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">New Password</label>
                            <div className="relative">
                                <i className="ti ti-lock absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                                <input 
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full h-9 pl-9 pr-9 bg-white border border-slate-300 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs font-mono"
                                    placeholder="Create new password"
                                    required
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer">
                                    <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-sm`}></i>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1 ml-0.5">Confirm Password</label>
                            <div className="relative">
                                <i className="ti ti-lock-check absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                                <input 
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={passwordConfirmation}
                                    onChange={(e) => setPasswordConfirmation(e.target.value)}
                                    className="w-full h-9 pl-9 pr-9 bg-white border border-slate-300 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-500 transition-colors duration-100 shadow-2xs font-mono"
                                    placeholder="Confirm new password"
                                    required
                                />
                                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer">
                                    <i className={`ti ${showConfirmPassword ? 'ti-eye-off' : 'ti-eye'} text-sm`}></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Password security requirements */}
                    <div className="bg-slate-50 p-2.5 rounded-md border border-slate-200/80">
                        <p className="text-[10px] font-semibold text-slate-500 mb-2 uppercase tracking-wider">Security Requirements</p>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                            <div className={`flex items-center gap-1.5 transition-colors ${hasLength() ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>
                                <i className={`ti ${hasLength() ? 'ti-circle-check-filled text-emerald-600' : 'ti-point text-slate-400'} text-xs`}></i>
                                8+ Characters
                            </div>
                            <div className={`flex items-center gap-1.5 transition-colors ${hasUppercase() ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>
                                <i className={`ti ${hasUppercase() ? 'ti-circle-check-filled text-emerald-600' : 'ti-point text-slate-400'} text-xs`}></i>
                                1 Uppercase
                            </div>
                            <div className={`flex items-center gap-1.5 transition-colors ${hasNumber() ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>
                                <i className={`ti ${hasNumber() ? 'ti-circle-check-filled text-emerald-600' : 'ti-point text-slate-400'} text-xs`}></i>
                                1 Number
                            </div>
                            <div className={`flex items-center gap-1.5 transition-colors ${hasSpecial() ? 'text-emerald-700 font-medium' : 'text-slate-400'}`}>
                                <i className={`ti ${hasSpecial() ? 'ti-circle-check-filled text-emerald-600' : 'ti-point text-slate-400'} text-xs`}></i>
                                1 Special Char
                            </div>
                        </div>
                    </div>

                    <button type="submit" disabled={!isPasswordValid() || !password || password !== passwordConfirmation} className="w-full h-10 mt-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 text-xs cursor-pointer">
                        Save Password &amp; Continue
                        <i className="ti ti-arrow-right text-xs"></i>
                    </button>
                </form>

                <div className="mt-5 pt-4 border-t border-slate-100 flex justify-center">
                    <button onClick={handleLogout} className="text-slate-500 hover:text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors duration-100 cursor-pointer">
                        <i className="ti ti-logout text-sm"></i> Logout
                    </button>
                </div>
            </div>
        </div>
    );
}
