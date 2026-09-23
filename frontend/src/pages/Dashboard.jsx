import React, { useEffect, useState, useMemo } from 'react';
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

const formatDisplayName = (name) => {
    if (!name) return 'Staff Member';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) {
        return 'Staff Member';
    }
    return name;
};

export default function Dashboard() {
    const queryClient = useQueryClient();
    const [trendView, setTrendView] = useState('weekly');
    const [isManualRefreshingAI, setIsManualRefreshingAI] = useState(false);

    // Overview data query with Dual-Layer API + Direct Supabase Fallback
    const { data: overviewData, isLoading } = useQuery({
        queryKey: ['adminDashboardOverview'],
        queryFn: async () => {
            try {
                const res = await fetchWithAuth('/api/dashboard/overview');
                if (res.ok) {
                    return await res.json();
                }
            } catch (err) {
                console.warn('[DASHBOARD] API overview fallback to direct Supabase query:', err);
            }

            // Direct Supabase Fallback for Low-Latency & High Availability
            const DAY_MS = 24 * 60 * 60 * 1000;
            const toManilaDate = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
            const todayStr = toManilaDate(new Date());
            const thirtyFiveDaysAgo = toManilaDate(new Date(Date.now() - 35 * DAY_MS));

            const [
                { data: rawEmployees },
                { data: rawAttendances },
                { data: rawLeaves }
            ] = await Promise.all([
                supabase
                    .from('employees')
                    .select('id, department, role, shift, company_id, first_name, last_name, daily_rate, hourly_rate, status')
                    .not('company_id', 'is', null)
                    .neq('role', 'admin')
                    .neq('role', 'security'),
                supabase
                    .from('attendances')
                    .select('id, employee_id, date, status, created_at, time_in, time_out')
                    .gte('date', thirtyFiveDaysAgo)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('leave_requests')
                    .select('status, start_date, end_date')
            ]);

            const employees = rawEmployees || [];
            const attendances = rawAttendances || [];
            const leaves = rawLeaves || [];

            const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };
            const empMap = new Map();
            employees.forEach(emp => {
                empMap.set(emp.id, emp);
                const dept = emp.department || 'Other';
                if (dept === 'Factory') deptBreakdown.Factory++;
                else if (dept === 'Retail') deptBreakdown.Retail++;
                else if (dept === 'IT') deptBreakdown.IT++;
                else if (dept.includes('HR') || dept.includes('Admin')) deptBreakdown.HR++;
            });

            let presentTodayCount = 0;
            let lateTodayCount = 0;
            const recentLogs = [];

            attendances.forEach(att => {
                if (att.date === todayStr) {
                    presentTodayCount++;
                    if ((att.status || '').toLowerCase().includes('late')) {
                        lateTodayCount++;
                    }
                    if (recentLogs.length < 5) {
                        const emp = empMap.get(att.employee_id);
                        recentLogs.push({
                            ...att,
                            employees: emp ? {
                                id: emp.id,
                                company_id: emp.company_id,
                                first_name: emp.first_name,
                                last_name: emp.last_name,
                                department: emp.department,
                                shift: emp.shift
                            } : null
                        });
                    }
                }
            });

            let onLeaveCount = 0;
            let pendingLeavesCount = 0;
            leaves.forEach(l => {
                if (l.status === 'New') pendingLeavesCount++;
                if (l.status === 'Approved' && l.start_date <= todayStr && l.end_date >= todayStr) {
                    onLeaveCount++;
                }
            });

            const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const last7Days = Array.from({ length: 7 }, (_, i) => toManilaDate(new Date(Date.now() - (6 - i) * DAY_MS)));
            const countsByDate = {};
            attendances.forEach(r => { countsByDate[r.date] = (countsByDate[r.date] || 0) + 1; });

            const weeklyTrends = last7Days.map(dateStr => {
                const count = countsByDate[dateStr] || 0;
                const value = employees.length > 0 ? Math.round((count / employees.length) * 100) : 0;
                const label = dayLabels[new Date(dateStr + 'T00:00:00').getDay()];
                return { day: label, date: dateStr, value };
            });

            return {
                admin: {
                    totalStaff: employees.length,
                    deptBreakdown,
                    presentTodayCount,
                    lateTodayCount,
                    onLeaveCount,
                    pendingLeavesCount,
                    recentLogs,
                    weeklyTrends,
                    monthlyTrends: [],
                    deptPunctuality: [],
                    doleCompliance: null
                },
                payrollData: null,
                aiData: null,
                anomalyData: null
            };
        },
        staleTime: 30000,
        refetchInterval: 60000,
    });

    // 2. Decoupled Asynchronous AI Briefing Query (Non-blocking background)
    const { 
        data: aiQueryData, 
        isLoading: isAIQueryLoading, 
        isFetching: isAIFetching 
    } = useQuery({
        queryKey: ['adminDashboardAI'],
        queryFn: async () => {
            try {
                const res = await fetchWithAuth('/api/dashboard/ai-briefing');
                if (res.ok) return await res.json();
            } catch (err) {
                console.warn('[DASHBOARD] AI briefing query fallback:', err);
            }
            return { briefing: null, payrollInsight: null };
        },
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const dashboardData = overviewData?.admin || null;
    const payrollData = overviewData?.payrollData || null;
    const isPayrollLoading = isLoading && !payrollData;
    const anomalyData = overviewData?.anomalyData || null;
    const isAnomalyLoading = isLoading && !anomalyData;

    // Merge AI Data: prefer fresh AI query result, fallback to cached overview AI data
    const briefing = aiQueryData?.briefing || overviewData?.aiData?.briefing || null;
    const payrollInsight = aiQueryData?.payrollInsight || payrollData?.insight || null;
    const isAILoading = isManualRefreshingAI || (isAIQueryLoading && !briefing) || (isAIFetching && !briefing);

    // Manual Refresh of AI Briefing only (zero overhead on telemetry)
    const handleRefreshAI = async () => {
        if (isManualRefreshingAI) return;
        setIsManualRefreshingAI(true);
        try {
            const res = await fetchWithAuth('/api/dashboard/ai-briefing?fresh=true');
            if (res.ok) {
                const fresh = await res.json();
                queryClient.setQueryData(['adminDashboardAI'], fresh);
            }
        } catch (err) {
            console.error('[DASHBOARD_UI] AI Refresh error:', err);
        } finally {
            setIsManualRefreshingAI(false);
        }
    };

    // Real-time synchronization - ONLY invalidates fast overview telemetry
    useEffect(() => {
        const liveChannel = supabase
            .channel('dashboard_live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(liveChannel);
        };
    }, [queryClient]);

    // Active trend data (memoized)
    const activeTrend = useMemo(() => {
        if (!dashboardData) return [];
        return trendView === 'monthly' ? (dashboardData.monthlyTrends || []) : (dashboardData.weeklyTrends || []);
    }, [dashboardData, trendView]);

    const maxTrendValue = useMemo(() => {
        return Math.max(...activeTrend.map(t => t.value || 0), 100);
    }, [activeTrend]);

    const presentPercentage = useMemo(() => {
        if (!dashboardData || !dashboardData.totalStaff) return 0;
        return Math.round((dashboardData.presentTodayCount / dashboardData.totalStaff) * 100);
    }, [dashboardData]);

    // Department punctuality ranking (memoized)
    const deptList = useMemo(() => {
        if (!dashboardData?.deptPunctuality) return [];
        return dashboardData.deptPunctuality.map(d => ({
            name: d.name,
            score: d.score,
            grade: d.grade,
            sampleSize: d.sampleSize,
            ...(GRADE_COLORS[d.grade] || GRADE_COLORS['B']),
        }));
    }, [dashboardData?.deptPunctuality]);

    // Anomaly Risk Flags (memoized)
    const riskFlags = useMemo(() => {
        const burnoutAlerts = anomalyData?.report?.burnout_risk_alerts || [];
        const latePatterns = anomalyData?.report?.frequent_late_patterns || [];
        return [...burnoutAlerts, ...latePatterns].slice(0, 3);
    }, [anomalyData]);

    if (isLoading || !dashboardData) {
        return (
            <div className="flex flex-col items-center justify-center h-[65vh] space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center animate-pulse">
                    <i className="ti ti-chart-pie-3 text-3xl text-blue-600" />
                </div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Connecting to live updates...</p>
            </div>
        );
    }

    const {
        totalStaff = 0,
        presentTodayCount = 0,
        lateTodayCount = 0,
        pendingLeavesCount = 0,
        recentLogs = [],
        doleCompliance = null,
    } = dashboardData;

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-12">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Dashboard</h2>
                </div>
            </div>

            {/* AI Executive Briefing */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 text-white shadow-xs relative overflow-hidden">
                <div className="relative z-10 space-y-4 p-6 sm:p-7">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <i className="ti ti-sparkles text-emerald-400" /> Google Gemini 2.0 Workforce Briefing
                            </span>
                            {isManualRefreshingAI && (
                                <span className="text-[11px] text-emerald-400/80 font-semibold flex items-center gap-1">
                                    <i className="ti ti-loader-2 animate-spin" /> Regenerating...
                                </span>
                            )}
                        </div>
                        <button
                            onClick={handleRefreshAI}
                            disabled={isAILoading}
                            className="self-start sm:self-center px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:scale-[0.98] border border-slate-700 rounded-lg text-xs font-semibold text-white transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <i className={`ti ti-refresh text-emerald-400 ${isAILoading ? 'animate-spin' : ''}`} />
                            <span>{isAILoading ? 'Analyzing...' : 'Refresh AI'}</span>
                        </button>
                    </div>

                    {isAILoading && !briefing ? (
                        /* Enterprise Skeleton State when AI briefing is cold / loading */
                        <div className="space-y-4 animate-pulse pt-1">
                            <div className="h-7 bg-slate-800 rounded-lg w-4/5 border-l-4 border-emerald-500 pl-4 py-1 flex items-center">
                                <span className="text-xs text-slate-400 font-medium tracking-wide">
                                    Analyzing workforce attendance data...
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="h-6 w-32 bg-slate-800 rounded-md"></div>
                                <div className="h-6 w-28 bg-slate-800 rounded-md"></div>
                                <div className="h-6 w-36 bg-slate-800 rounded-md"></div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <i className="ti ti-bulb text-amber-400 text-sm" />
                                        <div className="h-3 w-24 bg-slate-700 rounded"></div>
                                    </div>
                                    <div className="h-2.5 w-full bg-slate-700/60 rounded"></div>
                                    <div className="h-2.5 w-4/5 bg-slate-700/60 rounded"></div>
                                </div>
                                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <i className="ti ti-target-arrow text-blue-400 text-sm" />
                                        <div className="h-3 w-32 bg-slate-700 rounded"></div>
                                    </div>
                                    <div className="h-2.5 w-full bg-slate-700/60 rounded"></div>
                                    <div className="h-2.5 w-4/5 bg-slate-700/60 rounded"></div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Loaded AI Briefing */
                        <>
                            <p className="text-base sm:text-lg font-semibold text-white leading-relaxed border-l-4 border-emerald-400 pl-4">
                                {briefing?.executive_summary || `Workforce operational capacity is running at ${presentPercentage}% with ${presentTodayCount} active staff on site today.`}
                            </p>

                            {/* Badges pulled straight from the AI briefing */}
                            {briefing && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                                        Punctuality Grade: {briefing.punctuality_grade || 'N/A'}
                                    </span>
                                    {briefing.top_performing_department && (
                                        <span className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md text-[11px] font-bold uppercase tracking-wider text-blue-300">
                                            Top Dept: {briefing.top_performing_department}
                                        </span>
                                    )}
                                    {briefing.department_needs_attention && briefing.department_needs_attention !== 'None' && (
                                        <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-md text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                                            <i className="ti ti-alert-triangle-filled text-xs" /> Needs Attention: {briefing.department_needs_attention}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* AI-Generated Descriptive Analytics */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                                    <span className="text-amber-300 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="ti ti-bulb text-amber-400" /> Operational Observations
                                    </span>
                                    <ul className="mt-2.5 space-y-1.5">
                                        {(briefing?.key_insights?.length ? briefing.key_insights : ['Not enough attendance data yet to generate observations.']).map((insight, i) => (
                                            <li key={i} className="text-xs text-slate-200 font-medium flex items-start gap-1.5 leading-relaxed">
                                                <span className="text-emerald-400 mt-0.5">&bull;</span>
                                                <span>{insight}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
                                    <span className="text-blue-300 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="ti ti-target-arrow text-blue-400" /> Recommended Actions
                                    </span>
                                    <ul className="mt-2.5 space-y-1.5">
                                        {(briefing?.actionable_recommendations?.length ? briefing.actionable_recommendations : ['No critical action items at this time.']).map((rec, i) => (
                                            <li key={i} className="text-xs text-slate-200 font-medium flex items-start gap-1.5 leading-relaxed">
                                                <span className="text-blue-400 mt-0.5">&bull;</span>
                                                <span>{rec}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
                <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 shadow-xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-users text-5xl text-blue-600" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Workforce</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1 tracking-tight font-mono tabular-nums">
                        {totalStaff}
                    </h3>
                    <span className="text-xs font-semibold text-emerald-700 mt-2 block flex items-center gap-1">
                        <i className="ti ti-check" /> Active Personnel
                    </span>
                </div>

                <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 shadow-xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-user-check text-5xl text-emerald-600" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Present Rate</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1 tracking-tight font-mono tabular-nums">
                        {presentPercentage}%
                    </h3>
                    <span className="text-xs font-semibold text-slate-600 mt-2 block">
                        {presentTodayCount} of {totalStaff} on-site
                    </span>
                </div>

                <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 shadow-xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-clock-exclamation text-5xl text-amber-600" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Late Arrivals</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1 tracking-tight font-mono tabular-nums">
                        {lateTodayCount}
                    </h3>
                    <span className="text-xs font-semibold text-amber-700 mt-2 block flex items-center gap-1">
                        <i className="ti ti-alert-triangle" /> Past grace period
                    </span>
                </div>

                <Link to="/admin/leaves" className="bg-slate-900 hover:bg-slate-800 transition-colors p-5 sm:p-6 rounded-xl border border-slate-800 shadow-xs text-white block cursor-pointer relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-plane-departure text-5xl text-white" />
                    </div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Leaves</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-white mt-1 tracking-tight font-mono tabular-nums">
                        {pendingLeavesCount}
                    </h3>
                    <span className="text-xs font-semibold text-blue-400 mt-2 block flex items-center justify-between">
                        <span>Action Required</span>
                        <span>&rarr;</span>
                    </span>
                </Link>
            </div>

            {/* Predictive Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                
                {/* Department Punctuality Scorecard */}
                <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-trophy text-amber-600 text-lg" /> Department Punctuality Scorecard
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">Evaluated against shift start & grace periods</p>
                        </div>
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs font-semibold rounded-md border border-slate-200">
                            30-Day Index
                        </span>
                    </div>

                    <div className="space-y-3.5 pt-1">
                        {deptList.length > 0 ? deptList.map((d) => (
                            <div key={d.name} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs font-semibold">
                                    <span className="text-slate-700">{d.name}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-slate-500">{d.score}%</span>
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${d.bgCol} ${d.textCol} border border-current/20`}>
                                            Grade: {d.grade}
                                        </span>
                                    </div>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                                    <div className={`${d.color} h-2 rounded-full transition-all duration-500`} style={{ width: `${d.score}%` }} />
                                </div>
                            </div>
                        )) : (
                            <p className="text-xs text-slate-400 font-medium py-6 text-center">No attendance records in the last 30 days yet.</p>
                        )}
                    </div>
                </div>

                {/* Predictive Burnout & Turnover Radar */}
                <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-flame text-rose-600 text-lg" /> Burnout & Overtime Risk
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">Overtime patterns and fatigue indicators</p>
                        </div>
                        <span className="px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-bold uppercase rounded-md border border-rose-200">
                            {isAnomalyLoading ? '...' : `${riskFlags.length} Flags Active`}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {riskFlags.length > 0 ? riskFlags.map((flag, i) => (
                            <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-900 truncate">{formatDisplayName(flag.employee_name)}</p>
                                    <p className="text-[10px] text-slate-500 font-medium uppercase truncate">
                                        {flag.reason || flag.pattern || `${flag.department} • ${flag.late_count} late(s)`}
                                    </p>
                                </div>
                                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border shrink-0 ${RISK_STYLES[flag.severity] || RISK_STYLES.Low}`}>
                                    {flag.severity || 'Flagged'}
                                </span>
                            </div>
                        )) : (
                            <p className="text-xs text-slate-400 font-medium py-6 text-center">
                                {isAnomalyLoading ? 'Scanning 30-day attendance history...' : 'No burnout or turnover risk signals detected.'}
                            </p>
                        )}
                    </div>

                    {anomalyData?.report?.general_health_assessment && (
                        <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-900 font-medium">
                            <i className="ti ti-bulb text-emerald-600 text-base shrink-0 mt-0.5" />
                            <p>{anomalyData.report.general_health_assessment}</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Financial & Compliance Intelligence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                
                {/* Weekly Cutoff Payroll Forecaster */}
                <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-chart-arrows-vertical text-emerald-600 text-lg" /> {payrollData?.cutoffLabel ? `${payrollData.cutoffLabel} Cutoff` : 'Weekly Cutoff'} Payroll Forecaster
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">Projected payout based on active timecards</p>
                        </div>
                        {payrollData?.employeesWithPayrate > 0 && (
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-md border border-emerald-200 shrink-0">
                                Day {payrollData.elapsedWorkingDays}/{payrollData.totalCutoffWorkingDays}
                            </span>
                        )}
                    </div>

                    {payrollData?.employeesWithPayrate > 0 ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 sm:p-4">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Accrued So Far</p>
                                    <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                                        ₱{payrollData.actualPayToDate.toLocaleString()}
                                    </p>
                                </div>
                                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 sm:p-4">
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Projected Cutoff Total</p>
                                    <p className="text-xl font-bold font-mono text-white mt-1">
                                        ₱{payrollData.projectedCutoffTotal.toLocaleString()}
                                    </p>
                                </div>
                            </div>

                            {payrollData.deptBreakdown?.length > 0 && (
                                <div className="space-y-2 pt-1">
                                    {payrollData.deptBreakdown.slice(0, 4).map(d => (
                                        <div key={d.name} className="flex items-center justify-between text-xs">
                                            <span className="font-semibold text-slate-600">{d.name}</span>
                                            <span className="font-mono font-bold text-slate-900">₱{d.projected.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {(payrollInsight || payrollData.insight) && (
                                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-900 font-medium">
                                    <i className="ti ti-bulb text-emerald-600 text-base shrink-0 mt-0.5" />
                                    <p>{payrollInsight || payrollData.insight}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="bg-slate-900 rounded-xl p-5 text-white flex flex-col items-center justify-center text-center gap-2">
                            <i className="ti ti-currency-peso text-3xl text-slate-500" />
                            <p className="text-xs font-semibold text-slate-400 max-w-xs">
                                {isPayrollLoading ? 'Calculating projected payroll...' : 'No active employees have a configured salary yet.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* DOLE Labor Standard Compliance */}
                <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-scale text-blue-600 text-lg" /> DOLE Statutory Compliance
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">Philippine labor standards rest day and overtime audit</p>
                        </div>
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-md border border-emerald-300">
                            {doleCompliance ? `${doleCompliance.restDay.compliancePercent}% Audit-Ready` : '—'}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {doleCompliance ? (
                            <>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                                        <i className={`ti ${doleCompliance.restDay.violations.length === 0 ? 'ti-circle-check-filled text-emerald-600' : 'ti-alert-circle-filled text-amber-600'} text-base`} />
                                        <span>{doleCompliance.restDay.label}</span>
                                    </div>
                                    <span className={`font-mono text-[11px] font-bold ${doleCompliance.restDay.violations.length === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                        {doleCompliance.restDay.status}
                                    </span>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                                        <i className="ti ti-circle-check-filled text-emerald-600 text-base" />
                                        <span>{doleCompliance.holidayMultiplier.label}</span>
                                    </div>
                                    <span className="font-mono text-[11px] font-bold text-emerald-700">{doleCompliance.holidayMultiplier.status}</span>
                                </div>
                            </>
                        ) : (
                            <p className="text-xs text-slate-400 font-medium py-6 text-center">Compliance data unavailable.</p>
                        )}
                    </div>
                </div>

            </div>

            {/* Attendance Trend & Live Gate Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                
                {/* 7-Day Trend Chart */}
                <div className="lg:col-span-7 bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-base font-bold text-slate-900">Workforce Attendance Volume Trend</h3>
                            <p className="text-xs text-slate-500 font-medium">{trendView === 'monthly' ? '5-Week' : '7-Day'} presence tracking</p>
                        </div>
                        <div className="bg-slate-100 rounded-lg p-1 flex text-xs font-semibold text-slate-600 border border-slate-200">
                            <button
                                onClick={() => setTrendView('weekly')}
                                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${trendView === 'weekly' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
                            >
                                Weekly
                            </button>
                            <button
                                onClick={() => setTrendView('monthly')}
                                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${trendView === 'monthly' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
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
                <div className="lg:col-span-5 bg-white rounded-xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <i className="ti ti-broadcast text-blue-600" /> Live Gate Feed
                        </h3>
                        <Link to="/admin/attendance" className="text-xs font-semibold text-blue-600 hover:underline">View All &rarr;</Link>
                    </div>

                    <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[300px] pr-1">
                        {recentLogs.length > 0 ? recentLogs.map((log) => (
                            <div
                                key={log.id}
                                className="p-3 bg-slate-50 rounded-lg flex items-center justify-between border border-slate-200 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center text-xs shrink-0 shadow-2xs">
                                        {log.employees ? `${log.employees.first_name?.[0] || 'C'}${log.employees.last_name?.[0] || 'P'}` : 'CP'}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-900 truncate">
                                            {log.employees ? `${log.employees.first_name} ${log.employees.last_name}` : 'Staff'}
                                        </p>
                                        <p className="text-[10px] text-slate-500 font-medium uppercase truncate font-mono">
                                            {log.employees?.department || 'Production'} • {new Date(log.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                                <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md border shrink-0 ${
                                    log.status?.toLowerCase().includes('absent') ? 'bg-rose-50 text-rose-800 border-rose-300' :
                                    log.status?.includes('Late') ? 'bg-amber-50 text-amber-900 border-amber-300' : 
                                    'bg-emerald-50 text-emerald-800 border-emerald-300'
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