import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function VerifyEmail() {
  const [status, setStatus] = useState('Verifying...');
  const navigate = useNavigate();

  useEffect(() => {
    let redirectTimer;
    // Supabase handles the actual verification natively via hash in URL, we just confirm session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        setStatus('Email Verified Successfully!');
        clearTimeout(redirectTimer);
        redirectTimer = setTimeout(() => navigate('/'), 2000);
      }
    });
    return () => {
      subscription.unsubscribe();
      clearTimeout(redirectTimer);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{status}</h1>
      </div>
    </div>
  );
}
