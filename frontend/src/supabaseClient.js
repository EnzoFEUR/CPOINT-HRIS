import { createClient } from '@supabase/supabase-js';
import { isPublicSupabaseKey } from '../../shared/supabaseBrowserKey.mjs';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://lzqshktnrvtlattdiwxf.supabase.co').replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!isPublicSupabaseKey(supabaseAnonKey)) throw new Error('Configure VITE_SUPABASE_ANON_KEY with a public anon or publishable key. Privileged keys cannot be used in the browser.');

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
