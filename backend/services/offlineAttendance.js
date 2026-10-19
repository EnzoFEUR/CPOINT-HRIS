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
    if (error.code === '23503' && error.message?.includes('offline_attendance_events_employee_id_fkey')) {
        throw Object.assign(new OfflineError(409, 'The employee record for this saved capture no longer exists. The capture is retained for HR recovery; it cannot be assigned to another employee automatically.'), { database_code: '23503', reason_code: 'OFFLINE_EMPLOYEE_NOT_FOUND', constraint: 'offline_attendance_events_employee_id_fkey' });
    }
    const approvalErrors = {
        OFFLINE_CORRECTION_INVALID_TIME: 'Enter the verified departure time after Time In, within 18 hours, and not in the future.',
        OFFLINE_CORRECTION_CONFLICT: 'A departure punch, another shift or a previous correction conflicts with this request. Refresh and review the existing evidence.',
        OFFLINE_CORRECTION_ALREADY_RECORDED: 'This capture already has a different verified Time Out. Its correction history cannot be overwritten.',
        OFFLINE_PAIR_INCOMPLETE: 'A complete, unambiguous Time In and Time Out is required. Missing punches remain available for HR verification.',
        OFFLINE_PAYROLL_ALREADY_SAVED: 'A saved payslip covers this attendance date. Use the authorized payroll adjustment process.',
        OFFLINE_ATTENDANCE_CONFLICT: 'Attendance already exists or conflicts with this capture. HR must reconcile it.',
        OFFLINE_APPROVED_PUNCH_LOCKED: 'This punch was approved from offline evidence. Use an auditable correction rather than overwriting it.',
        OFFLINE_OPEN_SHIFT_CONFLICT: 'An earlier shift is still open. Reconcile it before approving another time in.',
        OFFLINE_CLOCK_OUT_NEEDS_TIME_IN: 'Approve the matching earlier time in first. This time out needs exactly one open shift within 18 hours.',
        OFFLINE_APPROVED_LEAVE_CONFLICT: 'Approved leave covers this date. Reconcile the leave before changing attendance.',
        OFFLINE_SELF_APPROVAL_DENIED: 'You cannot approve your own attendance.',
        OFFLINE_EMPLOYEE_INELIGIBLE: 'HR must review the employee’s current eligibility before approving attendance.',
        OFFLINE_EMPLOYEE_NOT_FOUND: 'The original employee record no longer exists. Keep this capture for HR recovery.',
        OFFLINE_CLOCK_REVIEW_REQUIRED: 'The captured time needs HR verification before approval.',
        OFFLINE_POLICY_INVALID: 'The work schedule needs HR review before attendance can be approved.',
    };
    if (approvalErrors[error.message]) throw Object.assign(new OfflineError(error.message === 'OFFLINE_SELF_APPROVAL_DENIED' ? 403 : 409, approvalErrors[error.message]), { reason_code: error.message, database_code: error.code });
    const conflict = error.code === '23505' || ['OFFLINE_EVENT_TAMPERED', 'OFFLINE_EVENT_ALREADY_DECIDED'].some(code => error.message?.includes(code));
    const forbidden = ['OFFLINE_DEVICE_REVOKED', 'OFFLINE_SCOPE_DENIED', 'FORBIDDEN'].some(code => error.message?.includes(code));
    const safeCode = typeof error.code === 'string' && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(error.code) ? error.code : undefined;
    const reason = error.message?.match(/\b(OFFLINE_[A-Z_]{1,80})\b/)?.[1];
    const constraint = error.message?.match(/constraint "(offline_attendance_[a-z0-9_]{1,100})"/)?.[1];
    // PostgreSQL details can contain full employee rows; retain identifiers only.
    throw Object.assign(new OfflineError(conflict ? 409 : forbidden ? 403 : 503, conflict ? 'Offline event conflicts with its stored receipt.' : forbidden ? 'Offline device or scope is no longer authorized.' : 'Offline attendance storage is unavailable.'), { database_code: safeCode, reason_code: reason, constraint });
}
