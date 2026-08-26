import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://lzqshktnrvtlattdiwxf.supabase.co').replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cXNoa3RucnZ0bGF0dGRpd3hmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM4NDU4MSwiZXhwIjoyMDk1OTYwNTgxfQ.dprUUXf8O4sG6epie_sz9LrDNrZxKC0u2cTlCiHbndY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
