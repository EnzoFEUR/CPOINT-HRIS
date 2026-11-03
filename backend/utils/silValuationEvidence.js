import { createHash } from 'node:crypto';
import { calculateSilDailyEquivalent, describeSilCalculation, getManilaWorkDate, isCreditUuid, isLeaveDate, sumCashAmounts } from '../../shared/leavePolicy.js';

const review = message => { throw Object.assign(new Error(message), { status: 400 }); };

export async function readSilValuationPeriods(client, employeeId, asOf = getManilaWorkDate()) {
    if (!isCreditUuid(employeeId) || !isLeaveDate(asOf) || asOf > getManilaWorkDate()) review('Choose a valid employee and conversion date.');
    const { data, error } = await client.from('payrolls').select('id,employee_id,period_start,period_end,basic_pay,status,paid_leave_in_basic,remarks')
        .eq('employee_id', employeeId).eq('status', 'Paid').eq('paid_leave_in_basic', false)
        .like('remarks', 'Factory Batch Payout (WEEKLY)%').lte('period_end', asOf)
        .order('period_end', { ascending: false }).order('id').limit(61);
    if (error) throw error;
    if (!Array.isArray(data)) review('Unable to read available payroll periods. Refresh before choosing dates.');
    const rawPeriods = data.slice(0, 60).filter(p => {
        try {
            return p.employee_id === employeeId && isCreditUuid(p.id) && p.status === 'Paid' && p.paid_leave_in_basic === false
                && /^Factory Batch Payout \(WEEKLY\)/.test(p.remarks || '') && isLeaveDate(p.period_start) && isLeaveDate(p.period_end)
                && p.period_start <= p.period_end && p.period_end <= asOf && Date.parse(p.period_end) - Date.parse(p.period_start) <= 6 * 86400000
                && sumCashAmounts([p.basic_pay]) > 0;
        } catch { return false; }
    }).map(p => ({ id: p.id, from: p.period_start, to: p.period_end }));

    // Enterprise filter: exclude older overlapping cutoffs so only valid, distinct periods are presented to HR
    const sorted = [...rawPeriods].sort((a, b) => b.to.localeCompare(a.to));
    const periods = [];
    for (const p of sorted) {
        if (!periods.some(existing => p.to >= existing.from && p.from <= existing.to)) {
            periods.push(p);
        }
    }
    return { employee_id: employeeId, as_of: asOf, periods, has_more: data.length > 60 };
}

// Arithmetic preview only; it cannot authorize a statutory conversion rate.
export async function readSilValuationEvidence(client, employeeId, from, to) {
    if (!isCreditUuid(employeeId) || !isLeaveDate(from) || !isLeaveDate(to) || from > to || to > getManilaWorkDate()
        || (Date.parse(to) - Date.parse(from)) / 86400000 > 365) review('Choose preview dates spanning up to 366 days and ending no later than today.');
    const [pay, attendance] = await Promise.all([
        client.from('payrolls').select('id,employee_id,period_start,period_end,basic_pay,status,paid_leave_in_basic,remarks')
            .eq('employee_id', employeeId).eq('status', 'Paid').lte('period_start', to).gte('period_end', from).order('period_start').order('id').limit(61),
        client.from('attendances').select('id,employee_id,date,time_in,time_out')
            .eq('employee_id', employeeId).gte('date', from).lte('date', to).order('id').limit(2001),
    ]);
    if (pay.error || attendance.error) throw pay.error || attendance.error;
    if (!Array.isArray(pay.data) || !Array.isArray(attendance.data) || pay.data.length > 60 || attendance.data.length > 2000) review('Too many or incomplete source records. HR must reconcile the evidence before calculation.');
    const payrolls = [...pay.data].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    if (!payrolls.length) review('No saved weekly factory payslips cover this period. Select a completed period or use an externally verified rate.');
    for (let index = 0; index < payrolls.length; index++) {
        const p = payrolls[index];
        if (p.employee_id !== employeeId || p.status !== 'Paid' || !/^Factory Batch Payout \(WEEKLY\)/.test(p.remarks || '') || p.paid_leave_in_basic !== false) review('These payslips do not provide separate verified weekly factory earnings. HR must review the wage evidence.');
        if (!isLeaveDate(p.period_start) || !isLeaveDate(p.period_end) || p.period_start > p.period_end || p.period_start < from || p.period_end > to
            || Date.parse(p.period_end) - Date.parse(p.period_start) > 6 * 86400000) review('Select complete weekly payroll periods; the assistant does not prorate partial weeks.');
        if (index && payrolls[index - 1].period_end >= p.period_start) review('Payroll periods overlap. Reconcile them before calculating a SIL equivalent.');
        if (!['number', 'string'].includes(typeof p.basic_pay) || String(p.basic_pay).trim() === '' || !Number.isFinite(Number(p.basic_pay)) || Number(p.basic_pay) <= 0) review('A payslip has missing or invalid production earnings. HR must reconcile it.');
    }
    const dates = new Set();
    for (const log of attendance.data) {
        if (log.employee_id !== employeeId || !isLeaveDate(log.date) || log.date < from || log.date > to) review('Attendance evidence does not match this employee and period.');
        if (!log.time_in && !log.time_out) continue;
        if (!log.time_in || !log.time_out || !Number.isFinite(Date.parse(log.time_in)) || !Number.isFinite(Date.parse(log.time_out)) || Date.parse(log.time_out) <= Date.parse(log.time_in)) review('Attendance has an incomplete or invalid punch. HR must reconcile it before using the assistant.');
        if (!payrolls.some(p => log.date >= p.period_start && log.date <= p.period_end)) review('Attendance falls outside the saved payroll periods. Select a period fully covered by payslips.');
        dates.add(log.date);
    }
    if (payrolls.some(p => ![...dates].some(date => date >= p.period_start && date <= p.period_end))) review('A payslip has no completed attendance-day evidence. Use a reviewed external rate or reconcile attendance.');
    let earnings;
    try { earnings = sumCashAmounts(payrolls.map(p => p.basic_pay)); }
    catch { review('Production earnings must use valid amounts with at most two decimal places.'); }
    const calculation = { earnings, worked_days: dates.size };
    const dailyRate = calculateSilDailyEquivalent(calculation);
    const hash = createHash('sha256').update(JSON.stringify({ employee_id: employeeId, from, to, payrolls, worked_dates: [...dates].sort() })).digest('hex');
    return { employee_id: employeeId, reference_start: from, reference_end: to, calculation, daily_rate: dailyRate,
        calculation_basis: describeSilCalculation(calculation, from, to),
        evidence_reference: `Saved factory payroll ${from} to ${to}; SHA256 ${hash}`,
        source: { kind: 'saved_weekly_factory', employee_id: employeeId, from, to, hash },
        payrolls: payrolls.map(p => ({ id: p.id, period_start: p.period_start, period_end: p.period_end, basic_pay: Number(p.basic_pay) })),
    };
}
