import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchWithAuth } from '../utils/api';

const GRADE_COLORS = {
    'A+': { color: 'bg-emerald-500', textCol: 'text-emerald-700', bgCol: 'bg-emerald-50' },
    'A': { color: 'bg-emerald-500', textCol: 'text-emerald-700', bgCol: 'bg-emerald-50' },
    'B+': { color: 'bg-blue-500', textCol: 'text-blue-700', bgCol: 'bg-blue-50' },
    'B': { color: 'bg-amber-500', textCol: 'text-amber-700', bgCol: 'bg-amber-50' },
    'C+': { color: 'bg-amber-500', textCol: 'text-amber-700', bgCol: 'bg-amber-50' },
    'C': { color: 'bg-rose-500', textCol: 'text-rose-700', bgCol: 'bg-rose-50' },
};

const RISK_STYLES = {
    High: 'bg-red-50 text-red-700 border-red-200',
    Medium: 'bg-amber-50 text-amber-700 border-amber-200',
    Low: 'bg-orange-50 text-orange-700 border-orange-200',
};

export default function Dashboard() {
    const queryClient = useQueryClient();
    const [trendView, setTrendView] = useState('weekly');

    // Master dashboard telemetry
    const { data: dashboardData, isLoading } = useQuery({
        queryKey: ['adminDashboard'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/dashboard/admin');
            return res.json();
        },
        staleTime: 10000,
        refetchInterval: 30000,
    });

    // AI executive briefing
    const { data: aiData, refetch: refetchAI, isFetching: isAILoading } = useQuery({
        queryKey: ['aiDailyBriefing'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/ai/analytics/daily-briefing');
            return res.json();
        },
        staleTime: 60000,
        refetchInterval: 5 * 60000,
    });

    // Anomaly and burnout detection
    const { data: anomalyData, isLoading: isAnomalyLoading } = useQuery({
        queryKey: ['aiAnomalies'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/ai/analytics/anomalies');
            return res.json();
        },
        staleTime: 5 * 60000,
        refetchInterval: 5 * 60000,
    });

    // Payroll forecast
    const { data: payrollData, isLoading: isPayrollLoading } = useQuery({
        queryKey: ['payrollForecast'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/dashboard/payroll-forecast');
            return res.json();
        },
        staleTime: 60000,
        refetchInterval: 60000,
    });

    // Real-time synchronization
    useEffect(() => {
        const liveChannel = supabase
            .channel('dashboard_live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
                queryClient.invalidateQueries({ queryKey: ['payrollForecast'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
                queryClient.invalidateQueries({ queryKey: ['payrollForecast'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(liveChannel);
        };
    }, [queryClient]);

    if (isLoading || !dashboardData) {
        return (
            <div className="flex flex-col items-center justify-center h-[65vh] space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                    <i className="ti ti-chart-pie-3 text-3xl text-blue-600" />
                </div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Connecting Real-Time Telemetry...</p>
            </div>
        );
    }

    const {
        totalStaff = 0,
        presentTodayCount = 0,
        lateTodayCount = 0,
        pendingLeavesCount = 0,
        deptBreakdown = {},
        recentLogs = [],
        weeklyTrends = [],
        monthlyTrends = [],
        deptPunctuality = [],
        doleCompliance = null,
    } = dashboardData;

    // Active trend data
    const activeTrend = trendView === 'monthly' ? monthlyTrends : weeklyTrends;

    const presentPercentage = totalStaff > 0 ? Math.round((presentTodayCount / totalStaff) * 100) : 0;
    const briefing = aiData?.briefing;
    const maxTrendValue = Math.max(...activeTrend.map(t => t.value || 0), 100);

    // Department punctuality ranking
    const deptList = deptPunctuality.map(d => ({
        name: d.name,
        score: d.score,
        grade: d.grade,
        sampleSize: d.sampleSize,
        ...(GRADE_COLORS[d.grade] || GRADE_COLORS['B']),
    }));
    const topDept = deptList[0];

    const burnoutAlerts = anomalyData?.report?.burnout_risk_alerts || [];
    const latePatterns = anomalyData?.report?.frequent_late_patterns || [];
    const riskFlags = [...burnoutAlerts, ...latePatterns].slice(0, 3);

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-12">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Dashboard</h2>
                </div>
            </div>

            {/* AI Executive Briefing */}
            <div className="bg-slate-900 rounded-3xl p-6 sm:p-7 border border-slate-800 text-white shadow-xl relative overflow-hidden">
                <div className="relative z-10 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-widest flex items-center gap-1.5 shadow-inner">
                                <i className="ti ti-sparkles text-emerald-400" /> Google Gemini 2.0 Daily Briefing
                            </span>
                        </div>
                        <button
                            onClick={() => refetchAI({ fresh: true })}
                            disabled={isAILoading}
                            className="self-start sm:self-center px-3.5 py-1.5 bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 rounded-xl text-xs font-bold text-white transition-all flex items-center gap-2 cursor-pointer tap-active"
                        >
                            <i className={`ti ti-refresh text-emerald-400 ${isAILoading ? 'animate-spin' : ''}`} />
                            <span>{isAILoading ? 'Analyzing...' : 'Refresh AI'}</span>
                        </button>
                    </div>

                    <p className="text-sm sm:text-base font-bold text-slate-200 leading-relaxed">
                        {briefing?.executive_summary || `Workforce operational capacity is running at ${presentPercentage}% with ${presentTodayCount} active staff on site today.`}
                    </p>

                    {/* Summary metrics */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
                            <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider block">Punctuality Rating</span>
                            <p className="text-slate-200 font-semibold mt-1">
                                {lateTodayCount === 0 ? '100% On-time compliance across shifts.' : `${lateTodayCount} staff clocked in past grace period.`}
                            </p>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
                            <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider block">Top Division</span>
                            <p className="text-slate-200 font-semibold mt-1">
                                {topDept ? `${topDept.name} leading on-time attendance (${topDept.score}%).` : 'Not enough data yet.'}
                            </p>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
                            <span className="text-slate-400 font-bold text-[10px] uppercase tracking-wider block">Pending Approvals</span>
                            <p className="text-slate-200 font-semibold mt-1">
                                {pendingLeavesCount > 0 ? `${pendingLeavesCount} leave requests pending review.` : 'All leave requests cleared.'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-users text-5xl text-blue-600" />
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Workforce</p>
                    <h3 className="text-3xl sm:text-4xl font-black text-slate-800 mt-1 tracking-tight">
                        {totalStaff}
                    </h3>
                    <span className="text-xs font-bold text-emerald-600 mt-2 block flex items-center gap-1">
                        <i className="ti ti-check" /> Active Staff
                    </span>
                </div>

                <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-user-check text-5xl text-emerald-600" />
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Present Rate</p>
                    <h3 className="text-3xl sm:text-4xl font-black text-slate-800 mt-1 tracking-tight">
                        {presentPercentage}%
                    </h3>
                    <span className="text-xs font-bold text-slate-500 mt-2 block">
                        {presentTodayCount} of {totalStaff} on-site
                    </span>
                </div>

                <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-clock-exclamation text-5xl text-amber-600" />
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Late Arrivals</p>
                    <h3 className="text-3xl sm:text-4xl font-black text-slate-800 mt-1 tracking-tight">
                        {lateTodayCount}
                    </h3>
                    <span className="text-xs font-bold text-amber-600 mt-2 block flex items-center gap-1">
                        <i className="ti ti-alert-triangle" /> Past grace period
                    </span>
                </div>

                <Link to="/admin/leaves" className="bg-indigo-600 hover:bg-indigo-700 transition-colors p-5 sm:p-6 rounded-3xl shadow-sm text-white block cursor-pointer relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-20 group-hover:scale-110 transition-transform duration-500 hidden sm:block">
                        <i className="ti ti-plane-departure text-5xl text-white" />
                    </div>
                    <p className="text-[11px] font-bold text-blue-200 uppercase tracking-wider">Pending Leaves</p>
                    <h3 className="text-3xl sm:text-4xl font-black text-white mt-1 tracking-tight">
                        {pendingLeavesCount}
                    </h3>
                    <span className="text-xs font-bold text-white mt-2 block flex items-center justify-between">
                        <span>Requires Review</span>
                        <span>&rarr;</span>
                    </span>
                </Link>
            </div>

            {/* Predictive Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                
                {/* Department Punctuality Scorecard */}
                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                                <i className="ti ti-trophy text-amber-500 text-lg" /> Department Punctuality Scorecard
                            </h3>
                            <p className="text-xs text-slate-400 font-medium">Evaluated against shift start & grace periods</p>
                        </div>
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-black rounded-lg">
                            30-Day Index
                        </span>
                    </div>

                    <div className="space-y-3.5 pt-1">
                        {deptList.length > 0 ? deptList.map((d) => (
                            <div key={d.name} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs font-bold">
                                    <span className="text-slate-700">{d.name}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-slate-500">{d.score}%</span>
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${d.bgCol} ${d.textCol} border border-current/20`}>
                                            Grade: {d.grade}
                                        </span>
                                    </div>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div className={`${d.color} h-2 rounded-full transition-all duration-1000`} style={{ width: `${d.score}%` }} />
                                </div>
                            </div>
                        )) : (
                            <p className="text-xs text-slate-400 font-bold py-6 text-center">No attendance records in the last 30 days yet.</p>
                        )}
                    </div>
                </div>

                {/* Predictive Burnout & Turnover Radar */}
                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                                <i className="ti ti-flame text-red-500 text-lg" /> Predictive Burnout & Turnover Radar
                            </h3>
                            <p className="text-xs text-slate-400 font-medium">AI anomaly detection for fatigue & pattern shifts</p>
                        </div>
                        <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase rounded-md border border-red-200">
                            {isAnomalyLoading ? '...' : `${riskFlags.length} Flags Active`}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {riskFlags.length > 0 ? riskFlags.map((flag, i) => (
                            <div key={i} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-black text-slate-800 truncate">{flag.employee_name}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase truncate">
                                        {flag.reason || flag.pattern || `${flag.department} • ${flag.late_count} late(s)`}
                                    </p>
                                </div>
                                <span className={`px-2 py-1 text-[10px] font-black uppercase rounded-lg border shrink-0 ${RISK_STYLES[flag.severity] || RISK_STYLES.Low}`}>
                                    {flag.severity || 'Flagged'}
                                </span>
                            </div>
                        )) : (
                            <p className="text-xs text-slate-400 font-bold py-6 text-center">
                                {isAnomalyLoading ? 'Scanning 30-day attendance history...' : 'No burnout or turnover risk signals detected.'}
                            </p>
                        )}
                    </div>

                    {anomalyData?.report?.general_health_assessment && (
                        <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-start gap-2.5 text-xs text-emerald-900 font-medium">
                            <i className="ti ti-bulb text-emerald-600 text-base shrink-0 mt-0.5" />
                            <p>{anomalyData.report.general_health_assessment}</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Financial & Compliance Intelligence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                
                {/* 15-Day Cutoff Payroll Forecaster */}
                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                                <i className="ti ti-chart-arrows-vertical text-emerald-600 text-lg" /> {payrollData?.cutoffLabel ? `${payrollData.cutoffLabel} Cutoff` : '15-Day Cutoff'} Payroll Forecaster
                            </h3>
                            <p className="text-xs text-slate-400 font-medium">Projected payout based on active timecards</p>
                        </div>
                        {payrollData?.employeesWithPayrate > 0 && (
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-black rounded-lg border border-emerald-200 shrink-0">
                                Day {payrollData.elapsedWorkingDays}/{payrollData.totalCutoffWorkingDays}
                            </span>
                        )}
                    </div>

                    {payrollData?.employeesWithPayrate > 0 ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 rounded-2xl p-4">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Accrued So Far</p>
                                    <p className="text-xl font-black text-slate-800 mt-1">
                                        ₱{payrollData.actualPayToDate.toLocaleString()}
                                    </p>
                                </div>
                                <div className="bg-slate-900 rounded-2xl p-4">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Projected Cutoff Total</p>
                                    <p className="text-xl font-black text-white mt-1">
                                        ₱{payrollData.projectedCutoffTotal.toLocaleString()}
                                    </p>
                                </div>
                            </div>

                            {payrollData.deptBreakdown?.length > 0 && (
                                <div className="space-y-2 pt-1">
                                    {payrollData.deptBreakdown.slice(0, 4).map(d => (
                                        <div key={d.name} className="flex items-center justify-between text-xs">
                                            <span className="font-bold text-slate-600">{d.name}</span>
                                            <span className="font-mono font-black text-slate-800">₱{d.projected.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {payrollData.insight && (
                                <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-start gap-2.5 text-xs text-emerald-900 font-medium">
                                    <i className="ti ti-bulb text-emerald-600 text-base shrink-0 mt-0.5" />
                                    <p>{payrollData.insight}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="bg-slate-900 rounded-2xl p-5 text-white flex flex-col items-center justify-center text-center gap-2">
                            <i className="ti ti-currency-peso text-3xl text-slate-500" />
                            <p className="text-xs font-bold text-slate-400 max-w-xs">
                                {isPayrollLoading ? 'Calculating projected payroll...' : 'No active employees have a configured salary yet.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* DOLE Labor Standard Compliance */}
                <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-black text-slate-800 tracking-tight flex items-center gap-2">
                                <i className="ti ti-scale text-blue-600 text-lg" /> DOLE Labor Standard Health Meter
                            </h3>
                            <p className="text-xs text-slate-400 font-medium">Automated Philippine statutory compliance audit</p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-500/10 text-emerald-700 text-xs font-black rounded-lg border border-emerald-500/20">
                            {doleCompliance ? `${doleCompliance.restDay.compliancePercent}% Audit-Ready` : '—'}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {doleCompliance ? (
                            <>
                                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 font-bold text-slate-700">
                                        <i className={`ti ${doleCompliance.restDay.violations.length === 0 ? 'ti-circle-check-filled text-emerald-500' : 'ti-alert-circle-filled text-amber-500'} text-base`} />
                                        <span>{doleCompliance.restDay.label}</span>
                                    </div>
                                    <span className={`font-mono text-[11px] font-black ${doleCompliance.restDay.violations.length === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                        {doleCompliance.restDay.status}
                                    </span>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 font-bold text-slate-700">
                                        <i className="ti ti-circle-check-filled text-emerald-500 text-base" />
                                        <span>{doleCompliance.holidayMultiplier.label}</span>
                                    </div>
                                    <span className="font-mono text-[11px] font-black text-emerald-600">{doleCompliance.holidayMultiplier.status}</span>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 font-bold text-slate-700">
                                        <i className="ti ti-circle-check-filled text-emerald-500 text-base" />
                                        <span>{doleCompliance.nightDifferential.label}</span>
                                    </div>
                                    <span className="font-mono text-[11px] font-black text-emerald-600">{doleCompliance.nightDifferential.status}</span>
                                </div>
                            </>
                        ) : (
                            <p className="text-xs text-slate-400 font-bold py-6 text-center">Compliance data unavailable.</p>
                        )}
                    </div>
                </div>

            </div>

            {/* Attendance Trend & Live Gate Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                
                {/* 7-Day Trend Chart */}
                <div className="lg:col-span-7 bg-white rounded-3xl p-6 border border-slate-100 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-base font-black text-slate-800">Workforce Attendance Volume Trend</h3>
                            <p className="text-xs text-slate-400 font-medium">{trendView === 'monthly' ? '5-Week' : '7-Day'} calendar presence percentage</p>
                        </div>
                        <div className="bg-slate-100 rounded-xl p-1 flex text-xs font-bold text-slate-500">
                            <button
                                onClick={() => setTrendView('weekly')}
                                className={`px-3 py-1 rounded-lg transition-all ${trendView === 'weekly' ? 'bg-white text-blue-600 shadow-xs' : 'hover:text-slate-800'}`}
                            >
                                Weekly
                            </button>
                            <button
                                onClick={() => setTrendView('monthly')}
                                className={`px-3 py-1 rounded-lg transition-all ${trendView === 'monthly' ? 'bg-white text-blue-600 shadow-xs' : 'hover:text-slate-800'}`}
                            >
                                Monthly
                            </button>
                        </div>
                    </div>

                    <div className="h-56 flex items-stretch justify-between gap-1 sm:gap-3 pt-10">
                        {activeTrend.map((trend, i) => {
                            const height = `${(trend.value / maxTrendValue) * 100}%`;
                            const isToday = i === activeTrend.length - 1;
                            return (
                                <div key={trend.date || trend.day || i} className="flex-1 min-w-0 flex flex-col justify-end items-center group">
                                    <div className="w-full flex justify-center items-end relative flex-1">
                                        <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg transition-opacity pointer-events-none whitespace-nowrap z-10">
                                            {trend.value}% Present
                                        </div>
                                        <div
                                            className={`w-full max-w-[36px] rounded-t-xl transition-all duration-700 ease-out ${isToday ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-slate-100 group-hover:bg-blue-100'}`}
                                            style={{ height }}
                                        />
                                    </div>
                                    <span className={`mt-3 text-[10px] font-bold uppercase tracking-wider text-center ${isToday ? 'text-blue-600' : 'text-slate-400'}`}>
                                        {trend.day}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Live Biometric Activity Feed */}
                <div className="lg:col-span-5 bg-white rounded-3xl p-6 border border-slate-100 shadow-xs flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <span className="" /> Live Gate Feed
                        </h3>
                        <Link to="/admin/attendance" className="text-xs font-bold text-blue-600 hover:underline">View All &rarr;</Link>
                    </div>

                    <div className="space-y-3 flex-1 overflow-y-auto max-h-[300px] pr-1">
                        {recentLogs.length > 0 ? recentLogs.map((log) => (
                            <div
                                key={log.id}
                                className="p-3.5 bg-slate-50/80 rounded-2xl flex items-center justify-between border border-slate-100 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-black flex items-center justify-center text-xs shrink-0">
                                        {log.employees ? `${log.employees.first_name?.[0] || 'C'}${log.employees.last_name?.[0] || 'P'}` : 'CP'}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-black text-slate-800 truncate">
                                            {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Staff'}
                                        </p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase truncate">
                                            {log.employees?.department || 'Production'} • {new Date(log.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                                <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-lg border shrink-0 ${
                                    log.status?.toLowerCase().includes('absent') ? 'bg-red-50 text-red-700 border-red-200' :
                                    log.status?.includes('Late') ? 'bg-amber-50 text-amber-700 border-amber-200' : 
                                    'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}>
                                    {log.status}
                                </span>
                            </div>
                        )) : (
                            <p className="text-xs text-slate-400 font-bold py-8 text-center">No biometric logs recorded today yet.</p>
                        )}
                    </div>
                </div>

            </div>

        </div>
    );
}