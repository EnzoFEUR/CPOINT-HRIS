import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleUpdate = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else {
      setMsg('Password updated successfully!');
      setTimeout(() => navigate('/login'), 2000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative p-4">
      <div className="relative z-10 w-full max-w-[420px] p-6 sm:p-8 bg-white border border-slate-200 rounded-xl shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight text-center mb-6">Reset Password</h1>
        <form onSubmit={handleUpdate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">New Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900 transition-colors" 
              placeholder="••••••••" 
            />
          </div>
          {error && <p className="text-rose-600 text-xs font-medium">{error}</p>}
          {msg && <p className="text-emerald-700 text-xs font-medium">{msg}</p>}
          <button 
            type="submit" 
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold rounded-lg text-sm shadow-xs transition-transform duration-75 cursor-pointer"
          >
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}
