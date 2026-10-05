import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import { supabase } from '../../supabaseClient';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Format ISO string to 12-hour hh:mm A
const formatTime = (isoString) => {
    if (!isoString) return null;
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return null;
        return new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(d);
    } catch {
        return null;
    }
};

// Reconcile raw Supabase records directly on client as resilient fallback
const reconcileClientAttendance = ({ employee, attendances = [], leaves = [], holidays = [], year, monthNum }) => {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    const targetMonth = `${year}-${String(monthNum).padStart(2, '0')}`;
    const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();

    let restDays = [0];
    const dept = (employee?.department || '').toLowerCase();
    if (Array.isArray(employee?.rest_days) && employee.rest_days.length > 0) {
        restDays = employee.rest_days.map(Number);
    } else if (dept.includes('office') || dept.includes('management') || dept.includes('hr')) {
        restDays = [0, 6];
    } else {
        restDays = [0];
    }

    const attendanceMap = new Map();
    attendances.forEach(a => {
        if (a?.date) attendanceMap.set(a.date, a);
    });

    const holidayMap = new Map();
    holidays.forEach(h => {
        if (h?.date) holidayMap.set(h.date, h);
    });

    const getLeaveForDate = (dStr) => {
        for (const l of leaves) {
            if (dStr >= l.start_date && dStr <= l.end_date) {
                const isUnpaid = /\[PAY_TYPE:WITHOUT_PAY\]/i.test(l.notes || '') || /\[UNPAID\]/i.test(l.notes || '');
                return {
                    id: l.id,
                    type: l.type || 'Leave',
                    is_paid: !isUnpaid,
                    notes: (l.notes || '').replace(/\[PAY_TYPE:[^\]]+\]/gi, '').replace(/\[(PAID|UNPAID)\]/gi, '').trim()
                };
            }
        }
        return null;
    };

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

    for (let dayNum = 1; dayNum <= lastDayOfMonth; dayNum++) {
        const dayStr = String(dayNum).padStart(2, '0');
        const currentDateStr = `${targetMonth}-${dayStr}`;
        const dateObj = new Date(Date.UTC(year, monthNum - 1, dayNum));
        const dayOfWeek = dateObj.getUTCDay();

        const isRestDay = restDays.includes(dayOfWeek);
        const holidayData = holidayMap.get(currentDateStr) || null;
        const leaveData = getLeaveForDate(currentDateStr);
        const attLog = attendanceMap.get(currentDateStr) || null;

        const isToday = currentDateStr === todayStr;
        const isPast = currentDateStr < todayStr;
        const isFuture = currentDateStr > todayStr;

        let status = 'SCHEDULED';
        let statusLabel = 'Scheduled Work Day';
        let minutesLate = 0;
        let hoursWorked = null;
        let reason = null;

        if (attLog?.time_in && attLog?.time_out) {
            const inT = new Date(attLog.time_in).getTime();
            const outT = new Date(attLog.time_out).getTime();
            if (outT > inT) hoursWorked = Number(((outT - inT) / (1000 * 60 * 60)).toFixed(2));
        }

        if (attLog && attLog.time_in) {
            const inDate = new Date(attLog.time_in);
            const inH = inDate.getHours();
            const inM = inDate.getMinutes();
            const totMin = inH * 60 + inM;
            const callMin = 8 * 60; // 08:00 AM

            if (totMin > callMin) {
                minutesLate = totMin - callMin;
            }

            const rawSt = (attLog.status || '').toLowerCase();
            const isLate = rawSt.includes('late') || minutesLate > 0;

            if (isLate) {
                status = 'LATE';
                statusLabel = `Late (${minutesLate} mins)`;
                daysLate++;
                totalLateMinutes += minutesLate;
            } else {
                status = 'PRESENT';
                statusLabel = 'Present (On Time)';
                daysOnTime++;
            }
            daysPresent++;
            if (!isRestDay && !holidayData) expectedWorkDays++;
        } else if (leaveData) {
            status = isFuture ? 'FUTURE_LEAVE' : 'APPROVED_LEAVE';
            statusLabel = `${leaveData.type} (${leaveData.is_paid ? 'Paid' : 'Unpaid'})`;
            reason = leaveData.notes;
            if (!isFuture) approvedLeaveDays++;
            if (!isRestDay && !holidayData) expectedWorkDays++;
        } else if (holidayData) {
            status = isFuture ? 'FUTURE_HOLIDAY' : 'HOLIDAY';
            statusLabel = holidayData.name;
            reason = holidayData.name;
            if (!isFuture) holidayCount++;
        } else if (isRestDay) {
            status = isFuture ? 'FUTURE_REST_DAY' : 'REST_DAY';
            statusLabel = `${DAY_NAMES[dayOfWeek]} Rest Day`;
            if (!isFuture) restDayCount++;
        } else if (isToday) {
            status = 'AWAITING_PUNCH';
            statusLabel = 'Today · In Progress';
            expectedWorkDays++;
        } else if (isFuture) {
            status = 'SCHEDULED';
            statusLabel = 'Scheduled Work Day';
            expectedWorkDays++;
        } else {
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
            is_work_day: !isRestDay && !holidayData,
            is_today: isToday,
            is_past: isPast,
            is_future: isFuture,
            status,
            status_label: statusLabel,
            reason,
            time_in: attLog?.time_in || null,
            time_out: attLog?.time_out || null,
            time_in_formatted: formatTime(attLog?.time_in),
            time_out_formatted: formatTime(attLog?.time_out),
            minutes_late: minutesLate,
            hours_worked: hoursWorked,
            time_in_photo: attLog?.time_in_photo || null,
            time_out_photo: attLog?.time_out_photo || null,
            leave: leaveData,
            holiday: holidayData
        });
    }

    const eligiblePastDays = daysPresent + daysAbsent;
    const attendanceRatePct = eligiblePastDays > 0 ? Number(((daysPresent / eligiblePastDays) * 100).toFixed(1)) : 100.0;
    const punctualityRatePct = daysPresent > 0 ? Number(((daysOnTime / daysPresent) * 100).toFixed(1)) : 100.0;

    return {
        employee: {
            id: employee?.id,
            company_id: employee?.company_id,
            name: `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim(),
            shift: employee?.shift || 'Factory Standard (08:00 AM - 05:00 PM)',
            rest_days: restDays
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
};

export default function MonthlyWorkCalendar({ employeeId, employeeName = '', isEmployeeView = false, className = '' }) {
    const queryClient = useQueryClient();

    const todayMonthStr = useMemo(() => {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }, []);

    const [selectedMonth, setSelectedMonth] = useState(todayMonthStr);
    const [viewMode, setViewMode] = useState('grid');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedDayDetail, setSelectedDayDetail] = useState(null);

    const hasCheckedActiveMonth = useRef(false);

    const [year, monthNum] = useMemo(() => {
        const [y, m] = selectedMonth.split('-');
        return [parseInt(y, 10), parseInt(m, 10)];
    }, [selectedMonth]);

    // Resilient UUID resolution (handles both UUID and company_id)
    const [resolvedUuid, setResolvedUuid] = useState(() => {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId || '').trim());
        return isUUID ? employeeId : null;
    });

    useEffect(() => {
        if (!employeeId) return;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId).trim());
        if (isUUID) {
            setResolvedUuid(employeeId);
            return;
        }
        supabase
            .from('employees')
            .select('id')
            .ilike('company_id', employeeId)
            .maybeSingle()
            .then(({ data }) => {
                if (data?.id) setResolvedUuid(data.id);
            });
    }, [employeeId]);

    const activeEmpId = resolvedUuid || employeeId;

    const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${year}`;

    // Auto-focus latest active month from Supabase if current month has zero records
    useEffect(() => {
        if (!activeEmpId || hasCheckedActiveMonth.current) return;

        const syncLatestMonth = async () => {
            try {
                // Check if current month has attendances
                const startDate = `${selectedMonth}-01`;
                const endDate = `${selectedMonth}-31`;

                const { count } = await supabase
                    .from('attendances')
                    .select('id', { count: 'exact', head: true })
                    .eq('employee_id', activeEmpId)
                    .gte('date', startDate)
                    .lte('date', endDate);

                if (count === 0) {
                    // Find latest month with attendance records
                    const { data: latestRecord } = await supabase
                        .from('attendances')
                        .select('date')
                        .eq('employee_id', activeEmpId)
                        .order('date', { ascending: false })
                        .limit(1)
                        .maybeSingle();

                    if (latestRecord?.date) {
                        hasCheckedActiveMonth.current = true;
                        const activeMonth = latestRecord.date.substring(0, 7);
                        setSelectedMonth(activeMonth);
                    }
                } else {
                    hasCheckedActiveMonth.current = true;
                }
            } catch (err) {
                console.warn('Auto-detect active month note:', err);
            }
        };

        syncLatestMonth();
    }, [activeEmpId, selectedMonth]);

    // Month Navigation
    const handlePrevMonth = () => {
        hasCheckedActiveMonth.current = true;
        let prevM = monthNum - 1;
        let prevY = year;
        if (prevM < 1) {
            prevM = 12;
            prevY -= 1;
        }
        setSelectedMonth(`${prevY}-${String(prevM).padStart(2, '0')}`);
    };

    const handleNextMonth = () => {
        hasCheckedActiveMonth.current = true;
        let nextM = monthNum + 1;
        let nextY = year;
        if (nextM > 12) {
            nextM = 1;
            nextY += 1;
        }
        setSelectedMonth(`${nextY}-${String(nextM).padStart(2, '0')}`);
    };

    const handleJumpToCurrentMonth = () => {
        hasCheckedActiveMonth.current = true;
        setSelectedMonth(todayMonthStr);
    };

    // Query Monthly Attendance (API with direct Supabase fallback)
    const { data: monthlyData, isLoading } = useQuery({
        queryKey: ['employeeMonthlyAttendance', activeEmpId, selectedMonth],
        queryFn: async () => {
            // 1. Try Backend Reconciled Endpoint
            try {
                const res = await fetchWithAuth(`/api/attendance/employee-monthly?employee_id=${activeEmpId}&month=${selectedMonth}`);
                const json = await res.json();
                if (res.ok && (json.success || json.status === 'success') && json.data) {
                    return json.data;
                }
            } catch (apiErr) {
                console.warn('API monthly attendance note, falling back to direct Supabase query:', apiErr);
            }

            // 2. Resilient Direct Supabase Query (matches /admin/attendance and /admin/attendance/calendar)
            const startDate = `${selectedMonth}-01`;
            const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
            const endDate = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;

            const [empRes, attRes, leavesRes, holidaysRes] = await Promise.all([
                supabase.from('employees').select('*').eq('id', activeEmpId).maybeSingle(),
                supabase.from('attendances').select('*').eq('employee_id', activeEmpId).gte('date', startDate).lte('date', endDate).order('time_in', { ascending: true }),
                supabase.from('leave_requests').select('*').eq('employee_id', activeEmpId).eq('status', 'Approved').lte('start_date', endDate).gte('end_date', startDate),
                supabase.from('holidays').select('*').gte('date', startDate).lte('date', endDate)
            ]);

            return reconcileClientAttendance({
                employee: empRes.data,
                attendances: attRes.data || [],
                leaves: leavesRes.data || [],
                holidays: holidaysRes.data || [],
                year,
                monthNum
            });
        },
        enabled: Boolean(activeEmpId),
        staleTime: 30_000,
        gcTime: 300_000
    });

    // Real-time Supabase synchronization
    useEffect(() => {
        if (!activeEmpId) return;

        const handleSync = () => {
            queryClient.invalidateQueries({ queryKey: ['employeeMonthlyAttendance', activeEmpId] });
        };

        const channel = supabase
            .channel(`monthly-attendance-live-${activeEmpId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', filter: `employee_id=eq.${activeEmpId}` }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests', filter: `employee_id=eq.${activeEmpId}` }, handleSync)
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeEmpId, queryClient]);

    const summary = monthlyData?.summary || {
        total_calendar_days: 30,
        expected_work_days: 0,
        days_present: 0,
        days_on_time: 0,
        days_late: 0,
        total_late_minutes: 0,
        days_absent: 0,
        approved_leaves: 0,
        rest_days: 0,
        holidays: 0,
        attendance_rate_pct: 100,
        punctuality_rate_pct: 100
    };

    const allDays = useMemo(() => monthlyData?.days || [], [monthlyData]);

    // Calendar Grid alignment (Monday = 0 ... Sunday = 6)
    const calendarGrid = useMemo(() => {
        if (!allDays.length) return [];
        const firstDayOfWeek = allDays[0].day_of_week;
        const leadingBlanks = (firstDayOfWeek + 6) % 7;

        const cells = [];
        for (let i = 0; i < leadingBlanks; i++) {
            cells.push({ isBlank: true, key: `blank-${i}` });
        }
        allDays.forEach(day => {
            cells.push({ ...day, isBlank: false, key: day.date });
        });
        return cells;
    }, [allDays]);

    // Filtered days for table view
    const filteredDays = useMemo(() => {
        if (statusFilter === 'all') return allDays;
        if (statusFilter === 'present') return allDays.filter(d => d.status === 'PRESENT');
        if (statusFilter === 'late') return allDays.filter(d => d.status === 'LATE');
        if (statusFilter === 'absent') return allDays.filter(d => d.status === 'ABSENT');
        if (statusFilter === 'leave') return allDays.filter(d => d.status === 'APPROVED_LEAVE' || d.status === 'HOLIDAY');
        return allDays;
    }, [allDays, statusFilter]);

    // Style mapper for status themes (aligned with C-Point design system)
    const getStatusTheme = (day) => {
        switch (day?.status) {
            case 'PRESENT':
                return {
                    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    iconBox: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                    dotBg: 'bg-emerald-500',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-white',
                    cardHighlight: 'border-l-2 border-l-emerald-500',
                    tag: 'Present',
                    icon: 'ti-check'
                };
            case 'LATE':
                return {
                    badgeBg: 'bg-amber-50 text-amber-800 border-amber-200',
                    iconBox: 'bg-amber-50 text-amber-700 border-amber-200',
                    dotBg: 'bg-amber-500',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-amber-50/20',
                    cardHighlight: 'border-l-2 border-l-amber-500',
                    tag: `Late (${day.minutes_late}m)`,
                    icon: 'ti-clock-alert'
                };
            case 'ABSENT':
                return {
                    badgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
                    iconBox: 'bg-rose-50 text-rose-700 border-rose-200',
                    dotBg: 'bg-rose-500',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-rose-50/20',
                    cardHighlight: 'border-l-2 border-l-rose-500',
                    tag: 'Absent',
                    icon: 'ti-user-x'
                };
            case 'APPROVED_LEAVE':
            case 'FUTURE_LEAVE':
                return {
                    badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                    iconBox: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                    dotBg: 'bg-indigo-500',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-indigo-50/20',
                    cardHighlight: 'border-l-2 border-l-indigo-500',
                    tag: day.leave?.type || 'Leave',
                    icon: 'ti-file-certificate'
                };
            case 'HOLIDAY':
            case 'FUTURE_HOLIDAY':
                return {
                    badgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
                    iconBox: 'bg-sky-50 text-sky-700 border-sky-200',
                    dotBg: 'bg-sky-500',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-sky-50/20',
                    cardHighlight: 'border-l-2 border-l-sky-500',
                    tag: 'Holiday',
                    icon: 'ti-calendar-event'
                };
            case 'REST_DAY':
            case 'FUTURE_REST_DAY':
                return {
                    badgeBg: 'bg-slate-50 text-slate-600 border-slate-200',
                    iconBox: 'bg-slate-50 text-slate-600 border-slate-200',
                    dotBg: 'bg-slate-400',
                    cardBorder: 'border-slate-200/60 bg-slate-50/40',
                    cardHighlight: '',
                    tag: 'Rest Day',
                    icon: 'ti-coffee'
                };
            case 'AWAITING_PUNCH':
                return {
                    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
                    iconBox: 'bg-blue-50 text-blue-700 border-blue-200',
                    dotBg: 'bg-blue-500',
                    cardBorder: 'border-blue-200 bg-blue-50/30',
                    cardHighlight: 'border-l-2 border-l-blue-500',
                    tag: 'Today',
                    icon: 'ti-clock'
                };
            case 'PRE_HIRE':
                return {
                    badgeBg: 'bg-slate-50 text-slate-400 border-slate-200',
                    iconBox: 'bg-slate-50 text-slate-400 border-slate-200',
                    dotBg: 'bg-slate-300',
                    cardBorder: 'border-slate-100 bg-slate-50/30 opacity-60',
                    cardHighlight: '',
                    tag: 'Pre-Hire',
                    icon: 'ti-user-off'
                };
            default:
                return {
                    badgeBg: 'bg-slate-50 text-slate-600 border-slate-200',
                    iconBox: 'bg-slate-50 text-slate-600 border-slate-200',
                    dotBg: 'bg-slate-400',
                    cardBorder: 'border-dashed border-slate-200 bg-white/70',
                    cardHighlight: '',
                    tag: 'Work Day',
                    icon: 'ti-calendar'
                };
        }
    };

    return (
        <div className={`bg-white rounded-lg shadow-2xs border border-slate-200 p-5 sm:p-6 space-y-5 relative ${className}`}>
            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md flex items-center justify-center border bg-slate-50 text-slate-600 border-slate-200/70 shrink-0">
                        <i className="ti ti-calendar-time text-lg" />
                    </div>
                    <div>
                        <h3 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">
                            {isEmployeeView ? 'My Monthly Work Schedule & Attendance' : 'Monthly Work Schedule & Attendance Audit'}
                        </h3>
                        <p className="text-xs text-slate-500 font-medium">
                            Shift: <span className="font-semibold text-slate-700">{monthlyData?.employee?.shift || 'Factory Standard (08:00 AM - 05:00 PM)'}</span> · Rest Day: <span className="font-semibold text-slate-700">Sunday</span>
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Month Navigator */}
                    <div className="inline-flex items-center bg-slate-50 rounded-md p-0.5 border border-slate-200">
                        <button
                            type="button"
                            onClick={handlePrevMonth}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40"
                            title="Previous Month"
                        >
                            <i className="ti ti-chevron-left text-sm" />
                        </button>
                        <span className="px-2.5 text-xs font-semibold text-slate-800 select-none min-w-[110px] text-center">
                            {monthLabel}
                        </span>
                        <button
                            type="button"
                            onClick={handleNextMonth}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40"
                            title="Next Month"
                        >
                            <i className="ti ti-chevron-right text-sm" />
                        </button>
                    </div>

                    {/* Quick Jump Today Button */}
                    {selectedMonth !== todayMonthStr && (
                        <button
                            type="button"
                            onClick={handleJumpToCurrentMonth}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                        >
                            Current Month
                        </button>
                    )}

                    {/* View Switcher: Grid vs Table */}
                    <div className="inline-flex items-center bg-slate-100 rounded-md p-0.5 border border-slate-200">
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-all ${
                                viewMode === 'grid' 
                                    ? 'bg-white text-slate-900 shadow-2xs font-semibold' 
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Calendar Grid View"
                        >
                            <i className="ti ti-layout-grid text-sm" />
                            <span className="hidden sm:inline">Calendar</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-all ${
                                viewMode === 'table' 
                                    ? 'bg-white text-slate-900 shadow-2xs font-semibold' 
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Audit Table View"
                        >
                            <i className="ti ti-list text-sm" />
                            <span className="hidden sm:inline">Timeline</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* KPI Metric Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* Expected Work */}
                <div className="bg-slate-50/70 p-3 sm:p-3.5 rounded-md border border-slate-200 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-slate-500">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Expected Work</span>
                        <i className="ti ti-calendar-stats text-sm text-slate-400" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-slate-900 tabular-nums">
                            {summary.expected_work_days}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">days</span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 font-medium">
                        {summary.rest_days} Rest · {summary.holidays} Holidays
                    </div>
                </div>

                {/* Days Rendered */}
                <div className="bg-emerald-50/40 p-3 sm:p-3.5 rounded-md border border-emerald-200 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-emerald-700">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Days Rendered</span>
                        <i className="ti ti-circle-check text-sm text-emerald-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 tabular-nums">
                            {summary.days_present}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">/ {summary.expected_work_days}</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-emerald-700">
                        {summary.days_on_time} on-time ({summary.attendance_rate_pct}%)
                    </div>
                </div>

                {/* Late Punches */}
                <div className="bg-amber-50/40 p-3 sm:p-3.5 rounded-md border border-amber-200 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-amber-800">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Late Punches</span>
                        <i className="ti ti-clock-alert text-sm text-amber-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-amber-800 tabular-nums">
                            {summary.days_late}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">punches</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-amber-800">
                        {summary.total_late_minutes}m total tardiness
                    </div>
                </div>

                {/* Unexcused Absences */}
                <div className="bg-rose-50/40 p-3 sm:p-3.5 rounded-md border border-rose-200 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-rose-700">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Absences</span>
                        <i className="ti ti-user-x text-sm text-rose-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-rose-700 tabular-nums">
                            {summary.days_absent}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">days unexcused</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-rose-700">
                        {summary.days_absent === 0 ? 'Zero unexcused absences' : 'Absence deduction applies'}
                    </div>
                </div>

                {/* Approved Leaves */}
                <div className="col-span-2 sm:col-span-1 bg-indigo-50/40 p-3 sm:p-3.5 rounded-md border border-indigo-200 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-indigo-700">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Approved Leaves</span>
                        <i className="ti ti-file-certificate text-sm text-indigo-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-indigo-700 tabular-nums">
                            {summary.approved_leaves}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">days filed</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-indigo-700">
                        Authorized by HR
                    </div>
                </div>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                        statusFilter === 'all'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                            : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
                    }`}
                >
                    All Days ({allDays.length})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('present')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                        statusFilter === 'present'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                            : 'bg-white text-emerald-700 hover:bg-emerald-50 border-emerald-200'
                    }`}
                >
                    Present ({summary.days_on_time})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('late')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                        statusFilter === 'late'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                            : 'bg-white text-amber-800 hover:bg-amber-50 border-amber-200'
                    }`}
                >
                    Lates ({summary.days_late})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('absent')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                        statusFilter === 'absent'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                            : 'bg-white text-rose-700 hover:bg-rose-50 border-rose-200'
                    }`}
                >
                    Absents ({summary.days_absent})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('leave')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                        statusFilter === 'leave'
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                            : 'bg-white text-indigo-700 hover:bg-indigo-50 border-indigo-200'
                    }`}
                >
                    Leaves &amp; Holidays ({summary.approved_leaves + summary.holidays})
                </button>
            </div>

            {/* View Container */}
            {isLoading ? (
                <div className="rounded-md border border-slate-200 p-12 text-center bg-slate-50/40">
                    <div className="inline-block animate-spin text-slate-600 mb-3">
                        <i className="ti ti-loader-2 text-2xl" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Reconciling monthly work days &amp; attendance...</p>
                    <p className="text-xs text-slate-400 mt-1">Synchronizing live records from database</p>
                </div>
            ) : viewMode === 'grid' ? (
                /* 7-Column Calendar Grid View */
                <div className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-2xs">
                    {/* Weekday Header */}
                    <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">
                        {WEEKDAYS.map((wd, idx) => (
                            <div key={wd} className={idx >= 5 ? 'text-slate-400' : 'text-slate-600'}>
                                {wd}
                            </div>
                        ))}
                    </div>

                    {/* Day Cells Grid */}
                    <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 bg-slate-50/20">
                        {calendarGrid.map((item) => {
                            if (item.isBlank) {
                                return (
                                    <div key={item.key} className="min-h-[85px] sm:min-h-[105px] bg-slate-50/40" />
                                );
                            }

                            const theme = getStatusTheme(item);
                            const matchesFilter = statusFilter === 'all' || 
                                (statusFilter === 'present' && item.status === 'PRESENT') ||
                                (statusFilter === 'late' && item.status === 'LATE') ||
                                (statusFilter === 'absent' && item.status === 'ABSENT') ||
                                (statusFilter === 'leave' && (item.status === 'APPROVED_LEAVE' || item.status === 'HOLIDAY'));

                            return (
                                <div
                                    key={item.key}
                                    onClick={() => setSelectedDayDetail(item)}
                                    className={`min-h-[85px] sm:min-h-[105px] p-2 transition-colors cursor-pointer relative group flex flex-col justify-between hover:bg-slate-50/80 ${
                                        theme.cardBorder
                                    } ${theme.cardHighlight} ${
                                        matchesFilter ? 'opacity-100' : 'opacity-35 hover:opacity-100'
                                    } ${item.is_today ? 'ring-1 ring-inset ring-blue-500 bg-blue-50/20 z-10' : ''}`}
                                >
                                    {/* Day Top Bar */}
                                    <div className="flex items-center justify-between">
                                        <span className={`text-xs font-semibold ${
                                            item.is_today 
                                                ? 'h-5 w-5 rounded-md bg-blue-600 text-white flex items-center justify-center font-bold text-[11px]' 
                                                : item.day_of_week === 0 
                                                    ? 'text-rose-600 font-bold' 
                                                    : 'text-slate-800'
                                        }`}>
                                            {item.day_number}
                                        </span>

                                        <span className={`h-2 w-2 rounded-full ${theme.dotBg} shrink-0`} title={item.status_label} />
                                    </div>

                                    {/* Middle Content */}
                                    <div className="my-1.5 space-y-1">
                                        {item.status === 'PRESENT' && (
                                            <div className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/70 truncate">
                                                {item.time_in_formatted}
                                            </div>
                                        )}

                                        {item.status === 'LATE' && (
                                            <div className="text-[10px] font-semibold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/70 truncate">
                                                {item.time_in_formatted} <span className="hidden sm:inline">({item.minutes_late}m)</span>
                                            </div>
                                        )}

                                        {item.status === 'ABSENT' && (
                                            <div className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200/70 truncate">
                                                Absent
                                            </div>
                                        )}

                                        {(item.status === 'APPROVED_LEAVE' || item.status === 'FUTURE_LEAVE') && (
                                            <div className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/70 truncate" title={item.status_label}>
                                                {item.leave?.type || 'Leave'}
                                            </div>
                                        )}

                                        {(item.status === 'HOLIDAY' || item.status === 'FUTURE_HOLIDAY') && (
                                            <div className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200/70 truncate" title={item.holiday?.name}>
                                                Holiday
                                            </div>
                                        )}

                                        {(item.status === 'REST_DAY' || item.status === 'FUTURE_REST_DAY') && (
                                            <div className="text-[10px] font-medium text-slate-400">
                                                Rest Day
                                            </div>
                                        )}

                                        {item.status === 'AWAITING_PUNCH' && (
                                            <div className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 truncate">
                                                Today
                                            </div>
                                        )}

                                        {item.status === 'SCHEDULED' && (
                                            <div className="text-[10px] font-medium text-slate-400">
                                                Scheduled
                                            </div>
                                        )}
                                    </div>

                                    {/* Bottom Info: Hours Worked */}
                                    <div className="text-[9px] text-slate-400 font-mono truncate">
                                        {item.time_out_formatted ? `Out: ${item.time_out_formatted}` : item.hours_worked ? `${item.hours_worked} hrs` : ''}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* Chronological Audit Table View */
                <div className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-2xs">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                                    <th className="py-2.5 px-3.5">Date</th>
                                    <th className="py-2.5 px-3.5">Day</th>
                                    <th className="py-2.5 px-3.5">Status &amp; Classification</th>
                                    <th className="py-2.5 px-3.5">Clock In</th>
                                    <th className="py-2.5 px-3.5">Clock Out</th>
                                    <th className="py-2.5 px-3.5">Tardiness</th>
                                    <th className="py-2.5 px-3.5">Duration</th>
                                    <th className="py-2.5 px-3.5 text-right">Details</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredDays.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                                            No attendance records found matching the active filter.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredDays.map((day) => {
                                        const theme = getStatusTheme(day);
                                        return (
                                            <tr
                                                key={day.date}
                                                onClick={() => setSelectedDayDetail(day)}
                                                className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                                                    day.is_today ? 'bg-blue-50/20' : ''
                                                }`}
                                            >
                                                <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900">
                                                    {day.date}
                                                </td>
                                                <td className="py-2.5 px-3.5 text-slate-600 font-medium">
                                                    {day.full_day_name}
                                                </td>
                                                <td className="py-2.5 px-3.5">
                                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${theme.badgeBg}`}>
                                                        <span className={`h-1.5 w-1.5 rounded-full ${theme.dotBg}`} />
                                                        {day.status_label}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-3.5 font-mono font-medium text-slate-700">
                                                    {day.time_in_formatted || <span className="text-slate-300">--:--</span>}
                                                </td>
                                                <td className="py-2.5 px-3.5 font-mono font-medium text-slate-700">
                                                    {day.time_out_formatted || <span className="text-slate-300">--:--</span>}
                                                </td>
                                                <td className="py-2.5 px-3.5">
                                                    {day.minutes_late > 0 ? (
                                                        <span className="font-semibold text-amber-800">
                                                            +{day.minutes_late} mins
                                                        </span>
                                                    ) : day.status === 'PRESENT' ? (
                                                        <span className="text-emerald-700 font-medium">On-time</span>
                                                    ) : (
                                                        <span className="text-slate-300">--</span>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-3.5 text-slate-600 font-medium">
                                                    {day.hours_worked ? `${day.hours_worked} hrs` : <span className="text-slate-300">--</span>}
                                                </td>
                                                <td className="py-2.5 px-3.5 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedDayDetail(day);
                                                        }}
                                                        className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                                                    >
                                                        Inspect
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Interactive Day Inspection Modal (System-Consistent Modal) */}
            {selectedDayDetail && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70">
                    <div 
                        className="absolute inset-0"
                        onClick={() => setSelectedDayDetail(null)}
                    />
                    <div 
                        className="relative bg-white rounded-lg max-w-lg w-full p-5 sm:p-6 shadow-xl border border-slate-200 z-10 text-left space-y-4 max-h-[92vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-md flex items-center justify-center border ${getStatusTheme(selectedDayDetail).iconBox}`}>
                                    <i className={`ti ${getStatusTheme(selectedDayDetail).icon} text-lg`} />
                                </div>
                                <div>
                                    <h3 className="text-base font-semibold text-slate-900">
                                        {selectedDayDetail.full_day_name}, {selectedDayDetail.date}
                                    </h3>
                                    <p className="text-xs text-slate-500 font-medium">
                                        Daily Attendance &amp; Shift Reconciliation
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedDayDetail(null)}
                                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100 cursor-pointer"
                                title="Close"
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="space-y-3.5 text-sm">
                            <div className={`p-3 rounded-md border flex items-center justify-between ${getStatusTheme(selectedDayDetail).badgeBg}`}>
                                <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${getStatusTheme(selectedDayDetail).dotBg}`} />
                                    <span className="font-semibold text-xs uppercase tracking-wider">Attendance Status</span>
                                </div>
                                <span className="font-semibold text-xs px-2 py-0.5 rounded border bg-white/80">
                                    {selectedDayDetail.status_label}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Call Time</span>
                                    <span className="font-semibold text-slate-800 text-sm mt-0.5 block font-mono">08:00 AM</span>
                                    <span className="text-[10px] text-slate-500 block mt-0.5">Factory shift start</span>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Duration Rendered</span>
                                    <span className="font-semibold text-slate-800 text-sm mt-0.5 block font-mono">
                                        {selectedDayDetail.hours_worked ? `${selectedDayDetail.hours_worked} hrs` : '--'}
                                    </span>
                                    <span className="text-[10px] text-slate-500 block mt-0.5">Logged work hours</span>
                                </div>
                            </div>

                            <div className="p-3.5 bg-slate-50 rounded-md border border-slate-200 space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 font-medium">Clock In:</span>
                                    <span className="font-mono font-semibold text-slate-900">
                                        {selectedDayDetail.time_in_formatted || <span className="text-slate-400 font-normal">Not Recorded</span>}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-slate-500 font-medium">Clock Out:</span>
                                    <span className="font-mono font-semibold text-slate-900">
                                        {selectedDayDetail.time_out_formatted || <span className="text-slate-400 font-normal">Not Recorded</span>}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
                                    <span className="text-slate-500 font-medium">Tardiness / Delay:</span>
                                    <span className={`font-mono font-semibold ${selectedDayDetail.minutes_late > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                        {selectedDayDetail.minutes_late > 0 ? `+${selectedDayDetail.minutes_late} minutes` : '0 mins (On Time)'}
                                    </span>
                                </div>
                            </div>

                            {selectedDayDetail.time_in_photo && (
                                <div className="space-y-1.5">
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="ti ti-camera text-slate-400 text-sm" />
                                        Biometric Kiosk Time-In Proof
                                    </span>
                                    <div className="rounded-md overflow-hidden border border-slate-200 bg-slate-100 max-h-48 flex items-center justify-center">
                                        <img
                                            src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${selectedDayDetail.time_in_photo}`}
                                            alt="Biometric punch proof"
                                            className="w-full h-full object-cover max-h-48"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {selectedDayDetail.reason && (
                                <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-xs text-slate-700">
                                    <span className="font-semibold text-slate-900">Audit Classification Note: </span>
                                    {selectedDayDetail.reason}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                            <button
                                type="button"
                                onClick={() => setSelectedDayDetail(null)}
                                className="h-8 px-4 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-md border border-slate-200 transition-colors duration-100 cursor-pointer shadow-2xs"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
