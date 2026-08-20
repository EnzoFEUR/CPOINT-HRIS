import React from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchWithAuth } from '../utils/api';

export default function Dashboard() {
    const fetchDashboardData = async () => {
        const res = await fetchWithAuth('/api/dashboard/admin');
        const result = await res.json();
        return result;
    };

    const { data: dashboardData, isLoading, isError, refetch } = useQuery({
        queryKey: ['adminDashboard'],
        queryFn: fetchDashboardData
    });

    // Real-Time WebSockets for the Live Activity Feed & Counters
    React.useEffect(() => {
        const subscription = supabase
            .channel('dashboard_live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                refetch();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                refetch();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                refetch();
            })
            .subscribe();

        const handleRefresh = () => refetch();
        window.addEventListener('refresh_dashboard', handleRefresh);

        return () => {
            supabase.removeChannel(subscription);
            window.removeEventListener('refresh_dashboard', handleRefresh);
        };
    }, [refetch]);

    if (isLoading || !dashboardData) {
        return (
            <motion.div 
                key="loading"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-[60vh] space-y-4"
            >
                <div className="h-16 w-16 bg-slate-100 rounded-2xl flex items-center justify-center animate-pulse">
                    <i className="ti ti-chart-pie-3 text-3xl text-blue-500"></i>
                </div>
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Analytics...</p>
            </motion.div>
        );
    }

    const { 
        totalStaff, deptBreakdown,
        presentTodayCount, lateTodayCount, onLeaveCount, 
        pendingLeavesCount, recentLogs, weeklyTrends
    } = dashboardData;

    const presentPercentage = totalStaff ? Math.round((presentTodayCount / totalStaff) * 100) : 0;
    const maxTrendValue = Math.max(...weeklyTrends.map(t => t.value));

    return (
        <motion.div 
            key="dashboard"
            initial={{ opacity: 0, y: 10 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.3 }}
            className="space-y-6 pb-6"
        >
            
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">HRIS Analytics</h2>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center gap-2 bg-white px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl border border-slate-200 shadow-xs sm:shadow-sm hover:bg-slate-50 tap-active transition-colors">
                        <i className="ti ti-download text-slate-500"></i>
                        <span className="text-xs sm:text-sm font-bold text-slate-700">Export</span>
                    </button>
                </div>
            </div>

            {/* KPI cards (2 columns on mobile, 4 columns on desktop) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
                <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-100 shadow-xs sm:shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 sm:p-6 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-users text-4xl sm:text-6xl text-blue-600"></i>
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">Total Staff</p>
                    <h3 className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight">{totalStaff}</h3>
                    <div className="mt-2 sm:mt-3 flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-emerald-500">
                        <i className="ti ti-trending-up"></i>
                        <span>Active</span>
                    </div>
                </div>

                <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-100 shadow-xs sm:shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 sm:p-6 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-user-check text-4xl sm:text-6xl text-emerald-600"></i>
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">Present Rate</p>
                    <h3 className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight">{presentPercentage}%</h3>
                    <div className="mt-2 sm:mt-3 flex items-center gap-1 text-[11px] sm:text-xs font-bold text-slate-500 truncate">
                        <span>{presentTodayCount} in today</span>
                    </div>
                </div>

                <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-100 shadow-xs sm:shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 sm:p-6 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-clock-exclamation text-4xl sm:text-6xl text-orange-600"></i>
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">Late Arrivals</p>
                    <h3 className="text-2xl sm:text-4xl font-black text-slate-800 tracking-tight">{lateTodayCount}</h3>
                    <div className="mt-2 sm:mt-3 flex items-center gap-1 text-[11px] sm:text-xs font-bold text-orange-500">
                        <i className="ti ti-alert-triangle"></i>
                        <span>Check logs</span>
                    </div>
                </div>

                <Link to="/admin/leaves" className="bg-gradient-to-br from-indigo-600 to-blue-700 p-4 sm:p-6 rounded-2xl shadow-xs sm:shadow-sm shadow-blue-600/20 text-white tap-active transition-all relative overflow-hidden group block cursor-pointer">
                    <div className="absolute right-0 top-0 p-4 sm:p-6 opacity-20 group-hover:scale-110 transition-transform duration-500 hidden sm:block">
                        <i className="ti ti-plane-departure text-4xl sm:text-6xl text-white"></i>
                    </div>
                    <p className="text-[11px] sm:text-xs font-bold text-blue-200 uppercase tracking-wider mb-1 sm:mb-2">Leaves</p>
                    <h3 className="text-2xl sm:text-4xl font-black text-white tracking-tight">{pendingLeavesCount}</h3>
                    <div className="mt-2 sm:mt-3 flex items-center justify-between text-[11px] sm:text-xs font-bold text-white">
                        <span>Pending</span>
                        <span>Review &rarr;</span>
                    </div>
                </Link>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
                
                {/* Weekly Trend Chart (2/3 width) */}
                <div className="xl:col-span-2 bg-white rounded-2xl p-4 sm:p-6 lg:p-8 border border-slate-100 shadow-xs sm:shadow-sm overflow-hidden">
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Attendance Volume Trend</h3>
                            <p className="text-xs font-medium text-slate-500 mt-1">Last 7 days workforce presence</p>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-1 flex text-xs font-bold text-slate-500">
                            <button className="px-3 py-1.5 bg-white text-blue-600 shadow-xs sm:shadow-sm rounded-md tap-active">Weekly</button>
                            <button className="px-3 py-1.5 hover:text-slate-800 transition-colors rounded-md tap-active">Monthly</button>
                        </div>
                    </div>
                    
                    {/* CSS Bar Chart */}
                    <div className="overflow-x-auto touch-scroll">
                        <div className="h-64 flex items-end justify-between gap-2 sm:gap-6 mt-4 min-w-[300px]">
                            {weeklyTrends.map((trend, i) => {
                                const height = `${(trend.value / maxTrendValue) * 100}%`;
                                const isToday = i === 4; // Mocking Friday as today for visual highlight
                                return (
                                    <div key={i} className="flex-1 flex flex-col justify-end items-center group">
                                        <div className="w-full flex justify-center items-end relative h-full">
                                            {/* Tooltip */}
                                            <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg transition-opacity pointer-events-none whitespace-nowrap z-10">
                                                {trend.value}% Present
                                            </div>
                                            {/* Bar */}
                                            <div 
                                                className={`w-full max-w-[40px] rounded-t-xl transition-all duration-700 ease-out ${isToday ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-slate-100 group-hover:bg-blue-100'}`} 
                                                style={{ height }}
                                            ></div>
                                        </div>
                                        <span className={`mt-3 text-[10px] font-bold uppercase tracking-wider ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>
                                            {trend.day}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Column: Live Feed & Dept */}
                <div className="xl:col-span-1 space-y-6">
                    
                    {/* Department Breakdown */}
                    <div className="bg-white rounded-2xl p-4 sm:p-6 lg:p-8 border border-slate-100 shadow-xs sm:shadow-sm">
                        <h3 className="text-base font-bold text-slate-800 mb-6 flex items-center gap-2">
                            <i className="ti ti-chart-pie text-blue-600"></i> Department Allocation
                        </h3>
                        <div className="space-y-5">
                            {Object.entries(deptBreakdown).map(([dept, count]) => {
                                const percentage = totalStaff ? Math.round((count / totalStaff) * 100) : 0;
                                let color = 'bg-blue-500';
                                if (dept === 'Factory') color = 'bg-indigo-500';
                                if (dept === 'Retail') color = 'bg-emerald-500';
                                if (dept === 'IT') color = 'bg-amber-500';
                                
                                return (
                                    <div key={dept}>
                                        <div className="flex justify-between text-xs font-bold mb-2">
                                            <span className="text-slate-700">{dept}</span>
                                            <span className="text-slate-500">{count} ({percentage}%)</span>
                                        </div>
                                        <div className="w-full bg-slate-50 rounded-full h-2 overflow-hidden">
                                            <div className={`${color} h-2 rounded-full`} style={{ width: `${percentage}%` }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Live Activity Feed */}
                    <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-100 shadow-xs sm:shadow-sm h-[320px] flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                                <i className="ti ti-activity text-red-500 animate-pulse"></i> Live Log Feed
                            </h3>
                            <Link to="/admin/attendance" className="text-xs font-bold text-blue-600 hover:underline">View All</Link>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4">
                            <AnimatePresence initial={false}>
                                {recentLogs.length > 0 ? recentLogs.map(log => (
                                    <motion.div 
                                        key={log.id} 
                                        initial={{ opacity: 0, y: -20, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        className="flex gap-3"
                                        layout
                                    >
                                        <div className="mt-1">
                                            <div className="w-2 h-2 rounded-full bg-blue-500 ring-4 ring-blue-50"></div>
                                            <div className="w-px h-full bg-slate-100 mx-auto my-1"></div>
                                        </div>
                                        <div className="pb-4">
                                            <p className="text-sm font-bold text-slate-700">
                                                {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Unknown'}
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-0.5">
                                                Clocked in at <span className="font-bold text-slate-700">{new Date(log.time_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                            </p>
                                            {log.status.includes('Late') && (
                                                <span className="inline-block mt-1 px-2 py-0.5 bg-red-50 text-red-600 text-[9px] font-bold uppercase rounded border border-red-100">
                                                    {log.status}
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                )) : (
                                    <motion.div 
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="h-full flex flex-col items-center justify-center text-center pb-8"
                                    >
                                        <i className="ti ti-zzz text-3xl text-slate-200 mb-2"></i>
                                        <p className="text-xs font-bold text-slate-400">No recent logs today.</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                </div>
            </div>



            <style>{`
                .animate-fade-in-up { animation: fadeInUp 0.5s ease-out; }
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
            `}</style>
        </motion.div>
    );
}
