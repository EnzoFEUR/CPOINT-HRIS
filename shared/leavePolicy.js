export { getManilaWorkDate, DEFAULT_REST_DAYS, getEmployeeRestDays, getScheduledWorkDates } from './workPolicy.mjs';
import { getManilaWorkDate, DEFAULT_REST_DAYS, getEmployeeRestDays, getScheduledWorkDates } from './workPolicy.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

// --- Identifiers & Role Checks ---
export const isCreditManager = user => ['admin', 'hr'].includes(String(user?.role || '').toLowerCase());
export const isCreditLeaveType = type => ['sick leave', 'vacation / pto', 'vacation leave', 'emergency leave', 'service incentive leave'].includes(String(type || '').toLowerCase().trim());
export const isStatutoryLeaveType = type => ['Maternity Leave', 'Paternity Leave'].includes(type);
export const isCreditUuid = value => typeof value === 'string' && UUID.test(value);
export const isLeaveDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const MATERNITY_CALENDAR_DAYS = Object.freeze({ live_birth: 105, solo_parent_live_birth: 120, miscarriage_etp: 60 });

// --- SIL Policy Validation ---
export function validateSilPolicy(input = {}) {
    if (typeof input.annual_days !== 'number' || !Number.isInteger(input.annual_days) || input.annual_days < 5 || input.annual_days > 366) {
        invalid('Annual credits must be between 5 and 366 whole days.', 400);
    }
    if (!isCreditUuid(input.expected_id) || !isCreditUuid(input.request_id)) {
        invalid('Valid policy and request IDs are required.', 400);
    }
    return { annual_days: input.annual_days, expected_id: input.expected_id, request_id: input.request_id };
}

// --- SIL Valuation & Decimal Math ---
export function scaledDecimal(value, precision, label = 'amount') {
    const text = String(value);
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid ${label}.`);
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > precision || whole.length > 9) throw new Error(`Invalid ${label}.`);
    return BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'));
}

export function calculateSilConversion(days, dailyRate) {
    const units = scaledDecimal(days, 3, 'SIL days');
    const cents = scaledDecimal(dailyRate, 2, 'daily rate');
    if (units <= 0n || units > 366000n || cents <= 0n || cents > 100000000n) throw new Error('Invalid SIL conversion.');
    return Number((units * cents + 500n) / 1000n) / 100;
}

export function sumCashAmounts(values) {
    return Number(values.reduce((total, value) => total + scaledDecimal(value, 2), 0n)) / 100;
}

export function validateSilClassification(value) {
    if (!value || value.sss !== 'excluded' || value.philhealth !== 'excluded' || value.pagibig !== 'excluded' || value.thirteenth_month !== 'excluded'
        || typeof value.basis !== 'string' || !value.basis.trim() || value.basis.trim().length > 500) {
        invalid('Payroll compliance review is required. Automatic SIL posting supports documented exclusion from contribution bases and thirteenth-month basic pay only.', 400);
    }
    return { sss: 'excluded', philhealth: 'excluded', pagibig: 'excluded', thirteenth_month: 'excluded', basis: value.basis.trim() };
}

// --- SIL Cash-Out Workflows ---
export const CASH_OUT_LABELS = Object.freeze({
    requested: 'Awaiting HR',
    approved: 'Awaiting payroll',
    queued_for_payroll: 'Scheduled for payment',
    paid: 'Paid',
    needs_correction: 'Needs correction',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    payment_failed: 'Payment needs attention'
});

export function validateCashOutRequest(input = {}) {
    if (!isCreditUuid(input.request_id) || !isCreditUuid(input.employee_id)) invalid('Valid employee and request IDs are required.', 400);
    const days = input.days;
    if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0 || days > 366 || Math.abs(days * 1000 - Math.round(days * 1000)) > 1e-7) invalid('Enter valid unused days (up to three decimal places).', 400);
    return { employee_id: input.employee_id, request_id: input.request_id, days };
}

export function validateCashOutDecision(input = {}) {
    if (!isCreditUuid(input.decision_id) || !['approved', 'rejected'].includes(input.status)) invalid('A valid approval or rejection is required.', 400);
    const amount = input.taxable_amount;
    if (input.status === 'approved' && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 366000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7)) invalid('Review the amount subject to tax before approving.', 400);
    const rate = input.expected_daily_rate;
    if (input.status === 'approved' && (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1000000 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-7)) invalid('HR must save a valid daily rate before approving cash-out.', 400);
    return { decision_id: input.decision_id, status: input.status, taxable_amount: input.status === 'approved' ? amount : null, expected_daily_rate: input.status === 'approved' ? rate : null };
}

export function validateCashOutTransition(input = {}) {
    if (!isCreditUuid(input.operation_id) || !['approved', 'rejected', 'needs_correction', 'cancelled', 'resubmit'].includes(input.action)) invalid('Invalid cash-out action.', 400);
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 500) invalid('Enter a reason (up to 500 characters).', 400);
    const result = { operation_id: input.operation_id, action: input.action, reason: input.reason.trim() };
    if (input.action === 'approved') {
        const reviewed = validateCashOutDecision({ ...input, status: 'approved', decision_id: input.operation_id });
        return { ...result, taxable_amount: reviewed.taxable_amount, expected_daily_rate: reviewed.expected_daily_rate, classification: validateSilClassification(input.classification) };
    }
    if (input.action === 'resubmit') return { ...result, days: validateCashOutRequest({ employee_id: input.employee_id, request_id: input.operation_id, days: input.days }).days };
    return result;
}

// --- Leave Credit Ledgers & Allocation ---
const allocationStatuses = new Set(['ready', 'automatic_pending', 'service_date_review_required', 'opening_balance_review_required', 'hire_date_required', 'schedule_review_required', 'employee_inactive', 'service_not_started', 'employee_not_found']);

export function validateLeaveCreditSnapshot(snapshot) {
    const accountValid = snapshot?.account === null || (snapshot?.account && typeof snapshot.account === 'object' && !Array.isArray(snapshot.account));
    const balance = snapshot?.sil_balance;
    const balanceValid = (typeof balance === 'number' || (typeof balance === 'string' && balance.trim())) && Number.isFinite(Number(balance));
    if (!snapshot || Array.isArray(snapshot) || !allocationStatuses.has(snapshot.allocation_status) || !accountValid || !balanceValid || (snapshot.allocation_status === 'ready' && !snapshot.account)) {
        throw Object.assign(new Error('Leave-credit setup needs an update. Ask HR to check it.'), { code: 'LEAVE_CREDIT_STATUS_UNAVAILABLE', status: 503 });
    }
    return snapshot;
}

export function getLeaveCreditAllocationMessage(snapshot) {
    switch (snapshot?.allocation_status) {
        case 'automatic_pending': return 'Leave credits are being added automatically.';
        case 'service_date_review_required': return 'HR must review the hire date used by existing leave records.';
        case 'opening_balance_review_required': return 'HR must review historical leave and opening balances.';
        case 'hire_date_required': return 'HR must record a verified hire date before SIL can be allocated automatically.';
        case 'schedule_review_required': return 'HR must correct the employee work schedule before automatic SIL allocation.';
        case 'employee_inactive': return 'Automatic SIL allocation is paused for this inactive or separated employee.';
        case 'service_not_started': return 'SIL allocation starts when the recorded employment service begins.';
        case 'employee_not_found': return 'Employee record not found.';
        default: return 'Leave credits could not be verified. Refresh and try again.';
    }
}

function number(value, name, minimum = 0, maximum = 366, precision = 3) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || Math.abs(value * 10 ** precision - Math.round(value * 10 ** precision)) > 1e-7) invalid(`Invalid ${name}.`, 400);
    return value;
}

function text(value, name, limit = 500) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) invalid(`${name} is required (maximum ${limit} characters).`, 400);
    return value.trim();
}

export function validateCreditCommand(kind, input = {}) {
    if (!isCreditUuid(input.employee_id) || !isCreditUuid(input.request_id)) invalid('Valid employee_id and request_id UUIDs are required.', 400);
    const result = { employee_id: input.employee_id, request_id: input.request_id, reason: text(input.reason, 'Reason') };
    if (kind === 'setup') {
        if (!isLeaveDate(input.service_start_date) || input.service_start_date > getManilaWorkDate()) invalid('A valid, nonfuture service start date is required.', 400);
        if (typeof input.sil_eligible !== 'boolean') invalid('HR must confirm SIL coverage.', 400);
        if (!Array.isArray(input.rest_days) || input.rest_days.length > 6 || input.rest_days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(input.rest_days).size !== input.rest_days.length) invalid('Rest days must be distinct weekdays (0–6), with at least one workday.', 400);
        if (input.opening_incentive != null && input.opening_incentive !== 0) invalid('Company incentive credits are not supported.', 400);
        return { ...result, service_start_date: input.service_start_date, sil_eligible: input.sil_eligible, rest_days: [...input.rest_days].sort(), opening_sil: number(input.opening_sil, 'opening SIL balance'), opening_incentive: 0 };
    }
    if (kind === 'reconcile') {
        if (!isLeaveDate(input.service_start_date) || input.service_start_date > getManilaWorkDate() || !isLeaveDate(input.expected_service_start_date)) invalid('Valid reviewed hire dates are required.', 400);
        return { ...result, service_start_date: input.service_start_date, expected_service_start_date: input.expected_service_start_date,
            expected_balance: number(input.expected_balance, 'recorded balance', -999999999, 999999999), remaining_days: number(input.remaining_days, 'remaining SIL days') };
    }
    result.days = number(input.days, 'days', 0.001);
    if (kind === 'grant') {
        if (input.pool !== 'sil') invalid('Only statutory SIL credits are supported.', 400);
        return { ...result, pool: input.pool };
    }
    if (kind === 'cash_conversion') return { ...result, daily_rate: number(input.daily_rate, 'daily rate', 0.01, 1000000, 2), payment_reference: text(input.payment_reference, 'Payment reference', 120) };
    invalid('Unsupported credit command.', 400);
}

export function getLeaveOverlapDays(leave, periodStart, periodEnd) {
    if (![leave.start_date, leave.end_date, periodStart, periodEnd].every(isLeaveDate) || periodEnd < periodStart || leave.end_date < leave.start_date) throw new Error('Invalid leave date range.');
    if (leave.type === 'Paternity Leave' && leave.statutory_review) {
        const dates = leave.statutory_review.work_dates;
        if (!Array.isArray(dates) || !dates.length || dates.length > 7 || dates.some(date => !isLeaveDate(date) || date < leave.start_date || date > leave.end_date) || new Set(dates).size !== dates.length) throw new Error('Paternity leave requires reviewed work dates.');
        return dates.filter(date => date >= periodStart && date <= periodEnd).length;
    }
    if (leave.credit_pool || (leave.requested_pay_type && (!leave.status || leave.status === 'Approved'))) {
        if (!Array.isArray(leave.credit_dates) || !leave.credit_dates.length || leave.credit_dates.some(date => !isLeaveDate(date) || date < leave.start_date || date > leave.end_date) || new Set(leave.credit_dates).size !== leave.credit_dates.length) throw new Error('Managed leave requires valid, distinct work dates.');
        return leave.credit_dates.filter(date => date >= periodStart && date <= periodEnd).length;
    }
    const start = leave.start_date > periodStart ? leave.start_date : periodStart;
    const end = leave.end_date < periodEnd ? leave.end_date : periodEnd;
    return end < start ? 0 : Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}

export function getCreditAttendanceConflicts(leaves = [], attendance = []) {
    const creditedDates = new Set(
        (leaves || [])
            .filter(leave => leave && leave.is_paid && (leave.credit_pool || isStatutoryLeaveType(leave.type)))
            .flatMap(leave => leave.type === 'Maternity Leave' ? getScheduledWorkDates(leave.start_date, leave.end_date, [])
                : leave.type === 'Paternity Leave' ? leave.statutory_review?.work_dates || [] : Array.isArray(leave.credit_dates) ? leave.credit_dates : [])
    );
    if (creditedDates.size === 0) return [];
    const conflicts = new Set();
    for (const log of (attendance || [])) {
        if (!log) continue;
        const dateKey = String(log.date || '').slice(0, 10);
        if (creditedDates.has(dateKey) && (log.time_in || log.time_out)) {
            conflicts.add(dateKey);
        }
    }
    return Array.from(conflicts).sort();
}

export function assertCreditAttendanceConsistent(leaves = [], attendance = []) {
    const conflicts = getCreditAttendanceConflicts(leaves, attendance);
    if (conflicts.length > 0) {
        invalid(`Approved credited leave conflicts with attendance punches on ${conflicts.join(', ')}. Reconcile the leave before calculating payroll.`, 400);
    }
}


// --- Leave Filing & Request Range Validation ---
export const LEAVE_REQUEST_TYPES = ['Sick Leave', 'Vacation / PTO', 'Service Incentive Leave', 'Maternity Leave', 'Paternity Leave', 'Emergency Leave'];

export function validateLeaveRange(start, end) {
    if (!isLeaveDate(start) || !isLeaveDate(end) || end < start || Date.parse(end) - Date.parse(start) > 365 * 86400000) invalid('Choose valid first and last dates, in order, covering at most 366 calendar days.', 400);
}

export function validateLeaveFilingDates(start, end, today = getManilaWorkDate()) {
    validateLeaveRange(start, end);
    if (start < today || end < today) invalid('Choose today or a future date (Philippine time).', 400);
}

export function validateLeaveRequest(input) {
    if (!isCreditUuid(input.employee_id)) invalid('A valid employee ID is required.', 400);
    if (typeof input.leave_type !== 'string' || !input.leave_type.trim() || input.leave_type.trim().length > 100) invalid('A valid leave type is required.', 400);
    validateLeaveFilingDates(input.start_date, input.end_date);
    if (input.leave_type.trim().toLowerCase() === 'maternity/paternity') invalid('Choose Maternity Leave or Paternity Leave for a new application. Historical combined records remain available.', 400);
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 255) invalid('Enter a reason using 1-255 characters.', 400);
    const result = { employee_id: input.employee_id, leave_type: input.leave_type.trim(), start_date: input.start_date, end_date: input.end_date, reason: input.reason.trim() };
    if (input.maternity_request != null) {
        const request = input.maternity_request;
        if (result.leave_type !== 'Maternity Leave' || typeof request !== 'object' || Array.isArray(request) || !Object.hasOwn(MATERNITY_CALENDAR_DAYS, request.event)
            || !Number.isInteger(request.allocated_days) || request.allocated_days < 0 || request.allocated_days > 7 || (request.event === 'miscarriage_etp' && request.allocated_days !== 0)
            || !isLeaveDate(request.contingency_date) || request.contingency_date > result.end_date) invalid('Choose a valid maternity entitlement, allocation and expected/actual contingency date.', 400);
        const days = MATERNITY_CALENDAR_DAYS[request.event] - request.allocated_days;
        if (Date.parse(result.end_date) - Date.parse(result.start_date) !== (days - 1) * 86400000) invalid(`This maternity request requires ${days} calendar days.`, 400);
        result.maternity_request = { event: request.event, allocated_days: request.allocated_days, contingency_date: request.contingency_date };
    }
    if (input.requested_pay_type !== undefined) {
        if (!isCreditLeaveType(result.leave_type) || !['with_pay', 'without_pay'].includes(input.requested_pay_type)) invalid('Choose paid or unpaid for an ordinary leave request. Other statutory benefits require separate HR review.', 400);
        if (input.requested_pay_type === 'with_pay' ? input.requested_credit_pool != null && input.requested_credit_pool !== 'sil' : input.requested_credit_pool != null) invalid('Paid ordinary leave uses SIL credits; unpaid leave cannot use credits.', 400);
        result.requested_pay_type = input.requested_pay_type;
        result.requested_credit_pool = input.requested_pay_type === 'with_pay' ? 'sil' : null;
    } else if (input.requested_credit_pool != null) invalid('Choose a payment preference before selecting credits.', 400);
    return result;
}

export function isLeaveRestDay(date, restDays) {
    return isLeaveDate(date) && restDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

export function validateLeaveWorkdayEndpoints(input, employee) {
    if (!isCreditLeaveType(input.leave_type)) return;
    const restDays = getEmployeeRestDays(employee);
    for (const [label, date] of [['First date', input.start_date], ['Last date', input.end_date]]) {
        if (isLeaveRestDay(date, restDays)) invalid(`${label} is a rest day. Choose a scheduled workday.`, 400);
    }
}

export function getEmployeeLeaveStatus(leave) {
    if (isPendingLeave(leave.status)) return leave.requested_pay_type ? `Pending HR review - ${leave.requested_pay_type === 'with_pay' ? 'Paid' : 'Unpaid'} requested` : 'Pending HR review';
    if (leave.status !== 'Approved') return leave.status || 'Awaiting review';
    if (isStatutoryLeaveType(leave.type)) return leave.statutory_review ? 'Approved - Statutory benefit' : 'HR benefit review required';
    if (leave.is_paid === false || leave.pay_type === 'without_pay' || /\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(leave.notes || '')) return 'Approved - Unpaid';
    if (leave.credit_pool) return `Approved - ${leave.credit_pool === 'sil' ? 'SIL' : 'Historical credit'} (${leave.credit_days} days)`;
    return 'Approved - Paid';
}

// --- Leave Approval Validation ---
export const isPendingLeave = status => ['new', 'pending'].includes(String(status || '').trim().toLowerCase());
export const getDefaultLeaveCreditPool = leave => leave.requested_pay_type === 'without_pay' ? '' : isCreditLeaveType(leave.type) ? 'sil' : '';

export function getLeavePaymentMismatch(leave, payType, creditPool) {
    if (leave?.requested_pay_type && (leave.requested_pay_type !== payType || (leave.requested_credit_pool ?? null) !== (creditPool || null))) return 'Approve the employee requested payment and credit pool, or reject the request for revision.';
    return '';
}

export function getLeaveReviewDates(leave, holidays = []) {
    getLeaveOverlapDays(leave, leave.start_date, leave.end_date);
    if (Date.parse(leave.end_date) - Date.parse(leave.start_date) > 365 * 86400000) throw new Error('Leave range exceeds 366 days. HR must review this request.');
    if (leave.credit_pool || (leave.requested_pay_type && leave.status === 'Approved')) return [...leave.credit_dates];
    const restDays = getEmployeeRestDays(leave.employees);
    const nonWorking = new Set(holidays.filter(holiday => holiday.type !== 'special_working').map(holiday => holiday.date));
    return getScheduledWorkDates(leave.start_date, leave.end_date, restDays).filter(date => !nonWorking.has(date) && (!leave.employees?.date_hired || date >= String(leave.employees.date_hired).slice(0, 10)));
}

export function getLeaveApprovalBlock({ leave, payType, creditPool, snapshot, preview, checking = false, error = '' }) {
    if (!leave || !isPendingLeave(leave.status)) return 'This request is no longer pending. Refresh before reviewing it.';
    const mismatch = getLeavePaymentMismatch(leave, payType, creditPool);
    if (mismatch) return mismatch;
    if (payType !== 'with_pay') return '';
    if (!creditPool) return isCreditLeaveType(leave.type) ? 'Paid ordinary leave requires verified statutory SIL credits.' : '';
    if (!isCreditLeaveType(leave.type) || creditPool !== 'sil') return 'This leave type cannot use the selected credit pool.';
    if (checking) return 'Checking current balances and chargeable work dates...';
    if (error) return error;
    if (!snapshot?.account || (snapshot.allocation_status && snapshot.allocation_status !== 'ready')) return getLeaveCreditAllocationMessage(snapshot);
    if (creditPool === 'sil' && snapshot.account.sil_eligible !== true) return 'HR has not confirmed statutory SIL eligibility for this account.';
    const balance = snapshot[`${creditPool}_balance`];
    if (balance === null || balance === undefined || !Number.isFinite(Number(balance))) return 'The leave balance cannot be verified. Refresh before approving.';
    if (!preview || !Number.isInteger(preview.days) || !Array.isArray(preview.dates) || preview.days !== preview.dates.length || preview.dates.some(date => !isLeaveDate(date) || date < leave.start_date || date > leave.end_date) || new Set(preview.dates).size !== preview.dates.length) return 'Chargeable work dates cannot be verified. Refresh before approving.';
    if (preview.days === 0) return 'This request has no chargeable workdays.';
    if (Number(balance) < preview.days) return 'Insufficient leave credits. Approve only after SIL balances are reconciled, or reject for revision.';
    return '';
}
