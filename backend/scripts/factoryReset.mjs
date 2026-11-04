import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { supabase } from '../supabaseClient.js';
import { clearAuthUserCache } from '../middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const ADMIN_ID = 'ae356e4f-6cab-4e43-ac9a-275100714cfd';
const GUARD_ID = '7cf06bdb-6745-4fe2-914e-29f280835fe0';
const ADMIN_PASSWORD = process.env.FACTORY_RESET_ADMIN_PASSWORD || 'Admin123!';
const GUARD_PASSWORD = process.env.FACTORY_RESET_GUARD_PASSWORD || 'Guard123!';

async function shredStorage() {
  console.log('[1/5] Shredding physical files from Supabase Storage...');
  const buckets = ['public-bucket', 'documents'];
  
  for (const bucket of buckets) {
    try {
      const { data: files, error } = await supabase.storage.from(bucket).list('', { limit: 100 });
      if (error) {
        console.warn(`[WARN] Failed to list bucket ${bucket}:`, error.message);
        continue;
      }

      // Recursively gather all file paths
      const allPaths = [];
      async function walkFolder(folderPath = '') {
        const { data: items } = await supabase.storage.from(bucket).list(folderPath, { limit: 200 });
        if (!items) return;
        for (const item of items) {
          const itemPath = folderPath ? `${folderPath}/${item.name}` : item.name;
          if (item.id === null) {
            // folder
            await walkFolder(itemPath);
          } else {
            allPaths.push(itemPath);
          }
        }
      }

      await walkFolder();
      if (allPaths.length > 0) {
        console.log(`[STORAGE] Removing ${allPaths.length} objects from ${bucket}...`);
        const { error: rmErr } = await supabase.storage.from(bucket).remove(allPaths);
        if (rmErr) console.warn(`[WARN] Error removing objects from ${bucket}:`, rmErr.message);
        else console.log(`[STORAGE] Successfully purged ${allPaths.length} objects from ${bucket}.`);
      } else {
        console.log(`[STORAGE] Bucket ${bucket} has 0 top-level files to remove.`);
      }
    } catch (err) {
      console.warn(`[WARN] Storage shred error on ${bucket}:`, err.message);
    }
  }
}

async function executeSqlPurge() {
  console.log('[2/5] Executing database purge transaction via Supabase CLI Management API...');
  const sqlFile = path.resolve(__dirname, 'factory_reset_purge.sql');
  const cmd = `npx supabase db query --linked --workdir "${rootDir}" --file "${sqlFile}"`;
  
  console.log(`[SQL] Running command: ${cmd}`);
  const output = execSync(cmd, { encoding: 'utf8', cwd: rootDir });
  console.log('[SQL] Purge transaction executed successfully.');
}

async function syncGoTrueAuth() {
  console.log('[3/5] Synchronizing and resetting credentials in GoTrue Auth...');

  // Update Admin user in auth.users
  const { data: adminUpdate, error: adminErr } = await supabase.auth.admin.updateUserById(ADMIN_ID, {
    email: 'admin@c-point.com',
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: {
      first_name: 'System',
      last_name: 'Administrator',
      role: 'admin'
    }
  });
  if (adminErr) {
    console.error('[AUTH ERROR] Failed updating Admin credentials:', adminErr.message);
  } else {
    console.log('[AUTH] Admin credentials reset successfully (email: admin@c-point.com).');
  }

  // Update Guard user in auth.users
  const { data: guardUpdate, error: guardErr } = await supabase.auth.admin.updateUserById(GUARD_ID, {
    email: 'guard@c-point.com',
    password: GUARD_PASSWORD,
    email_confirm: true,
    user_metadata: {
      first_name: 'Terminal',
      last_name: 'Guard',
      role: 'security'
    }
  });
  if (guardErr) {
    console.error('[AUTH ERROR] Failed updating Guard credentials:', guardErr.message);
  } else {
    console.log('[AUTH] Guard credentials reset successfully (email: guard@c-point.com).');
  }
}

async function flushCaches() {
  console.log('[4/5] Flushing in-memory caches...');
  clearAuthUserCache();
  console.log('[CACHE] authUserCache flushed completely.');
}

async function verifyState() {
  console.log('[5/5] Performing post-reset audit and verification...');

  // 1. Verify Authentication for Admin
  const { data: adminAuth, error: adminAuthErr } = await supabase.auth.signInWithPassword({
    email: 'admin@c-point.com',
    password: ADMIN_PASSWORD
  });
  if (adminAuthErr) {
    throw new Error(`Admin authentication test failed: ${adminAuthErr.message}`);
  }
  console.log(`[VERIFY PASS] Admin authenticated cleanly (User ID: ${adminAuth.user.id}).`);

  // 2. Verify Authentication for Guard
  const { data: guardAuth, error: guardAuthErr } = await supabase.auth.signInWithPassword({
    email: 'guard@c-point.com',
    password: GUARD_PASSWORD
  });
  if (guardAuthErr) {
    throw new Error(`Guard authentication test failed: ${guardAuthErr.message}`);
  }
  console.log(`[VERIFY PASS] Guard authenticated cleanly (User ID: ${guardAuth.user.id}).`);

  // 3. Verify Employees count
  const { count: empCount, data: emps, error: empErr } = await supabase
    .from('employees')
    .select('id, company_id, email, role, status, auth_user_id', { count: 'exact' });
  if (empErr) throw empErr;

  console.log(`[VERIFY] Employees count: ${empCount}`);
  for (const emp of emps) {
    console.log(`  - ${emp.company_id} | ${emp.email} | ${emp.role} | auth_user_id: ${emp.auth_user_id}`);
  }

  // 4. Verify operational tables are empty
  const tablesToCheck = [
    'attendances',
    'payrolls',
    'leave_requests',
    'employee_leave_credit_ledger',
    'employee_leave_credit_accounts',
    'sil_cash_out_requests',
    'sil_cash_events',
    'sil_obligations',
    'employee_documents',
    'document_requests',
    'disciplinary_logs',
    'notifications',
    'audit_logs',
    'activity_log',
    'offline_attendance_events',
    'offline_attendance_devices',
    'attendance_reset_archive'
  ];

  const auditReport = [];
  for (const table of tablesToCheck) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    auditReport.push({ table, count: error ? `Error: ${error.message}` : count });
  }

  // 5. Verify preserved reference datasets
  const refTables = ['holidays', 'statutory_settings', 'sil_conversion_settings', 'sil_policy_versions', 'production_groups'];
  for (const table of refTables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    auditReport.push({ table, count: error ? `Error: ${error.message}` : count, preserved: true });
  }

  console.log('\n--- AUDIT VERIFICATION REPORT ---');
  console.table(auditReport);
  console.log('--------------------------------\n');
}

async function main() {
  try {
    console.log('====================================================');
    console.log('STARTING ENTERPRISE SYSTEM FACTORY RESET');
    console.log('====================================================');
    
    await shredStorage();
    await executeSqlPurge();
    await syncGoTrueAuth();
    await flushCaches();
    await verifyState();

    console.log('====================================================');
    console.log('FACTORY RESET COMPLETED SUCCESSFULLY');
    console.log('Admin: admin@c-point.com');
    console.log('Guard: guard@c-point.com');
    console.log('====================================================');
  } catch (err) {
    console.error('[FATAL ERROR IN FACTORY RESET]:', err);
    process.exit(1);
  }
}

main();
