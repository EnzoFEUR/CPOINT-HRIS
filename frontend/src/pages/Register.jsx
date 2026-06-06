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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden">
      <div className="relative z-10 w-full max-w-[420px] p-8 mx-4 bg-white/70 backdrop-blur-2xl border border-white/60 rounded-3xl shadow-lg">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight text-center mb-6">Create Account</h1>
        <form onSubmit={handleRegister} className="space-y-4">
          <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full p-3 bg-white border border-slate-200 rounded-xl" placeholder="Full Name" />
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full p-3 bg-white border border-slate-200 rounded-xl" placeholder="Email" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-3 bg-white border border-slate-200 rounded-xl" placeholder="Password" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {msg && <p className="text-green-500 text-sm">{msg}</p>}
          <button type="submit" className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">Register</button>
        </form>
        <p className="text-center mt-4 text-sm text-slate-500"><Link to="/login" className="text-blue-600">Already have an account?</Link></p>
      </div>
    </div>
  );
}
