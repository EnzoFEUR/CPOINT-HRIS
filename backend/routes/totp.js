import express from 'express';
import { supabase, createIsolatedAuthClient } from '../supabaseClient.js';
import { closePasswordSession } from '../services/passwordService.js';
import { authenticatorService } from '../services/authenticatorService.js';
import { verifyOtpCode } from '../services/otpService.js';
import { verifyToken, verifyIdentityToken, invalidateAuthUser } from '../middleware/authMiddleware.js';
import { bindOwnLoginChallenge } from '../middleware/loginChallengeMiddleware.js';
import { loginSessionService } from '../services/loginSessionService.js';
import { createAuditLog } from './auditLogs.js';

const router = express.Router();
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const respondError = (res, error) => res.status(error.status || 503).json({ success: false, code: error.code, error: error.status ? error.message : 'Authenticator service is temporarily unavailable. Use email verification.' });

async function sessionUser(req) {
    const authId = req.user?._auth_user_id || req.user?.auth_user_id || req.user?.id;
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

router.get('/status', verifyIdentityToken, async (req, res) => {
    try {
        const user = { id: req.user._auth_user_id, user_metadata: req.user.user_metadata };
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

router.post('/verify', bindOwnLoginChallenge, async (req, res) => {
    try {
        const user = { id: req.user._auth_user_id, email: req.user.email };
        const code = req.body?.code;
        const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose : 'login_2fa';
        const fallback = verifyOtpCode([purpose + '_' + user.email.toLowerCase(), purpose + '_' + user.id], code);
        if (fallback.valid) {
            const verifiedUntil = purpose === 'login_2fa' ? await loginSessionService.markVerified(req, 'EMAIL_OTP') : undefined;
            return res.json({ success: true, verifiedVia: 'EMAIL_OTP_FALLBACK', verifiedUntil });
        }
        const result = await authenticatorService.verify(user.id, code);
        if (!result.valid) {
            if (result.retryAfterSeconds) res.setHeader('Retry-After', String(result.retryAfterSeconds));
            return res.status(result.retryAfterSeconds ? 429 : 400).json({ success: false, error: result.error, retryAfterSeconds: result.retryAfterSeconds || 0 });
        }
        const verifiedUntil = purpose === 'login_2fa' ? await loginSessionService.markVerified(req, String(result.verifiedVia).toUpperCase().includes('BACKUP') ? 'BACKUP_CODE' : 'TOTP') : undefined;
        res.json({ success: true, message: 'Authenticator code verified successfully.', verifiedVia: result.verifiedVia, remainingCodes: result.remainingCodes, verifiedUntil });
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
