import crypto from 'node:crypto';
import { supabase } from '../supabaseClient.js';
import { generateTotpSecret, generateTotpCode, generateBackupCodes } from './totpService.js';
import { isAuthenticatorBackupCode, normalizeAuthenticatorCode } from '../../shared/authenticatorPolicy.mjs';

const unavailable = (reason = 'storage', action, databaseCode) => Object.assign(new Error('Authenticator security storage is unavailable. Use email verification or contact the administrator.'), {
    status: 503, code: 'AUTHENTICATOR_UNAVAILABLE', diagnostic: { reason, action, databaseCode: /^[A-Z0-9_]{1,40}$/.test(databaseCode || '') ? databaseCode : undefined }
});
const invalid = (message, code = 'AUTHENTICATOR_INVALID', status = 400) => Object.assign(new Error(message), { status, code });
const upgradeRequired = () => Object.assign(new Error('Authenticator setup requires a server update. Use email verification or contact the administrator.'), { status: 503, code: 'AUTHENTICATOR_UPGRADE_REQUIRED', diagnostic: { reason: 'migration_required' } });
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function requireAccepted(result) {
    if (result.valid === false) throw Object.assign(invalid(result.error || 'Authenticator confirmation failed.', result.code, result.retryAfterSeconds ? 429 : 400), { retryAfterSeconds: result.retryAfterSeconds || 0 });
}
function encryptionKey(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw unavailable('encryption_configuration');
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
        if (version !== 'v1' || !iv || !tag || !data || extra !== undefined) throw unavailable('encrypted_record');
        const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(key), Buffer.from(iv, 'base64url'));
        decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch (error) { throw error.code === 'AUTHENTICATOR_UNAVAILABLE' ? error : unavailable('decryption'); }
}
function matchingCounter(secret, code) {
    code = normalizeAuthenticatorCode(code);
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
        const signal = AbortSignal.timeout(5000);
        try { result = await client.rpc('hris_authenticator_command', { p_user_id: userId, p_action: action, p_payload: { ...payload, protocol: 2 } }).abortSignal(signal); }
        catch { throw unavailable(signal.aborted ? 'timeout' : 'transport', action); }
        if (result.error) {
            if (['prepare', 'activate'].includes(action) && result.error.message?.includes('AUTHENTICATOR_INVALID_COMMAND')) throw upgradeRequired();
            if (result.error.message?.includes('AUTHENTICATOR_SETUP_CHANGED')) throw invalid('Authenticator setup changed. Open the current setup and use its QR code.', 'AUTHENTICATOR_SETUP_CHANGED', 409);
            if (result.error.message?.includes('AUTHENTICATOR_CONFLICT')) throw Object.assign(new Error('Authenticator settings changed. Refresh and try again.'), { status: 409, code: 'AUTHENTICATOR_CONFLICT' });
            if (result.error.message?.includes('AUTHENTICATOR_SETUP_EXPIRED')) throw invalid('Authenticator setup expired. Start setup again.');
            const reason = signal.aborted ? 'timeout' : result.error.code === '42501' ? 'storage_permissions' : ['PGRST202', '42883', '42P01'].includes(result.error.code) ? 'storage_schema' : 'storage';
            throw unavailable(reason, action, result.error.code);
        }
        if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw unavailable('invalid_response', action);
        return result.data;
    }
    const read = userId => command(userId, 'read');
    return {
        read,
        async status(userId) {
            const row = await read(userId);
            return { enabled: Boolean(row.enabled), enabledAt: row.enabled_at || null, backupCodesRemaining: Array.isArray(row.backup_codes) ? row.backup_codes.length : 0 };
        },
        async begin(userId, email, version, restart = false) {
            if (typeof restart !== 'boolean') throw invalid('Invalid authenticator restart request.');
            const setup = generateTotpSecret(email, 'C-Point HRIS');
            const result = await command(userId, 'prepare', { secret: encryptAuthenticatorSecret(setup.secret, userId, getKey()), version, restart });
            requireAccepted(result);
            if (result.protocol_version !== 2 || !uuid.test(result.pending_setup_id || '') || !Number.isSafeInteger(result.version) || !Number.isFinite(Date.parse(result.pending_expires_at)) || !Number.isFinite(Date.parse(result.server_time))) throw unavailable('invalid_response', 'prepare');
            const secret = decryptAuthenticatorSecret(result.pending_secret, userId, getKey());
            const uri = new URL(setup.uri); uri.searchParams.set('secret', secret);
            return { ...setup, secret, uri: uri.toString(), setupId: result.pending_setup_id, version: result.version, expiresAt: result.pending_expires_at, serverTime: result.server_time, resumed: Boolean(result.resumed) };
        },
        async enable(userId, code, setup = {}) {
            if (!uuid.test(setup.setupId || '') || !Number.isSafeInteger(setup.version) || setup.version < 1) throw invalid('Open authenticator setup again before confirming.', 'AUTHENTICATOR_SETUP_CHANGED', 409);
            const row = await read(userId);
            if (row.protocol_version !== 2) throw upgradeRequired();
            if (!row.pending_secret) throw invalid('No active authenticator setup. Start setup again.', 'AUTHENTICATOR_SETUP_EXPIRED');
            if (row.pending_setup_id !== setup.setupId || row.version !== setup.version) throw invalid('Authenticator setup changed. Open the current setup and use its QR code.', 'AUTHENTICATOR_SETUP_CHANGED', 409);
            const counter = matchingCounter(decryptAuthenticatorSecret(row.pending_secret, userId, getKey()), String(code || '').trim());
            const backup = generateBackupCodes(8);
            const result = await command(userId, 'activate', { version: row.version, setup_id: setup.setupId, counter, backup_codes: backup.hashedCodes });
            requireAccepted(result);
            if (result.enabled !== true) throw unavailable('invalid_response', 'activate');
            return { backupCodes: backup.plainCodes };
        },
        async verify(userId, value) {
            const row = await read(userId);
            if (!row.enabled) return { valid: false, error: 'Authenticator is not enrolled. Use email verification and enroll again.' };
            const code = normalizeAuthenticatorCode(value);
            const backup = isAuthenticatorBackupCode(code);
            const counter = backup ? null : matchingCounter(decryptAuthenticatorSecret(row.secret, userId, getKey()), code);
            const result = await command(userId, 'consume', { version: row.version, counter,
                backup_hash: backup ? crypto.createHash('sha256').update(code).digest('hex') : null });
            if (!result.valid && !backup && !result.retryAfterSeconds) {
                return {
                    ...result,
                    code: counter === null ? 'AUTHENTICATOR_CODE_MISMATCH' : 'AUTHENTICATOR_CODE_REJECTED',
                    error: counter === null
                        ? 'This code does not match your active authenticator. Check the C-Point HRIS account entry and your phone\'s automatic date and time.'
                        : 'This code expired or was already used. Wait for a new authenticator code and submit it once.'
                };
            }
            return result;
        },
        disable: (userId, version) => command(userId, 'disable', { version })
    };
}
export const authenticatorService = createAuthenticatorService();
