import { isLeaveDate } from './leaveCredits.mjs';
import { getManilaWorkDate } from './workPolicy.mjs';

export function hasRegisteredFace(employee) {
    return employee?.has_registered_biometrics === true ||
        (typeof employee?.biometric_baseline_path === 'string' && employee.biometric_baseline_path.trim().length > 0);
}

export function getActiveMedicalGrace(employee, time = new Date()) {
    if (!hasRegisteredFace(employee)) return null;
    let record = employee?.medical_record_url;
    try { if (typeof record === 'string') record = JSON.parse(record); } catch { return null; }
    if (!record || Array.isArray(record) || record.exempt !== true || record.revoked_at) return null;
    const now = new Date(time);
    if (!Number.isFinite(now.getTime())) return null;
    const expiry = record.valid_until ?? record.expires_at;
    let validUntil;
    if (isLeaveDate(expiry)) {
        if (expiry < getManilaWorkDate(now)) return null;
        validUntil = expiry;
    } else {
        if (typeof expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(expiry) || !isLeaveDate(expiry.slice(0, 10)) || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now.getTime()) return null;
        validUntil = getManilaWorkDate(expiry);
    }
    return { ...record, valid_until: validUntil };
}

export function medicalGraceDaysRemaining(grace, time = new Date()) {
    if (!isLeaveDate(grace?.valid_until)) return null;
    const today = getManilaWorkDate(time);
    return Math.max(0, Math.round((Date.parse(grace.valid_until + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000));
}
