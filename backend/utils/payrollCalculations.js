/**
 * payrollCalculations.js
 * ------------------------------------------------------------------
 * Pure, side-effect-free DOLE (Philippines) payroll math:
 *   - String-to-number sanitization helpers (toSafeNumber, round2)
 *   - Regular & Special Holiday pay multipliers
 *   - RA 11210 Expanded Maternity Leave & Salary Differential Engine
 *   - Philippine Statutory Paid Leaves (Paternity, Solo Parent, SIL, VAWC, Magna Carta)
 *   - 13th Month Pay aggregation (basic salary + non-taxable maternity differential)
 */

// ---------------------------------------------------------------
// Data Sanitization & Math Helpers
// ---------------------------------------------------------------

/** Safely parses any input into a guaranteed finite Number to prevent string concatenation bugs. */
export function toSafeNumber(val, fallback = 0) {
    if (val === null || val === undefined || val === '') return fallback;
    const parsed = Number(val);
    return isNaN(parsed) ? fallback : parsed;
}

/** Rounds a numeric value to 2 decimal places safely. */
export function round2(n) {
    return Math.round((toSafeNumber(n) + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------
// Constants & Multipliers
// ---------------------------------------------------------------

export const HOLIDAY_TYPES = Object.freeze({
    REGULAR: 'regular',
    SPECIAL_NON_WORKING: 'special_non_working',
});

export const DOLE_DIVISOR = 21.75; // Standard PH monthly-to-daily factor
export const STANDARD_SHIFT_HOURS = 8;
export const HOLIDAY_OT_PREMIUM = 0.30;
export const THIRTEENTH_MONTH_TAX_EXEMPT_CEILING = 90000;

const MULTIPLIERS = Object.freeze({
    [HOLIDAY_TYPES.REGULAR]: {
        worked: 2.0,
        workedRestDay: 2.6,
        unworked: 1.0,
    },
    [HOLIDAY_TYPES.SPECIAL_NON_WORKING]: {
        worked: 1.3,
        workedRestDay: 1.5,
        unworked: 0,
    },
});

// ---------------------------------------------------------------
// Rate Helpers
// ---------------------------------------------------------------

/** Monthly salary -> { dailyRate, hourlyRate } using the DOLE 21.75 factor. */
export function deriveRates(monthlySalary) {
    const salary = toSafeNumber(monthlySalary);
    const dailyRate = round2(salary / DOLE_DIVISOR);
    const hourlyRate = round2(dailyRate / STANDARD_SHIFT_HOURS);
    return { dailyRate, hourlyRate };
}

// ---------------------------------------------------------------
// Statutory Leaves & Maternity Differential Engine
// ---------------------------------------------------------------

/**
 * Computes RA 11210 Expanded Maternity Leave Salary Differential.
 * Differential = Full Monthly Basic Salary - SSS Approved Cash Benefit.
 */
export function calculateMaternityDifferential({ monthlySalary, sssCashBenefit = 0, leaveDays = 105 }) {
    const safeSalary = toSafeNumber(monthlySalary);
    const safeSssBenefit = toSafeNumber(sssCashBenefit);
    const dailyRate = safeSalary / 30; // Calendar day divisor for statutory maternity benefit
    const fullBasicPayForLeave = round2(dailyRate * toSafeNumber(leaveDays, 105));

    const salaryDifferential = Math.max(0, round2(fullBasicPayForLeave - safeSssBenefit));

    return {
        fullBasicPayForLeave,
        sssCashBenefit: safeSssBenefit,
        salaryDifferential,
    };
}

/**
 * Computes additional Philippine Statutory Paid Leaves.
 */
export function calculateStatutoryLeavePay({ monthlySalary, leaveType, daysTaken = 0 }) {
    const { dailyRate } = deriveRates(monthlySalary);
    const safeDays = toSafeNumber(daysTaken);
    const leavePay = round2(dailyRate * safeDays);

    return {
        leaveType,
        daysTaken: safeDays,
        dailyRate,
        leavePay,
    };
}

// ---------------------------------------------------------------
// Date & Holiday Helpers
// ---------------------------------------------------------------

export function getPayPeriodDates(periodStart, periodEnd) {
    const dates = [];
    const cursor = new Date(`${periodStart}T00:00:00`);
    const end = new Date(`${periodEnd}T00:00:00`);
    if (isNaN(cursor.getTime()) || isNaN(end.getTime())) return dates;

    while (cursor <= end) {
        dates.push(formatDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function indexHolidays(holidayList = []) {
    const map = new Map();
    for (const h of holidayList) {
        if (h?.date) map.set(h.date, h);
    }
    return map;
}

export function isRestDay(dateStr, restDays = [0]) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return false;
    return restDays.includes(d.getDay());
}

export function wasPresentDayBefore(dateStr, attendanceByDate, restDays = [0]) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return true;

    const prev = new Date(d);
    do {
        prev.setDate(prev.getDate() - 1);
    } while (restDays.includes(prev.getDay()));

    const prevKey = formatDate(prev);
    const logs = attendanceByDate.get(prevKey) || [];
    return logs.some((l) => l && l.time_out);
}

// ---------------------------------------------------------------
// Core Per-Day Holiday Pay Calculation
// ---------------------------------------------------------------

export function computeDayPay({
    dateStr,
    hourlyRate,
    dailyRate,
    hoursWorked = 0,
    holidaysByDate,
    attendanceByDate,
    restDays = [0],
}) {
    const holiday = holidaysByDate.get(dateStr);
    if (!holiday) return null;

    const safeHoursWorked = toSafeNumber(hoursWorked);
    const worked = safeHoursWorked > 0;
    const restDayToday = isRestDay(dateStr, restDays);
    const regularHours = Math.min(safeHoursWorked, STANDARD_SHIFT_HOURS);
    const overtimeHours = Math.max(safeHoursWorked - STANDARD_SHIFT_HOURS, 0);
    const table = MULTIPLIERS[holiday.type];

    if (!table) {
        throw new Error(`Unknown holiday type "${holiday.type}" for ${dateStr}`);
    }

    if (!worked) {
        if (holiday.type === HOLIDAY_TYPES.SPECIAL_NON_WORKING) {
            return {
                date: dateStr,
                holidayType: holiday.type,
                holidayName: holiday.name || 'Special Non-Working Day',
                worked: false,
                isRestDay: restDayToday,
                eligible: false,
                regularHours: 0,
                overtimeHours: 0,
                multiplier: 0,
                pay: 0,
                breakdown: { basicHolidayPay: 0, overtimePay: 0, note: 'No work, no pay.' },
            };
        }

        const eligible = wasPresentDayBefore(dateStr, attendanceByDate, restDays);
        const pay = eligible ? round2(dailyRate) : 0;
        return {
            date: dateStr,
            holidayType: holiday.type,
            holidayName: holiday.name || 'Regular Holiday',
            worked: false,
            isRestDay: restDayToday,
            eligible,
            regularHours: 0,
            overtimeHours: 0,
            multiplier: eligible ? table.unworked : 0,
            pay,
            breakdown: {
                basicHolidayPay: pay,
                overtimePay: 0,
                note: eligible
                    ? 'Full holiday pay — present/on paid leave the workday before.'
                    : 'Forfeited — absent without pay the workday before the holiday.',
            },
        };
    }

    const multiplier = restDayToday ? table.workedRestDay : table.worked;
    const basicHolidayPay = toSafeNumber(hourlyRate) * multiplier * regularHours;
    const holidayHourlyRate = toSafeNumber(hourlyRate) * multiplier;
    const otHourlyRate = holidayHourlyRate * (1 + HOLIDAY_OT_PREMIUM);
    const overtimePay = otHourlyRate * overtimeHours;

    return {
        date: dateStr,
        holidayType: holiday.type,
        holidayName: holiday.name || (holiday.type === HOLIDAY_TYPES.REGULAR ? 'Regular Holiday' : 'Special Non-Working Day'),
        worked: true,
        isRestDay: restDayToday,
        eligible: true,
        regularHours,
        overtimeHours,
        multiplier,
        pay: round2(basicHolidayPay + overtimePay),
        breakdown: {
            basicHolidayPay: round2(basicHolidayPay),
            overtimePay: round2(overtimePay),
        },
    };
}

// ---------------------------------------------------------------
// Pay-Period Aggregation
// ---------------------------------------------------------------

export function computeHolidayPayForPeriod({
    periodStart,
    periodEnd,
    monthlySalary,
    holidayList = [],
    attendanceLogs = [],
    restDays = [0],
}) {
    const { dailyRate, hourlyRate } = deriveRates(monthlySalary);
    const holidaysByDate = indexHolidays(holidayList);
    const attendanceByDate = indexAttendanceByDate(attendanceLogs);

    const items = [];
    for (const dateStr of getPayPeriodDates(periodStart, periodEnd)) {
        if (!holidaysByDate.has(dateStr)) continue;

        const hoursWorked = hoursWorkedOn(dateStr, attendanceByDate);
        const result = computeDayPay({
            dateStr,
            hourlyRate,
            dailyRate,
            hoursWorked,
            holidaysByDate,
            attendanceByDate,
            restDays,
        });
        if (result) items.push(result);
    }

    const totalHolidayPay = round2(items.reduce((sum, i) => sum + toSafeNumber(i.pay), 0));
    return { items, totalHolidayPay };
}

function indexAttendanceByDate(logs = []) {
    const map = new Map();
    for (const log of logs) {
        const key = log?.date || (typeof log?.time_in === 'string' ? log.time_in.split('T')[0] : null);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(log);
    }
    return map;
}

function hoursWorkedOn(dateStr, attendanceByDate) {
    const logs = (attendanceByDate.get(dateStr) || []).filter((l) => l && l.time_out);
    if (logs.length === 0) return 0;
    return logs.reduce((sum, l) => {
        const timeIn = new Date(l.time_in);
        const timeOut = new Date(l.time_out);
        if (isNaN(timeIn.getTime()) || isNaN(timeOut.getTime())) return sum;
        return sum + (timeOut - timeIn) / (1000 * 60 * 60);
    }, 0);
}

// ---------------------------------------------------------------
// DOLE 13th Month Pay Aggregator (PD 851)
// ---------------------------------------------------------------

export function aggregate13thMonthPay(payrollRecords = []) {
    const totalBasicSalaryEarned = round2(
        payrollRecords.reduce((sum, r) => {
            const basic = toSafeNumber(r.basic_pay);
            const matDiff = toSafeNumber(r.maternity_salary_differential);
            return sum + basic + matDiff;
        }, 0)
    );

    const thirteenthMonthPay = round2(totalBasicSalaryEarned / 12);
    const isTaxExempt = thirteenthMonthPay <= THIRTEENTH_MONTH_TAX_EXEMPT_CEILING;
    const taxableExcess = isTaxExempt
        ? 0
        : round2(thirteenthMonthPay - THIRTEENTH_MONTH_TAX_EXEMPT_CEILING);

    return {
        totalBasicSalaryEarned,
        payPeriodsCounted: payrollRecords.length,
        thirteenthMonthPay,
        isTaxExempt,
        taxableExcess,
    };
}