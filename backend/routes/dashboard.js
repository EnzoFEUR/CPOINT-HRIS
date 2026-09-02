import express from 'express';
import { supabase } from '../supabaseClient.js';
import { checkRole, checkAdminOrOwnership } from '../middleware/authMiddleware.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';
import { Brain } from '../services/geminiBrain.js';
import { computeAttendanceSignals } from '../services/attendanceIntelligence.js';

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
        const dept = emp?.department || 'Unassigned';
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
 * In-memory DOLE compliance checks computed from attendance records:
 *  1. Weekly Rest Day Rule (Labor Code Art. 91: 1 rest day per 6 work days)
 *  2. Regular Holiday Multipliers (200%)
 *  3. Night Shift Differential (+10% under Art. 86)
 */
function computeDoleComplianceFromRecords(records, nightShiftCount) {
    const thirtyDaysAgo = toDateStr(new Date(Date.now() - 30 * DAY_MS));
    const filteredRecords = (records || []).filter(r => r.date >= thirtyDaysAgo);

    const datesByEmployee = {};
    filteredRecords.forEach(r => {
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

    const holidayRecords = filteredRecords.filter(r => (r.status || '').toLowerCase().includes('holiday'));

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
 * 15-day cutoff payroll forecaster
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
            if (status.includes('holiday')) empActual += dailyRate * 2;
            else if (isNightShift) empActual += dailyRate * 1.1;
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

// Consolidated admin dashboard overview
router.get('/overview', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const thirtyFiveDaysAgo = toDateStr(new Date(Date.now() - 35 * DAY_MS));

        // Fetch core metrics and forecast in parallel
        const [
            { data: rawEmployees, error: empErr },
            { data: rawAttendances, error: attErr },
            { data: rawLeaves, error: leaveErr },
            forecast
        ] = await Promise.all([
            supabase
                .from('employees')
                .select('id, department, role, shift, company_id')
                .not('company_id', 'is', null)
                .neq('role', 'admin')
                .neq('role', 'security'),
            supabase
                .from('attendances')
                .select('id, employee_id, date, status, created_at, time_in, time_out, employees:employee_id(id, company_id, first_name, last_name, department, shift)')
                .gte('date', thirtyFiveDaysAgo)
                .order('created_at', { ascending: false }),
            supabase
                .from('leave_requests')
                .select('status, start_date, end_date'),
            computePayrollForecast().catch(() => null)
        ]);

        if (empErr) throw empErr;
        if (attErr) throw attErr;
        if (leaveErr) throw leaveErr;

        const employees = rawEmployees || [];
        const attendances = rawAttendances || [];
        const leaves = rawLeaves || [];

        // 2. In-Memory Calculations
        const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };
        const empMap = new Map();
        let nightShiftCount = 0;

        employees.forEach(emp => {
            empMap.set(emp.id, emp);
            const dept = emp.department || 'Other';
            if (dept === 'Factory') deptBreakdown.Factory++;
            else if (dept === 'Retail') deptBreakdown.Retail++;
            else if (dept === 'IT') deptBreakdown.IT++;
            else if (dept.includes('HR') || dept.includes('Admin')) deptBreakdown.HR++;

            if ((emp.shift || '').toLowerCase().includes('night')) {
                nightShiftCount++;
            }
        });

        let presentTodayCount = 0;
        let lateTodayCount = 0;
        const recentLogs = [];

        attendances.forEach(att => {
            if (att.date === todayStr) {
                presentTodayCount++;
                if ((att.status || '').toLowerCase().includes('late')) {
                    lateTodayCount++;
                }
                if (recentLogs.length < 5) {
                    recentLogs.push(att);
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
        const doleCompliance = computeDoleComplianceFromRecords(attendances, nightShiftCount);

        // 3. Anomaly Signals & Briefing Metrics (deterministic in-memory)
        const signals = computeAttendanceSignals(attendances);
        const general_health_assessment = signals.anomalies_detected_count === 0
            ? 'All attendance patterns are within acceptable organizational thresholds.'
            : `${signals.anomalies_detected_count} attendance pattern(s) flagged across ${signals.sample_size} active employees in the last 30 days.`;

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

        // Asynchronous AI enhancements (falls back gracefully if cold)
        const [briefing, payrollNarrative] = await Promise.all([
            Brain.Analytics.generateWorkforceBriefing(briefingData, false).catch(() => null),
            forecast ? Brain.Analytics.generatePayrollInsight(forecast).catch(() => null) : null
        ]);

        const payrollData = forecast ? { ...forecast, insight: payrollNarrative?.insight || null } : null;

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
            aiData: briefing ? { briefing } : null,
            anomalyData: {
                report: {
                    ...signals,
                    general_health_assessment
                }
            }
        });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Overview error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Composite Employee Dashboard BFF Endpoint
router.get('/employee/:id', checkAdminOrOwnership, cacheResponse(15), async (req, res) => {
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
            supabase
                .from('attendances')
                .select('*')
                .eq('employee_id', id)
                .gte('date', thirtyDaysAgo)
                .order('created_at', { ascending: false })
                .limit(20),
            supabase
                .from('payrolls')
                .select('*')
                .eq('employee_id', id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('employees')
                .select('id, first_name, last_name, company_id, shift, department, job_title, biometric_baseline_path, monthly_salary, piece_rate')
                .eq('id', id)
                .single(),
            supabase
                .from('disciplinary_logs')
                .select('*')
                .eq('employee_id', id)
                .order('created_at', { ascending: false })
                .limit(10),
            supabase
                .from('leave_requests')
                .select('*')
                .eq('employee_id', id)
                .order('created_at', { ascending: false })
                .limit(10)
        ]);

        if (attErr) throw attErr;
        if (payErr) throw payErr;
        if (empErr) throw empErr;

        res.json({
            attendanceData: attendanceData || [],
            payrollData: payrollData || null,
            shiftData: employee ? [{ ...employee }] : [],
            discData: discData || [],
            leaveData: leaveData || []
        });
    } catch (err) {
        console.error('[DASHBOARD_ROUTE] Employee dashboard error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

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

/**
 * Optimized Single-Pass Admin Dashboard Telemetry
 * Consolidates 16 database roundtrips into 3 high-speed queries with in-memory aggregation.
 */
router.get('/admin', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const thirtyFiveDaysAgo = toDateStr(new Date(Date.now() - 35 * DAY_MS));

        // Query dashboard statistics in parallel
        const [
            { data: rawEmployees, error: empErr },
            { data: rawAttendances, error: attErr },
            { data: rawLeaves, error: leaveErr }
        ] = await Promise.all([
            supabase
                .from('employees')
                .select('id, department, role, shift, company_id')
                .not('company_id', 'is', null)
                .neq('role', 'admin')
                .neq('role', 'security'),
            supabase
                .from('attendances')
                .select('id, employee_id, date, status, created_at, time_in, time_out, employees:employee_id(id, company_id, first_name, last_name, department, shift)')
                .gte('date', thirtyFiveDaysAgo)
                .order('created_at', { ascending: false }),
            supabase
                .from('leave_requests')
                .select('status, start_date, end_date')
        ]);

        if (empErr) throw empErr;
        if (attErr) throw attErr;
        if (leaveErr) throw leaveErr;

        const employees = rawEmployees || [];
        const attendances = rawAttendances || [];
        const leaves = rawLeaves || [];

        // 1. Employee Department Breakdown
        const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };
        const empMap = new Map();
        let nightShiftCount = 0;

        employees.forEach(emp => {
            empMap.set(emp.id, emp);
            const dept = emp.department || 'Other';
            if (dept === 'Factory') deptBreakdown.Factory++;
            else if (dept === 'Retail') deptBreakdown.Retail++;
            else if (dept === 'IT') deptBreakdown.IT++;
            else if (dept.includes('HR') || dept.includes('Admin')) deptBreakdown.HR++;

            if ((emp.shift || '').toLowerCase().includes('night')) {
                nightShiftCount++;
            }
        });

        // 2. Today's Attendance Counters & Recent Logs
        let presentTodayCount = 0;
        let lateTodayCount = 0;
        const recentLogs = [];

        attendances.forEach(att => {
            if (att.date === todayStr) {
                presentTodayCount++;
                if ((att.status || '').toLowerCase().includes('late')) {
                    lateTodayCount++;
                }
                if (recentLogs.length < 5) {
                    recentLogs.push(att);
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
        const doleCompliance = computeDoleComplianceFromRecords(attendances, nightShiftCount);

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

// Employee dashboard overview endpoint
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