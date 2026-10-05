import { supabase } from '../supabaseClient.js';
import { isWorkforceEmployee } from './workforce.js';

const TIMEZONE = 'Asia/Manila';
const CALL_TIME_HOUR = parseInt(process.env.CALL_TIME_HOUR, 10) ?? 8;
const CALL_TIME_MINUTE = parseInt(process.env.CALL_TIME_MINUTE, 10) ?? 0;

/**
 * Format a Date object to YYYY-MM-DD in Asia/Manila timezone
 */
export const getManilaDateString = (date = new Date()) => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
};

/**
 * Format timestamp to 12-hour hh:mm A in Asia/Manila timezone
 */
export const formatManilaTime = (isoString) => {
    if (!isoString) return null;
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return null;
        return new Intl.DateTimeFormat('en-US', {
            timeZone: TIMEZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(d);
    } catch {
        return null;
    }
};

/**
 * Extract hour and minute in Asia/Manila timezone from ISO string
 */
const getManilaHourAndMinute = (isoString) => {
    if (!isoString) return { hour: 0, minute: 0 };
    try {
        const d = new Date(isoString);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: TIMEZONE,
            hour: 'numeric',
            minute: 'numeric',
            hourCycle: 'h23'
        }).formatToParts(d);
        const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
        return { hour, minute };
    } catch {
        return { hour: 0, minute: 0 };
    }
};

/**
 * Reconcile and calculate an employee's complete work schedule and day-by-day attendance
 * for any given month (YYYY-MM).
 *
 * @param {Object} params
 * @param {string} params.employeeId - UUID of the employee
 * @param {string} [params.month] - YYYY-MM (e.g. '2026-10')
 * @returns {Promise<Object>}
 */
export async function getEmployeeMonthlyAttendance({ employeeId, month }) {
    if (!employeeId) {
        throw new Error('Valid employeeId is required.');
    }

    const todayStr = getManilaDateString();
    let targetMonth = month;

    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
        targetMonth = todayStr.substring(0, 7);
    }

    const [yearStr, monthStr] = targetMonth.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);

    // Month boundary dates
    const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const startDate = `${targetMonth}-01`;
    const endDate = `${targetMonth}-${String(lastDayOfMonth).padStart(2, '0')}`;

    // Resolve employee by UUID or Company ID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId).trim());
    let empQuery = supabase
        .from('employees')
        .select('id, company_id, first_name, last_name, role, job_title, department, shift, date_hired, created_at, is_active, status, medical_record_url');
    if (isUUID) {
        empQuery = empQuery.eq('id', employeeId);
    } else {
        empQuery = empQuery.ilike('company_id', employeeId);
    }
    const { data: employee, error: empErr } = await empQuery.maybeSingle();
    if (empErr) throw new Error(`Database error fetching employee: ${empErr.message}`);
    if (!employee) throw new Error(`Employee with ID or Company ID "${employeeId}" not found.`);

    const resolvedEmployeeId = employee.id;

    // Parallel batch query for attendance, leaves, and holidays
    const [attRes, leavesRes, holidaysRes] = await Promise.all([
        supabase
            .from('attendances')
            .select('id, employee_id, date, time_in, time_out, status, time_in_photo, time_out_photo')
            .eq('employee_id', resolvedEmployeeId)
            .gte('date', startDate)
            .lte('date', endDate)
            .order('time_in', { ascending: true }),
        supabase
            .from('leave_requests')
            .select('id, employee_id, start_date, end_date, type, status, notes')
            .eq('employee_id', resolvedEmployeeId)
            .eq('status', 'Approved')
            .lte('start_date', endDate)
            .gte('end_date', startDate),
        supabase
            .from('holidays')
            .select('id, date, name, type')
            .gte('date', startDate)
            .lte('date', endDate)
    ]);

    if (attRes.error) throw new Error(`Database error fetching attendances: ${attRes.error.message}`);
    if (leavesRes.error) throw new Error(`Database error fetching leaves: ${leavesRes.error.message}`);
    if (holidaysRes.error) throw new Error(`Database error fetching holidays: ${holidaysRes.error.message}`);

    // Determine Rest Days
    // Defaults to [0] (Sunday) for standard manufacturing work schedule (Mon-Sat, 6-day week)
    let restDays = [0];
    const dept = (employee.department || '').toLowerCase();
    const shiftText = (employee.shift || '').toLowerCase();

    if (Array.isArray(employee.rest_days) && employee.rest_days.length > 0) {
        restDays = employee.rest_days.map(Number);
    } else if (dept.includes('office') || dept.includes('management') || dept.includes('hr')) {
        // Corporate 5-day week: Sat (6) and Sun (0)
        restDays = [0, 6];
    } else {
        // Production / Factory standard 6-day week: Sunday (0)
        restDays = [0];
    }

    // Determine Hire Date
    const hireDateStr = employee.date_hired 
        ? String(employee.date_hired).substring(0, 10)
        : (employee.created_at ? String(employee.created_at).substring(0, 10) : null);

    // Check Medical Grace Exemption
    let isMedicalGraceActive = false;
    if (employee.medical_record_url) {
        try {
            const parsed = typeof employee.medical_record_url === 'string' 
                ? JSON.parse(employee.medical_record_url) 
                : employee.medical_record_url;
            if (parsed?.exempt) {
                const validUntil = parsed.valid_until;
                if (!validUntil || validUntil >= todayStr) {
                    isMedicalGraceActive = true;
                }
            }
        } catch {}
    }

    // Index attendances by date
    const attendanceMap = new Map();
    (attRes.data || []).forEach(record => {
        if (!record?.date) return;
        const existing = attendanceMap.get(record.date);
        if (!existing) {
            attendanceMap.set(record.date, record);
        } else {
            // Keep earliest time_in and latest time_out if duplicate punches exist
            const earlierIn = (record.time_in && (!existing.time_in || record.time_in < existing.time_in)) 
                ? record.time_in 
                : existing.time_in;
            const laterOut = (record.time_out && (!existing.time_out || record.time_out > existing.time_out)) 
                ? record.time_out 
                : existing.time_out;
            attendanceMap.set(record.date, {
                ...existing,
                time_in: earlierIn,
                time_out: laterOut,
                time_in_photo: existing.time_in_photo || record.time_in_photo,
                time_out_photo: existing.time_out_photo || record.time_out_photo,
            });
        }
    });

    // Index holidays by date
    const holidayMap = new Map();
    (holidaysRes.data || []).forEach(h => {
        if (h?.date) holidayMap.set(h.date, h);
    });

    // Helper: Check if a date falls inside approved leaves
    const getApprovedLeaveForDate = (dateStr) => {
        for (const leave of (leavesRes.data || [])) {
            if (dateStr >= leave.start_date && dateStr <= leave.end_date) {
                const rawNotes = leave.notes || '';
                const isUnpaid = /\[PAY_TYPE:WITHOUT_PAY\]/i.test(rawNotes) || /\[UNPAID\]/i.test(rawNotes);
                return {
                    id: leave.id,
                    type: leave.type || 'Leave',
                    is_paid: !isUnpaid,
                    notes: rawNotes.replace(/\[PAY_TYPE:[^\]]+\]/gi, '').replace(/\[(PAID|UNPAID)\]/gi, '').trim()
                };
            }
        }
        return null;
    };

    // Day names helper
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Summary counters
    let expectedWorkDays = 0;
    let daysPresent = 0;
    let daysOnTime = 0;
    let daysLate = 0;
    let totalLateMinutes = 0;
    let daysAbsent = 0;
    let approvedLeaveDays = 0;
    let restDayCount = 0;
    let holidayCount = 0;

    const days = [];

    // Reconcile every calendar day of the month
    for (let dayNum = 1; dayNum <= lastDayOfMonth; dayNum++) {
        const dayStr = String(dayNum).padStart(2, '0');
        const currentDateStr = `${targetMonth}-${dayStr}`;
        const dateObj = new Date(Date.UTC(year, monthNum - 1, dayNum));
        const dayOfWeek = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

        const isRestDay = restDays.includes(dayOfWeek);
        const isHoliday = holidayMap.has(currentDateStr);
        const holidayData = holidayMap.get(currentDateStr) || null;
        const leaveData = getApprovedLeaveForDate(currentDateStr);
        const attendanceLog = attendanceMap.get(currentDateStr) || null;

        const isToday = currentDateStr === todayStr;
        const isPast = currentDateStr < todayStr;
        const isFuture = currentDateStr > todayStr;
        const isPreHire = hireDateStr && currentDateStr < hireDateStr;

        // Classify day status
        let status = 'SCHEDULED';
        let statusLabel = 'Scheduled Work Day';
        let minutesLate = 0;
        let hoursWorked = null;
        let reason = null;

        // Calculate work duration if both punches exist
        if (attendanceLog?.time_in && attendanceLog?.time_out) {
            const inTime = new Date(attendanceLog.time_in).getTime();
            const outTime = new Date(attendanceLog.time_out).getTime();
            if (outTime > inTime) {
                hoursWorked = Number(((outTime - inTime) / (1000 * 60 * 60)).toFixed(2));
            }
        }

        if (isPreHire) {
            status = 'PRE_HIRE';
            statusLabel = 'Not Yet Employed';
            reason = 'Prior to employee commencement date';
        } else if (attendanceLog && attendanceLog.time_in) {
            // Punch exists! Determine if on time or late
            const { hour, minute } = getManilaHourAndMinute(attendanceLog.time_in);
            const totalMinutes = hour * 60 + minute;
            const scheduledCallMinutes = CALL_TIME_HOUR * 60 + CALL_TIME_MINUTE;

            if (totalMinutes > scheduledCallMinutes) {
                minutesLate = totalMinutes - scheduledCallMinutes;
            }

            const rawStatus = (attendanceLog.status || '').toLowerCase();
            const isMarkedLate = rawStatus.includes('late') || minutesLate > 0;

            if (isMarkedLate) {
                status = 'LATE';
                statusLabel = isMedicalGraceActive 
                    ? `Late (${minutesLate}m · Grace Period)` 
                    : `Late (${minutesLate} mins)`;
                daysLate++;
                totalLateMinutes += minutesLate;
            } else {
                status = 'PRESENT';
                statusLabel = 'Present (On Time)';
                daysOnTime++;
            }
            daysPresent++;

            if (!isRestDay && !isHoliday) {
                expectedWorkDays++;
            }
        } else if (leaveData) {
            // Approved Leave
            status = isFuture ? 'FUTURE_LEAVE' : 'APPROVED_LEAVE';
            statusLabel = `${leaveData.type} (${leaveData.is_paid ? 'Paid' : 'Unpaid'})`;
            reason = leaveData.notes || `Approved ${leaveData.type}`;
            if (!isFuture) {
                approvedLeaveDays++;
            }
            if (!isRestDay && !isHoliday) {
                expectedWorkDays++;
            }
        } else if (isHoliday) {
            // Statutory Holiday
            status = isFuture ? 'FUTURE_HOLIDAY' : 'HOLIDAY';
            const holidayTypeLabel = holidayData.type === 'regular' ? 'Regular Holiday' : 'Special Non-Working Day';
            statusLabel = `${holidayData.name} (${holidayTypeLabel})`;
            reason = holidayData.name;
            if (!isFuture) {
                holidayCount++;
            }
        } else if (isRestDay) {
            // Scheduled Rest Day
            status = isFuture ? 'FUTURE_REST_DAY' : 'REST_DAY';
            statusLabel = `${DAY_NAMES[dayOfWeek]} Rest Day`;
            reason = 'Weekly statutory rest day per schedule';
            if (!isFuture) {
                restDayCount++;
            }
        } else if (isToday) {
            // Current Day with no punch yet
            status = 'AWAITING_PUNCH';
            statusLabel = 'Today · In Progress';
            reason = 'Awaiting shift attendance scan';
            expectedWorkDays++;
        } else if (isFuture) {
            // Future Scheduled Work Day
            status = 'SCHEDULED';
            statusLabel = 'Scheduled Work Day';
            expectedWorkDays++;
        } else {
            // Past work day with no punch, no leave, no holiday = Unexcused Absence
            status = 'ABSENT';
            statusLabel = 'Unexcused Absence';
            reason = 'No attendance punch or approved leave recorded';
            daysAbsent++;
            expectedWorkDays++;
        }

        days.push({
            date: currentDateStr,
            day_number: dayNum,
            day_of_week: dayOfWeek,
            day_name: DAY_NAMES_SHORT[dayOfWeek],
            full_day_name: DAY_NAMES[dayOfWeek],
            is_work_day: !isRestDay && !isHoliday && !isPreHire,
            is_today: isToday,
            is_past: isPast,
            is_future: isFuture,
            is_pre_hire: Boolean(isPreHire),
            status,
            status_label: statusLabel,
            reason,
            time_in: attendanceLog?.time_in || null,
            time_out: attendanceLog?.time_out || null,
            time_in_formatted: formatManilaTime(attendanceLog?.time_in),
            time_out_formatted: formatManilaTime(attendanceLog?.time_out),
            minutes_late: minutesLate,
            hours_worked: hoursWorked,
            time_in_photo: attendanceLog?.time_in_photo || null,
            time_out_photo: attendanceLog?.time_out_photo || null,
            attendance_id: attendanceLog?.id || null,
            notes: attendanceLog?.notes || null,
            leave: leaveData,
            holiday: holidayData,
            is_medical_grace: isMedicalGraceActive
        });
    }

    // Rates and Reliability Percentages
    const eligiblePastDays = daysPresent + daysAbsent;
    const attendanceRatePct = eligiblePastDays > 0 
        ? Number(((daysPresent / eligiblePastDays) * 100).toFixed(1))
        : 100.0;

    const punctualityRatePct = daysPresent > 0
        ? Number(((daysOnTime / daysPresent) * 100).toFixed(1))
        : 100.0;

    return {
        employee: {
            id: employee.id,
            company_id: employee.company_id,
            first_name: employee.first_name,
            last_name: employee.last_name,
            name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
            role: employee.role,
            department: employee.department,
            job_title: employee.job_title,
            shift: employee.shift || 'Factory Standard (08:00 AM - 05:00 PM)',
            rest_days: restDays,
            date_hired: employee.date_hired,
            is_medical_grace_active: isMedicalGraceActive
        },
        month: targetMonth,
        summary: {
            total_calendar_days: lastDayOfMonth,
            expected_work_days: expectedWorkDays,
            days_present: daysPresent,
            days_on_time: daysOnTime,
            days_late: daysLate,
            total_late_minutes: totalLateMinutes,
            days_absent: daysAbsent,
            approved_leaves: approvedLeaveDays,
            rest_days: restDayCount,
            holidays: holidayCount,
            attendance_rate_pct: attendanceRatePct,
            punctuality_rate_pct: punctualityRatePct
        },
        days
    };
}
