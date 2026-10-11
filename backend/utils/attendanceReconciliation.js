import { supabase } from '../supabaseClient.js';
import { getWorkPolicy, getManilaWorkDate } from '../../shared/workPolicy.mjs';
import { getAttendanceMonthRange, reconcileMonthlyAttendance } from '../../shared/monthlyAttendance.mjs';

export { formatManilaTime } from '../../shared/monthlyAttendance.mjs';
export const getManilaDateString = getManilaWorkDate;
const WORK_POLICY = getWorkPolicy(process.env);

export async function getEmployeeMonthlyAttendance({ employeeId, month }) {
    if (!employeeId) throw new Error('Valid employeeId is required.');
    const targetMonth = month || getManilaWorkDate().slice(0, 7);
    const { startDate, endDate } = getAttendanceMonthRange(targetMonth);

    // Resolve employee by UUID or Company ID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId).trim());
    let empQuery = supabase
        .from('employees')
        .select('*');
    if (isUUID) {
        empQuery = empQuery.eq('id', employeeId);
    } else {
        empQuery = empQuery.ilike('company_id', String(employeeId).trim().replace(/[\\%_]/g, '\\$&'));
    }
    const { data: employee, error: empErr } = await empQuery.maybeSingle();
    if (empErr) throw new Error(`Database error fetching employee: ${empErr.message}`);
    if (!employee) throw new Error(`Employee with ID or Company ID "${employeeId}" not found.`);

    const resolvedEmployeeId = employee.id;

    // Parallel batch query for attendance, leaves, and holidays
    const [attRes, leavesRes, holidaysRes] = await Promise.all([
        supabase
            .from('attendances')
            .select('*', { count: 'exact' })
            .eq('employee_id', resolvedEmployeeId)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('time_in', { ascending: true }),
        supabase
            .from('leave_requests')
            .select('*', { count: 'exact' })
            .eq('employee_id', resolvedEmployeeId)
            .eq('status', 'Approved')
            .lte('start_date', endDate)
            .gte('end_date', startDate),
        supabase
            .from('holidays')
            .select('id, date, name, type', { count: 'exact' })
            .gte('date', startDate)
            .lte('date', endDate)
    ]);

    if (attRes.error) throw new Error(`Database error fetching attendances: ${attRes.error.message}`);
    if (leavesRes.error) throw new Error(`Database error fetching leaves: ${leavesRes.error.message}`);
    if (holidaysRes.error) throw new Error(`Database error fetching holidays: ${holidaysRes.error.message}`);

    for (const result of [attRes, leavesRes, holidaysRes]) {
        if (!Array.isArray(result.data) || result.count !== result.data.length) throw new Error('Monthly attendance records are incomplete. Retry after HR reconciles the data.');
    }
    return reconcileMonthlyAttendance({
        employee, month: targetMonth, workPolicy: WORK_POLICY,
        attendances: attRes.data, leaves: leavesRes.data, holidays: holidaysRes.data,
    });
}
