import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';

const Calendar = () => {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [activeDates, setActiveDates] = useState([]);
    const [dailyLogs, setDailyLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchCalendarData = async (dateObj) => {
        setIsLoading(true);
        try {
            // format YYYY-MM-DD
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            const res = await fetchWithAuth(`/api/attendance/calendar?date=${dateStr}`);
            const result = await res.json();
            
            const calendarData = result.data || result || {};
            const logs = calendarData.dailyLogs || [];
            const dates = calendarData.activeDates || [];

            setDailyLogs(logs);
            setActiveDates(dates);

            // If current selected day has no logs but month has active dates, auto-focus latest active date on initial load
            if (logs.length === 0 && dates.length > 0 && !sessionStorage.getItem('calendar_user_picked')) {
                const latestDateStr = dates[dates.length - 1];
                const [y, m, d] = latestDateStr.split('-');
                setSelectedDate(new Date(y, m - 1, d));
            }
        } catch (err) {
            console.error("Failed to fetch calendar:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCalendarData(selectedDate);
        
        // Supabase Realtime WebSocket Subscription
        const subscription = supabase
            .channel('attendance_live_calendar')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, (payload) => {
                console.log('Real-Time Update Detected:', payload);
                fetchCalendarData(selectedDate);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, [selectedDate]);

    const onDateSelect = (dateStr) => {
        sessionStorage.setItem('calendar_user_picked', 'true');
        // Parse date properly to avoid timezone shifts
        const [y, m, d] = dateStr.split('-');
        setSelectedDate(new Date(y, m - 1, d));
    };

    const onPrevMonth = () => {
        setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
    };

    const onNextMonth = () => {
        setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
    };

    // Helper to format month and year
    const monthYearFormatted = selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    // Day logic
    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const startDayOfWeek = startOfMonth.getDay(); // 0 (Sun) to 6 (Sat)
    
    // Padding days
    const emptyCells = Array.from({ length: startDayOfWeek }).map((_, i) => <div key={`empty-${i}`}></div>);

    const daysInMonth = endOfMonth.getDate();
    const dayCells = Array.from({ length: daysInMonth }).map((_, i) => {
        const day = i + 1;
        const currentDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
        
        // Use local timezone format hack to get YYYY-MM-DD reliably without UTC offset issues
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dateStr = String(currentDate.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${dateStr}`;

        const selYear = selectedDate.getFullYear();
        const selMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const selDateStr = String(selectedDate.getDate()).padStart(2, '0');
        const selectedDateString = `${selYear}-${selMonth}-${selDateStr}`;

        const isSelected = dateString === selectedDateString;
        const hasLogs = activeDates.includes(dateString);

        return (
            <button
                key={dateString}
                onClick={() => onDateSelect && onDateSelect(dateString)}
                className={`relative w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 ${
                    isSelected 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 font-bold scale-110' 
                        : 'hover:bg-slate-50 text-slate-700'
                }`}
            >
                <span>{day}</span>
                {hasLogs && (
                    <div className={`absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`}></div>
                )}
            </button>
        );
    });

    // Sort logs chronologically for the playback timeline
    const sortedLogs = [...dailyLogs].sort((a, b) => new Date(a.time_in) - new Date(b.time_in));
    
    const totalPresent = sortedLogs.length;
    const totalLate = sortedLogs.filter(log => String(log.status).toLowerCase() === 'late').length;
    const onTime = totalPresent - totalLate;

    return (
        <div className="space-y-8 font-sans pb-10">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-md p-8 md:p-12 shadow-sm group">
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-lg flex items-center justify-center border border-white/20 shadow-inner">
                                <i className="ti ti-calendar-stats text-2xl text-blue-400" />
                            </div>
                            <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-300 rounded-md border border-blue-500/30">Analytics Mode</span>
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Workforce Timeline</h1>
                        <p className="text-blue-100/70 font-medium mt-2 text-lg max-w-xl">Visually track employee arrivals throughout the day.</p>
                    </div>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                
                <div className="xl:col-span-1 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 relative overflow-hidden group flex flex-col justify-between min-h-[110px]">
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                <i className="ti ti-thumb-up text-emerald-500 text-lg"></i> On Time
                            </p>
                            <p className="text-5xl font-black text-slate-800 tracking-tight">
                                {isLoading ? <i className="ti ti-loader-2 animate-spin inline-block text-2xl text-emerald-500"></i> : onTime}
                            </p>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 relative overflow-hidden group flex flex-col justify-between min-h-[110px]">
                            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                <i className="ti ti-alert-triangle text-orange-500 text-lg"></i> Late
                            </p>
                            <p className="text-5xl font-black text-slate-800 tracking-tight">
                                {isLoading ? <i className="ti ti-loader-2 animate-spin inline-block text-2xl text-orange-500"></i> : totalLate}
                            </p>
                        </motion.div>
                    </div>

                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-slate-200">
                        <div className="flex justify-between items-center mb-8">
                            <button onClick={onPrevMonth} className="h-10 w-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors border border-slate-200 shadow-sm active:scale-95">
                                <i className="ti ti-chevron-left text-lg"></i>
                            </button>
                            <span className="font-black text-slate-800 text-lg uppercase tracking-wide">
                                {monthYearFormatted}
                            </span>
                            <button onClick={onNextMonth} className="h-10 w-10 flex items-center justify-center bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors border border-slate-200 shadow-sm active:scale-95">
                                <i className="ti ti-chevron-right text-lg"></i>
                            </button>
                        </div>

                        <div className="grid grid-cols-7 text-center mb-4">
                            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                                <span key={day} className="text-[10px] font-black text-slate-400 uppercase tracking-widest py-2">{day}</span>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 place-items-center gap-y-3 gap-x-1">
                            {emptyCells}
                            {dayCells}
                        </div>
                    </motion.div>
                </div>

                <div className="xl:col-span-2">
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-white p-6 sm:p-10 rounded-xl shadow-sm border border-slate-200 min-h-[500px]">
                        <h3 className="font-black text-slate-800 text-xl sm:text-2xl mb-8 flex flex-wrap items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                                <i className="ti ti-clock-play text-xl"></i>
                            </div>
                            <span className="text-blue-600 border-b-2 border-blue-200/50 pb-1">
                                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                            </span>
                        </h3>

                        {isLoading ? (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-80 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 mt-8">
                                <div className="h-16 w-16 bg-white shadow-sm border border-slate-100 rounded-full flex items-center justify-center mb-4">
                                    <i className="ti ti-loader-2 text-3xl text-blue-500 animate-spin"></i>
                                </div>
                                <p className="text-slate-600 font-bold text-lg">Fetching Attendance Logs...</p>
                            </motion.div>
                        ) : sortedLogs.length > 0 ? (
                            <div className="relative pl-6 sm:pl-8 border-l-[3px] border-slate-200 space-y-8 pb-4 ml-2 sm:ml-4">
                                <AnimatePresence>
                                    {sortedLogs.map((log, idx) => (
                                        <motion.div 
                                            key={log.id || idx}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: idx * 0.05, type: 'spring', stiffness: 400, damping: 30 }}
                                            className="relative group"
                                        >
                                            <div className={`absolute -left-[35px] sm:-left-[43px] top-6 h-5 w-5 rounded-full border-4 border-white shadow-md transition-transform duration-300 group-hover:scale-125 ${String(log.status).toLowerCase() === 'late' ? 'bg-orange-500' : 'bg-emerald-500'}`}></div>
                                            
                                            <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-sm hover:shadow-lg hover:border-slate-300 transition-all flex flex-col sm:flex-row gap-5 sm:gap-6 items-start sm:items-center">
                                                
                                                <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-lg bg-slate-100 overflow-hidden shadow-inner flex-shrink-0 relative border border-slate-200">
                                                    {log.time_in_photo ? (
                                                        <img src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`} className="h-full w-full object-cover" alt="Time In Proof" />
                                                    ) : (
                                                        <div className="h-full w-full flex items-center justify-center text-slate-300">
                                                            <i className="ti ti-user-scan text-3xl"></i>
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                <div className="flex-1 w-full">
                                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                                        <span className="font-mono font-medium text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200 text-xs shadow-sm flex items-center gap-1.5">
                                                            <i className="ti ti-login-2 text-blue-500 text-sm"></i>
                                                            In: {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                        {log.time_out && (
                                                            <span className="font-mono font-medium text-slate-500 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200 text-xs shadow-sm flex items-center gap-1.5">
                                                                <i className="ti ti-logout-2 text-rose-400 text-sm"></i>
                                                                Out: {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    <p className="font-black text-slate-800 text-xl tracking-tight">
                                                        {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown Worker'}
                                                    </p>
                                                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mt-1">
                                                        {log.employees?.job_title || 'Staff'} &bull; {log.employees?.department || 'General'}
                                                    </p>
                                                </div>

                                                <div className="w-full sm:w-auto mt-2 sm:mt-0 flex sm:block shrink-0">
                                                    {String(log.status).toLowerCase() === 'late' ? (
                                                        <span className="w-full sm:w-auto bg-orange-100 text-orange-700 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest border border-orange-200 flex items-center justify-center gap-2 shadow-sm">
                                                            <i className="ti ti-alert-triangle text-xl"></i> Late
                                                        </span>
                                                    ) : (
                                                        <span className="w-full sm:w-auto bg-emerald-100 text-emerald-700 px-5 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest border border-emerald-200 flex items-center justify-center gap-2 shadow-sm">
                                                            <i className="ti ti-thumb-up text-xl"></i> On Time
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        ) : (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-80 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 mt-8">
                                <div className="h-24 w-24 bg-white shadow-sm border border-slate-100 rounded-full flex items-center justify-center mb-6">
                                    <i className="ti ti-ghost text-5xl text-slate-300"></i>
                                </div>
                                <p className="text-slate-800 font-black text-2xl tracking-tight">It's a Ghost Town</p>
                                <p className="text-slate-500 font-medium text-base mt-2 max-w-sm">No attendance activity was recorded on this specific date. Try selecting another day.</p>
                            </motion.div>
                        )}
                    </motion.div>
                </div>

            </div>
        </div>
    );
};

export default Calendar;
