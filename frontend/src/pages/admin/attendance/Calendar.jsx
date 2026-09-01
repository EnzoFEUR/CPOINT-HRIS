import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

const formatDateKey = (dateObj) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const timelinePhotoCache = new Map();

const TimelinePhoto = ({ photoPath, employeeName }) => {
    const photoUrl = photoPath ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${photoPath}` : null;
    const initialStatus = photoUrl ? timelinePhotoCache.get(photoUrl) : null;
    const [status, setStatus] = useState(() => initialStatus || 'loading');

    useEffect(() => {
        if (!photoUrl) {
            setStatus('failed');
            return;
        }
        const cached = timelinePhotoCache.get(photoUrl);
        if (cached) setStatus(cached);
        else setStatus('loading');
    }, [photoUrl]);

    const handleLoad = () => {
        if (photoUrl) timelinePhotoCache.set(photoUrl, 'loaded');
        setStatus('loaded');
    };

    const handleError = () => {
        if (photoUrl) timelinePhotoCache.set(photoUrl, 'failed');
        setStatus('failed');
    };

    const initial = employeeName ? employeeName.charAt(0).toUpperCase() : '?';
    const isLoaded = status === 'loaded';
    const isFailed = status === 'failed';

    return (
        <div 
            onContextMenu={(e) => e.preventDefault()}
            className="h-14 w-14 sm:h-16 sm:w-16 rounded-lg bg-slate-100 overflow-hidden shadow-xs shrink-0 relative border border-slate-200 flex items-center justify-center select-none"
        >
            <span className="font-bold text-slate-400 text-base sm:text-xl select-none pointer-events-none">
                {initial}
            </span>
            {photoUrl && !isFailed && (
                <img
                    src={photoUrl}
                    onLoad={handleLoad}
                    onError={handleError}
                    onContextMenu={(e) => e.preventDefault()}
                    draggable={false}
                    className={`absolute inset-0 w-full h-full object-cover pointer-events-none select-none ${
                        isLoaded ? 'opacity-100' : 'opacity-0'
                    } ${isLoaded ? '' : 'transition-opacity duration-150'}`}
                    alt="Time In Proof"
                />
            )}
        </div>
    );
};

const Calendar = () => {
    const queryClient = useQueryClient();
    const [selectedDate, setSelectedDate] = useState(() => new Date());
    const hasUserPicked = useRef(Boolean(sessionStorage.getItem('calendar_user_picked')));
    const hasAutoNavigated = useRef(false);

    const dateStr = useMemo(() => formatDateKey(selectedDate), [selectedDate]);

    // Query calendar data for selected date and month
    const { data: calendarData, isLoading, isFetching } = useQuery({
        queryKey: ['attendanceCalendar', dateStr],
        queryFn: async () => {
            const res = await fetchWithAuth(`/api/attendance/calendar?date=${dateStr}`);
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Failed to fetch calendar');
            return result.data || result || {};
        },
        staleTime: 30000,
    });

    // Auto-focus latest active date on initial load if current day has no records
    useEffect(() => {
        if (!hasUserPicked.current && !hasAutoNavigated.current && calendarData) {
            const logs = calendarData.dailyLogs || [];
            const dates = calendarData.activeDates || [];
            if (logs.length === 0 && dates.length > 0) {
                hasAutoNavigated.current = true;
                const latestDateStr = dates[dates.length - 1];
                const [y, m, d] = latestDateStr.split('-');
                setSelectedDate(new Date(Number(y), Number(m) - 1, Number(d)));
            }
        }
    }, [calendarData]);

    const activeDateSet = useMemo(() => {
        const dates = calendarData?.activeDates || [];
        return new Set(dates);
    }, [calendarData]);

    // Supabase Realtime WebSocket Subscription
    useEffect(() => {
        const subscription = supabase
            .channel('attendance_live_calendar')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                queryClient.invalidateQueries({ queryKey: ['attendanceCalendar'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [queryClient]);

    const onPrevMonth = () => {
        hasUserPicked.current = true;
        sessionStorage.setItem('calendar_user_picked', '1');
        setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    };

    const onNextMonth = () => {
        hasUserPicked.current = true;
        sessionStorage.setItem('calendar_user_picked', '1');
        setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    };

    const onSelectDay = (day) => {
        hasUserPicked.current = true;
        sessionStorage.setItem('calendar_user_picked', '1');
        setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day));
    };

    // Calendar grid calculations
    const { year, month, daysInMonth, firstDayOfWeek, monthYearFormatted } = useMemo(() => {
        const y = selectedDate.getFullYear();
        const m = selectedDate.getMonth();
        const days = new Date(y, m + 1, 0).getDate();
        const first = new Date(y, m, 1).getDay();
        const formatted = selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        return { year: y, month: m, daysInMonth: days, firstDayOfWeek: first, monthYearFormatted: formatted };
    }, [selectedDate]);

    const emptyCells = useMemo(() => {
        return Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="h-9 w-9 sm:h-10 sm:w-10" />
        ));
    }, [firstDayOfWeek]);

    const dayCells = useMemo(() => {
        const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const todayKey = formatDateKey(new Date());

        return Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dayKey = `${currentMonthKey}-${String(dayNum).padStart(2, '0')}`;
            const isSelected = selectedDate.getDate() === dayNum;
            const isToday = dayKey === todayKey;
            const hasData = activeDateSet.has(dayKey);

            return (
                <button
                    key={`day-${dayNum}`}
                    onClick={() => onSelectDay(dayNum)}
                    className={`h-9 w-9 sm:h-10 sm:w-10 rounded-lg text-xs font-semibold relative transition-colors flex items-center justify-center select-none ${
                        isSelected
                            ? 'bg-blue-600 text-white shadow-xs font-bold'
                            : isToday
                            ? 'bg-blue-50 text-blue-600 border border-blue-200'
                            : 'text-slate-700 hover:bg-slate-100'
                    }`}
                >
                    {dayNum}
                    {hasData && (
                        <span 
                            className={`absolute bottom-1 h-1 w-1 rounded-full ${
                                isSelected ? 'bg-white' : 'bg-blue-500'
                            }`}
                        />
                    )}
                </button>
            );
        });
    }, [daysInMonth, year, month, selectedDate, activeDateSet]);

    const dailyLogs = calendarData?.dailyLogs || [];

    // Chronological logs
    const sortedLogs = useMemo(() => {
        return [...dailyLogs].sort((a, b) => new Date(a.time_in) - new Date(b.time_in));
    }, [dailyLogs]);

    const totalAbsent = sortedLogs.filter(log => String(log.status).toLowerCase() === 'absent').length;
    const totalLate = sortedLogs.filter(log => String(log.status).toLowerCase() === 'late').length;
    const onTime = sortedLogs.filter(log => String(log.status).toLowerCase() === 'present').length;

    const showInitialLoading = isLoading && !calendarData;

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Attendance', 'Workforce Timeline']}
                title="Workforce Timeline"
                description="Chronological arrival tracking, daily punctuality distributions, and biometric verification logs."
            />

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
                
                {/* Left Side: Stats & Calendar Picker */}
                <div className="xl:col-span-1 space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                        <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-slate-200 flex flex-col justify-between">
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <i className="ti ti-thumb-up text-emerald-600 text-sm"></i> On Time
                            </span>
                            <span className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums">
                                {onTime}
                            </span>
                        </div>
                        <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-slate-200 flex flex-col justify-between">
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <i className="ti ti-alert-triangle text-amber-600 text-sm"></i> Late
                            </span>
                            <span className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums">
                                {totalLate}
                            </span>
                        </div>
                        <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-slate-200 flex flex-col justify-between">
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                                <i className="ti ti-user-x text-rose-600 text-sm"></i> Absent
                            </span>
                            <span className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-rose-600 tabular-nums">
                                {totalAbsent}
                            </span>
                        </div>
                    </div>

                    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-xs border border-slate-200">
                        <div className="flex justify-between items-center mb-4">
                            <button onClick={onPrevMonth} className="h-8 w-8 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors border border-slate-200">
                                <i className="ti ti-chevron-left text-sm"></i>
                            </button>
                            <span className="font-semibold text-slate-900 text-sm sm:text-base">
                                {monthYearFormatted}
                            </span>
                            <button onClick={onNextMonth} className="h-8 w-8 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors border border-slate-200">
                                <i className="ti ti-chevron-right text-sm"></i>
                            </button>
                        </div>

                        <div className="grid grid-cols-7 text-center mb-2">
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                                <span key={day} className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-1">{day}</span>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 place-items-center gap-y-1.5 gap-x-1">
                            {emptyCells}
                            {dayCells}
                        </div>
                    </div>
                </div>

                {/* Right Side: Detailed Timeline */}
                <div className="xl:col-span-2">
                    <div className="bg-white p-4 sm:p-8 lg:p-10 rounded-2xl shadow-xs sm:shadow-sm border border-slate-200 min-h-[400px] sm:min-h-[500px]">
                        <div className="flex items-center justify-between mb-5 sm:mb-8 pb-4 border-b border-slate-100">
                            <h3 className="font-black text-slate-800 text-lg sm:text-2xl flex flex-wrap items-center gap-2 sm:gap-3">
                                <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shrink-0">
                                    <i className="ti ti-clock-play text-base sm:text-xl"></i>
                                </div>
                                <span className="text-blue-600 text-sm sm:text-xl">
                                    {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                </span>
                            </h3>

                            {isFetching && !showInitialLoading && (
                                <div className="flex items-center gap-1.5 text-xs text-blue-600 font-bold">
                                    <i className="ti ti-loader-2 animate-spin text-sm" />
                                    <span className="hidden sm:inline">Syncing...</span>
                                </div>
                            )}
                        </div>

                        {showInitialLoading ? (
                            <div className="flex flex-col items-center justify-center h-64 sm:h-80 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 mt-4 sm:mt-8">
                                <div className="h-12 w-12 sm:h-16 sm:w-16 bg-white shadow-xs border border-slate-100 rounded-full flex items-center justify-center mb-3 sm:mb-4">
                                    <i className="ti ti-loader-2 text-2xl sm:text-3xl text-blue-500 animate-spin"></i>
                                </div>
                                <p className="text-slate-600 font-bold text-sm sm:text-lg">Fetching Attendance Logs...</p>
                            </div>
                        ) : sortedLogs.length > 0 ? (
                            <div className="relative pl-5 sm:pl-8 border-l-2 sm:border-l-[3px] border-slate-200 space-y-4 sm:space-y-6 pb-2 ml-1 sm:ml-4">
                                
                                    {sortedLogs.map((log, idx) => {
                                        const fullName = log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown Worker';
                                        const statusStr = String(log.status || '').toLowerCase();
                                        const isAbsent = statusStr === 'absent';
                                        const isLate = statusStr === 'late';

                                        return (
                                            <div 
                                                key={log.id || idx}
                                                className="relative group"
                                            >
                                                <div className={`absolute -left-[27px] sm:-left-[41px] top-5 sm:top-6 h-4 w-4 sm:h-5 sm:w-5 rounded-full border-2 sm:border-4 border-white shadow-md transition-transform duration-300 group-hover:scale-125 ${
                                                    isAbsent ? 'bg-red-500' : isLate ? 'bg-orange-500' : 'bg-emerald-500'
                                                }`}></div>
                                                
                                                <div className="bg-white rounded-2xl p-3.5 sm:p-6 border border-slate-200 shadow-xs sm:shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row gap-3 sm:gap-6 items-start sm:items-center">
                                                    
                                                    <TimelinePhoto
                                                        photoPath={log.time_in_photo}
                                                        employeeName={fullName}
                                                    />
                                                    
                                                    <div className="flex-1 w-full min-w-0">
                                                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 mb-1.5 sm:mb-2">
                                                            {isAbsent ? (
                                                                <span className="font-mono font-bold text-red-600 bg-red-50 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md border border-red-200 text-[10px] sm:text-xs shadow-xs flex items-center gap-1 sm:gap-1.5">
                                                                    <i className="ti ti-user-x text-red-500 text-xs sm:text-sm"></i>
                                                                    No Biometric Scans (Absent)
                                                                </span>
                                                            ) : (
                                                                <>
                                                                    <span className="font-mono font-medium text-slate-600 bg-slate-50 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md border border-slate-200 text-[10px] sm:text-xs shadow-xs flex items-center gap-1 sm:gap-1.5">
                                                                        <i className="ti ti-login-2 text-blue-500 text-xs sm:text-sm"></i>
                                                                        In: {log.time_in ? new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                                                    </span>
                                                                    {log.time_out && (
                                                                        <span className="font-mono font-medium text-slate-500 bg-slate-50 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md border border-slate-200 text-[10px] sm:text-xs shadow-xs flex items-center gap-1 sm:gap-1.5">
                                                                            <i className="ti ti-logout-2 text-rose-400 text-xs sm:text-sm"></i>
                                                                            Out: {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                        
                                                        <p className="font-bold text-slate-800 text-sm sm:text-xl tracking-tight truncate">
                                                            {fullName}
                                                        </p>
                                                        <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-slate-400 mt-0.5 sm:mt-1 truncate">
                                                            {log.employees?.job_title || 'Staff'} &bull; {log.employees?.department || 'General'}
                                                        </p>
                                                    </div>

                                                    <div className="w-full sm:w-auto mt-1 sm:mt-0 flex sm:block shrink-0">
                                                        {isAbsent ? (
                                                            <span className="w-full sm:w-auto bg-red-100 text-red-700 px-3.5 sm:px-5 py-1.5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-widest border border-red-200 flex items-center justify-center gap-1.5 sm:gap-2 shadow-xs">
                                                                <i className="ti ti-user-x text-base sm:text-xl"></i> Absent
                                                            </span>
                                                        ) : isLate ? (
                                                            <span className="w-full sm:w-auto bg-orange-100 text-orange-700 px-3.5 sm:px-5 py-1.5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-widest border border-orange-200 flex items-center justify-center gap-1.5 sm:gap-2 shadow-xs">
                                                                <i className="ti ti-alert-triangle text-base sm:text-xl"></i> Late
                                                            </span>
                                                        ) : (
                                                            <span className="w-full sm:w-auto bg-emerald-100 text-emerald-700 px-3.5 sm:px-5 py-1.5 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold uppercase tracking-widest border border-emerald-200 flex items-center justify-center gap-1.5 sm:gap-2 shadow-xs">
                                                                <i className="ti ti-thumb-up text-base sm:text-xl"></i> On Time
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 sm:h-80 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 mt-4 sm:mt-8">
                                <div className="h-14 w-14 sm:h-20 sm:w-20 bg-white shadow-xs border border-slate-100 rounded-full flex items-center justify-center mb-3 sm:mb-4">
                                    <i className="ti ti-calendar-off text-2xl sm:text-4xl text-slate-300"></i>
                                </div>
                                <p className="text-slate-800 font-black text-base sm:text-xl tracking-tight">No Attendance Records</p>
                                <p className="text-slate-500 font-medium text-xs sm:text-sm mt-1 max-w-sm">No biometric attendance logs were recorded on this date.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Calendar;
