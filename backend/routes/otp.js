import express from 'express';
import crypto from 'node:crypto';
import { postgrestLikeValue } from '../middleware/requestValidation.js';
import {
    otpTestMode,
    isProduction,
    verifyOtpCode,
    sendEmailOtp,
    sendSmsOtp,
    OTP_RESEND_COOLDOWN_MS,
    checkOtpCooldown,
    getOrGenerateOtp,
    getActiveOtp,
    acquireOtpLock,
    releaseOtpLock,
    reserveAccountChallengeCreation
} from '../services/otpService.js';
import { authenticatorService } from '../services/authenticatorService.js';
import { disciplinaryService } from '../services/disciplinaryService.js';
import { publishCommittedDisciplinary } from '../services/disciplinaryEvents.js';
import { supabase } from '../supabaseClient.js';
import { bindOwnLoginChallenge } from '../middleware/loginChallengeMiddleware.js';
import { loginSessionService } from '../services/loginSessionService.js';

const router = express.Router();
router.use(bindOwnLoginChallenge);

// GET /api/auth/otp/status - Legacy clients; POST keeps account identifiers out of URLs.
const getOtpStatus = async (req, res) => {
    try {
        const { identifier, email, phone, purpose = 'login_2fa' } = req.method === 'POST' ? req.body : req.query;
        const rawTarget = (identifier || email || phone || '').trim().toLowerCase();
        // Identity middleware already resolved and bound this account.
        const empRecord = req.user;
        const targetEmail = (empRecord.email || rawTarget).toLowerCase().trim();
        let hasTotp = false;
        const authId = empRecord._auth_user_id || empRecord.auth_user_id || empRecord.id;
        if (authId) {
            try { hasTotp = (await authenticatorService.status(authId)).enabled; }
            catch { /* Email remains available if authenticator storage is unavailable. */ }
        }

        const candidateKeys = new Set();
        if (targetEmail) {
            candidateKeys.add(`${purpose}_${targetEmail}`);
            candidateKeys.add(targetEmail);
        }
        if (rawTarget) {
            candidateKeys.add(`${purpose}_${rawTarget}`);
            candidateKeys.add(rawTarget);
        }
        if (empRecord?.id) {
            candidateKeys.add(`${purpose}_${empRecord.id.toLowerCase().trim()}`);
            candidateKeys.add(empRecord.id.toLowerCase().trim());
        }
        if (empRecord?.auth_user_id) {
            candidateKeys.add(`${purpose}_${empRecord.auth_user_id.toLowerCase().trim()}`);
            candidateKeys.add(empRecord.auth_user_id.toLowerCase().trim());
        }

        const candidateList = Array.from(candidateKeys);
        const active = getActiveOtp(candidateList, purpose);

        const cooldownKeys = [
            `${purpose}_${targetEmail}`,
            `${purpose}_${rawTarget}`,
            `dest_email_${purpose}_${targetEmail}`
        ];
        if (empRecord?.id) {
            cooldownKeys.push(`${purpose}_${empRecord.id.toLowerCase().trim()}`);
        }
        if (empRecord?.auth_user_id) {
            cooldownKeys.push(`${purpose}_${empRecord.auth_user_id.toLowerCase().trim()}`);
        }
        const filteredCooldownKeys = cooldownKeys.filter(Boolean);

        const cooldown = filteredCooldownKeys
            .map(key => checkOtpCooldown(key))
            .reduce((longest, current) => current.remainingSeconds > longest.remainingSeconds ? current : longest, { allowed: true, remainingSeconds: 0 });

        res.json({
            success: true,
            hasActiveOtp: Boolean(active),
            challengeId: active?.challengeId || null,
            method: active?.method || null,
            remainingSeconds: active?.remainingSeconds || 0,
            isCooldown: !cooldown.allowed,
            cooldownRemaining: cooldown.remainingSeconds,
            hasTotp
        });
    } catch {
        res.json({
            success: false,
            hasActiveOtp: false,
            challengeId: null,
            method: null,
            remainingSeconds: 0,
            isCooldown: false,
            cooldownRemaining: 0,
            hasTotp: false
        });
    }
};
router.get('/status', getOtpStatus);
router.post('/status', getOtpStatus);

// POST /api/auth/otp/send - Generate and dispatch 6-digit OTP
router.post('/send', async (req, res) => {
    const requestId = crypto.randomUUID();
    res.set('X-Request-ID', requestId);
    console.info('[OTP_SEND_REQUESTED]', { requestId, purpose: req.body?.purpose || 'login_2fa', method: ['email', 'sms'].includes(req.body?.method || 'email') ? req.body?.method || 'email' : 'unknown' });
    if ((req.body?.mock || req.body?.is_mock) && !otpTestMode()) {
        console.warn('[OTP_SEND_BLOCKED]', { requestId, reason: 'test_mode_disabled', providerCalled: false });
        return res.status(403).json({ success: false, code: 'OTP_TEST_MODE_DISABLED', error: 'Mock verification is disabled on this server.' });
    }
    try {
        const { email, phone, user_id, method = 'email', purpose = 'login_2fa', challengeId, challenge_id } = req.body;
        const targetChallengeId = challengeId || challenge_id;
        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

        if (!email && !phone && !user_id) {
            console.warn('[OTP_SEND_BLOCKED]', { requestId, reason: 'missing_identifier', providerCalled: false });
            return res.status(400).json({ success: false, error: 'Missing user identifier (email, phone, or user_id)' });
        }

        let targetEmail = (email || '').trim().toLowerCase();
        let targetPhone = (phone || '').trim();
        let targetName = 'Employee';
        let empRecord = null;

        if (user_id || email) {
            let query = supabase.from('employees').select('id, auth_user_id, first_name, last_name, email, phone, role, status, is_active');
            if (user_id) {
                const uid = String(user_id).trim().toLowerCase();
                query = query.or(`id.eq.${uid},auth_user_id.eq.${uid}`);
            } else {
                query = query.or(`email.ilike.${postgrestLikeValue(email.trim().toLowerCase())}`);
            }

            const { data: emp, error: employeeError } = await query.maybeSingle();
            if (employeeError) throw Object.assign(new Error('Account verification is temporarily unavailable. Please retry shortly.'), { status: 503, code: 'OTP_ACCOUNT_UNAVAILABLE' });

            if (emp) {
                empRecord = emp;
                targetName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
                targetEmail = (emp.email || targetEmail).toLowerCase().trim();
                targetPhone = emp.phone || targetPhone;

                // Auto-reinstatement check for expired suspensions
                if (emp.role !== 'admin') {
                    const { data: activeDisciplinary } = await supabase
                        .from('disciplinary_logs')
                        .select('*')
                        .eq('employee_id', emp.id)
                        .eq('type', 'Suspension')
                        .eq('status', 'Active')
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (activeDisciplinary && activeDisciplinary.length > 0) {
                        const disc = activeDisciplinary[0];
                        const match = (disc.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
                        const endDateStr = match ? match[1] : null;
                        const todayStr = new Date().toISOString().split('T')[0];

                        if (endDateStr && todayStr > endDateStr) {
                            const committed = await disciplinaryService.expire(emp.id, disc.id);
                            publishCommittedDisciplinary(committed);
                        }
                    }
                }
            }
        }

        const baseIdentifier = (method === 'sms' ? targetPhone : targetEmail) || email || user_id;

        // This authenticated route must not claim delivery for an unresolved employee.
        if (!empRecord) {
            console.warn('[OTP_SEND_BLOCKED]', { requestId, reason: 'account_unavailable', providerCalled: false });
            return res.status(403).json({ success: false, code: 'ACCOUNT_UNAVAILABLE', error: 'Your employee account could not be verified. Sign in again or contact HR.' });
        }

        // Build comprehensive candidate alias keys scoped strictly to current purpose
        const aliasKeys = new Set();
        if (targetEmail) {
            aliasKeys.add(`${purpose}_${targetEmail}`);
            aliasKeys.add(targetEmail);
        }
        if (email) {
            const e = email.trim().toLowerCase();
            aliasKeys.add(`${purpose}_${e}`);
            aliasKeys.add(e);
        }
        if (user_id) {
            const uid = String(user_id).trim().toLowerCase();
            aliasKeys.add(`${purpose}_${uid}`);
            aliasKeys.add(uid);
        }
        if (empRecord?.id) {
            const eid = empRecord.id.toLowerCase().trim();
            aliasKeys.add(`${purpose}_${eid}`);
            aliasKeys.add(eid);
        }
        if (empRecord?.auth_user_id) {
            const auid = empRecord.auth_user_id.toLowerCase().trim();
            aliasKeys.add(`${purpose}_${auid}`);
            aliasKeys.add(auid);
        }
        // A contact phone can be shared by employees; it is not an account identity.

        const aliasList = Array.from(aliasKeys);

        // Atomic lock keys to prevent double-click / concurrent race conditions, scoped strictly by purpose
        const lockKeys = [
            `${purpose}_${baseIdentifier.toLowerCase().trim()}`,
            `dest_email_${purpose}_${targetEmail}`
        ].filter(Boolean);
        if (method === 'sms' && targetPhone) {
            lockKeys.push(`dest_phone_${purpose}_${targetPhone}`);
        }

        // Enterprise Atomic Lock & Cooldown Check
        const lock = acquireOtpLock(lockKeys);
        if (!lock.acquired) {
            console.warn('[OTP_SEND_BLOCKED]', { requestId, purpose, reason: lock.reason, retryAfterSeconds: lock.remainingSeconds, providerCalled: false });
            const errorMsg = lock.reason === 'in_flight'
                ? 'A verification code is already being dispatched to your account. Please wait a moment.'
                : `Please wait ${lock.remainingSeconds}s before requesting a new verification code.`;
            return res.set('Retry-After', String(lock.remainingSeconds)).status(429).json({
                success: false,
                error: errorMsg,
                retry_after: lock.remainingSeconds
            });
        }

        let sendSucceeded = false;
        let creationReservation;
        try {
            // Strict Single-Token Rotation with send-failure ordering:
            // Do NOT commit the new code into storage until Brevo call succeeds.
            const otpInfo = getOrGenerateOtp(aliasList, {
                challengeId: targetChallengeId,
                purpose,
                method,
                accountExists: true
            });
            if (!otpInfo.isRotated) creationReservation = reserveAccountChallengeCreation(baseIdentifier, clientIp);
            const code = otpInfo.code;

            let dispatchResult;
            const isMock = Boolean(req.body.mock || req.body.is_mock);
            if (isMock) {
                dispatchResult = { simulated: true, provider: 'mock', success: true };
            } else if (method === 'sms') {
                dispatchResult = await sendSmsOtp(targetPhone, code);
            } else {
                dispatchResult = await sendEmailOtp(targetEmail, code, targetName, { requestId, purpose });
            }

            // Brevo call succeeded! Now commit code rotation / creation
            if (typeof otpInfo.commit === 'function') {
                otpInfo.commit();
            }
            sendSucceeded = true;

            const isSimulated = Boolean(dispatchResult?.simulated);
            const previewCode = (!isProduction() && otpTestMode() && (isMock || isSimulated)) ? code : undefined;
            const delivery = { status: isSimulated ? 'simulated' : 'accepted_by_provider', provider: dispatchResult?.provider || 'mock', messageId: dispatchResult?.messageId || null };
            console.info('[OTP_CHALLENGE_READY]', { requestId, purpose, ...delivery, expiresIn: otpInfo.remainingSeconds });

            return res.json({
                success: true,
                delivery,
                message: isMock
                    ? 'Mock verification code generated (Brevo email skipped)'
                    : `Verification code sent via ${method === 'sms' ? 'SMS' : 'Email'}`,
                challengeId: otpInfo.challengeId,
                method,
                purpose,
                cooldown: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
                isMock: !isProduction() && isMock,
                simulated: !isProduction() && isSimulated,
                previewCode,
                reusedExisting: otpInfo.isExisting,
                expiresIn: otpInfo.remainingSeconds
            });
        } catch (dispatchErr) {
            // Send failed or timed out: previous code remains completely valid!
            throw dispatchErr;
        } finally {
            // In-flight lock must ALWAYS be released in a finally block (Requirement 6)
            if (!sendSucceeded) creationReservation?.release();
            releaseOtpLock(lockKeys, sendSucceeded);
        }

    } catch (err) {
        console.error('[OTP_SEND_ERROR]', { requestId, code: err.code || 'OTP_SEND_FAILED' });
        if (err.retryAfter || err.status === 503) res.set('Retry-After', String(err.retryAfter || 5));
        res.status(err.status || 500).json({ success: false, code: err.code, retry_after: err.retryAfter, error: err.message });
    }
});

// POST /api/auth/otp/verify - Validate 6-digit OTP code
router.post('/verify', async (req, res) => {
    try {
        const { identifier, email, phone, user_id, otp, purpose = 'login_2fa', challengeId, challenge_id } = req.body;
        const rawTarget = (identifier || email || phone || user_id || '').trim().toLowerCase();
        const targetChallengeId = challengeId || challenge_id;
        const cleanOtp = String(otp || '').trim();

        if (!rawTarget || !cleanOtp) {
            return res.status(400).json({ success: false, error: 'Missing identifier or OTP code' });
        }

        // 1. Build initial candidate keys strictly scoped to current purpose
        const candidateKeys = new Set();
        candidateKeys.add(`${purpose}_${rawTarget}`);
        candidateKeys.add(rawTarget);
        if (email) {
            const cleanEmail = email.trim().toLowerCase();
            candidateKeys.add(`${purpose}_${cleanEmail}`);
            candidateKeys.add(cleanEmail);
        }
        if (user_id) {
            const cleanUid = String(user_id).trim().toLowerCase();
            candidateKeys.add(`${purpose}_${cleanUid}`);
            candidateKeys.add(cleanUid);
        }

        let candidateList = Array.from(candidateKeys);

        // 2. High-speed verify across candidate keys or challenge ID
        let result = verifyOtpCode(candidateList, cleanOtp, {
            challengeId: targetChallengeId,
            purpose,
            identifier: rawTarget
        });

        let targetAuthUserId = null;

        // 3. If memory lookup missed, resolve employee record from database to gather full aliases
        if (!result.valid && result.notFound) {
            try {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTarget);
                let empQuery = supabase.from('employees').select('id, auth_user_id, email, company_id');
                if (isUuid) {
                    empQuery = empQuery.or(`id.eq.${rawTarget},auth_user_id.eq.${rawTarget}`);
                } else {
                    empQuery = empQuery.or(`email.ilike.${postgrestLikeValue(rawTarget)},company_id.ilike.${postgrestLikeValue(rawTarget)}`);
                }

                const { data: emp } = await empQuery.maybeSingle();
                if (emp) {
                    targetAuthUserId = emp.auth_user_id || emp.id;
                    if (emp.email) {
                        const em = emp.email.toLowerCase().trim();
                        candidateKeys.add(`${purpose}_${em}`);
                        candidateKeys.add(em);
                    }
                    if (emp.id) {
                        const eid = emp.id.toLowerCase().trim();
                        candidateKeys.add(`${purpose}_${eid}`);
                        candidateKeys.add(eid);
                    }
                    if (emp.auth_user_id) {
                        const auid = emp.auth_user_id.toLowerCase().trim();
                        candidateKeys.add(`${purpose}_${auid}`);
                        candidateKeys.add(auid);
                    }

                    candidateList = Array.from(candidateKeys);
                    result = verifyOtpCode(candidateList, cleanOtp, {
                        challengeId: targetChallengeId,
                        purpose,
                        identifier: rawTarget
                    });
                }
            } catch (dbErr) {
                console.error('[OTP_VERIFY_DB_LOOKUP_ERR]', dbErr.message);
            }
        }

        // 4. TOTP / Google Authenticator / Backup code fallback
        if (!result.valid && targetAuthUserId) {
            try {
                const proof = await authenticatorService.verify(targetAuthUserId, cleanOtp);
                if (proof.valid) result = { valid: true, via: proof.verifiedVia };
                else if (proof.retryAfterSeconds) {
                    return res.set('Retry-After', String(proof.retryAfterSeconds)).status(429).json({ success: false, error: proof.error });
                }
            } catch {
                // Ignore fallback error
            }
        }

        if (!result.valid) {
            const status = result.rateLimited ? 429 : 400;
            return res.status(status).json({ success: false, error: result.error || 'Invalid or expired verification code' });
        }

        let verifiedUntil;
        if (purpose === 'login_2fa') {
            const via = String(result.via || '').toUpperCase();
            const method = via.includes('BACKUP') ? 'BACKUP_CODE' : via.includes('TOTP') || via.includes('AUTHENTICATOR') ? 'TOTP' : 'EMAIL_OTP';
            verifiedUntil = await loginSessionService.markVerified(req, method);
        }

        res.json({
            success: true,
            purpose,
            verifiedVia: result.via || 'OTP',
            verifiedUntil,
            message: 'Code verified successfully'
        });

    } catch (err) {
        console.error('[OTP_VERIFY_ERROR]', err.message);
        res.status(err.status || 500).json({ success: false, code: err.code, error: err.status ? err.message : 'Verification could not be completed. Please retry.' });
    }
});

export default router;
