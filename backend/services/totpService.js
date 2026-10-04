import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encodes a Buffer to RFC 4648 Base32 string (unpadded)
 * @param {Buffer} buffer
 * @returns {string}
 */
export function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }
    return output;
}

/**
 * Decodes an RFC 4648 Base32 string to Buffer
 * @param {string} input
 * @returns {Buffer}
 */
export function base32Decode(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('Base32 input must be a non-empty string');
    }
    const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (let i = 0; i < clean.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(clean[i]);
        if (idx === -1) {
            throw new Error(`Invalid Base32 character: ${clean[i]}`);
        }
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

// In-memory anti-replay cache: key -> expiresAt (TTL = 90s)
const replayCache = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, expiresAt] of replayCache.entries()) {
        if (expiresAt < now) {
            replayCache.delete(key);
        }
    }
}, 30 * 1000);

/**
 * Generates an RFC 6238 TOTP 6-digit code for a given secret and timestamp
 * @param {string} secretBase32
 * @param {number} timeMs
 * @param {number} stepSec
 * @returns {string}
 */
export function generateTotpCode(secretBase32, timeMs = Date.now(), stepSec = 30) {
    const key = base32Decode(secretBase32);
    const counter = Math.floor(timeMs / 1000 / stepSec);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[19] & 0x0f;
    const codeInt = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    ) % 1000000;
    return String(codeInt).padStart(6, '0');
}

/**
 * Generates a new cryptographic TOTP secret and standard otpauth URI
 * @param {string} email
 * @param {string} issuer
 * @returns {{ secret: string, uri: string, issuer: string, accountName: string }}
 */
export function generateTotpSecret(email, issuer = 'C-Point HRIS') {
    const randomBytes = crypto.randomBytes(20);
    const secret = base32Encode(randomBytes);
    const cleanEmail = email.trim();
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedEmail = encodeURIComponent(cleanEmail);
    const uri = `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
    return {
        secret,
        uri,
        issuer,
        accountName: cleanEmail
    };
}

/**
 * Verifies a 6-digit TOTP code against a Base32 secret with clock-drift tolerance and replay prevention
 * @param {string} secretBase32
 * @param {string} code
 * @param {Object} options
 * @param {number} options.window - Number of steps to check before and after (default: 1, covers ±30s)
 * @returns {{ valid: boolean, error?: string, delta?: number }}
 */
export function verifyTotpCode(secretBase32, code, options = {}) {
    if (!secretBase32) {
        return { valid: false, error: 'TOTP secret is required.' };
    }
    const cleanCode = String(code || '').trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
        return { valid: false, error: 'Verification code must be exactly 6 digits.' };
    }

    const window = typeof options.window === 'number' ? options.window : 1;
    const stepSec = 30;
    const nowMs = Date.now();
    const currentCounter = Math.floor(nowMs / 1000 / stepSec);

    // Compute hash of secret to scope anti-replay cache
    const secretHash = crypto.createHash('sha256').update(secretBase32).digest('hex').slice(0, 16);

    for (let delta = -window; delta <= window; delta++) {
        const counter = currentCounter + delta;
        const testTimeMs = counter * stepSec * 1000;
        let candidateCode;
        try {
            candidateCode = generateTotpCode(secretBase32, testTimeMs, stepSec);
        } catch (err) {
            return { valid: false, error: 'Invalid authenticator secret format.' };
        }

        if (crypto.timingSafeEqual(Buffer.from(candidateCode), Buffer.from(cleanCode))) {
            const replayKey = `${secretHash}:${counter}`;
            if (replayCache.has(replayKey)) {
                return { valid: false, error: 'This code was already used. Please wait for the next 30-second token.' };
            }
            // Mark token as consumed for 90 seconds
            replayCache.set(replayKey, nowMs + 90 * 1000);
            return { valid: true, delta };
        }
    }

    return { valid: false, error: 'Invalid authentication code. Please check your authenticator app.' };
}

/**
 * Generates single-use emergency backup recovery codes
 * @param {number} count
 * @returns {{ plainCodes: string[], hashedCodes: string[] }}
 */
export function generateBackupCodes(count = 8) {
    const plainCodes = [];
    const hashedCodes = [];

    for (let i = 0; i < count; i++) {
        const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
        const code = `CP-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
        const hashed = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
        plainCodes.push(code);
        hashedCodes.push(hashed);
    }

    return { plainCodes, hashedCodes };
}

/**
 * Verifies and consumes a single-use backup recovery code
 * @param {string} inputCode
 * @param {string[]} hashedCodes
 * @returns {{ valid: boolean, remainingCodes?: string[] }}
 */
export function verifyAndConsumeBackupCode(inputCode, hashedCodes = []) {
    if (!inputCode || !Array.isArray(hashedCodes) || hashedCodes.length === 0) {
        return { valid: false };
    }
    const cleanInput = inputCode.trim().toUpperCase();
    const inputHash = crypto.createHash('sha256').update(cleanInput).digest('hex');

    const index = hashedCodes.findIndex((storedHash) => {
        try {
            return crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(inputHash));
        } catch {
            return false;
        }
    });

    if (index === -1) {
        return { valid: false };
    }

    const remainingCodes = [...hashedCodes];
    remainingCodes.splice(index, 1);
    return { valid: true, remainingCodes };
}

// In-memory rate-limiter: key -> { attempts: number, lockedUntil: number, firstAttemptAt: number }
const rateLimitCache = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitCache.entries()) {
        if (entry.lockedUntil && entry.lockedUntil < now) {
            rateLimitCache.delete(key);
        } else if (!entry.lockedUntil && (now - entry.firstAttemptAt > 5 * 60 * 1000)) {
            rateLimitCache.delete(key);
        }
    }
}, 60 * 1000);

/**
 * Checks if an identifier or IP is rate-limited for TOTP verification
 * @param {string} key
 * @param {number} maxAttempts
 * @param {number} windowMs
 * @param {number} lockoutMs
 * @returns {{ allowed: boolean, remainingAttempts: number, retryAfterSeconds?: number }}
 */
export function checkTotpRateLimit(key, maxAttempts = 5, windowMs = 5 * 60 * 1000, lockoutMs = 5 * 60 * 1000) {
    if (!key) return { allowed: true, remainingAttempts: maxAttempts };
    const now = Date.now();
    const entry = rateLimitCache.get(key);

    if (entry) {
        if (entry.lockedUntil && entry.lockedUntil > now) {
            const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
            return { allowed: false, remainingAttempts: 0, retryAfterSeconds };
        }
        if (now - entry.firstAttemptAt > windowMs) {
            rateLimitCache.delete(key);
        }
    }
    const currentAttempts = rateLimitCache.get(key)?.attempts || 0;
    return { allowed: true, remainingAttempts: Math.max(0, maxAttempts - currentAttempts) };
}

/**
 * Records a failed TOTP attempt and applies lockout if threshold exceeded
 * @param {string} key
 * @param {number} maxAttempts
 * @param {number} lockoutMs
 * @returns {{ locked: boolean, retryAfterSeconds?: number, remainingAttempts: number }}
 */
export function recordTotpFailure(key, maxAttempts = 5, lockoutMs = 5 * 60 * 1000) {
    if (!key) return { locked: false, remainingAttempts: maxAttempts };
    const now = Date.now();
    let entry = rateLimitCache.get(key);

    if (!entry || (now - entry.firstAttemptAt > 5 * 60 * 1000 && !entry.lockedUntil)) {
        entry = { attempts: 1, firstAttemptAt: now, lockedUntil: 0 };
    } else {
        entry.attempts += 1;
    }

    if (entry.attempts >= maxAttempts) {
        entry.lockedUntil = now + lockoutMs;
        rateLimitCache.set(key, entry);
        return { locked: true, retryAfterSeconds: Math.ceil(lockoutMs / 1000), remainingAttempts: 0 };
    }

    rateLimitCache.set(key, entry);
    return { locked: false, remainingAttempts: maxAttempts - entry.attempts };
}

/**
 * Clears failed attempt counters upon successful TOTP verification
 * @param {string} key
 */
export function clearTotpRateLimit(key) {
    if (key) {
        rateLimitCache.delete(key);
    }
}
