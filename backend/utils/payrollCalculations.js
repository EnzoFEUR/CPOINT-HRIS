/**
 * payrollCalculations.js
 * ------------------------------------------------------------------
 * Pure, side-effect-free DOLE (Philippines) payroll math:
 *   - Regular Holiday pay (worked / unworked / rest-day / OT)
 *   - Special Non-Working Day pay (worked / unworked / rest-day / OT)
 *   - 13th Month Pay aggregation (basic-salary-only, tax-exempt check)
 *
 * Framework-agnostic on purpose: no Supabase, no React, no fetch calls.
 * Import this from the Express route (authoritative calculation) and,
 * optionally, from the React app (for a live preview before submit).
 *
 * DOLE reference multipliers (Labor Code, Art. 94-95; Wage Order /
 * DOLE Labor Advisory on holiday pay rules):
 *
 *   Regular Holiday
 *     unworked  -> 100% of daily rate (conditioned on presence/paid
 *                  leave the workday immediately before the holiday)
 *     worked    -> 200% of hourly rate for the first 8 hours
 *     worked + rest day -> 260% of hourly rate for the first 8 hours
 *     OT        -> +30% of the applicable holiday hourly rate
 *
 *   Special Non-Working Day
 *     unworked  -> 0% ("no work, no pay")
 *     worked    -> 130% of hourly rate for the first 8 hours
 *     worked + rest day -> 150% of hourly rate for the first 8 hours
 *     OT        -> +30% of the applicable holiday hourly rate
 * ------------------------------------------------------------------
 */

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------

export const HOLIDAY_TYPES = Object.freeze({
    REGULAR: 'regular',
    SPECIAL_NON_WORKING: 'special_non_working',
});

export const DOLE_DIVISOR = 21.75; // standard PH monthly-to-daily divisor
export const STANDARD_SHIFT_HOURS = 8;
export const HOLIDAY_OT_PREMIUM = 0.30; // +30% of the holiday hourly rate
export const THIRTEENTH_MONTH_TAX_EXEMPT_CEILING = 90000;

const MULTIPLIERS = Object.freeze({
    [HOLIDAY_TYPES.REGULAR]: {
        worked: 2.0,
        workedRestDay: 2.6,
        unworked: 1.0, // conditioned on eligibility, see computeDayPay
    },
    [HOLIDAY_TYPES.SPECIAL_NON_WORKING]: {
        worked: 1.3,
        workedRestDay: 1.5,
        unworked: 0, // "no work, no pay"
    },
});

// ---------------------------------------------------------------
// Rate helpers
// ---------------------------------------------------------------

/** Monthly salary -> { dailyRate, hourlyRate } using the DOLE 21.75 divisor. */
export function deriveRates(monthlySalary) {
    const salary = Number(monthlySalary) || 0;
    const dailyRate = salary / DOLE_DIVISOR;
    const hourlyRate = dailyRate / STANDARD_SHIFT_HOURS;
    return { dailyRate, hourlyRate };
}

// ---------------------------------------------------------------
// Date / holiday-list helpers
// ---------------------------------------------------------------

/** Inclusive list of 'YYYY-MM-DD' strings between start and end. */
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

/** Build a Map<'YYYY-MM-DD', holidayRecord> for O(1) lookups. */
export function indexHolidays(holidayList = []) {
    const map = new Map();
    for (const h of holidayList) {
        if (h?.date) map.set(h.date, h);
    }
    return map;
}

/**
 * Is `dateStr` a rest day for this employee?
 * Falls back to Sunday-only until per-employee rest-day schedules exist
 * (e.g. an `employees.rest_days` int[] column, 0=Sun...6=Sat).
 */
export function isRestDay(dateStr, restDays = [0]) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return false;
    return restDays.includes(d.getDay());
}

/**
 * Did the employee work (or have an approved paid leave) on the workday
 * immediately preceding `dateStr`? Required for unworked-regular-holiday
 * eligibility. `attendanceByDate` is a Map<'YYYY-MM-DD', log[]>.
 *
 * NOTE: paid-leave records aren't modeled in the current schema — once a
 * `leaves` table exists, OR its approved dates in here.
 */
export function wasPresentDayBefore(dateStr, attendanceByDate, restDays = [0]) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (isNaN(d.getTime())) return true; // fail-open: don't silently forfeit pay on bad input

    // Walk back over the employee's rest day(s) to find the prior workday.
    const prev = new Date(d);
    do {
        prev.setDate(prev.getDate() - 1);
    } while (restDays.includes(prev.getDay()));

    const prevKey = formatDate(prev);
    const logs = attendanceByDate.get(prevKey) || [];
    return logs.some((l) => l && l.time_out);
}

// ---------------------------------------------------------------
// Core per-day holiday pay calculation
// ---------------------------------------------------------------

/**
 * Compute holiday pay for a single calendar date.
 *
 * @param {object} params
 * @param {string}  params.dateStr        'YYYY-MM-DD'
 * @param {number}  params.hourlyRate
 * @param {number}  params.dailyRate
 * @param {number}  params.hoursWorked     actual hours rendered that day (0 if absent)
 * @param {Map}     params.holidaysByDate  from indexHolidays()
 * @param {Map}     params.attendanceByDate from indexAttendanceByDate()
 * @param {number[]} [params.restDays]     day-of-week ints that are rest days
 *
 * @returns {null|{
 *   date: string, holidayType: string, holidayName: string,
 *   worked: boolean, isRestDay: boolean, eligible: boolean,
 *   regularHours: number, overtimeHours: number,
 *   multiplier: number, pay: number,
 *   breakdown: { basicHolidayPay: number, overtimePay: number }
 * }}  null when `dateStr` is not a holiday at all.
 */
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

    const worked = hoursWorked > 0;
    const restDayToday = isRestDay(dateStr, restDays);
    const regularHours = Math.min(hoursWorked, STANDARD_SHIFT_HOURS);
    const overtimeHours = Math.max(hoursWorked - STANDARD_SHIFT_HOURS, 0);
    const table = MULTIPLIERS[holiday.type];

    if (!table) {
        throw new Error(`Unknown holiday type "${holiday.type}" for ${dateStr}`);
    }

    // --- Unworked ---------------------------------------------------
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

        // Regular holiday, unworked: 100% IF present/on paid leave the workday before.
        const eligible = wasPresentDayBefore(dateStr, attendanceByDate, restDays);
        const pay = eligible ? dailyRate : 0;
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

    // --- Worked -------------------------------------------------------
    const multiplier = restDayToday ? table.workedRestDay : table.worked;
    const basicHolidayPay = hourlyRate * multiplier * regularHours;

    const holidayHourlyRate = hourlyRate * multiplier;
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
// Pay-period aggregation
// ---------------------------------------------------------------

/**
 * Walk every date in [periodStart, periodEnd], flag the ones that are
 * holidays, and return both the itemized list and the period total.
 *
 * @param {object} params
 * @param {string} params.periodStart
 * @param {string} params.periodEnd
 * @param {number} params.monthlySalary
 * @param {Array}  params.holidayList      raw rows from the `holidays` table
 * @param {Array}  params.attendanceLogs   raw rows from the `attendance` table (this employee, this period)
 * @param {number[]} [params.restDays]
 */
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

    const totalHolidayPay = round2(items.reduce((sum, i) => sum + i.pay, 0));
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
// 13th Month Pay
// ---------------------------------------------------------------

/**
 * Aggregate an employee's 13th month pay for a calendar year.
 *
 * Per DOLE (PD 851): 13th month pay = total BASIC salary actually earned
 * within the calendar year / 12. Overtime pay, holiday premiums, night
 * differentials, and allowances are excluded — so this function only
 * ever sums `basic_pay`, never `overtime_pay`, `holiday_pay`, or
 * `deductions`.
 *
 * @param {Array<{basic_pay:number, period_start:string}>} payrollRecords
 *        Payroll rows for one employee, already filtered to the target
 *        calendar year by the caller (e.g. a `.gte/.lte` on period_start).
 */
export function aggregate13thMonthPay(payrollRecords = []) {
    const totalBasicSalaryEarned = round2(
        payrollRecords.reduce((sum, r) => sum + (Number(r.basic_pay) || 0), 0)
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

// ---------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}