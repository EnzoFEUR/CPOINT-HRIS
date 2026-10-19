export async function getOfflinePayrollVersions(client, employeeIds) {
    const ids = [...new Set(employeeIds)];
    if (!ids.length) return new Map();
    const { data, error } = await client.from('offline_attendance_versions').select('employee_id,version').in('employee_id', ids);
    // Older schemas cannot approve offline punches, so they have no approval revision to validate.
    if (error && ['42P01', 'PGRST205'].includes(error.code)) return new Map();
    if (error) throw Object.assign(new Error('Unable to verify offline attendance before calculating payroll.'), { status: 503 });
    const versions = new Map(ids.map(id => [String(id), 0]));
    for (const row of data || []) {
        const value = Number(row.version);
        if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error('Invalid attendance revision. Payroll was not posted.'), { status: 503 });
        versions.set(String(row.employee_id), value);
    }
    return versions;
}
