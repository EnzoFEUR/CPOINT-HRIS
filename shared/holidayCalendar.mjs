export const HOLIDAY_INPUT_TYPES = ['regular', 'special_non_working', 'special_working'];
const effectiveTypes = [...HOLIDAY_INPUT_TYPES, 'double_regular', 'double_special_non_working'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const validHolidayDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export const holidayApplies = (holiday, employeeId) => holiday?.status !== 'cancelled'
    && (holiday?.coverage !== 'selected' || Boolean(employeeId && holiday.employee_ids?.includes(String(employeeId))));

export function resolveHolidays(rows = [], employeeId = null) {
    const groups = new Map();
    const seen = new Set();
    for (const row of rows) {
        if (!holidayApplies(row, employeeId)) continue;
        if (!effectiveTypes.includes(row.type)) throw Object.assign(new Error('Holiday type needs review.'), { code: 'HOLIDAY_TYPE_INVALID', status: 409 });
        if (!validHolidayDate(row.date)) throw new Error('Invalid holiday date.');
        const key = row.id || JSON.stringify([row.date, row.name, row.type, row.source_reference]);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!groups.has(row.date)) groups.set(row.date, []);
        groups.get(row.date).push(row);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => {
        if (items.length === 1) return { ...items[0], coverage: 'all', sources: items[0].sources || items.map(source => ({ ...source })) };
        const type = items.length === 2 && items.every(item => item.type === 'regular') ? 'double_regular'
            : items.length === 2 && items.every(item => item.type === 'special_non_working') ? 'double_special_non_working' : null;
        if (!type) throw Object.assign(new Error('Holiday overlap requires payroll review before calculation.'), { code: 'HOLIDAY_OVERLAP_REVIEW_REQUIRED', status: 409 });
        return { date, name: items.map(item => item.name).join(' / '), type, sources: items, coverage: 'all' };
    });
}

export function validateHolidayCommand(input) {
    const fail = message => { throw Object.assign(new Error(message), { code: 'HOLIDAY_INVALID', status: 400 }); };
    if (!input || Array.isArray(input) || !uuid(input.operation_id) || !['create', 'update', 'cancel'].includes(input.action)) fail('Invalid holiday command.');
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500) fail('A holiday change reason of 1–500 characters is required.');
    const command = { operation_id: input.operation_id, action: input.action, reason: input.reason.trim() };
    if (input.action !== 'create') {
        if (!uuid(input.holiday_id) || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 1) fail('A valid holiday and current revision are required.');
        Object.assign(command, { holiday_id: input.holiday_id, expected_revision: input.expected_revision });
    }
    if (input.action === 'cancel') return command;
    const h = input.holiday;
    if (!h || Array.isArray(h) || !validHolidayDate(h.date) || h.date < '1990-01-01' || h.date > '2100-12-31' || !HOLIDAY_INPUT_TYPES.includes(h.type)
        || typeof h.name !== 'string' || !h.name.trim() || h.name.trim().length > 120
        || typeof h.source_reference !== 'string' || !h.source_reference.trim() || h.source_reference.trim().length > 240
        || !['all', 'selected'].includes(h.coverage)) fail('Valid holiday date, name, classification, source and coverage are required.');
    if (!Array.isArray(h.employee_ids || [])) fail('Choose valid holiday personnel coverage.');
    const employeeIds = [...new Set(h.employee_ids || [])];
    if (employeeIds.length > 500 || employeeIds.some(id => !uuid(id))
        || (h.coverage === 'selected' && !employeeIds.length) || (h.coverage === 'all' && employeeIds.length)) fail('Choose valid holiday personnel coverage.');
    if (h.source_url != null && typeof h.source_url !== 'string') fail('Invalid holiday source URL.');
    const sourceUrl = h.source_url?.trim() || '';
    if (sourceUrl) {
        let url;
        try { url = new URL(sourceUrl); } catch { fail('Invalid holiday source URL.'); }
        if (sourceUrl.length > 1000 || url.protocol !== 'https:' || url.username || url.password) fail('Holiday source URL must use HTTPS without credentials.');
    }
    command.holiday = { name: h.name.trim(), date: h.date, type: h.type, source_reference: h.source_reference.trim(), source_url: sourceUrl, coverage: h.coverage, employee_ids: employeeIds };
    return command;
}
