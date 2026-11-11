import { holidayApplies, resolveHolidays } from '../../shared/holidayCalendar.mjs';

export const missingHolidaySchema = error => ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code);
export async function readHolidayCalendar(client, start, end, employeeId = null) {
    const { data, error } = await client.rpc('hris_holiday_calendar_read', { p_start: start, p_end: end, p_employee_id: employeeId });
    if (!error) {
        if (!Number.isSafeInteger(Number(data?.version)) || !Array.isArray(data?.items)) throw new Error('Holiday calendar response is incomplete.');
        return { configured: true, version: Number(data.version), items: data.items };
    }
    if (!missingHolidaySchema(error)) throw error;
    // Preserve reads during deployment; management and versioned posting require the migration.
    const result = await client.from('holidays').select('*', { count: 'exact' }).gte('date', start).lte('date', end).order('date');
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.count !== result.data.length) throw new Error('Holiday calendar records are incomplete.');
    return { configured: false, version: null, items: result.data.filter(row => employeeId ? holidayApplies(row, employeeId) : row.status !== 'cancelled') };
}

export function applicableHolidays(calendar, employeeId = null) {
    return publicHolidayItems(resolveHolidays(calendar.items, employeeId));
}

export function publicHolidayItems(items) {
    return items.map(({ employee_ids: _employees, updated_by: _actor, ...item }) => ({ ...item,
        ...(item.sources ? { sources: publicHolidayItems(item.sources) } : {}) }));
}

export function assertHolidayVersion(expected, calendar) {
    if (!calendar.configured) return;
    if (!Number.isSafeInteger(expected) || expected !== calendar.version) {
        throw Object.assign(new Error('The holiday calendar changed or was not verified. Refresh the payroll preview before saving.'), { code: 'HOLIDAY_CALENDAR_CHANGED', status: 409 });
    }
}
