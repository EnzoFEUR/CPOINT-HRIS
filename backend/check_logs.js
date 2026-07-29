import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lzqshktnrvtlattdiwxf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6cXNoa3RucnZ0bGF0dGRpd3hmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM4NDU4MSwiZXhwIjoyMDk1OTYwNTgxfQ.dprUUXf8O4sG6epie_sz9LrDNrZxKC0u2cTlCiHbndY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLogs() {
  const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(5);
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}

checkLogs();
