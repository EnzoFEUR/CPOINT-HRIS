import express from 'express';
import { postgrestLikeValue } from '../middleware/requestValidation.js';
import { otpTestMode } from '../services/otpService.js';
import crypto from 'crypto';
import { supabase } from '../supabaseClient.js';
import { verifyOtpCode, sendEmailOtp, sendSmsOtp, getOrGenerateOtp, acquireOtpLock, releaseOtpLock, expireOtpForTesting, createChallenge, reserveAccountChallengeCreation, isProduction } from '../services/otpService.js';
import { authenticatorService } from '../services/authenticatorService.js';
import { createAuditLog } from './auditLogs.js';
import { invalidateAuthUser, verifyToken, verifyIdentityToken } from '../middleware/authMiddleware.js';
import { resetVerifiedPassword } from '../services/passwordService.js';
import { isPasswordReuseError, PASSWORD_REUSE_MESSAGE } from '../../shared/passwordPolicy.mjs';
import { createEmploymentStatusHandler } from '../services/employmentStatus.js';

const router = express.Router();
router.post('/refresh-employment-status', verifyToken, createEmploymentStatusHandler());
router.get('/login-context', verifyIdentityToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { id, email, requires_password_change } = req.user;
    return res.json({ success: true, data: { id, email, requires_password_change } });
});

// In-memory rate limiting store: key -> { count, firstAttempt, lastAttempt }
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS_PER_WINDOW = 5;

// In-memory single-use reset ticket store: ticket -> { email, userId, expiresAt }
const resetTicketStore = new Map();
const TICKET_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of rate limits and expired tickets
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
            rateLimitStore.delete(key);
        }
    }
    for (const [ticket, data] of resetTicketStore.entries()) {
        if (data.expiresAt < now) {
            resetTicketStore.delete(ticket);
        }
    }
}, 5 * 60 * 1000);

// Helper: Check & update rate limit
function checkRateLimit(key) {
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record) {
        rateLimitStore.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
        return { allowed: true, remaining: MAX_ATTEMPTS_PER_WINDOW - 1 };
    }

    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
        return { allowed: true, remaining: MAX_ATTEMPTS_PER_WINDOW - 1 };
    }

    if (record.count >= MAX_ATTEMPTS_PER_WINDOW) {
        const resetMinutes = Math.ceil((record.firstAttempt + RATE_LIMIT_WINDOW_MS - now) / 60000);
        return { allowed: false, resetMinutes };
    }

    record.count++;
    record.lastAttempt = now;
    return { allowed: true, remaining: MAX_ATTEMPTS_PER_WINDOW - record.count };
}

// Helper: Mask phone number (e.g. "+63 917 ··· 4567")
function maskPhone(phone) {
    if (!phone) return 'registered phone';
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('63') && (clean.length === 12 || clean.length === 11)) {
        clean = clean.slice(2);
    }
    clean = clean.replace(/^0+/, '');
    if (clean.length < 7) return 'registered phone';
    return '+63 ' + clean.slice(0, 3) + ' ··· ' + clean.slice(-4);
}

// Helper: NIST SP 800-63B Password Complexity Validator
export function validatePasswordEntropy(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'Password is required' };
    }
    if (password.length < 10) {
        return { valid: false, error: 'Password must be at least 10 characters long for enterprise security.' };
    }
    if (password.length > 1024) return { valid: false, error: 'Password must be at most 1024 characters long.' };
    if (!/[A-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one uppercase letter (A-Z).' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one lowercase letter (a-z).' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one numeric digit (0-9).' };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return { valid: false, error: 'Password must contain at least one special character (!@#$%^&*).' };
    }
    return { valid: true };
}

/**
 * POST /api/auth/security/verify-workplace-account
 * Checks recovery eligibility without returning employee profile details.
 * Validates existence, active employment status, and enrolled recovery channels.
 */
router.post('/verify-workplace-account', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier || typeof identifier !== 'string' || identifier.trim().length < 3) {
            return res.json({ exists: false, error: 'Please enter a valid workplace email or Employee ID.' });
        }

        const clean = identifier.trim().toLowerCase();

        // Query employees by email OR company_id
        const { data: emp, error } = await supabase
            .from('employees')
            .select('id, auth_user_id, email, status, is_active, requires_password_change, has_registered_biometrics, biometric_baseline_path, password_changed_at')
            .or(`email.ilike.${postgrestLikeValue(clean)},company_id.ilike.${postgrestLikeValue(clean)}`)
            .maybeSingle();

        if (error || !emp) {
            return res.json({
                exists: false,
                error: 'No registered workplace account matches this email or Employee ID.'
            });
        }

        // Check if employment is active
        if (emp.is_active === false || emp.status === 'terminated' || emp.status === 'suspended') {
            return res.json({
                exists: true,
                eligible: false,
                status: emp.status,
                error: `This workplace account is currently ${emp.status || 'inactive'}. Please contact HR or System Administrator.`
            });
        }

        // Check if account has a registered workplace email
        const hasRegisteredEmail = Boolean(emp.email && emp.email.trim().length > 3 && emp.email.includes('@'));
        if (!hasRegisteredEmail) {
            return res.json({
                exists: true,
                eligible: false,
                hasEmail: false,
                error: 'Account found, but no workplace email address is registered on file. Please contact HR for in-person credential reset.'
            });
        }

        // Strict Registration & Biometrics Policy:
        // Must either be a registered account (completed initial forced password change) OR have registered biometrics.
        const hasBiometrics = Boolean(emp.has_registered_biometrics || emp.biometric_baseline_path);
        const isRegisteredAccount = emp.requires_password_change === false || Boolean(emp.password_changed_at);

        if (!hasBiometrics && !isRegisteredAccount) {
            return res.json({
                exists: true,
                eligible: false,
                reason: 'pending_registration',
                error: 'This account has not completed initial registration or forced password change. Self-service password recovery is only available for registered accounts or accounts with enrolled biometrics. Please sign in with your temporary credentials issued by HR.'
            });
        }

        // Return recovery availability without exposing the employee profile.
        let hasTotp = false;
        const targetUserId = emp.auth_user_id || emp.id;
        if (targetUserId) {
            try {
                hasTotp = (await authenticatorService.status(targetUserId)).enabled;
            } catch (_) {}
        }

        return res.json({
            exists: true,
            eligible: true,
            hasEmail: true,
            email: emp.email,
            has_totp: hasTotp,
        });
    } catch (err) {
        return res.status(500).json({ exists: false, error: err.message });
    }
});

/**
 * POST /api/auth/security/forgot-password
 * Initiates enterprise recovery (Rate-Limited, Strict Account & Email Verification, Dual-Factor SMS or Email)
 */
router.post('/forgot-password', async (req, res) => {
    const requestId = crypto.randomUUID();
    res.set('X-Request-ID', requestId);
    const startTime = Date.now();
    try {
        const { email, method = 'sms' } = req.body;
        const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ success: false, error: 'A valid workplace email is required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Rate Limiting Check (by IP + Email)
        const rateLimitKey = `${clientIp}_${normalizedEmail}`;
        const limitCheck = checkRateLimit(rateLimitKey);
        if (!limitCheck.allowed) {
            return res.status(429).json({
                success: false,
                error: `Too many password reset attempts. For your security, this account is temporarily locked for ${limitCheck.resetMinutes} minute(s).`
            });
        }

        // 2. Fetch employee details from database by email OR company_id
        const { data: emp, error: empErr } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, email, role, status, is_active, requires_password_change, has_registered_biometrics, biometric_baseline_path, password_changed_at')
            .or(`email.ilike.${postgrestLikeValue(normalizedEmail)},company_id.ilike.${postgrestLikeValue(normalizedEmail)}`)
            .maybeSingle();

        // 3. Strict Workplace Verification: Account MUST exist and have an active registered workplace email
        if (empErr) throw Object.assign(new Error('Account verification is temporarily unavailable. Please retry shortly.'), { status: 503, code: 'OTP_ACCOUNT_UNAVAILABLE' });
        if (!emp) {
            const dummy = createChallenge({ accountId: normalizedEmail, purpose: 'pwd_reset', method, accountExists: false });
            return res.json({
                success: true,
                method: 'email',
                email: normalizedEmail,
                message: `6-digit security code dispatched to your email inbox: ${normalizedEmail}`,
                challengeId: dummy.challengeId,
                cooldown: 60,
                expiresIn: dummy.expiresIn
            });
        }

        if (emp.is_active === false || emp.status === 'terminated' || emp.status === 'suspended') {
            return res.status(403).json({
                success: false,
                error: `This workplace account is currently ${emp.status || 'inactive'}. Password recovery is unavailable. Please contact HR.`
            });
        }

        if (!emp.email || emp.email.trim().length < 3 || !emp.email.includes('@')) {
            return res.status(400).json({
                success: false,
                error: 'This workplace account does not have a registered workplace email on file. Please contact HR/Admin for assistance.'
            });
        }

        // 4. Strict Registration & Biometrics Policy:
        // Recovery codes can ONLY be dispatched to accounts that have enrolled biometrics OR have completed initial account registration / force password change.
        const hasBiometrics = Boolean(emp.has_registered_biometrics || emp.biometric_baseline_path);
        const isRegisteredAccount = emp.requires_password_change === false || Boolean(emp.password_changed_at);

        if (!hasBiometrics && !isRegisteredAccount) {
            return res.status(403).json({
                success: false,
                reason: 'pending_registration',
                error: 'This account has not completed initial registration or forced password change. Self-service password recovery is only permitted for registered accounts or accounts with enrolled biometrics. Please log in with your temporary credentials provided by HR.'
            });
        }

        const targetEmail = emp.email.trim().toLowerCase();
        const userName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Colleague';

        // Retrieve registered mobile phone from Supabase Auth identity store
        let userPhone = null;
        if (method === 'sms' && emp.id) {
            try {
                const { data: authUserData } = await supabase.auth.admin.getUserById(emp.id);
                userPhone = authUserData?.user?.user_metadata?.phone || authUserData?.user?.phone || null;
            } catch (authErr) {
                console.warn('[AUTH_SECURITY] Notice fetching user phone:', authErr.message);
            }
        }

        // 4.5. Atomic Double-Click & Cooldown Lock Check (Purpose-isolated to prevent cross-action lockups)
        const lockKeys = [`pwd_reset_${targetEmail}`, `dest_email_pwd_reset_${targetEmail}`];
        if (method === 'sms' && userPhone) {
            lockKeys.push(`dest_phone_pwd_reset_${userPhone}`);
        }

        const lock = acquireOtpLock(lockKeys);
        if (!lock.acquired) {
            const errorMsg = lock.reason === 'in_flight'
                ? 'A verification dispatch is already processing for this account. Please wait a moment.'
                : `Please wait ${lock.remainingSeconds}s before requesting another verification code.`;
            return res.status(429).json({
                success: false,
                error: errorMsg,
                retry_after: lock.remainingSeconds
            });
        }

        // 5. Method A: SMS OTP Dispatch (Demo Sandbox Code with 1-Click Autofill)
        if (method === 'sms') {
            if (!userPhone) {
                releaseOtpLock(lockKeys, false);
                return res.status(400).json({
                    success: false,
                    error: 'No registered corporate phone found for this account. Please select Email Verification.'
                });
            }

            let smsSucceeded = false;
            let creationReservation;
            try {
                const otpStorageKey = `pwd_reset_${targetEmail}`;
                const otpInfo = getOrGenerateOtp(otpStorageKey, {
                    challengeId: req.body.challengeId || req.body.challenge_id,
                    purpose: 'pwd_reset',
                    method: 'sms'
                });
                if (!otpInfo.isRotated) creationReservation = reserveAccountChallengeCreation(targetEmail, clientIp);
                const code = otpInfo.code;

                const smsResult = await sendSmsOtp(userPhone, code);
                otpInfo.commit();
                smsSucceeded = true;
                const isSimulated = Boolean(smsResult?.simulated);
                const previewCode = otpTestMode() && isSimulated ? code : undefined;

                await createAuditLog({
                    log_name: 'security',
                    description: `Password recovery SMS OTP dispatched to ${maskPhone(userPhone)} for ${targetEmail} (${emp.role})`,
                    subject_type: 'Security',
                    subject_id: emp.id,
                    event: 'PASSWORD_RESET_SMS_DISPATCHED',
                    causer_id: emp.id,
                    properties: {
                        email: targetEmail,
                        role: emp.role,
                        method: 'sms',
                        masked_phone: maskPhone(userPhone),
                        ip: clientIp,
                        user_agent: req.headers['user-agent']
                    }
                });

                return res.json({
                    success: true,
                    method: 'sms',
                    challengeId: otpInfo.challengeId,
                    email: targetEmail,
                    maskedPhone: maskPhone(userPhone),
                    message: `6-digit security code sent to ${maskPhone(userPhone)}`,
                    cooldown: 60,
                    simulated: isSimulated,
                    previewCode,
                    reusedExisting: otpInfo.isExisting,
                    expiresIn: otpInfo.remainingSeconds
                });
            } finally {
                if (!smsSucceeded) creationReservation?.release();
                releaseOtpLock(lockKeys, smsSucceeded);
            }
        }

        // 6. Method B: Real Email OTP Dispatch (Delivered to User Inbox via Brevo API)
        let sendSucceeded = false;
        let creationReservation;
        try {
            const emailOtpInfo = getOrGenerateOtp([`pwd_reset_${targetEmail}`, targetEmail], {
                challengeId: req.body.challengeId || req.body.challenge_id,
                purpose: 'pwd_reset',
                method: 'email',
                accountExists: true
            });
            if (!emailOtpInfo.isRotated) creationReservation = reserveAccountChallengeCreation(targetEmail, clientIp);
            const emailCode = emailOtpInfo.code;
            const emailResult = await sendEmailOtp(targetEmail, emailCode, userName, { requestId, purpose: 'pwd_reset' });

            if (typeof emailOtpInfo.commit === 'function') {
                emailOtpInfo.commit();
            }
            sendSucceeded = true;

            await createAuditLog({
                log_name: 'security',
                description: `Password reset real email OTP dispatched to ${targetEmail} (${emp.role})`,
                subject_type: 'Security',
                subject_id: emp.id,
                event: 'PASSWORD_RESET_EMAIL_DISPATCHED',
                causer_id: emp.id,
                properties: {
                    email: targetEmail,
                    role: emp.role,
                    method: 'email',
                    ip: clientIp,
                    user_agent: req.headers['user-agent']
                }
            });

            const isSimulated = Boolean(emailResult?.simulated);
            const previewCode = (!isProduction() && otpTestMode() && isSimulated) ? emailCode : undefined;

            return res.json({
                success: true,
                method: 'email',
                email: targetEmail,
                challengeId: emailOtpInfo.challengeId,
                message: `6-digit security code dispatched to your email inbox: ${targetEmail}`,
                cooldown: 60,
                expiresIn: emailOtpInfo.remainingSeconds,
                simulated: !isProduction() && isSimulated,
                previewCode
            });
        } catch (emailErr) {
            throw emailErr;
        } finally {
            if (!sendSucceeded) creationReservation?.release();
            releaseOtpLock(lockKeys, sendSucceeded);
        }

    } catch (err) {
        console.error('[AUTH_SECURITY_FORGOT_ERROR]', { requestId, code: err.code || 'OTP_SEND_FAILED' });
        if (err.retryAfter || err.status === 503) res.set('Retry-After', String(err.retryAfter || 5));
        return res.status(err.status || 500).json({ success: false, code: err.code, retry_after: err.retryAfter, error: err.status ? err.message : 'Internal security protocol error. Please try again later.' });
    }
});

if (otpTestMode()) {
    router.post('/test/expire-otp', (req, res) => {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
        const norm = email.trim().toLowerCase();
        const expired = expireOtpForTesting('pwd_reset_' + norm);
        releaseOtpLock(['pwd_reset_' + norm, norm, 'dest_email_pwd_reset_' + norm], false);
        return res.json({ success: true, expired });
    });
}

/**
 * POST /api/auth/security/verify-reset-otp
 * Validates the 6-digit SMS/Email OTP and issues a single-use 10-minute cryptographic Reset Ticket
 */
router.post('/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp, method = 'sms' } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ success: false, error: 'Email and 6-digit code are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Fetch employee details to bind ticket
        const { data: emp } = await supabase
            .from('employees')
            .select('id, auth_user_id, email, role, first_name, last_name')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (!emp) {
            return res.status(400).json({ success: false, error: 'Account could not be identified.' });
        }

        let verifiedVia = 'OTP';
        let isValid = false;
        let errorMessage = 'Invalid or expired verification code.';

        // PATH A: Authenticator TOTP verification
        if (method === 'totp' || method === 'authenticator') {
            const targetUserId = emp.auth_user_id || emp.id;
            const proof = await authenticatorService.verify(targetUserId, otp);
            isValid = proof.valid;
            if (proof.valid) verifiedVia = proof.verifiedVia;
            else errorMessage = proof.error;

            // Bidirectional Omnichannel Fallback: Check if user entered active Email OTP instead
            if (!isValid) {
                const otpStorageKey = `pwd_reset_${normalizedEmail}`;
                const verifyResult = verifyOtpCode(otpStorageKey, otp);
                if (verifyResult.valid) {
                    isValid = true;
                    verifiedVia = 'EMAIL_OTP_SEAMLESS_FALLBACK';
                }
            }
        } else {
            // PATH B: Standard SMS/Email OTP verification
            const targetChallengeId = req.body.challengeId || req.body.challenge_id;
            const verifyResult = verifyOtpCode({
                challengeId: targetChallengeId,
                identifier: `pwd_reset_${normalizedEmail}`,
                code: otp,
                purpose: 'pwd_reset'
            });
            if (verifyResult.valid) {
                isValid = true;
                verifiedVia = 'SMS_OR_EMAIL_OTP';
            } else {
                // Seamless fallback: check if user entered active TOTP code
                const targetUserId = emp.auth_user_id || emp.id;
                const proof = await authenticatorService.verify(targetUserId, otp);
                if (proof.valid) { isValid = true; verifiedVia = proof.verifiedVia; }
                if (!isValid) {
                    errorMessage = verifyResult.error;
                }
            }
        }

        if (!isValid) {
            return res.status(400).json({ success: false, error: errorMessage });
        }

        // Issue single-use cryptographic Reset Ticket
        const resetTicket = crypto.randomBytes(32).toString('hex');
        resetTicketStore.set(resetTicket, {
            userId: emp.id,
            authUserId: emp.auth_user_id || emp.id,
            email: normalizedEmail,
            role: emp.role,
            verifiedVia,
            expiresAt: Date.now() + TICKET_EXPIRATION_MS
        });

        await createAuditLog({
            log_name: 'security',
            description: `Identity verified via ${verifiedVia} for ${normalizedEmail}. Reset ticket issued.`,
            subject_type: 'Security',
            subject_id: emp.id,
            event: 'PASSWORD_RESET_VERIFIED',
            causer_id: emp.id,
            properties: {
                email: normalizedEmail,
                channel: verifiedVia,
                ip: req.ip || req.headers['x-forwarded-for'],
                ticket_ttl_minutes: 10
            }
        });

        res.json({
            success: true,
            message: 'Identity verified successfully. You may now establish your new password.',
            verifiedVia,
            resetTicket
        });

    } catch (err) {
        console.error('[AUTH_SECURITY_VERIFY_ERROR]', err);
        res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
    }
});

/**
 * POST /api/auth/security/verify-emergency-key
 * UI-Friendly Master Security Key Verification (Zero CMD needed, instant validation)
 */
router.post('/verify-emergency-key', async (req, res) => {
    try {
        const { email, recoveryKey } = req.body || {};
        if (typeof email !== 'string' || !email.trim() || email.length > 255 ||
            typeof recoveryKey !== 'string' || !recoveryKey.trim() || recoveryKey.length > 1024) {
            return res.status(400).json({ success: false, error: 'Workplace email and Master Recovery Key are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
        const limitCheck = checkRateLimit(`emergency_${clientIp}`);
        if (!limitCheck.allowed) {
            return res.status(429).json({ success: false, error: `Too many emergency recovery attempts. Please retry in ${limitCheck.resetMinutes} minute(s).` });
        }

        const configuredMasterKey = process.env.MASTER_RECOVERY_KEY;
        if (typeof configuredMasterKey !== 'string' || configuredMasterKey.length < 32 ||
            configuredMasterKey.length > 1024 || configuredMasterKey !== configuredMasterKey.trim()) {
            return res.status(503).json({ success: false, error: 'Emergency recovery is unavailable. Please use another recovery method or contact your administrator.' });
        }

        const submittedDigest = crypto.createHash('sha256').update(recoveryKey.trim()).digest();
        const configuredDigest = crypto.createHash('sha256').update(configuredMasterKey).digest();
        if (!crypto.timingSafeEqual(submittedDigest, configuredDigest)) {
            return res.status(401).json({ success: false, error: 'Invalid Master Recovery Key. Please check the credentials.' });
        }

        const { data: emp, error: empErr } = await supabase
            .from('employees')
            .select('id, auth_user_id, email, role, first_name, last_name, is_active')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (empErr || !emp || emp.is_active === false) {
            return res.status(404).json({ success: false, error: 'No active employee account matching this email.' });
        }

        // Issue single-use cryptographic Reset Ticket
        const resetTicket = crypto.randomBytes(32).toString('hex');
        resetTicketStore.set(resetTicket, {
            userId: emp.id,
            authUserId: emp.auth_user_id || emp.id,
            email: normalizedEmail,
            role: emp.role,
            expiresAt: Date.now() + TICKET_EXPIRATION_MS
        });

        await createAuditLog({
            log_name: 'security',
            description: `Emergency Master Key verified via Web UI for ${normalizedEmail} (${emp.role})`,
            subject_type: 'Security',
            subject_id: emp.id,
            event: 'EMERGENCY_MASTER_KEY_VERIFIED',
            causer_id: emp.id,
            properties: {
                email: normalizedEmail,
                ip: req.ip || req.headers['x-forwarded-for'],
                channel: 'web_ui_emergency_tab'
            }
        });

        res.json({
            success: true,
            message: 'Master Key verified successfully! You may now establish your new password.',
            resetTicket
        });

    } catch (err) {
        console.error('[AUTH_SECURITY_EMERGENCY_ERROR]', err);
        res.status(500).json({ success: false, error: 'Emergency validation failed. Please try again.' });
    }
});

/**
 * POST /api/auth/security/reset-password
 * Executes password update with NIST entropy check, global session termination, and audit trail
 */
router.post('/reset-password', async (req, res) => {
    let activeTicket;
    try {
        const { resetTicket, newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({ success: false, error: 'New password is required.' });
        }

        // 1. Enforce NIST SP 800-63B Password Complexity
        const entropyCheck = validatePasswordEntropy(newPassword);
        if (!entropyCheck.valid) {
            return res.status(400).json({ success: false, error: entropyCheck.error });
        }

        // 2. Validate Reset Ticket
        if (!resetTicket || !resetTicketStore.has(resetTicket)) {
            return res.status(401).json({
                success: false,
                error: 'Invalid, expired, or previously consumed reset ticket. Please restart the recovery process.'
            });
        }

        const ticketData = resetTicketStore.get(resetTicket);
        if (Date.now() > ticketData.expiresAt) {
            resetTicketStore.delete(resetTicket);
            return res.status(401).json({ success: false, error: 'Reset ticket has expired. Please request a new one.' });
        }

        if (ticketData.processing) return res.status(409).json({ success: false, error: 'A password update is already in progress. Please wait.' });
        const attempt = checkRateLimit(`reset_${resetTicket}`);
        if (!attempt.allowed) return res.status(429).json({ success: false, error: 'Too many password reset attempts. Please restart recovery.' });

        const { userId, email, role } = ticketData;
        const authUserId = ticketData.authUserId || userId;
        // 3. Lock this ticket across asynchronous verification; rejected passwords keep it usable.
        activeTicket = ticketData;
        ticketData.processing = true;

        // 4. Use the provider's normal password update, including its same-password check.
        const { sessionsInvalidated } = await resetVerifiedPassword({ authUserId, email, password: newPassword });
        resetTicketStore.delete(resetTicket);
        invalidateAuthUser(authUserId);
        if (authUserId !== userId) invalidateAuthUser(userId);

        // 5. Update employees table if flag exists
        await supabase
            .from('employees')
            .update({ requires_password_change: false, updated_at: new Date().toISOString() })
            .eq('id', userId);

        // 6. The isolated recovery session performs global refresh-session revocation.

        // 7. Write High-Severity Security Audit Log
        await createAuditLog({
            log_name: 'security',
            description: `Security Alert: Password successfully reset for ${email} (${role}).`,
            subject_type: 'Security',
            subject_id: userId,
            event: 'PASSWORD_RESET_SUCCESS',
            causer_id: userId,
            properties: {
                email,
                role,
                ip: req.ip || req.headers['x-forwarded-for'],
                user_agent: req.headers['user-agent'],
                compliance: 'NIST_SP_800_63B',
                sessions_invalidated: sessionsInvalidated,
                timestamp: new Date().toISOString()
            }
        });

        res.json({
            success: true,
            message: 'Password successfully updated. Please log in with your new password.'
        });

    } catch (err) {
        if (isPasswordReuseError(err)) return res.status(400).json({ success: false, code: 'PASSWORD_REUSED', error: PASSWORD_REUSE_MESSAGE });
        if (err?.code === 'weak_password') return res.status(400).json({ success: false, error: 'Choose a stronger password that meets the password requirements.' });
        console.error('[AUTH_SECURITY_RESET_ERROR]', { code: err?.code || 'UNAVAILABLE' });
        res.status(err?.status === 429 ? 429 : 503).json({ success: false, error: 'Unable to update your password right now. Please try again.' });
    } finally {
        if (activeTicket) activeTicket.processing = false;
    }
});

export default router;
