import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function ConfirmPassword({ onConfirmed, onCancel }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const handleConfirm = async (e) => {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    
    // Verify password by attempting to sign in again
    const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: password
    });

    if (signInError) setError('Incorrect password');
    else {
        onConfirmed();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 flex items-center justify-center p-4 z-50">
      <div className="bg-white p-6 rounded-xl border border-slate-200 w-full max-w-sm shadow-xs">
        <h2 className="text-lg font-bold text-slate-900 mb-1.5 tracking-tight">Confirm Password</h2>
        <p className="text-slate-500 text-xs mb-4">Please confirm your workplace password before continuing.</p>
        <form onSubmit={handleConfirm} className="space-y-4">
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
            className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900 transition-colors" 
            placeholder="••••••••" 
          />
          {error && <p className="text-rose-600 text-xs font-medium">{error}</p>}
          <div className="flex gap-2">
            <button 
              type="button" 
              onClick={onCancel} 
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-sm transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold rounded-lg text-sm shadow-xs transition-transform duration-75 cursor-pointer"
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
