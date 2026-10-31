import { getStatutoryPayrollAmounts } from '../../shared/statutoryLeave.mjs';

export async function fetchStatutoryLeavePayroll(client, employeeIds, start, end) {
    if (!employeeIds.length || typeof client.rpc !== 'function') return { available: false, data: {} };
    const { data, error } = await client.rpc('preview_statutory_leave_payroll', { p_employee_ids: employeeIds, p_start: start, p_end: end });
    if (['PGRST202', '42883'].includes(error?.code)) {
        const cases = await client.from('leave_requests').select('id').in('employee_id', employeeIds).eq('status', 'Approved')
            .in('type', ['Maternity Leave', 'Paternity Leave']).limit(1);
        if (cases.error || !Array.isArray(cases.data) || cases.data.length) throw Object.assign(new Error('Install the statutory leave payroll migration before calculating existing statutory benefits.'), { status: 503 });
        return { available: false, data: {} };
    }
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('Statutory leave payments could not be verified. Refresh before posting payroll.'), { status: 503 });
    for (const id of employeeIds) {
        if (!Array.isArray(data[id]?.lines) || !Array.isArray(data[id]?.coverage)) throw Object.assign(new Error('Statutory payroll preview is incomplete.'), { status: 503 });
    }
    return { available: true, data };
}

export function statutoryPayForEmployee(preview, employeeId, options = {}) {
    const signature = preview.data[employeeId] || { lines: [], coverage: [] };
    return { available: preview.available, signature, ...getStatutoryPayrollAmounts(signature, options) };
}

export function assertStatutoryPreview(expected, statutory) {
    const hasBenefits = statutory.signature.lines.length || statutory.signature.coverage.length;
    if ((hasBenefits || expected !== undefined) && JSON.stringify(expected) !== JSON.stringify(statutory.signature)) {
        throw Object.assign(new Error('Statutory leave payments changed. Refresh the preview before saving.'), { status: 409 });
    }
}
