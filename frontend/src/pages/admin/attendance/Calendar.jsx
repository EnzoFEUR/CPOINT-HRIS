import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';

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
            className="h-14 w-14 sm:h-20 sm:w-20 rounded-xl bg-slate-100 overflow-hidden shadow-inner shrink-0 relative border border-slate-200 flex items-center justify-center select-none"
        >
            <span className="font-black text-slate-400 text-lg sm:text-2xl select-none pointer-events-none">
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

    const activeDates = calendarData?.activeDates || [];
    const dailyLogs = calendarData?.dailyLogs || [];

    const onDateSelect = (newDateStr) => {
        hasUserPicked.current = true;
        sessionStorage.setItem('calendar_user_picked', 'true');
        const [y, m, d] = newDateStr.split('-');
        setSelectedDate(new Date(Number(y), Number(m) - 1, Number(d)));
    };

    const onPrevMonth = () => {
        setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
    };

    const onNextMonth = () => {
        setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
    };

    const monthYearFormatted = selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Day logic
    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const startDayOfWeek = startOfMonth.getDay();

    const emptyCells = Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`empty-${i}`}></div>);

    const daysInMonth = endOfMonth.getDate();
    const dayCells = Array.from({ length: daysInMonth }).map((_, i) => {
        const day = i + 1;
        const cellDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
        const cellDateString = formatDateKey(cellDate);

        const isSelected = cellDateString === dateStr;
        const hasLogs = activeDates.includes(cellDateString);

        return (
            <button
                key={cellDateString}
                onClick={() => onDateSelect(cellDateString)}
                className={`relative w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-xl transition-all duration-200 text-xs sm:text-sm font-semibold select-none ${
                    isSelected 
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-bold scale-105' 
                        : 'hover:bg-slate-100 text-slate-700 active:scale-95'
                }`}
            >
                <span>{day}</span>
                {hasLogs && (
                    <div className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`}></div>
                )}
            </button>
        );
    });

    // Chronological logs
    const sortedLogs = useMemo(() => {
        return [...dailyLogs].sort((a, b) => new Date(a.time_in) - new Date(b.time_in));
    }, [dailyLogs]);

    const totalPresent = sortedLogs.length;
    const totalLate = sortedLogs.filter(log => String(log.status).toLowerCase() === 'late').length;
    const onTime = totalPresent - totalLate;

    const showInitialLoading = isLoading && !calendarData;

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans space-y-4 sm:space-y-6">
            
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 sm:p-8 lg:p-10 shadow-xs sm:shadow-sm group">
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-8">
                    <div>
                        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
                            <div className="h-9 w-9 sm:h-12 sm:w-12 bg-white/10 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
                                <i className="ti ti-calendar-stats text-lg sm:text-2xl text-blue-400" />
                            </div>
                            <span className="px-2.5 sm:px-4 py-0.5 sm:py-1.5 text-[10px] sm:text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-300 rounded-md border border-blue-500/30">Analytics Mode</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">Workforce Timeline</h1>
                        <p className="text-blue-100/70 font-medium mt-1 text-xs sm:text-base max-w-xl">Visually track employee arrivals throughout the day.</p>
                    </div>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
                
                {/* Left Side: Stats & Calendar Picker */}
                <div className="xl:col-span-1 space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-xs sm:shadow-sm border border-slate-200 relative overflow-hidden flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                <i className="ti ti-thumb-up text-emerald-500 text-base sm:text-lg"></i> On Time
                            </p>
                            {showInitialLoading ? (
                                <div className="h-8 sm:h-12 w-16 bg-slate-100 rounded-lg animate-pulse my-1" />
                            ) : (
                                <p className="text-3xl sm:text-5xl font-black text-slate-800 tracking-tight">
                                    {onTime}
                                </p>
                            )}
                        </div>
                        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-xs sm:shadow-sm border border-slate-200 relative overflow-hidden flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                <i className="ti ti-alert-triangle text-orange-500 text-base sm:text-lg"></i> Late
                            </p>
                            {showInitialLoading ? (
                                <div className="h-8 sm:h-12 w-16 bg-slate-100 rounded-lg animate-pulse my-1" />
                            ) : (
                                <p className="text-3xl sm:text-5xl font-black text-slate-800 tracking-tight">
                                    {totalLate}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="bg-white p-4 sm:p-6 lg:p-8 rounded-2xl shadow-xs sm:shadow-sm border border-slate-200">
                        <div className="flex justify-between items-center mb-5 sm:mb-8">
                            <button onClick={onPrevMonth} className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors border border-slate-200 shadow-xs tap-active">
                                <i className="ti ti-chevron-left text-base sm:text-lg"></i>
                            </button>
                            <span className="font-black text-slate-800 text-sm sm:text-base lg:text-lg uppercase tracking-wide">
                                {monthYearFormatted}
                            </span>
                            <button onClick={onNextMonth} className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors border border-slate-200 shadow-xs tap-active">
                                <i className="ti ti-chevron-right text-base sm:text-lg"></i>
                            </button>
                        </div>

                        <div className="grid grid-cols-7 text-center mb-2 sm:mb-4">
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                                <span key={day} className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-1.5 sm:py-2">{day}</span>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 place-items-center gap-y-2 sm:gap-y-3 gap-x-1">
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
                                <AnimatePresence>
                                    {sortedLogs.map((log, idx) => {
                                        const fullName = log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown Worker';
                                        const isLate = String(log.status).toLowerCase() === 'late';

                                        return (
                                            <div 
                                                key={log.id || idx}
                                                className="relative group"
                                            >
                                                <div className={`absolute -left-[27px] sm:-left-[41px] top-5 sm:top-6 h-4 w-4 sm:h-5 sm:w-5 rounded-full border-2 sm:border-4 border-white shadow-md transition-transform duration-300 group-hover:scale-125 ${isLate ? 'bg-orange-500' : 'bg-emerald-500'}`}></div>
                                                
                                                <div className="bg-white rounded-2xl p-3.5 sm:p-6 border border-slate-200 shadow-xs sm:shadow-sm hover:shadow-md transition-all flex flex-col sm:flex-row gap-3 sm:gap-6 items-start sm:items-center">
                                                    
                                                    <TimelinePhoto
                                                        photoPath={log.time_in_photo}
                                                        employeeName={fullName}
                                                    />
                                                    
                                                    <div className="flex-1 w-full min-w-0">
                                                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 mb-1.5 sm:mb-2">
                                                            <span className="font-mono font-medium text-slate-600 bg-slate-50 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md border border-slate-200 text-[10px] sm:text-xs shadow-xs flex items-center gap-1 sm:gap-1.5">
                                                                <i className="ti ti-login-2 text-blue-500 text-xs sm:text-sm"></i>
                                                                In: {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                            {log.time_out && (
                                                                <span className="font-mono font-medium text-slate-500 bg-slate-50 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md border border-slate-200 text-[10px] sm:text-xs shadow-xs flex items-center gap-1 sm:gap-1.5">
                                                                    <i className="ti ti-logout-2 text-rose-400 text-xs sm:text-sm"></i>
                                                                    Out: {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                                </span>
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
                                                        {isLate ? (
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
                                </AnimatePresence>
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
