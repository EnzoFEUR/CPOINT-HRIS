import { isLeaveDate, isStatutoryLeaveType, scaledDecimal, getLeaveReviewDates, getManilaWorkDate, getScheduledWorkDates, getEmployeeRestDays, MATERNITY_CALENDAR_DAYS } from './leavePolicy.js';

const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: 'STATUTORY_REVIEW_REQUIRED' }); };
const requiredText = (value, label, limit) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) invalid(`${label} is required (maximum ${limit} characters).`);
    return value.trim();
};
const money = (value, label) => {
    if (typeof value === 'string' && /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) invalid(`Enter a valid ${label} with up to two decimal places.`);
    return value;
};

export { MATERNITY_CALENDAR_DAYS };
export const VACATION_MONETIZATION_EXEMPT_DAY_CAP = 12;

export function getMaternityLeavePlan(start, event, allocatedDays = 0) {
    const baseDays = Object.hasOwn(MATERNITY_CALENDAR_DAYS, event) ? MATERNITY_CALENDAR_DAYS[event] : null;
    if (!baseDays || !Number.isInteger(allocatedDays) || allocatedDays < 0 || allocatedDays > 7 || (event === 'miscarriage_etp' && allocatedDays)) invalid('Review the maternity event and any allocated leave days.');
    if (start !== '' && !isLeaveDate(start)) invalid('Choose a valid maternity start date.');
    const days = baseDays - allocatedDays;
    return { days, end_date: start ? new Date(Date.parse(start) + (days - 1) * 86400000).toISOString().slice(0, 10) : '' };
}

export function validateStatutoryReview(leave, input = {}, { holidays = [], workDates: reviewedDates, today = getManilaWorkDate() } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('A statutory benefit review is required.');
    if (!isStatutoryLeaveType(leave?.type) || ![leave.start_date, leave.end_date].every(isLeaveDate) || leave.end_date < leave.start_date) invalid('A valid statutory leave request is required.');
    if (input.eligibility_confirmed !== true) invalid('HR must verify the applicable statutory entitlement and supporting evidence.');
    const review = {
        version: 1, kind: leave.type === 'Maternity Leave' ? 'maternity' : 'paternity', eligibility_confirmed: true,
        basis: requiredText(input.basis, 'Eligibility and wage evidence', 1000),
        contingency_reference: requiredText(input.contingency_reference, 'Contingency reference', 120)
    };
    if (review.kind === 'paternity') {
        if (input.married_cohabiting !== true || !Number.isInteger(input.delivery_number) || input.delivery_number < 1 || input.delivery_number > 4) invalid('Verify the cohabiting legal spouse and first four qualifying deliveries for RA 8187.');
        const workDates = reviewedDates || getLeaveReviewDates(leave, holidays);
        if (!Array.isArray(workDates) || workDates.some(date => !isLeaveDate(date) || date < leave.start_date || date > leave.end_date) || new Set(workDates).size !== workDates.length) invalid('The reviewed paternity work dates are invalid.');
        if (!workDates.length || workDates.length > 7) invalid('Paternity leave must cover one to seven scheduled working days.');
        const rate = money(input.daily_rate, 'full-pay daily rate');
        if (!rate) invalid('A verified full-pay daily rate is required.');
        return { ...review, work_dates: workDates, daily_rate: rate, married_cohabiting: true, delivery_number: input.delivery_number };
    }
    const allocatedDays = input.allocated_days ?? 0;
    const plan = getMaternityLeavePlan(leave.start_date, input.event, allocatedDays);
    if (leave.end_date !== plan.end_date) invalid(`This maternity entitlement requires ${plan.days} continuous calendar days.`);
    const fullPay = money(input.full_pay, 'full-pay entitlement');
    const sss = money(input.sss_benefit, 'verified SSS benefit');
    if (!fullPay) invalid('A verified full-pay entitlement including applicable regular allowances is required.');
    const exemption = typeof input.differential_exemption === 'string' ? input.differential_exemption.trim() : '';
    if (exemption.length > 500) invalid('Differential exemption evidence cannot exceed 500 characters.');
    const differential = exemption ? 0 : Number(scaledDecimal(fullPay, 2) > scaledDecimal(sss, 2) ? scaledDecimal(fullPay, 2) - scaledDecimal(sss, 2) : 0n) / 100;
    const sssExternal = money(input.sss_paid_externally ?? 0, 'SSS amount already paid');
    const diffExternal = money(input.differential_paid_externally ?? 0, 'differential already paid');
    if (sssExternal > sss || diffExternal > differential) invalid('An external payment cannot exceed its verified benefit component.');
    const externalReference = sssExternal || diffExternal ? requiredText(input.external_reference, 'External payment reference', 120) : '';
    if ((sssExternal || diffExternal) && (!isLeaveDate(input.external_paid_on) || input.external_paid_on > today)) invalid('Record the actual external payment date.');
    if (!isLeaveDate(input.payable_on)) invalid('Choose an advance payment date.');
    const filedOn = leave.created_at ? getManilaWorkDate(leave.created_at) : today;
    const deadline = new Date(Date.parse(filedOn) + 30 * 86400000).toISOString().slice(0, 10);
    if (sssExternal < sss || diffExternal < differential) {
        if (input.payable_on < today || input.payable_on > (deadline > today ? deadline : today)) invalid('Schedule the remaining advance within 30 days of application, or today if already overdue.');
    }
    return { ...review, work_dates: getScheduledWorkDates(leave.start_date, leave.end_date, getEmployeeRestDays(leave.employees)), event: input.event, allocated_days: allocatedDays, full_pay: fullPay, sss_benefit: sss,
        salary_differential: differential, differential_exemption: exemption, sss_paid_externally: sssExternal,
        differential_paid_externally: diffExternal, external_reference: externalReference,
        external_paid_on: externalReference ? input.external_paid_on : null, payable_on: input.payable_on, advance_due_on: deadline };
}

export function getStatutoryPayrollAmounts(signature = {}, { factory = false, dailyRate = 0 } = {}) {
    const amounts = { paternity: 0n, maternity_sss: 0n, maternity_differential: 0n };
    const dates = new Set();
    for (const line of signature.lines || []) {
        if (!(line.component in amounts)) invalid('Unknown statutory payroll component.');
        amounts[line.component] += scaledDecimal(line.amount, 2, 'statutory benefit');
        if (line.component === 'paternity') dates.add(line.payable_date);
    }
    const included = factory ? 0n : scaledDecimal(dailyRate, 2, 'daily rate') * BigInt(dates.size);
    const additional = amounts.paternity > included ? amounts.paternity - included : 0n;
    return { paternity_pay: Number(amounts.paternity) / 100, paternity_days: dates.size,
        paternity_additional_pay: Number(additional) / 100, maternity_sss_pay: Number(amounts.maternity_sss) / 100,
        maternity_salary_differential: Number(amounts.maternity_differential) / 100,
        total_additional_pay: Number(additional + amounts.maternity_sss + amounts.maternity_differential) / 100,
        tax_exempt_pay: Number(amounts.maternity_sss + amounts.maternity_differential) / 100 };
}

export const isMaternityCoveredDate = (date, coverage = []) => coverage.some(leave => leave.type === 'Maternity Leave' && date >= leave.start_date && date <= leave.end_date);

export function getMaternitySalaryReplacement(basicPay, coverage, workDates) {
    if (!workDates.length) return 0;
    const covered = workDates.filter(date => isMaternityCoveredDate(date, coverage)).length;
    return Number((scaledDecimal(basicPay, 2, 'basic pay') * BigInt(covered) + BigInt(Math.floor(workDates.length / 2))) / BigInt(workDates.length)) / 100;
}

export function validateFactoryMaternityOutput(piecePay, coverage, { periodStart, periodEnd, restDays, workedDates = [], declaredDates = [] }) {
    if (!(piecePay > 0) || !coverage.some(leave => leave.type === 'Maternity Leave')) return [];
    const workDates = getScheduledWorkDates(periodStart, periodEnd, restDays);
    if (workDates.length && workDates.every(date => isMaternityCoveredDate(date, coverage))) invalid('Production pay cannot be attributed to a fully maternity-covered cutoff. Select its actual earning period.');
    if (!Array.isArray(declaredDates) || !declaredDates.length || declaredDates.length > 31 || new Set(declaredDates).size !== declaredDates.length
        || declaredDates.some(date => !isLeaveDate(date) || date < periodStart || date > periodEnd || isMaternityCoveredDate(date, coverage) || !workedDates.includes(date))) {
        invalid('Attribute production output to verified completed work dates outside maternity leave.');
    }
    return [...declaredDates].sort();
}
