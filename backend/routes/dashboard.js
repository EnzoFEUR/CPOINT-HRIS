import express from 'express';
import { supabase } from '../supabaseClient.js';
import { checkRole } from '../middleware/authMiddleware.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';
import { Brain } from '../services/geminiBrain.js';

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const toDateStr = (d) => d.toISOString().slice(0, 10);

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
 * Real 7-day attendance volume trend: for each of the last 7 days,
 * (# attendance records that day / total active employees) * 100
 */
async function computeWeeklyTrends(totalEmployees) {
    const days = lastNDateStrings(7);
    const startDate = days[0];
    const endDate = days[days.length - 1];

    const { data, error } = await supabase
        .from('attendances')
        .select('date')
        .gte('date', startDate)
        .lte('date', endDate);

    if (error) throw error;

    const countsByDate = {};
    (data || []).forEach(r => {
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
 * monthly attendance volume trend, 5 weekly buckets 
 */
async function computeMonthlyTrends(totalEmployees) {
    const WEEKS = 5;
    const days = lastNDateStrings(WEEKS * 7); // 35 days, oldest -> newest
    const startDate = days[0];
    const endDate = days[days.length - 1];

    const { data, error } = await supabase
        .from('attendances')
        .select('date')
        .gte('date', startDate)
        .lte('date', endDate);

    if (error) throw error;

    const countsByDate = {};
    (data || []).forEach(r => {
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
 * department scorecard: over the last 30 days, per department,
 */
async function computeDepartmentPunctuality() {
    const thirtyDaysAgo = toDateStr(new Date(Date.now() - 30 * DAY_MS));

    const { data, error } = await supabase
        .from('attendances')
        .select('status, employees:employee_id(department)')
        .gte('date', thirtyDaysAgo);

    if (error) throw error;

    const deptStats = {};
    (data || []).forEach(r => {
        const dept = r.employees?.department || 'Unassigned';
        if (!deptStats[dept]) deptStats[dept] = { total: 0, late: 0 };
        deptStats[dept].total += 1;
        if ((r.status || '').toLowerCase().includes('late')) {
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
 * Real DOLE compliance checks computed from attendance data:
 *  1. Weekly Rest Day Rule - flags any employee working 7+ consecutive calendar days
 *     without a gap in the last 30 days (Labor Code Art. 91: 1 rest day per 6 work days).
 *  2. Regular Holiday Multiplier - reports whether holiday-flagged attendance exists
 *     and how many records are pending the 200% premium tag.
 *  3. Night Shift Differential - reports how many active employees are on a night shift
 *     roster (entitled to the +10% NSD under Art. 86).
 */
async function computeDoleCompliance() {
    const thirtyDaysAgo = toDateStr(new Date(Date.now() - 30 * DAY_MS));

    const [attendanceRes, nightShiftRes] = await Promise.all([
        supabase.from('attendances').select('employee_id, date, status').gte('date', thirtyDaysAgo),
        supabase.from('employees').select('id', { count: 'exact', head: true }).ilike('shift', '%night%')
    ]);

    if (attendanceRes.error) throw attendanceRes.error;
    if (nightShiftRes.error) throw nightShiftRes.error;

    const records = attendanceRes.data || [];

    // --- 1. Rest day rule: longest consecutive worked-day streak per employee ---
    const datesByEmployee = {};
    records.forEach(r => {
        if (!datesByEmployee[r.employee_id]) datesByEmployee[r.employee_id] = new Set();
        datesByEmployee[r.employee_id].add(r.date);
    });

    let compliantEmployees = 0;
    const restDayViolations = [];
    const employeeIds = Object.keys(datesByEmployee);

    employeeIds.forEach(empId => {
        const dates = Array.from(datesByEmployee[empId]).sort();
        let streak = 1;
        let maxStreak = 1;
        for (let i = 1; i < dates.length; i++) {
            const diffDays = Math.round(
                (new Date(dates[i]) - new Date(dates[i - 1])) / DAY_MS
            );
            streak = diffDays === 1 ? streak + 1 : 1;
            maxStreak = Math.max(maxStreak, streak);
        }
        if (maxStreak <= 6) {
            compliantEmployees += 1;
        } else {
            restDayViolations.push({ employee_id: empId, consecutive_days: maxStreak });
        }
    });

    const restDayRatePercent = employeeIds.length > 0
        ? Math.round((compliantEmployees / employeeIds.length) * 100)
        : 100;

    // --- 2. Holiday multiplier: any holiday-tagged attendance in range ---
    const holidayRecords = records.filter(r => (r.status || '').toLowerCase().includes('holiday'));

    // --- 3. Night shift differential: active employees on a night roster ---
    const nightShiftCount = nightShiftRes.count || 0;

    return {
        restDay: {
            label: 'Weekly Rest Day Rule (1 in 6 days)',
            compliancePercent: restDayRatePercent,
            status: restDayViolations.length === 0 ? `${restDayRatePercent}% Compliant` : `${restDayViolations.length} Flagged`,
            violations: restDayViolations
        },
        holidayMultiplier: {
            label: 'Regular Holiday Multipliers (200%)',
            recordsFound: holidayRecords.length,
            status: holidayRecords.length > 0 ? `${holidayRecords.length} Tagged` : 'No holiday shifts logged'
        },
        nightDifferential: {
            label: 'Night Shift Differential (+10%)',
            employeesEligible: nightShiftCount,
            status: nightShiftCount > 0 ? `Applied to ${nightShiftCount}` : 'N/A - No night shifts'
        }
    };
}

// Semi-monthly (1-15 / 16-end) cutoff, 6-day work week convention used elsewhere in
// this file (DOLE rest-day rule = 1 rest day per 6 work days), so ~313 working days/year
// -> ~26 working days/month is the standard PH daily-rate divisor.
const PH_WORKING_DAYS_PER_MONTH = 26;

function getCutoffRange(refDate = new Date()) {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const day = refDate.getDate();
    const monthName = refDate.toLocaleString('default', { month: 'short' });

    if (day <= 15) {
        return { start: new Date(year, month, 1), end: new Date(year, month, 15), label: `${monthName} 1-15` };
    }
    const lastDay = new Date(year, month + 1, 0).getDate();
    return { start: new Date(year, month, 16), end: new Date(year, month, lastDay), label: `${monthName} 16-${lastDay}` };
}

/**
 * Count working days (every day except Sunday, matching the 6-day work week
 * convention used by the DOLE rest-day check above) between two dates, inclusive.
 */
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
 * Real 15-day cutoff payroll forecaster: prorates each active employee's monthly
 * salary into a daily rate, sums ACTUAL pay for working days already logged this
 * cutoff (applying the 200% holiday multiplier / +10% night differential where
 * flagged), then PROJECTS the remainder of the cutoff using that employee's own
 * attendance rate so far. Purely arithmetic - no LLM involved in the figures themselves.
 */
async function computePayrollForecast() {
    const today = new Date();
    const { start, end, label } = getCutoffRange(today);
    const startStr = toDateStr(start);
    const todayStr = toDateStr(today);
    const elapsedEnd = today < end ? today : end;

    const totalCutoffWorkingDays = countWorkingDays(start, end);
    const elapsedWorkingDays = countWorkingDays(start, elapsedEnd);
    const remainingWorkingDays = Math.max(0, totalCutoffWorkingDays - elapsedWorkingDays);

    const [{ data: employees, error: empErr }, { data: attendance, error: attErr }] = await Promise.all([
        supabase.from('employees').select('id, department, monthly_salary, shift').eq('status', 'active'),
        supabase.from('attendances').select('employee_id, date, status').gte('date', startStr).lte('date', todayStr)
    ]);

    if (empErr) throw empErr;
    if (attErr) throw attErr;

    const attByEmployee = {};
    (attendance || []).forEach(r => {
        if (!attByEmployee[r.employee_id]) attByEmployee[r.employee_id] = [];
        attByEmployee[r.employee_id].push(r);
    });

    let actualPayToDate = 0;
    let projectedRemainingPay = 0;
    const deptTotals = {};
    let employeesWithPayrate = 0;

    (employees || []).forEach(emp => {
        const salary = Number(emp.monthly_salary) || 0;
        if (salary <= 0) return;
        employeesWithPayrate += 1;

        const dailyRate = salary / PH_WORKING_DAYS_PER_MONTH;
        const records = attByEmployee[emp.id] || [];
        const isNightShift = (emp.shift || '').toLowerCase().includes('night');

        let empActual = 0;
        records.forEach(r => {
            const status = (r.status || '').toLowerCase();
            if (status.includes('holiday')) empActual += dailyRate * 2; // Art. 94 regular holiday 200%
            else if (isNightShift) empActual += dailyRate * 1.1;         // Art. 86 NSD +10%
            else empActual += dailyRate;
        });

        const attendanceRate = elapsedWorkingDays > 0 ? Math.min(1, records.length / elapsedWorkingDays) : 1;
        const empProjectedRemaining = remainingWorkingDays * dailyRate * attendanceRate;

        actualPayToDate += empActual;
        projectedRemainingPay += empProjectedRemaining;

        const dept = emp.department || 'Unassigned';
        deptTotals[dept] = (deptTotals[dept] || 0) + empActual + empProjectedRemaining;
    });

    const projectedCutoffTotal = actualPayToDate + projectedRemainingPay;

    return {
        cutoffLabel: label,
        cutoffStart: startStr,
        totalCutoffWorkingDays,
        elapsedWorkingDays,
        remainingWorkingDays,
        actualPayToDate: Math.round(actualPayToDate),
        projectedCutoffTotal: Math.round(projectedCutoffTotal),
        deptBreakdown: Object.entries(deptTotals)
            .map(([name, total]) => ({ name, projected: Math.round(total) }))
            .sort((a, b) => b.projected - a.projected),
        employeesWithPayrate,
        generatedAt: new Date().toISOString()
    };
}

router.get('/payroll-forecast', checkRole('admin'), cacheResponse(60), async (req, res) => {
    try {
        const forecast = await computePayrollForecast();
        const narrative = await Brain.Analytics.generatePayrollInsight(forecast).catch(() => null);
        res.json({ ...forecast, insight: narrative?.insight || null });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Payroll forecast error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/admin', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];

        const [
            { count: totalStaff },
            { count: factoryStaffCount },
            { count: retailStaffCount },
            { count: itStaffCount },
            { count: hrStaffCount },
            { count: presentTodayCount },
            { count: lateTodayCount },
            { count: onLeaveCount },
            { count: pendingLeavesCount },
            { data: recentLogs }
        ] = await Promise.all([
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'Factory'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'Retail'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'IT'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'HR/Admin'),
            supabase.from('attendances').select('*', { count: 'exact', head: true }).eq('date', todayStr),
            supabase.from('attendances').select('*', { count: 'exact', head: true }).eq('date', todayStr).ilike('status', '%Late%'),
            supabase.from('leave_requests').select('*', { count: 'exact', head: true })
                .eq('status', 'Approved')
                .lte('start_date', todayStr)
                .gte('end_date', todayStr),
            supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'New'),
            supabase.from('attendances').select('*, employees:employee_id(*)').eq('date', todayStr).order('created_at', { ascending: false }).limit(5)
        ]);

        const [weeklyTrends, monthlyTrends, deptPunctuality, doleCompliance] = await Promise.all([
            computeWeeklyTrends(totalStaff || 0),
            computeMonthlyTrends(totalStaff || 0),
            computeDepartmentPunctuality(),
            computeDoleCompliance()
        ]);

        res.json({
            totalStaff: totalStaff || 0,
            deptBreakdown: {
                Factory: factoryStaffCount || 0,
                Retail: retailStaffCount || 0,
                IT: itStaffCount || 0,
                HR: hrStaffCount || 0
            },
            presentTodayCount: presentTodayCount || 0,
            lateTodayCount: lateTodayCount || 0,
            onLeaveCount: onLeaveCount || 0,
            pendingLeavesCount: pendingLeavesCount || 0,
            recentLogs: recentLogs || [],
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

// Consolidated BFF Endpoint for Employee Dashboard (Single-Trip High Performance)
router.get('/employee/:id', cacheResponse(15), async (req, res) => {
    try {
        const { id } = req.params;

        const [
            { data: attendanceData, error: attErr },
            { data: payrollData, error: payErr },
            { data: shiftData, error: shiftErr },
            { data: discData, error: discErr },
            { data: leaveData, error: leaveErr }
        ] = await Promise.all([
            supabase.from('attendances').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10),
            supabase.from('payrolls').select('*').eq('employee_id', id).order('period_start', { ascending: false }).limit(1),
            supabase.from('employees').select('id, shift, department, job_title, first_name, last_name, company_id').eq('id', id).limit(1),
            supabase.from('disciplinary_logs').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10),
            supabase.from('leave_requests').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10)
        ]);

        if (attErr || payErr || shiftErr || discErr || leaveErr) {
            const err = attErr || payErr || shiftErr || discErr || leaveErr;
            throw err;
        }

        res.json({
            attendanceData: attendanceData || [],
            payrollData: payrollData || [],
            shiftData: shiftData || [],
            discData: discData || [],
            leaveData: leaveData || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;