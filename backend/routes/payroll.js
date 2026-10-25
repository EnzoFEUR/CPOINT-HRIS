import express from 'express';
import { validateRecordId, validateUuidParam } from '../middleware/requestValidation.js';
import { calculateBIRWithholdingTax } from '../../shared/payrollTax.mjs';
import { getSssMsc } from '../../shared/sssContribution.mjs';
import { isFirstCutoffOfMonth, previousMonthRange, averageMonthlyBase } from '../../shared/statutoryTiming.mjs';
import { computeFactoryHolidayPayAdow, FACTORY_ADOW_LOOKBACK_DAYS } from '../../shared/factoryHolidayPay.mjs';
import { isLastCutoffOfDecember } from '../../shared/thirteenthMonth.mjs';
import { isCreditUuid, isLeaveDate, assertCreditAttendanceConsistent, getCreditAttendanceConflicts } from '../../shared/leaveCredits.mjs';
import { fetchPendingSilCash, cashPayForEmployee, fetchPayrollLeavePay, payrollLeaveSignature } from '../utils/payrollCalculations.js';
import { refreshLeaveCredits, sendCreditError } from './leaves.js';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { supabase } from '../supabaseClient.js';
import { parseListQuery, payrollListRecord } from '../utils/listViews.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { createAuditLog } from './auditLogs.js';
import { createNotification } from './notifications.js';
import {
    toSafeNumber,
    round2,
    computeHolidayPayForPeriod,
    UNPAID_BREAK_HOURS,
    calculateMaternityDifferential,
    calculateStatutoryLeavePay,
    aggregate13thMonthPay,
    THIRTEENTH_MONTH_TAX_EXEMPT_CEILING,
    getEffectiveMonthlySalary,
    MULTIPLIERS,
} from '../utils/payrollCalculations.js';
import { getLeaveSummaryForPeriod } from '../utils/leaveUtils.js';

import { getEmployeeRestDays, getScheduledWorkDates, getWorkPolicy, calculateTardiness } from '../../shared/workPolicy.mjs';
import { STATUTORY_INPUT_LIMITS, getStatutorySettingsError } from '../../shared/statutorySettings.mjs';
import { getFactoryRowsError } from '../../shared/inputLimits.mjs';
import { fetchPayrollAttendance } from '../utils/payrollAttendance.js';
import { getOfflinePayrollVersions } from '../utils/offlinePayrollVersion.js';

const router = express.Router();
router.param('id', validateRecordId);
router.param('employee_id', validateUuidParam);
const WORK_POLICY = getWorkPolicy(process.env);

const requirePayrollManager = (req, res, next) => {
    if (!hasVerifiedManagerRole(req.user)) {
        return res.status(403).json({ error: 'Verified HR or administrator access is required to create payroll.' });
    }
    next();
};

router.post('/:id/confirm-sil-payment', requirePayrollManager, async (req, res) => {
    const { operation_id, reference } = req.body || {};
    if (!req.params.id || req.params.id.length > 128 || !isCreditUuid(operation_id) || typeof reference !== 'string' || !reference.trim() || reference.trim().length > 120) return res.status(400).json({ error: 'A valid payroll, request ID and completed payment reference are required.' });
    try {
        const { data, error } = await supabase.rpc('confirm_sil_payroll_payment', { p_actor_id: req.user.id, p_payroll_id: req.params.id, p_operation_id: operation_id, p_reference: reference.trim() });
        if (error) throw error;
        refreshLeaveCredits(supabase, data.employee_id);
        res.json({ success: true, data });
    } catch (error) { sendCreditError(res, error); }
});

// Statutory rates and caps with fallback defaults when configuration is unreachable
const DEFAULT_STATUTORY_SETTINGS = Object.freeze({
    sss_employee_rate: 5,
    sss_employer_rate: 10,
    sss_max_msc: 35000,
    philhealth_rate: 5,
    philhealth_min_salary: 10000,
    philhealth_max_salary: 100000,
    pagibig_employee_rate: 2,
    pagibig_employer_rate: 2,
    pagibig_max_contribution: 200,
    minimum_daily_wage: 755, // regional daily minimum wage: floor for piece-rate holiday pay
    // Attendance & Tardiness Policy
    grace_period_minutes: 15,
    late_rate_per_minute: 25,
    call_time_hour: 8,
    call_time_minute: 0,
});

let statutorySettingsCache = null;
let statutorySettingsCacheExpires = 0;

export const invalidateStatutorySettingsCache = () => {
    statutorySettingsCache = null;
    statutorySettingsCacheExpires = 0;
};

export const getStatutorySettings = async () => {
    const now = Date.now();
    if (statutorySettingsCache && now < statutorySettingsCacheExpires) {
        return statutorySettingsCache;
    }

    const merged = { ...DEFAULT_STATUTORY_SETTINGS };
    try {
        const { data, error } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();
        if (!error && data) {
            for (const key of Object.keys(DEFAULT_STATUTORY_SETTINGS)) {
                const raw = data[key];
                if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
                    merged[key] = Number(raw);
                }
            }
        }
    } catch (err) {
        console.error('Failed to load statutory settings, using defaults:', err.message);
    }
    statutorySettingsCache = merged;
    statutorySettingsCacheExpires = now + 60000; // 60-second in-memory cache
    return merged;
};

// Work policy (grace period, late rate, call time) as saved on the Statutory Settings screen.
export const getActiveWorkPolicy = async () => {
    const settings = await getStatutorySettings();
    return getWorkPolicy(settings);
};

// Employee-share SSS / PhilHealth / Pag-IBIG for one pay cycle, computed from the monthly base.
// /batch uses this so saved deductions never come from the browser.
const computeEmployeeStatutory = (monthlyBase, divisor, rates) => {
    if (!(monthlyBase > 0)) return { sss: 0, philHealth: 0, pagIbig: 0 };
    const sssMsc = getSssMsc(monthlyBase, rates.sss_max_msc);
    const phSalaryBase = Math.min(Math.max(monthlyBase, rates.philhealth_min_salary), rates.philhealth_max_salary);
    const monthlyPagIbig = Math.min(round2(monthlyBase * (rates.pagibig_employee_rate / 100)), rates.pagibig_max_contribution);
    return {
        sss: round2((sssMsc * (rates.sss_employee_rate / 100)) / divisor),
        philHealth: round2(((phSalaryBase * (rates.philhealth_rate / 100)) / 2) / divisor),
        pagIbig: round2(monthlyPagIbig / divisor)
    };
};

// Monthly average of each employee's weekly pay over the previous calendar month (weeks that ended in it).
// Only looked up in the first cutoff of a month, when the contribution is taken. Missing = no earlier payslips.
const fetchPreviousMonthBases = async (supabase, employees, periodEnd) => {
    const bases = new Map();
    const ids = (employees || []).map(e => String(e.id));
    if (ids.length === 0 || !isFirstCutoffOfMonth(periodEnd)) return bases;
    const range = previousMonthRange(periodEnd);
    const byEmployee = new Map();
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.from('payrolls').select('*').in('employee_id', ids)
            .gte('period_end', range.start).lte('period_end', range.end)
            .order('id', { ascending: true }).range(offset, offset + 999);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Invalid previous-month payroll response.');
        for (const row of data) {
            const key = String(row.employee_id);
            if (!byEmployee.has(key)) byEmployee.set(key, []);
            byEmployee.get(key).push(row);
        }
        if (data.length < 1000) break;
    }
    for (const [key, rows] of byEmployee) {
        const base = averageMonthlyBase(rows);
        if (base !== null) bases.set(key, base);
    }
    return bases;
};

// Fixed-salary employees use their salary; piece-rate workers use last month's average weekly pay (or null).
const getStatutoryMonthlyBase = (employee, previousBases) => {
    const salary = getEffectiveMonthlySalary(employee);
    if (salary > 0) return salary;
    return previousBases.get(String(employee?.id)) ?? null;
};

// Optional breakdown columns: gracefully fallback and omit unmigrated schema columns without failing
const OPTIONAL_PAYROLL_COLUMNS = [
    'holiday_pay',
    'holiday_breakdown',
    'sss_deduction',
    'philhealth_deduction',
    'pagibig_deduction',
    'tax_deduction',
    'paid_leave_days', 'paid_leave_pay', 'paid_leave_in_basic', 'sil_cash_pay',
    'leave_pay', 'maternity_salary_differential',
    'thirteenth_month_pay',
];

const insertPayrollRow = async (payload, cash, actorId, frequency = 'weekly') => {
    if (cash?.available) {
        const result = await supabase.rpc('post_payroll_with_sil', {
            p_actor_id: actorId,
            p_employee_id: payload.employee_id,
            p_payroll: payload,
            p_payout_ids: cash.payout_ids || [],
            p_frequency: frequency,
            p_leave_signature: cash.leave_signature || []
        });
        if (result.error?.code === 'PGRST202') {
            result.error = { ...result.error, status: 503, message: 'Install the SIL payroll migration before posting this payslip.' };
        }
        const conflicts = {
            PAYROLL_ALREADY_EXISTS: 'A payslip already exists for this employee and period.',
            SIL_PAYOUT_CHANGED: 'Cash-out payments changed. Refresh the preview before saving.',
            PAYROLL_LEAVE_CHANGED: 'Approved leave changed. Refresh the preview before saving.',
            PAYROLL_ATTENDANCE_CHANGED: 'Attendance changed during calculation. Refresh and calculate payroll again.',
            FORBIDDEN: 'Manager or HR permissions are required to post payroll.',
            INVALID_CREDIT_COMMAND: 'Invalid payroll calculation or period range for SIL cash-out posting.'
        };
        if (conflicts[result.error?.message]) {
            result.error = { ...result.error, status: result.error?.message === 'FORBIDDEN' ? 403 : 409, message: conflicts[result.error.message] };
        }
        return result;
    }
    const row = { ...payload };
    for (let attempt = 0; attempt <= OPTIONAL_PAYROLL_COLUMNS.length; attempt++) {
        const { data, error } = await supabase.from('payrolls').insert(row).select('id').maybeSingle();
        if (!error) return { data, error: null };
        if (error.message === 'PAYROLL_ATTENDANCE_CHANGED') return { data: null, error: { ...error, status: 409, message: 'Attendance changed during calculation. Refresh and calculate payroll again.' } };
        const missing = OPTIONAL_PAYROLL_COLUMNS.find((col) => col in row && error.message?.includes(col));
        if (!missing) return { data: null, error };
        // Older schemas still retain the full earnings total until breakdown columns are installed.
        if (missing === 'paid_leave_pay' && row.paid_leave_in_basic !== true) { row.basic_pay = round2(row.basic_pay + row.paid_leave_pay); row.paid_leave_in_basic = true; }
        if (['leave_pay', 'maternity_salary_differential'].includes(missing)) row.basic_pay = round2(row.basic_pay + row[missing]);
        if (missing === 'paid_leave_in_basic' && row.paid_leave_in_basic === true) delete row.paid_leave_pay;
        delete row[missing];
    }
    return { data: null, error: new Error('Payroll insert failed after removing optional columns.') };
};

// The client works a 5-day week (Mon-Fri). A weekly cutoff therefore spans at most 5 calendar days,
// and a week's basic pay is always 5 working days.
const WORK_DAYS_PER_WEEK = 5;
const MAX_WEEKLY_CUTOFF_DAYS = WORK_DAYS_PER_WEEK;
const getCutoffSpanDays = (start, end) => {
    const s = new Date(`${String(start).substring(0, 10)}T00:00:00`);
    const e = new Date(`${String(end).substring(0, 10)}T00:00:00`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
};

// DOLE Art. 94 holiday-pay eligibility looks at the workday before a holiday (lookback window)
const HOLIDAY_LOOKBACK_DAYS = 7;

const shiftDateStr = (dateStr, days) => {
    const d = new Date(`${String(dateStr).substring(0, 10)}T00:00:00`);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const getRecordDateKey = (log) => {
    const raw = log?.date || (typeof log?.time_in === 'string' ? log.time_in.split('T')[0] : '');
    return String(raw || '').substring(0, 10);
};

// Individual payroll must not be processed for an employee with nothing to pay for: no COMPLETED
// attendance (a clock-in AND a clock-out) inside the period and no approved paid leave.
// A clock-in that was never clocked out does not count as attendance.
const evaluateAttendanceEligibility = ({
    attendanceLogs = [],
    approvedPaidLeaveDays = 0,
    periodStart,
    periodEnd,
    exempt = false,
}) => {
    const completedDays = new Set(
        (attendanceLogs || [])
            .filter(l => l && l.time_out)
            .map(getRecordDateKey)
            .filter(key => key && (!periodStart || key >= periodStart) && (!periodEnd || key <= periodEnd))
    );
    const attendanceDays = completedDays.size;
    const paidLeaveDays = toSafeNumber(approvedPaidLeaveDays);
    const blocked = !exempt && attendanceDays === 0 && paidLeaveDays <= 0;

    const label = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    const range = periodStart && periodEnd ? `${label(periodStart)} to ${label(periodEnd)}` : 'this period';

    return {
        blocked,
        attendanceDays,
        approvedPaidLeaveDays: paidLeaveDays,
        reason: blocked
            ? `No attendance and no approved paid leave for ${range}, so payroll cannot be processed. Only days with both a clock-in and a clock-out count as attendance.`
            : null,
    };
};

// Expands approved PAID leave records (start_date..end_date) into individual YYYY-MM-DD dates.
const getPaidLeaveDates = (leaveRecords = []) => {
    const dates = new Set();
    for (const leave of leaveRecords || []) {
        if (!leave || !leave.is_paid || !leave.start_date || !leave.end_date) continue;
        if (leave.credit_pool) {
            for (const date of leave.credit_dates || []) dates.add(date);
            continue;
        }
        let cursor = String(leave.start_date).substring(0, 10);
        const end = String(leave.end_date).substring(0, 10);
        for (let i = 0; i < 62 && cursor <= end; i++) {
            dates.add(cursor);
            cursor = shiftDateStr(cursor, 1);
        }
    }
    return Array.from(dates);
};

// DOLE Labor Advisories: an unworked Special (Non-Working) Day is "no work, no pay" UNLESS a
// favorable company policy, practice or CBA grants pay. Set to true if C-Point grants that pay.
const PAY_UNWORKED_SPECIAL_NON_WORKING_DAY = false;

// The contractual daily rate exactly as agreed (P610/day stays P610; P100/hr -> P800/day).
// Same precedence as getEffectiveMonthlySalary (daily -> hourly). Returns 0 for salary-based and
// piece-rate employees, whose daily rate is derived from their monthly figure instead.
// Daily-rate employees have a 1-hour unpaid break taken out of their holiday hours.
const getUnpaidBreakHours = (employee) =>
    toSafeNumber(employee?.daily_rate || employee?.daily_pay) > 0 ? UNPAID_BREAK_HOURS : 0;

const getContractualDailyRate = (employee) => {
    if (!employee) return 0;
    const daily = toSafeNumber(employee.daily_rate || employee.daily_pay);
    if (daily > 0) return round2(daily);
    const hourly = toSafeNumber(employee.hourly_rate);
    if (hourly > 0) return round2(hourly * 8);
    return 0;
};

// Holiday pay for a piece-rate (factory) worker: their holiday credit is the average daily output wage (ADOW)
// of the last 7 actual working days before the holiday, never below the regional minimum wage.
//  - Regular holiday not worked: one credit, if they were present the working day before.
//  - Worked: one more credit on top of that day's pieces (regular +1.0, special non-working +0.3; rest-day
//    variants from MULTIPLIERS.workedRestDay).
// Production is saved per cutoff, so earlier days use each saved payslip's piece pay spread over the days
// clocked in; the current cutoff uses its own piece pay (piecePay). See shared/factoryHolidayPay.mjs.
const computeFactoryHolidayPay = ({ employee, ctx, holidays = [], periodStart, periodEnd, piecePay = 0, minimumDailyWage }) =>
    computeFactoryHolidayPayAdow({
        holidays,
        logs: ctx?.logsByEmployee?.get(String(employee?.id)) || [],
        restDays: getEmployeeRestDays(employee),
        periodStart,
        periodEnd,
        piecePay,
        priorPayslips: ctx?.payslipsByEmployee?.get(String(employee?.id)) || [],
        minimumDailyWage,
    });

// Attendance and saved payslips needed to find a worker's last 7 actual working days before a holiday.
const fetchFactoryHolidayContext = async (employeeIds, pStart, pEnd) => {
    const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];
    const ctx = { logsByEmployee: new Map(), payslipsByEmployee: new Map() };
    if (ids.length === 0) return ctx;
    const from = shiftDateStr(pStart, -FACTORY_ADOW_LOOKBACK_DAYS);
    const [logs, payslips] = await Promise.all([
        fetchPayrollAttendance(supabase, ids, from, pEnd),
        (async () => {
            const rows = [];
            for (let offset = 0; ; offset += 1000) {
                const { data, error } = await supabase.from('payrolls').select('employee_id, period_start, period_end, basic_pay')
                    .in('employee_id', ids).gte('period_start', from).lt('period_start', pStart)
                    .order('id', { ascending: true }).range(offset, offset + 999);
                if (error) throw error;
                if (!Array.isArray(data)) throw new Error('Invalid factory payroll history response.');
                rows.push(...data);
                if (data.length < 1000) return rows;
            }
        })(),
    ]);
    for (const log of logs || []) {
        const key = String(log.employee_id);
        if (!ctx.logsByEmployee.has(key)) ctx.logsByEmployee.set(key, []);
        ctx.logsByEmployee.get(key).push(log);
    }
    for (const row of payslips || []) {
        const key = String(row.employee_id);
        if (!ctx.payslipsByEmployee.has(key)) ctx.payslipsByEmployee.set(key, []);
        ctx.payslipsByEmployee.get(key).push(row);
    }
    return ctx;
};

// ---- 13th month pay ----
// Client policy: total basic salary earned in the calendar year / 12, paid with the last cutoff of December.
// Employees who joined or left partway through simply have fewer months of basic pay in the total.
// Earlier payslips of the year for each employee (the payslip being created is added by the caller).
const fetchYearPayslips = async (employeeIds, pStart, pEnd) => {
    const ids = [...new Set((employeeIds || []).filter(Boolean).map(String))];
    const byEmployee = new Map();
    if (ids.length === 0) return byEmployee;
    const year = String(pEnd).substring(0, 4);
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from('payrolls')
            .select('employee_id, basic_pay, maternity_salary_differential')
            .in('employee_id', ids)
            .gte('period_end', `${year}-01-01`)
            .lt('period_start', pStart)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data || []) {
            const key = String(row.employee_id);
            if (!byEmployee.has(key)) byEmployee.set(key, []);
            byEmployee.get(key).push(row);
        }
        if (!data || data.length < PAGE) break;
    }
    return byEmployee;
};

const computeThirteenthMonthPay = (priorRows, currentBasic, currentMatDiff = 0) =>
    aggregate13thMonthPay([
        ...(priorRows || []),
        { basic_pay: currentBasic, maternity_salary_differential: currentMatDiff },
    ]).thirteenthMonthPay;

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// ==============================================================================
// Enterprise Low-Latency Real-Time Broadcast Bus (<5ms Execution Overhead)
// Synchronizes Admin Ledger, Employee Dashboards, and Live Payslip Views
// ==============================================================================
class PayrollRealtimeManager {
    constructor(client, maxPooledChannels = 150) {
        this.client = client;
        this.maxPooledChannels = maxPooledChannels;
        this.channels = new Map();

        // Pre-warm mission-critical persistent channels
        this.staticTopics = [
            'payroll_realtime_sync',
            'admin-live-payroll-ledger',
            'admin-dashboard-realtime',
            'dashboard-realtime'
        ];
        this.staticTopics.forEach(t => this.getOrSubscribe(t));
    }

    getOrSubscribe(topic) {
        if (this.channels.has(topic)) {
            return this.channels.get(topic);
        }

        // Bounded LRU eviction to prevent channel leaks
        if (this.channels.size >= this.maxPooledChannels) {
            for (const key of this.channels.keys()) {
                if (!this.staticTopics.includes(key)) {
                    const stale = this.channels.get(key);
                    try { this.client.removeChannel(stale.ch); } catch (_) { }
                    this.channels.delete(key);
                    break;
                }
            }
        }

        const ch = this.client.channel(topic);
        let resolveSub;
        const subPromise = new Promise(resolve => { resolveSub = resolve; });

        const entry = {
            ch,
            isSubscribed: false,
            subPromise
        };

        ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                entry.isSubscribed = true;
                resolveSub(true);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                entry.isSubscribed = false;
                resolveSub(false);
            }
        });

        this.channels.set(topic, entry);
        return entry;
    }

    async sendToTopic(topic, event, payload) {
        try {
            const entry = this.getOrSubscribe(topic);
            if (!entry.isSubscribed) {
                await Promise.race([
                    entry.subPromise,
                    new Promise(r => setTimeout(r, 350))
                ]);
            }
            return await entry.ch.send({
                type: 'broadcast',
                event,
                payload
            });
        } catch (_) {
            return 'error';
        }
    }

    dispatch(event, payload = {}) {
        const enrichedPayload = { ...payload, broadcast_timestamp: new Date().toISOString() };
        const topics = new Set(this.staticTopics);

        const empIds = Array.isArray(payload.employee_ids)
            ? payload.employee_ids
            : (payload.employee_id ? [payload.employee_id] : []);

        empIds.forEach(id => {
            if (id) {
                topics.add(`employee-live-dashboard-${id}`);
                topics.add(`myprofile-realtime-${id}`);
            }
        });

        const payrollIds = Array.isArray(payload.payroll_ids)
            ? payload.payroll_ids
            : (payload.id ? [payload.id] : []);

        payrollIds.forEach(id => {
            if (id) topics.add(`payslip-live-${id}`);
        });

        // Non-blocking fire-and-forget dispatch
        topics.forEach(t => {
            this.sendToTopic(t, event, enrichedPayload).catch(() => { });
        });
    }
}

const realtimeManager = new PayrollRealtimeManager(supabase);

export function broadcastPayrollUpdate(event, payload = {}) {
    realtimeManager.dispatch(event, payload);
}

const normalizeDateRange = (d1, d2) => {
    if (!d1 || !d2) return { start: d1 || d2, end: d2 || d1 };
    return d1 <= d2 ? { start: d1, end: d2 } : { start: d2, end: d1 };
};


/**
 * Helper: Computes BIR Withholding Tax under TRAIN Law (Weekly / Semi-Monthly / Monthly Brackets)
 * Reference: BIR Revised Withholding Tax Table under RA 10963 (TRAIN Law)
 */

/**
 * Helper: Fetches HR-approved paid leave applications for an employee within a date range.
 * Automatically overrides missing attendance logs by awarding full day pay for approved paid leaves.
 */
const fetchApprovedPaidLeaves = async (employeeId, start, end) => {
    try {
        const summary = await getLeaveSummaryForPeriod({
            employeeId,
            periodStart: start,
            periodEnd: end
        });

        return {
            totalPaidLeaveDays: summary.paid_leave_days || 0,
            leaveRecords: summary.leaves || []
        };
    } catch (err) {
        console.error('Error fetching approved paid leaves:', err);
        throw err;
    }
};

router.post('/leave-pay-preview', requirePayrollManager, async (req, res) => {
    const { employee_ids, period_start, period_end } = req.body;
    if (!Array.isArray(employee_ids) || employee_ids.length < 1 || employee_ids.length > 500 || employee_ids.some(id => !isCreditUuid(id)) || !isLeaveDate(period_start) || !isLeaveDate(period_end) || period_end < period_start || getCutoffSpanDays(period_start, period_end) > MAX_WEEKLY_CUTOFF_DAYS) return res.status(400).json({ error: 'Select employees and a valid weekly pay period.' });
    try {
        const { data, error } = await supabase.from('employees').select('*').in('id', [...new Set(employee_ids)]);
        if (error) throw error;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, ...await fetchPayrollLeavePay(supabase, data || [], period_start, period_end) });
    } catch (error) { res.status(503).json({ error: error.message }); }
});

// Monthly contribution base per employee for the factory batch preview (same rules as /batch).
router.post('/statutory-preview', requirePayrollManager, async (req, res) => {
    const { employee_ids, period_start, period_end } = req.body;
    if (!Array.isArray(employee_ids) || employee_ids.length < 1 || employee_ids.length > 500 || employee_ids.some(id => !isCreditUuid(id)) || !isLeaveDate(period_start) || !isLeaveDate(period_end)) {
        return res.status(400).json({ error: 'Valid employee_ids, period_start and period_end are required.' });
    }
    try {
        const { data, error } = await supabase.from('employees').select('*').in('id', [...new Set(employee_ids)]);
        if (error) throw error;
        const previousBases = await fetchPreviousMonthBases(supabase, data || [], period_end);
        const bases = {};
        for (const emp of data || []) bases[emp.id] = getStatutoryMonthlyBase(emp, previousBases);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, is_first_cutoff: isFirstCutoffOfMonth(period_end), bases });
    } catch (error) { res.status(503).json({ error: error.message }); }
});

// Holiday pay for a batch of piece-rate workers. The browser sends each worker's piece pay for this cutoff;
// the server adds the saved payslips and attendance needed for the 7-working-day average (same function as /batch).
router.post('/factory-holiday-preview', requirePayrollManager, async (req, res) => {
    try {
        const { entries, period_start, period_end } = req.body || {};
        if (!Array.isArray(entries) || !period_start || !period_end) {
            return res.status(400).json({ error: 'entries, period_start and period_end are required.' });
        }
        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);
        const ids = [...new Set(entries.map(e => e?.employee_id).filter(Boolean).map(String))];
        res.setHeader('Cache-Control', 'no-store');
        if (ids.length === 0) return res.json({ success: true, holidays: {}, thirteenth: {} });

        await ensureHolidaysGeneratedForRange(pStart, pEnd);
        const [{ data: holidays, error: holidayError }, { data: empList, error: employeeError }, ctx, settings] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', pStart).lte('date', pEnd),
            supabase.from('employees').select('*').in('id', ids),
            fetchFactoryHolidayContext(ids, pStart, pEnd),
            getStatutorySettings(),
        ]);
        if (holidayError || employeeError) throw holidayError || employeeError;

        const empMap = new Map((empList || []).map(e => [String(e.id), e]));
        const result = {};
        const thirteenth = {};
        const yearPayslips = isLastCutoffOfDecember(pEnd) ? await fetchYearPayslips(ids, pStart, pEnd) : new Map();
        for (const entry of entries) {
            const employee = empMap.get(String(entry?.employee_id));
            if (!employee) continue;
            const piecePay = Math.max(0, round2(toSafeNumber(entry.piece_pay)));
            if (yearPayslips.size > 0 || isLastCutoffOfDecember(pEnd)) {
                const amount = computeThirteenthMonthPay(yearPayslips.get(String(employee.id)), piecePay);
                if (amount > 0) thirteenth[String(employee.id)] = amount;
            }
            const holiday = computeFactoryHolidayPay({
                employee,
                ctx,
                holidays: holidays || [],
                periodStart: pStart,
                periodEnd: pEnd,
                piecePay,
                minimumDailyWage: settings.minimum_daily_wage,
            });
            if (holiday.items.length > 0) result[String(employee.id)] = { total: holiday.total, items: holiday.items, missingRate: false };
        }
        res.json({ success: true, holidays: result, thirteenth });
    } catch (error) { res.status(503).json({ error: error.message }); }
});

// 1. Statutory settings
router.get('/statutory-settings', cacheResponse(20), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        res.json(data || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/statutory-settings', requirePayrollManager, async (req, res) => {
    try {
        const cleanSettings = { ...req.body };
        delete cleanSettings.admin_id;
        delete cleanSettings.id;
        delete cleanSettings.created_at;
        const admin_id = req.user.id;

        const validationError = getStatutorySettingsError(cleanSettings);
        if (validationError) return res.status(400).json({ success: false, code: 'INVALID_STATUTORY_SETTINGS', error: validationError });
        for (const name of Object.keys(STATUTORY_INPUT_LIMITS)) {
            if (Object.hasOwn(cleanSettings, name)) cleanSettings[name] = Number(cleanSettings[name]);
        }

        const { data: existing, error: readError } = await supabase
            .from('statutory_settings')
            .select('id, philhealth_min_salary, philhealth_max_salary')
            .limit(1)
            .maybeSingle();

        if (readError) throw readError;
        const rangeError = getStatutorySettingsError({ ...existing, ...cleanSettings });
        if (rangeError) return res.status(400).json({ success: false, code: 'INVALID_STATUTORY_SETTINGS', error: rangeError });
        let resultData;
        let error;
        if (existing) {
            ({ data: resultData, error } = await supabase
                .from('statutory_settings')
                .update(cleanSettings)
                .eq('id', existing.id)
                .select()
                .single());
        } else {
            ({ data: resultData, error } = await supabase
                .from('statutory_settings')
                .insert([cleanSettings])
                .select()
                .single());
        }

        if (error) throw error;

        invalidateStatutorySettingsCache();
        invalidateCache(['/api/payroll/statutory-settings']);
        broadcastPayrollUpdate('STATUTORY_SETTINGS_UPDATED', { admin_id, settings: resultData || cleanSettings });
        res.json({ success: true, message: 'Statutory settings updated successfully.', data: resultData || cleanSettings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Holidays
router.get('/holidays', cacheResponse(60), async (req, res) => {
    try {
        let query = supabase.from('holidays').select('*').order('date', { ascending: true });

        const rawStart = req.query.start || req.query.start_date;
        const rawEnd = req.query.end || req.query.end_date;

        if (rawStart && rawEnd) {
            const { start, end } = normalizeDateRange(rawStart, rawEnd);
            query = query.gte('date', start).lte('date', end);
        } else if (rawStart) {
            query = query.gte('date', rawStart);
        } else if (rawEnd) {
            query = query.lte('date', rawEnd);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/holidays', requirePayrollManager, async (req, res) => {
    try {
        const { name, date, type } = req.body;
        if (!name || !date || !type) {
            return res.status(400).json({ error: 'name, date, and type are required.' });
        }

        const { data, error } = await supabase
            .from('holidays')
            .insert([{ name, date, type }])
            .select()
            .single();

        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/holidays/:id', requirePayrollManager, async (req, res) => {
    try {
        const { id } = req.params;
        const isNumericId = !isNaN(Number(id));
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        if (!isNumericId && !isUUID) {
            return res.status(400).json({ error: 'Invalid holiday ID format.' });
        }

        const { error } = await supabase.from('holidays').delete().eq('id', id);
        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================
// 2b. Auto-Generate Deterministic Holidays for a Given Year
//     (fixed-date holidays, National Heroes Day rule, Easter-based Holy Week,
//     and looked-up Chinese New Year. Eidul Fitr / Eidul Adha are intentionally
//     excluded - those are set by NCMF proclamation via moon sighting, not a
//     fixed calendar rule, and must still be added manually each year.)
// ==============================================================================

// Meeus/Jones/Butcher algorithm - computes Easter Sunday for a Gregorian year
function getEasterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function toDateStr(d) {
    return d.toISOString().substring(0, 10);
}

function getLastMondayOfAugust(year) {
    const lastDayOfAug = new Date(Date.UTC(year, 8, 0)); // day 0 of Sept = last day of Aug
    const dow = lastDayOfAug.getUTCDay(); // 0 = Sun ... 6 = Sat
    const diffToMonday = (dow + 6) % 7;
    return addDays(lastDayOfAug, -diffToMonday);
}

// Published Chinese New Year (Spring Festival) dates. These follow the lunisolar
// calendar and cannot be derived by formula, but the dates are published by
// astronomical almanacs years in advance, so a lookup table is reliable.
const CHINESE_NEW_YEAR_DATES = {
    2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26',
    2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11',
    2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08', 2036: '2036-01-28'
};

function generateDeterministicHolidays(year) {
    const easter = getEasterSunday(year);
    const maundyThursday = toDateStr(addDays(easter, -3));
    const goodFriday = toDateStr(addDays(easter, -2));
    const blackSaturday = toDateStr(addDays(easter, -1));

    const holidays = [
        // A. Regular Holidays
        { name: "New Year's Day", date: `${year}-01-01`, type: 'regular' },
        { name: 'Maundy Thursday', date: maundyThursday, type: 'regular' },
        { name: 'Good Friday', date: goodFriday, type: 'regular' },
        { name: 'Araw ng Kagitingan', date: `${year}-04-09`, type: 'regular' },
        { name: 'Labor Day', date: `${year}-05-01`, type: 'regular' },
        { name: 'Independence Day', date: `${year}-06-12`, type: 'regular' },
        { name: 'National Heroes Day', date: toDateStr(getLastMondayOfAugust(year)), type: 'regular' },
        { name: 'Bonifacio Day', date: `${year}-11-30`, type: 'regular' },
        { name: 'Christmas Day', date: `${year}-12-25`, type: 'regular' },
        { name: 'Rizal Day', date: `${year}-12-30`, type: 'regular' },

        // B. Special (Non-Working) Days
        { name: 'Ninoy Aquino Day', date: `${year}-08-21`, type: 'special_non_working' },
        { name: "All Saints' Day", date: `${year}-11-01`, type: 'special_non_working' },
        { name: 'Feast of the Immaculate Conception of Mary', date: `${year}-12-08`, type: 'special_non_working' },
        { name: 'Last Day of the Year', date: `${year}-12-31`, type: 'special_non_working' },
        { name: 'Black Saturday', date: blackSaturday, type: 'special_non_working' },
        { name: "All Souls' Day", date: `${year}-11-02`, type: 'special_non_working' },
        { name: 'Christmas Eve', date: `${year}-12-24`, type: 'special_non_working' },

        // C. Special (Working) Day
        { name: 'EDSA People Power Revolution Anniversary', date: `${year}-02-25`, type: 'special_working' }
    ];

    if (CHINESE_NEW_YEAR_DATES[year]) {
        holidays.push({ name: 'Chinese New Year', date: CHINESE_NEW_YEAR_DATES[year], type: 'special_non_working' });
    }

    return holidays;
}

// Read-only status check — deliberately does NOT call ensureHolidaysGeneratedForRange.
// The frontend uses this to show HR an explicit "Generate Holidays" reminder the first
// time a year is touched, before the silent auto-generation safety net (wired into
// /preview, GET /holidays, and POST /) has a chance to fill it in behind the scenes.
router.get('/holidays/status', async (req, res) => {
    try {
        const year = parseInt(req.query.year, 10);
        if (!year || year < 2020 || year > 2100) {
            return res.status(400).json({ error: 'A valid year is required.' });
        }

        const { count, error } = await supabase
            .from('holidays')
            .select('id', { count: 'exact', head: true })
            .gte('date', `${year}-01-01`)
            .lte('date', `${year}-12-31`);

        if (error) throw error;

        res.json({ year, generated: (count || 0) > 0, count: count || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================
// 2c. Last-resort auto-generation
//     This ONLY runs at the moment a payroll is actually saved (POST /), not
//     while browsing, previewing, or loading the calendar. Those read paths
//     used to also silently trigger this, but that caused a real bug: two
//     concurrent requests (the holiday-rate preview and the explicit status
//     check) could race each other, with the status check reading the table
//     a moment before the preview's silent insert committed — showing HR a
//     "not generated yet" banner and an "Active +X% rate" banner at the same
//     time, for the same year. Now the ONLY ways a year's holidays get
//     created are: (1) HR explicitly clicking "Generate Holidays", or (2)
//     this function, as a final safety net so payroll math is never silently
//     wrong even if that click was skipped somehow.
//
//     Uses an in-flight promise per year (not just a "done" flag) so that if
//     two payroll saves for the same never-generated year land at nearly the
//     same instant, the second one awaits the first's actual insert instead
//     of racing it and creating a duplicate set of holiday rows.
// ==============================================================================
const yearGenerationState = new Map(); // year -> 'done' | Promise

async function ensureHolidaysGeneratedForRange(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return;

    const startYear = parseInt(String(startDateStr).substring(0, 4), 10);
    const endYear = parseInt(String(endDateStr).substring(0, 4), 10);
    if (!startYear || !endYear) return;

    for (let year = startYear; year <= endYear; year++) {
        if (year < 2020 || year > 2100) continue;

        const existingState = yearGenerationState.get(year);
        if (existingState === 'done') continue;
        if (existingState instanceof Promise) {
            await existingState; // another concurrent call is already generating this year - wait for it, don't race it
            continue;
        }

        const generationPromise = (async () => {
            try {
                const { data: existingRows, error: checkError } = await supabase
                    .from('holidays')
                    .select('date')
                    .gte('date', `${year}-01-01`)
                    .lte('date', `${year}-12-31`)
                    .limit(1);

                if (checkError) throw checkError;

                if (existingRows && existingRows.length > 0) {
                    yearGenerationState.set(year, 'done');
                    return;
                }

                const candidates = generateDeterministicHolidays(year);
                const { error: insertError } = await supabase.from('holidays').insert(candidates);
                if (insertError) throw insertError;

                yearGenerationState.set(year, 'done');
                invalidateCache(['/api/payroll/holidays']);
                console.log(`[Holidays] Auto-generated ${candidates.length} DOLE holidays for ${year} (payroll save safety net).`);
            } catch (err) {
                // Never let this break the payroll save it's supporting - worst case,
                // that save just proceeds with whatever holidays already exist.
                yearGenerationState.delete(year); // allow a future attempt to retry, instead of getting stuck
                console.error(`[Holidays] Auto-generation failed for ${year}:`, err.message);
            }
        })();

        yearGenerationState.set(year, generationPromise);
        await generationPromise;
    }
}

router.post('/holidays/generate', requirePayrollManager, async (req, res) => {
    try {
        const year = parseInt(req.body.year, 10);
        if (!year || year < 2020 || year > 2100) {
            return res.status(400).json({ error: 'A valid year is required.' });
        }

        const candidates = generateDeterministicHolidays(year);
        const cnyMissing = !CHINESE_NEW_YEAR_DATES[year];

        const { data: existingRows } = await supabase
            .from('holidays')
            .select('date, name')
            .gte('date', `${year}-01-01`)
            .lte('date', `${year}-12-31`);

        const existingSet = new Set((existingRows || []).map(r => `${r.date}__${r.name}`));
        const toInsert = candidates.filter(h => !existingSet.has(`${h.date}__${h.name}`));

        let inserted = [];
        if (toInsert.length > 0) {
            const { data, error } = await supabase.from('holidays').insert(toInsert).select();
            if (error) throw error;
            inserted = data;
        }

        invalidateCache(['/api/payroll/holidays']);

        res.json({
            success: true,
            year,
            inserted_count: inserted.length,
            inserted,
            skipped_existing: candidates.length - toInsert.length,
            chinese_new_year_generated: !cnyMissing,
            reminder: cnyMissing
                ? `Chinese New Year was NOT generated - ${year} isn't in the lookup table (only 2025-2036 are covered). Add it manually once you have the published date, and add it to CHINESE_NEW_YEAR_DATES for next time. Eidul Fitr and Eidul Adha were also NOT generated - those are set by NCMF proclamation based on moon sighting, not a fixed formula.`
                : 'Eidul Fitr and Eidul Adha were NOT generated - those are set by NCMF proclamation based on moon sighting, not a fixed formula. Add them manually once the annual proclamation confirms the date.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 13th month report: every employee with payslips in the year, who has been paid, and who has not.
router.get('/13th-month-report', requirePayrollManager, async (req, res) => {
    try {
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();
        if (year < 2000 || year > 2100) return res.status(400).json({ error: 'Invalid year.' });

        const allColumns = 'id, employee_id, period_start, period_end, basic_pay, maternity_salary_differential, thirteenth_month_pay, remarks';
        const withoutColumn = 'id, employee_id, period_start, period_end, basic_pay, maternity_salary_differential, remarks';
        let columns = allColumns;
        const fetchPage = (from) => supabase
            .from('payrolls')
            .select(columns)
            .gte('period_end', `${year}-01-01`)
            .lte('period_end', `${year}-12-31`)
            .order('id', { ascending: true })
            .range(from, from + 999);

        const rows = [];
        for (let from = 0; ; from += 1000) {
            let { data, error } = await fetchPage(from);
            if (error && columns === allColumns && /thirteenth_month_pay/.test(error.message || '')) {
                // Column not migrated yet: fall back to the remarks note to tell who was paid.
                columns = withoutColumn;
                ({ data, error } = await fetchPage(from));
            }
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < 1000) break;
        }

        const byEmployee = new Map();
        for (const row of rows) {
            const key = String(row.employee_id);
            if (!byEmployee.has(key)) byEmployee.set(key, []);
            byEmployee.get(key).push(row);
        }

        const ids = [...byEmployee.keys()];
        const empMap = new Map();
        for (let i = 0; i < ids.length; i += 100) {
            const { data, error } = await supabase.from('employees').select('*').in('id', ids.slice(i, i + 100));
            if (error) throw error;
            for (const emp of data || []) empMap.set(String(emp.id), emp);
        }

        const paidAmountOf = (row) => {
            const stored = toSafeNumber(row.thirteenth_month_pay);
            if (stored > 0) return stored;
            const match = /13th Month Pay: ₱([\d,]+(?:\.\d+)?)/.exec(String(row.remarks || ''));
            return match ? toSafeNumber(match[1].replace(/,/g, '')) : 0;
        };

        const employees = ids.map((id) => {
            const employeeRows = byEmployee.get(id);
            const emp = empMap.get(id);
            const summary = aggregate13thMonthPay(employeeRows);
            const paidAmount = round2(employeeRows.reduce((sum, row) => sum + paidAmountOf(row), 0));
            const months = new Set(employeeRows.map(row => String(row.period_end).substring(0, 7))).size;
            return {
                employee_id: id,
                name: emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || id : id,
                department: emp?.department || null,
                position: emp?.job_title || emp?.position || null,
                payslips: employeeRows.length,
                months,
                total_basic: summary.totalBasicSalaryEarned,
                thirteenth_month_pay: summary.thirteenthMonthPay,
                is_tax_exempt: summary.isTaxExempt,
                taxable_excess: summary.taxableExcess,
                paid_amount: paidAmount,
                status: paidAmount > 0 ? 'paid' : 'unpaid',
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, year, employees });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. 13th month pay
router.get('/13th-month/:employee_id', async (req, res) => {
    try {
        const { employee_id } = req.params;
        if (!hasVerifiedManagerRole(req.user) && req.user?.id !== employee_id && req.user?.company_id !== employee_id && req.user?.auth_user_id !== employee_id) {
            return res.status(403).json({ error: 'You may only view your own 13th-month earnings.' });
        }
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();

        const { data: records, error } = await supabase
            .from('payrolls')
            .select('basic_pay, period_start, remarks')
            .eq('employee_id', employee_id)
            .gte('period_start', `${year}-01-01`)
            .lte('period_start', `${year}-12-31`);

        if (error) throw error;

        const result = aggregate13thMonthPay(records || []);
        res.json({ employee_id, year, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Holiday and payroll preview
router.post('/preview', async (req, res) => {
    try {
        const { employee_id, period_start, period_end } = req.body;
        if (!period_start || !period_end) {
            return res.status(400).json({ error: 'period_start and period_end are required.' });
        }

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        // Fetch holiday calendar for the period
        const { data: holidayList } = await supabase
            .from('holidays')
            .select('*')
            .gte('date', pStart)
            .lte('date', pEnd)
            .order('date', { ascending: true });

        // If no employee_id provided (e.g. batch mode or initial page load), return holiday calendar
        if (!employee_id) {
            const genericItems = (holidayList || []).map(h => ({
                date: h.date,
                holidayName: h.name,
                holidayType: h.type || 'regular',
                pay: 0
            }));
            return res.json({
                items: genericItems,
                totalHolidayPay: 0,
                approvedPaidLeaveDays: 0,
                paidLeaveRecords: [],
                isFactoryWorker: false,
                canOvertime: false
            });
        }

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .maybeSingle();

        if (!employee) {
            const genericItems = (holidayList || []).map(h => ({
                date: h.date,
                holidayName: h.name,
                holidayType: h.type || 'regular',
                pay: 0
            }));
            return res.json({
                items: genericItems,
                totalHolidayPay: 0,
                approvedPaidLeaveDays: 0,
                paidLeaveRecords: [],
                isFactoryWorker: false,
                canOvertime: false
            });
        }

        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);
        const isFactoryEmployee = `${employee.department || ''} ${employee.shift || ''}`.toLowerCase().includes('factory');
        if (effectiveMonthlySalary <= 0 && !isFactoryEmployee) {
            const genericItems = (holidayList || []).map(h => ({
                date: h.date,
                holidayName: h.name,
                holidayType: h.type || 'regular',
                pay: 0
            }));
            return res.json({
                items: genericItems,
                totalHolidayPay: 0,
                approvedPaidLeaveDays: 0,
                paidLeaveRecords: [],
                isFactoryWorker: false,
                canOvertime: false
            });
        }

        const lookbackStart = shiftDateStr(pStart, -HOLIDAY_LOOKBACK_DAYS);
        const [
            allAttendanceLogs,
            paidLeaveInfo,
            lookbackLeaveInfo,
            { data: lookbackHolidays }
        ] = await Promise.all([
            fetchPayrollAttendance(supabase, [employee_id], lookbackStart, pEnd),
            fetchApprovedPaidLeaves(employee_id, pStart, pEnd),
            fetchApprovedPaidLeaves(employee_id, lookbackStart, pEnd),
            supabase.from('holidays').select('*').gte('date', lookbackStart).lte('date', pEnd)
        ]);
        // Period-only view for display; the wider lookback set is used for holiday eligibility only.
        const attendanceLogs = (allAttendanceLogs || []).filter(l => getRecordDateKey(l) >= pStart);
        const creditAttendanceConflicts = getCreditAttendanceConflicts(lookbackLeaveInfo?.leaveRecords, allAttendanceLogs || []);
        const paidLeaveDates = getPaidLeaveDates(lookbackLeaveInfo?.leaveRecords);

        const restDays = getEmployeeRestDays(employee);

        const empDept = (employee?.department || '').toLowerCase();
        const empShift = (employee?.shift || '').toLowerCase();
        const isFactoryWorker = empDept.includes('factory') || empShift.includes('factory');

        let preview;
        if (isFactoryWorker) {
            // Piece-rate staff: holiday credit = average daily output wage of the last 7 actual working days
            // (minimum wage floor). piece_pay (optional) is this cutoff's piece pay from the browser.
            const factoryCtx = await fetchFactoryHolidayContext([employee_id], pStart, pEnd);
            const factoryHoliday = computeFactoryHolidayPay({
                employee,
                ctx: factoryCtx,
                holidays: holidayList || [],
                periodStart: pStart,
                periodEnd: pEnd,
                piecePay: toSafeNumber(req.body?.piece_pay),
                minimumDailyWage: (await getStatutorySettings()).minimum_daily_wage,
            });
            preview = {
                items: factoryHoliday.items,
                totalHolidayPay: factoryHoliday.total,
                holidayMissingRate: factoryHoliday.missingRate,
            };
        } else {
            preview = computeHolidayPayForPeriod({
                periodStart: pStart,
                periodEnd: pEnd,
                monthlySalary: effectiveMonthlySalary,
                holidayList: lookbackHolidays || holidayList || [],
                attendanceLogs: allAttendanceLogs || [],
                paidLeaveDates,
                restDays,
                canOvertime: !isFactoryWorker,
                // Keep the preview identical to what the saved payroll will pay.
                salaryIncludesHolidayPay: !isFactoryWorker,
                // Contractual rates are applied directly without synthetic monthly inflation
                dailyRate: getContractualDailyRate(employee),
                hourlyRate: toSafeNumber(employee.hourly_rate),
                salaryCoversRestDays: !getContractualDailyRate(employee),
                unpaidBreakHours: getUnpaidBreakHours(employee),
            });
        }

        const activeWorkPolicy = await getActiveWorkPolicy();
        const baseEligibility = evaluateAttendanceEligibility({
            attendanceLogs,
            approvedPaidLeaveDays: paidLeaveInfo?.totalPaidLeaveDays,
            periodStart: pStart,
            periodEnd: pEnd,
            exempt: isFactoryWorker,
        });
        const hasConflict = creditAttendanceConflicts.length > 0;
        const isBlocked = baseEligibility.blocked || hasConflict;
        const blockReason = hasConflict
            ? `Approved credited leave conflicts with attendance punches on ${creditAttendanceConflicts.join(', ')}. Reconcile the leave or attendance before calculating payroll.`
            : baseEligibility.reason;

        res.json({
            ...preview,
            tardiness: calculateTardiness(attendanceLogs, activeWorkPolicy, restDays),
            workPolicy: activeWorkPolicy,
            approvedPaidLeaveDays: paidLeaveInfo.totalPaidLeaveDays,
            paidLeaveRecords: paidLeaveInfo.leaveRecords,
            attendanceCheck: {
                ...baseEligibility,
                blocked: isBlocked,
                conflict: hasConflict,
                conflictDates: creditAttendanceConflicts,
                reason: blockReason,
                // Echoed so the screen can ignore a stale answer for a different employee/period.
                employee_id,
                period_start,
                period_end,
            },
            isFactoryWorker,
            canOvertime: !isFactoryWorker,
            policyNotice: isFactoryWorker
                ? 'Factory Worker: Fixed schedule 8:00 AM - 5:00 PM. Overtime prohibited per HR policy.'
                : 'Regular Worker: Fixed schedule. Overtime eligible.'
        });
    } catch (err) {
        console.error('Payroll preview error:', err);
        res.status(err.status || 400).json({ error: err.message });
    }
});

// 5. Compute and save payroll
const payrollListCache = cacheResponse(20);
router.get('/', (req, res, next) => {
    // Separately cached pages can combine old and new totals during a complete-list read.
    return req.query.view === 'list' ? next() : payrollListCache(req, res, next);
}, async (req, res) => {
    try {
        if (req.query.view !== undefined && req.query.view !== 'list') return res.status(400).json({ error: 'Invalid payroll list view.' });
        const compact = req.query.view === 'list';
        const paging = compact ? parseListQuery(req.query) : null;
        if (compact && !hasVerifiedManagerRole(req.user)) return res.status(403).json({ error: 'Administrative access is required.' });
        if (compact && ((req.query.year !== undefined && (typeof req.query.year !== 'string' || !/^\d{4}$/.test(req.query.year) || Number(req.query.year) < 1900 || Number(req.query.year) > 9998)) ||
            (req.query.month !== undefined && (typeof req.query.month !== 'string' || !/^(0?[1-9]|1[0-2])$/.test(req.query.month))))) {
            return res.status(400).json({ error: 'Invalid payroll month or year.' });
        }
        let query = supabase.from('payrolls').select('*, employees:employee_id(*)', compact ? { count: 'exact' } : undefined).order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }

        if (compact && (req.query.month || req.query.year)) {
            const year = Number(req.query.year || new Date().getFullYear());
            const month = Number(req.query.month || 1);
            const nextMonth = req.query.month ? month + 1 : 1;
            const nextYear = req.query.month && month < 12 ? year : year + 1;
            const start = `${year}-${String(month).padStart(2, '0')}-01`;
            const end = `${nextYear}-${String(nextMonth > 12 ? 1 : nextMonth).padStart(2, '0')}-01`;
            query = query.gte('period_start', start).lt('period_start', end);
        } else if (req.query.month) {
            const year = req.query.year || new Date().getFullYear();
            const monthStr = req.query.month.padStart(2, '0');
            query = query.gte('period_start', `${year}-${monthStr}-01`);
        }

        if (compact) {
            query = query.order('id', { ascending: false }).range((paging.page - 1) * paging.limit, paging.page * paging.limit - 1);
        } else if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
        }

        const { data, error, count } = await query;
        if (error) throw error;
        if (compact) {
            if (!Number.isSafeInteger(count) || count < 0) throw new Error('The payroll list could not be counted completely.');
            return res.json({ success: true, data: (data || []).map(payrollListRecord),
                meta: { page: paging.page, limit: paging.limit, total: count, totalPages: Math.max(1, Math.ceil(count / paging.limit)) } });
        }
        res.json(data);
    } catch (err) {
        res.status(err.status === 400 ? 400 : 500).json({ error: err.message });
    }
});

router.post('/', requirePayrollManager, async (req, res) => {
    try {
        const {
            employee_id,
            period_start,
            period_end,
            overtime_hours,
            regular_ot_hours,
            rest_day_ot_hours,
            working_days_in_year,
            sss_cash_benefit,
            maternity_leave_days,
            paternity_days,
            solo_parent_days,
            sil_days,
            pieces_produced,
            admin_id,
            apply_deductions,
            deduction_timing,
            pay_frequency = 'weekly' // Options: 'weekly' | 'semi-monthly' | 'monthly'
        } = req.body;

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        if (pay_frequency === 'weekly' && getCutoffSpanDays(pStart, pEnd) > MAX_WEEKLY_CUTOFF_DAYS) {
            return res.status(400).json({
                error: `Weekly payroll cutoff cannot exceed ${MAX_WEEKLY_CUTOFF_DAYS} days (received ${getCutoffSpanDays(pStart, pEnd)}).`
            });
        }

        const { data: existing } = await supabase
            .from('payrolls')
            .select('id')
            .eq('employee_id', employee_id)
            .eq('period_start', pStart)
            .eq('period_end', pEnd)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: 'A payslip for this employee in this pay period already exists.' });
        }

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        if (!employee) {
            return res.status(400).json({ error: 'Employee not found.' });
        }

        const offlineVersions = await getOfflinePayrollVersions(supabase, [employee_id]);

        const { data: terminationLog } = await supabase
            .from('disciplinary_logs')
            .select('id, date, reason')
            .eq('employee_id', employee_id)
            .eq('type', 'Termination')
            .maybeSingle();

        if (terminationLog) {
            return res.status(400).json({
                error: `Standard payroll cannot be processed for separated/terminated personnel (Terminated on ${terminationLog.date}). Use Final Pay / Clearance processing.`
            });
        }

        const department = (employee.department || '').toLowerCase();
        const shiftStr = (employee.shift || '').toLowerCase();
        const isFactory = department.includes('factory') || shiftStr.includes('factory');
        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);

        if (effectiveMonthlySalary <= 0 && !isFactory) {
            return res.status(400).json({ error: 'Cannot compute payroll: Employee has no salary, daily rate, or piece rate set.' });
        }

        // DOLE Standard Base Rate Formulas: Preserve contractual daily/hourly rates if present
        const annualWorkDays = toSafeNumber(working_days_in_year) || 261;
        const contractualDailyRate = getContractualDailyRate(employee);
        const hasContractualRate = contractualDailyRate > 0;
        const dailyRate = hasContractualRate
            ? contractualDailyRate
            : round2((effectiveMonthlySalary * 12) / annualWorkDays);
        const empHourlyRate = toSafeNumber(employee.hourly_rate);
        const hourlyRate = empHourlyRate > 0 ? empHourlyRate : round2(dailyRate / 8);
        const restDays = getEmployeeRestDays(employee);
        // Daily AND hourly staff are paid per working day (hourly x 8 = daily). Only monthly-salaried
        // staff use the yearly formula. Before, hourly-only staff fell into the monthly branch, where
        // hourly x 8 x 26 x 12 / 52 pays 6 days a week instead of the 5-day week.
        const weeklySalary = hasContractualRate
            ? round2(contractualDailyRate * WORK_DAYS_PER_WEEK)
            : round2((effectiveMonthlySalary * 12) / 52);

        let basicPay = 0;
        if (isFactory) {
            const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
            basicPay = round2(toSafeNumber(pieces_produced) * pieceRate);
        } else {
            basicPay = weeklySalary;
        }

        // Fetch Holidays, Attendances, HR-Approved Paid Leaves, and Suspensions in parallel
        const lookbackStart = shiftDateStr(pStart, -HOLIDAY_LOOKBACK_DAYS);
        await ensureHolidaysGeneratedForRange(lookbackStart, pEnd);
        const [
            { data: allHolidays },
            allAttendanceLogs,
            paidLeaveInfo,
            lookbackLeaveInfo,
            { data: suspensionLogs }
        ] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', lookbackStart).lte('date', pEnd),
            fetchPayrollAttendance(supabase, [employee_id], lookbackStart, pEnd),
            fetchApprovedPaidLeaves(employee_id, pStart, pEnd),
            fetchApprovedPaidLeaves(employee_id, lookbackStart, pEnd),
            supabase
                .from('disciplinary_logs')
                .select('id, date, reason, status')
                .eq('employee_id', employee_id)
                .eq('type', 'Suspension')
        ]);

        // Period-only views drive absences, lateness and the holiday list; the wider lookback set
        // (allHolidays / allAttendanceLogs / paidLeaveDates) is only used for holiday eligibility.
        const holidayList = (allHolidays || []).filter(h => h?.date && String(h.date).substring(0, 10) >= pStart);
        const attendanceLogs = (allAttendanceLogs || []).filter(l => getRecordDateKey(l) >= pStart);
        const creditAttendanceConflicts = getCreditAttendanceConflicts(lookbackLeaveInfo?.leaveRecords, allAttendanceLogs || []);
        if (creditAttendanceConflicts.length > 0) {
            return res.status(400).json({
                error: `Approved credited leave conflicts with attendance punches on ${creditAttendanceConflicts.join(', ')}. Reconcile the leave or attendance before calculating payroll.`
            });
        }
        const paidLeaveDates = getPaidLeaveDates(lookbackLeaveInfo?.leaveRecords);



        // Holiday pay is computed BEFORE the absence step so the absence step can see which
        // Regular Holidays were forfeited under DOLE Art. 94 (see forfeitedHolidayDates below).
        let holidayBreakdown;
        let totalHolidayPay;
        if (isFactory) {
            // Piece-rate staff: average daily output wage of the last 7 actual working days (minimum wage floor).
            const factoryCtx = await fetchFactoryHolidayContext([employee_id], pStart, pEnd);
            const factoryHoliday = computeFactoryHolidayPay({
                employee,
                ctx: factoryCtx,
                holidays: holidayList || [],
                periodStart: pStart,
                periodEnd: pEnd,
                piecePay: basicPay,
                minimumDailyWage: (await getStatutorySettings()).minimum_daily_wage,
            });
            holidayBreakdown = factoryHoliday.items;
            totalHolidayPay = factoryHoliday.total;
        } else {
            ({ items: holidayBreakdown, totalHolidayPay } = computeHolidayPayForPeriod({
                periodStart: pStart,
                periodEnd: pEnd,
                monthlySalary: effectiveMonthlySalary,
                holidayList: allHolidays || [],
                attendanceLogs: allAttendanceLogs || [],
                paidLeaveDates,
                restDays,
                canOvertime: !isFactory,
                // Non-factory staff are paid a fixed weekly salary that already covers a normal workday.
                salaryIncludesHolidayPay: !isFactory,
                // Contractual daily and hourly rates take precedence to preserve exact compensation terms
                dailyRate,
                hourlyRate,
                // Daily/hourly staff are paid for working days only; monthly salaries span rest days too.
                salaryCoversRestDays: !hasContractualRate,
                unpaidBreakHours: getUnpaidBreakHours(employee),
            }));
        }

        // Absence Deduction for Non-Factory Personnel under DOLE "No Work, No Pay" Principle
        let absenceDeduction = 0;
        let absenceNote = '';

        if (!isFactory) {
            const approvedPaidLeaveDays = paidLeaveInfo?.totalPaidLeaveDays || 0;
            const completedAttendanceDates = new Set();
            (attendanceLogs || []).forEach(log => {
                if (log && log.time_in && log.time_out) {
                    const d = log.date || (typeof log.time_in === 'string' ? log.time_in.split('T')[0] : null);
                    if (d) completedAttendanceDates.add(d);
                }
            });

            const expectedDates = getScheduledWorkDates(pStart, pEnd, restDays);
            const expectedWorkDays = expectedDates.length;
            const daysPresent = expectedDates.filter(date => completedAttendanceDates.has(date)).length;

            // Declared Special Non-Working Days and Regular Holidays are non-working by law; unworked days are not absences
            const forfeitedHolidayDates = new Set(
                (holidayBreakdown || [])
                    .filter(i => i.holidayType === 'regular' && !i.worked && !i.eligible && !i.isRestDay)
                    .map(i => i.date)
            );
            const isNonWorkingHolidayType = (t) => t === 'regular' || t === 'special_non_working';
            const nonWorkingHolidayDates = new Set(
                (holidayList || [])
                    .filter(h => h && h.date && isNonWorkingHolidayType(h.type))
                    .map(h => String(h.date).substring(0, 10))
                    .filter(hDate => !restDays.includes(new Date(`${hDate}T00:00:00`).getDay()))
                    .filter(hDate => !forfeitedHolidayDates.has(hDate))
            );
            let unworkedHolidays = 0;
            let unworkedSpecialNonWorking = 0;
            nonWorkingHolidayDates.forEach(hDate => {
                if (!completedAttendanceDates.has(hDate)) {
                    unworkedHolidays++;
                    const isSpecial = (holidayList || []).some(
                        h => h && String(h.date).substring(0, 10) === hDate && h.type === 'special_non_working'
                    );
                    if (isSpecial) unworkedSpecialNonWorking++;
                }
            });

            const unworkedDays = Math.max(0, expectedWorkDays - daysPresent - approvedPaidLeaveDays - unworkedHolidays);
            if (unworkedDays > 0) {
                absenceDeduction = round2(unworkedDays * dailyRate);
                basicPay = Math.max(0, round2(basicPay - absenceDeduction));
                absenceNote = ` [ABSENT: ${unworkedDays} unworked day(s) (-₱${absenceDeduction.toFixed(2)})]`;
            }
            if (unworkedSpecialNonWorking > 0) {
                if (PAY_UNWORKED_SPECIAL_NON_WORKING_DAY) {
                    absenceNote += ` [${unworkedSpecialNonWorking} Special Non-Working Day(s) not counted as absence - paid per company policy]`;
                } else {
                    // Not an absence, but unpaid under DOLE "no work, no pay".
                    const specialDayDeduction = round2(unworkedSpecialNonWorking * dailyRate);
                    basicPay = Math.max(0, round2(basicPay - specialDayDeduction));
                    absenceNote += ` [SPECIAL NON-WORKING DAY: ${unworkedSpecialNonWorking} day(s) unpaid - no work, no pay (-₱${specialDayDeduction.toFixed(2)})]`;
                }
            }
            if (forfeitedHolidayDates.size > 0) {
                absenceNote += ` [${forfeitedHolidayDates.size} Regular Holiday(s) forfeited - absent without pay the workday before]`;
            }
        }

        const activeWorkPolicy = await getActiveWorkPolicy();
        const tardiness = calculateTardiness(attendanceLogs, activeWorkPolicy, restDays);
        const lateDed = tardiness.deduction;

        // Suspension Deduction Handling
        let suspensionDeduction = 0;
        let suspensionNote = '';

        if (suspensionLogs && suspensionLogs.length > 0) {
            for (const susp of suspensionLogs) {
                const sStart = susp.date;
                const match = (susp.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
                const sEnd = match ? match[1] : susp.date;

                const oStart = sStart > pStart ? sStart : pStart;
                const oEnd = sEnd < pEnd ? sEnd : pEnd;

                if (oStart <= oEnd) {
                    const days = Math.round((new Date(oEnd) - new Date(oStart)) / (1000 * 60 * 60 * 24)) + 1;
                    if (days >= 7 || (pStart >= sStart && pEnd <= sEnd)) {
                        basicPay = 0;
                        suspensionNote = ` [FULL SUSPENSION: Unpaid period (${sStart} to ${sEnd})]`;
                    } else if (days > 0) {
                        suspensionDeduction = round2(dailyRate * days);
                        basicPay = Math.max(0, round2(basicPay - suspensionDeduction));
                        suspensionNote = ` [SUSPENSION: ${days} unpaid day(s) (-₱${suspensionDeduction.toFixed(2)})]`;
                    }
                }
            }
        }

        // Overtime Computation (DOLE Multipliers)
        let overtimePay = 0;
        if (!isFactory) {
            // Overtime worked on a holiday is already paid by computeHolidayPayForPeriod (hours over 8 at
            // the holiday rate x 1.3), so only ordinary overtime is entered here. Manual holiday OT
            // hours are no longer accepted: they paid the same hours a second time.
            // Ordinary overtime is 125%. Overtime worked on a rest day (not a holiday) is 130% x 130% = 169%
            // INSTEAD of 125%, never both, so the client sends rest-day hours separately.
            const regOtHours = toSafeNumber(regular_ot_hours || overtime_hours);
            const restDayOtHours = toSafeNumber(rest_day_ot_hours);
            overtimePay = round2(regOtHours * hourlyRate * 1.25 + restDayOtHours * hourlyRate * 1.69);
        }


        // Compute HR Approved Paid Leave Pay (Bypasses absence / missing timecard punches)
        const approvedPaidLeaveDays = paidLeaveInfo.totalPaidLeaveDays;
        const paidLeavePay = round2(approvedPaidLeaveDays * dailyRate);

        const paternityPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Paternity', daysTaken: paternity_days, dailyRate }).leavePay;
        const soloParentPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Solo Parent', daysTaken: solo_parent_days, dailyRate }).leavePay;
        if (toSafeNumber(sil_days) > 0) return res.status(400).json({ error: 'SIL pay comes from approved leave requests. Use a cash-out request for unused credits.' });
        const silPay = 0;
        const totalOtherLeavePay = round2(toSafeNumber(paternityPay) + toSafeNumber(soloParentPay) + toSafeNumber(silPay));

        let matDiffPay = 0;
        if (toSafeNumber(maternity_leave_days) > 0) {
            const matResult = calculateMaternityDifferential({
                monthlySalary: effectiveMonthlySalary,
                sssCashBenefit: sss_cash_benefit,
                leaveDays: maternity_leave_days,
            });
            matDiffPay = toSafeNumber(matResult.salaryDifferential);
        }

        const safeBasic = toSafeNumber(basicPay);
        const safeOt = toSafeNumber(overtimePay);
        const safeHoliday = toSafeNumber(totalHolidayPay);
        const safeLeave = toSafeNumber(totalOtherLeavePay);
        const safeMatDiff = toSafeNumber(matDiffPay);
        const safePaidLeavePay = toSafeNumber(paidLeavePay);
        const pendingCash = await fetchPendingSilCash(supabase, [employee_id], pEnd);
        const cash = { ...cashPayForEmployee(pay_frequency === 'weekly' ? pendingCash.requests : [], employee_id), available: pendingCash.available, leave_signature: payrollLeaveSignature(paidLeaveInfo.leaveRecords) };
        if ((req.body.expected_paid_leave_pay != null && Number(req.body.expected_paid_leave_pay) !== safePaidLeavePay) || (req.body.expected_sil_cash_pay != null && Number(req.body.expected_sil_cash_pay) !== cash.cash_pay)) return res.status(409).json({ error: 'Leave payments changed. Refresh the preview before saving.' });

        // 13th month pay: this year's basic pay / 12, added once, in the last cutoff of December.
        const thirteenthMonthPay = isLastCutoffOfDecember(pEnd)
            ? computeThirteenthMonthPay((await fetchYearPayslips([employee_id], pStart, pEnd)).get(String(employee_id)), safeBasic, safeMatDiff)
            : 0;

        // Combined Gross Pay: Basic + OT + Holiday Pay + Statutory Leaves + Maternity Differential + HR Approved Paid Leaves + 13th month
        const grossPay = round2(safeBasic + safeOt + safeHoliday + safeLeave + safeMatDiff + (isFactory ? safePaidLeavePay : 0) + cash.cash_pay + thirteenthMonthPay);

        // Deductions schedule: prorated contributions apply per cycle for weekly/semi-monthly, or month-end for monthly
        const periodEndDay = new Date(`${pEnd}T00:00:00`).getDate();
        // Weekly payroll: statutory is taken once a month, in the first cutoff that ends in the month (client policy).
        const shouldDeductStatutory = pay_frequency === 'weekly'
            ? (apply_deductions === false || deduction_timing === 'none' ? false : isFirstCutoffOfMonth(pEnd))
            : apply_deductions !== undefined
                ? Boolean(apply_deductions)
                : deduction_timing === 'none'
                    ? false
                    : deduction_timing
                        ? true
                        : (pay_frequency === 'monthly' ? periodEndDay >= 22 : true);

        let sssEE = 0;
        let sssER = 0;
        let sssEC = 0;
        let philHealthEE = 0;
        let philHealthER = 0;
        let pagIbigEE = 0;
        let pagIbigER = 0;

        if (shouldDeductStatutory) {
            // Fixed-salary employees use their salary; piece-rate workers use last month's average weekly pay
            // (this cycle's pay x4 when they have no earlier payslips).
            let contributionSalaryBase = effectiveMonthlySalary;
            if (isFactory && effectiveMonthlySalary <= 0) {
                const previousBases = pay_frequency === 'weekly' ? await fetchPreviousMonthBases(supabase, [employee], pEnd) : new Map();
                contributionSalaryBase = previousBases.get(String(employee.id)) ?? ((grossPay - cash.cash_pay - thirteenthMonthPay) * 4);
            }

            // Frequency Divisor (Weekly = 1: the full monthly amount is taken once, Semi-Monthly = 2, Monthly = 1)
            const divisor = pay_frequency === 'weekly' ? 1 : (pay_frequency === 'semi-monthly' ? 2 : 1);

            // Live rates & caps from the Statutory Settings screen (falls back to defaults)
            const statRates = await getStatutorySettings();

            // 1. SSS (EE/ER rates and max MSC from settings; EC fee P30/P10)
            const sssMsc = getSssMsc(contributionSalaryBase, statRates.sss_max_msc);
            sssEE = round2((sssMsc * (statRates.sss_employee_rate / 100)) / divisor);
            sssER = round2((sssMsc * (statRates.sss_employer_rate / 100)) / divisor);
            sssEC = sssMsc >= 15000 ? 30 : 10;

            // 2. PhilHealth (total premium rate split 50/50, salary floor & ceiling from settings)
            const phSalaryBase = Math.min(
                Math.max(contributionSalaryBase, statRates.philhealth_min_salary),
                statRates.philhealth_max_salary
            );
            philHealthEE = round2(((phSalaryBase * (statRates.philhealth_rate / 100)) / 2) / divisor);
            philHealthER = round2(((phSalaryBase * (statRates.philhealth_rate / 100)) / 2) / divisor);

            // 3. Pag-IBIG (EE/ER rates and monthly cap from settings)
            const monthlyPagIbigEE = Math.min(round2(contributionSalaryBase * (statRates.pagibig_employee_rate / 100)), statRates.pagibig_max_contribution);
            const monthlyPagIbigER = Math.min(round2(contributionSalaryBase * (statRates.pagibig_employer_rate / 100)), statRates.pagibig_max_contribution);
            pagIbigEE = round2(monthlyPagIbigEE / divisor);
            pagIbigER = round2(monthlyPagIbigER / divisor);
        }

        const totalStatutoryContributions = round2(sssEE + philHealthEE + pagIbigEE);

        // BIR Taxable Income & Withholding Tax (passed with pay_frequency)
        // 13th month pay is tax-exempt up to the ceiling; only the excess is taxable.
        const taxableGross = Math.max(0, grossPay - safeMatDiff - cash.cash_pay + cash.taxable_cash - Math.min(thirteenthMonthPay, THIRTEENTH_MONTH_TAX_EXEMPT_CEILING));
        const taxableIncome = Math.max(0, round2(taxableGross - totalStatutoryContributions - lateDed));
        const tax = calculateBIRWithholdingTax(taxableIncome, pay_frequency);

        // DEDUCTION CAP GUARDRAIL: Deductions can never exceed Gross Pay
        const rawDeductions = round2(totalStatutoryContributions + tax + lateDed);
        const totalDeductions = Math.min(rawDeductions, grossPay);
        const netPay = Math.max(0, round2(grossPay - totalDeductions));

        const baseRemarks = shouldDeductStatutory
            ? `2026 Statutory Applied (${pay_frequency.toUpperCase()}) - SSS: ${sssEE.toFixed(2)} (ER: ${sssER.toFixed(2)}, EC: ${sssEC}), PhilHealth: ${philHealthEE.toFixed(2)}, Pag-IBIG: ${pagIbigEE.toFixed(2)}, Tax: ${tax.toFixed(2)}`
            : `Regular Period (No Statutory Deductions) - Tax: ${tax.toFixed(2)}`;
        const paidLeaveNote = approvedPaidLeaveDays > 0 ? ` [Approved Paid Leave: ${approvedPaidLeaveDays} day(s), PHP ${safePaidLeavePay.toFixed(2)}${isFactory ? ' added to output pay' : ' included in basic pay'}]` : '';
        const otPolicyNote = isFactory && (toSafeNumber(overtime_hours) > 0 || toSafeNumber(regular_ot_hours) > 0)
            ? ' [Factory Worker: Overtime disallowed per HR policy (₱0.00)]'
            : '';
        const matDiffNote = safeMatDiff > 0 ? ` [Maternity Differential: +₱${safeMatDiff.toFixed(2)}]` : '';
        const thirteenthNote = thirteenthMonthPay > 0 ? ` [13th Month Pay: ₱${thirteenthMonthPay.toFixed(2)}]` : '';
        const appliedLateDed = Math.min(lateDed, Math.max(0, round2(grossPay - totalStatutoryContributions - tax)));
        const tardinessNote = tardiness.minutes > 0
            ? ` [Late: PHP ${appliedLateDed.toFixed(2)}; Tardiness calculation: ${tardiness.minutes} whole minute(s) beyond ${activeWorkPolicy.gracePeriodMinutes}m grace x PHP ${activeWorkPolicy.lateRatePerMinute} = PHP ${lateDed.toFixed(2)}${appliedLateDed < lateDed ? '; capped to available earnings' : ''}]`
            : '';
        const remarks = `${baseRemarks}${tardinessNote}${absenceNote}${suspensionNote}${paidLeaveNote}${matDiffNote}${thirteenthNote}${otPolicyNote}${cash.cash_pay > 0 ? ` [SIL cash payout: PHP ${cash.cash_pay.toFixed(2)}]` : ''}`;

        let insertPayload = {
            employee_id,
            period_start: pStart,
            period_end: pEnd,
            basic_pay: safeBasic,
            paid_leave_days: approvedPaidLeaveDays,
            paid_leave_pay: safePaidLeavePay,
            paid_leave_in_basic: !isFactory,
            sil_cash_pay: cash.cash_pay,
            leave_pay: safeLeave,
            maternity_salary_differential: safeMatDiff,
            thirteenth_month_pay: thirteenthMonthPay,
            overtime_pay: isFactory ? 0 : safeOt,
            holiday_pay: safeHoliday,
            holiday_breakdown: holidayBreakdown,
            deductions: totalDeductions,
            sss_deduction: sssEE,
            philhealth_deduction: philHealthEE,
            pagibig_deduction: pagIbigEE,
            tax_deduction: tax,
            remarks,
            net_pay: netPay,
            status: 'Paid'
        };

        if (offlineVersions.has(String(employee_id))) insertPayload.offline_attendance_version = offlineVersions.get(String(employee_id));
        const { data: insertedRecord, error: insertError } = await insertPayrollRow(insertPayload, cash, req.user.id, pay_frequency);

        if (insertError) throw insertError;
        const insertedPayrollId = insertedRecord?.id;
        if (cash.cash_pay > 0) refreshLeaveCredits(supabase, employee_id);

        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const avatarUrl = emp?.company_id && emp?.id
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        createNotification({
            target: employee_id,
            title: 'New Payslip Available',
            text: `Your payslip for ${pStart} to ${pEnd} is ready (Net Pay: ₱${netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
            type: 'payroll',
            sender_id: emp?.id,
            company_id: emp?.company_id,
            sender_name: 'HR & Payroll',
            sender_avatar: avatarUrl
        }).catch((err) => console.warn('[PAYROLL_NOTIF_WARN]', err.message));

        if (admin_id) {
            createAuditLog({
                log_name: 'payroll',
                description: `Computed weekly payroll for employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Payroll',
                subject_id: null,
                event: 'created',
                causer_id: admin_id,
                properties: { basic_pay: safeBasic, net_pay: netPay, holiday_pay: safeHoliday, paid_leave_pay: safePaidLeavePay }
            }).catch((err) => console.warn('[PAYROLL_AUDIT_WARN]', err.message));
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_CREATED', {
            id: insertedPayrollId,
            employee_id,
            gross_pay: grossPay,
            net_pay: netPay,
            period_start: pStart,
            period_end: pEnd,
            pay_frequency: pay_frequency
        });
        res.json({
            success: true,
            message: 'Payroll Computed & Saved Successfully!',
            gross_pay: grossPay,
            net_pay: netPay,
            holiday_pay: safeHoliday,
            paid_leave_pay: safePaidLeavePay,
            approved_paid_leave_days: approvedPaidLeaveDays,
            maternity_differential: safeMatDiff,
            thirteenth_month_pay: thirteenthMonthPay,
            employer_contributions: {
                sss_er: sssER,
                sss_ec: sssEC,
                philhealth_er: philHealthER,
                pagibig_er: pagIbigER,
            }
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// 6. Factory batch submission
router.post('/batch', requirePayrollManager, async (req, res) => {
    try {
        const { entries, period_start, period_end, pay_frequency = 'weekly' } = req.body;

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'No payroll entries were provided for this batch.' });
        }
        if (!period_start || !period_end) {
            return res.status(400).json({ error: 'period_start and period_end are required.' });
        }

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        if (pay_frequency === 'weekly' && getCutoffSpanDays(pStart, pEnd) > MAX_WEEKLY_CUTOFF_DAYS) {
            return res.status(400).json({
                error: `Weekly payroll cutoff cannot exceed ${MAX_WEEKLY_CUTOFF_DAYS} days (received ${getCutoffSpanDays(pStart, pEnd)}).`
            });
        }

        const empIds = entries.map(e => e.employee_id).filter(Boolean);
        const offlineVersions = await getOfflinePayrollVersions(supabase, empIds);

        // Optimized single-roundtrip prefetch for existing payrolls and employee metadata
        const [{ data: existingRecords, error: existingError }, { data: empList, error: employeeError }, attendanceLogs] = await Promise.all([
            supabase
                .from('payrolls')
                .select('employee_id')
                .in('employee_id', empIds)
                .eq('period_start', pStart)
                .eq('period_end', pEnd),
            supabase
                .from('employees')
                .select('*')
                .in('id', empIds),
            fetchPayrollAttendance(supabase, empIds, pStart, pEnd)
        ]);
        if (existingError || employeeError) throw existingError || employeeError;

        const existingSet = new Set((existingRecords || []).map(r => String(r.employee_id)));
        const empMap = new Map((empList || []).map(e => [String(e.id), e]));
        const leavePay = await fetchPayrollLeavePay(supabase, empList || [], pStart, pEnd);

        // Holiday pay is recomputed here from the holiday calendar and the worker's own clock-ins,
        // never trusted from the browser (same approach as tardiness).
        await ensureHolidaysGeneratedForRange(pStart, pEnd);
        const { data: batchHolidays, error: holidayError } = await supabase.from('holidays').select('*').gte('date', pStart).lte('date', pEnd);
        if (holidayError) throw holidayError;

        const attendanceByEmployee = new Map();
        for (const log of attendanceLogs) {
            const key = String(log.employee_id);
            if (!attendanceByEmployee.has(key)) attendanceByEmployee.set(key, []);
            attendanceByEmployee.get(key).push(log);
        }
        const activeWorkPolicy = await getActiveWorkPolicy();
        // Validate every worker before any inserts; a corrupt punch must not cause a partial batch.
        const tardinessByEmployee = new Map((empList || []).map(emp => [String(emp.id), calculateTardiness(attendanceByEmployee.get(String(emp.id)) || [], activeWorkPolicy, getEmployeeRestDays(emp))]));
        const batchStatRates = await getStatutorySettings();
        const batchPrevBases = await fetchPreviousMonthBases(supabase, empList || [], pEnd);
        const batchFactoryCtx = await fetchFactoryHolidayContext(empIds, pStart, pEnd);
        const batchYearPayslips = isLastCutoffOfDecember(pEnd) ? await fetchYearPayslips(empIds, pStart, pEnd) : new Map();

        const results = [];
        const skipped = [];
        const asyncTasks = [];

        for (const entry of entries) {
            const employee_id = entry.employee_id;
            if (!employee_id) { skipped.push({ employee_id, reason: 'Missing employee_id' }); continue; }

            if (existingSet.has(String(employee_id))) {
                skipped.push({ employee_id, reason: 'Payslip already exists for this period' });
                continue;
            }

            const tardiness = tardinessByEmployee.get(String(employee_id));
            if (!tardiness) { skipped.push({ employee_id, reason: 'Employee not found' }); continue; }
            const frequency = entry.pay_frequency || pay_frequency || 'weekly';
            const basicPay = Math.max(0, round2(toSafeNumber(entry.gross_pay)));
            const cash = { ...leavePay.data[employee_id], available: leavePay.cash_out_available };
            if (frequency !== 'weekly') { cash.cash_pay = 0; cash.taxable_cash = 0; cash.payout_ids = []; }
            if ((entry.expected_paid_leave_pay != null && Number(entry.expected_paid_leave_pay) !== cash.paid_leave_pay)
                || (entry.expected_sil_cash_pay != null && Number(entry.expected_sil_cash_pay) !== cash.cash_pay)) {
                skipped.push({ employee_id, reason: 'Leave payments changed. Refresh the preview before saving.' });
                continue;
            }
            const conflicts = getCreditAttendanceConflicts(cash.leaves, attendanceByEmployee.get(String(employee_id)) || []);
            if (conflicts.length > 0) {
                skipped.push({
                    employee_id,
                    reason: `Approved credited leave conflicts with attendance punches on ${conflicts.join(', ')}. Reconcile the leave or attendance before calculating payroll.`
                });
                continue;
            }
            const holiday = computeFactoryHolidayPay({
                employee: empMap.get(String(employee_id)),
                ctx: batchFactoryCtx,
                holidays: batchHolidays || [],
                periodStart: pStart,
                periodEnd: pEnd,
                piecePay: basicPay,
                minimumDailyWage: batchStatRates.minimum_daily_wage,
            });
            if (entry.expected_holiday_pay != null && Math.abs(Number(entry.expected_holiday_pay) - holiday.total) > 0.005) {
                skipped.push({ employee_id, reason: 'Holiday pay changed. Refresh the preview before saving.' });
                continue;
            }
            // 13th month pay (last cutoff of December): this year's basic pay / 12, recomputed here.
            const thirteenthMonthPay = isLastCutoffOfDecember(pEnd)
                ? computeThirteenthMonthPay(batchYearPayslips.get(String(employee_id)), basicPay)
                : 0;
            if (entry.expected_thirteenth_month_pay != null && Math.abs(Number(entry.expected_thirteenth_month_pay) - thirteenthMonthPay) > 0.005) {
                skipped.push({ employee_id, reason: '13th month pay changed. Refresh the preview before saving.' });
                continue;
            }
            const thirteenthSummary = thirteenthMonthPay > 0 ? ` | 13th Month Pay: ₱${thirteenthMonthPay.toFixed(2)}` : '';
            const grossPay = round2(basicPay + holiday.total + cash.paid_leave_pay + cash.cash_pay + thirteenthMonthPay);

            const divisor = frequency === 'weekly' ? 4 : (frequency === 'semi-monthly' ? 2 : 1);

            // SSS / PhilHealth / Pag-IBIG are recomputed here, never trusted from the browser (same approach as
            // holiday pay and tardiness). Weekly payroll takes them once a month, in the first cutoff that ends in
            // the month: the full monthly amount, based on the salary or last month's average weekly pay.
            // SIL cash is not contribution pay.
            const isWeekly = frequency === 'weekly';
            const thisCyclePay = basicPay + holiday.total + cash.paid_leave_pay;
            let statutory = { sss: 0, philHealth: 0, pagIbig: 0 };
            if (!isWeekly || isFirstCutoffOfMonth(pEnd)) {
                const monthlyBase = getStatutoryMonthlyBase(empMap.get(String(employee_id)), batchPrevBases) ?? thisCyclePay * (isWeekly ? 4 : divisor);
                statutory = computeEmployeeStatutory(monthlyBase, isWeekly ? 1 : divisor, batchStatRates);
            }
            const sssDed = statutory.sss;
            const phDed = statutory.philHealth;
            const pgbDed = statutory.pagIbig;
            const taxDed = calculateBIRWithholdingTax(Math.max(0, basicPay + holiday.total + cash.paid_leave_pay + cash.taxable_cash + Math.max(0, thirteenthMonthPay - THIRTEENTH_MONTH_TAX_EXEMPT_CEILING) - sssDed - phDed - pgbDed - tardiness.deduction), frequency);

            const appliedLateDed = Math.min(tardiness.deduction, Math.max(0, round2(grossPay - sssDed - phDed - pgbDed - taxDed)));
            const rawDeductions = round2(sssDed + phDed + pgbDed + taxDed + tardiness.deduction);

            // DEDUCTION CAP GUARDRAIL: Deductions can never exceed Gross Pay
            const totalDeductions = Math.min(rawDeductions, grossPay);
            const netPay = Math.max(0, round2(grossPay - totalDeductions));

            const opsSummary = Array.isArray(entry.operations_breakdown)
                ? entry.operations_breakdown.map(op => `${op.operation}: ₱${toSafeNumber(op.share).toFixed(2)}`).join(', ')
                : '';

            // Workers with missed days are audited on declared output basis
            const declaredOutput = Array.isArray(entry.declared_output) ? entry.declared_output : [];
            const absenceSummary = entry.is_absent
                ? ` | ABSENT ${toSafeNumber(entry.days_absent)} of ${toSafeNumber(entry.expected_working_days)} day(s), present ${toSafeNumber(entry.days_present)} - paid on declared output${declaredOutput.length > 0
                    ? `: ${declaredOutput.map(d => `${d.operation} ${toSafeNumber(d.declared_quantity)} x ₱${toSafeNumber(d.rate).toFixed(2)} = ₱${toSafeNumber(d.amount).toFixed(2)}`).join(', ')}`
                    : ''
                }`
                : '';

            const holidaySummary = holiday.items.length > 0
                ? ` | Holiday pay: ${holiday.items.map(i => `${i.holidayName || i.date} ${i.multiplier}x = ₱${i.pay.toFixed(2)}`).join(', ')}`
                : '';

            const remarks = `Factory Batch Payout (${frequency.toUpperCase()}) - Group: ${entry.group || 'N/A'}${opsSummary ? ` | Operations - ${opsSummary}` : ''}${absenceSummary}${holidaySummary}${thirteenthSummary} | Late: PHP ${appliedLateDed.toFixed(2)} | Tardiness calculation: ${tardiness.minutes} whole minute(s) beyond ${activeWorkPolicy.gracePeriodMinutes}m grace x PHP ${activeWorkPolicy.lateRatePerMinute} = PHP ${tardiness.deduction.toFixed(2)} | SSS: ₱${sssDed.toFixed(2)}, PhilHealth: ₱${phDed.toFixed(2)}, Pag-IBIG: ₱${pgbDed.toFixed(2)}, Tax: ₱${taxDed.toFixed(2)}`;

            let insertPayload = {
                employee_id,
                period_start: pStart,
                period_end: pEnd,
                basic_pay: basicPay,
                paid_leave_days: cash.paid_leave_days,
                paid_leave_pay: cash.paid_leave_pay,
                paid_leave_in_basic: false,
                sil_cash_pay: cash.cash_pay,
                holiday_pay: holiday.total,
                holiday_breakdown: holiday.items,
                thirteenth_month_pay: thirteenthMonthPay,
                overtime_pay: 0,
                deductions: totalDeductions,
                sss_deduction: sssDed,
                philhealth_deduction: phDed,
                pagibig_deduction: pgbDed,
                tax_deduction: taxDed,
                remarks,
                net_pay: netPay,
                status: 'Paid'
            };

            if (offlineVersions.has(String(employee_id))) insertPayload.offline_attendance_version = offlineVersions.get(String(employee_id));
            const { data: insertedRec, error: insertError } = await insertPayrollRow(insertPayload, cash, req.user.id, frequency);

            if (insertError) {
                skipped.push({ employee_id, reason: insertError.message });
                continue;
            }

            existingSet.add(String(employee_id));
            if (cash.cash_pay > 0) refreshLeaveCredits(supabase, employee_id);
            results.push({ id: insertedRec?.id, employee_id, net_pay: netPay });

            const emp = empMap.get(String(employee_id));
            const avatarUrl = emp?.company_id && emp?.id
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            asyncTasks.push(
                createNotification({
                    target: employee_id,
                    title: 'New Payslip Available',
                    text: `Your payslip for ${pStart} to ${pEnd} is ready (Net Pay: ₱${netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
                    type: 'payroll',
                    sender_id: emp?.id,
                    company_id: emp?.company_id,
                    sender_name: 'HR & Payroll',
                    sender_avatar: avatarUrl
                }).catch(() => { })
            );

            if (req.body.admin_id || entry.admin_id) {
                asyncTasks.push(
                    createAuditLog({
                        log_name: 'payroll',
                        description: `Computed factory batch payroll for employee ID ${employee_id}`,
                        subject_type: 'App\\Models\\Payroll',
                        subject_id: null,
                        event: 'created',
                        causer_id: req.body.admin_id || entry.admin_id,
                        properties: { gross_pay: grossPay, net_pay: netPay, group: entry.group }
                    }).catch(() => { })
                );
            }
        }

        // Fire-and-forget notifications and audit logging in parallel
        if (asyncTasks.length > 0) {
            Promise.allSettled(asyncTasks).catch(() => { });
        }

        if (results.length === 0) {
            return res.status(400).json({ error: 'No entries were saved.', skipped });
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_BATCH_DISTRIBUTED', {
            count: results.length,
            payroll_ids: results.map(r => r.id).filter(Boolean),
            employee_ids: results.map(r => r.employee_id),
            group_name: req.body.group_name || 'Line A',
            period_start: pStart,
            period_end: pEnd
        });
        res.json({
            success: true,
            message: `Factory batch payroll saved for ${results.length} worker(s).`,
            saved: results,
            skipped
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==============================================================================
// 7. Factory Production & Piece-Rate Logs (Enterprise Database Persistence)
// ==============================================================================

router.get('/factory-logs', async (req, res) => {
    try {
        const { group_name, production_group_id, period_start, period_end } = req.query;

        let resolvedGroupId = (production_group_id && isValidUUID(production_group_id)) ? production_group_id : null;
        if (!resolvedGroupId && group_name) {
            const { data: grp } = await supabase.from('production_groups').select('id').ilike('name', group_name.trim()).maybeSingle();
            if (grp?.id) resolvedGroupId = grp.id;
        }

        let query = supabase.from('factory_production_logs').select('*');

        if (resolvedGroupId) {
            query = query.eq('production_group_id', resolvedGroupId);
        }

        if (period_start && period_end) {
            query = query.eq('period_start', period_start).eq('period_end', period_end);
        } else if (period_start) {
            query = query.gte('period_start', period_start);
        }

        let { data, error } = await query.order('created_at', { ascending: true });
        if (error) throw error;

        // Enterprise Fallback: If no records match this exact cutoff period, load group's latest saved batch operations
        if ((!data || data.length === 0) && resolvedGroupId) {
            const { data: latestData } = await supabase
                .from('factory_production_logs')
                .select('*')
                .eq('production_group_id', resolvedGroupId)
                .order('updated_at', { ascending: false })
                .order('period_end', { ascending: false })
                .limit(30);

            if (latestData && latestData.length > 0) {
                const seenOps = new Set();
                const uniqueLatest = [];
                for (const row of latestData) {
                    if (!seenOps.has(row.operation)) {
                        seenOps.add(row.operation);
                        uniqueLatest.push(row);
                    }
                }
                data = uniqueLatest;
            }
        }

        // Map directly into the UI expected schema
        const rows = (data || []).map(r => ({
            id: r.id,
            operation: r.operation,
            stock_no: r.stock_no || 'Formal',
            quantity_in: String(r.quantity_in ?? 0),
            amount: String(r.amount ?? 0),
            assignedEmployeeIds: Array.isArray(r.assigned_worker_ids) ? r.assigned_worker_ids : []
        }));

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Error fetching factory production logs:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/factory-logs', requirePayrollManager, async (req, res) => {
    try {
        const {
            production_group_id,
            group_name,
            period_start,
            period_end,
            rows
        } = req.body;

        if (!rows || !Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'No factory operation rows provided' });
        }
        const inputError = getFactoryRowsError(rows);
        if (inputError) return res.status(400).json({ error: inputError });

        let resolvedGroupId = (production_group_id && isValidUUID(production_group_id)) ? production_group_id : null;
        if (!resolvedGroupId && group_name) {
            const { data: grp } = await supabase.from('production_groups').select('id').ilike('name', group_name.trim()).maybeSingle();
            if (grp?.id) resolvedGroupId = grp.id;
        }

        const pStart = period_start || new Date().toISOString().split('T')[0];
        const pEnd = period_end || new Date().toISOString().split('T')[0];

        // Fetch existing rows for this group to resolve existing stable UUIDs
        let existingRows = [];
        if (resolvedGroupId) {
            const { data: dbExisting } = await supabase
                .from('factory_production_logs')
                .select('id, operation, production_group_id, period_start, period_end')
                .eq('production_group_id', resolvedGroupId);
            existingRows = dbExisting || [];
        }

        const existingById = new Map(existingRows.map(r => [r.id, r]));
        const existingByOp = new Map(existingRows.map(r => [(r.operation || '').trim().toLowerCase(), r]));

        const upsertPayloads = rows.map(r => {
            const qty = parseFloat(r.quantity_in) || 0;
            const amt = parseFloat(r.amount) || 0;
            const opName = (r.operation || 'General Operation').trim();

            // Resolve stable UUID so row is edited in place in Supabase (no duplicate rows)
            let targetId = (r.id && isValidUUID(r.id) && existingById.has(r.id)) ? r.id : null;
            if (!targetId && existingByOp.has(opName.toLowerCase())) {
                targetId = existingByOp.get(opName.toLowerCase()).id;
            }

            const payload = {
                production_group_id: resolvedGroupId,
                period_start: pStart,
                period_end: pEnd,
                operation: opName,
                stock_no: r.stock_no || 'Formal',
                quantity_in: qty,
                amount: amt,
                total_amount: parseFloat((qty * amt).toFixed(2)),
                assigned_worker_ids: Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [],
                updated_at: new Date().toISOString()
            };

            if (targetId) {
                payload.id = targetId;
            }

            return payload;
        });

        const { data, error } = await supabase
            .from('factory_production_logs')
            .upsert(upsertPayloads, { onConflict: 'id' })
            .select('*');

        if (error) throw error;

        // Clean up any stale operations removed by the user for this group
        if (resolvedGroupId && existingRows.length > 0) {
            const savedIds = new Set((data || []).map(r => r.id));
            const staleIds = existingRows.filter(er => !savedIds.has(er.id)).map(er => er.id);
            if (staleIds.length > 0) {
                await supabase.from('factory_production_logs').delete().in('id', staleIds);
            }
        }

        const formattedRows = (data || []).map(r => ({
            id: r.id,
            operation: r.operation,
            stock_no: r.stock_no || 'Formal',
            quantity_in: String(r.quantity_in ?? 0),
            amount: String(r.amount ?? 0),
            assignedEmployeeIds: Array.isArray(r.assigned_worker_ids) ? r.assigned_worker_ids : []
        }));

        res.status(200).json({ success: true, count: data.length, data: formattedRows });
    } catch (err) {
        console.error('Error saving factory production logs:', err);
        res.status(500).json({ error: err.message });
    }
});

// Single-row direct update by UUID
router.put('/factory-logs/:id', requirePayrollManager, async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ error: 'Valid UUID required' });
        }

        const { operation, stock_no, quantity_in, amount, assignedEmployeeIds } = req.body;
        const updateData = { updated_at: new Date().toISOString() };

        if (operation !== undefined) updateData.operation = operation;
        if (stock_no !== undefined) updateData.stock_no = stock_no;
        if (quantity_in !== undefined) updateData.quantity_in = parseFloat(quantity_in) || 0;
        if (amount !== undefined) updateData.amount = parseFloat(amount) || 0;
        if (quantity_in !== undefined || amount !== undefined) {
            const qty = updateData.quantity_in !== undefined ? updateData.quantity_in : parseFloat(quantity_in) || 0;
            const amt = updateData.amount !== undefined ? updateData.amount : parseFloat(amount) || 0;
            updateData.total_amount = parseFloat((qty * amt).toFixed(2));
        }
        if (assignedEmployeeIds !== undefined) {
            updateData.assigned_worker_ids = Array.isArray(assignedEmployeeIds) ? assignedEmployeeIds : [];
        }

        const { data, error } = await supabase
            .from('factory_production_logs')
            .update(updateData)
            .eq('id', id)
            .select('*')
            .single();

        if (error) throw error;

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('FACTORY_LOG_UPDATED', { id: data.id });

        res.json({
            success: true,
            data: {
                id: data.id,
                operation: data.operation,
                stock_no: data.stock_no || 'Formal',
                quantity_in: String(data.quantity_in ?? 0),
                amount: String(data.amount ?? 0),
                assignedEmployeeIds: Array.isArray(data.assigned_worker_ids) ? data.assigned_worker_ids : []
            }
        });
    } catch (err) {
        console.error('Error updating single factory production log:', err);
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id.length > 128) {
            return res.status(400).json({ status: 'error', code: 'INVALID_ID', message: 'Invalid Payroll ID format.' });
        }

        const { data, error } = await supabase
            .from('payrolls')
            .select('*, employees:employee_id(*)')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Payroll record not found.' });
        if (!hasVerifiedManagerRole(req.user) && data.employee_id !== req.user?.id) return res.status(403).json({ error: 'You may only read your own payslip.' });

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/bulk-delete', requirePayrollManager, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids must be a non-empty array of payroll IDs.' });
        }
        if (ids.length > 200) {
            return res.status(400).json({ error: 'Cannot delete more than 200 records in a single request.' });
        }
        const invalidIds = ids.filter((id) => !isValidUUID(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({ error: `Invalid payroll ID format: ${invalidIds.join(', ')}` });
        }

        const actorId = req.user?.id || req.body?.admin_id || null;
        const validActorId = actorId && isValidUUID(actorId) ? actorId : null;

        const { data, error } = await supabase.rpc('delete_payroll_records_bulk', {
            p_payroll_ids: ids,
            p_actor_id: validActorId,
        });

        let deletedCount = ids.length;
        if (error) {
            console.error('delete_payroll_records_bulk RPC error:', error);
            const { error: directError, count } = await supabase.from('payrolls').delete({ count: 'exact' }).in('id', ids);
            if (directError) throw directError;
            deletedCount = count ?? ids.length;
        } else if (data && typeof data.deleted_count === 'number') {
            deletedCount = data.deleted_count;
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_BULK_DELETED', { ids });
        res.json({ success: true, deleted_count: deletedCount, message: `${deletedCount} payroll record(s) deleted successfully.` });
    } catch (err) {
        console.error('bulk-delete payroll error:', err);
        const isConflict = err.code === '23503' || err.code === 'P0001' || err.message?.includes('SIL_PAYROLL_LOCKED');
        res.status(isConflict ? 409 : 500).json({
            error: isConflict
                ? 'This payslip is locked or contains linked records that prevent deletion.'
                : err.message
        });
    }
});

router.delete('/:id', requirePayrollManager, async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ status: 'error', code: 'INVALID_ID', message: 'Invalid Payroll ID format.' });
        }

        const actorId = req.user?.id || req.body?.admin_id || null;
        const validActorId = actorId && isValidUUID(actorId) ? actorId : null;

        const { data, error } = await supabase.rpc('delete_payroll_record', {
            p_payroll_id: id,
            p_actor_id: validActorId,
        });

        if (error) {
            console.error('delete_payroll_record RPC error:', error);
            const { error: directError } = await supabase.from('payrolls').delete().eq('id', id);
            if (directError) throw directError;
        } else if (data && data.success === false) {
            return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: data.message || 'Payroll record not found.' });
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        broadcastPayrollUpdate('PAYROLL_DELETED', { id });
        res.json({ success: true, message: 'Payroll record deleted successfully.' });
    } catch (err) {
        console.error('delete payroll error:', err);
        const isConflict = err.code === '23503' || err.code === 'P0001' || err.message?.includes('SIL_PAYROLL_LOCKED');
        res.status(isConflict ? 409 : 500).json({
            error: isConflict
                ? 'This payslip is locked or contains linked records that prevent deletion.'
                : err.message
        });
    }
});

export default router;
