export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function canUseAttendanceTerminal(user) {
    const role = String(user?.role || '').trim().toLowerCase().replace(/[\s_-]/g, '');
    return Boolean(user?.id && ['admin', 'security', 'guard', 'securityguard'].includes(role) && user.is_active !== false && !user.archived_at && !['inactive', 'suspended', 'terminated', 'resigned', 'separated'].includes(String(user.status || '').toLowerCase()));
}
export const EVENT_FIELDS = Object.freeze(['event_id', 'device_id', 'employee_id', 'company_scope', 'site_id', 'action', 'captured_at', 'capture_timezone', 'captured_local_offset_minutes', 'server_time_anchor', 'local_sequence', 'roster_snapshot_version', 'event_schema_version', 'capture_method']);

export function validateEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(key => !EVENT_FIELDS.includes(key)) || EVENT_FIELDS.some(key => !(key in event))) throw new Error('Invalid event fields.');
    for (const key of ['event_id', 'device_id', 'employee_id', 'roster_snapshot_version']) if (typeof event[key] !== 'string' || !UUID_REGEX.test(event[key])) throw new Error(`Invalid ${key}.`);
    for (const key of ['company_scope', 'site_id']) if (typeof event[key] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(event[key])) throw new Error(`Invalid ${key}.`);
    if (!['TIME_IN', 'TIME_OUT'].includes(event.action) || event.capture_method !== 'offline_badge' || event.event_schema_version !== 1) throw new Error('Unsupported capture contract.');
    for (const key of ['captured_at', 'server_time_anchor']) {
        if (typeof event[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event[key]) || !Number.isFinite(Date.parse(event[key])) || new Date(event[key]).toISOString() !== event[key]) throw new Error(`Invalid ${key}.`);
    }
    if (!Number.isSafeInteger(event.local_sequence) || event.local_sequence < 1 || !Number.isInteger(event.captured_local_offset_minutes) || Math.abs(event.captured_local_offset_minutes) > 840) throw new Error('Invalid sequence or clock offset.');
    if (typeof event.capture_timezone !== 'string' || event.capture_timezone.length > 80) throw new Error('Invalid time zone.');
    try { new Intl.DateTimeFormat('en', { timeZone: event.capture_timezone }); } catch { throw new Error('Invalid time zone.'); }
    return event;
}

export function canonicalEvent(event) {
    validateEvent(event);
    return JSON.stringify(Object.fromEntries(EVENT_FIELDS.map(key => [key, event[key]])));
}
