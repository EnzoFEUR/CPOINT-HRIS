import React, { useState, useEffect } from 'react';

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

            const res = await fetch(`http://localhost:5000/api/attendance/calendar?date=${dateStr}`);
            const data = await res.json();
            
            setDailyLogs(data.dailyLogs || []);
            setActiveDates(data.activeDates || []);
        } catch (err) {
            console.error("Failed to fetch calendar:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchCalendarData(selectedDate);
    }, [selectedDate]);

    const onDateSelect = (dateStr) => {
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

    return (
        <div className="space-y-6">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Attendance Calendar</h2>
                    <p className="text-slate-500 text-sm">Select a date to view attendance proofs.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                <div className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-fit">
                    
                    <div className="flex justify-between items-center mb-6">
                        {/* Previous Month Button */}
                        <button 
                            onClick={onPrevMonth}
                            className="p-2 hover:bg-slate-50 rounded-lg text-slate-500 transition"
                        >
                            <i className="ti ti-chevron-left"></i>
                        </button>

                        <span className="font-bold text-slate-800 text-lg">
                            {monthYearFormatted}
                        </span>

                        {/* Next Month Button */}
                        <button 
                            onClick={onNextMonth}
                            className="p-2 hover:bg-slate-50 rounded-lg text-slate-500 transition"
                        >
                            <i className="ti ti-chevron-right"></i>
                        </button>
                    </div>

                    <div className="grid grid-cols-7 text-center mb-2">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                            <span key={day} className="text-xs font-bold text-slate-400 uppercase tracking-wider py-2">{day}</span>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 place-items-center gap-y-2">
                        {emptyCells}
                        {dayCells}
                    </div>
                </div>

                <div className="lg:col-span-2 space-y-4">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 min-h-[400px]">
                        <h3 className="font-bold text-slate-800 text-lg mb-4 flex items-center">
                            <i className="ti ti-calendar-event mr-2 text-blue-600"></i>
                            Logs for: <span className="ml-1 text-blue-600">
                                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                            </span>
                        </h3>

                        {dailyLogs.length > 0 ? (
                            <div className="space-y-3">
                                {dailyLogs.map((log, idx) => (
                                    <div key={log.id || idx} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 hover:border-blue-100 hover:bg-blue-50/30 transition-colors group">
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 rounded-full bg-slate-100 overflow-hidden border-2 border-white shadow-sm flex-shrink-0 relative group-hover:scale-105 transition-transform">
                                                {log.time_in_photo ? (
                                                    <img src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`} className="h-full w-full object-cover" alt="Time In Proof" />
                                                ) : (
                                                    <div className="h-full w-full flex items-center justify-center text-slate-400">
                                                        <i className="ti ti-camera-off"></i>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <div>
                                                <p className="font-bold text-slate-700">{log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown'}</p>
                                                {String(log.status).toLowerCase() === 'late' ? (
                                                    <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-orange-200 mt-1 inline-block">
                                                        {log.status}
                                                    </span>
                                                ) : (
                                                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border border-green-200 mt-1 inline-block">
                                                        {log.status}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="text-right text-sm">
                                            <p className="text-slate-500">
                                                In: <span className="font-mono font-bold text-slate-800">{new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                                            </p>
                                            <p className="text-slate-400 text-xs mt-0.5">
                                                Out: <span className="font-mono">{log.time_out ? new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--'}</span>
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 text-center">
                                <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                    <i className="ti ti-calendar-off text-3xl text-slate-300"></i>
                                </div>
                                <p className="text-slate-500 font-medium">No attendance records found.</p>
                                <p className="text-slate-400 text-sm">No one scanned in on this day.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Calendar;
