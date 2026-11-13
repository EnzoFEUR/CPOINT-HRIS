import { lazy, Suspense, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '../../../components/ui/PageHeader';
import { fetchWithAuth } from '../../../utils/api';

// Code-split tab panels for sub-millisecond initial loading & low latency
const StatutorySettings = lazy(() => import('../payroll/StatutorySettings'));
const Holidays = lazy(() => import('../Holidays'));
const SilSettings = lazy(() => import('../payroll/components/SilSettings'));
const AuditLogsIndex = lazy(() => import('../audit-logs/Index'));

function SettingsTabLoading() {
    return (
        <div className="flex items-center justify-center p-12 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="flex flex-col items-center gap-3">
                <div className="w-7 h-7 rounded-full border-2 border-slate-200 dark:border-slate-800 border-t-accent animate-spin" />
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Loading configuration panel…</p>
            </div>
        </div>
    );
}

export default function SettingsHub() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get('tab') || 'overview';

    // Optimize: Redirect /admin/settings?tab=... directly to the dedicated standalone pages
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab === 'statutory') {
            navigate('/admin/payroll/statutory-settings', { replace: true });
        } else if (tab === 'holidays') {
            navigate('/admin/holidays', { replace: true });
        } else if (tab === 'audit') {
            navigate('/admin/audit-logs', { replace: true });
        }
    }, [searchParams, navigate]);

    // Real-time live status queries (cached via React Query with zero latency)
    const { data: statutoryData } = useQuery({
        queryKey: ['statutorySettingsOverview'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/payroll/statutory-settings');
            if (!res.ok) return null;
            return res.json();
        },
        staleTime: 60000,
    });

    const tabs = useMemo(() => [
        { id: 'overview', label: 'Overview & Cockpit', icon: 'ti-layout-grid', count: null },
        { id: 'statutory', label: 'Statutory & Taxes', icon: 'ti-adjustments-horizontal', count: '2026 DOLE' },
        { id: 'holidays', label: 'Holiday Calendar', icon: 'ti-calendar-event', count: null },
        { id: 'sil', label: 'Leave Policy (SIL)', icon: 'ti-plane-departure', count: '5 Days' },
        { id: 'audit', label: 'Audit Trail', icon: 'ti-history', count: null },
    ], []);

    const setTab = id => {
        if (id === 'statutory') {
            navigate('/admin/payroll/statutory-settings');
            return;
        }
        if (id === 'holidays') {
            navigate('/admin/holidays');
            return;
        }
        if (id === 'audit') {
            navigate('/admin/audit-logs');
            return;
        }
        setSearchParams(id === 'overview' ? {} : { tab: id });
    };

    const sssCap = statutoryData?.sss_max_msc ?? 35000;
    const minWage = statutoryData?.minimum_daily_wage ?? 755;
    const graceMins = statutoryData?.grace_period_minutes ?? 15;
    const lateRate = statutoryData?.late_rate_per_minute ?? 25;

    return (
        <div className="space-y-4">
            {activeTab === 'overview' && (
                <PageHeader
                    breadcrumbs={['Admin', 'Settings']}
                />
            )}
            {activeTab === 'sil' && (
                <PageHeader
                    breadcrumbs={['Admin', 'Settings', 'Leave Policy (SIL)']}
                />
            )}

            {/* Mobile-Only Navigation Segmented Bar (Hidden on PC/Desktop for clean cockpit view) */}
            <nav className="flex md:hidden items-center gap-1.5 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xs overflow-x-auto custom-scrollbar" aria-label="Settings Tabs">
                {tabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setTab(tab.id)}
                            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer shrink-0 select-none ${
                                isActive
                                    ? 'bg-slate-900 dark:bg-accent text-white shadow-2xs font-bold'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                            aria-selected={isActive}
                            role="tab"
                        >
                            <i className={`ti ${tab.icon} text-sm ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} aria-hidden="true" />
                            <span>{tab.label}</span>
                            {tab.count && (
                                <span className={`text-[10px] font-mono font-medium px-1.5 py-0.2 rounded ${
                                    isActive
                                        ? 'bg-white/20 text-white'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                                }`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Back to Settings Hub Button when a sub-tab is loaded */}
            {activeTab !== 'overview' && (
                <div className="flex items-center pb-2">
                    <button
                        type="button"
                        onClick={() => setTab('overview')}
                        className="group inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 active:bg-slate-100 dark:active:bg-slate-700/80 shadow-2xs text-xs font-semibold cursor-pointer transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent select-none shrink-0 active:scale-[0.98]"
                    >
                        <i className="ti ti-arrow-left text-xs text-slate-500 dark:text-slate-400 group-hover:-translate-x-0.5 group-hover:text-slate-900 dark:group-hover:text-white transition-transform duration-100 shrink-0" aria-hidden="true" />
                        <span>Back to Settings Hub</span>
                    </button>
                </div>
            )}

            {/* Tab Body */}
            <div className="min-w-0">
                {activeTab === 'overview' && (
                    <div className="space-y-4">
                        {/* Executive KPI Ribbon: 4 Core Statutory Parameters */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">SSS MSC Cap</p>
                                </div>
                                <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">₱{Number(sssCap).toLocaleString()}</p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">PhilHealth Rate</p>
                                </div>
                                <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">5.0%</p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Pag-IBIG Max</p>
                                </div>
                                <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">₱200.00</p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">NCR Daily Wage</p>
                                </div>
                                <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 font-mono">₱{Number(minWage).toLocaleString()}.00</p>
                            </div>
                        </div>

                        {/* Domain Configuration Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {/* Card 1: Statutory Contributions & Tax Brackets */}
                            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="pb-2.5 border-b border-slate-100 dark:border-slate-800">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Statutory & Tax Tables</h2>
                                    </div>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                        <div className="flex justify-between"><span>SSS Contribution Share:</span><span className="font-semibold text-slate-800 dark:text-slate-200">5.0% EE / 10.0% ER</span></div>
                                        <div className="flex justify-between"><span>PhilHealth Premium:</span><span className="font-semibold text-slate-800 dark:text-slate-200">2.5% EE / 2.5% ER</span></div>
                                        <div className="flex justify-between"><span>Withholding Tax Version:</span><span className="font-semibold text-slate-800 dark:text-slate-200">TRAIN Law (Rev. 2026)</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('statutory')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Open Statutory Editor</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                </div>
                            </section>

                            {/* Card 2: Shift Schedule & Tardiness Governance */}
                            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="pb-2.5 border-b border-slate-100 dark:border-slate-800">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Work Shifts & Attendance Policies</h2>
                                    </div>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                        <div className="flex justify-between"><span>Standard Call Time:</span><span className="font-semibold text-slate-800 dark:text-slate-200">08:00 AM PHT</span></div>
                                        <div className="flex justify-between"><span>Lateness Grace Buffer:</span><span className="font-semibold text-slate-800 dark:text-slate-200">{graceMins} minutes</span></div>
                                        <div className="flex justify-between"><span>Penalty Deduction:</span><span className="font-semibold text-slate-800 dark:text-slate-200">₱{lateRate}.00 / minute</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('statutory')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Update Attendance Parameters</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                </div>
                            </section>

                            {/* Card 3: Philippine Holiday Calendar & Factory Multipliers */}
                            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="pb-2.5 border-b border-slate-100 dark:border-slate-800">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">DOLE Holiday Engine</h2>
                                    </div>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                        <div className="flex justify-between"><span>Regular Holiday Premium:</span><span className="font-semibold text-slate-800 dark:text-slate-200">200% Pay Multiplier</span></div>
                                        <div className="flex justify-between"><span>Special Non-Working:</span><span className="font-semibold text-slate-800 dark:text-slate-200">130% Pay Multiplier</span></div>
                                        <div className="flex justify-between"><span>Official Gazette Sync:</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">Connected</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('holidays')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Open Holiday Manager</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                </div>
                            </section>

                            {/* Card 4: Service Incentive Leave (SIL) Statutory Policy */}
                            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="pb-2.5 border-b border-slate-100 dark:border-slate-800">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Service Incentive Leave (SIL)</h2>
                                    </div>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                        <div className="flex justify-between"><span>Mandatory Entitlement:</span><span className="font-semibold text-slate-800 dark:text-slate-200">5 Days / Year</span></div>
                                        <div className="flex justify-between"><span>Service Tenure Eligibility:</span><span className="font-semibold text-slate-800 dark:text-slate-200">12 Continuous Months</span></div>
                                        <div className="flex justify-between"><span>Unused Leave Conversion:</span><span className="font-semibold text-slate-800 dark:text-slate-200">Monetizable upon request</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('sil')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Manage SIL Conversion</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                </div>
                            </section>

                            {/* Card 5: Audit Trail & Security Forensics */}
                            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="pb-2.5 border-b border-slate-100 dark:border-slate-800">
                                        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Security Audit Trail</h2>
                                    </div>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                        <div className="flex justify-between"><span>Audit Scope:</span><span className="font-semibold text-slate-800 dark:text-slate-200">Auth, Payroll, Bio, Records</span></div>
                                        <div className="flex justify-between"><span>Ledger Integrity:</span><span className="font-semibold text-emerald-700 dark:text-emerald-400">Append-Only Immutable</span></div>
                                        <div className="flex justify-between"><span>Compliance Standard:</span><span className="font-semibold text-slate-800 dark:text-slate-200">NPC / DOLE Retention</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('audit')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Open Audit Trail</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                </div>
                            </section>
                        </div>
                    </div>
                )}

                {/* Sub-tab 1: Statutory Settings */}
                {activeTab === 'statutory' && (
                    <Suspense fallback={<SettingsTabLoading />}>
                        <StatutorySettings />
                    </Suspense>
                )}

                {/* Sub-tab 2: Holiday Calendar */}
                {activeTab === 'holidays' && (
                    <Suspense fallback={<SettingsTabLoading />}>
                        <Holidays />
                    </Suspense>
                )}

                {/* Sub-tab 3: SIL Leave Policy */}
                {activeTab === 'sil' && (
                    <Suspense fallback={<SettingsTabLoading />}>
                        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                            <SilSettings />
                        </div>
                    </Suspense>
                )}

                {/* Sub-tab 5: Audit Trail */}
                {activeTab === 'audit' && (
                    <Suspense fallback={<SettingsTabLoading />}>
                        <AuditLogsIndex />
                    </Suspense>
                )}
            </div>
        </div>
    );
}
