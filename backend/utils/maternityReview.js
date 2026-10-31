import { calculateMaternityAssessment, getMaternityWindows } from '../../shared/maternityAssessment.mjs';
import { getMaternityLeavePlan } from '../../shared/statutoryLeave.mjs';
import { getManilaWorkDate, scaledDecimal } from '../../shared/leavePolicy.js';
import { isDeepStrictEqual } from 'node:util';

export async function readMaternityContext(client, actorId, leaveId) {
    const { data, error } = await client.rpc('get_maternity_review_context', { p_actor_id: actorId, p_leave_id: String(leaveId) });
    if (error) throw error;
    if (!data?.leave || !data.employee || !Array.isArray(data.payroll_history)) throw Object.assign(new Error('Maternity source records could not be loaded completely.'), { status: 503 });
    return data;
}

export function maternityDraft(context) {
    const { leave, employee, source_record: saved } = context;
    let request = leave.maternity_request;
    if (!request) {
        for (const event of ['live_birth', 'solo_parent_live_birth', 'miscarriage_etp']) for (let allocated_days = 0; allocated_days <= (event === 'miscarriage_etp' ? 0 : 7); allocated_days++) {
            if (getMaternityLeavePlan(leave.start_date, event, allocated_days).end_date === leave.end_date) request = { event, allocated_days };
        }
    }
    request ||= { event: 'live_birth', allocated_days: 0 };
    const monthStart = new Date(leave.start_date); monthStart.setUTCDate(1);
    const wageMonths = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 12 + i, 1)).toISOString().slice(0, 7));
    const totals = new Map();
    for (const row of context.payroll_history) {
        if (['void','cancelled','rejected'].includes(String(row.status || '').toLowerCase())) continue;
        const month = String(row.period_end).slice(0, 7);
        totals.set(month, (totals.get(month) || 0n) + scaledDecimal(row.basic_pay || 0, 2) + scaledDecimal(row.leave_pay || 0, 2));
    }
    const salary = Number(employee.monthly_salary || employee.salary || 0), daily = Number(employee.daily_rate || 0);
    const defaults = { ...request, contingency_date: request.contingency_date || '', wage_mode: Number(employee.piece_rate) > 0 ? 'variable' : salary > 0 ? 'monthly' : 'daily',
        monthly_salary: salary > 0 ? salary : '', daily_rate: daily > 0 ? daily : '', annual_paid_days: '', regular_monthly_allowance: '', wage_reference: '',
        variable_months: wageMonths.map(month => ({ month, amount: totals.has(month) ? Number(totals.get(month)) / 100 : '' })),
        sss_mode: 'assessment', sss_history: [], sss_reference: '', sss_assessment_amount: '', sss_paid_externally: 0, differential_paid_externally: 0,
        external_reference: '', external_paid_on: '', differential_exemption: '', payable_on: getManilaWorkDate() };
    const sources = saved?.sources || defaults;
    if (!sources.sss_history?.length && sources.contingency_date) defaults.sss_history = getMaternityWindows(sources.contingency_date, leave.start_date).qualifying_months.map(month => ({ month, msc: '', paid_on: '' }));
    let calculation = null, missing = '';
    try { calculation = calculateMaternityAssessment({ ...leave, employees: employee }, sources); }
    catch (error) { if (error.status !== 400) throw error; missing = error.message; }
    const stale = saved && !isDeepStrictEqual(saved.employee_snapshot, context.employee_snapshot);
    return { revision: saved?.revision || 0, sources: saved?.sources || defaults, defaults, calculation, missing, stale: Boolean(stale), updated_at: saved?.updated_at || null,
        employee_snapshot: context.employee_snapshot, employee_pay: { daily_rate: daily || null, monthly_salary: salary || null, piece_rate: Number(employee.piece_rate) || null },
        request: { ...leave, employees: { rest_days: employee.rest_days } } };
}
