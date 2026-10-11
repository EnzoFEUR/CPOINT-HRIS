export async function fetchPayrollAttendance(client, employeeIds, startDate, endDate) {
    const logs = [];
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from('attendances').select('*')
            .in('employee_id', employeeIds).gte('date', startDate).lte('date', endDate)
            .order('id', { ascending: true }).range(offset, offset + 999);
        if (error) throw new Error(`Cannot calculate payroll attendance: ${error.message}`);
        if (!Array.isArray(data)) throw new Error('Cannot calculate payroll attendance: invalid database response.');
        logs.push(...data);
        if (data.length < 1000) return logs;
    }
}
