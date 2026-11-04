import { isLeaveDate } from '../../shared/leaveCredits.mjs';
import { getManilaWorkDate, sumCashAmounts } from '../../shared/leavePolicy.js';

const unavailable = () => Object.assign(new Error('Wage evidence could not refresh. Retry or use independently reviewed wage records.'), {
    status: 503, code: 'RETIREMENT_EVIDENCE_UNAVAILABLE',
});
const validRate = value => ['number', 'string'].includes(typeof value) && /^\d+(\.\d{1,2})?$/.test(String(value)) && Number(value) > 0 && Number(value) <= 1000000;

function evidencePeriod(date) {
    const [year, month, day] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return {
        from: `${year - 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`,
        to: new Date(Date.UTC(year, month - 1, day) - 86400000).toISOString().slice(0, 10),
    };
}

async function sourceRows(query) {
    const rows = [];
    // Bound malformed/duplicated histories without silently averaging a truncated response.
    for (let offset = 0; offset <= 2000; offset += 500) {
        const { data, error } = await query.range(offset, offset + 499).abortSignal(AbortSignal.timeout(10000));
        if (error || !Array.isArray(data)) throw unavailable();
        rows.push(...data);
        if (rows.length > 2000) return { rows: rows.slice(0, 2000), truncated: true };
        if (data.length < 500) return { rows, truncated: false };
    }
    return { rows, truncated: true };
}

export async function readRetirementWageEvidence(client, employee, retirementDate) {
    const period = evidencePeriod(retirementDate);
    const title = String(employee.job_title || '').toLowerCase();
    const department = String(employee.department || '').toLowerCase();
    const role = String(employee.role || '').toLowerCase();
    const dailyRecorded = validRate(employee.daily_rate);
    const hourlyRecorded = validRate(employee.hourly_rate);
    const pieceRate = /cutter|cutting|marking|marka|areglo|sapatero|swela|lapat|alamoda|tahi|stitching|finish|qa|packing|sew|stitch|shoe|shoemaker/.test(title) ||
        (department.includes('factory') && !dailyRecorded);
    const salaried = !pieceRate && (['admin', 'hr'].includes(role) ||
        /admin|hr|finance|accounting|information technology|\bit\b|executive|management|office|supervisor|clerk/.test(department) ||
        /admin|manager|supervisor|clerk|executive|analyst|developer|accountant|officer/.test(title) || (!dailyRecorded && !department.includes('factory')));
    const result = {
        success: true, employee_id: employee.id, company_id: employee.company_id, retirement_date: retirementDate,
        full_name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
        job_title: employee.job_title || '', department: employee.department || '', role: employee.role || 'employee',
        detected_basis: pieceRate ? 'piece_rate' : salaried ? 'monthly_equivalent' : 'daily',
        detected_label: pieceRate ? 'Factory paid-by-results wage review' : salaried ? 'Salaried wage-basis review' : 'Daily wage-basis review',
        recommended_daily_rate: '', recommended_earnings_12_months: '', recommended_actual_workdays: '',
        rate_note: '', signals: [], source_issues: [], payroll_records_found: 0,
        total_12mo_earnings_recorded: 0, workdays_recorded: 0, period_start: period.from, period_end: period.to,
    };
    if (!pieceRate) {
        if (dailyRecorded) {
            result.recommended_daily_rate = Number(employee.daily_rate).toFixed(2);
            result.rate_note = `Recorded basic daily rate PHP ${result.recommended_daily_rate}. HR must verify the applicable wage basis and supporting record for the retirement date.`;
        } else if (hourlyRecorded && Number(employee.hourly_rate) * 8 <= 1000000) {
            result.recommended_daily_rate = (Number(employee.hourly_rate) * 8).toFixed(2);
            result.rate_note = `Proposed daily equivalent PHP ${result.recommended_daily_rate} from the recorded hourly rate using 8 hours. HR must verify the actual normal workday and supporting wage record.`;
        } else result.source_issues.push('No usable daily or hourly wage is recorded. Enter a reviewed wage basis.');
        return result;
    }

    const [pay, attendance] = await Promise.all([
        sourceRows(client.from('payrolls').select('id,employee_id,basic_pay,period_start,period_end,status')
            .eq('employee_id', employee.id).eq('status', 'Paid').gte('period_end', period.from).lte('period_start', period.to)
            .order('period_start').order('id')),
        sourceRows(client.from('attendances').select('id,employee_id,date,status,time_in,time_out')
            .eq('employee_id', employee.id).gte('date', period.from).lte('date', period.to).order('date').order('id')),
    ]);
    const issues = new Set();
    const payrolls = [...pay.rows].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    if (pay.truncated || attendance.truncated) issues.add('The source history exceeds the automatic review limit. Reconcile the complete records before calculating.');
    if (!payrolls.length) issues.add('No finalized Paid payroll covers this evidence window. Pending payroll is not used.');
    if (period.to > getManilaWorkDate()) issues.add('The twelve-month evidence window has not ended. Review the wage basis again before final approval.');
    let validEarnings = true;
    for (let index = 0; index < payrolls.length; index++) {
        const row = payrolls[index];
        if (row.employee_id !== employee.id || row.status !== 'Paid' || !isLeaveDate(row.period_start) || !isLeaveDate(row.period_end) ||
            row.period_start > row.period_end || row.period_start < period.from || row.period_end > period.to) {
            issues.add('A payroll crosses the evidence boundary or has inconsistent ownership/dates. Review the complete earnings; partial periods are not prorated.');
        }
        if (index && payrolls[index - 1].period_end >= row.period_start) issues.add('Paid payroll periods overlap. Reconcile duplicate earnings before using a daily equivalent.');
        try { sumCashAmounts([row.basic_pay]); } catch { validEarnings = false; }
    }
    if (!validEarnings) issues.add('A Paid payroll has missing or invalid basic earnings. Reconcile it before calculating.');
    const earnings = validEarnings ? sumCashAmounts(payrolls.map(row => row.basic_pay)) : 0;
    if (!(earnings > 0 && earnings <= 1000000000)) issues.add('Positive basic earnings within the supported range must be documented.');
    const days = new Set();
    const workedStatuses = new Set(['present', 'late', 'half day', 'overtime']);
    for (const log of attendance.rows) {
        if (log.employee_id !== employee.id || !isLeaveDate(log.date) || log.date < period.from || log.date > period.to) {
            issues.add('Attendance evidence does not match the employee and evidence dates.'); continue;
        }
        const worked = workedStatuses.has(String(log.status || '').trim().toLowerCase().replace(/[_-]+/g, ' '));
        if (!worked && !log.time_in && !log.time_out) continue;
        if (!worked || !log.time_in || !log.time_out || !Number.isFinite(Date.parse(log.time_in)) || !Number.isFinite(Date.parse(log.time_out)) || Date.parse(log.time_out) <= Date.parse(log.time_in)) {
            issues.add('Attendance has an incomplete punch or conflicting status. Reconcile it before using the recorded workdays.'); continue;
        }
        days.add(log.date);
        if (!payrolls.some(row => log.date >= row.period_start && log.date <= row.period_end)) issues.add('Worked days are not fully covered by finalized payroll. Complete or reconcile the missing payroll evidence.');
    }
    if (!days.size) issues.add('No completed worked-day evidence is available. A standard divisor is not substituted.');
    if (payrolls.some(row => ![...days].some(date => date >= row.period_start && date <= row.period_end))) issues.add('A Paid payroll period has no matching completed worked days. Review the attendance evidence.');
    result.payroll_records_found = payrolls.length;
    result.total_12mo_earnings_recorded = earnings;
    result.workdays_recorded = days.size;
    result.source_issues = [...issues];
    result.signals = [`Evidence window: ${period.from} to ${period.to}`, `${payrolls.length} Paid payroll period(s); ${days.size} distinct completed worked day(s)`];
    if (!issues.size) {
        result.recommended_earnings_12_months = earnings.toFixed(2);
        result.recommended_actual_workdays = String(days.size);
        result.recommended_daily_rate = (earnings / days.size).toFixed(2);
        result.rate_note = `Recorded Paid payroll basic earnings PHP ${earnings.toFixed(2)} / ${days.size} completed worked day(s), ${period.from} to ${period.to}. HR must verify complete twelve-month earnings, wage coverage and actual working days before approval.`;
    }
    return result;
}
