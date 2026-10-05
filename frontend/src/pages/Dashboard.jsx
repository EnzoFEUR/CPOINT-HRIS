import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchWithAuth } from '../utils/api';
import {
    Sparkles,
    RefreshCw,
    Loader2,
    Lightbulb,
    Target,
    AlertTriangle
} from 'lucide-react';

const GRADE_COLORS = {
    'A+': { color: 'bg-accent', textCol: 'text-accent', bgCol: 'bg-accent-subtle' },
    'A': { color: 'bg-accent', textCol: 'text-accent', bgCol: 'bg-accent-subtle' },
    'B+': { color: 'bg-accent', textCol: 'text-accent', bgCol: 'bg-accent-subtle' },
    'B': { color: 'bg-warning', textCol: 'text-warning-ink', bgCol: 'bg-warning-subtle' },
    'C+': { color: 'bg-warning', textCol: 'text-warning-ink', bgCol: 'bg-warning-subtle' },
    'C': { color: 'bg-danger', textCol: 'text-danger-ink', bgCol: 'bg-danger-subtle' },
};

const RISK_STYLES = {
    High: 'bg-danger-subtle text-danger-ink border-danger/20',
    Medium: 'bg-warning-subtle text-warning-ink border-warning/20',
    Low: 'bg-surface-muted text-ink border-line',
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
    const [activeModal, setActiveModal] = useState(null); // 'present' | 'late' | null
    const [expandedRiskFlag, setExpandedRiskFlag] = useState(null); // index of expanded burnout row, or null
    const [expandedDoleCheck, setExpandedDoleCheck] = useState(false); // whether the rest-day violations list is open
    const [acknowledged, setAcknowledged] = useState({}); // client-only "seen" state, not persisted — key -> true

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

            const isExemptOperator = (emp) => {
                if (!emp) return true;
                const r = (emp.role || '').toLowerCase().replace(/_/g, '');
                const dept = (emp.department || '').toLowerCase();
                const title = (emp.job_title || emp.position || '').toLowerCase();
                return (
                    ['admin', 'superadmin', 'security', 'guard', 'securityguard', 'hr', 'hrmanager'].includes(r) ||
                    dept === 'security' || dept === 'administration' || dept === 'human resources' ||
                    title.includes('guard') || title.includes('security') || title.includes('administrator')
                );
            };

            const [
                { data: rawEmployees },
                { data: rawAttendances },
                { data: rawLeaves }
            ] = await Promise.all([
                supabase
                    .from('employees')
                    .select('id, department, role, shift, company_id, first_name, last_name, daily_rate, hourly_rate, status, job_title')
                    .not('company_id', 'is', null)
                    .not('role', 'in', '("admin","superadmin","super_admin","security","guard","security_guard","hr","hr_manager")'),
                supabase
                    .from('attendances')
                    .select('id, employee_id, date, status, created_at, time_in, time_out')
                    .gte('date', thirtyFiveDaysAgo)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('leave_requests')
                    .select('status, start_date, end_date')
            ]);

            const employees = (rawEmployees || []).filter(e => !isExemptOperator(e));
            const empMap = new Map();
            employees.forEach(emp => {
                empMap.set(emp.id, emp);
            });
            const attendances = (rawAttendances || []).filter(att => empMap.has(att.employee_id));
            const leaves = rawLeaves || [];

            const deptBreakdown = { Factory: 0, Retail: 0, IT: 0, HR: 0 };
            employees.forEach(emp => {
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
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    // 2. Decoupled Asynchronous AI Briefing Query (Non-blocking background with enterprise lifecycle)
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
        staleTime: 24 * 60 * 60 * 1000, // 24 hours: Daily briefing is persistent for current shift/day
        gcTime: 24 * 60 * 60 * 1000,    // Retain in memory across page/tab navigation
        refetchOnMount: false,          // Never auto-refetch when switching back to Dashboard module
        refetchOnWindowFocus: false,    // Never auto-refetch when switching browser tabs
        refetchOnReconnect: false,      // Never auto-refetch on network reconnections
    });

    const dashboardData = overviewData?.admin || null;
    const payrollData = overviewData?.payrollData || null;
    const isPayrollLoading = isLoading && !payrollData;
    const anomalyData = overviewData?.anomalyData || null;
    const isAnomalyLoading = isLoading && !anomalyData;

    const getTodayManilaKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

    // Persisted Storage for Instant 0ms perceived load of AI Briefing
    const [localAIBriefing, setLocalAIBriefing] = useState(() => {
        try {
            const today = getTodayManilaKey();
            const stored = localStorage.getItem(`cpoint_ai_briefing_${today}`);
            if (stored) return JSON.parse(stored);
            const sessionStored = sessionStorage.getItem('cpoint_ai_briefing_cache');
            return sessionStored ? JSON.parse(sessionStored) : null;
        } catch {
            return null;
        }
    });

    // Save fresh AI data to localStorage whenever updated
    useEffect(() => {
        if (aiQueryData?.briefing) {
            try {
                const today = getTodayManilaKey();
                localStorage.setItem(`cpoint_ai_briefing_${today}`, JSON.stringify(aiQueryData.briefing));
                setLocalAIBriefing(aiQueryData.briefing);
            } catch {
                // Ignore storage quota limits
            }
        }
    }, [aiQueryData]);

    // Instant deterministic live synthesis: guarantees zero skeleton blockers while Gemini analyzes
    const liveSynthesizedBriefing = useMemo(() => {
        if (!dashboardData) return null;
        const total = dashboardData.totalStaff || 0;
        const present = dashboardData.presentTodayCount || 0;
        const late = dashboardData.lateTodayCount || 0;
        const rate = total > 0 ? Math.round((present / total) * 100) : 0;
        
        let punctGrade = 'A';
        if (rate >= 95 && late <= 2) punctGrade = 'A+';
        else if (rate >= 85) punctGrade = 'A';
        else if (rate >= 75) punctGrade = 'B+';
        else if (rate >= 60) punctGrade = 'B';
        else punctGrade = 'C';

        const deptEntries = Object.entries(dashboardData.deptBreakdown || {});
        const topDept = deptEntries.sort((a, b) => b[1] - a[1])[0]?.[0] || 'Factory Production';

        return {
            executive_summary: `Workforce operational capacity is running at ${rate}% with ${present} active staff on site today.`,
            punctuality_grade: punctGrade,
            top_performing_department: topDept,
            department_needs_attention: late > 3 ? 'Production Floor' : 'None',
            key_insights: [
                `Active operational capacity operating at ${rate}% across scheduled shifts.`,
                late > 0 ? `${late} late arrival(s) logged against morning shift grace periods.` : 'High morning punctuality maintained across all departments.'
            ],
            actionable_recommendations: [
                'Continue monitoring gate scanner biometrics and active shift capacity.',
                'Review pending leave applications for upcoming payroll cutoffs.'
            ],
            isSynthesized: true
        };
    }, [dashboardData]);

    // Merge AI Data with instant fallback chain: Fresh Query -> Overview AI -> Session Cache -> Live Synthesis
    const briefing = aiQueryData?.briefing 
        || overviewData?.aiData?.briefing 
        || localAIBriefing 
        || liveSynthesizedBriefing;

    const payrollInsight = aiQueryData?.payrollInsight || payrollData?.insight || null;
    const isAILoading = isManualRefreshingAI || (!briefing && isAIFetching);

    // Manual Refresh of AI Briefing only (zero overhead on telemetry)
    const handleRefreshAI = async () => {
        if (isManualRefreshingAI) return;
        setIsManualRefreshingAI(true);
        try {
            const res = await fetchWithAuth('/api/dashboard/ai-briefing?fresh=true');
            if (res.ok) {
                const fresh = await res.json();
                queryClient.setQueryData(['adminDashboardAI'], fresh);
                if (fresh?.briefing) {
                    const today = getTodayManilaKey();
                    localStorage.setItem(`cpoint_ai_briefing_${today}`, JSON.stringify(fresh.briefing));
                    setLocalAIBriefing(fresh.briefing);
                }
            }
        } catch (err) {
            console.error('[DASHBOARD_UI] AI Refresh error:', err);
        } finally {
            setIsManualRefreshingAI(false);
        }
    };

    // Drill-down detail for the Present Rate / Late Arrivals modals — fetched lazily,
    // only once a modal is actually opened, and kept fresh via the same real-time channel.
    const { data: attendanceDetail, isLoading: isDetailLoading } = useQuery({
        queryKey: ['attendanceToday'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/dashboard/attendance-today');
            if (!res.ok) throw new Error('Failed to load attendance detail');
            return res.json();
        },
        enabled: activeModal !== null,
        staleTime: 15000,
    });

    // Close modal on Escape
    useEffect(() => {
        if (!activeModal) return;
        const onKeyDown = (e) => { if (e.key === 'Escape') setActiveModal(null); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeModal]);

    // Real-time synchronization - invalidates fast overview telemetry on actual database changes
    useEffect(() => {
        const liveChannel = supabase
            .channel('dashboard_live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'] });
                queryClient.invalidateQueries({ queryKey: ['attendanceToday'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'], refetchType: 'active' });
            })
            .on('broadcast', { event: '*' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminDashboardOverview'], refetchType: 'active' });
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
                <div className="w-12 h-12 rounded-lg bg-accent-subtle flex items-center justify-center border border-accent/20">
                    <i className="ti ti-chart-pie-3 text-2xl text-accent" />
                </div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Connecting to live updates...</p>
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

            {/* AI Executive Briefing */}
            <div className="bg-slate-900 rounded-lg border border-slate-800 text-white shadow-2xs relative overflow-hidden">
                <div className="relative z-10 space-y-4 p-6 sm:p-7">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                            <span className="px-3 py-1 bg-surface-muted text-ink-subtle border border-line rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-ink-subtle" /> Google Gemini Brief
                            </span>
                            {(isManualRefreshingAI || (!briefing && isAIFetching)) && (
                                <span className="text-[11px] text-ink font-semibold flex items-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Analyzing live signals...
                                </span>
                            )}
                        </div>
                        <button
                            onClick={handleRefreshAI}
                            disabled={isAILoading}
                            className="self-start sm:self-center h-8 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-xs font-medium text-white transition-colors duration-100 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 text-ink-subtle ${isManualRefreshingAI ? 'animate-spin' : ''}`} />
                            <span>{isManualRefreshingAI ? 'Updating...' : 'Refresh summary'}</span>
                        </button>
                    </div>

                    {!briefing ? (
                        /* Enterprise Skeleton State only when absolutely zero telemetry is available */
                        <div className="space-y-4 animate-pulse pt-1">
                            <div className="h-7 bg-slate-800 rounded-md w-4/5 border-l-4 border-line pl-4 py-1 flex items-center">
                                <span className="text-xs text-slate-400 font-medium tracking-wide">
                                    Connecting to workforce intelligence telemetry...
                                </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div className="bg-slate-800/60 border border-slate-700/80 rounded-md p-4 space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <Lightbulb className="w-4 h-4 text-warning" />
                                        <div className="h-3 w-24 bg-slate-700 rounded"></div>
                                    </div>
                                    <div className="h-2.5 w-full bg-slate-700/60 rounded"></div>
                                    <div className="h-2.5 w-4/5 bg-slate-700/60 rounded"></div>
                                </div>
                                <div className="bg-slate-800/60 border border-slate-700/80 rounded-md p-4 space-y-2.5">
                                    <div className="flex items-center gap-2">
                                        <Target className="w-4 h-4 text-accent-on-dark" />
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
                            <p className="text-base sm:text-lg font-semibold text-white leading-relaxed border-l-4 border-line pl-4">
                                {briefing.executive_summary || `Workforce operational capacity is running at ${presentPercentage}% with ${presentTodayCount} active staff on site today.`}
                            </p>

                            {briefing.department_needs_attention && briefing.department_needs_attention !== 'None' && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2.5 py-1 bg-warning/10 border border-warning/30 rounded-md text-[11px] font-bold uppercase tracking-wider text-warning flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5 text-warning" /> Needs Attention: {briefing.department_needs_attention}
                                    </span>
                                </div>
                            )}

                            {/* AI-Generated Descriptive Analytics */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div className="bg-slate-800/60 border border-slate-700/80 rounded-md p-4">
                                    <span className="text-warning font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                        <Lightbulb className="w-3.5 h-3.5 text-ink-subtle" /> Operational Observations
                                    </span>
                                    <ul className="mt-2.5 space-y-1.5">
                                        {(briefing?.key_insights?.length ? briefing.key_insights : ['Not enough attendance data yet to generate observations.']).map((insight, i) => (
                                            <li key={i} className="text-xs text-slate-200 font-medium flex items-start gap-1.5 leading-relaxed">
                                                <span className="text-white mt-0.5">&bull;</span>
                                                <span>{insight}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="bg-slate-800/60 border border-slate-700/80 rounded-md p-4">
                                    <span className="text-accent-on-dark font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                                        <Target className="w-3.5 h-3.5 text-accent-on-dark" /> Recommended Actions
                                    </span>
                                    <ul className="mt-2.5 space-y-1.5">
                                        {(briefing?.actionable_recommendations?.length ? briefing.actionable_recommendations : ['No critical action items at this time.']).map((rec, i) => (
                                            <li key={i} className="text-xs text-slate-200 font-medium flex items-start gap-1.5 leading-relaxed">
                                                <span className="text-accent-on-dark mt-0.5">&bull;</span>
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
                <div className="bg-white p-5 sm:p-6 rounded-lg border border-slate-200 shadow-2xs relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-users text-5xl text-accent" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Workforce</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1 tracking-tight font-mono tabular-nums">
                        {totalStaff}
                    </h3>
                    <span className="text-xs font-semibold text-ink mt-2 flex items-center gap-1">
                        <i className="ti ti-check" /> Active Personnel
                    </span>
                </div>

                <button
                    type="button"
                    onClick={() => setActiveModal('present')}
                    className="bg-white p-5 sm:p-6 rounded-lg border border-slate-200 shadow-2xs relative overflow-hidden group text-left cursor-pointer hover:border-success/20 hover:bg-slate-50/50 transition-colors duration-100"
                >
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-user-check text-5xl text-ink" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Present Rate</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1 tracking-tight font-mono tabular-nums">
                        {presentPercentage}%
                    </h3>
                    <span className="text-xs font-semibold text-slate-600 mt-2 block">
                        {presentTodayCount} of {totalStaff} on-site &middot; <span className="text-accent group-hover:underline">View list &rarr;</span>
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => setActiveModal('late')}
                    className="bg-white p-5 sm:p-6 rounded-lg border border-slate-200 shadow-2xs relative overflow-hidden group text-left cursor-pointer hover:border-warning/20 hover:bg-slate-50/50 transition-colors duration-100"
                >
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-clock-exclamation text-5xl text-warning-ink" />
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Late Arrivals</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1 tracking-tight font-mono tabular-nums">
                        {lateTodayCount}
                    </h3>
                    <span className="text-xs font-semibold text-warning-ink mt-2 flex items-center gap-1">
                        <i className="ti ti-alert-triangle" /> Past grace period &middot; <span className="group-hover:underline">View list &rarr;</span>
                    </span>
                </button>

                <Link to="/admin/leaves" className="bg-slate-900 hover:bg-slate-800 transition-colors duration-100 p-5 sm:p-6 rounded-lg border border-slate-800 shadow-2xs text-white block cursor-pointer relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-5 opacity-10 group-hover:opacity-20 transition-opacity hidden sm:block">
                        <i className="ti ti-plane-departure text-5xl text-white" />
                    </div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pending Leaves</p>
                    <h3 className="text-3xl sm:text-4xl font-bold text-white mt-1 tracking-tight font-mono tabular-nums">
                        {pendingLeavesCount}
                    </h3>
                    <span className="text-xs font-semibold text-accent-on-dark mt-2 flex items-center justify-between">
                        <span>Action Required</span>
                        <span>&rarr;</span>
                    </span>
                </Link>
            </div>

            {/* Predictive Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                
                {/* Department Punctuality Scorecard */}
                <div className="bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-trophy text-ink-subtle text-lg" /> Department Punctuality Scorecard
                            </h3>
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
                <div className="bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-flame text-ink-subtle text-lg" /> Burnout & Overtime Risk
                            </h3>
                        </div>
                        <span className="px-2 py-0.5 bg-danger-subtle text-danger-ink text-[10px] font-bold uppercase rounded-md border border-danger/20">
                            {isAnomalyLoading ? '...' : `${riskFlags.length} active flag${riskFlags.length === 1 ? '' : 's'}`}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {riskFlags.length > 0 ? riskFlags.map((flag, i) => {
                            const key = `${flag.employee_name || i}-${flag.reason || flag.pattern || i}`;
                            const isOpen = expandedRiskFlag === i;
                            const isAck = !!acknowledged[key];
                            return (
                                <div key={i} className={`rounded-md border transition-colors duration-100 ${isOpen ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                                    <button
                                        type="button"
                                        onClick={() => setExpandedRiskFlag(isOpen ? null : i)}
                                        className="w-full p-3 flex items-center justify-between gap-3 text-left cursor-pointer"
                                    >
                                        <div className="min-w-0 flex items-center gap-2">
                                            <i className={`ti ti-chevron-right text-slate-400 text-sm shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-900 truncate">{formatDisplayName(flag.employee_name)}</p>
                                                <p className="text-[10px] text-slate-500 font-medium uppercase truncate">
                                                    {flag.reason || flag.pattern || `${flag.department} • ${flag.late_count} late(s)`}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border shrink-0 ${isAck ? 'bg-slate-100 text-slate-500 border-slate-300' : (RISK_STYLES[flag.severity] || RISK_STYLES.Low)}`}>
                                            {isAck ? 'Acknowledged' : (flag.severity || 'Flagged')}
                                        </span>
                                    </button>

                                    {isOpen && (
                                        <div className="px-3 pb-3 pt-0.5 space-y-2.5 border-t border-slate-100 mt-1">
                                            <p className="text-[11px] text-slate-500 font-medium pt-2.5">
                                                {flag.department ? `${flag.department} · ` : ''}
                                                {flag.reason || flag.pattern || 'Attendance issue flagged in the last 30 days.'}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setAcknowledged(prev => ({ ...prev, [key]: !prev[key] }))}
                                                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-100 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                                >
                                                    <i className={`ti ${isAck ? 'ti-circle-check-filled text-ink' : 'ti-circle text-slate-400'}`} />
                                                    {isAck ? 'Acknowledged' : 'Acknowledge'}
                                                </button>
                                                <Link
                                                    to="/admin/attendance"
                                                    className="h-8 px-2.5 bg-white border border-slate-200 rounded-md text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-100 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                                >
                                                    <i className="ti ti-history text-slate-500" /> View attendance
                                                </Link>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        }) : (
                            <p className="text-xs text-slate-400 font-medium py-6 text-center">
                                {isAnomalyLoading ? 'Checking recent attendance...' : 'No attendance issues flagged.'}
                            </p>
                        )}
                    </div>

                    {anomalyData?.report?.general_health_assessment && (
                        <div className="p-3 bg-surface-muted rounded-md border border-line flex items-start gap-2.5 text-xs text-ink font-medium">
                            <i className="ti ti-bulb text-accent text-base shrink-0 mt-0.5" />
                            <p>{anomalyData.report.general_health_assessment}</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Financial & Compliance Intelligence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                
                {/* Weekly Cutoff Payroll Forecaster */}
                <div className="bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-chart-arrows-vertical text-ink-subtle text-lg" /> {payrollData?.cutoffLabel ? `${payrollData.cutoffLabel} Cutoff` : 'Weekly'} Payroll Forecaster
                            </h3>
                        </div>
                        {payrollData?.employeesWithPayrate > 0 && (
                            <span className="px-2.5 py-1 bg-surface-muted text-ink text-xs font-semibold rounded-md border border-line shrink-0">
                                Day {payrollData.elapsedWorkingDays}/{payrollData.totalCutoffWorkingDays}
                            </span>
                        )}
                    </div>

                    {payrollData?.employeesWithPayrate > 0 ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 sm:p-4">
                                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Current payroll cost</p>
                                    <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                                        ₱{payrollData.actualPayToDate.toLocaleString()}
                                    </p>
                                </div>
                                <div className="bg-slate-900 border border-slate-800 rounded-md p-3.5 sm:p-4">
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Projected cutoff total</p>
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
                                <div className="p-3 bg-surface-muted rounded-md border border-line flex items-start gap-2.5 text-xs text-ink font-medium">
                                    <i className="ti ti-bulb text-accent text-base shrink-0 mt-0.5" />
                                    <p>{payrollInsight || payrollData.insight}</p>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="bg-slate-900 rounded-md border border-slate-800 p-5 text-white flex flex-col items-center justify-center text-center gap-2">
                            <i className="ti ti-currency-peso text-3xl text-slate-500" />
                            <p className="text-xs font-semibold text-slate-400 max-w-xs">
                                {isPayrollLoading ? 'Calculating projected payroll...' : 'No active employees have a configured salary yet.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* DOLE Labor Standard Compliance */}
                <div className="bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                                <i className="ti ti-scale text-accent text-lg" /> DOLE Rules &amp; Labor Standards
                            </h3>
                        </div>
                        <span className="px-2.5 py-1 bg-surface-muted text-ink text-xs font-semibold rounded-md border border-line">
                            {doleCompliance ? `${doleCompliance.restDay.compliancePercent}% Audit-Ready` : '—'}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        {doleCompliance ? (
                            <>
                                <div className="border border-slate-200 rounded-md overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedDoleCheck(prev => !prev)}
                                        disabled={doleCompliance.restDay.violations.length === 0}
                                        className={`w-full p-3 bg-slate-50 flex items-center justify-between text-xs text-left ${doleCompliance.restDay.violations.length > 0 ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'} transition-colors duration-100`}
                                    >
                                        <div className="flex items-center gap-2 font-semibold text-slate-700">
                                            {doleCompliance.restDay.violations.length > 0 && (
                                                <i className={`ti ti-chevron-right text-slate-400 text-sm transition-transform ${expandedDoleCheck ? 'rotate-90' : ''}`} />
                                            )}
                                            <i className={`ti ${doleCompliance.restDay.violations.length === 0 ? 'ti-circle-check-filled text-ink' : 'ti-alert-circle-filled text-ink'} text-base`} />
                                            <span>{doleCompliance.restDay.label}</span>
                                        </div>
                                        <span className={`font-mono text-[11px] font-bold ${doleCompliance.restDay.violations.length === 0 ? 'text-ink' : 'text-ink'}`}>
                                            {doleCompliance.restDay.status}
                                        </span>
                                    </button>

                                    {expandedDoleCheck && doleCompliance.restDay.violations.length > 0 && (
                                        <div className="p-3 pt-2.5 space-y-2 border-t border-slate-200 bg-white">
                                            {doleCompliance.restDay.violations.map((v) => {
                                                const key = `dole-${v.employee_id}`;
                                                const isAck = !!acknowledged[key];
                                                return (
                                                    <div key={v.employee_id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between gap-2 flex-wrap">
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-bold text-slate-900 truncate">{formatDisplayName(v.name)}</p>
                                                            <p className="text-[10px] text-slate-500 font-medium uppercase truncate">
                                                                {v.department} · {v.consecutive_days} consecutive days · through {v.streak_end_date}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => setAcknowledged(prev => ({ ...prev, [key]: !prev[key] }))}
                                                                className={`h-7 px-2.5 rounded-md text-[10px] font-medium border cursor-pointer transition-colors duration-100 shadow-2xs ${isAck ? 'bg-surface-muted text-ink border-line' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                                                            >
                                                                {isAck ? 'Acknowledged' : 'Acknowledge'}
                                                            </button>
                                                            <Link
                                                                to="/admin/attendance"
                                                                className="h-7 px-2.5 rounded-md text-[10px] font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors duration-100 shadow-2xs flex items-center gap-1"
                                                            >
                                                                <i className="ti ti-history text-slate-400" />
                                                                <span>View logs</span>
                                                            </Link>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                                        <i className="ti ti-circle-check-filled text-ink text-base" />
                                        <span>{doleCompliance.holidayMultiplier.label}</span>
                                    </div>
                                    <span className="font-mono text-[11px] font-bold text-ink">{doleCompliance.holidayMultiplier.status}</span>
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
                <div className="lg:col-span-7 bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-base font-bold text-slate-900">Workforce Attendance Volume Trend</h3>
                        </div>
                        <div className="bg-slate-100 rounded-md p-0.5 flex text-xs font-semibold text-slate-600 border border-slate-200">
                            <button
                                onClick={() => setTrendView('weekly')}
                                className={`h-7 px-3 rounded-sm transition-colors duration-100 cursor-pointer ${trendView === 'weekly' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
                            >
                                Weekly
                            </button>
                            <button
                                onClick={() => setTrendView('monthly')}
                                className={`h-7 px-3 rounded-sm transition-colors duration-100 cursor-pointer ${trendView === 'monthly' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'hover:text-slate-900'}`}
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
                                            className={`w-full max-w-[36px] rounded-t-sm transition-all duration-300 ease-out ${isToday ? 'bg-accent' : 'bg-slate-100 group-hover:bg-accent-subtle'}`}
                                            style={{ height }}
                                        />
                                    </div>
                                    <span className={`mt-3 text-[10px] font-bold uppercase tracking-wider text-center ${isToday ? 'text-accent' : 'text-slate-400'}`}>
                                        {trend.day}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Live Biometric Activity Feed */}
                <div className="lg:col-span-5 bg-white rounded-lg p-5 sm:p-6 border border-slate-200 shadow-2xs flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <i className="ti ti-broadcast text-accent" /> Live Gate Feed
                        </h3>
                        <Link to="/admin/attendance" className="text-xs font-semibold text-accent hover:underline">View All &rarr;</Link>
                    </div>

                    <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[300px] pr-1">
                        {recentLogs.length > 0 ? recentLogs.map((log) => (
                            <div
                                key={log.id}
                                className="p-3 bg-slate-50 rounded-md flex items-center justify-between border border-slate-200 transition-colors duration-100"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-md bg-accent text-white font-bold flex items-center justify-center text-xs shrink-0 shadow-2xs">
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
                                    log.status?.toLowerCase().includes('absent') ? 'bg-danger-subtle text-danger-ink border-danger/20' :
                                    log.status?.includes('Late') ? 'bg-warning-subtle text-warning-ink border-warning/20' : 
                                    'bg-slate-900 text-white border-slate-800'
                                }`}>
                                    {log.status}
                                </span>
                            </div>
                        )) : (
                            <p className="text-xs text-slate-400 font-medium py-8 text-center">No attendance logs recorded today yet.</p>
                        )}
                    </div>
                </div>

            </div>

            {/* Present Rate / Late Arrivals drill-down modal (in-page, no navigation) */}
            {activeModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70"
                    onClick={() => setActiveModal(null)}
                >
                    <div
                        className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">
                                    {activeModal === 'present' ? 'Present Today' : 'Late Arrivals Today'}
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">
                                    {activeModal === 'present'
                                        ? `${presentTodayCount} of ${totalStaff} on-site · Shift start ${attendanceDetail?.shiftStart || '8:00 AM'}`
                                        : `${lateTodayCount} clocked in past ${attendanceDetail?.shiftStart || '8:00 AM'}`}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveModal(null)}
                                className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors duration-100 cursor-pointer shrink-0"
                                aria-label="Close"
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 p-3 space-y-2">
                            {isDetailLoading ? (
                                <p className="text-xs text-slate-400 font-semibold py-10 text-center">Loading attendance detail...</p>
                            ) : (
                                (() => {
                                    const list = activeModal === 'present'
                                        ? (attendanceDetail?.present || [])
                                        : (attendanceDetail?.late || []);

                                    if (list.length === 0) {
                                        return (
                                            <p className="text-xs text-slate-400 font-semibold py-10 text-center">
                                                {activeModal === 'present' ? 'No one has clocked in yet today.' : 'No late arrivals today.'}
                                            </p>
                                        );
                                    }

                                    return list.map((person) => (
                                        <div
                                            key={person.id}
                                            className="p-3 bg-slate-50 rounded-md border border-slate-200 flex items-center justify-between gap-3"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-9 h-9 rounded-md bg-accent text-white font-bold flex items-center justify-center text-xs shrink-0">
                                                    {formatDisplayName(person.name).split(' ').map(p => p[0]).slice(0, 2).join('')}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-slate-900 truncate">{formatDisplayName(person.name)}</p>
                                                    <p className="text-[10px] text-slate-500 font-medium uppercase truncate">
                                                        {person.department} · Time in {person.time_in ? new Date(person.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                    </p>
                                                </div>
                                            </div>
                                            {activeModal === 'late' ? (
                                                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border shrink-0 bg-warning-subtle text-warning-ink border-warning/20 font-mono">
                                                    {person.lateLabel}
                                                </span>
                                            ) : (
                                                <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md border shrink-0 ${
                                                    person.status?.toLowerCase().includes('late')
                                                        ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                                        : 'bg-slate-900 text-white border-slate-800'
                                                }`}>
                                                    {person.status || 'On time'}
                                                </span>
                                            )}
                                        </div>
                                    ));
                                })()
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}