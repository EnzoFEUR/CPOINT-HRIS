import { createClient } from '@supabase/supabase-js';
import { isPublicSupabaseKey } from '../../shared/supabaseBrowserKey.mjs';

const DEFAULT_SUPABASE_URL = 'https://lzqshktnrvtlattdiwxf.supabase.co';
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cXNoa3RucnZ0bGF0dGRpd3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODQ1ODEsImV4cCI6MjA5NTk2MDU4MX0.3Cs5oyf_RUWkqeL3f-3288A1JQBNKlxxDma_6BeYSCc';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

if (!isPublicSupabaseKey(supabaseAnonKey)) {
    throw new Error('Configure VITE_SUPABASE_ANON_KEY with a public anon or publishable key. Privileged keys cannot be used in the browser.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
