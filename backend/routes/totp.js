import express from 'express';
import { supabase } from '../supabaseClient.js';
import {
    generateTotpSecret,
    verifyTotpCode,
    generateBackupCodes,
    verifyAndConsumeBackupCode
} from '../services/totpService.js';
import { verifyToken, invalidateAuthUser } from '../middleware/authMiddleware.js';
import { createAuditLog } from './auditLogs.js';

const router = express.Router();

/**
 * Helper: Find auth user by ID, email, or company_id
 */
async function resolveAuthUser(identifier) {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);

    // 1. Direct UUID lookup in auth.users
    if (isUuid) {
        const { data: authData } = await supabase.auth.admin.getUserById(clean);
        if (authData?.user) return authData.user;
    }

    // 2. Query employee record by id, auth_user_id, email, or company_id
    let empQuery = supabase
        .from('employees')
        .select('id, auth_user_id, email, company_id, role, first_name, last_name');

    if (isUuid) {
        empQuery = empQuery.or(`id.eq.${clean},auth_user_id.eq.${clean}`);
    } else {
        empQuery = empQuery.or(`email.ilike.${clean},company_id.ilike.${clean}`);
    }

    const { data: emp } = await empQuery.maybeSingle();

    if (emp) {
        const targetId = emp.auth_user_id || emp.id;
        const { data: authData } = await supabase.auth.admin.getUserById(targetId);
        if (authData?.user) {
            return {
                ...authData.user,
                _employee: emp
            };
        }
    }

    // 3. Fallback: match by email across all auth users if employee table was bypassed
    try {
        const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const matched = listData?.users?.find(u => u.email && u.email.toLowerCase() === clean);
        if (matched) return matched;
    } catch {}

    return null;
}

/**
 * GET /api/auth/totp/status
 * Returns whether TOTP is configured and active for an identifier or current authenticated session
 */
router.get('/status', async (req, res) => {
    try {
        let user = null;
        const identifier = req.query.identifier || req.query.email || req.headers['x-user-id'];

        // 1. Direct JWT auth token extraction if present
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            if (token) {
                const { data: { user: sessionUser } } = await supabase.auth.getUser(token);
                if (sessionUser) {
                    user = sessionUser;
                }
            }
        }

        // 2. If user not resolved yet or identifier was explicitly requested
        if (!user && identifier) {
            user = await resolveAuthUser(identifier);
        } else if (identifier && user) {
            const clean = identifier.trim().toLowerCase();
            const selfMatch = (user.id && user.id.toLowerCase() === clean) ||
                              (user.email && user.email.toLowerCase() === clean);
            if (!selfMatch) {
                const requestedUser = await resolveAuthUser(identifier);
                if (requestedUser) user = requestedUser;
            }
        }

        if (!user) {
            return res.status(404).json({ success: false, error: 'User account not found.' });
        }

        // Always query admin API with user.id to get the freshest live metadata directly
        const { data: authData } = await supabase.auth.admin.getUserById(user.id);
        const liveUser = authData?.user || user;
        const meta = liveUser.user_metadata || {};
        const isEnabled = Boolean(meta.totp_enabled && meta.totp_secret);

        res.json({
            success: true,
            enabled: isEnabled,
            enabledAt: meta.totp_enabled_at || null,
            backupCodesRemaining: Array.isArray(meta.totp_backup_codes) ? meta.totp_backup_codes.length : 0
        });

    } catch (err) {
        console.error('[TOTP_STATUS_ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to retrieve authenticator status.' });
    }
});

/**
 * POST /api/auth/totp/setup
 * Generates a new TOTP secret & otpauth QR URI for setup (Authenticated only)
 */
router.post('/setup', verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized.' });
        }

        const { data: authData, error: userErr } = await supabase.auth.admin.getUserById(userId);
        if (userErr || !authData?.user) {
            return res.status(404).json({ success: false, error: 'User account not found.' });
        }

        const user = authData.user;
        const email = user.email || req.user?.email || 'admin@cpoint.ph';

        const secretObj = generateTotpSecret(email, 'C-Point HRIS');

        // Store pending secret in user metadata (not active until confirmed)
        await supabase.auth.admin.updateUserById(userId, {
            user_metadata: {
                ...user.user_metadata,
                totp_pending_secret: secretObj.secret,
                totp_pending_created_at: new Date().toISOString()
            }
        });

        res.json({
            success: true,
            secret: secretObj.secret,
            uri: secretObj.uri,
            issuer: secretObj.issuer,
            accountName: secretObj.accountName
        });

    } catch (err) {
        console.error('[TOTP_SETUP_ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to initialize authenticator setup.' });
    }
});

/**
 * POST /api/auth/totp/enable
 * Validates the confirmation code and activates TOTP with emergency backup codes (Authenticated only)
 */
router.post('/enable', verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { code } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized.' });
        }
        if (!code || !/^\d{6}$/.test(code.trim())) {
            return res.status(400).json({ success: false, error: 'A valid 6-digit confirmation code is required.' });
        }

        const { data: authData } = await supabase.auth.admin.getUserById(userId);
        const user = authData?.user;
        if (!user) {
            return res.status(404).json({ success: false, error: 'User account not found.' });
        }

        const pendingSecret = user.user_metadata?.totp_pending_secret;
        if (!pendingSecret) {
            return res.status(400).json({ success: false, error: 'No pending authenticator setup found. Please initiate setup again.' });
        }

        // Verify the code against the pending secret
        const verifyResult = verifyTotpCode(pendingSecret, code.trim());
        if (!verifyResult.valid) {
            return res.status(400).json({ success: false, error: verifyResult.error || 'Invalid confirmation code.' });
        }

        // Generate 8 emergency backup codes
        const { plainCodes, hashedCodes } = generateBackupCodes(8);

        // Commit active TOTP settings and clear pending
        const updatedMeta = {
            ...user.user_metadata,
            totp_secret: pendingSecret,
            totp_enabled: true,
            totp_enabled_at: new Date().toISOString(),
            totp_backup_codes: hashedCodes
        };
        delete updatedMeta.totp_pending_secret;
        delete updatedMeta.totp_pending_created_at;

        await supabase.auth.admin.updateUserById(userId, {
            user_metadata: updatedMeta
        });

        invalidateAuthUser(userId);

        await createAuditLog({
            log_name: 'security',
            description: `Google Authenticator TOTP 2FA enabled for ${user.email}`,
            subject_type: 'Security',
            subject_id: userId,
            event: 'TOTP_2FA_ENABLED',
            causer_id: userId,
            properties: {
                email: user.email,
                ip: req.ip || req.headers['x-forwarded-for']
            }
        });

        res.json({
            success: true,
            message: 'Google Authenticator 2FA enabled successfully.',
            backupCodes: plainCodes
        });

    } catch (err) {
        console.error('[TOTP_ENABLE_ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to activate authenticator.' });
    }
});

/**
 * POST /api/auth/totp/verify
 * Public verification endpoint for login 2FA or step-up authentication (<15ms response)
 */
router.post('/verify', async (req, res) => {
    try {
        const { identifier, email, code, isBackupCode } = req.body;
        const rawTarget = identifier || email;

        if (!rawTarget || !code) {
            return res.status(400).json({ success: false, error: 'Account identifier and authentication code are required.' });
        }

        const user = await resolveAuthUser(rawTarget);
        if (!user) {
            return res.status(404).json({ success: false, error: 'Account not found.' });
        }

        const meta = user.user_metadata || {};
        if (!meta.totp_enabled || !meta.totp_secret) {
            return res.status(400).json({ success: false, error: 'Authenticator 2FA is not enabled for this account.' });
        }

        // PATH 1: Emergency Backup Code Verification
        if (isBackupCode || String(code).trim().startsWith('CP-') || String(code).trim().length > 6) {
            const backupResult = verifyAndConsumeBackupCode(String(code).trim(), meta.totp_backup_codes || []);
            if (!backupResult.valid) {
                return res.status(401).json({ success: false, error: 'Invalid or already consumed backup code.' });
            }

            // Persist remaining backup codes
            await supabase.auth.admin.updateUserById(user.id, {
                user_metadata: {
                    ...meta,
                    totp_backup_codes: backupResult.remainingCodes
                }
            });

            await createAuditLog({
                log_name: 'security',
                description: `Emergency 2FA backup code consumed for ${user.email}. Remaining codes: ${backupResult.remainingCodes.length}`,
                subject_type: 'Security',
                subject_id: user.id,
                event: 'TOTP_BACKUP_CODE_CONSUMED',
                causer_id: user.id,
                properties: {
                    email: user.email,
                    remaining_backup_codes: backupResult.remainingCodes.length,
                    ip: req.ip || req.headers['x-forwarded-for']
                }
            });

            return res.json({
                success: true,
                message: 'Backup code verified successfully.',
                verifiedVia: 'BACKUP_CODE',
                remainingCodes: backupResult.remainingCodes.length
            });
        }

        // PATH 2: Live Time-Based Token Verification
        const verifyResult = verifyTotpCode(meta.totp_secret, code);
        if (!verifyResult.valid) {
            return res.status(401).json({ success: false, error: verifyResult.error || 'Invalid authenticator code.' });
        }

        res.json({
            success: true,
            message: 'Authenticator code verified successfully.',
            verifiedVia: 'TOTP'
        });

    } catch (err) {
        console.error('[TOTP_VERIFY_ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to verify authentication code.' });
    }
});

/**
 * POST /api/auth/totp/disable
 * Disables TOTP for an authenticated user
 */
router.post('/disable', verifyToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { code } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized.' });
        }

        const { data: authData } = await supabase.auth.admin.getUserById(userId);
        const user = authData?.user;
        if (!user) {
            return res.status(404).json({ success: false, error: 'User account not found.' });
        }

        const meta = user.user_metadata || {};
        if (!meta.totp_enabled) {
            return res.json({ success: true, message: 'Authenticator 2FA is already disabled.' });
        }

        // Optional code verification (supports 6-digit TOTP or emergency backup code)
        if (code && String(code).trim()) {
            const cleanCode = String(code).trim();
            if (cleanCode.startsWith('CP-') || cleanCode.length > 6) {
                const backupResult = verifyAndConsumeBackupCode(cleanCode, meta.totp_backup_codes || []);
                if (!backupResult.valid) {
                    return res.status(400).json({ success: false, error: 'Invalid or already consumed backup recovery code.' });
                }
            } else {
                const verifyResult = verifyTotpCode(meta.totp_secret, cleanCode);
                if (!verifyResult.valid) {
                    return res.status(400).json({ success: false, error: 'Invalid authenticator code. If you lost your device, confirm deactivation directly.' });
                }
            }
        }

        // Explicitly set keys to null/false so Supabase jsonb merge removes them
        const updatedMeta = {
            ...meta,
            totp_secret: null,
            totp_enabled: false,
            totp_enabled_at: null,
            totp_backup_codes: null,
            totp_pending_secret: null,
            totp_pending_created_at: null
        };

        await supabase.auth.admin.updateUserById(userId, {
            user_metadata: updatedMeta
        });

        invalidateAuthUser(userId);

        await createAuditLog({
            log_name: 'security',
            description: `Authenticator 2FA disabled for ${user.email}`,
            subject_type: 'Security',
            subject_id: userId,
            event: 'TOTP_2FA_DISABLED',
            causer_id: userId,
            properties: {
                email: user.email,
                ip: req.ip || req.headers['x-forwarded-for']
            }
        });

        res.json({
            success: true,
            message: 'Authenticator 2FA has been disabled.'
        });

    } catch (err) {
        console.error('[TOTP_DISABLE_ERROR]', err);
        res.status(500).json({ success: false, error: 'Failed to disable authenticator.' });
    }
});

export default router;
