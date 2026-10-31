import { isLeaveDate, scaledDecimal, getManilaWorkDate } from './leavePolicy.js';
import { getMaternityLeavePlan, validateStatutoryReview } from './statutoryLeave.mjs';

const invalid = message => { throw Object.assign(new Error(message), { status: 400, code: 'MATERNITY_SOURCES_REQUIRED' }); };
const money = (value, label) => {
    const text = String(value ?? '');
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text) || Number(text) > 100000000) invalid(`Enter ${label} with up to two decimal places.`);
    return scaledDecimal(text.startsWith('.') ? `0${text}` : text, 2, label);
};
const amount = cents => Number(cents) / 100;
const rounded = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
const reference = (value, label) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) invalid(`${label} is required (maximum 300 characters).`);
    return value.trim();
};
const monthsBefore = start => Array.from({ length: 12 }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 12 + index, 1)).toISOString().slice(0, 7));

export function getMaternityWindows(contingencyDate, leaveStart) {
    if (!isLeaveDate(contingencyDate) || !isLeaveDate(leaveStart)) invalid('Enter the expected or actual childbirth / contingency date.');
    const date = new Date(contingencyDate);
    const semester = new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3 - 3, 1));
    return { semester_start: semester.toISOString().slice(0, 10), qualifying_months: monthsBefore(semester), wage_months: monthsBefore(new Date(leaveStart)) };
}

function completeMonths(records, months, label) {
    if (!Array.isArray(records) || records.length !== 12 || new Set(records.map(row => row?.month)).size !== 12 || records.some(row => !months.includes(row?.month))) invalid(`${label} requires twelve distinct months covering the displayed window, including explicit zero months.`);
    return months.map(month => records.find(row => row.month === month));
}

export function calculateMaternityAssessment(leave, input, { today = getManilaWorkDate(), holidays = [] } = {}) {
    if (leave?.type !== 'Maternity Leave' || !input || typeof input !== 'object' || Array.isArray(input)) invalid('A maternity request and its source records are required.');
    const plan = getMaternityLeavePlan(leave.start_date, input.event, input.allocated_days ?? 0);
    if (plan.end_date !== leave.end_date) invalid(`The selected entitlement requires ${plan.days} calendar days. Reconcile the request dates before approval.`);
    const windows = getMaternityWindows(input.contingency_date, leave.start_date);
    if (input.contingency_date > leave.end_date) invalid('The childbirth / contingency date cannot follow the end of maternity leave.');
    const sources = { event: input.event, allocated_days: input.allocated_days ?? 0, contingency_date: input.contingency_date,
        wage_mode: input.wage_mode, regular_monthly_allowance: amount(money(input.regular_monthly_allowance ?? 0, 'regular monthly allowances')),
        wage_reference: reference(input.wage_reference, 'Wage evidence reference'), sss_mode: input.sss_mode, sss_reference: reference(input.sss_reference, 'SSS evidence reference') };
    let monthlyNumerator, monthlyDenominator = 1n;
    if (sources.wage_mode === 'monthly') {
        const salary = money(input.monthly_salary, 'monthly basic salary');
        if (!salary) invalid('A positive verified monthly salary is required.');
        sources.monthly_salary = amount(salary); monthlyNumerator = salary;
    } else if (sources.wage_mode === 'daily') {
        const rate = money(input.daily_rate, 'daily basic rate');
        if (!rate || !Number.isInteger(input.annual_paid_days) || input.annual_paid_days < 1 || input.annual_paid_days > 366) invalid('Confirm the daily rate and applicable annual paid-day factor (1–366).');
        sources.daily_rate = amount(rate); sources.annual_paid_days = input.annual_paid_days;
        monthlyNumerator = rate * BigInt(input.annual_paid_days); monthlyDenominator = 12n;
    } else if (sources.wage_mode === 'variable') {
        const records = completeMonths(input.variable_months, windows.wage_months, 'Variable wage history');
        sources.variable_months = records.map(row => ({ month: row.month, amount: amount(money(row.amount, 'monthly basic earnings')) }));
        monthlyNumerator = sources.variable_months.reduce((sum, row) => sum + money(row.amount, 'monthly earnings'), 0n); monthlyDenominator = 12n;
        if (!monthlyNumerator) invalid('Reconcile a positive wage basis for the maternity period.');
    } else invalid('Choose the verified monthly, daily or variable wage basis.');
    monthlyNumerator += money(sources.regular_monthly_allowance, 'regular allowances') * monthlyDenominator;
    const fullPay = rounded(monthlyNumerator * BigInt(plan.days), monthlyDenominator * 30n);
    let sss;
    if (sources.sss_mode === 'assessment') {
        sss = money(input.sss_assessment_amount, 'documented SSS assessment'); sources.sss_assessment_amount = amount(sss);
    } else if (sources.sss_mode === 'history') {
        const records = completeMonths(input.sss_history, windows.qualifying_months, 'SSS contribution history');
        sources.sss_history = records.map(row => {
            const msc = money(row.msc, 'monthly salary credit');
            if (msc && (!isLeaveDate(row.paid_on) || row.paid_on > today)) invalid('Record the actual remittance date for each positive SSS monthly salary credit.');
            return { month: row.month, msc: amount(msc), paid_on: msc ? row.paid_on : null };
        });
        const paid = sources.sss_history.filter(row => row.msc > 0 && row.paid_on < windows.semester_start);
        if (paid.length < 3) invalid('Fewer than three qualifying SSS contribution months. Reconcile the records or supply a documented SSS assessment.');
        const top = paid.map(row => money(Math.min(row.msc, 20000), 'regular SSS credit')).sort((a, b) => a > b ? -1 : a < b ? 1 : 0).slice(0, 6);
        sss = rounded(top.reduce((sum, value) => sum + value, 0n) * BigInt(plan.days), 180n);
    } else invalid('Choose verified SSS contribution history or a documented SSS assessment.');
    sources.sss_paid_externally = amount(money(input.sss_paid_externally ?? 0, 'SSS amount already paid'));
    sources.differential_paid_externally = amount(money(input.differential_paid_externally ?? 0, 'differential already paid'));
    const outside = sources.sss_paid_externally || sources.differential_paid_externally;
    sources.external_reference = outside ? reference(input.external_reference, 'External payment reference').slice(0, 120) : '';
    sources.external_paid_on = outside ? input.external_paid_on : null;
    if (typeof input.external_reference === 'string' && input.external_reference.length > 120) invalid('External payment reference cannot exceed 120 characters.');
    if (input.differential_exemption != null && typeof input.differential_exemption !== 'string') invalid('Enter the documented exemption reference as text.');
    sources.differential_exemption = input.differential_exemption || '';
    sources.payable_on = input.payable_on;
    const review = validateStatutoryReview(leave, { ...sources, full_pay: amount(fullPay), sss_benefit: amount(sss), eligibility_confirmed: true,
        contingency_reference: `MAT:${leave.employee_id}:${sources.contingency_date}`,
        basis: `Wage: ${sources.wage_reference}. SSS: ${sources.sss_reference}. Contingency date: ${sources.contingency_date}. Gross components; existing payroll contribution rules apply.` }, { holidays, today });
    return { sources, review, windows, days: plan.days, monthly_basis: amount(rounded(monthlyNumerator, monthlyDenominator)),
        remaining_advance: amount(money(review.sss_benefit, 'SSS benefit') + money(review.salary_differential, 'differential') - money(review.sss_paid_externally, 'SSS paid') - money(review.differential_paid_externally, 'differential paid')) };
}
