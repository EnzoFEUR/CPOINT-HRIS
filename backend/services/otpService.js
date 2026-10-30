import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

/**
 * DEPLOYMENT TOPOLOGY NOTE:
 * The backend runs as a single long-lived Node.js Express process on Render (https://cpoint-hris.onrender.com).
 * In-memory Maps provide constant-time lookup for active challenges, rate limits, and dispatch locks.
 * Note: Process restarts or redeployments will reset active in-memory challenge state and attempt counters.
 * If horizontal scaling (multi-instance) is introduced, challenge state (hashed code, attempts, resend count,
 * and timestamps) should be moved to Redis or a PostgreSQL table with TTL and atomic increments.
 */

export const isProduction = () => process.env.NODE_ENV === 'production';

export const getOtpSecret = () => {
    const secret = process.env.OTP_SECRET;
    if (!secret) {
        if (isProduction()) {
            throw new Error('FATAL: OTP_SECRET environment variable must be set in production');
        }
        return process.env.SESSION_SECRET || 'dev-cpoint-hris-otp-hmac-secret-key-32b-deterministic';
    }
    return secret;
};

// Fail immediately at startup if in production and OTP_SECRET is missing
if (isProduction() && !process.env.OTP_SECRET) {
    throw new Error('FATAL: OTP_SECRET environment variable must be set in production');
}

export const otpTestMode = (env = process.env) => ['development', 'test'].includes(env.NODE_ENV) && env.ALLOW_MOCK_OTP === 'true';
const unavailableDelivery = () => Object.assign(new Error('Verification delivery is unavailable. Please use a configured email provider.'), { status: 503, code: 'OTP_DELIVERY_UNAVAILABLE' });

// Fixed 5-minute validity window per dispatched code
export const OTP_CODE_TTL_MS = 5 * 60 * 1000;

// Absolute challenge lifetime cap: 15 minutes from initial challenge creation
export const CHALLENGE_ABSOLUTE_LIFETIME_MS = 15 * 60 * 1000;

// Cooldown duration between resends (60 seconds)
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// Maximum allowed resends per challenge session
export const OTP_MAX_RESENDS_PER_CHALLENGE = parseInt(process.env.OTP_MAX_RESENDS, 10) || 5;

// Account & IP cross-challenge limits
export const MAX_CHALLENGES_PER_15_MIN_ACCOUNT = 5;
export const MAX_CHALLENGES_PER_15_MIN_IP = 15;
export const MAX_FAILED_ATTEMPTS_PER_HOUR_ACCOUNT = 15;

/**
 * Stores:
 * challengeStore: challengeId -> ChallengeRecord
 * activeChallengeByAccount: `${purpose}:${accountId}` -> challengeId
 * cooldownStore: lockKey -> timestamp of last dispatch
 * inFlightDispatches: lockKey -> timestamp of in-flight lock
 * accountChallengeCreations: accountId -> [timestamps]
 * ipChallengeCreations: ip -> [timestamps]
 * accountFailedAttempts: accountId -> [timestamps]
 */
const challengeStore = new Map();
const activeChallengeByAccount = new Map();
const cooldownStore = new Map();
const inFlightDispatches = new Map();
const accountChallengeCreations = new Map();
const ipChallengeCreations = new Map();
const accountFailedAttempts = new Map();
const MAX_ACTIVE_CHALLENGES = 4096;

// Periodic cleanup of expired challenges and stale rate records
setInterval(() => {
    const now = Date.now();
    for (const [id, challenge] of challengeStore.entries()) {
        if (now > challenge.absoluteExpiresAt || now > challenge.expiresAt) {
            deleteChallenge(id);
        }
    }
    for (const [key, timestamp] of cooldownStore.entries()) {
        if (now - timestamp > 10 * 60 * 1000) {
            cooldownStore.delete(key);
        }
    }
    for (const [key, timestamp] of inFlightDispatches.entries()) {
        if (now - timestamp > 30 * 1000) {
            inFlightDispatches.delete(key);
        }
    }
    const oneHourAgo = now - 60 * 60 * 1000;
    for (const [key, list] of accountFailedAttempts.entries()) {
        const fresh = list.filter(t => t > oneHourAgo);
        if (fresh.length === 0) accountFailedAttempts.delete(key);
        else accountFailedAttempts.set(key, fresh);
    }
    const fifteenMinAgo = now - 15 * 60 * 1000;
    for (const [key, list] of accountChallengeCreations.entries()) {
        const fresh = list.filter(t => t > fifteenMinAgo);
        if (fresh.length === 0) accountChallengeCreations.delete(key);
        else accountChallengeCreations.set(key, fresh);
    }
    for (const [key, list] of ipChallengeCreations.entries()) {
        const fresh = list.filter(t => t > fifteenMinAgo);
        if (fresh.length === 0) ipChallengeCreations.delete(key);
        else ipChallengeCreations.set(key, fresh);
    }
}, 60 * 1000).unref();

/**
 * Generate 6-digit OTP code using CSPRNG.
 * Pad with leading zeros to guarantee a uniform 6-digit string across 1,000,000 permutations (000000 to 999999).
 */
export function generateOtpCode() {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Compute HMAC-SHA256 digest of challengeId + purpose + code.
 * Plaintext code is never persisted in storage.
 */
export function computeCodeHmac(challengeId, purpose, code) {
    const cleanCode = String(code || '').trim();
    return crypto.createHmac('sha256', getOtpSecret())
        .update(`${challengeId}:${purpose}:${cleanCode}`)
        .digest('hex');
}

function otpScope(identifiers, purpose) {
    const values = Array.isArray(identifiers) ? identifiers : [identifiers];
    const keys = [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim().toLowerCase()))];
    const purposes = ['login_2fa', 'pwd_reset', 'change_password', 'modal_stepup', 'authenticator_manage'];
    return { keys, purpose: purpose || purposes.find(value => keys.some(key => key.startsWith(value + '_'))) || 'login_2fa' };
}

const matchesScope = (record, scope) => record && record.purpose === scope.purpose && scope.keys.some(key => record.linkedKeys.includes(key));
const challengeError = (message, status = 400, code = 'INVALID_CHALLENGE') => Object.assign(new Error(message), { status, code });

function requireChallenge(id, scope) {
    const record = typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? challengeStore.get(id) : null;
    if (!record) throw challengeError('Verification challenge expired. Request a new code.', 410, 'CHALLENGE_EXPIRED');
    if (!matchesScope(record, scope)) throw challengeError('Verification challenge does not match this account and purpose.');
    return record;
}

// Check if an identifier is currently in active cooldown
export function checkOtpCooldown(identifier, cooldownMs = OTP_RESEND_COOLDOWN_MS) {
    if (!identifier) return { allowed: true, remainingSeconds: 0 };
    const key = identifier.toLowerCase().trim();

    const inFlight = inFlightDispatches.get(key);
    if (inFlight && (Date.now() - inFlight < 15 * 1000)) {
        return { allowed: false, remainingSeconds: 15, inFlight: true };
    }

    const lastSent = cooldownStore.get(key);
    if (!lastSent) return { allowed: true, remainingSeconds: 0 };

    const elapsed = Date.now() - lastSent;
    if (elapsed < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
        return { allowed: false, remainingSeconds, inFlight: false };
    }
    return { allowed: true, remainingSeconds: 0 };
}

export function recordOtpDispatch(identifier) {
    if (!identifier) return;
    const key = identifier.toLowerCase().trim();
    cooldownStore.set(key, Date.now());
}

/**
 * Atomically acquire OTP dispatch lock across multiple alias keys.
 */
export function acquireOtpLock(identifiers, cooldownMs = OTP_RESEND_COOLDOWN_MS) {
    const rawKeys = Array.isArray(identifiers) ? identifiers : [identifiers];
    const keys = rawKeys.filter(Boolean).map(id => String(id).toLowerCase().trim());
    const now = Date.now();

    for (const key of keys) {
        const inFlight = inFlightDispatches.get(key);
        if (inFlight && (now - inFlight < 15 * 1000)) {
            return {
                acquired: false,
                reason: 'in_flight',
                remainingSeconds: Math.max(1, Math.ceil((15000 - (now - inFlight)) / 1000))
            };
        }

        const lastSent = cooldownStore.get(key);
        if (lastSent && (now - lastSent < cooldownMs)) {
            const remainingSeconds = Math.ceil((cooldownMs - (now - lastSent)) / 1000);
            return {
                acquired: false,
                reason: 'cooldown',
                remainingSeconds
            };
        }
    }

    for (const key of keys) {
        inFlightDispatches.set(key, now);
        cooldownStore.set(key, now);
    }

    return { acquired: true };
}

/**
 * Release in-flight OTP dispatch lock after completion.
 */
export function releaseOtpLock(identifiers, success = true) {
    const rawKeys = Array.isArray(identifiers) ? identifiers : [identifiers];
    const keys = rawKeys.filter(Boolean).map(id => String(id).toLowerCase().trim());
    const now = Date.now();

    for (const key of keys) {
        inFlightDispatches.delete(key);
        if (success) {
            cooldownStore.set(key, now);
        } else {
            cooldownStore.delete(key);
        }
    }
}

/**
 * Account & IP Rate Limit Checks
 */
export function checkAccountChallengeCreationAllowed(accountKey, ip) {
    const now = Date.now();
    const fifteenMinAgo = now - 15 * 60 * 1000;

    if (accountKey) {
        const cleanAcc = String(accountKey).toLowerCase().trim();
        const accHistory = (accountChallengeCreations.get(cleanAcc) || []).filter(t => t > fifteenMinAgo);
        accountChallengeCreations.set(cleanAcc, accHistory);
        if (accHistory.length >= MAX_CHALLENGES_PER_15_MIN_ACCOUNT) {
            const oldest = accHistory[0];
            const retryAfter = Math.max(1, Math.ceil((oldest + 15 * 60 * 1000 - now) / 1000));
            return { allowed: false, reason: 'account_limit', retryAfter };
        }
    }

    if (ip) {
        const cleanIp = String(ip).trim();
        const ipHistory = (ipChallengeCreations.get(cleanIp) || []).filter(t => t > fifteenMinAgo);
        ipChallengeCreations.set(cleanIp, ipHistory);
        if (ipHistory.length >= MAX_CHALLENGES_PER_15_MIN_IP) {
            const oldest = ipHistory[0];
            const retryAfter = Math.max(1, Math.ceil((oldest + 15 * 60 * 1000 - now) / 1000));
            return { allowed: false, reason: 'ip_limit', retryAfter };
        }
    }

    return { allowed: true };
}

export function recordAccountChallengeCreation(accountKey, ip) {
    const now = Date.now();
    if (accountKey) {
        const cleanAcc = String(accountKey).toLowerCase().trim();
        const list = accountChallengeCreations.get(cleanAcc) || [];
        list.push(now);
        accountChallengeCreations.set(cleanAcc, list);
    }
    if (ip) {
        const cleanIp = String(ip).trim();
        const list = ipChallengeCreations.get(cleanIp) || [];
        list.push(now);
        ipChallengeCreations.set(cleanIp, list);
    }
    return now;
}

// Reserve before awaiting delivery so concurrent accounts cannot overrun an IP's budget.
export function reserveAccountChallengeCreation(accountKey, ip) {
    const limit = checkAccountChallengeCreationAllowed(accountKey, ip);
    if (!limit.allowed) throw Object.assign(new Error('Too many verification challenges requested. Please wait before requesting another code.'), { status: 429, code: 'OTP_RATE_LIMITED', retryAfter: limit.retryAfter });
    const at = recordAccountChallengeCreation(accountKey, ip);
    let released = false;
    return {
        allowed: true,
        release() {
            if (released) return;
            released = true;
            for (const [store, key] of [[accountChallengeCreations, String(accountKey || '').toLowerCase().trim()], [ipChallengeCreations, String(ip || '').trim()]]) {
                const list = store.get(key);
                const index = list?.lastIndexOf(at) ?? -1;
                if (index >= 0) list.splice(index, 1);
                if (list?.length === 0) store.delete(key);
            }
        }
    };
}

export function checkAccountFailedAttemptsExceeded(accountKey) {
    if (!accountKey) return false;
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const cleanAcc = String(accountKey).toLowerCase().trim();
    const list = (accountFailedAttempts.get(cleanAcc) || []).filter(t => t > oneHourAgo);
    accountFailedAttempts.set(cleanAcc, list);
    return list.length >= MAX_FAILED_ATTEMPTS_PER_HOUR_ACCOUNT;
}

export function recordAccountFailedAttempt(accountKey) {
    if (!accountKey) return;
    const now = Date.now();
    const cleanAcc = String(accountKey).toLowerCase().trim();
    const list = accountFailedAttempts.get(cleanAcc) || [];
    list.push(now);
    accountFailedAttempts.set(cleanAcc, list);
}

/**
 * Create a new challenge keyed by unguessable challengeId.
 * Plaintext code exists only in returned object for dispatch and is immediately hashed.
 */
export function createChallenge({ accountId, purpose = 'login_2fa', code, method = 'email', linkedKeys = [], accountExists = true, deferred = false }) {
    if (challengeStore.size >= MAX_ACTIVE_CHALLENGES) {
        for (const [id, record] of challengeStore) if (Date.now() >= Math.min(record.expiresAt, record.absoluteExpiresAt)) deleteChallenge(id);
        if (challengeStore.size >= MAX_ACTIVE_CHALLENGES) throw challengeError('Verification service is busy. Please retry shortly.', 503, 'OTP_SERVICE_BUSY');
    }
    const challengeId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const cleanCode = String(code || generateOtpCode()).trim();
    const codeHmac = computeCodeHmac(challengeId, purpose, cleanCode);

    const rawKeys = Array.isArray(linkedKeys) ? linkedKeys : [linkedKeys];
    const keys = rawKeys.filter(Boolean).map(k => String(k).toLowerCase().trim());
    if (accountId) {
        keys.push(String(accountId).toLowerCase().trim());
    }

    const record = {
        challengeId,
        accountId: accountId ? String(accountId).toLowerCase().trim() : 'anonymous',
        purpose,
        method,
        codeHmac,
        createdAt: now,
        expiresAt: now + OTP_CODE_TTL_MS,
        absoluteExpiresAt: now + CHALLENGE_ABSOLUTE_LIFETIME_MS,
        attempts: 0,
        resendCount: 0,
        accountExists: Boolean(accountExists),
        linkedKeys: Array.from(new Set(keys))
    };

    const previousAliases = record.linkedKeys.map(key => activeChallengeByAccount.get(`${purpose}:${key}`));
    let committed = false;
    const commit = () => {
        if (committed) return;
        const at = Date.now();
        if (at >= record.absoluteExpiresAt) throw challengeError('Verification challenge expired. Request a new code.', 410, 'CHALLENGE_EXPIRED');
        for (const [index, key] of record.linkedKeys.entries()) {
            const current = activeChallengeByAccount.get(`${purpose}:${key}`);
            if (current && current !== previousAliases[index] && challengeStore.has(current)) throw challengeError('Verification changed. Request a new code.', 409, 'CHALLENGE_CONFLICT');
        }
        record.expiresAt = Math.min(at + OTP_CODE_TTL_MS, record.absoluteExpiresAt);
        if (challengeStore.size >= MAX_ACTIVE_CHALLENGES) throw challengeError('Verification service is busy. Please retry shortly.', 503, 'OTP_SERVICE_BUSY');
        challengeStore.set(challengeId, record);
        for (const key of record.linkedKeys) activeChallengeByAccount.set(`${purpose}:${key}`, challengeId);
        committed = true;
    };
    if (!deferred) commit();

    return {
        challengeId,
        code: cleanCode,
        expiresIn: Math.ceil(OTP_CODE_TTL_MS / 1000),
        absoluteExpiresIn: Math.ceil(CHALLENGE_ABSOLUTE_LIFETIME_MS / 1000),
        get expiresAt() { return record.expiresAt; },
        commit
    };
}

/**
 * Retrieve active unexpired challenge or prepare a rotation / new challenge.
 * Returns commit() callback to swap in the new HMAC code only after successful transport delivery.
 */
export function getOrGenerateOtp(identifiers, options = {}) {
    const scope = otpScope(identifiers, options.purpose);
    const { keys, purpose } = scope;
    const now = Date.now();

    let existingRecord = null;
    if (options.challengeId) {
        existingRecord = requireChallenge(options.challengeId, scope);
    }
    if (!existingRecord && keys.length > 0) {
        for (const key of keys) {
            const cid = activeChallengeByAccount.get(`${purpose}:${key}`);
            if (cid) {
                const rec = challengeStore.get(cid);
                if (rec && now < rec.absoluteExpiresAt && now < rec.expiresAt) {
                    existingRecord = rec;
                    break;
                }
            }
        }
    }

    if (existingRecord) {
        if (now >= existingRecord.absoluteExpiresAt) {
            deleteChallenge(existingRecord.challengeId);
            const err = new Error('Verification challenge has expired (15-minute lifetime limit). Please start over.');
            err.status = 410;
            err.code = 'CHALLENGE_EXPIRED';
            throw err;
        }

        if (existingRecord.attempts >= 5) {
            const err = new Error('Too many incorrect attempts. This verification challenge is locked.');
            err.status = 429;
            err.code = 'TOO_MANY_ATTEMPTS';
            throw err;
        }

        const resendCount = (existingRecord.resendCount || 0) + 1;
        if (resendCount > OTP_MAX_RESENDS_PER_CHALLENGE) {
            const err = new Error(`Maximum resend limit of ${OTP_MAX_RESENDS_PER_CHALLENGE} codes reached for this session. Please wait before requesting another code.`);
            err.status = 429;
            err.code = 'RESEND_LIMIT_EXCEEDED';
            throw err;
        }

        let newCode, candidateHmac;
        do {
            newCode = generateOtpCode();
            candidateHmac = computeCodeHmac(existingRecord.challengeId, purpose, newCode);
        } while (candidateHmac === existingRecord.codeHmac);
        const previousHmac = existingRecord.codeHmac;
        let committed = false;

        return {
            challengeId: existingRecord.challengeId,
            code: newCode,
            candidateHmac,
            isExisting: false,
            isRotated: true,
            get expiresAt() { return committed ? existingRecord.expiresAt : Math.min(Date.now() + OTP_CODE_TTL_MS, existingRecord.absoluteExpiresAt); },
            get remainingSeconds() { return Math.max(0, Math.ceil(((committed ? existingRecord.expiresAt : Math.min(Date.now() + OTP_CODE_TTL_MS, existingRecord.absoluteExpiresAt)) - Date.now()) / 1000)); },
            attempts: existingRecord.attempts,
            resendCount,
            commit: () => {
                if (committed) return;
                if (challengeStore.get(existingRecord.challengeId) !== existingRecord || existingRecord.codeHmac !== previousHmac || existingRecord.attempts >= 5) {
                    throw challengeError('Verification changed. Request a new code.', 409, 'CHALLENGE_CONFLICT');
                }
                if (Date.now() >= existingRecord.absoluteExpiresAt) throw challengeError('Verification challenge expired. Request a new code.', 410, 'CHALLENGE_EXPIRED');
                existingRecord.codeHmac = candidateHmac;
                existingRecord.resendCount = resendCount;
                existingRecord.expiresAt = Math.min(Date.now() + OTP_CODE_TTL_MS, existingRecord.absoluteExpiresAt);
                committed = true;
            }
        };
    }

    // Generate new challenge
    const newCode = generateOtpCode();
    const challenge = createChallenge({
        accountId: options.accountId || (keys[0]?.startsWith(purpose + '_') ? keys[0].slice(purpose.length + 1) : keys[0]) || 'anonymous',
        purpose,
        code: newCode,
        method: options.method || 'email',
        linkedKeys: keys,
        accountExists: options.accountExists !== false,
        deferred: true
    });

    return {
        challengeId: challenge.challengeId,
        code: challenge.code,
        candidateHmac: computeCodeHmac(challenge.challengeId, purpose, challenge.code),
        isExisting: false,
        isRotated: false,
        get expiresAt() { return challenge.expiresAt; },
        remainingSeconds: Math.ceil(OTP_CODE_TTL_MS / 1000),
        attempts: 0,
        resendCount: 0,
        commit: challenge.commit
    };
}

/**
 * Store OTP in challenge store using hashed HMAC representation.
 */
export function storeOtp(identifiers, code, method = 'email', options = {}) {
    const scope = otpScope(identifiers, options.purpose);
    const { keys, purpose } = scope;
    const now = Date.now();

    let targetChallenge = null;
    if (options.challengeId) {
        targetChallenge = requireChallenge(options.challengeId, scope);
    }
    if (!targetChallenge && keys.length > 0) {
        for (const k of keys) {
            const cid = activeChallengeByAccount.get(`${purpose}:${k}`);
            if (cid && challengeStore.has(cid)) {
                targetChallenge = challengeStore.get(cid);
                break;
            }
        }
    }

    if (targetChallenge) {
        targetChallenge.codeHmac = computeCodeHmac(targetChallenge.challengeId, targetChallenge.purpose, code);
        targetChallenge.expiresAt = Math.min(options.expiresAt || (now + OTP_CODE_TTL_MS), targetChallenge.absoluteExpiresAt);
        if (options.attempts !== undefined) targetChallenge.attempts = Math.max(targetChallenge.attempts, options.attempts);
        if (options.resendCount !== undefined) targetChallenge.resendCount = Math.max(targetChallenge.resendCount, options.resendCount);
        for (const k of keys) {
            if (!targetChallenge.linkedKeys.includes(k)) targetChallenge.linkedKeys.push(k);
            activeChallengeByAccount.set(`${purpose}:${k}`, targetChallenge.challengeId);
        }
        return targetChallenge.challengeId;
    }

    const created = createChallenge({
        accountId: (keys[0]?.startsWith(purpose + '_') ? keys[0].slice(purpose.length + 1) : keys[0]) || 'anonymous',
        purpose,
        code,
        method,
        linkedKeys: keys,
        accountExists: options.accountExists !== false
    });
    const rec = challengeStore.get(created.challengeId);
    if (options.expiresAt) rec.expiresAt = Math.min(options.expiresAt, rec.absoluteExpiresAt);
    if (options.attempts !== undefined) rec.attempts = options.attempts;
    if (options.resendCount !== undefined) rec.resendCount = options.resendCount;
    return created.challengeId;
}

/**
 * Delete challenge and all linked account aliases.
 */
export function deleteChallenge(challengeId) {
    if (!challengeId) return;
    const record = challengeStore.get(challengeId);
    if (record) {
        for (const key of record.linkedKeys) {
            const scoped = `${record.purpose}:${key}`;
            if (activeChallengeByAccount.get(scoped) === challengeId) activeChallengeByAccount.delete(scoped);
        }
        challengeStore.delete(challengeId);
    }
}

export function deleteOtp(identifiers, requestedPurpose) {
    const { keys, purpose } = otpScope(identifiers, requestedPurpose);
    for (const key of keys) {
        const cid = activeChallengeByAccount.get(`${purpose}:${key}`);
        if (cid) {
            deleteChallenge(cid);
        }
    }
}

// Get active unexpired OTP status
export function getActiveOtp(identifiers, requestedPurpose) {
    const { keys, purpose } = otpScope(identifiers, requestedPurpose);
    if (keys.length === 0) return null;

    const now = Date.now();
    for (const key of keys) {
        const cid = activeChallengeByAccount.get(`${purpose}:${key}`);
        if (cid) {
            const record = challengeStore.get(cid);
            if (record && now < record.absoluteExpiresAt && now < record.expiresAt) {
                return {
                    challengeId: record.challengeId,
                    method: record.method || 'email',
                    expiresAt: record.expiresAt,
                    remainingSeconds: Math.ceil((record.expiresAt - now) / 1000),
                    attempts: record.attempts,
                    resendCount: record.resendCount
                };
            }
        }
    }
    return null;
}

/**
 * Verify OTP against memory challenge store using constant-time comparison on HMAC digests.
 */
export function verifyOtpCode(target, code, options = {}) {
    const now = Date.now();
    let challengeId = null;
    let enteredCode = null;
    let purpose = null;
    let identifiers = [];

    if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
        challengeId = target.challengeId || target.challenge_id;
        enteredCode = target.code || target.otp || code;
        purpose = target.purpose;
        if (target.identifier) identifiers.push(target.identifier);
        if (target.email) identifiers.push(target.email);
    } else {
        enteredCode = code;
        if (typeof target === 'string') {
            if (challengeStore.has(target)) {
                challengeId = target;
            } else {
                identifiers.push(target);
            }
        } else if (Array.isArray(target)) {
            identifiers = target;
        }
        challengeId = challengeId || options.challengeId || options.challenge_id;
        purpose = options.purpose;
    }

    enteredCode = String(enteredCode || '').trim();
    if (!enteredCode) {
        return { valid: false, error: 'Missing identifier or code' };
    }

    const scope = otpScope(identifiers, purpose);
    purpose = scope.purpose;
    let record = null;
    if (challengeId) {
        record = challengeStore.get(challengeId);
    } else if (identifiers.length > 0) {
        for (const id of identifiers) {
            const cleanId = String(id).toLowerCase().trim();
            const cid = activeChallengeByAccount.get(`${purpose}:${cleanId}`);
            if (cid && challengeStore.has(cid)) {
                record = challengeStore.get(cid);
                challengeId = cid;
                break;
            }
        }
    }

    if (!record) {
        return { valid: false, notFound: true, error: 'No active OTP found or code expired. Please request a new one.' };
    }

    if (!matchesScope(record, scope)) {
        return { valid: false, error: 'Invalid verification purpose or expired challenge for this account.' };
    }

    // Account-level failed attempts check across all challenges within 1 hour
    const accountKey = record.accountId;
    if (checkAccountFailedAttemptsExceeded(accountKey)) {
        return {
            valid: false,
            error: 'Too many failed verification attempts for this account. Please wait 1 hour before trying again.',
            rateLimited: true
        };
    }

    // Check 15-minute absolute lifetime cap
    if (now >= record.absoluteExpiresAt) {
        deleteChallenge(record.challengeId);
        return { valid: false, error: 'Verification challenge has expired. Please request a new one.', expired: true };
    }

    // Check fixed 5-minute per-code expiry
    if (now >= record.expiresAt) {
        deleteChallenge(record.challengeId);
        return { valid: false, error: 'Verification code has expired. Please request a new one.', expired: true };
    }

    // Check cumulative attempt budget (max 5)
    if (record.attempts >= 5) {
        deleteChallenge(record.challengeId);
        return { valid: false, error: 'Too many incorrect attempts. Please request a new code.' };
    }

    // Compute HMAC digest of entered code and compare constant-time
    const candidateHmac = computeCodeHmac(record.challengeId, record.purpose, enteredCode);
    const expectedBuf = Buffer.from(record.codeHmac, 'hex');
    const enteredBuf = Buffer.from(candidateHmac, 'hex');

    let matchesCurrent = false;
    if (expectedBuf.length === enteredBuf.length && expectedBuf.length > 0) {
        matchesCurrent = crypto.timingSafeEqual(expectedBuf, enteredBuf);
    }

    if (!matchesCurrent || !record.accountExists) {
        record.attempts++;
        recordAccountFailedAttempt(accountKey);

        const remaining = Math.max(0, 5 - record.attempts);
        if (record.attempts >= 5) {
            deleteChallenge(record.challengeId);
            return { valid: false, error: 'Too many incorrect attempts. Please request a new code.' };
        }
        return { valid: false, error: `Invalid code. ${remaining} attempts remaining.` };
    }

    // Burn token on successful verify (single-use)
    deleteChallenge(record.challengeId);
    return { valid: true };
}

// Testing helper to simulate deadline expiry
export function expireOtpForTesting(identifier, options = {}) {
    if (isProduction()) return false; if (!otpTestMode() && process.env.NODE_ENV !== 'test') return false;
    const now = Date.now();
    let record = null;
    if (challengeStore.has(identifier)) {
        record = challengeStore.get(identifier);
    } else {
        const p = otpScope([identifier], options.purpose).purpose;
        const key = String(identifier).toLowerCase().trim();
        const cid = activeChallengeByAccount.get(`${p}:${key}`);
        if (cid) record = challengeStore.get(cid);
    }
    if (record) {
        if (options.absolute) {
            record.absoluteExpiresAt = now - 1000;
        } else {
            record.expiresAt = now - 1000;
        }
        return true;
    }
    return false;
}

export function isTestDomainEmail(email) {
    if (isProduction()) return false;
    const clean = String(email || '').toLowerCase().trim();
    return /\.(?:test|example|invalid)$/.test(clean);
}

// Send OTP email through Brevo with development simulation for test domains
export async function sendEmailOtp(email, code, userName = 'Employee', context = {}) {
    const startedAt = performance.now();
    const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
    const diagnostic = {
        requestId: context.requestId || crypto.randomUUID(),
        purpose: context.purpose || 'login_2fa',
        recipientDomain: /^[a-z0-9.-]+$/.test(domain) ? domain : 'unknown'
    };
    const appBaseUrl = (process.env.APP_URL || process.env.FRONTEND_URL || 'https://cpointhris.vercel.app').replace(/\/+$/, '');
    const logoUrl = process.env.OTP_LOGO_URL || `${appBaseUrl}/logo-crop.png`;

    const safeName = String(userName ?? 'Employee').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
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
            .header { background: #1C2536; padding: 32px 24px 28px; text-align: center; }
            .header a { text-decoration: none; display: inline-block; }
            .header img { display: block; margin: 0 auto; width: 175px; max-width: 100%; height: auto; border: 0; }
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
                .header { padding: 24px 20px 22px; }
                .header img { width: 150px !important; }
                .content { padding: 32px 24px 28px; }
                .code { font-size: 25px; letter-spacing: 3px; padding: 14px 18px; }
            }
        </style>
    </head>
    <body>

        <div class="canvas">
            <div class="card">
                <div class="header">
                    <a href="${appBaseUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;">
                        <img 
                            src="${logoUrl}" 
                            alt="C-Point HRIS" 
                            width="175" 
                            height="60" 
                            border="0"
                            style="display:block;margin:0 auto;width:175px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;color:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:0.5px;"
                        />
                    </a>
                </div>
                <div class="content">
                    <p class="heading">Verify it's you</p>
                    <p class="lede">Hi <strong>${safeName}</strong>, enter this code to finish signing in.</p>
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

    const normalizedEmail = (email || '').trim().toLowerCase();

    // In production, synthetic simulation is strictly forbidden.
    if (!isProduction() && otpTestMode() && isTestDomainEmail(normalizedEmail)) {
        console.info('[OTP_EMAIL_SIMULATED]', { ...diagnostic, status: 'simulated', providerCalled: false });
        return { success: true, simulated: true, code };
    }

    // Primary dispatcher: Brevo REST API v3
    if (process.env.BREVO_API_KEY) {
        console.info('[OTP_EMAIL_STARTED]', { ...diagnostic, provider: 'brevo' });
        try {
            const senderEmail = process.env.BREVO_SENDER_EMAIL || 'marikinahris2026@gmail.com';
            const senderName = process.env.BREVO_SENDER_NAME || 'C-Point HRIS Security';

            const res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                signal: AbortSignal.timeout(10000),
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    sender: { name: senderName, email: senderEmail },
                    to: [{ email: normalizedEmail, name: userName }],
                    subject: `${code} is your C-Point HRIS Verification Code`,
                    htmlContent: htmlContent,
                    textContent: `Your C-Point HRIS verification code is ${code}. It expires in 5 minutes. Never share this code with anyone.`
                })
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok && typeof data?.messageId === 'string' && data.messageId.trim()) {
                console.info('[OTP_BREVO_SUCCESS]', { ...diagnostic, status: 'accepted_by_provider', httpStatus: res.status,
                    messageId: data.messageId, durationMs: Math.round(performance.now() - startedAt) });
                return { success: true, provider: 'brevo', messageId: data.messageId };
            }
            const reason = res.ok ? 'missing_message_id'
                : res.status === 429 ? 'rate_limited'
                : [401, 403].includes(res.status) ? 'provider_auth_rejected'
                : data?.code === 'not_enough_credits' ? 'credits_exhausted'
                : res.status >= 500 ? 'provider_unavailable' : 'provider_rejected';
            const knownCodes = ['invalid_parameter', 'missing_parameter', 'unauthorized', 'permission_denied', 'not_enough_credits', 'too_many_requests', 'bad_request'];
            console.warn('[OTP_BREVO_ERROR]', { ...diagnostic, status: 'failed', reason, httpStatus: res.status,
                providerCode: knownCodes.includes(data?.code) ? data.code : 'unknown',
                durationMs: Math.round(performance.now() - startedAt) });
            throw unavailableDelivery();
        } catch (error) {
            if (error?.code !== 'OTP_DELIVERY_UNAVAILABLE') {
                const reason = error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'aborted' : 'network_error';
                console.warn('[OTP_BREVO_ERROR]', { ...diagnostic, status: 'failed', reason,
                    durationMs: Math.round(performance.now() - startedAt) });
            }
            throw unavailableDelivery();
        }
    }

    console.warn('[OTP_BREVO_ERROR]', { ...diagnostic, status: 'failed', reason: 'not_configured', providerCalled: false });
    throw unavailableDelivery();
}

// Send OTP via SMS (Decommissioned - SMS Gateway Removed)
export async function sendSmsOtp(phoneNumber, code) {
    if (!otpTestMode() || isProduction()) throw unavailableDelivery();
    console.info('[OTP_SMS_SIMULATED] Explicit development simulation is enabled; no SMS was sent.');
    return { success: true, simulated: true, code };
}
