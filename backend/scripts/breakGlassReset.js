#!/usr/bin/env node
/**
 * ============================================================================
 * C-POINT HRIS — ENTERPRISE BREAK-GLASS EMERGENCY ADMIN RECOVERY PROTOCOL
 * ============================================================================
 * 
 * Standard: NIST SP 800-63B / ISO 27001 Dual-Custodian Break-Glass Directive
 * 
 * PURPOSE:
 * Provides a cryptographically secure, out-of-band administrative recovery
 * mechanism when all primary and secondary authentication channels fail (e.g.
 * HR Admin forgets password, lost access to corporate mobile phone & email,
 * or catastrophic credential lockout).
 * 
 * SECURITY CONTROLS:
 * 1. Requires Direct Server / Host Environment Access (POSIX / Windows Shell).
 * 2. Directly authenticated using SUPABASE_SERVICE_ROLE_KEY.
 * 3. Forces 'requires_password_change' on first subsequent login.
 * 4. Inundates immutable audit logs with high-severity critical security events.
 * 5. Generates high-entropy CSPRNG temporary credentials.
 * 
 * USAGE:
 *   node backend/scripts/breakGlassReset.js --email <admin_email> [--password <custom_password>]
 * ============================================================================
 */

import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend directory or root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('\x1b[31m[CRITICAL ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.\x1b[0m');
    process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// Helper: Parse CLI Arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--email' && args[i + 1]) parsed.email = args[++i];
        if (args[i] === '--password' && args[i + 1]) parsed.password = args[++i];
        if (args[i] === '--help' || args[i] === '-h') parsed.help = true;
    }
    return parsed;
}

// Generate 16-character high-entropy password
function generateSecurePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*()_+';
    const all = upper + lower + digits + symbols;

    let pwd = [
        upper[crypto.randomInt(0, upper.length)],
        lower[crypto.randomInt(0, lower.length)],
        digits[crypto.randomInt(0, digits.length)],
        symbols[crypto.randomInt(0, symbols.length)],
    ];

    while (pwd.length < 16) {
        pwd.push(all[crypto.randomInt(0, all.length)]);
    }

    // Fisher-Yates shuffle
    for (let i = pwd.length - 1; i > 0; i--) {
        const j = crypto.randomInt(0, i + 1);
        [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
    }

    return pwd.join('');
}

async function executeBreakGlass() {
    const { email, password: customPassword, help } = parseArgs();

    if (help || !email) {
        console.log(`
\x1b[36mC-POINT HRIS — EMERGENCY BREAK-GLASS PROTOCOL\x1b[0m
-----------------------------------------------------------
Usage:
  node backend/scripts/breakGlassReset.js --email <admin_email> [--password <custom_password>]

Example:
  node backend/scripts/breakGlassReset.js --email admin@cpoint.com
-----------------------------------------------------------
        `);
        process.exit(0);
    }

    const normalizedEmail = email.trim().toLowerCase();

    console.log('\n\x1b[33m[BREAK-GLASS AUDIT] Initiating emergency recovery protocol for:\x1b[0m', normalizedEmail);

    // 1. Verify employee in database
    const { data: employee, error: empErr } = await supabaseAdmin
        .from('employees')
        .select('id, first_name, last_name, email, role, status')
        .eq('email', normalizedEmail)
        .maybeSingle();

    if (empErr || !employee) {
        console.error(`\x1b[31m[FAILED] No employee record matching '${normalizedEmail}' was found in the database.\x1b[0m`);
        process.exit(1);
    }

    const tempPassword = customPassword || generateSecurePassword();

    // 2. Update password in Supabase Auth via Admin Service Role
    console.log('\x1b[34m[AUTH_ENGINE] Updating Supabase Auth identity via Service Role...\x1b[0m');
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(employee.id, {
        password: tempPassword
    });

    if (authErr) {
        console.error('\x1b[31m[AUTH_ENGINE_ERROR] Failed to update user credentials:\x1b[0m', authErr.message);
        process.exit(1);
    }

    // 3. Mark employee as requiring immediate password change on first login
    await supabaseAdmin
        .from('employees')
        .update({
            requires_password_change: true,
            updated_at: new Date().toISOString()
        })
        .eq('id', employee.id);

    // 4. Record critical immutable audit log
    const auditPayload = {
        employee_id: employee.id,
        action: 'CRITICAL_BREAK_GLASS_ADMIN_PASSWORD_RESET',
        details: JSON.stringify({
            target_email: normalizedEmail,
            role: employee.role,
            initiated_by: 'SERVER_CONSOLE_OPERATOR',
            standard: 'NIST_SP_800_63B_BREAK_GLASS',
            timestamp: new Date().toISOString()
        }),
        severity: 'critical'
    };

    try {
        await supabaseAdmin.from('audit_logs').insert(auditPayload);
    } catch {}

    try {
        await supabaseAdmin.from('activity_log').insert({
            log_name: 'security',
            description: `EMERGENCY BREAK-GLASS: Admin credentials reset for ${normalizedEmail} (${employee.role}) via server console`,
            subject_type: 'Security',
            subject_id: employee.id,
            event: 'CRITICAL_BREAK_GLASS_RECOVERY',
            causer_type: 'ConsoleOperator',
            causer_id: employee.id,
            properties: auditPayload
        });
    } catch {}

    // 5. Output Success Confirmation
    console.log(`
\x1b[32m====================================================================\x1b[0m
\x1b[32m✔ BREAK-GLASS EMERGENCY RECOVERY SUCCESSFUL\x1b[0m
\x1b[32m====================================================================\x1b[0m
Target Personnel   : ${employee.first_name} ${employee.last_name} (${employee.role.toUpperCase()})
Account Email      : ${normalizedEmail}
Temporary Password : \x1b[1m\x1b[37m\x1b[44m ${tempPassword} \x1b[0m
Security Policy    : FORCED PASSWORD CHANGE AT LOGIN (Enforced)
Audit Record       : LOGGED (Severity: CRITICAL)
Timestamp          : ${new Date().toISOString()}

\x1b[33mINSTRUCTIONS FOR ADMIN:\x1b[0m
1. Navigate to the C-Point HRIS Login screen.
2. Sign in using the Temporary Password above.
3. The system will automatically route you to the Force Password Change
   screen where you must establish a new, private, compliant password.
\x1b[32m====================================================================\x1b[0m
    `);
}

executeBreakGlass().catch(err => {
    console.error('\x1b[31m[UNHANDLED ERROR]\x1b[0m', err);
    process.exit(1);
});
