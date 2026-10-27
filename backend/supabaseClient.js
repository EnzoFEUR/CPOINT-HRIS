import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://lzqshktnrvtlattdiwxf.supabase.co').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

// Validate token privilege role
try {
  if (supabaseKey && supabaseKey.includes('.')) {
    const payload = JSON.parse(Buffer.from(supabaseKey.split('.')[1], 'base64').toString('utf8'));
    if (payload.role === 'anon') {
      console.error('[CRITICAL] Backend Supabase client is initialized with an "anon" public key instead of "service_role"! Row Level Security (RLS) is blocking attendance queries and cron writes (Error 42501). Please set SUPABASE_SERVICE_ROLE_KEY in your Render dashboard environment variables.');
    }
  }
} catch (_) {}

export const supabase = createClient(supabaseUrl, supabaseKey);

// User verification must never replace the shared service client's authorization.
export const createIsolatedAuthClient = signal => createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: signal ? {
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal
    })
  } : undefined
});
