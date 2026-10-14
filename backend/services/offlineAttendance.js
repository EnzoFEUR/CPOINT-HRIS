import { createPublicKey, createHash, verify } from 'node:crypto';
import { canonicalEvent, validateEvent, UUID_REGEX } from '../../shared/offlineAttendance.mjs';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';

export class OfflineError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

export function offlineConfig(env = process.env) {
    if (env.OFFLINE_ATTENDANCE_ENABLED !== 'true') throw new OfflineError(503, 'Offline attendance is disabled.');
    const companyScope = env.OFFLINE_COMPANY_SCOPE?.trim();
    const sites = (env.OFFLINE_SITE_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
    const hours = Number(env.OFFLINE_ATTENDANCE_HOURS || 24);
    if (!companyScope || !/^[A-Za-z0-9_-]{1,64}$/.test(companyScope) || !sites.length || sites.some(site => !/^[A-Za-z0-9_-]{1,64}$/.test(site)) || !Number.isInteger(hours) || hours < 1 || hours > 72) {
        throw new OfflineError(503, 'Offline attendance scope, sites and lease must be configured.');
    }
    return { companyScope, sites, hours };
}

export const isOfflineManager = hasVerifiedManagerRole;

export function requireOfflineManager(user) {
    if (!isOfflineManager(user)) throw new OfflineError(403, 'Verified HR or administrator access is required.');
}

export function publicDeviceKey(jwk) {
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
        throw new OfflineError(400, 'A public P-256 JWK is required.');
    }
    try { return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' }); }
    catch { throw new OfflineError(400, 'Invalid device public key.'); }
}

export function verifyOfflineEvent({ payload, signature }, device, snapshot, config) {
    let validation;
    try { validation = validateEvent(payload); } catch { throw new OfflineError(400, 'Invalid offline event.'); }
    if (validation === false || typeof validation === 'string' || (validation && validation.valid === false)) throw new OfflineError(400, 'Invalid offline event.');
    if (payload.device_id !== device.id || payload.company_scope !== config.companyScope || payload.site_id !== device.site_id ||
        !config.sites.includes(payload.site_id) || payload.roster_snapshot_version !== snapshot.version ||
        !snapshot.employee_ids.includes(payload.employee_id)) throw new OfflineError(403, 'Event does not match the enrolled device and roster scope.');
    const captured = Date.parse(payload.captured_at);
    const anchor = Date.parse(payload.server_time_anchor);
    if (!Number.isFinite(captured) || !Number.isFinite(anchor) || anchor !== Date.parse(snapshot.generated_at) ||
        captured < anchor - 60000 || captured > Date.now() + 60000 || captured > Date.parse(snapshot.expires_at)) {
        throw new OfflineError(400, 'Event was captured outside the signed roster lease.');
    }
    if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw new OfflineError(400, 'Invalid event signature encoding.');
    const bytes = Buffer.from(signature, 'base64url');
    if (bytes.toString('base64url') !== signature) throw new OfflineError(400, 'Invalid event signature encoding.');
    const canonical = canonicalEvent(payload);
    if (bytes.length !== 64 || !verify('sha256', Buffer.from(canonical), { key: publicDeviceKey(device.public_key), dsaEncoding: 'ieee-p1363' }, bytes)) {
        throw new OfflineError(403, 'Invalid device signature.');
    }
    return createHash('sha256').update(canonical).digest('hex');
}

export function assertOfflineUuid(value) {
    if (typeof value !== 'string' || !UUID_REGEX.test(value)) throw new OfflineError(400, 'Invalid UUID.');
}

export function databaseError(error) {
    if (!error) return;
    const conflict = error.code === '23505' || ['OFFLINE_EVENT_TAMPERED', 'OFFLINE_EVENT_ALREADY_DECIDED'].some(code => error.message?.includes(code));
    const forbidden = ['OFFLINE_DEVICE_REVOKED', 'OFFLINE_SCOPE_DENIED', 'FORBIDDEN'].some(code => error.message?.includes(code));
    throw new OfflineError(conflict ? 409 : forbidden ? 403 : 503, conflict ? 'Offline event conflicts with its stored receipt.' : forbidden ? 'Offline device or scope is no longer authorized.' : 'Offline attendance storage is unavailable.');
}
