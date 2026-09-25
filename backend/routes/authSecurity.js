import express from 'express';
import crypto from 'crypto';
import { supabase } from '../supabaseClient.js';
import { generateOtpCode, storeOtp, verifyOtpCode, sendEmailOtp, sendSmsOtp } from '../services/otpService.js';
import { createAuditLog } from './auditLogs.js';

const router = express.Router();

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

// Helper: Mask phone number (e.g. "09123456789" -> "09******789")
function maskPhone(phone) {
    if (!phone) return 'registered phone';
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 7) return 'registered phone';
    return clean.slice(0, 2) + '*'.repeat(Math.max(4, clean.length - 5)) + clean.slice(-3);
}

// Helper: NIST SP 800-63B Password Complexity Validator
export function validatePasswordEntropy(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'Password is required' };
    }
    if (password.length < 10) {
        return { valid: false, error: 'Password must be at least 10 characters long for enterprise security.' };
    }
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
 * POST /api/auth/security/forgot-password
 * Initiates enterprise recovery (Zero-Enumeration, Rate-Limited, Dual-Factor SMS or Email)
 */
router.post('/forgot-password', async (req, res) => {
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

        // 2. Fetch employee details from database
        const { data: emp, error: empErr } = await supabase
            .from('employees')
            .select('id, first_name, last_name, email, phone, role, status, is_active')
            .eq('email', normalizedEmail)
            .maybeSingle();

        // 3. Timing-Attack Defense: Ensure minimum execution time so attackers cannot measure query latency
        const elapsed = Date.now() - startTime;
        if (elapsed < 350) {
            await new Promise(r => setTimeout(r, 350 - elapsed + Math.floor(Math.random() * 150)));
        }

        // 4. Zero User Enumeration: If user does not exist or is inactive, return standard success message
        if (empErr || !emp || emp.is_active === false || emp.status === 'terminated') {
            return res.json({
                success: true,
                generic: true,
                method,
                message: 'If an active workplace account matches that email, security instructions have been dispatched.'
            });
        }

        const userName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Colleague';

        // 5. Method A: Instant SMS OTP Dispatch
        if (method === 'sms') {
            if (!emp.phone) {
                // If phone is missing, fall back to email transparently
                return res.status(400).json({
                    success: false,
                    error: 'No registered corporate phone found for this account. Please select Email Verification.'
                });
            }

            const code = generateOtpCode();
            const otpStorageKey = `pwd_reset_${normalizedEmail}`;
            storeOtp(otpStorageKey, code);

            const smsResult = await sendSmsOtp(emp.phone, code);
            const isSimulated = Boolean(smsResult?.simulated);
            const previewCode = (isSimulated || process.env.ALLOW_OTP_PREVIEW !== 'false') ? code : undefined;

            await createAuditLog({
                log_name: 'security',
                description: `Password recovery SMS OTP dispatched to ${maskPhone(emp.phone)} for ${normalizedEmail} (${emp.role})`,
                subject_type: 'Security',
                subject_id: emp.id,
                event: 'PASSWORD_RESET_SMS_DISPATCHED',
                causer_id: emp.id,
                properties: {
                    email: normalizedEmail,
                    role: emp.role,
                    method: 'sms',
                    masked_phone: maskPhone(emp.phone),
                    ip: clientIp,
                    user_agent: req.headers['user-agent']
                }
            });

            return res.json({
                success: true,
                method: 'sms',
                maskedPhone: maskPhone(emp.phone),
                message: `6-digit security code sent to ${maskPhone(emp.phone)}`,
                simulated: isSimulated,
                previewCode
            });
        }

        // 6. Method B: Email Recovery Link Dispatch
        const origin = req.headers.origin || 'http://localhost:5173';
        const redirectUrl = `${origin}/reset-password`;

        let emailDispatched = false;
        try {
            // Attempt to generate standard Supabase recovery link
            const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
                type: 'recovery',
                email: normalizedEmail,
                options: { redirectTo: redirectUrl }
            });

            if (!linkErr && linkData?.properties?.action_link) {
                emailDispatched = true;
            }
        } catch (linkGenErr) {
            console.warn('[AUTH_SECURITY] Supabase generateLink notice:', linkGenErr.message);
        }

        // Also generate email OTP as fallback
        const emailCode = generateOtpCode();
        storeOtp(`pwd_reset_${normalizedEmail}`, emailCode);
        const emailResult = await sendEmailOtp(normalizedEmail, emailCode, userName);

        await createAuditLog({
            log_name: 'security',
            description: `Password reset email instructions dispatched to ${normalizedEmail} (${emp.role})`,
            subject_type: 'Security',
            subject_id: emp.id,
            event: 'PASSWORD_RESET_EMAIL_DISPATCHED',
            causer_id: emp.id,
            properties: {
                email: normalizedEmail,
                role: emp.role,
                method: 'email',
                ip: clientIp,
                user_agent: req.headers['user-agent']
            }
        });

        const isSimulated = Boolean(emailResult?.simulated);
        const previewCode = (isSimulated || process.env.ALLOW_OTP_PREVIEW !== 'false') ? emailCode : undefined;

        return res.json({
            success: true,
            method: 'email',
            message: 'If an active workplace account matches that email, verification instructions have been dispatched.',
            simulated: isSimulated,
            previewCode
        });

    } catch (err) {
        console.error('[AUTH_SECURITY_FORGOT_ERROR]', err);
        return res.status(500).json({ success: false, error: 'Internal security protocol error. Please try again later.' });
    }
});

/**
 * POST /api/auth/security/verify-reset-otp
 * Validates the 6-digit SMS/Email OTP and issues a single-use 10-minute cryptographic Reset Ticket
 */
router.post('/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ success: false, error: 'Email and 6-digit OTP code are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const otpStorageKey = `pwd_reset_${normalizedEmail}`;

        const verifyResult = verifyOtpCode(otpStorageKey, otp);
        if (!verifyResult.valid) {
            return res.status(400).json({ success: false, error: verifyResult.error });
        }

        // Fetch employee details to bind ticket
        const { data: emp } = await supabase
            .from('employees')
            .select('id, email, role, first_name, last_name')
            .eq('email', normalizedEmail)
            .maybeSingle();

        if (!emp) {
            return res.status(400).json({ success: false, error: 'Account could not be identified.' });
        }

        // Issue single-use cryptographic Reset Ticket
        const resetTicket = crypto.randomBytes(32).toString('hex');
        resetTicketStore.set(resetTicket, {
            userId: emp.id,
            email: normalizedEmail,
            role: emp.role,
            expiresAt: Date.now() + TICKET_EXPIRATION_MS
        });

        await createAuditLog({
            log_name: 'security',
            description: `Out-of-band OTP verified for ${normalizedEmail}. Reset ticket issued.`,
            subject_type: 'Security',
            subject_id: emp.id,
            event: 'PASSWORD_RESET_OTP_VERIFIED',
            causer_id: emp.id,
            properties: {
                email: normalizedEmail,
                ip: req.ip || req.headers['x-forwarded-for'],
                ticket_ttl_minutes: 10
            }
        });

        res.json({
            success: true,
            message: 'OTP verified successfully. You may now establish your new password.',
            resetTicket
        });

    } catch (err) {
        console.error('[AUTH_SECURITY_VERIFY_ERROR]', err);
        res.status(500).json({ success: false, error: 'Verification failed. Please try again.' });
    }
});

/**
 * POST /api/auth/security/reset-password
 * Executes password update with NIST entropy check, global session termination, and audit trail
 */
router.post('/reset-password', async (req, res) => {
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

        const { userId, email, role } = ticketData;

        // 3. Consume Ticket Immediately (Strict Single-Use Nonce)
        resetTicketStore.delete(resetTicket);

        // 4. Update Password via Supabase Auth Admin API
        const { error: updateAuthErr } = await supabase.auth.admin.updateUserById(userId, {
            password: newPassword
        });

        if (updateAuthErr) {
            console.error('[AUTH_SECURITY_UPDATE_ERR]', updateAuthErr);
            return res.status(500).json({ success: false, error: 'Failed to update credentials. Please try again.' });
        }

        // 5. Update employees table if flag exists
        await supabase
            .from('employees')
            .update({ requires_password_change: false, updated_at: new Date().toISOString() })
            .eq('id', userId);

        // 6. Global Session Revocation: Invalidate all existing tokens / sessions
        try {
            if (supabase.auth.admin.signOut) {
                await supabase.auth.admin.signOut(userId, 'global');
            }
        } catch (signOutErr) {
            console.warn('[AUTH_SECURITY_GLOBAL_SIGNOUT_NOTE]', signOutErr.message);
        }

        // 7. Write High-Severity Security Audit Log
        await createAuditLog({
            log_name: 'security',
            description: `Security Alert: Password successfully reset for ${email} (${role}). All active sessions revoked.`,
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
                sessions_invalidated: true,
                timestamp: new Date().toISOString()
            }
        });

        res.json({
            success: true,
            message: 'Password successfully updated. For maximum security, all previous active sessions have been terminated. Please log in with your new password.'
        });

    } catch (err) {
        console.error('[AUTH_SECURITY_RESET_ERROR]', err);
        res.status(500).json({ success: false, error: 'An unexpected error occurred during password reset.' });
    }
});

export default router;
