import express from 'express';
import { supabase } from '../supabaseClient.js';
import { checkRole, checkAdminOrOwnership } from '../middleware/authMiddleware.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';
import { Brain } from '../services/geminiBrain.js';
import { computeAttendanceSignals } from '../services/attendanceIntelligence.js';
import { isWorkforceEmployee, isAttendanceExempt, applyWorkforceFilter } from '../utils/workforce.js';
import { computeDisciplinaryStanding, isExoneratedOrCleared } from '../utils/disciplinaryStanding.js';

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const toDateStr = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

// ---- Lateness rule (matches the kiosk scanner in attendance.js) ----
// Call time is 8:00 AM Manila with NO grace period: any time-in after 8:00 AM is late.
// "Minutes late" is measured from 8:00 AM.
const _envInt = (v, d) => { const n = parseInt(v, 10); return Number.isNaN(n) ? d : n; };
const CALL_TIME_MINUTES = _envInt(process.env.CALL_TIME_HOUR, 8) * 60 + _envInt(process.env.CALL_TIME_MINUTE, 0);

/** Minutes since midnight (Asia/Manila) for an ISO timestamp, or null. */
function manilaMinutes(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
}

/** True when the punch is after the call time (8:00 AM). */
const isLateRecord = (r) => {
    const m = manilaMinutes(r?.time_in);
    return m !== null && m > CALL_TIME_MINUTES;
};

/**
 * Build the last N calendar date strings (oldest -> newest)
 */
function lastNDateStrings(n, endDate = new Date()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
        out.push(toDateStr(new Date(endDate.getTime() - i * DAY_MS)));
    }
    return out;
}

/**
 * In-memory computation of 7-day attendance volume trends
 */
function computeWeeklyTrendsFromRecords(records, totalEmployees) {
    const days = lastNDateStrings(7);
    const countsByDate = {};
    (records || []).forEach(r => {
        countsByDate[r.date] = (countsByDate[r.date] || 0) + 1;
    });

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return days.map(dateStr => {
        const count = countsByDate[dateStr] || 0;
        const value = totalEmployees > 0 ? Math.round((count / totalEmployees) * 100) : 0;
        const label = dayLabels[new Date(dateStr + 'T00:00:00').getDay()];
        return { day: label, date: dateStr, value };
    });
}

/**
 * In-memory computation of monthly attendance volume trends (5 weekly buckets)
 */
function computeMonthlyTrendsFromRecords(records, totalEmployees) {
    const WEEKS = 5;
    const days = lastNDateStrings(WEEKS * 7); // 35 days, oldest -> newest

    const countsByDate = {};
    (records || []).forEach(r => {
        countsByDate[r.date] = (countsByDate[r.date] || 0) + 1;
    });

    const buckets = [];
    for (let w = 0; w < WEEKS; w++) {
        const weekDays = days.slice(w * 7, w * 7 + 7);
        const totalCount = weekDays.reduce((sum, d) => sum + (countsByDate[d] || 0), 0);
        const value = totalEmployees > 0
            ? Math.round((totalCount / (weekDays.length * totalEmployees)) * 100)
            : 0;

        const rangeStart = new Date(weekDays[0] + 'T00:00:00');
        const rangeEnd = new Date(weekDays[weekDays.length - 1] + 'T00:00:00');
        const label = w === WEEKS - 1
            ? 'This Wk'
            : `${rangeStart.getDate()}-${rangeEnd.getDate()} ${rangeEnd.toLocaleString('default', { month: 'short' })}`;

        buckets.push({ day: label, date: weekDays[weekDays.length - 1], value });
    }

    return buckets;
}

/**
 * In-memory department scorecard over the last 30 days
 */
function computeDepartmentPunctualityFromRecords(records, empMap) {
    const thirtyDaysAgo = toDateStr(new Date(Date.now() - 30 * DAY_MS));
    const deptStats = {};

    (records || []).forEach(r => {
        if (r.date < thirtyDaysAgo) return;
        const emp = empMap.get(r.employee_id);
        if (emp && beforeHire(emp, r.date)) return;
        const dept = emp?.department || 'Unassigned';
        if (!deptStats[dept]) deptStats[dept] = { total: 0, late: 0 };
        deptStats[dept].total += 1;
        if (isLateRecord(r)) {
            deptStats[dept].late += 1;
        }
    });

    const gradeFor = (score) => {
        if (score >= 97) return 'A+';
        if (score >= 93) return 'A';
        if (score >= 88) return 'B+';
        if (score >= 83) return 'B';
        if (score >= 75) return 'C+';
        return 'C';
    };

    return Object.entries(deptStats)
        .map(([name, stats]) => {
            const score = stats.total > 0
                ? Math.round(((stats.total - stats.late) / stats.total) * 1000) / 10
                : 100;
            return { name, score, grade: gradeFor(score), sampleSize: stats.total };
        })
        .sort((a, b) => b.score - a.score);
}

/**
 * In-memory DOLE compliance checks computed from attendance records:
 *  1. Weekly Rest Day Rule (Labor Code Art. 91: 1 rest day per 6 work days)
 *  2. Regular Holiday Multipliers (200%)
 *
 * NOTE: the Night Shift Differential check was removed - the company no longer
 * runs night shifts, so this metric is retired.
 */
/** Hire date (YYYY-MM-DD) - same fallback the calendar uses; punches before it are ignored. */
const hireDateOf = (emp) => String(emp?.date_hired || emp?.created_at || '').substring(0, 10) || null;
const beforeHire = (emp, date) => { const h = hireDateOf(emp); return Boolean(h) && date < h; };
const dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);

/** Longest run of consecutive calendar dates in a sorted array of YYYY-MM-DD strings. */
function longestStreak(sortedDates) {
    if (!sortedDates.length) return { length: 0, start: null, end: null };
    let best = { length: 1, start: sortedDates[0], end: sortedDates[0] };
    let curStart = sortedDates[0];
    let cur = 1;
    for (let i = 1; i < sortedDates.length; i++) {
        if (dayNum(sortedDates[i]) - dayNum(sortedDates[i - 1]) === 1) {
            cur += 1;
        } else {
            cur = 1;
            curStart = sortedDates[i];
        }
        if (cur > best.length) best = { length: cur, start: curStart, end: sortedDates[i] };
    }
    return best;
}

/**
 * DOLE compliance checks (last 30 days):
 *  1. Weekly Rest Day Rule - everyone works Mon-Fri; flags 7+ consecutive worked days (no rest day).
 *  2. Regular Holiday Multipliers (200%) - lists who worked on a holiday.
 */
function computeDoleComplianceFromRecords(records, empMap = new Map(), holidayDates = new Set()) {
    const thirtyDaysAgo = toDateStr(new Date(Date.now() - 30 * DAY_MS));
    const todayCap = toDateStr(new Date());
    const filteredRecords = (records || []).filter(r => r.date >= thirtyDaysAgo && r.date <= todayCap && r.time_in);

    const datesByEmployee = {};
    filteredRecords.forEach(r => {
        if (beforeHire(empMap.get(r.employee_id), r.date)) return;
        if (!datesByEmployee[r.employee_id]) datesByEmployee[r.employee_id] = new Set();
        datesByEmployee[r.employee_id].add(r.date);
    });

    let compliantEmployees = 0;
    const restDayViolations = [];
    const employeeIds = Object.keys(datesByEmployee);

    employeeIds.forEach(empId => {
        const streak = longestStreak(Array.from(datesByEmployee[empId]).sort());
        if (streak.length <= 6) {
            compliantEmployees += 1;
        } else {
            const emp = empMap.get(empId);
            restDayViolations.push({
                employee_id: empId,
                name: emp ? `${emp.first_name} ${emp.last_name}` : 'Staff Member',
                department: emp?.department || 'Unassigned',
                consecutive_days: streak.length,
                streak_start_date: streak.start,
                streak_end_date: streak.end,
                filter: 'worked',
                audit_month: streak.end.slice(0, 7),
                id: `dole-rest:${empId}:${streak.length}:${streak.end}`
            });
        }
    });

    const restDayRatePercent = employeeIds.length > 0
        ? Math.round((compliantEmployees / employeeIds.length) * 100)
        : 100;

    // Holiday work: attendance rows tagged as a holiday
    const holidayByEmployee = {};
    const isHolidayWork = (r) => holidayDates.has(r.date) || (r.status || '').toLowerCase().includes('holiday');
    filteredRecords
        .filter(isHolidayWork)
        .forEach(r => {
            if (!holidayByEmployee[r.employee_id]) holidayByEmployee[r.employee_id] = [];
            holidayByEmployee[r.employee_id].push(r.date);
        });

    const holidayEmployees = Object.entries(holidayByEmployee).map(([empId, dates]) => {
        const emp = empMap.get(empId);
        const sorted = dates.sort();
        const last = sorted[sorted.length - 1];
        return {
            employee_id: empId,
            name: emp ? `${emp.first_name} ${emp.last_name}` : 'Staff Member',
            department: emp?.department || 'Unassigned',
            dates: sorted,
            filter: 'leave',
            audit_month: last.slice(0, 7),
            id: `dole-holiday:${empId}:${sorted.length}:${last}`
        };
    });

    return {
        restDay: {
            label: 'Weekly Rest Day Rule (1 in 6 days)',
            compliancePercent: restDayRatePercent,
            status: restDayViolations.length === 0 ? `${restDayRatePercent}% Compliant` : `${restDayViolations.length} Flagged`,
            violations: restDayViolations
        },
        holidayMultiplier: {
            label: 'Regular Holiday Multipliers (200%)',
            recordsFound: filteredRecords.filter(isHolidayWork).length,
            status: holidayEmployees.length > 0 ? `${holidayEmployees.length} Worked Holiday` : 'No holiday shifts logged',
            employees: holidayEmployees
        }
    };
}

/**
 * Burnout & attendance risk flags (last 30 days), each tied to an employee and the
 * attendance-audit filter that best shows the evidence:
 *  - consecutive: 7+ straight days with no rest day                -> 'worked'
 *  - absent:      2+ unexcused absences on scheduled days          -> 'absent'
 *  - late:        3+ late arrivals (after 8:00 AM, no grace)       -> 'late'
 * Schedule: everyone works Monday to Friday.
 */
function computeWorkforceRiskFlags(attendances, leaves, empMap, holidayDates = new Set()) {
    const todayStr = toDateStr(new Date());
    const windowStart = toDateStr(new Date(Date.now() - 30 * DAY_MS));
    const yesterdayNum = dayNum(todayStr) - 1;

    const worked = new Map();   // empId -> Set(dates)
    const lates = new Map();    // empId -> [dates]
    (attendances || []).forEach(a => {
        // Only real punches count (a record with no time_in isn't a worked day - same as the calendar)
        if (!a.time_in || a.date < windowStart || a.date > todayStr || !empMap.has(a.employee_id)) return;
        if (beforeHire(empMap.get(a.employee_id), a.date)) return;
        if (!worked.has(a.employee_id)) worked.set(a.employee_id, new Set());
        worked.get(a.employee_id).add(a.date);
        if (isLateRecord(a)) {
            if (!lates.has(a.employee_id)) lates.set(a.employee_id, []);
            lates.get(a.employee_id).push(a.date);
        }
    });

    const leaveDays = new Map(); // empId -> Set(dayNum)
    (leaves || []).forEach(l => {
        if (l.status !== 'Approved' || !l.employee_id || !l.start_date || !l.end_date) return;
        if (!leaveDays.has(l.employee_id)) leaveDays.set(l.employee_id, new Set());
        const set = leaveDays.get(l.employee_id);
        const from = Math.max(dayNum(l.start_date), dayNum(windowStart));
        const to = Math.min(dayNum(l.end_date), yesterdayNum);
        for (let d = from; d <= to; d++) set.add(d);
    });

    const flags = [];
    const sev = (n, high, med) => (n >= high ? 'High' : n >= med ? 'Medium' : 'Low');
    const mk = (emp, type, filter, count, startDate, endDate, reason, severity) => ({
        id: `${type}:${emp.id}:${count}:${endDate}`,
        employee_id: emp.id,
        employee_name: `${emp.first_name} ${emp.last_name}`,
        department: emp.department || 'Unassigned',
        type, filter, count,
        start_date: startDate, end_date: endDate,
        audit_month: endDate.slice(0, 7),
        reason, severity
    });

    empMap.forEach(emp => {
        const dates = worked.get(emp.id);
        if (!dates || dates.size === 0) return; // no activity in window: can't judge schedule
        const sorted = Array.from(dates).sort();

        // 1. Consecutive days without a rest day (everyone works Mon-Fri)
        const streak = longestStreak(sorted);
        if (streak.length >= 7) {
            flags.push(mk(emp, 'consecutive', 'worked', streak.length, streak.start, streak.end,
                `Worked ${streak.length} consecutive days without a rest day`,
                streak.length >= 10 ? 'High' : 'Medium'));
        }

        // 2. Absences - same rules as the Monthly Work Schedule calendar: a past scheduled
        //    work day (not a rest day, not a holiday) with no punch and no approved leave.
        //    Everyone works Monday to Friday, so Saturday and Sunday are rest days.
        const restDays = [0, 6];
        const leaveSet = leaveDays.get(emp.id) || new Set();
        const startNum = Math.max(dayNum(sorted[0]), dayNum(windowStart));
        const absentDates = [];
        for (let d = startNum; d <= yesterdayNum; d++) {
            const dow = new Date(d * DAY_MS).getUTCDay();
            if (restDays.includes(dow)) continue;
            const ds = toDateStr(new Date(d * DAY_MS));
            if (holidayDates.has(ds) || dates.has(ds) || leaveSet.has(d)) continue;
            absentDates.push(ds);
        }
        if (absentDates.length >= 2) {
            flags.push(mk(emp, 'absent', 'absent', absentDates.length, absentDates[0], absentDates[absentDates.length - 1],
                `${absentDates.length} absences in the last 30 days`,
                sev(absentDates.length, 5, 3)));
        }

        // 3. Frequent lates
        const lateDates = (lates.get(emp.id) || []).sort();
        if (lateDates.length >= 3) {
            flags.push(mk(emp, 'late', 'late', lateDates.length, lateDates[0], lateDates[lateDates.length - 1],
                `${lateDates.length} late arrivals in the last 30 days`,
                sev(lateDates.length, 8, 5)));
        }
    });

    const order = { High: 0, Medium: 1, Low: 2 };
    return flags.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.count - a.count));
}

/**
 * Weekly pay cycle: Monday through Sunday. Workers here are paid weekly (not
 * semi-monthly), so the forecaster projects a single work-week at a time instead
 * of a 1-15 / 16-end cutoff. Working days within the week exclude Sunday only
 * (6-day work week), matching the DOLE rest-day rule above.
 */
function getCutoffRange(refDate = new Date()) {
    const day = refDate.getDay(); // 0 = Sun ... 6 = Sat
    const diffToMonday = day === 0 ? 6 : day - 1;
    const start = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() - diffToMonday);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6); // Sunday

    const fmt = (d) => `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
    const label = start.getMonth() === end.getMonth()
        ? `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()}-${end.getDate()}`
        : `${fmt(start)} - ${fmt(end)}`; // handles a week that spans a month boundary

    return { start, end, label };
}

function countWorkingDays(start, end) {
    if (end < start) return 0;
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
        if (cursor.getDay() !== 0) count++;
        cursor.setDate(cursor.getDate() + 1);
    }
    return count;
}

/**
 * In-memory weekly payroll forecaster
 * Strictly computes payroll projections for active workforce employees (role === 'employee').
 * Guards, Admins, and HR personnel are completely excluded from headcount, compensation, and department breakdowns.
 */
function computePayrollForecastFromData(employees, attendances) {
    const today = new Date();
    const { start, end, label } = getCutoffRange(today);
    const startStr = toDateStr(start);
    const todayStr = toDateStr(today);
    const elapsedEnd = today < end ? today : end;

    const totalCutoffWorkingDays = countWorkingDays(start, end);
    const elapsedWorkingDays = countWorkingDays(start, elapsedEnd);
    const remainingWorkingDays = Math.max(0, totalCutoffWorkingDays - elapsedWorkingDays);

    const attByEmployee = {};
    (attendances || []).forEach(r => {
        if (r.date >= startStr && r.date <= todayStr) {
            if (!attByEmployee[r.employee_id]) attByEmployee[r.employee_id] = [];
            attByEmployee[r.employee_id].push(r);
        }
    });

    let actualPayToDate = 0;
    let projectedRemainingPay = 0;
    const deptTotals = {};
    let employeesWithPayrate = 0;

    (employees || []).forEach(emp => {
        // Strictly filter out HR, Admins, Security Guards, and non-workforce personnel
        if (isAttendanceExempt(emp)) return;
        const role = (emp.role || '').toLowerCase();
        if (role && role !== 'employee') return;
        const deptLower = (emp.department || '').toLowerCase();
        if (deptLower.includes('hr') || deptLower.includes('admin') || deptLower.includes('security')) return;
        const titleLower = (emp.job_title || emp.position || '').toLowerCase();
        if (titleLower.includes('guard') || titleLower.includes('security') || titleLower.includes('admin') || titleLower.includes('hr') || titleLower.includes('gate attendant')) return;

        const status = (emp.status || '').toLowerCase();
        if (status === 'inactive' || status === 'terminated' || status === 'suspended') return;

        const dailyRate = Number(emp.daily_rate) || (Number(emp.hourly_rate) ? Number(emp.hourly_rate) * 8 : 0);
        if (dailyRate <= 0) return;
        employeesWithPayrate += 1;

        const records = attByEmployee[emp.id] || [];

        let empActual = 0;
        records.forEach(r => {
            const rStatus = (r.status || '').toLowerCase();
            empActual += rStatus.includes('holiday') ? dailyRate * 2 : dailyRate;
        });

        const attendanceRate = elapsedWorkingDays > 0 ? Math.min(1, records.length / elapsedWorkingDays) : 1;
        const empProjectedRemaining = remainingWorkingDays * dailyRate * attendanceRate;

        actualPayToDate += empActual;
        projectedRemainingPay += empProjectedRemaining;

        const dept = emp.department || 'Unassigned';
        if (dept.toLowerCase().includes('hr') || dept.toLowerCase().includes('admin') || dept.toLowerCase().includes('security')) return;
        deptTotals[dept] = (deptTotals[dept] || 0) + empActual + empProjectedRemaining;
    });

    const projectedCutoffTotal = actualPayToDate + projectedRemainingPay;

    // Filter out departments with 0 or negative projected pay to eliminate zero-cost department clutter
    const deptBreakdown = Object.entries(deptTotals)
        .filter(([, total]) => Math.round(total) > 0)
        .map(([name, total]) => ({ name, projected: Math.round(total) }))
        .sort((a, b) => b.projected - a.projected);

    // Enterprise low-latency, straightforward insight (0ms deterministic calculation)
    let insight = null;
    if (employeesWithPayrate === 0 || projectedCutoffTotal === 0) {
        insight = 'No active workforce payroll projected for this cutoff.';
    } else if (deptBreakdown.length === 1) {
        const topDept = deptBreakdown[0];
        insight = `${topDept.name} accounts for 100% of projected cutoff costs at ₱${topDept.projected.toLocaleString()}.`;
    } else if (deptBreakdown.length > 1) {
        const topDept = deptBreakdown[0];
        const pct = Math.round((topDept.projected / projectedCutoffTotal) * 100);
        if (pct >= 80) {
            insight = `${topDept.name} accounts for ${pct}% of projected cutoff costs at ₱${topDept.projected.toLocaleString()}.`;
        } else {
            insight = `Projected cutoff payroll is ₱${projectedCutoffTotal.toLocaleString()}, led by ${topDept.name} (₱${topDept.projected.toLocaleString()}).`;
        }
    } else {
        insight = `Projected cutoff payroll is ₱${projectedCutoffTotal.toLocaleString()}.`;
    }

    return {
        cutoffLabel: label,
        cutoffStart: startStr,
        totalCutoffWorkingDays,
        elapsedWorkingDays,
        remainingWorkingDays,
        actualPayToDate: Math.round(actualPayToDate),
        projectedCutoffTotal: Math.round(projectedCutoffTotal),
        deptBreakdown,
        employeesWithPayrate,
        insight,
        generatedAt: new Date().toISOString()
    };
}

/**
 * Async standalone payroll forecaster for direct endpoint calls
 * Strictly queries active workforce employees and excludes HR, Admin, and Guards.
 */
async function computePayrollForecast() {
    const today = new Date();
    const { start } = getCutoffRange(today);
    const startStr = toDateStr(start);
    const todayStr = toDateStr(today);

    const [{ data: rawEmployees, error: empErr }, { data: attendance, error: attErr }] = await Promise.all([
        supabase
            .from('employees')
            .select('id, department, role, job_title, daily_rate, hourly_rate, shift, status, company_id')
            .not('company_id', 'is', null)
            .eq('role', 'employee'),
        supabase
            .from('attendances')
            .select('employee_id, date, status')
            .gte('date', startStr)
            .lte('date', todayStr)
    ]);

    if (empErr) throw empErr;
    if (attErr) throw attErr;

    const employees = (rawEmployees || []).filter(isWorkforceEmployee);

    return computePayrollForecastFromData(employees, attendance);
}

/**
 * Consolidated admin dashboard overview
 * Delivers KPI telemetry, trends, punctuality, and payroll forecast without blocking on AI generation.
 */
router.get('/overview', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = toDateStr(new Date());
        const thirtyFiveDaysAgo = toDateStr(new Date(Date.now() - 35 * DAY_MS));

        // 1. Fetch core metrics in 3 parallel ultra-light queries (no nested joins)
        const [
            { data: rawEmployees, error: empErr },
            { data: rawAttendances, error: attErr },
            { data: rawLeaves, error: leaveErr }
        ] = await Promise.all([
            applyWorkforceFilter(
                supabase
                    .from('employees')
                    .select('id, department, role, shift, company_id, first_name, last_name, daily_rate, hourly_rate, status, job_title, date_hired, created_at')
            ),
            supabase
                .from('attendances')
                .select('id, employee_id, date, status, created_at, time_in, time_out')
                .gte('date', thirtyFiveDaysAgo)
                .order('created_at', { ascending: false }),
            supabase
                .from('leave_requests')
                .select('employee_id, status, start_date, end_date')
        ]);

        if (empErr) throw empErr;
        if (attErr) throw attErr;
        if (leaveErr) throw leaveErr;

        // Company holidays (non-fatal: dashboard still loads if the table is unavailable)
        let holidayDates = new Set();
        try {
            const { data: rawHolidays } = await supabase.from('holidays').select('date').gte('date', thirtyFiveDaysAgo);
            holidayDates = new Set((rawHolidays || []).map(h => h.date));
        } catch { /* ignore */ }

        // Strictly workforce employees: excludes Admins, HR, and Security Guards
        const employees = (rawEmployees || []).filter(isWorkforceEmployee);
        const empMap = new Map(employees.map(e => [e.id, e]));

        // Filter attendances strictly to active workforce personnel
        const attendances = (rawAttendances || []).filter(att => empMap.has(att.employee_id));
        const leaves = rawLeaves || [];

        // 2. In-Memory Calculations & Map Lookups (< 1ms)
        const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };

        employees.forEach(emp => {
            const dept = emp.department || 'Other';
            if (dept === 'Factory') deptBreakdown.Factory++;
            else if (dept === 'Retail') deptBreakdown.Retail++;
            else if (dept === 'IT') deptBreakdown.IT++;
            else if (dept.includes('HR') || dept.includes('Admin')) deptBreakdown.HR++;
        });

        let presentTodayCount = 0;
        let lateTodayCount = 0;
        const recentLogs = [];

        attendances.forEach(att => {
            if (att.date === todayStr) {
                presentTodayCount++;
                if (isLateRecord(att)) {
                    lateTodayCount++;
                }
                if (recentLogs.length < 5) {
                    const emp = empMap.get(att.employee_id);
                    recentLogs.push({
                        ...att,
                        employees: emp ? {
                            id: emp.id,
                            company_id: emp.company_id,
                            first_name: emp.first_name,
                            last_name: emp.last_name,
                            department: emp.department,
                            shift: emp.shift
                        } : null
                    });
                }
            }
        });

        let onLeaveCount = 0;
        let pendingLeavesCount = 0;

        leaves.forEach(l => {
            if (l.status === 'New') pendingLeavesCount++;
            if (l.status === 'Approved' && l.start_date <= todayStr && l.end_date >= todayStr) {
                onLeaveCount++;
            }
        });

        const weeklyTrends = computeWeeklyTrendsFromRecords(attendances, employees.length);
        const monthlyTrends = computeMonthlyTrendsFromRecords(attendances, employees.length);
        const deptPunctuality = computeDepartmentPunctualityFromRecords(attendances, empMap);
        const doleCompliance = computeDoleComplianceFromRecords(attendances, empMap, holidayDates);

        // 3. Anomaly Signals & Health Assessment (Deterministic in-memory with empMap resolution)
        const signals = computeAttendanceSignals(attendances, empMap);
        const risk_flags = computeWorkforceRiskFlags(attendances, leaves, empMap, holidayDates);
        const general_health_assessment = risk_flags.length === 0
            ? 'All attendance patterns are within acceptable organizational thresholds.'
            : `${risk_flags.length} attendance pattern(s) flagged across ${empMap.size} active employees in the last 30 days.`;

        // 4. In-memory payroll forecast
        const forecast = computePayrollForecastFromData(employees, attendances);

        // 5. Cached AI briefing and insights (returns immediately if already generated)
        const cachedBriefing = Brain.Analytics.getCachedBriefing(todayStr);
        const cachedPayrollInsight = forecast ? Brain.Analytics.getCachedPayrollInsight(forecast.cutoffStart, forecast.projectedCutoffTotal) : null;
        const payrollData = forecast ? { ...forecast, insight: cachedPayrollInsight?.insight || forecast.insight } : null;

        // Background pre-warm: if briefing is not yet cached, generate asynchronously without blocking response
        if (!cachedBriefing) {
            setImmediate(() => {
                const briefingData = {
                    totalEmployees: employees.length || 1,
                    presentCount: presentTodayCount,
                    lateCount: lateTodayCount,
                    onLeaveCount,
                    absentCount: Math.max(0, (employees.length || 1) - presentTodayCount - onLeaveCount),
                    attendanceRate: Math.round((presentTodayCount / (employees.length || 1)) * 100),
                    departments: Object.entries(deptBreakdown).map(([name, count]) => ({ name, count }))
                };
                Brain.Analytics.generateWorkforceBriefing(briefingData, false, todayStr).catch(err => {
                    console.warn('[DASHBOARD_PREWARM] AI briefing pre-warm skipped:', err.message);
                });
            });
        }

        res.json({
            admin: {
                totalStaff: employees.length,
                deptBreakdown,
                presentTodayCount,
                lateTodayCount,
                onLeaveCount,
                pendingLeavesCount,
                recentLogs,
                weeklyTrends,
                monthlyTrends,
                deptPunctuality,
                doleCompliance
            },
            payrollData,
            aiData: cachedBriefing ? { briefing: cachedBriefing } : null,
            anomalyData: {
                report: {
                    ...signals,
                    risk_flags,
                    general_health_assessment
                }
            }
        });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Overview error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Dedicated Asynchronous AI Workforce Briefing & Analytics Endpoint
 * Enterprise concurrent execution: generates workforce briefing & payroll insight in parallel.
 */
router.get('/ai-briefing', checkRole('admin'), async (req, res) => {
    try {
        const forceFresh = req.query.fresh === 'true';
        const todayStr = toDateStr(new Date());

        // Instant cache hit (< 2ms) unless client explicitly requested fresh regeneration
        if (!forceFresh) {
            const cachedBriefing = Brain.Analytics.getCachedBriefing(todayStr);
            if (cachedBriefing) {
                let cachedPayrollInsight = null;
                try {
                    const forecast = await computePayrollForecast();
                    if (forecast) {
                        cachedPayrollInsight = Brain.Analytics.getCachedPayrollInsight(forecast.cutoffStart, forecast.projectedCutoffTotal);
                    }
                } catch {
                    // Non-blocking fallback
                }
                return res.json({ 
                    briefing: cachedBriefing,
                    payrollInsight: cachedPayrollInsight?.insight || null
                });
            }
        }

        // Parallel fetch of today's operational signals
        const [
            { data: rawEmployees },
            { data: rawAttendances },
            { data: rawLeaves }
        ] = await Promise.all([
            applyWorkforceFilter(
                supabase
                    .from('employees')
                    .select('id, department, role, status, job_title')
            ),
            supabase
                .from('attendances')
                .select('id, employee_id, date, status')
                .eq('date', todayStr),
            supabase
                .from('leave_requests')
                .select('status, start_date, end_date')
        ]);

        const employees = (rawEmployees || []).filter(isWorkforceEmployee);
        const empMap = new Map(employees.map(e => [e.id, e]));
        const attendances = (rawAttendances || []).filter(att => empMap.has(att.employee_id));
        const leaves = rawLeaves || [];

        const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };
        employees.forEach(emp => {
            const dept = emp.department || 'Other';
            if (dept === 'Factory') deptBreakdown.Factory++;
            else if (dept === 'Retail') deptBreakdown.Retail++;
            else if (dept === 'IT') deptBreakdown.IT++;
            else if (dept.includes('HR') || dept.includes('Admin')) deptBreakdown.HR++;
        });

        let presentTodayCount = 0;
        let lateTodayCount = 0;
        attendances.forEach(att => {
            presentTodayCount++;
            if (isLateRecord(att)) {
                lateTodayCount++;
            }
        });

        let onLeaveCount = 0;
        leaves.forEach(l => {
            if (l.status === 'Approved' && l.start_date <= todayStr && l.end_date >= todayStr) {
                onLeaveCount++;
            }
        });

        const totalEmployees = employees.length || 1;
        const absentCount = Math.max(0, totalEmployees - presentTodayCount - onLeaveCount);
        const attendanceRate = Math.round((presentTodayCount / totalEmployees) * 100);

        const briefingData = {
            totalEmployees,
            presentCount: presentTodayCount,
            lateCount: lateTodayCount,
            onLeaveCount,
            absentCount,
            attendanceRate,
            departments: Object.entries(deptBreakdown).map(([name, count]) => ({ name, count }))
        };

        // Concurrent execution: run workforce briefing and payroll insight in parallel
        const [briefing, payrollInsight] = await Promise.all([
            Brain.Analytics.generateWorkforceBriefing(briefingData, forceFresh, todayStr),
            (async () => {
                try {
                    const forecast = await computePayrollForecast();
                    if (!forecast) return null;
                    return await Brain.Analytics.generatePayrollInsight(forecast);
                } catch (err) {
                    console.warn('[DASHBOARD_ROUTE] Parallel payroll insight skipped:', err.message);
                    return null;
                }
            })()
        ]);

        res.json({ 
            briefing, 
            payrollInsight: payrollInsight?.insight || null 
        });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] AI Briefing error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Composite Employee Dashboard BFF Endpoint
export function createEmployeeDashboardHandler(client = supabase) {
    return async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            const { id } = req.params;
            const thirtyDaysAgo = toDateStr(new Date(Date.now() - 30 * DAY_MS));

            // Fetch employee attendance, latest payroll, profile, infractions, and leaves in parallel
            const [
                { data: attendanceData, error: attErr },
                { data: payrollData, error: payErr },
                { data: employee, error: empErr },
                { data: discData, error: discErr },
                { data: leaveData, error: leaveErr }
            ] = await Promise.all([
                client
                    .from('attendances')
                    .select('*')
                    .eq('employee_id', id)
                    .gte('date', thirtyDaysAgo)
                    .order('created_at', { ascending: false })
                    .limit(20),
                client
                    .from('payrolls')
                    .select('*')
                    .eq('employee_id', id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                client
                    .from('employees')
                    .select('id, first_name, last_name, company_id, shift, department, job_title, status, is_active, biometric_baseline_path, daily_rate, hourly_rate, medical_record_url, has_registered_biometrics, archived_at, separation_date, separation_type, separation_reason, separation_notes, created_at, updated_at')
                    .eq('id', id)
                    .maybeSingle(),
                client
                    .from('disciplinary_logs')
                    .select('*')
                    .eq('employee_id', id)
                    .order('created_at', { ascending: false })
                    .limit(50),
                client
                    .from('leave_requests')
                    .select('*')
                    .eq('employee_id', id)
                    .order('created_at', { ascending: false })
                    .limit(10)
            ]);

            if (attErr) throw attErr;
            if (payErr) throw payErr;
            if (empErr) throw empErr;
            if (discErr) throw discErr;
            if (leaveErr) throw leaveErr;
            if (!employee) return res.status(404).json({ error: 'Employee record not found.', code: 'EMPLOYEE_NOT_FOUND' });

            let employeeObj = employee ? { ...employee } : null;
            if (employeeObj) {
                const termLog = (discData || []).find(l => {
                    if (l.type !== 'Termination' || isExoneratedOrCleared(l)) return false;
                    const s = (l.status || '').toLowerCase();
                    return s !== 'resolved' && s !== 'overturned' && s !== 'dismissed' && s !== 'cancelled' && s !== 'closed';
                });
                const suspLog = (discData || []).find(l => {
                    if (l.type !== 'Suspension' || isExoneratedOrCleared(l)) return false;
                    const s = (l.status || '').toLowerCase();
                    return s !== 'resolved' && s !== 'overturned' && s !== 'dismissed' && s !== 'cancelled' && s !== 'closed';
                });

                // Strict mutually exclusive separation: Suspension (Temporary Hold) vs Termination (Archival)
                const status = String(employeeObj.status || '').toLowerCase();
                const isTerm = Boolean(
                    ['terminated', 'separated', 'archived'].includes(status) ||
                    Boolean(termLog) ||
                    Boolean(employeeObj.archived_at)
                );
                const isSusp = !isTerm && (status === 'suspended' || Boolean(suspLog));

                employeeObj.is_suspended = isSusp;
                employeeObj.is_terminated = isTerm;
                employeeObj.operational_status = isSusp ? 'Suspended' : (isTerm ? 'Terminated' : 'Active');

                const standing = computeDisciplinaryStanding({
                    isTerminated: isTerm,
                    isSuspended: isSusp,
                    status: employeeObj.status,
                    operational_status: employeeObj.operational_status,
                    disciplinaryLogs: discData || []
                });
                employeeObj.disciplinary_standing = standing;
                employeeObj.past_suspensions_count = standing.served_suspensions_count;
                employeeObj.served_suspensions_count = standing.served_suspensions_count;
                employeeObj.cleared_suspensions_count = standing.cleared_suspensions_count;
            }

            res.json({
                attendanceData: attendanceData || [],
                payrollData: payrollData || null,
                shiftData: employeeObj ? [{ ...employeeObj }] : [],
                employee: employeeObj,
                discData: discData || [],
                leaveData: leaveData || []
            });
        } catch (err) {
            console.error('[DASHBOARD_ROUTE] Employee dashboard error:', err.message);
            res.status(500).json({ error: 'Employee dashboard unavailable. Please try again.' });
        }
    };
}
router.get('/employee/:id', checkAdminOrOwnership, createEmployeeDashboardHandler());


/**
 * Wall-clock minutes-past-shift-start for a given ISO timestamp, in Asia/Manila time.
 * Returns null if timeInIso is missing.
 */
function computeLateMinutes(timeInIso) {
    const m = manilaMinutes(timeInIso);
    if (m === null) return null;
    return Math.max(0, m - CALL_TIME_MINUTES);
}

function formatLateLabel(minutes) {
    if (minutes === null) return 'N/A';
    if (minutes <= 0) return 'On time';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m late` : `${m}m late`;
}

/**
 * Full detail of today's attendance, split into present / late, for the
 * Present Rate and Late Arrivals dashboard drill-down modals.
 */
router.get('/attendance-today', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = toDateStr(new Date());

        const [{ data: rawAttendances, error: attErr }, { data: rawEmployees, error: empErr }] = await Promise.all([
            supabase
                .from('attendances')
                .select('id, employee_id, date, status, time_in, time_out')
                .eq('date', todayStr),
            applyWorkforceFilter(
                supabase
                    .from('employees')
                    .select('id, first_name, last_name, department, shift, role, job_title, company_id')
            )
        ]);

        if (attErr) throw attErr;
        if (empErr) throw empErr;

        const employees = (rawEmployees || []).filter(isWorkforceEmployee);
        const empMap = new Map(employees.map(e => [e.id, e]));

        const present = [];
        const late = [];

        (rawAttendances || []).forEach(att => {
            const emp = empMap.get(att.employee_id);
            if (!emp) return; // Strictly ignore non-workforce system operators

            const lateMinutes = computeLateMinutes(att.time_in);
            const entry = {
                id: att.id,
                employee_id: att.employee_id,
                company_id: emp.company_id,
                first_name: emp.first_name,
                last_name: emp.last_name,
                name: `${emp.first_name} ${emp.last_name}`,
                department: emp.department || 'Unassigned',
                time_in: att.time_in,
                time_out: att.time_out,
                status: att.status,
                lateMinutes,
                lateLabel: formatLateLabel(lateMinutes),
                isLate: isLateRecord(att)
            };
            present.push(entry);
            if (isLateRecord(att)) {
                late.push(entry);
            }
        });

        present.sort((a, b) => new Date(a.time_in) - new Date(b.time_in));
        late.sort((a, b) => (b.lateMinutes || 0) - (a.lateMinutes || 0));

        res.json({ date: todayStr, shiftStart: '8:00 AM', present, late });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Attendance-today error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/payroll-forecast', checkRole('admin'), cacheResponse(60), async (req, res) => {
    try {
        const forecast = await computePayrollForecast();
        const narrative = await Brain.Analytics.generatePayrollInsight(forecast).catch(() => null);
        res.json({ ...forecast, insight: narrative?.insight || forecast.insight });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Payroll forecast error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Optimized Single-Pass Admin Dashboard Telemetry
 * Consolidates 16 database roundtrips into 3 high-speed queries with in-memory aggregation.
 */
router.get('/admin', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = toDateStr(new Date());
        const thirtyFiveDaysAgo = toDateStr(new Date(Date.now() - 35 * DAY_MS));

        // Query dashboard statistics in parallel (no nested joins)
        const [
            { data: rawEmployees, error: empErr },
            { data: rawAttendances, error: attErr },
            { data: rawLeaves, error: leaveErr }
        ] = await Promise.all([
            applyWorkforceFilter(
                supabase
                    .from('employees')
                    .select('id, department, role, shift, company_id, first_name, last_name, job_title')
            ),
            supabase
                .from('attendances')
                .select('id, employee_id, date, status, created_at, time_in, time_out')
                .gte('date', thirtyFiveDaysAgo)
                .order('created_at', { ascending: false }),
            supabase
                .from('leave_requests')
                .select('status, start_date, end_date')
        ]);

        if (empErr) throw empErr;
        if (attErr) throw attErr;
        if (leaveErr) throw leaveErr;

        // Strictly workforce employees: excludes Admins, HR, and Security Guards
        const employees = (rawEmployees || []).filter(isWorkforceEmployee);
        const empMap = new Map(employees.map(e => [e.id, e]));

        // Filter attendances strictly to workforce personnel
        const attendances = (rawAttendances || []).filter(att => empMap.has(att.employee_id));
        const leaves = rawLeaves || [];

        // 1. Employee Department Breakdown
        const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };

        employees.forEach(emp => {
            const dept = emp.department || 'Other';
            if (dept === 'Factory') deptBreakdown.Factory++;
            else if (dept === 'Retail') deptBreakdown.Retail++;
            else if (dept === 'IT') deptBreakdown.IT++;
            else if (dept.includes('HR') || dept.includes('Admin')) deptBreakdown.HR++;
        });

        // 2. Today's Attendance Counters & Recent Logs
        let presentTodayCount = 0;
        let lateTodayCount = 0;
        const recentLogs = [];

        attendances.forEach(att => {
            if (att.date === todayStr) {
                presentTodayCount++;
                if (isLateRecord(att)) {
                    lateTodayCount++;
                }
                if (recentLogs.length < 5) {
                    const emp = empMap.get(att.employee_id);
                    recentLogs.push({
                        ...att,
                        employees: emp ? {
                            id: emp.id,
                            company_id: emp.company_id,
                            first_name: emp.first_name,
                            last_name: emp.last_name,
                            department: emp.department,
                            shift: emp.shift
                        } : null
                    });
                }
            }
        });

        // 3. Leave Requests Counters
        let onLeaveCount = 0;
        let pendingLeavesCount = 0;

        leaves.forEach(l => {
            if (l.status === 'New') {
                pendingLeavesCount++;
            }
            if (l.status === 'Approved' && l.start_date <= todayStr && l.end_date >= todayStr) {
                onLeaveCount++;
            }
        });

        // Calculate summary metrics
        const weeklyTrends = computeWeeklyTrendsFromRecords(attendances, employees.length);
        const monthlyTrends = computeMonthlyTrendsFromRecords(attendances, employees.length);
        const deptPunctuality = computeDepartmentPunctualityFromRecords(attendances, empMap);
        const doleCompliance = computeDoleComplianceFromRecords(attendances, empMap);

        res.json({
            totalStaff: employees.length,
            deptBreakdown,
            presentTodayCount,
            lateTodayCount,
            onLeaveCount,
            pendingLeavesCount,
            recentLogs,
            weeklyTrends,
            monthlyTrends,
            deptPunctuality,
            doleCompliance
        });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Admin dashboard error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;
