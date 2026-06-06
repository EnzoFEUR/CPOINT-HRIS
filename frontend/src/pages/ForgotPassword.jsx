import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const handleReset = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'http://localhost:5173/reset-password',
    });
    if (error) setError(error.message);
    else setMsg('Password reset link sent to your email.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative">
      <div className="relative z-10 w-full max-w-[420px] p-8 mx-4 bg-white/70 backdrop-blur-2xl border border-white/60 rounded-3xl shadow-lg">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-center mb-6">Forgot Password</h1>
        <form onSubmit={handleReset} className="space-y-4">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full p-3 bg-white border border-slate-200 rounded-xl" placeholder="Enter your email" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {msg && <p className="text-green-500 text-sm">{msg}</p>}
          <button type="submit" className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">Send Reset Link</button>
        </form>
        <p className="text-center mt-4 text-sm text-slate-500"><Link to="/login" className="text-blue-600">Back to Login</Link></p>
      </div>
    </div>
  );
}
