import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// In-memory OTP storage with 5-minute TTL
const otpStore = new Map();

// Cooldown duration between resends (standard enterprise 60 seconds)
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Resend Cooldown Store: identifier -> timestamp of last dispatch
const cooldownStore = new Map();

// Periodic cleanup of expired OTPs and stale cooldown records every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of otpStore.entries()) {
        if (record.expiresAt < now) {
            otpStore.delete(key);
        }
    }
    for (const [key, timestamp] of cooldownStore.entries()) {
        if (now - timestamp > 10 * 60 * 1000) {
            cooldownStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Check if an identifier is currently in active cooldown
export function checkOtpCooldown(identifier, cooldownMs = OTP_RESEND_COOLDOWN_MS) {
    if (!identifier) return { allowed: true, remainingSeconds: 0 };
    const key = identifier.toLowerCase().trim();
    const lastSent = cooldownStore.get(key);
    if (!lastSent) return { allowed: true, remainingSeconds: 0 };

    const elapsed = Date.now() - lastSent;
    if (elapsed < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
        return { allowed: false, remainingSeconds };
    }
    return { allowed: true, remainingSeconds: 0 };
}

// Record successful OTP dispatch timestamp to enforce cooldown
export function recordOtpDispatch(identifier) {
    if (!identifier) return;
    const key = identifier.toLowerCase().trim();
    cooldownStore.set(key, Date.now());
}

// Generate 6-digit cryptographic OTP code
export function generateOtpCode() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Retrieve active unexpired OTP code or generate a new one.
 * Enterprise standard: If an unexpired code exists (< 5 minutes) and attempts < 5,
 * we reuse the active code so that resends and retries deliver the exact same code.
 */
export function getOrGenerateOtp(identifier) {
    if (!identifier) {
        return { code: generateOtpCode(), isExisting: false, remainingSeconds: 300 };
    }

    const key = identifier.toLowerCase().trim();
    const existing = otpStore.get(key);
    const now = Date.now();

    if (existing && existing.expiresAt > now && existing.attempts < 5 && existing.code) {
        return {
            code: existing.code,
            isExisting: true,
            expiresAt: existing.expiresAt,
            remainingSeconds: Math.ceil((existing.expiresAt - now) / 1000)
        };
    }

    const newCode = generateOtpCode();
    return {
        code: newCode,
        isExisting: false,
        expiresAt: now + 5 * 60 * 1000,
        remainingSeconds: 300
    };
}

/**
 * Store OTP in memory with a 5-minute expiration.
 * Retains previous valid codes so delayed SMS/emails can still be verified ("use the old one").
 */
export function storeOtp(identifier, code) {
    const key = identifier.toLowerCase().trim();
    const now = Date.now();
    const existing = otpStore.get(key);

    const previousCodes = [];
    if (existing && existing.expiresAt > now) {
        if (existing.code && existing.code !== code) {
            previousCodes.push(existing.code);
        }
        if (Array.isArray(existing.previousCodes)) {
            for (const prev of existing.previousCodes) {
                if (prev && prev !== code && !previousCodes.includes(prev)) {
                    previousCodes.push(prev);
                }
            }
        }
    }

    otpStore.set(key, {
        code,
        previousCodes: previousCodes.slice(0, 5),
        expiresAt: (existing && existing.code === code && existing.expiresAt > now)
            ? existing.expiresAt
            : now + 5 * 60 * 1000,
        attempts: 0
    });
}

// Get active unexpired OTP status without modifying state
export function getActiveOtp(identifier) {
    if (!identifier) return null;
    const key = identifier.toLowerCase().trim();
    const record = otpStore.get(key);
    if (!record || Date.now() > record.expiresAt) return null;
    return {
        code: record.code,
        expiresAt: record.expiresAt,
        remainingSeconds: Math.ceil((record.expiresAt - Date.now()) / 1000)
    };
}

// Verify OTP against memory store (accepts current active code or recent unexpired codes)
export function verifyOtpCode(identifier, code) {
    if (!identifier || !code) return { valid: false, error: 'Missing identifier or code' };

    const key = identifier.toLowerCase().trim();
    const record = otpStore.get(key);

    if (!record) {
        return { valid: false, error: 'No active OTP found or code expired. Please request a new one.' };
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(key);
        return { valid: false, error: 'Verification code has expired. Please request a new one.' };
    }

    if (record.attempts >= 5) {
        otpStore.delete(key);
        return { valid: false, error: 'Too many incorrect attempts. Please request a new code.' };
    }

    const enteredCode = String(code).trim();
    const matchesCurrent = record.code === enteredCode;
    const matchesPrevious = Array.isArray(record.previousCodes) && record.previousCodes.includes(enteredCode);

    if (!matchesCurrent && !matchesPrevious) {
        record.attempts++;
        return { valid: false, error: `Invalid code. ${5 - record.attempts} attempts remaining.` };
    }

    // Burn token after successful verification (single-use)
    otpStore.delete(key);
    return { valid: true };
}

// Send OTP email with fallback dispatching
export async function sendEmailOtp(email, code, userName = 'Employee') {
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
        <title>Verify your sign-in</title>
        <style>
            body { margin: 0; padding: 0; background-color: #EEF1F4; -webkit-text-size-adjust: 100%; }
            .canvas { padding: 48px 20px; }
            .card {
                max-width: 440px; margin: 0 auto; background: #FFFFFF;
                border: 1px solid #E2E6EB; border-radius: 16px; overflow: hidden;
                box-shadow: 0 1px 2px rgba(20,28,43,0.04), 0 8px 24px rgba(20,28,43,0.05);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            .header { background: #1C2536; padding: 34px 32px 26px; text-align: center; }
            .header svg { display: block; margin: 0 auto 12px; }
            .brand { color: #FFFFFF; font-size: 17px; font-weight: 600; letter-spacing: 0.2px; margin: 0; }
            .content { padding: 40px 40px 36px; text-align: center; }
            .heading { font-size: 19px; font-weight: 700; color: #161C2A; margin: 0 0 10px; }
            .lede { font-size: 15px; line-height: 1.6; color: #4A5364; margin: 0 auto 30px; max-width: 300px; }
            .lede strong { color: #161C2A; }
            .code {
                display: inline-block; background: #F3F6F9; border: 1px solid #DCE2EA;
                border-radius: 12px; padding: 16px 30px;
                font-family: 'SF Mono', 'Roboto Mono', Consolas, monospace;
                font-size: 30px; font-weight: 600; letter-spacing: 5px; color: #161C2A; margin: 0 0 26px;
            }
            .expiry { font-size: 13px; line-height: 1.7; color: #8891A0; margin: 0 0 4px; }
            .footer { border-top: 1px solid #E7EAEF; background: #FAFBFC; padding: 22px 32px; text-align: center; }
            .footer p { font-size: 12px; line-height: 1.6; color: #9CA5B4; margin: 0 0 4px; }
            .footer p:last-child { margin-bottom: 0; }
            @media (max-width: 480px) {
                .canvas { padding: 28px 12px; }
                .header { padding: 28px 24px 22px; }
                .content { padding: 32px 24px 28px; }
                .code { font-size: 25px; letter-spacing: 3px; padding: 14px 18px; }
            }
        </style>
    </head>
    <body>
        <div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">
            Your C-Point verification code is ready — it expires in 5 minutes.
        </div>
        <div class="canvas">
            <div class="card">
                <div class="header">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z" fill="#FFFFFF" fill-opacity="0.95"/>
                        <path d="M9 12.5l2 2 4-4.5" stroke="#1B2436" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <p class="brand">C-Point</p>
                </div>
                <div class="content">
                    <p class="heading">Verify it's you</p>
                    <p class="lede">Hi <strong>${userName}</strong>, enter this code to finish signing in.</p>
                    <div class="code">${String(code).replace(/(\d{3})(\d{3})/, '$1 $2')}</div>
                    <p class="expiry">This code expires in 5 minutes.</p>
                    <p class="expiry">For your security, don't share it with anyone.</p>
                </div>
                <div class="footer">
                    <p>C-Point HRIS</p>
                    <p>This is an automated message — please don't reply.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    // 1. Primary dispatcher: Brevo REST API v3
    if (process.env.BREVO_API_KEY) {
        try {
            const senderEmail = process.env.BREVO_SENDER_EMAIL || 'marikinahris2026@gmail.com';
            const senderName = process.env.BREVO_SENDER_NAME || 'C-Point HRIS Security';

            const res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: senderName, email: senderEmail },
                    to: [{ email: email.trim().toLowerCase(), name: userName }],
                    subject: `${code} is your C-Point HRIS Verification Code`,
                    htmlContent: htmlContent,
                    textContent: `Your C-Point HRIS verification code is ${code}. It expires in 5 minutes. Never share this code with anyone.`
                })
            });

            const data = await res.json();
            if (res.ok && data.messageId) {
                console.log(`[OTP_BREVO_SUCCESS] Dispatched to ${email}: MessageID ${data.messageId}`);
                return { success: true, provider: 'brevo', messageId: data.messageId };
            }
            console.warn(`[OTP_BREVO_WARN] Brevo response:`, data);
        } catch (err) {
    console.warn(`[OTP_BREVO_ERROR] Brevo dispatch error (${err.message}).`);
    return { success: false, error: 'Email delivery failed. Please try again or contact IT.' };
}
    }

    // Local simulation fallback
    console.warn(`[OTP_EMAIL_SIMULATED] Target: ${email} | Code: ${code}`);
    return { success: true, simulated: true, code };
}

// Send OTP via SMS (Semaphore API for PH mobile numbers)
export async function sendSmsOtp(phoneNumber, code) {
    const apiKey = process.env.SEMAPHORE_API_KEY;
    const senderName = process.env.SEMAPHORE_SENDER_NAME || 'CPOINT';

    let formattedNumber = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
    if (formattedNumber.startsWith('63') && formattedNumber.length === 12) {
        formattedNumber = '0' + formattedNumber.slice(2);
    }

    const message = `Your C-Point HRIS security code is: ${code}. Valid for 5 minutes. Do not share this code.`;

    if (!apiKey) {
        console.warn(`[OTP_SMS_SIMULATED] Target: ${formattedNumber || phoneNumber} | Code: ${code}`);
        return { success: true, simulated: true, code };
    }

    try {
        const res = await fetch('https://api.semaphore.co/api/v4/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apikey: apiKey,
                number: formattedNumber,
                message: message,
                sendername: senderName
            })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || 'Semaphore SMS gateway error');
        }

        console.log(`[OTP_SMS_SUCCESS] Successfully sent SMS to ${formattedNumber}`);
        return { success: true, data };
    } catch (err) {
        console.warn(`[OTP_SMS_FALLBACK] SMS dispatch note:`, err.message);
        return { success: true, simulated: true, code, warning: err.message };
    }
}
