import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate, Link } from 'react-router-dom';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);
    const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: {
            data: { name, role: 'employee' }
        }
    });
    
    if (error) setError(error.message);
    else setMsg('Registration successful! Please check your email to verify.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative p-4">
      <div className="relative z-10 w-full max-w-[420px] p-6 sm:p-8 bg-white border border-slate-200 rounded-xl shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight text-center mb-6">Create Account</h1>
        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              required 
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900 transition-colors" 
              placeholder="Juan Dela Cruz" 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Workplace Email</label>
            <input 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              required 
              className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900 transition-colors" 
              placeholder="juan@company.com" 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
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
            Create Account
          </button>
        </form>
        <p className="text-center mt-4 text-xs text-slate-500 font-medium">
          Already have an account? <Link to="/login" className="text-blue-600 hover:underline font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
