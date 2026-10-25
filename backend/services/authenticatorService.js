import crypto from 'node:crypto';
import { supabase } from '../supabaseClient.js';
import { generateTotpSecret, generateTotpCode, generateBackupCodes } from './totpService.js';

const unavailable = () => Object.assign(new Error('Authenticator security storage is unavailable. Use email verification or contact the administrator.'), { status: 503, code: 'AUTHENTICATOR_UNAVAILABLE' });
const invalid = message => Object.assign(new Error(message), { status: 400, code: 'AUTHENTICATOR_INVALID' });
function encryptionKey(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw unavailable();
    return Buffer.from(value, 'hex');
}
export function encryptAuthenticatorSecret(secret, userId, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(key), iv);
    cipher.setAAD(Buffer.from(userId));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptAuthenticatorSecret(value, userId, key) {
    try {
        const [version, iv, tag, data, extra] = String(value).split('.');
        if (version !== 'v1' || !iv || !tag || !data || extra !== undefined) throw unavailable();
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(key), Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw unavailable(); }
}
function matchingCounter(secret, code) {
    if (!/^\d{6}$/.test(code)) return null;
    const current = Math.floor(Date.now() / 30000);
    for (let delta = -1; delta <= 1; delta++) {
        const counter = current + delta;
        const candidate = generateTotpCode(secret, counter * 30000);
        if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(candidate))) return counter;
    }
    return null;
}

export function createAuthenticatorService(client = supabase, getKey = () => process.env.AUTHENTICATOR_ENCRYPTION_KEY) {
    async function command(userId, action, payload = {}) {
        let result;
        try { result = await client.rpc('hris_authenticator_command', { p_user_id: userId, p_action: action, p_payload: payload }).abortSignal(AbortSignal.timeout(5000)); }
        catch { throw unavailable(); }
        if (result.error) {
            if (result.error.message?.includes('AUTHENTICATOR_CONFLICT')) throw Object.assign(new Error('Authenticator settings changed. Refresh and try again.'), { status: 409, code: 'AUTHENTICATOR_CONFLICT' });
            if (result.error.message?.includes('AUTHENTICATOR_SETUP_EXPIRED')) throw invalid('Authenticator setup expired. Start setup again.');
            throw unavailable();
        }
        if (!result.data || typeof result.data !== 'object') throw unavailable();
        return result.data;
    }
    const read = userId => command(userId, 'read');
    return {
        read,
        async status(userId) {
            const row = await read(userId);
            return { enabled: Boolean(row.enabled), enabledAt: row.enabled_at || null, backupCodesRemaining: Array.isArray(row.backup_codes) ? row.backup_codes.length : 0 };
        },
        async begin(userId, email, version) {
            const setup = generateTotpSecret(email, 'C-Point HRIS');
            await command(userId, 'begin', { secret: encryptAuthenticatorSecret(setup.secret, userId, getKey()), version });
            return setup;
        },
        async enable(userId, code) {
            const row = await read(userId);
            if (!row.pending_secret || new Date(row.pending_expires_at).getTime() <= Date.now()) throw invalid('No active authenticator setup. Start setup again.');
            const counter = matchingCounter(decryptAuthenticatorSecret(row.pending_secret, userId, getKey()), String(code || '').trim());
            if (counter === null) throw invalid('Invalid authenticator confirmation code.');
            const backup = generateBackupCodes(8);
            await command(userId, 'enable', { version: row.version, counter, backup_codes: backup.hashedCodes });
            return { backupCodes: backup.plainCodes };
        },
        async verify(userId, value) {
            const row = await read(userId);
            if (!row.enabled) return { valid: false, error: 'Authenticator is not enrolled. Use email verification and enroll again.' };
            const code = String(value || '').trim().toUpperCase();
            const backup = /^CP-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code);
            const counter = backup ? null : matchingCounter(decryptAuthenticatorSecret(row.secret, userId, getKey()), code);
            return command(userId, 'consume', { version: row.version, counter,
                backup_hash: backup ? crypto.createHash('sha256').update(code).digest('hex') : null });
        },
        disable: (userId, version) => command(userId, 'disable', { version })
    };
}
export const authenticatorService = createAuthenticatorService();
