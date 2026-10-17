import { getEmployeeRestDays, getChargeableLateMinutes, getManilaWorkDate } from './workPolicy.mjs';
import { getLeaveOverlapDays, isLeaveDate } from './leaveCredits.mjs';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const manilaTimeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true });

export function getAttendanceMonthRange(month) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month. Expected YYYY-MM.');
    const startDate = `${month}-01`;
    const next = new Date(`${startDate}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const endDate = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
    return { startDate, endDate, totalDays: Number(endDate.slice(-2)) };
}

export function formatManilaTime(timestamp) {
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
    return manilaTimeFormatter.format(new Date(timestamp));
}

export function reconcileMonthlyAttendance({ employee, attendances = [], leaves = [], holidays = [], month, workPolicy, today = getManilaWorkDate() }) {
    if (!employee?.id || !workPolicy || !isLeaveDate(today)) throw new Error('Verified employee, attendance policy and current date are required.');
    const { totalDays } = getAttendanceMonthRange(month);
    const restDays = getEmployeeRestDays(employee);
    const hireDate = String(employee.date_hired || employee.created_at || '').slice(0, 10);
    const timekeepingStartDate = String(employee.timekeeping_effective_date || employee.created_at || employee.date_hired || '').slice(0, 10);
    if (hireDate && !isLeaveDate(hireDate)) throw new Error('Invalid employee commencement date. HR must reconcile the schedule.');
    let medical = null;
    try {
        medical = typeof employee.medical_record_url === 'string' ? JSON.parse(employee.medical_record_url) : employee.medical_record_url;
    } catch { /* An unreadable record cannot grant an exemption. */ }
    const medicalGrace = Boolean(medical?.exempt && (!medical.valid_until || medical.valid_until >= today));
    const attendanceMap = new Map();
    for (const record of attendances) {
        if (record.employee_id && record.employee_id !== employee.id) throw new Error('Attendance belongs to a different employee.');
        if (!isLeaveDate(record.date)) throw new Error('Invalid attendance date.');
        if (record.time_in) getChargeableLateMinutes(record, workPolicy, restDays);
        if (record.time_out && !Number.isFinite(Date.parse(record.time_out))) throw new Error('Invalid attendance clock-out timestamp.');
        const existing = attendanceMap.get(record.date);
        if (!existing) {
            attendanceMap.set(record.date, { ...record });
            continue;
        }
        // Compare instants, since timestamp strings may use different UTC offsets.
        if (record.time_in && (!existing.time_in || Date.parse(record.time_in) < Date.parse(existing.time_in))) {
            existing.time_in = record.time_in;
            existing.time_in_photo = record.time_in_photo;
        }
        if (record.time_out && (!existing.time_out || Date.parse(record.time_out) > Date.parse(existing.time_out))) {
            existing.time_out = record.time_out;
            existing.time_out_photo = record.time_out_photo;
        }
    }
    const approvedLeaves = leaves.filter(leave => !leave.status || leave.status === 'Approved');
    for (const leave of approvedLeaves) {
        if (leave.employee_id && leave.employee_id !== employee.id) throw new Error('Leave belongs to a different employee.');
        getLeaveOverlapDays(leave, `${month}-01`, `${month}-${String(totalDays).padStart(2, '0')}`);
    }
    const holidayMap = new Map(holidays.map(holiday => [holiday.date, holiday]));
    const days = [];
    for (let dayNumber = 1; dayNumber <= totalDays; dayNumber++) {
        const date = `${month}-${String(dayNumber).padStart(2, '0')}`;
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        const isRestDay = restDays.includes(weekday);
        const holiday = holidayMap.get(date) || null;
        const nonWorkingHoliday = Boolean(holiday && holiday.type !== 'special_working');
        const log = attendanceMap.get(date);
        const preHire = Boolean(hireDate && date < hireDate);
        const isWorkDay = !isRestDay && !nonWorkingHoliday && !preHire;
        const isFuture = date > today;
        const isNotTracked = Boolean(!preHire && timekeepingStartDate && date < timekeepingStartDate && !log?.time_in);
        const rawLeave = isWorkDay ? approvedLeaves.find(leave => date >= leave.start_date && date <= leave.end_date && (!(leave.credit_pool || leave.requested_pay_type) || leave.credit_dates.includes(date))) : null;
        const leave = rawLeave ? {
            id: rawLeave.id, type: rawLeave.type || 'Leave',
            is_paid: rawLeave.is_paid !== false && !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(rawLeave.notes || ''),
            notes: (rawLeave.notes || '').replace(/\[PAY_TYPE:[^\]]+\]|\[(PAID|UNPAID)\]/gi, '').trim(),
        } : null;
        let status;
        let statusLabel;
        let reason = null;
        let minutesLate = 0;
        if (preHire) {
            status = 'PRE_HIRE';
            statusLabel = 'Not Yet Employed';
            reason = 'Prior to employee commencement date';
        } else if (log?.time_in) {
            minutesLate = getChargeableLateMinutes(log, workPolicy, restDays);
            status = minutesLate > 0 ? 'LATE' : 'PRESENT';
            statusLabel = minutesLate > 0 ? `Late (${minutesLate} mins${medicalGrace ? ' - Medical Grace' : ''})` : 'Present (On Time)';
            if (isRestDay) statusLabel = 'Present (Rest Day)';
            else if (nonWorkingHoliday) statusLabel += ' - Holiday Work';
            if (leave) reason = 'Attendance overlaps approved leave. HR must reconcile this date.';
        } else if (leave) {
            status = isFuture ? 'FUTURE_LEAVE' : 'APPROVED_LEAVE';
            statusLabel = `${leave.type} (${leave.is_paid ? 'Paid' : 'Unpaid'})`;
            reason = leave.notes || `Approved ${leave.type}`;
        } else if (nonWorkingHoliday) {
            status = isFuture ? 'FUTURE_HOLIDAY' : 'HOLIDAY';
            statusLabel = `${holiday.name} (${holiday.type === 'regular' ? 'Regular Holiday' : 'Special Non-Working Day'})`;
            reason = holiday.name;
        } else if (isRestDay) {
            status = isFuture ? 'FUTURE_REST_DAY' : 'REST_DAY';
            statusLabel = `${DAY_NAMES[weekday]} Rest Day`; reason = 'Weekly rest day per employee schedule';
        } else if (isNotTracked) {
            status = 'NOT_TRACKED';
            statusLabel = 'Legacy Tenure';
            reason = 'Prior to digital timekeeping cutover';
        } else if (date === today) {
            status = 'AWAITING_PUNCH'; statusLabel = 'Today - In Progress'; reason = 'Awaiting shift attendance scan';
        } else if (isFuture) {
            status = 'SCHEDULED'; statusLabel = 'Scheduled Work Day';
        } else {
            status = 'ABSENT'; statusLabel = 'No Attendance Recorded'; reason = 'No attendance punch or approved leave recorded';
        }
        const duration = Date.parse(log?.time_out) - Date.parse(log?.time_in);
        days.push({
            date, day_number: dayNumber, day_of_week: weekday, day_name: DAY_NAMES[weekday].slice(0, 3), full_day_name: DAY_NAMES[weekday],
            is_work_day: isWorkDay, is_rest_day: isRestDay, is_today: date === today, is_past: date < today, is_future: isFuture,
            is_pre_hire: preHire, is_not_tracked: status === 'NOT_TRACKED',
            status, status_label: statusLabel, reason, minutes_late: minutesLate, hours_worked: duration > 0 ? Number((duration / 3600000).toFixed(2)) : null,
            time_in: log?.time_in || null, time_out: log?.time_out || null,
            time_in_formatted: formatManilaTime(log?.time_in), time_out_formatted: formatManilaTime(log?.time_out),
            time_in_photo: log?.time_in_photo || null, time_out_photo: log?.time_out_photo || null,
            attendance_id: log?.id || null, notes: log?.notes || null, leave, holiday, is_medical_grace: medicalGrace,
        });
    }
    const present = days.filter(day => ['PRESENT', 'LATE'].includes(day.status));
    const scheduledPresent = present.filter(day => day.is_work_day && !day.is_future);
    const absent = days.filter(day => day.status === 'ABSENT').length;
    const notTracked = days.filter(day => day.status === 'NOT_TRACKED').length;
    const scheduledOnTime = scheduledPresent.filter(day => day.status === 'PRESENT').length;
    const expectedMonitoredWorkDays = days.filter(day => day.is_work_day && day.status !== 'NOT_TRACKED').length;
    const eligible = scheduledPresent.length + absent;
    return {
        employee: {
            id: employee.id, company_id: employee.company_id, first_name: employee.first_name, last_name: employee.last_name,
            name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim(), role: employee.role,
            department: employee.department, job_title: employee.job_title, shift: employee.shift || 'Weekday schedule',
            rest_days: restDays, work_days: [1, 2, 3, 4, 5, 6, 0].filter(day => !restDays.includes(day)),
            schedule_source: Array.isArray(employee.rest_days) ? 'employee' : 'company_default',
            date_hired: employee.date_hired,
            timekeeping_effective_date: employee.timekeeping_effective_date || null,
            is_medical_grace_active: medicalGrace,
        },
        workPolicy, month,
        summary: {
            total_calendar_days: totalDays,
            expected_work_days: expectedMonitoredWorkDays,
            untracked_work_days: notTracked,
            days_present: present.length, scheduled_days_present: scheduledPresent.length,
            days_on_time: scheduledOnTime, days_late: present.filter(day => day.status === 'LATE').length,
            total_late_minutes: present.reduce((total, day) => total + day.minutes_late, 0), days_absent: absent,
            approved_leaves: days.filter(day => ['APPROVED_LEAVE', 'FUTURE_LEAVE'].includes(day.status)).length,
            rest_days: days.filter(day => day.is_rest_day && !day.is_pre_hire).length,
            holidays: days.filter(day => day.holiday && day.holiday.type !== 'special_working' && !day.is_pre_hire).length,
            attendance_rate_pct: eligible ? Number((scheduledPresent.length / eligible * 100).toFixed(1)) : 100,
            punctuality_rate_pct: scheduledPresent.length ? Number((scheduledOnTime / scheduledPresent.length * 100).toFixed(1)) : 100,
        },
        days,
    };
}
