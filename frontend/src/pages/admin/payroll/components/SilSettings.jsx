import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../../supabaseClient';
import { fetchWithAuth } from '../../../../utils/api';
import { getUser } from '../../../../routes/guards';
import { readLeaveCreditResponse } from '../../../../utils/useEmployeeLeaveCredits';
import { Link } from 'react-router-dom';
import { isCreditManager, validateSilPolicy } from '../../../../../../shared/leavePolicy.js';
import { getManilaWorkDate } from '../../../../../../shared/workPolicy.mjs';

export default function SilSettings() {
    const user = getUser();
    const canManage = Boolean(user?.id) && isCreditManager(user);
    const queryClient = useQueryClient();
    const policyKey = ['silPolicy', user?.id];
    const policy = useQuery({
        queryKey: policyKey,
        enabled: canManage,
        queryFn: async ({ signal }) => readLeaveCreditResponse(await fetchWithAuth('/api/leave-credits/policy', { signal })),
        staleTime: 15000,
        refetchInterval: 60000,
        refetchIntervalInBackground: false,
        retry: false
    });
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const request = useRef(null);
    const busy = useRef(false);

    // Conversion policy & searchable obligations state
    const [conversionDraft, setConversionDraft] = useState(null);
    const [conversionSaving, setConversionSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'annual' | 'separation'
    const conversionRequest = useRef(null);
    const conversionBusy = useRef(false);

    const conversionPolicy = useQuery({
        queryKey: ['silConversionSettings', user?.id],
        enabled: canManage,
        retry: false,
        staleTime: 15000,
        queryFn: async ({ signal }) => readLeaveCreditResponse(await fetchWithAuth('/api/leave-credits/conversion-settings', { signal }))
    });

    const obligations = useQuery({
        queryKey: ['silObligations', user?.id],
        enabled: canManage,
        retry: false,
        staleTime: 15000,
        refetchInterval: 60000,
        refetchIntervalInBackground: false,
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth('/api/leave-credits/obligations?limit=100', { signal });
            let body;
            try { body = await response.json(); } catch { throw new Error(response.ok ? 'Unexpected response format.' : `Server error (${response.status}).`); }
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load SIL obligations.');
            return body;
        }
    });

    useEffect(() => {
        if (!canManage) return;
        const channel = supabase.channel('sil-settings-realtime')
            .on('broadcast', { event: 'SIL_POLICY_CHANGED' }, () => {
                queryClient.invalidateQueries({ queryKey: ['silPolicy'] });
                queryClient.invalidateQueries({ queryKey: ['silObligations'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_obligations' }, () => {
                queryClient.invalidateQueries({ queryKey: ['silObligations'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_conversion_settings' }, () => {
                queryClient.invalidateQueries({ queryKey: ['silConversionSettings'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_cash_out_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['silObligations'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_leave_credit_ledger' }, () => {
                queryClient.invalidateQueries({ queryKey: ['silObligations'] });
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [canManage, queryClient]);

    const validObligations = useMemo(() => {
        return (obligations.data?.data || []).filter(item => {
            const role = (item.employees?.role || '').toLowerCase();
            const dept = (item.employees?.department || '').toLowerCase();
            if (['admin', 'superadmin', 'security'].includes(role)) return false;
            if (dept.includes('admin') || dept.includes('security')) return false;
            return true;
        });
    }, [obligations.data?.data]);

    const totalCount = validObligations.length;
    const annualCount = validObligations.filter(i => i.kind === 'annual').length;
    const separationCount = validObligations.filter(i => i.kind === 'separation').length;

    const filteredObligations = useMemo(() => {
        return validObligations.filter(item => {
            if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
            if (!searchQuery.trim()) return true;
            const term = searchQuery.toLowerCase().trim();
            const first = (item.employees?.first_name || '').toLowerCase();
            const last = (item.employees?.last_name || '').toLowerCase();
            const companyId = (item.employees?.company_id || '').toLowerCase();
            const dept = (item.employees?.department || '').toLowerCase();
            const fullName = `${first} ${last}`;
            const reverseName = `${last} ${first}`;
            return (
                last.includes(term) ||
                first.includes(term) ||
                companyId.includes(term) ||
                dept.includes(term) ||
                fullName.includes(term) ||
                reverseName.includes(term)
            );
        });
    }, [validObligations, kindFilter, searchQuery]);

    const submit = async event => {
        event.preventDefault();
        if (!canManage || !draft || !policy.data || policy.isError || busy.current) return;
        setError('');
        try {
            const values = { annual_days: draft.days === '' ? null : Number(draft.days), expected_id: draft.expectedId };
            const fingerprint = JSON.stringify(values);
            if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
            const body = validateSilPolicy({ ...values, request_id: request.current.id });
            busy.current = true; setSaving(true);
            const data = await readLeaveCreditResponse(await fetchWithAuth('/api/leave-credits/policy', { method: 'PUT', body: JSON.stringify(body) }));
            queryClient.setQueryData(['silPolicy', user.id], data);
            setDraft(null); request.current = null;
            await queryClient.invalidateQueries({ queryKey: ['silPolicy', user.id], exact: true });
            toast.success('Annual credits saved for future grants.');
        } catch (failure) { setError(failure.message || 'Unable to save annual credits.'); }
        finally { busy.current = false; setSaving(false); }
    };

    const editConversion = (field, value) => setConversionDraft(previous => ({
        ...(previous || {
            year_boundary: conversionPolicy.data?.year_boundary || 'service_anniversary',
            allow_early: conversionPolicy.data?.allow_early || false,
            expected_id: conversionPolicy.data?.revision,
            reason: ''
        }),
        [field]: value
    }));

    const submitConversion = async event => {
        event.preventDefault();
        if (!conversionDraft || conversionBusy.current || !canManage || conversionPolicy.isError) return;
        const fingerprint = JSON.stringify(conversionDraft);
        if (conversionRequest.current?.fingerprint !== fingerprint) conversionRequest.current = { fingerprint, id: crypto.randomUUID() };
        conversionBusy.current = true; setConversionSaving(true);
        try {
            const saved = await readLeaveCreditResponse(await fetchWithAuth('/api/leave-credits/conversion-settings', {
                method: 'PUT',
                body: JSON.stringify({ ...conversionDraft, request_id: conversionRequest.current.id })
            }));
            queryClient.setQueryData(['silConversionSettings', user.id], saved);
            await queryClient.invalidateQueries({ queryKey: ['employeeLeaveCredits'] });
            setConversionDraft(null); conversionRequest.current = null; toast.success('Conversion policy saved.');
        } catch (err) { toast.error(err.message); }
        finally { conversionBusy.current = false; setConversionSaving(false); }
    };

    if (!canManage) return null;

    return (
        <div className="space-y-5">


            {/* 2-Column Grid for Policies */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Annual SIL Entitlement Card */}
                <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs flex flex-col justify-between" aria-label="Statutory SIL policy">
                    <div>
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-md bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-calendar-plus text-sm" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800">Annual Leave Credits</h4>
                                </div>
                            </div>
                        </div>

                        {policy.isPending ? (
                            <div className="py-8 text-center text-xs text-slate-400 font-medium">Loading annual credits...</div>
                        ) : policy.isError ? (
                            <div className="p-3 bg-danger-subtle border border-danger/20 rounded-md text-xs text-danger-ink">{policy.error.message}</div>
                        ) : (
                            <form onSubmit={submit} className="space-y-4">
                                <fieldset disabled={saving} className="space-y-3">
                                    <div>
                                        <label htmlFor="annual-credits-days" className="block text-xs font-medium text-slate-700 mb-1.5">
                                            Annual Credits (Days per Year)
                                        </label>
                                        <div className="relative">
                                            <input
                                                id="annual-credits-days"
                                                type="number"
                                                required
                                                min="5"
                                                max="366"
                                                step="1"
                                                className="w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-sm text-slate-800 font-semibold focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs"
                                                value={draft?.days ?? policy.data.annual_days}
                                                onChange={event => setDraft(previous => ({ days: event.target.value, expectedId: previous?.expectedId || policy.data.id }))}
                                            />
                                            <span className="absolute right-3 top-2 text-xs font-semibold text-slate-400">days</span>
                                        </div>
                                    </div>

                                    <div className="bg-slate-50 rounded-md p-3 border border-slate-100 space-y-1.5 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500">Accrual timing:</span>
                                            <span className="font-semibold text-slate-700">Every 12 months from hire date</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-500">Payment mechanism:</span>
                                            <span className="font-semibold text-slate-700">Calculated in weekly payroll</span>
                                        </div>
                                        {policy.data.effective_on > getManilaWorkDate() && (
                                            <div className="flex items-center justify-between text-accent font-semibold pt-1 border-t border-slate-200">
                                                <span>Pending update:</span>
                                                <span>{policy.data.annual_days} days on {policy.data.effective_on}</span>
                                            </div>
                                        )}
                                    </div>
                                </fieldset>

                                {error && <p role="alert" className="text-xs text-danger-ink bg-danger-subtle p-2 rounded border border-danger/20">{error}</p>}

                                <div className="flex items-center justify-between pt-2">
                                    {draft && <span className="text-[11px] text-slate-400">Changes apply to future anniversaries</span>}
                                    <button
                                        type="submit"
                                        disabled={!draft || saving}
                                        className="h-8 px-4 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-md shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                                    >
                                        {saving && <i className="ti ti-loader-2 animate-spin text-xs" />}
                                        <span>{saving ? 'Saving...' : 'Save Allowance'}</span>
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </section>

                {/* Cash Conversion Settings Card */}
                <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs flex flex-col justify-between" aria-label="SIL conversion policy">
                    <div>
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-md bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-coins text-sm" />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800">Cash Conversion Rules</h4>
                                </div>
                            </div>
                        </div>

                        {conversionPolicy.isPending ? (
                            <div className="py-8 text-center text-xs text-slate-400 font-medium">Loading conversion policy...</div>
                        ) : conversionPolicy.isError ? (
                            <div className="p-3 bg-danger-subtle border border-danger/20 rounded-md text-xs text-danger-ink">{conversionPolicy.error.message}</div>
                        ) : (
                            <form onSubmit={submitConversion} className="space-y-4">
                                <fieldset disabled={conversionSaving} className="space-y-3">
                                    <div>
                                        <label htmlFor="conversion-year-boundary" className="block text-xs font-medium text-slate-700 mb-1.5">
                                            Conversion Year Cutoff
                                        </label>
                                        <select
                                            id="conversion-year-boundary"
                                            className="w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-sm text-slate-800 font-semibold focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs"
                                            value={conversionDraft?.year_boundary ?? conversionPolicy.data.year_boundary}
                                            onChange={event => editConversion('year_boundary', event.target.value)}
                                        >
                                            <option value="service_anniversary">Employee Service Anniversary (Default)</option>
                                            <option value="calendar">Calendar Year (December 31)</option>
                                        </select>
                                    </div>

                                    <label className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-md border border-slate-100 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                                            checked={conversionDraft?.allow_early ?? conversionPolicy.data.allow_early}
                                            onChange={event => editConversion('allow_early', event.target.checked)}
                                        />
                                        <div>
                                            <span className="block text-xs font-semibold text-slate-800">Allow Early Conversion</span>
                                            <span className="block text-[11px] text-slate-500">Permit employees to request cash encashment for active, earned credits before year-end.</span>
                                        </div>
                                    </label>

                                    {conversionDraft && (
                                        <div>
                                            <label htmlFor="conversion-reason" className="block text-xs font-medium text-slate-700 mb-1.5">
                                                Policy Revision Reference / Memo
                                            </label>
                                            <input
                                                id="conversion-reason"
                                                required
                                                maxLength={500}
                                                placeholder="e.g. HR Memo 2026-04 SIL cash-out guidelines"
                                                className="w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-xs text-slate-800 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs"
                                                value={conversionDraft.reason}
                                                onChange={event => editConversion('reason', event.target.value)}
                                            />
                                        </div>
                                    )}
                                </fieldset>

                                <div className="flex items-center justify-between pt-2">
                                    <button
                                        type="submit"
                                        disabled={!conversionDraft || conversionSaving}
                                        className="h-8 px-4 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-md shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                                    >
                                        {conversionSaving && <i className="ti ti-loader-2 animate-spin text-xs" />}
                                        <span>{conversionSaving ? 'Saving...' : 'Save Conversion Rules'}</span>
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </section>
            </div>

            {/* Searchable Annual & Final Pay SIL Obligations */}
            <section className="bg-white rounded-lg border border-slate-200 p-5 shadow-2xs space-y-4" aria-label="Annual and final-pay reviews">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-md bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                            <i className="ti ti-users-group text-sm" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-800">Annual & Final Pay SIL Obligations</h4>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Instant Search Bar & Filter Pills */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                    {/* Instant Search Input */}
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-3 top-2.5 text-xs text-slate-400 pointer-events-none" />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search employee by name, ID (e.g. CP-2026-015)..."
                            className="w-full h-8 pl-8 pr-7 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-800 font-medium placeholder:text-slate-400 focus:outline-none focus:border-accent focus:bg-white focus:ring-1 focus:ring-accent transition-all shadow-2xs"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 transition-colors"
                                title="Clear search"
                            >
                                <i className="ti ti-x text-xs" />
                            </button>
                        )}
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => setKindFilter('all')}
                            className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors ${
                                kindFilter === 'all'
                                    ? 'bg-slate-900 text-white shadow-2xs'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                            }`}
                        >
                            All ({totalCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setKindFilter('annual')}
                            className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors ${
                                kindFilter === 'annual'
                                    ? 'bg-slate-900 text-white shadow-2xs'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                            }`}
                        >
                            Annual Milestone ({annualCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setKindFilter('separation')}
                            className={`h-8 px-3 rounded-md text-xs font-semibold transition-colors ${
                                kindFilter === 'separation'
                                    ? 'bg-slate-900 text-white shadow-2xs'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                            }`}
                        >
                            Final Pay ({separationCount})
                        </button>
                    </div>
                </div>

                {/* Error Banner */}
                {obligations.isError && (
                    <div className="p-3 bg-danger-subtle border border-danger/20 rounded-md text-xs text-danger-ink">
                        {obligations.error.message}
                    </div>
                )}

                {/* Content States */}
                {obligations.isPending ? (
                    <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
                        <i className="ti ti-loader-2 animate-spin text-accent text-sm" />
                        <span>Checking scheduled obligations...</span>
                    </div>
                ) : totalCount === 0 ? (
                    <div className="py-8 text-center bg-slate-50/80 rounded-lg border border-slate-100">
                        <i className="ti ti-check-double text-2xl text-success mb-1 inline-block" />
                        <p className="text-xs font-semibold text-slate-700">All SIL obligations up to date</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">No outstanding annual anniversary encashments or separation reviews required at this time.</p>
                    </div>
                ) : filteredObligations.length === 0 ? (
                    <div className="py-6 text-center bg-slate-50/80 rounded-lg border border-slate-100">
                        <i className="ti ti-search text-xl text-slate-400 mb-1 inline-block" />
                        <p className="text-xs font-semibold text-slate-700">No matching employees found</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            {searchQuery ? `No pending obligations match "${searchQuery}".` : 'No obligations in this category.'}
                        </p>
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => { setSearchQuery(''); setKindFilter('all'); }}
                                className="mt-2 text-xs font-semibold text-accent hover:text-accent-hover transition-colors"
                            >
                                Clear search
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                        {filteredObligations.map(item => {
                            const first = item.employees?.first_name || '';
                            const last = item.employees?.last_name || '';
                            const companyId = item.employees?.company_id || 'ID Pending';
                            const dept = item.employees?.department;
                            const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || 'EM';
                            const isSeparation = item.kind === 'separation';

                            return (
                                <div
                                    key={item.id}
                                    className="p-3 bg-white hover:bg-slate-50/80 flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors"
                                >
                                    {/* Left: Employee Identity */}
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200/80 flex items-center justify-center font-bold text-xs text-slate-700 shrink-0">
                                            {initials}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-slate-900 truncate">
                                                    {last}, {first}
                                                </span>
                                                <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60">
                                                    {companyId}
                                                </span>
                                                {dept && (
                                                    <span className="text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/50">
                                                        {dept}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                                                <span>Period end: <span className="font-mono text-slate-600 font-medium">{item.period_end || 'Needs review'}</span></span>
                                                {item.note && <span className="text-slate-300">&bull;</span>}
                                                {item.note && <span className="truncate max-w-[280px] text-slate-500">{item.note}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Status Badges, Days & Action */}
                                    <div className="flex items-center justify-between md:justify-end gap-2.5 shrink-0">
                                        {/* Obligation Status Badge */}
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                            item.status === 'available'
                                                ? 'bg-success-subtle text-success-ink border border-success/20'
                                                : item.status === 'cashout_pending'
                                                ? 'bg-accent-subtle text-accent border border-accent/20'
                                                : 'bg-warning-subtle text-warning-ink border border-warning/20'
                                        }`}>
                                            <i className={`ti ${item.status === 'available' ? 'ti-check' : item.status === 'cashout_pending' ? 'ti-clock' : 'ti-alert-circle'} text-xs`} />
                                            <span>{item.status === 'available' ? 'Available' : item.status === 'cashout_pending' ? 'Pending' : 'Needs Review'}</span>
                                        </span>

                                        {/* Category Badge */}
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200/60">
                                            <i className={`ti ${isSeparation ? 'ti-user-x' : 'ti-calendar-event'} text-xs`} />
                                            <span>{isSeparation ? 'Final Pay' : 'Annual SIL'}</span>
                                        </span>

                                        {/* Recorded Days & Proportional */}
                                        <div className="text-right min-w-[70px]">
                                            <div className="text-xs font-bold text-slate-800 tabular-nums">
                                                {Number(item.recorded_days)} days
                                            </div>
                                            {Number(item.proportional_days) > 0 && (
                                                <div className="text-[10px] text-slate-400 tabular-nums">
                                                    +{Number(item.proportional_days)} prop.
                                                </div>
                                            )}
                                        </div>

                                        {/* Action Button */}
                                        <Link
                                            to={`/admin/employees/${item.employee_id}`}
                                            className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 rounded-md border border-slate-200 transition-colors shadow-2xs"
                                        >
                                            <span>Review</span>
                                            <i className="ti ti-chevron-right text-xs" />
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}
