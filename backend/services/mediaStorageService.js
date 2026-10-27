import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { postgrestValue } from '../middleware/requestValidation.js';

export const MEDIA_URL_TTL = 120;
export const MEDIA_MAX_PATHS = 40;
export const MEDIA_MAX_PATH_LENGTH = 1024;
const ROOTS = new Set(['face-baselines', 'avatars', 'attendance']);
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const isActive = user => Boolean(user && user.is_active !== false && !user.archived_at && !user.deleted_at &&
    !['inactive', 'terminated', 'resigned', 'separated', 'suspended', 'retired', 'archived'].includes(String(user.status || '').toLowerCase()));
const isVerified = user => Boolean(user?.id && !user.deleted_at && String(user.status || '').toLowerCase() !== 'suspended' &&
    user.employee_identity_verified === true && user.role_verified === true);

export function normalizeMediaPath(value, projectUrl) {
    if (typeof value !== 'string' || !value || value.length > MEDIA_MAX_PATH_LENGTH || value !== value.trim() || /[\\\x00-\x1f\x7f#]/.test(value)) return null;
    let path = value;
    if (/^https?:\/\//i.test(value)) {
        // Inspect the original path before URL parsing can remove traversal segments.
        const match = /^(https?:\/\/[^/?#]+)(\/[^?#]*)(?:\?([^#]*))?$/i.exec(value);
        if (!match) return null;
        let url, project;
        try { url = new URL(value); project = new URL(projectUrl); } catch { return null; }
        if (url.origin !== project.origin || url.username || url.password) return null;
        const storage = /^\/storage\/v1\/object\/(public|authenticated|sign)\/public-bucket\/(.+)$/.exec(match[2]);
        if (!storage) return null;
        if (match[3] !== undefined) {
            if (storage[1] === 'sign') {
                const query = new URLSearchParams(match[3]);
                if ([...query.keys()].some(key => key !== 'token') || query.getAll('token').length !== 1 || !query.get('token')) return null;
            } else if (!/^t=\d+$/.test(match[3])) return null;
        }
        path = storage[2];
    } else if (value.includes('?') || value.startsWith('/')) return null;
    if (/%(?:2f|5c)/i.test(path)) return null;
    try { path = decodeURIComponent(path); } catch { return null; }
    if (/[\\%?#\x00-\x1f\x7f]/.test(path)) return null;
    const parts = path.split('/');
    if (!ROOTS.has(parts[0]) || parts.length < 2 || parts.some(part => !part || part === '.' || part === '..')) return null;
    return path;
}

function legacyBaselinePath(row, projectUrl) {
    if (row.biometric_baseline_path || row.has_registered_biometrics !== true || !UUID.test(row.id) || typeof row.company_id !== 'string') return null;
    return normalizeMediaPath(`face-baselines/${row.company_id}/${row.id}.jpg`, projectUrl);
}

async function readReferences(client, table, fields, conditions, employeeId) {
    const rows = [];
    // Keep PostgREST URLs bounded even when callers submit forty long keys.
    const batches = [];
    for (const condition of new Set(conditions)) {
        const batch = batches.at(-1);
        if (!batch || batch.join(',').length + condition.length > 5000) batches.push([condition]);
        else batch.push(condition);
    }
    for (const batch of batches) {
        let query = client.from(table).select(fields).or(batch.join(',')).limit(501);
        if (employeeId) query = query.eq(table === 'employees' ? 'id' : 'employee_id', employeeId);
        const { data, error } = await query;
        if (error || !Array.isArray(data) || data.length > 500) throw new Error('Media reference lookup unavailable.');
        rows.push(...data);
    }
    return rows;
}

async function readMediaReferences(client, table, fields, columns, keys, projectUrl, employeeId, extraConditions = []) {
    const origin = new URL(projectUrl).origin;
    const variants = key => [...new Set([key, key.split('/').map(encodeURIComponent).join('/')])];
    const exactConditions = keys.flatMap(key => variants(key).flatMap(path => {
        const values = [path, `${origin}/storage/v1/object/public/public-bucket/${path}`, `${origin}/storage/v1/object/authenticated/public-bucket/${path}`];
        return columns.flatMap(column => values.map(value => `${column}.eq.${postgrestValue(value)}`));
    }));
    const rows = await readReferences(client, table, fields, [...exactConditions, ...extraConditions], employeeId);
    const matched = new Set(rows.flatMap(row => columns.map(column => normalizeMediaPath(row[column], projectUrl))));
    if (table === 'employees') for (const row of rows) matched.add(legacyBaselinePath(row, projectUrl));
    // Only unresolved legacy query URLs need anchored LIKE; normal references use indexed equality.
    const legacyConditions = keys.filter(key => !matched.has(key)).flatMap(key => variants(key).flatMap(path => {
        return [['sign', 'token'], ['public', 't'], ['authenticated', 't']].flatMap(([mode, parameter]) => {
            const prefix = `${origin}/storage/v1/object/${mode}/public-bucket/${path}?${parameter}=`.replace(/[\\%_]/g, '\\$&');
            return columns.map(column => `${column}.like.${postgrestValue(`${prefix}%`)}`);
        });
    }));
    if (legacyConditions.length) rows.push(...await readReferences(client, table, fields, legacyConditions, employeeId));
    return rows;
}

export async function resolveMediaUrls(client, user, paths, projectUrl) {
    if (!isVerified(user)) return paths.map(path => ({ path, error: 'FORBIDDEN' }));
    const normalized = paths.map(path => normalizeMediaPath(path, projectUrl));
    const keys = [...new Set(normalized.filter(Boolean))];
    const allowed = new Set();
    const failures = new Map();
    const active = isActive(user);
    const operational = active && (hasVerifiedManagerRole(user) || ['security', 'guard', 'security_guard', 'hr_manager'].includes(user.role));
    try {
        const employeeKeys = keys.filter(key => !key.startsWith('attendance/'));
        if (employeeKeys.length) {
            const conditions = [];
            for (const key of employeeKeys) {
                const parts = key.split('/');
                const legacyId = parts.length === 3 && parts[0] === 'face-baselines' && parts[2].endsWith('.jpg') ? parts[2].slice(0, -4) : null;
                if (legacyId && UUID.test(legacyId)) conditions.push(`id.eq.${postgrestValue(legacyId)}`);
            }
            const rows = await readMediaReferences(client, 'employees', 'id, company_id, avatar_url, biometric_baseline_path, has_registered_biometrics', ['avatar_url', 'biometric_baseline_path'], employeeKeys, projectUrl, active ? null : user.id, conditions);
            for (const row of rows) {
                const owns = row.id === user.id;
                const avatar = normalizeMediaPath(row.avatar_url, projectUrl);
                if (avatar && ((avatar.startsWith('avatars/') && (active || owns)) || (avatar.startsWith('face-baselines/') && (owns || operational)))) allowed.add(avatar);
                if (owns || operational) {
                    const baseline = normalizeMediaPath(row.biometric_baseline_path, projectUrl);
                    if (baseline?.startsWith('face-baselines/')) allowed.add(baseline);
                    const legacy = legacyBaselinePath(row, projectUrl);
                    if (legacy) allowed.add(legacy);
                }
            }
        }
        const attendanceKeys = keys.filter(key => key.startsWith('attendance/'));
        if (attendanceKeys.length) {
            const rows = await readMediaReferences(client, 'attendances', 'employee_id, time_in_photo, time_out_photo', ['time_in_photo', 'time_out_photo'], attendanceKeys, projectUrl, operational ? null : user.id);
            for (const row of rows) if (operational || row.employee_id === user.id) {
                for (const value of [row.time_in_photo, row.time_out_photo]) {
                    const key = normalizeMediaPath(value, projectUrl);
                    if (key?.startsWith('attendance/')) allowed.add(key);
                }
            }
        }
    } catch {
        return paths.map((path, index) => ({ path, error: normalized[index] ? 'MEDIA_UNAVAILABLE' : 'INVALID_PATH' }));
    }
    const authorized = keys.filter(key => allowed.has(key));
    const signed = new Map();
    if (authorized.length) {
        const expiresAt = new Date(Date.now() + MEDIA_URL_TTL * 1000).toISOString();
        try {
            const { data, error } = await client.storage.from('public-bucket').createSignedUrls(authorized, MEDIA_URL_TTL);
            if (error || !Array.isArray(data)) throw new Error('Media signing unavailable.');
            for (const item of data) if (authorized.includes(item.path) && !item.error && typeof item.signedUrl === 'string' && item.signedUrl) {
                signed.set(item.path, { url: item.signedUrl, expires_at: expiresAt });
            }
        } catch { /* Fail closed; provider errors can contain private URLs or credentials. */ }
        for (const key of authorized) if (!signed.has(key)) failures.set(key, 'MEDIA_UNAVAILABLE');
    }
    return paths.map((path, index) => {
        const key = normalized[index];
        return { path, ...(signed.get(key) || { error: key ? failures.get(key) || 'FORBIDDEN' : 'INVALID_PATH' }) };
    });
}
