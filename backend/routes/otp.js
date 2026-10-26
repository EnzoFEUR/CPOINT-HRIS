import express from 'express';
import { postgrestLikeValue } from '../middleware/requestValidation.js';
import { otpTestMode } from '../services/otpService.js';
import { generateOtpCode, storeOtp, verifyOtpCode, deleteOtp, sendEmailOtp, sendSmsOtp, checkOtpCooldown, recordOtpDispatch, getOrGenerateOtp, getActiveOtp, acquireOtpLock, releaseOtpLock } from '../services/otpService.js';
import { authenticatorService } from '../services/authenticatorService.js';
import { disciplinaryService } from '../services/disciplinaryService.js';
import { publishCommittedDisciplinary } from '../services/disciplinaryEvents.js';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// GET /api/auth/otp/status - Legacy clients; POST keeps account identifiers out of URLs.
const getOtpStatus = async (req, res) => {
    try {
        const { identifier, email, phone, purpose = 'login_2fa' } = req.method === 'POST' ? req.body : req.query;
        const rawTarget = (identifier || email || phone || '').trim().toLowerCase();
        let targetEmail = rawTarget;
        let empRecord = null;
        let hasTotp = false;

        if (rawTarget) {
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawTarget);
            let authUser = null;

            if (isUuid) {
                const { data: authData, error: authError } = await supabase.auth.admin.getUserById(rawTarget);
                if (authError && authError.status !== 404) throw authError;
                if (authData?.user) {
                    authUser = authData.user;
                    targetEmail = (authUser.email || targetEmail).toLowerCase().trim();
                }
            }

            let empQuery = supabase
                .from('employees')
                .select('id, auth_user_id, email, company_id');

            if (isUuid) {
                empQuery = empQuery.or(`id.eq.${rawTarget},auth_user_id.eq.${rawTarget}`);
            } else {
                empQuery = empQuery.or(`email.ilike.${postgrestLikeValue(rawTarget)},company_id.ilike.${postgrestLikeValue(rawTarget)}`);
            }

            const { data: emp, error: employeeError } = await empQuery.maybeSingle();
            if (employeeError) throw employeeError;
            if (emp) {
                empRecord = emp;
                targetEmail = (emp.email || targetEmail).toLowerCase().trim();
                const targetId = emp.auth_user_id || emp.id;
                if (!authUser && targetId) {
                    const { data: authData, error: authError } = await supabase.auth.admin.getUserById(targetId);
                    if (authError && authError.status !== 404) throw authError;
                    if (authData?.user) authUser = authData.user;
                }
            }

            if (authUser) {
                try { hasTotp = (await authenticatorService.status(authUser.id)).enabled; }
                catch { hasTotp = false; }
            }
        }

        const candidateKeys = new Set();
        if (targetEmail) {
            candidateKeys.add(`${purpose}_${targetEmail}`);
        }
        if (rawTarget) {
            candidateKeys.add(`${purpose}_${rawTarget}`);
        }
        if (empRecord?.id) {
            candidateKeys.add(`${purpose}_${empRecord.id.toLowerCase().trim()}`);
        }
        if (empRecord?.auth_user_id) {
            candidateKeys.add(`${purpose}_${empRecord.auth_user_id.toLowerCase().trim()}`);
        }

        const candidateList = Array.from(candidateKeys);
        const active = getActiveOtp(candidateList);

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
    if ((req.body?.mock || req.body?.is_mock) && !otpTestMode()) {
        return res.status(403).json({ success: false, code: 'OTP_TEST_MODE_DISABLED', error: 'Mock verification is disabled on this server.' });
    }
    try {
        const { email, phone, user_id, method = 'email', purpose = 'login_2fa' } = req.body;
        
        if (!email && !phone && !user_id) {
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

            const { data: emp } = await query.maybeSingle();

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
        if (!baseIdentifier) {
            return res.status(400).json({ 
                success: false, 
                error: `No registered ${method === 'sms' ? 'phone number' : 'email'} found for this account.` 
            });
        }

        // Build comprehensive candidate alias keys scoped strictly to current purpose
        const aliasKeys = new Set();
        if (targetEmail) {
            aliasKeys.add(`${purpose}_${targetEmail}`);
        }
        if (email) {
            const e = email.trim().toLowerCase();
            aliasKeys.add(`${purpose}_${e}`);
        }
        if (user_id) {
            const uid = String(user_id).trim().toLowerCase();
            aliasKeys.add(`${purpose}_${uid}`);
        }
        if (empRecord?.id) {
            const eid = empRecord.id.toLowerCase().trim();
            aliasKeys.add(`${purpose}_${eid}`);
        }
        if (empRecord?.auth_user_id) {
            const auid = empRecord.auth_user_id.toLowerCase().trim();
            aliasKeys.add(`${purpose}_${auid}`);
        }
        if (targetPhone) {
            aliasKeys.add(`${purpose}_${targetPhone}`);
        }

        const aliasList = Array.from(aliasKeys);

        // Atomic lock keys to prevent double-click / concurrent race conditions, scoped strictly by purpose
        const lockKeys = [
            `${purpose}_${baseIdentifier.toLowerCase().trim()}`,
            `dest_email_${purpose}_${targetEmail}`
        ].filter(Boolean);
        if (targetPhone) {
            lockKeys.push(`dest_phone_${purpose}_${targetPhone}`);
        }

        // Enterprise Atomic Lock & Cooldown Check
        const lock = acquireOtpLock(lockKeys);
        if (!lock.acquired) {
            const errorMsg = lock.reason === 'in_flight'
                ? 'A verification code is already being dispatched to your account. Please wait a moment.'
                : `Please wait ${lock.remainingSeconds}s before requesting a new verification code.`;
            return res.set('Retry-After', String(lock.remainingSeconds)).status(429).json({
                success: false,
                error: errorMsg,
                retry_after: lock.remainingSeconds
            });
        }

        try {
            // Enterprise Standard: Reuse active code across all aliases if still valid (< 5 mins)
            const otpInfo = getOrGenerateOtp(aliasList);
            const code = otpInfo.code;
            storeOtp(aliasList, code, method);

            let dispatchResult;
            const isMock = Boolean(req.body.mock || req.body.is_mock);
            if (isMock) {
                dispatchResult = { simulated: true, provider: 'mock', success: true };
            } else if (method === 'sms') {
                dispatchResult = await sendSmsOtp(targetPhone, code);
            } else {
                dispatchResult = await sendEmailOtp(targetEmail, code, targetName);
            }

            // Release in-flight lock and stamp successful cooldown
            releaseOtpLock(lockKeys, true);

            const isSimulated = Boolean(dispatchResult?.simulated);
            const previewCode = otpTestMode() && (isMock || isSimulated) ? code : undefined;

            return res.json({
                success: true,
                message: isMock
                    ? 'Mock verification code generated (Brevo email skipped)'
                    : `Verification code sent via ${method === 'sms' ? 'SMS' : 'Email'}`,
                method,
                purpose,
                cooldown: checkOtpCooldown(`${purpose}_${baseIdentifier.toLowerCase().trim()}`).remainingSeconds,
                isMock,
                simulated: isSimulated,
                previewCode,
                reusedExisting: otpInfo.isExisting,
                expiresIn: otpInfo.remainingSeconds
            });
        } catch (dispatchErr) {
            releaseOtpLock(lockKeys, false);
            throw dispatchErr;
        }

    } catch (err) {
        console.error('[OTP_SEND_ERROR]', err.message);
        res.status(err.status || 500).json({ success: false, code: err.code, error: err.message });
    }
});

// POST /api/auth/otp/verify - Validate 6-digit OTP code
router.post('/verify', async (req, res) => {
    try {
        const { identifier, email, phone, user_id, otp, purpose = 'login_2fa' } = req.body;
        const rawTarget = (identifier || email || phone || user_id || '').trim().toLowerCase();

        if (!rawTarget || !otp) {
            return res.status(400).json({ success: false, error: 'Missing identifier or OTP code' });
        }

        // 1. Build initial candidate keys strictly scoped to current purpose
        const candidateKeys = new Set();
        candidateKeys.add(`${purpose}_${rawTarget}`);
        if (email) {
            const cleanEmail = email.trim().toLowerCase();
            candidateKeys.add(`${purpose}_${cleanEmail}`);
        }
        if (user_id) {
            const cleanUid = String(user_id).trim().toLowerCase();
            candidateKeys.add(`${purpose}_${cleanUid}`);
        }

        // 2. High-speed in-memory lookup across all candidate keys
        let candidateList = Array.from(candidateKeys);
        const hadActiveOtp = Boolean(getActiveOtp(candidateList));
        let result = verifyOtpCode(candidateList, otp);

        let targetAuthUserId = null;

        // 3. If memory lookup missed, resolve employee record from database to gather full aliases
        if (!result.valid) {
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
                    }
                    if (emp.id) {
                        const eid = emp.id.toLowerCase().trim();
                        candidateKeys.add(`${purpose}_${eid}`);
                    }
                    if (emp.auth_user_id) {
                        const auid = emp.auth_user_id.toLowerCase().trim();
                        candidateKeys.add(`${purpose}_${auid}`);
                    }

                    candidateList = Array.from(candidateKeys);
                    if (!hadActiveOtp) result = verifyOtpCode(candidateList, otp);
                }
            } catch (dbErr) {
                console.error('[OTP_VERIFY_DB_LOOKUP_ERR]', dbErr.message);
            }
        }

        // 5. TOTP / Google Authenticator / Backup code fallback
        if (!result.valid && targetAuthUserId) {
            try {
                const proof = await authenticatorService.verify(targetAuthUserId, otp);
                if (proof.valid) result = { valid: true, via: proof.verifiedVia };
                else if (proof.retryAfterSeconds) return res.set('Retry-After', String(proof.retryAfterSeconds)).status(429).json({ success: false, error: proof.error });
            } catch {
                // A failed private-store lookup must never recover proof from Auth metadata.
            }
        }

        if (!result.valid) {
            return res.status(400).json({ success: false, error: result.error || 'Invalid or expired verification code' });
        }

        // Email challenges are server-only; client-readable Auth metadata is not a trusted OTP store.
        deleteOtp(candidateList);

        res.json({
            success: true,
            purpose,
            verifiedVia: result.via || 'OTP',
            message: 'Code verified successfully'
        });

    } catch (err) {
        console.error('[OTP_VERIFY_ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
