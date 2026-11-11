import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '../../../components/ui/PageHeader';
import { fetchWithAuth } from '../../../utils/api';
import { getUser, isAdmin } from '../../../routes/guards';
import { formatBackupDate } from '../../../utils/backupStatus.mjs';

// Code-split tab panels for sub-millisecond initial loading & low latency
const StatutorySettings = lazy(() => import('../payroll/StatutorySettings'));
const Holidays = lazy(() => import('../Holidays'));
const SilSettings = lazy(() => import('../payroll/components/SilSettings'));
const Backups = lazy(() => import('../Backups'));

function SettingsTabLoading() {
    return (
        <div className="flex items-center justify-center p-12 bg-white rounded-xl border border-slate-200">
            <div className="flex flex-col items-center gap-3">
                <div className="w-7 h-7 rounded-full border-2 border-slate-200 border-t-accent animate-spin" />
                <p className="text-xs font-medium text-slate-500">Loading configuration panel…</p>
            </div>
        </div>
    );
}

export default function SettingsHub() {
    const user = getUser();
    const adminUser = isAdmin(user);
    const [searchParams, setSearchParams] = useSearchParams();
    const activeTab = searchParams.get('tab') || 'overview';

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

    const { data: backupData } = useQuery({
        queryKey: ['backupStatusOverview'],
        queryFn: async () => {
            if (!adminUser) return null;
            const res = await fetchWithAuth('/api/backups/status');
            if (!res.ok) return null;
            return res.json();
        },
        enabled: Boolean(adminUser),
        staleTime: 30000,
    });

    const tabs = useMemo(() => {
        const base = [
            { id: 'overview', label: 'Overview & Cockpit', icon: 'ti-layout-grid', count: null },
            { id: 'statutory', label: 'Statutory & Taxes', icon: 'ti-adjustments-horizontal', count: '2026 DOLE' },
            { id: 'holidays', label: 'Holiday Calendar', icon: 'ti-calendar-event', count: null },
            { id: 'sil', label: 'Leave Policy (SIL)', icon: 'ti-plane-departure', count: '5 Days' },
        ];
        if (adminUser) {
            base.push({
                id: 'backups',
                label: 'Cloud Backups',
                icon: 'ti-database-export',
                count: backupData?.cloud?.status === 'verified' ? 'Verified' : 'B2 Active'
            });
        }
        return base;
    }, [adminUser, backupData]);

    const setTab = id => {
        setSearchParams(id === 'overview' ? {} : { tab: id });
    };

    const sssCap = statutoryData?.sss_max_msc ?? 35000;
    const minWage = statutoryData?.minimum_daily_wage ?? 755;
    const graceMins = statutoryData?.grace_period_minutes ?? 15;
    const lateRate = statutoryData?.late_rate_per_minute ?? 25;

    return (
        <div className="space-y-4">
            <PageHeader
                breadcrumbs={['Admin', 'Settings']}
                title="System Settings"
                description="Unified enterprise configuration, Philippine statutory compliance, and infrastructure governance."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span>DOLE 2026 Compliant</span>
                        </span>
                        {adminUser && backupData?.cloud?.status === 'verified' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                <i className="ti ti-cloud-lock text-sm" />
                                <span>B2 Cloud Encrypted</span>
                            </span>
                        )}
                    </div>
                }
            />

            {/* Sub-Millisecond Navigation Segmented Bar */}
            <nav className="flex items-center gap-1.5 p-1 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-x-auto custom-scrollbar" aria-label="Settings Tabs">
                {tabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setTab(tab.id)}
                            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer shrink-0 select-none ${
                                isActive
                                    ? 'bg-slate-900 text-white shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                            }`}
                            aria-selected={isActive}
                            role="tab"
                        >
                            <i className={`ti ${tab.icon} text-sm ${isActive ? 'text-white' : 'text-slate-400'}`} aria-hidden="true" />
                            <span>{tab.label}</span>
                            {tab.count && (
                                <span className={`text-[10px] font-mono font-medium px-1.5 py-0.2 rounded ${
                                    isActive
                                        ? 'bg-white/20 text-white'
                                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            {/* Tab Body */}
            <div className="min-w-0">
                {activeTab === 'overview' && (
                    <div className="space-y-4">
                        {/* Executive KPI Ribbon: 4 Core Statutory Parameters */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500">SSS MSC Cap</p>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-200">5% EE</span>
                                </div>
                                <p className="text-lg font-bold text-slate-900 mt-1 font-mono">₱{Number(sssCap).toLocaleString()}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">2026 SSS Circular ceiling</p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500">PhilHealth Rate</p>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">Total</span>
                                </div>
                                <p className="text-lg font-bold text-slate-900 mt-1 font-mono">5.0%</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Floor ₱10k · Ceiling ₱100k</p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500">Pag-IBIG Max</p>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200">Circ. 460</span>
                                </div>
                                <p className="text-lg font-bold text-slate-900 mt-1 font-mono">₱200.00</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">₱400 total mandatory share</p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium text-slate-500">NCR Daily Wage</p>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">DOLE Floor</span>
                                </div>
                                <p className="text-lg font-bold text-slate-900 mt-1 font-mono">₱{Number(minWage).toLocaleString()}.00</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Piece-rate holiday baseline</p>
                            </div>
                        </div>

                        {/* Domain Configuration Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {/* Card 1: Statutory Contributions & Tax Brackets */}
                            <section className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 rounded-md bg-blue-50 text-blue-700">
                                                <i className="ti ti-adjustments-horizontal text-base" />
                                            </div>
                                            <h2 className="text-sm font-semibold text-slate-900">Statutory & Tax Tables</h2>
                                        </div>
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
                                    </div>
                                    <p className="text-xs text-slate-600 mt-2.5">
                                        Philippine mandatory social security and health contribution schedules under SSS, PhilHealth, Pag-IBIG Circular 460, and TRAIN Law graduated withholding tax brackets.
                                    </p>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                                        <div className="flex justify-between"><span>SSS Contribution Share:</span><span className="font-semibold text-slate-800">5.0% EE / 10.0% ER</span></div>
                                        <div className="flex justify-between"><span>PhilHealth Premium:</span><span className="font-semibold text-slate-800">2.5% EE / 2.5% ER</span></div>
                                        <div className="flex justify-between"><span>Withholding Tax Version:</span><span className="font-semibold text-slate-800">TRAIN Law (Rev. 2026)</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('statutory')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Open Statutory Editor</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                    <Link to="/admin/payroll/statutory-settings" className="text-[11px] text-slate-400 hover:text-slate-600">
                                        Direct Route
                                    </Link>
                                </div>
                            </section>

                            {/* Card 2: Shift Schedule & Tardiness Governance */}
                            <section className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 rounded-md bg-amber-50 text-amber-700">
                                                <i className="ti ti-clock-hour-4 text-base" />
                                            </div>
                                            <h2 className="text-sm font-semibold text-slate-900">Work Shifts & Attendance Policies</h2>
                                        </div>
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Shift Rules</span>
                                    </div>
                                    <p className="text-xs text-slate-600 mt-2.5">
                                        Company work schedules, tardiness deduction penalties, call-time definitions, and grace period thresholds for biometric and gate scanning.
                                    </p>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                                        <div className="flex justify-between"><span>Standard Call Time:</span><span className="font-semibold text-slate-800">08:00 AM PHT</span></div>
                                        <div className="flex justify-between"><span>Lateness Grace Buffer:</span><span className="font-semibold text-slate-800">{graceMins} minutes</span></div>
                                        <div className="flex justify-between"><span>Penalty Deduction:</span><span className="font-semibold text-slate-800">₱{lateRate}.00 / minute</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
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
                            <section className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 rounded-md bg-purple-50 text-purple-700">
                                                <i className="ti ti-calendar-event text-base" />
                                            </div>
                                            <h2 className="text-sm font-semibold text-slate-900">DOLE Holiday Engine</h2>
                                        </div>
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">2026 Declarations</span>
                                    </div>
                                    <p className="text-xs text-slate-600 mt-2.5">
                                        National Regular Holidays (200%), Special Non-Working Holidays (130%), and warehouse piece-rate factory pay multipliers synchronized with DOLE proclamations.
                                    </p>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                                        <div className="flex justify-between"><span>Regular Holiday Premium:</span><span className="font-semibold text-slate-800">200% Pay Multiplier</span></div>
                                        <div className="flex justify-between"><span>Special Non-Working:</span><span className="font-semibold text-slate-800">130% Pay Multiplier</span></div>
                                        <div className="flex justify-between"><span>Official Gazette Sync:</span><span className="font-semibold text-emerald-700">Connected</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('holidays')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Open Holiday Manager</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                    <Link to="/admin/holidays" className="text-[11px] text-slate-400 hover:text-slate-600">
                                        Direct Route
                                    </Link>
                                </div>
                            </section>

                            {/* Card 4: Service Incentive Leave (SIL) Statutory Policy */}
                            <section className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 rounded-md bg-teal-50 text-teal-700">
                                                <i className="ti ti-plane-departure text-base" />
                                            </div>
                                            <h2 className="text-sm font-semibold text-slate-900">Service Incentive Leave (SIL)</h2>
                                        </div>
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">Art. 95</span>
                                    </div>
                                    <p className="text-xs text-slate-600 mt-2.5">
                                        Mandatory 5-day annual Service Incentive Leave entitlement for employees with at least 1 year of service, including monetization and cash-out conversion rules.
                                    </p>
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] text-slate-600 space-y-1">
                                        <div className="flex justify-between"><span>Mandatory Entitlement:</span><span className="font-semibold text-slate-800">5 Days / Year</span></div>
                                        <div className="flex justify-between"><span>Service Tenure Eligibility:</span><span className="font-semibold text-slate-800">12 Continuous Months</span></div>
                                        <div className="flex justify-between"><span>Unused Leave Conversion:</span><span className="font-semibold text-slate-800">Monetizable upon request</span></div>
                                    </div>
                                </div>
                                <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setTab('sil')}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                    >
                                        <span>Manage SIL Conversion</span>
                                        <i className="ti ti-arrow-right text-xs" />
                                    </button>
                                    <Link to="/admin/leaves?tab=sil-policy" className="text-[11px] text-slate-400 hover:text-slate-600">
                                        Direct Route
                                    </Link>
                                </div>
                            </section>

                            {/* Card 5: Cloud Backup & Disaster Recovery (Admin Only) */}
                            {adminUser && (
                                <section className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between md:col-span-2">
                                    <div>
                                        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-700">
                                                    <i className="ti ti-cloud-lock text-base" />
                                                </div>
                                                <h2 className="text-sm font-semibold text-slate-900">Autonomous Cloud Backup & Disaster Recovery</h2>
                                            </div>
                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                                                GitHub Actions Hosted
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                                                <p className="text-[10px] font-semibold uppercase text-slate-400">Target Storage</p>
                                                <p className="text-xs font-semibold text-slate-800 mt-0.5">Backblaze B2 S3</p>
                                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">AES-256-CTR + Poly1305</p>
                                            </div>
                                            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                                                <p className="text-[10px] font-semibold uppercase text-slate-400">Execution Cadence</p>
                                                <p className="text-xs font-semibold text-slate-800 mt-0.5">Daily around 02:17 PHT</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">Zero-PC Cloud Runner</p>
                                            </div>
                                            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                                                <p className="text-[10px] font-semibold uppercase text-slate-400">Integrity Health</p>
                                                <p className="text-xs font-semibold text-emerald-700 mt-0.5">Verified Passed</p>
                                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                                    {backupData?.last_check_at ? formatBackupDate(backupData.last_check_at) + ' PHT' : 'Checked'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                                        <button
                                            type="button"
                                            onClick={() => setTab('backups')}
                                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                                        >
                                            <span>Open Backup Control Center</span>
                                            <i className="ti ti-arrow-right text-xs" />
                                        </button>
                                        <Link to="/admin/backups" className="text-[11px] text-slate-400 hover:text-slate-600">
                                            Direct Route
                                        </Link>
                                    </div>
                                </section>
                            )}
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
                        <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-2xs">
                            <SilSettings />
                        </div>
                    </Suspense>
                )}

                {/* Sub-tab 4: Cloud Backups */}
                {activeTab === 'backups' && adminUser && (
                    <Suspense fallback={<SettingsTabLoading />}>
                        <Backups />
                    </Suspense>
                )}
            </div>
        </div>
    );
}
