import { createClient } from '@supabase/supabase-js';
import { isPublicSupabaseKey } from '../../shared/supabaseBrowserKey.mjs';

const DEFAULT_SUPABASE_URL = 'https://lzqshktnrvtlattdiwxf.supabase.co';
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cXNoa3RucnZ0bGF0dGRpd3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzODQ1ODEsImV4cCI6MjA5NTk2MDU4MX0.3Cs5oyf_RUWkqeL3f-3288A1JQBNKlxxDma_6BeYSCc';

const envUrl = import.meta.env.VITE_SUPABASE_URL;
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabaseUrl = (envUrl || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const supabaseAnonKey = isPublicSupabaseKey(envKey) ? envKey : DEFAULT_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
