import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function VerifyEmail() {
  const [status, setStatus] = useState('Verifying...');
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase handles the actual verification natively via hash in URL, we just confirm session
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        setStatus('Email Verified Successfully!');
        setTimeout(() => navigate('/'), 2000);
      }
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{status}</h1>
      </div>
    </div>
  );
}
