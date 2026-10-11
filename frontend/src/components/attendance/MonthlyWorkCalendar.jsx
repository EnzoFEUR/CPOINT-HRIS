import { getManilaWorkDate } from '../../../../shared/workPolicy.mjs';
import { getAttendanceMonthRange, reconcileMonthlyAttendance } from '../../../../shared/monthlyAttendance.mjs';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import { supabase } from '../../supabaseClient';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthlyWorkCalendar(props) {
    return <EmployeeMonthlyWorkCalendar key={props.employeeId} {...props} />;
}

function EmployeeMonthlyWorkCalendar({ employeeId, employeeName = '', className = '', isEmployeeView = false }) {
    const queryClient = useQueryClient();
    const todayMonthStr = getManilaWorkDate().slice(0, 7);
    const [selectedMonth, setSelectedMonth] = useState(todayMonthStr);
    const [viewMode, setViewMode] = useState('grid');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedDayDate, setSelectedDayDate] = useState(null);
    const setSelectedDayDetail = day => setSelectedDayDate(day?.date || null);
    const hasCheckedActiveMonth = useRef(false);
    const dayDialog = useRef(null);
    const [year, monthNum] = selectedMonth.split('-').map(Number);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(employeeId || '').trim());
    const { data: resolvedEmployee, isLoading: isResolving, error: resolutionError } = useQuery({
        queryKey: ['monthlyEmployeeId', employeeId],
        enabled: Boolean(employeeId) && !isUuid,
        queryFn: async ({ signal }) => {
            const { data, error } = await supabase.from('employees').select('id')
                .ilike('company_id', String(employeeId).trim().replace(/[\\%_]/g, '\\$&'))
                .abortSignal(signal).maybeSingle();
            signal.throwIfAborted();
            if (error || !data?.id) throw new Error(error?.message || 'Employee not found.');
            return data;
        },
        staleTime: 300_000,
    });
    const activeEmpId = isUuid ? String(employeeId).trim() : resolvedEmployee?.id;
    const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${year}`;

    // Preserve latest-active-month navigation without allowing an old read to override a new selection.
    useEffect(() => {
        if (isEmployeeView || !activeEmpId || hasCheckedActiveMonth.current) return;
        const controller = new AbortController();
        const syncLatestMonth = async () => {
            try {
                const { startDate, endDate } = getAttendanceMonthRange(selectedMonth);
                const { count, error } = await supabase.from('attendances')
                    .select('id', { count: 'exact', head: true }).eq('employee_id', activeEmpId)
                    .gte('date', startDate).lte('date', endDate).abortSignal(controller.signal);
                if (error) throw error;
                if (count === 0) {
                    const { data, error: latestError } = await supabase.from('attendances').select('date')
                        .eq('employee_id', activeEmpId).order('date', { ascending: false }).limit(1)
                        .abortSignal(controller.signal).maybeSingle();
                    if (latestError) throw latestError;
                    if (!controller.signal.aborted && !hasCheckedActiveMonth.current && data?.date) {
                        hasCheckedActiveMonth.current = true;
                        setSelectedMonth(data.date.slice(0, 7));
                    }
                }
            } catch (error) {
                if (!controller.signal.aborted) console.warn('Auto-detect active month:', error.message);
            } finally {
                if (!controller.signal.aborted) hasCheckedActiveMonth.current = true;
            }
        };
        syncLatestMonth();
        return () => controller.abort();
    }, [activeEmpId, selectedMonth, isEmployeeView]);

    // Month Navigation
    const handlePrevMonth = () => {
        hasCheckedActiveMonth.current = true;
        setSelectedDayDate(null);
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
        setSelectedDayDate(null);
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
        setSelectedDayDate(null);
        setSelectedMonth(todayMonthStr);
    };

    // The backend and direct fallback use the same employee schedule reconciliation.
    const { data: monthlyData, isLoading: isMonthlyLoading, isFetching, error: queryError } = useQuery({
        queryKey: ['employeeMonthlyAttendance', activeEmpId, selectedMonth],
        queryFn: async ({ signal }) => {
            try {
                const res = await fetchWithAuth(`/api/attendance/employee-monthly?employee_id=${activeEmpId}&month=${selectedMonth}&refresh=true`, { signal });
                const json = await res.json();
                signal.throwIfAborted();
                if ([400, 401, 403, 404].includes(res.status)) {
                    throw Object.assign(new Error(json.message || json.error?.message || 'Monthly attendance access denied.'), { status: res.status });
                }
                if (res.ok && (json.success || json.status === 'success') && json.data) {
                    if (json.data.employee?.id !== activeEmpId || json.data.month !== selectedMonth) throw new Error('Monthly attendance response does not match the selected employee and month.');
                    return json.data;
                }
            } catch (error) {
                signal.throwIfAborted();
                if ([400, 401, 403, 404].includes(error.status) || error.message === 'Unauthorized') throw error;
                console.warn('Monthly API unavailable; reading verified Supabase records:', error.message);
            }
            signal.throwIfAborted();
            const { startDate, endDate } = getAttendanceMonthRange(selectedMonth);
            const [empRes, attRes, leavesRes, holidaysRes, policy] = await Promise.all([
                supabase.from('employees').select('*').eq('id', activeEmpId).abortSignal(signal).maybeSingle(),
                supabase.from('attendances').select('*', { count: 'exact' }).eq('employee_id', activeEmpId).gte('date', startDate).lte('date', endDate).order('time_in', { ascending: true }).abortSignal(signal),
                supabase.from('leave_requests').select('*', { count: 'exact' }).eq('employee_id', activeEmpId).eq('status', 'Approved').lte('start_date', endDate).gte('end_date', startDate).abortSignal(signal),
                supabase.from('holidays').select('*', { count: 'exact' }).gte('date', startDate).lte('date', endDate).abortSignal(signal),
                fetchWithAuth(`/api/attendance?employee_id=${activeEmpId}&limit=1&payroll_preview=true`, { signal }).then(async response => response.ok ? (await response.json()).meta?.workPolicy : null).catch(() => null),
            ]);
            signal.throwIfAborted();
            const workPolicy = policy || queryClient.getQueryData(['employeeMonthlyAttendance', activeEmpId, selectedMonth])?.workPolicy;
            if (!workPolicy) throw new Error('Attendance policy cannot be verified. Retry when the backend is available.');
            const readError = [empRes, attRes, leavesRes, holidaysRes].find(result => result.error)?.error;
            if (readError || empRes.data?.id !== activeEmpId) throw new Error(readError?.message || 'Employee attendance records are unavailable.');
            for (const result of [attRes, leavesRes, holidaysRes]) {
                if (!Array.isArray(result.data) || result.count !== result.data.length) throw new Error('Monthly attendance records are incomplete. Retry after HR reconciles the data.');
            }
            return reconcileMonthlyAttendance({ employee: empRes.data, attendances: attRes.data, leaves: leavesRes.data, holidays: holidaysRes.data, month: selectedMonth, workPolicy });
        },
        enabled: Boolean(activeEmpId),
        staleTime: 30_000,
        gcTime: 300_000,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
    });
    const isLoading = isResolving || isMonthlyLoading;
    const monthlyError = resolutionError || queryError;

    useEffect(() => {
        if (!activeEmpId) return;
        let refreshTimer;
        const handleSync = () => {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['employeeMonthlyAttendance', activeEmpId] });
            }, 150);
        };
        const channel = supabase.channel(`monthly-attendance-live-${activeEmpId}`)
            .on('broadcast', { event: 'EMPLOYEE_UPDATED' }, handleSync)
            .on('broadcast', { event: 'LEAVE_STATUS_UPDATED' }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', filter: `employee_id=eq.${activeEmpId}` }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests', filter: `employee_id=eq.${activeEmpId}` }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${activeEmpId}` }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, handleSync)
            .subscribe(status => { if (status === 'SUBSCRIBED') handleSync(); });
        return () => {
            clearTimeout(refreshTimer);
            supabase.removeChannel(channel);
        };
    }, [activeEmpId, queryClient]);

    const summary = monthlyData?.summary || {
        total_calendar_days: getAttendanceMonthRange(selectedMonth).totalDays,
        expected_work_days: 0,
        days_present: 0,
        scheduled_days_present: 0,
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
    const selectedDayDetail = allDays.find(day => day.date === selectedDayDate) || null;
    useEffect(() => {
        if (!selectedDayDate) return;
        const opener = document.activeElement;
        dayDialog.current?.querySelector('button')?.focus();
        const onKeyDown = event => {
            if (event.key === 'Escape') { event.preventDefault(); setSelectedDayDate(null); }
            if (event.key !== 'Tab') return;
            const buttons = dayDialog.current?.querySelectorAll('button');
            const first = buttons?.[0], last = buttons?.[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => { document.removeEventListener('keydown', onKeyDown); if (opener?.isConnected) opener.focus(); };
    }, [selectedDayDate]);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const leaveHolidayStatuses = ['APPROVED_LEAVE', 'FUTURE_LEAVE', 'HOLIDAY', 'FUTURE_HOLIDAY'];
    const leaveHolidayCount = allDays.filter(day => leaveHolidayStatuses.includes(day.status)).length;

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
        if (statusFilter === 'leave') return allDays.filter(d => ['APPROVED_LEAVE', 'FUTURE_LEAVE', 'HOLIDAY', 'FUTURE_HOLIDAY'].includes(d.status));
        return allDays;
    }, [allDays, statusFilter]);

    // Style mapper for status themes (aligned with C-Point design system)
    const getStatusTheme = (day) => {
        switch (day?.status) {
            case 'PRESENT':
                return {
                    badgeBg: 'bg-slate-900 text-white border-slate-800',
                    iconBox: 'bg-slate-900 text-white border-slate-800',
                    dotBg: 'bg-slate-400',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-white',
                    cardHighlight: 'border-l-2 border-slate-900',
                    tag: 'Present',
                    icon: 'ti-check'
                };
            case 'LATE':
                return {
                    badgeBg: 'bg-warning-subtle text-warning-ink border-warning/20',
                    iconBox: 'bg-warning-subtle text-warning-ink border-warning/20',
                    dotBg: 'bg-warning',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-warning-subtle/20',
                    cardHighlight: 'border-l-2 border-l-warning',
                    tag: `Late (${day.minutes_late}m)`,
                    icon: 'ti-clock-alert'
                };
            case 'ABSENT':
                return {
                    badgeBg: 'bg-danger-subtle text-danger-ink border-danger/20',
                    iconBox: 'bg-danger-subtle text-danger-ink border-danger/20',
                    dotBg: 'bg-danger',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-danger-subtle/20',
                    cardHighlight: 'border-l-2 border-l-danger',
                    tag: 'Absent',
                    icon: 'ti-user-x'
                };
            case 'APPROVED_LEAVE':
            case 'FUTURE_LEAVE':
                return {
                    badgeBg: 'bg-accent-subtle text-accent border-accent/20',
                    iconBox: 'bg-accent-subtle text-accent border-accent/20',
                    dotBg: 'bg-accent',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-accent-subtle/20',
                    cardHighlight: 'border-l-2 border-l-accent',
                    tag: day.leave?.type || 'Leave',
                    icon: 'ti-file-certificate'
                };
            case 'HOLIDAY':
            case 'FUTURE_HOLIDAY':
                return {
                    badgeBg: 'bg-accent-subtle text-accent border-accent/20',
                    iconBox: 'bg-accent-subtle text-accent border-accent/20',
                    dotBg: 'bg-accent',
                    cardBorder: 'border-slate-200 hover:border-slate-300 bg-accent-subtle/20',
                    cardHighlight: 'border-l-2 border-l-accent',
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
                    badgeBg: 'bg-accent-subtle text-accent border-accent/20',
                    iconBox: 'bg-accent-subtle text-accent border-accent/20',
                    dotBg: 'bg-accent',
                    cardBorder: 'border-accent/20 bg-accent-subtle/30',
                    cardHighlight: 'border-l-2 border-l-accent',
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
        <div className={`bg-white rounded-lg shadow-2xs border border-slate-200 p-4 sm:p-6 space-y-4 sm:space-y-5 relative ${className}`}>
            {monthlyError && <p role="alert" className="mb-3 rounded-md bg-danger-subtle p-3 text-sm text-danger-ink">{monthlyError.message} Showing the last verified view where available.</p>}
            {/* Header Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 pb-4 border-b border-slate-100">
                <div className="flex items-start sm:items-center gap-3">
                    <div className="h-9 w-9 rounded-md flex items-center justify-center border bg-slate-50 text-slate-700 border-slate-200 shrink-0">
                        <i className="ti ti-calendar-time text-lg" />
                    </div>
                    <div>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                            {isEmployeeView ? 'Work calendar' : 'Monthly Work Schedule & Attendance Audit'}
                        </h3>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 justify-between sm:justify-end">
                    {/* Month Navigator */}
                    <div className="inline-flex items-center bg-slate-50 rounded-md p-0.5 border border-slate-200">
                        <button
                            type="button"
                            onClick={handlePrevMonth}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40"
                            title="Previous Month"
                            aria-label="Previous Month"
                        >
                            <i className="ti ti-chevron-left text-sm" />
                        </button>
                        <span className="px-2 text-xs font-semibold text-slate-800 select-none min-w-[105px] text-center">
                            {monthLabel}
                        </span>
                        <button
                            type="button"
                            onClick={handleNextMonth}
                            disabled={isLoading}
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40"
                            title="Next Month"
                            aria-label="Next Month"
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
                    {!isEmployeeView && <div className="inline-flex items-center bg-slate-100 rounded-md p-0.5 border border-slate-200">
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
                            <span>Calendar</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-all ${
                                viewMode === 'table' 
                                    ? 'bg-white text-slate-900 shadow-2xs font-semibold' 
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Audit Timeline View"
                        >
                            <i className="ti ti-list text-sm" />
                            <span>Timeline</span>
                        </button>
                    </div>}
                </div>
            </div>

            {/* KPI Metric Summary Cards */}
            {monthlyData && !isEmployeeView && <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
                <div className="bg-surface-muted p-3 sm:p-3.5 rounded-md border border-line flex flex-col justify-between">
                    <div className="flex items-center justify-between text-ink">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Days Rendered</span>
                        <i className="ti ti-circle-check text-sm text-ink" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-ink tabular-nums">
                            {summary.scheduled_days_present}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">/ {summary.expected_work_days} scheduled</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-ink">
                        {summary.days_present} total attended; {summary.attendance_rate_pct}% attendance
                    </div>
                </div>

                {/* Late Punches */}
                <div className="bg-warning-subtle/40 p-3 sm:p-3.5 rounded-md border border-warning/20 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-warning-ink">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Late Punches</span>
                        <i className="ti ti-clock-alert text-sm text-warning-ink" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-warning-ink tabular-nums">
                            {summary.days_late}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">punches</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-warning-ink">
                        {summary.total_late_minutes}m total tardiness
                    </div>
                </div>

                {/* Unexcused Absences */}
                <div className="bg-danger-subtle/40 p-3 sm:p-3.5 rounded-md border border-danger/20 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-danger-ink">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Absences</span>
                        <i className="ti ti-user-x text-sm text-danger-ink" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-danger-ink tabular-nums">
                            {summary.days_absent}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">days unexcused</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-danger-ink">
                        {summary.days_absent === 0 ? 'Zero unexcused absences' : 'Absence deduction applies'}
                    </div>
                </div>

                {/* Approved Leaves */}
                <div className="col-span-2 sm:col-span-1 bg-accent-subtle/40 p-3 sm:p-3.5 rounded-md border border-accent/20 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-accent">
                        <span className="text-[10px] font-semibold uppercase tracking-wider">Approved Leaves</span>
                        <i className="ti ti-file-certificate text-sm text-accent" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                        <span className="text-xl sm:text-2xl font-bold font-mono text-accent tabular-nums">
                            {summary.approved_leaves}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">days filed</span>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-accent">
                        Authorized by HR
                    </div>
                </div>
            </div>}

            {/* Filter Pills */}
            {!isEmployeeView && <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap no-scrollbar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border shrink-0 whitespace-nowrap ${
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
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border shrink-0 whitespace-nowrap ${
                        statusFilter === 'present'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                            : 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200'
                    }`}
                >
                    Present ({summary.days_on_time})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('late')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border shrink-0 whitespace-nowrap ${
                        statusFilter === 'late'
                            ? 'bg-warning text-white border-warning shadow-2xs'
                            : 'bg-white text-warning-ink hover:bg-warning-subtle border-warning/20'
                    }`}
                >
                    Lates ({summary.days_late})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('absent')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border shrink-0 whitespace-nowrap ${
                        statusFilter === 'absent'
                            ? 'bg-danger text-white border-danger shadow-2xs'
                            : 'bg-white text-danger-ink hover:bg-danger-subtle border-danger/20'
                    }`}
                >
                    Absents ({summary.days_absent})
                </button>
                <button
                    type="button"
                    onClick={() => setStatusFilter('leave')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer border shrink-0 whitespace-nowrap ${
                        statusFilter === 'leave'
                            ? 'bg-accent text-white border-accent shadow-2xs'
                            : 'bg-white text-accent hover:bg-accent-subtle border-accent/20'
                    }`}
                >
                    Leaves &amp; Holidays ({leaveHolidayCount})
                </button>
            </div>}

            {/* View Container */}
            {isLoading ? (
                <div className="rounded-md border border-slate-200 p-12 text-center bg-slate-50/40">
                    <div className="inline-block animate-spin text-slate-600 mb-3">
                        <i className="ti ti-loader-2 text-2xl" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Loading calendar...</p>
                </div>
            ) : !monthlyData ? (
                <p className="rounded-md border border-slate-200 p-8 text-center text-sm text-slate-500">Calendar unavailable. Please try again.</p>
            ) : viewMode === 'grid' ? (
                /* 7-Column Calendar Grid View */
                <div className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-2xs">
                    {/* Weekday Header */}
                    <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider py-2">
                        {WEEKDAYS.map((wd, idx) => (
                            <div key={wd} className={monthlyData?.employee?.rest_days.includes((idx + 1) % 7) ? 'text-slate-400' : 'text-slate-600'}>
                                <span className="sm:hidden">{wd[0]}</span>
                                <span className="hidden sm:inline">{wd}</span>
                            </div>
                        ))}
                    </div>

                    {/* Day Cells Grid */}
                    <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 bg-slate-50/20">
                        {calendarGrid.map((item) => {
                            if (item.isBlank) {
                                return (
                                    <div key={item.key} className={`min-h-[56px] ${isEmployeeView ? 'sm:min-h-[76px]' : 'sm:min-h-[105px]'} bg-slate-50/40`} />
                                );
                            }

                            const theme = getStatusTheme(item);
                            const matchesFilter = statusFilter === 'all' || 
                                (statusFilter === 'present' && item.status === 'PRESENT') ||
                                (statusFilter === 'late' && item.status === 'LATE') ||
                                (statusFilter === 'absent' && item.status === 'ABSENT') ||
                                (statusFilter === 'leave' && leaveHolidayStatuses.includes(item.status));

                            return (
                                <button
                                    type="button"
                                    key={item.key}
                                    aria-label={`${item.date}: ${item.status_label}`}
                                    onClick={() => setSelectedDayDetail(item)}
                                    className={`min-w-0 text-left min-h-[56px] ${isEmployeeView ? 'sm:min-h-[76px]' : 'sm:min-h-[105px]'} p-1 sm:p-2 transition-all cursor-pointer relative group flex flex-col justify-between hover:bg-slate-50/80 active:scale-[0.98] ${
                                        theme.cardBorder
                                    } ${theme.cardHighlight} ${
                                        matchesFilter ? 'opacity-100' : 'opacity-35 hover:opacity-100'
                                    } ${item.is_today ? 'ring-1 ring-inset ring-accent bg-accent-subtle/20 z-10' : ''}`}
                                >
                                    {/* Day Top Bar */}
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[11px] sm:text-xs font-semibold ${
                                            item.is_today 
                                                ? 'h-4 w-4 sm:h-5 sm:w-5 rounded bg-accent text-white flex items-center justify-center font-bold text-[10px] sm:text-[11px]' 
                                                : item.day_of_week === 0 
                                                    ? 'text-ink font-bold' 
                                                    : 'text-slate-800'
                                        }`}>
                                            {item.day_number}
                                        </span>

                                    </div>

                                    {/* Middle Content */}
                                    <div className="my-0.5 sm:my-1.5 space-y-1">
                                        {/* Desktop View (sm and up) */}
                                        <div className="hidden sm:block space-y-1">
                                            {item.status === 'PRESENT' && (
                                                <div className="text-[10px] font-semibold text-white bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 truncate">
                                                    {item.time_in_formatted}
                                                </div>
                                            )}

                                            {item.status === 'LATE' && (
                                                <div className="text-[10px] font-semibold text-warning-ink bg-warning-subtle px-1.5 py-0.5 rounded border border-warning/70 truncate">
                                                    {item.time_in_formatted} <span className="hidden sm:inline">({item.minutes_late}m)</span>
                                                </div>
                                            )}

                                            {item.status === 'ABSENT' && (
                                                <div className="text-[10px] font-semibold text-danger-ink bg-danger-subtle px-1.5 py-0.5 rounded border border-danger/70 truncate">
                                                    Absent
                                                </div>
                                            )}

                                            {(item.status === 'APPROVED_LEAVE' || item.status === 'FUTURE_LEAVE') && (
                                                <div className="text-[10px] font-semibold text-accent bg-accent-subtle px-1.5 py-0.5 rounded border border-accent/70 truncate" title={item.status_label}>
                                                    On leave
                                                </div>
                                            )}

                                            {(item.status === 'HOLIDAY' || item.status === 'FUTURE_HOLIDAY') && (
                                                <div className="text-[10px] font-semibold text-accent bg-accent-subtle px-1.5 py-0.5 rounded border border-accent/70 truncate" title={item.holiday?.name}>
                                                    Holiday
                                                </div>
                                            )}

                                            {(item.status === 'REST_DAY' || item.status === 'FUTURE_REST_DAY') && (
                                                <div className="text-[10px] font-medium text-slate-400">
                                                    Rest Day
                                                </div>
                                            )}

                                            {item.status === 'AWAITING_PUNCH' && (
                                                <div className="text-[10px] font-semibold text-accent bg-accent-subtle px-1.5 py-0.5 rounded border border-accent/20 truncate">
                                                    Today
                                                </div>
                                            )}

                                            {item.status === 'SCHEDULED' && (
                                                <div className="text-[10px] font-medium text-slate-400">
                                                    Scheduled
                                                </div>
                                            )}
                                        </div>

                                        {/* Mobile View (< sm) */}
                                        <div className="sm:hidden">
                                            {item.status === 'PRESENT' && (
                                                <span className="text-[8px] font-mono font-bold text-white bg-slate-900 rounded px-1 py-0.5 truncate block text-center leading-none">
                                                    {item.time_in_formatted ? item.time_in_formatted.replace(' AM', '').replace(' PM', '') : 'In'}
                                                </span>
                                            )}
                                            {item.status === 'LATE' && (
                                                <span className="text-[8px] font-mono font-bold text-warning-ink bg-warning-subtle border border-warning/30 rounded px-1 py-0.5 truncate block text-center leading-none">
                                                    +{item.minutes_late}m
                                                </span>
                                            )}
                                            {item.status === 'ABSENT' && (
                                                <span className="text-[8px] font-bold text-danger-ink bg-danger-subtle border border-danger/30 rounded px-1 py-0.5 truncate block text-center leading-none">
                                                    Abs
                                                </span>
                                            )}
                                            {(item.status === 'APPROVED_LEAVE' || item.status === 'FUTURE_LEAVE') && (
                                                <span className="text-[8px] font-bold text-accent bg-accent-subtle border border-accent/30 rounded px-1 py-0.5 truncate block text-center leading-none">
                                                    Leave
                                                </span>
                                            )}
                                            {(item.status === 'HOLIDAY' || item.status === 'FUTURE_HOLIDAY') && (
                                                <span className="text-[8px] font-bold text-accent bg-accent-subtle border border-accent/30 rounded px-1 py-0.5 truncate block text-center leading-none">
                                                    Hol
                                                </span>
                                            )}
                                            {(item.status === 'REST_DAY' || item.status === 'FUTURE_REST_DAY') && (
                                                <span className="text-[8px] text-slate-400 font-medium block text-center leading-none">
                                                    Rest
                                                </span>
                                            )}
                                            {item.status === 'AWAITING_PUNCH' && (
                                                <span className="text-[8px] font-bold text-accent bg-accent-subtle rounded px-1 py-0.5 truncate block text-center leading-none">
                                                    Today
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Bottom Info: Hours Worked (Desktop) */}
                                    <div className="hidden sm:block text-[9px] text-slate-400 font-mono truncate">
                                        {item.time_out_formatted ? `Out: ${item.time_out_formatted}` : item.hours_worked ? `${item.hours_worked} hrs` : ''}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Mobile Tap Guide */}
                    <div className="sm:hidden px-3 py-2 text-center text-[10px] text-slate-400 border-t border-slate-100 bg-slate-50/50 flex items-center justify-center gap-1.5">
                        <i className="ti ti-hand-click text-xs text-slate-400" />
                        <span>Select a date for details</span>
                    </div>
                </div>
            ) : (
                /* Chronological Audit Table & Mobile Card View */
                <div className="border border-slate-200 rounded-md overflow-hidden bg-white shadow-2xs">
                    {/* Mobile Dynamic Card Stack (< md) */}
                    <div className="md:hidden divide-y divide-slate-100">
                        {filteredDays.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-xs">
                                No attendance records found matching the active filter.
                            </div>
                        ) : (
                            filteredDays.map((day) => {
                                const theme = getStatusTheme(day);
                                return (
                                    <div
                                        key={day.date}
                                        onClick={() => setSelectedDayDetail(day)}
                                        className={`p-3.5 transition-colors cursor-pointer hover:bg-slate-50 space-y-2.5 active:bg-slate-100 ${
                                            day.is_today ? 'bg-accent-subtle/20' : ''
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-baseline gap-2">
                                                <span className="font-mono font-bold text-xs text-slate-900">{day.date}</span>
                                                <span className="text-xs text-slate-500 font-medium">{day.full_day_name}</span>
                                            </div>
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${theme.badgeBg}`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${theme.dotBg}`} />
                                                {day.status_label}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50/70 p-2.5 rounded border border-slate-100">
                                            <div className="space-y-0.5">
                                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Clock In / Out</span>
                                                <div className="font-mono text-xs font-semibold text-slate-800">
                                                    {day.time_in_formatted || '--:--'} <span className="text-slate-400 font-normal">to</span> {day.time_out_formatted || '--:--'}
                                                </div>
                                            </div>
                                            <div className="space-y-0.5 text-right">
                                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Duration &amp; Delay</span>
                                                <div className="text-xs font-semibold">
                                                    {day.minutes_late > 0 ? (
                                                        <span className="text-warning-ink font-semibold">+{day.minutes_late}m late</span>
                                                    ) : day.status === 'PRESENT' ? (
                                                        <span className="text-slate-700 font-medium">On-time</span>
                                                    ) : (
                                                        <span className="text-slate-400">--</span>
                                                    )}
                                                    {day.hours_worked ? <span className="text-slate-500 font-normal"> · {day.hours_worked}h</span> : ''}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between text-[11px] pt-0.5 text-slate-500">
                                            <span className="text-[10px] text-slate-400">
                                                {day.time_in_photo ? 'Biometric photo attached' : 'Standard biometric punch'}
                                            </span>
                                            <span className="font-semibold text-accent hover:text-accent-strong flex items-center gap-1">
                                                Inspect <i className="ti ti-chevron-right text-xs" />
                                            </span>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Desktop Table View (>= md) */}
                    <div className="hidden md:block overflow-x-auto">
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
                                                    day.is_today ? 'bg-accent-subtle/20' : ''
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
                                                        <span className="font-semibold text-warning-ink">
                                                            +{day.minutes_late} mins
                                                        </span>
                                                    ) : day.status === 'PRESENT' ? (
                                                        <span className="text-slate-700 font-medium">On-time</span>
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
                                                        className="text-xs font-medium text-accent hover:text-accent-strong cursor-pointer"
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
                        ref={dayDialog} role="dialog" aria-modal="true" aria-labelledby="calendar-day-title"
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
                                    <h3 id="calendar-day-title" className="text-base font-semibold text-slate-900">
                                        {selectedDayDetail.full_day_name}, {selectedDayDetail.date}
                                    </h3>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedDayDetail(null)}
                                className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-md hover:bg-slate-100 cursor-pointer"
                                title="Close" aria-label="Close day details"
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="space-y-3.5 text-sm">
                            <div className={`p-3 rounded-md border flex items-center justify-between ${getStatusTheme(selectedDayDetail).badgeBg}`}>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-xs uppercase tracking-wider">Attendance Status</span>
                                </div>
                                <span className={`font-semibold text-xs px-2 py-0.5 rounded border ${
                                    selectedDayDetail.status === 'PRESENT'
                                        ? 'bg-slate-800 text-white border-slate-700'
                                        : 'bg-white/80'
                                }`}>
                                    {selectedDayDetail.status_label}
                                </span>
                            </div>

                            {(!isEmployeeView || !selectedDayDetail.leave || selectedDayDetail.time_in) && <>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Call Time</span>
                                    <span className="font-semibold text-slate-800 text-sm mt-0.5 block font-mono">08:00 AM</span>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-md border border-slate-200">
                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Duration Rendered</span>
                                    <span className="font-semibold text-slate-800 text-sm mt-0.5 block font-mono">
                                        {selectedDayDetail.hours_worked ? `${selectedDayDetail.hours_worked} hrs` : '--'}
                                    </span>
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
                                    <span className={`font-mono font-semibold ${selectedDayDetail.minutes_late > 0 ? 'text-warning-ink' : 'text-ink'}`}>
                                        {selectedDayDetail.minutes_late > 0 ? `+${selectedDayDetail.minutes_late} minutes` : '0 mins (On Time)'}
                                    </span>
                                </div>
                            </div>

                            </>}
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
                                    <span className="font-semibold text-slate-900">Note: </span>
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
