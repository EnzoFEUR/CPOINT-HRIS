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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative">
      <div className="relative z-10 w-full max-w-[420px] p-8 mx-4 bg-white/70 backdrop-blur-2xl border border-white/60 rounded-3xl shadow-lg">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-center mb-6">Reset Password</h1>
        <form onSubmit={handleUpdate} className="space-y-4">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-3 bg-white border border-slate-200 rounded-xl" placeholder="New Password" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {msg && <p className="text-green-500 text-sm">{msg}</p>}
          <button type="submit" className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">Update Password</button>
        </form>
      </div>
    </div>
  );
}
