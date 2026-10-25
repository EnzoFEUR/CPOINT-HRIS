import express from 'express';
import { postgrestLikeValue } from '../middleware/requestValidation.js';
import { supabase, createIsolatedAuthClient } from '../supabaseClient.js';
import { closePasswordSession } from '../services/passwordService.js';
import { authenticatorService } from '../services/authenticatorService.js';
import { verifyOtpCode } from '../services/otpService.js';
import { verifyToken, invalidateAuthUser } from '../middleware/authMiddleware.js';
import { createAuditLog } from './auditLogs.js';

const router = express.Router();
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const respondError = (res, error) => res.status(error.status || 503).json({ success: false, code: error.code, error: error.status ? error.message : 'Authenticator service is temporarily unavailable. Use email verification.' });

async function resolveAuthUser(identifier) {
    if (typeof identifier !== 'string' || !identifier.trim()) return null;
    const clean = identifier.trim().toLowerCase();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
    const query = supabase.from('employees').select('id,auth_user_id,email,company_id');
    const { data: employee, error } = await (uuid ? query.or('id.eq.' + clean + ',auth_user_id.eq.' + clean)
        : query.or('email.ilike.' + postgrestLikeValue(clean) + ',company_id.ilike.' + postgrestLikeValue(clean))).maybeSingle();
    if (error) throw error;
    if (!employee) return null;
    const { data, error: authError } = await supabase.auth.admin.getUserById(employee.auth_user_id || employee.id);
    if (authError) throw authError;
    return data?.user || null;
}

async function sessionUser(req) {
    const authId = req.user?.auth_user_id || req.user?.id;
    const { data, error } = await supabase.auth.admin.getUserById(authId);
    if (error || !data?.user) throw failure('Account could not be verified.', 401);
    return data.user;
}

async function confirmPassword(user, password) {
    if (typeof password !== 'string' || !password) throw failure('Confirm your current password to manage the authenticator.');
    const client = createIsolatedAuthClient();
    try {
        const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
        if (error || data?.user?.id !== user.id) throw failure('Incorrect account password.', 401);
    } finally { await closePasswordSession(client); }
}

async function confirmManagementCode(user, code) {
    if (typeof code !== 'string' || !code.trim()) throw failure('Enter an authenticator, backup, or emailed verification code.');
    const emailProof = verifyOtpCode(['authenticator_manage_' + user.email.toLowerCase(), 'authenticator_manage_' + user.id], code);
    if (emailProof.valid) return;
    const proof = await authenticatorService.verify(user.id, code);
    if (!proof.valid) throw failure(proof.error || 'Invalid verification code.', proof.retryAfterSeconds ? 429 : 400);
}

function audit(req, userId, event) {
    invalidateAuthUser(req.user?.id || userId);
    createAuditLog({ log_name: 'security', description: 'Authenticator configuration ' + event + '.',
        subject_type: 'Security', subject_id: userId, event: 'TOTP_2FA_' + event.toUpperCase(),
        causer_id: req.user?.id || userId, properties: { ip: req.ip } })
        .catch(() => console.error('[AUTHENTICATOR_AUDIT] Audit delivery failed.'));
}

router.get('/status', async (req, res) => {
    try {
        let user;
        const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
        if (token) {
            const { data, error } = await supabase.auth.getUser(token);
            if (error) throw failure('Account could not be verified.', 401);
            user = data?.user;
        }
        const identifier = req.query.identifier || req.query.email;
        if (!user && identifier) user = await resolveAuthUser(identifier);
        if (!user) throw failure('Account could not be verified.', 401);
        const status = await authenticatorService.status(user.id);
        res.json({ success: true, ...status, requiresReenrollment: !status.enabled && Boolean(user.user_metadata?.totp_enabled) });
    } catch (error) { respondError(res, error); }
});

router.post('/setup', verifyToken, async (req, res) => {
    try {
        const user = await sessionUser(req);
        await confirmPassword(user, req.body?.password);
        const factor = await authenticatorService.read(user.id);
        if (factor.enabled) await confirmManagementCode(user, req.body?.code);
        const setup = await authenticatorService.begin(user.id, user.email, factor.version);
        res.json({ success: true, ...setup });
    } catch (error) { respondError(res, error); }
});

router.post('/enable', verifyToken, async (req, res) => {
    try {
        const user = await sessionUser(req);
        const enabled = await authenticatorService.enable(user.id, req.body?.code);
        audit(req, user.id, 'enabled');
        res.json({ success: true, message: 'Authenticator enabled successfully.', ...enabled });
    } catch (error) { respondError(res, error); }
});

router.post('/verify', async (req, res) => {
    try {
        const user = await resolveAuthUser(req.body?.identifier || req.body?.email);
        if (!user) throw failure('Account or verification code could not be verified.');
        const code = req.body?.code;
        const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose : 'login_2fa';
        const fallback = verifyOtpCode([purpose + '_' + user.email.toLowerCase(), purpose + '_' + user.id], code);
        if (fallback.valid) return res.json({ success: true, verifiedVia: 'EMAIL_OTP_FALLBACK' });
        const result = await authenticatorService.verify(user.id, code);
        if (!result.valid) {
            if (result.retryAfterSeconds) res.setHeader('Retry-After', String(result.retryAfterSeconds));
            return res.status(result.retryAfterSeconds ? 429 : 400).json({ success: false, error: result.error, retryAfterSeconds: result.retryAfterSeconds || 0 });
        }
        res.json({ success: true, message: 'Authenticator code verified successfully.', verifiedVia: result.verifiedVia, remainingCodes: result.remainingCodes });
    } catch (error) { respondError(res, error); }
});

router.post('/disable', verifyToken, async (req, res) => {
    try {
        const user = await sessionUser(req);
        const factor = await authenticatorService.read(user.id);
        if (!factor.enabled) return res.json({ success: true, message: 'Authenticator is already disabled.' });
        await confirmPassword(user, req.body?.password);
        await confirmManagementCode(user, req.body?.code);
        await authenticatorService.disable(user.id, factor.version);
        audit(req, user.id, 'disabled');
        res.json({ success: true, message: 'Authenticator disabled successfully.' });
    } catch (error) { respondError(res, error); }
});

export default router;
