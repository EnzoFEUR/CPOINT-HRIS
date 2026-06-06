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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-2xl w-full max-w-sm shadow-xl">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Confirm Password</h2>
        <p className="text-slate-500 text-sm mb-4">Please confirm your password before continuing.</p>
        <form onSubmit={handleConfirm} className="space-y-4">
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl" placeholder="Password" />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl">Cancel</button>
            <button type="submit" className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl">Confirm</button>
          </div>
        </form>
      </div>
    </div>
  );
}
