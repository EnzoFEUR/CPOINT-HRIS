import { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import PageHeader from '../../../components/ui/PageHeader';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import { fetchWithAuth } from '../../../utils/api';
import { getStoredUser } from '../../../utils/storedUser.mjs';
import { createDisciplinaryMutation as createIdempotentMutation } from '../../../utils/disciplinaryMutation';
import { retirementCsv } from '../../../utils/retirementCsv.mjs';
import { employmentTenure } from '../../../utils/employmentTenure.mjs';
import { supabase } from '../../../supabaseClient';
import { getManilaWorkDate } from '../../../../../shared/workPolicy.mjs';
import { getRetirementWorkflow } from '../../../../../shared/employmentExit.mjs';
import { isCreditUuid } from '../../../../../shared/leaveCredits.mjs';
import './RetirementPay.print.css';

const sourceUrl =
    'https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf';

const currency = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
});

const php = (value) =>
    value === null || value === undefined
        ? '—'
        : currency.format(Number(value));

const fullName = (employee) =>
    [employee?.first_name, employee?.last_name].filter(Boolean).join(' ');

const inputClass =
    'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent shadow-2xs';

const buttonClass =
    'h-9 px-3.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 rounded-md font-medium text-xs sm:text-sm transition-colors duration-100 flex items-center justify-center gap-1.5 border border-slate-200 shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const primaryButtonClass =
    'h-9 px-4 bg-accent hover:bg-accent-hover active:bg-accent-hover text-white rounded-md font-medium text-xs sm:text-sm transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const successButtonClass =
    'h-9 px-4 bg-success hover:bg-success-ink active:bg-success-ink text-white rounded-md font-medium text-xs sm:text-sm transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const dangerButtonClass =
    'h-9 px-3.5 bg-white hover:bg-danger-subtle text-danger-ink border border-danger/20 rounded-md font-medium text-xs sm:text-sm transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

function Field({ label, hint, children, className = '' }) {
    return (
        <label className={`block space-y-1.5 text-xs sm:text-sm text-slate-700 ${className}`}>
            <span className="font-semibold text-slate-800">{label}</span>
            {children}
            {hint && (
                <span className="block text-xs text-slate-500 font-normal">{hint}</span>
            )}
        </label>
    );
}

function useDebounced(value) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), 300);
        return () => clearTimeout(timer);
    }, [value]);
    return settled;
}

async function readJson(path, options) {
    const response = await fetchWithAuth(path, options);
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error || 'The request could not be completed.');
    return data;
}

function Calculation({ calculation }) {
    if (!calculation) return null;
    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent" />
                    <span className="font-bold text-sm text-slate-900">
                        Statutory Calculation Breakdown
                    </span>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200/80 text-slate-600">
                    {calculation.policy_version}
                </span>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs sm:text-sm">
                <div className="bg-white p-2.5 rounded-md border border-slate-200/80 shadow-2xs">
                    <dt className="text-slate-500 text-[11px] font-medium uppercase tracking-wider">Age at Retirement</dt>
                    <dd className="font-bold text-slate-900 mt-0.5">{calculation.age_years ?? '—'} yrs</dd>
                </div>
                <div className="bg-white p-2.5 rounded-md border border-slate-200/80 shadow-2xs">
                    <dt className="text-slate-500 text-[11px] font-medium uppercase tracking-wider">Service / Credited</dt>
                    <dd className="font-bold text-slate-900 mt-0.5">
                        {calculation.service_years ?? '—'} / {calculation.credited_years ?? '—'} yrs
                    </dd>
                </div>
                <div className="bg-white p-2.5 rounded-md border border-slate-200/80 shadow-2xs">
                    <dt className="text-slate-500 text-[11px] font-medium uppercase tracking-wider">Daily Wage Basis</dt>
                    <dd className="font-bold font-mono text-slate-900 mt-0.5">{php(calculation.daily_rate)}</dd>
                </div>
                <div className="bg-white p-2.5 rounded-md border border-slate-200/80 shadow-2xs">
                    <dt className="text-slate-500 text-[11px] font-medium uppercase tracking-wider">Category</dt>
                    <dd className="font-bold text-slate-900 capitalize mt-0.5">{calculation.retirement_category}</dd>
                </div>
            </dl>

            {!calculation.eligible ? (
                <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs sm:text-sm text-amber-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-amber-900">
                        <i className="ti ti-alert-triangle text-base text-amber-600" />
                        <span>Statutory pay eligibility needs review</span>
                    </div>
                    <ul className="list-disc pl-5 space-y-0.5 text-xs text-amber-800">
                        {calculation.blockers.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="space-y-2 pt-1">
                    <div className="text-[11px] text-slate-500 font-medium flex items-center justify-between">
                        <span>Statutory Components (RA 7641 Formula)</span>
                        <span className="font-mono text-slate-600">Daily × 22.5 days × {calculation.credited_years} yrs</span>
                    </div>
                    <dl className="space-y-1.5 text-xs sm:text-sm bg-white p-3 rounded-md border border-slate-200 shadow-2xs">
                        {[
                            ['15-day salary component', calculation.components.basic],
                            ['5-day SIL component', calculation.components.sil],
                            ['2.5-day 13th-month component', calculation.components.thirteenth],
                            ['Centavo rounding adjustment', calculation.components.rounding_adjustment],
                        ].map(([label, amount]) => (
                            <div key={label} className="flex justify-between gap-3 text-slate-600">
                                <dt>{label}</dt>
                                <dd className="font-mono text-slate-900">{php(amount)}</dd>
                            </div>
                        ))}
                        <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold text-slate-900 text-sm sm:text-base">
                            <dt>Statutory Gross Retirement Pay</dt>
                            <dd className="font-mono text-accent">{php(calculation.statutory_gross)}</dd>
                        </div>
                    </dl>
                </div>
            )}

            {calculation.rate_basis === 'piece_rate' && (
                <div className="text-xs text-slate-600 bg-slate-100 p-2.5 rounded border border-slate-200">
                    ADS Evidence Period: {calculation.earnings_period_start} to {calculation.earnings_period_end} ({php(calculation.earnings_12_months)} ÷ {calculation.actual_workdays} actual workdays).
                </div>
            )}
        </div>
    );
}

export default function RetirementPay() {
    const [params] = useSearchParams();
    const exitRequestId = params.get('exit_request_id');
    const actorId = getStoredUser()?.id || 'session';
    const exitLink = useQuery({
        queryKey: ['retirementExitLink', actorId, exitRequestId],
        enabled: Boolean(exitRequestId && isCreditUuid(exitRequestId)),
        queryFn: ({ signal }) => readJson('/api/retirement-pay/cases/' + exitRequestId, { signal }),
        staleTime: 0, refetchInterval: 30_000, retry: false,
    });
    if (exitRequestId && (!exitLink.data || !exitLink.isFetchedAfterMount)) return (
        <div className="space-y-4 p-4 sm:p-6">
            <PageHeader title="Retirement Pay" breadcrumbs={['Admin', 'Payroll', 'Retirement Pay']} />
            <div role={exitLink.isError || !isCreditUuid(exitRequestId) ? 'alert' : 'status'} className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
                {!isCreditUuid(exitRequestId) ? 'Invalid Employment Exit case reference.' : exitLink.isError ? exitLink.error.message : 'Opening the retirement case and its saved calculation…'}
                {exitLink.isError && <button type="button" className={buttonClass} onClick={() => exitLink.refetch()}>Retry</button>}
            </div>
            <Link className={buttonClass} to="/admin/employment-exit">Return to Employment Exit</Link>
        </div>
    );
    return <RetirementPayWorkspace key={actorId + ':' + (exitRequestId || 'ledger')} exitRequestId={exitRequestId} exitLink={exitLink} />;
}

function RetirementPayWorkspace({ exitRequestId, exitLink }) {
    const queryClient = useQueryClient();
    const [, setParams] = useSearchParams();
    const actorId = getStoredUser()?.id || 'session';
    const request = useMemo(() => createIdempotentMutation(fetchWithAuth), []);
    const formRef = useRef(null);
    const mutationLock = useRef(false);

    const [search, setSearch] = useState('');
    const [employeePage, setEmployeePage] = useState(1);
    const [employeeSelection, setEmployee] = useState(null);
    const employee = exitRequestId ? exitLink.data.employee : employeeSelection;
    const workflow = getRetirementWorkflow(exitLink.data);
    const [formFields, setForm] = useState(() => ({
        retirement_date: exitLink.data?.record.effective_date || getManilaWorkDate(),
        rate_basis: exitRequestId && Number(employee?.daily_rate) > 0 ? 'daily' : '',
        daily_rate: exitRequestId && Number(employee?.daily_rate) > 0 ? String(employee.daily_rate) : '',
        earnings_12_months: '',
        actual_workdays: '',
        rate_note: '',
    }));
    const confirmedDate = exitLink.data?.record.effective_date || '';
    const form = useMemo(() => exitRequestId
        ? { ...formFields, retirement_date: confirmedDate }
        : formFields, [formFields, exitRequestId, confirmedDate]);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState('all');
    const [selectedSnapshot, setSelected] = useState(exitLink.data?.settlement || null);
    const [action, setAction] = useState(null);
    const [review, setReview] = useState({});
    const [busy, setBusy] = useState(false);

    const searchTerm = useDebounced(search);
    const settledForm = useDebounced(form);
    const serviceTenure = employmentTenure(employee?.date_hired, form.retirement_date);

    const employees = useQuery({
        queryKey: ['retirementEmployees', actorId, searchTerm, employeePage],
        enabled: !exitRequestId,
        queryFn: ({ signal }) =>
            readJson(
                `/api/retirement-pay/employees?search=${encodeURIComponent(searchTerm)}&page=${employeePage}`,
                { signal }
            ),
        staleTime: 30_000,
        retry: 1,
    });

    const exitLinkReady = Boolean(exitRequestId && exitLink.data && !exitLink.isError && !exitLink.isFetching &&
        employee?.id === exitLink.data.record.employee_id && form.retirement_date === exitLink.data.record.effective_date);

    const ledger = useQuery({
        queryKey: ['retirementPay', actorId, status, page],
        enabled: !exitRequestId,
        queryFn: ({ signal }) =>
            readJson(
                `/api/retirement-pay?page=${page}&limit=25&status=${status}`,
                { signal }
            ),
        staleTime: 10_000,
        refetchInterval: 30_000,
        retry: 1,
    });

    const refreshedSelection = exitRequestId ? exitLink.data?.settlement : ledger.data?.data.find(
        (record) => record.id === selectedSnapshot?.id
    );

    const selected =
        refreshedSelection &&
        (!selectedSnapshot || Date.parse(refreshedSelection.updated_at) >=
            Date.parse(selectedSnapshot.updated_at))
            ? refreshedSelection
            : selectedSnapshot;

    const ready = Boolean(
        employee &&
            /^\d{4}-\d{2}-\d{2}$/.test(settledForm.retirement_date) &&
            settledForm.rate_basis &&
            (settledForm.rate_basis === 'piece_rate'
                ? Number(settledForm.earnings_12_months) > 0 &&
                  Number(settledForm.actual_workdays) > 0
                : Number(settledForm.daily_rate) > 0)
    );

    const preview = useQuery({
        queryKey: ['retirementPreview', actorId, employee?.id, settledForm],
        enabled: ready && (!exitRequestId || workflow.canCreate),
        queryFn: ({ signal }) =>
            readJson('/api/retirement-pay/preview', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: employee.id,
                    ...settledForm,
                }),
                signal,
            }),
        staleTime: 10_000,
        retry: false,
    });

    const currentPreview =
        ready && JSON.stringify(form) === JSON.stringify(settledForm)
            ? preview.data
            : null;

    const refresh = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['retirementPay', actorId] }),
        queryClient.invalidateQueries({ queryKey: ['retirementExitLink', actorId] }),
    ]);

    useEffect(() => {
        const refreshAll = () => {
            queryClient.invalidateQueries({
                queryKey: ['retirementPay', actorId],
            });
            queryClient.invalidateQueries({
                queryKey: ['retirementEmployees', actorId],
            });
            queryClient.invalidateQueries({
                queryKey: ['retirementPreview', actorId],
            });
            queryClient.invalidateQueries({ queryKey: ['retirementExitLink', actorId] });
        };
        const channel = !exitRequestId ? supabase
            .channel('retirement-pay-ledger', { config: { private: true } })
            .on('broadcast', { event: 'RETIREMENT_CHANGED' }, refreshAll)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'employees' },
                refreshAll
            )
            .subscribe((state) => {
                if (state === 'SUBSCRIBED') refreshAll();
            }) : null;
        const exitChannel = exitRequestId ? supabase.channel('employment-exit-hr', { config: { private: true } })
            .on('broadcast', { event: 'EXIT_CHANGED' }, refreshAll)
            .subscribe(state => {
                if (state === 'SUBSCRIBED') refreshAll();
            }) : null;
        return () => {
            if (channel) supabase.removeChannel(channel);
            if (exitChannel) supabase.removeChannel(exitChannel);
        };
    }, [actorId, queryClient, exitRequestId]);

    const changeForm = (key, value) =>
        setForm((previous) => ({ ...previous, [key]: value }));

    const chooseEmployee = (item) => {
        if (exitRequestId) return;
        setEmployee(item);
        setForm((previous) => ({
            ...previous,
            rate_basis: '',
            daily_rate: item.daily_rate == null ? '' : String(item.daily_rate),
            rate_note: '',
            earnings_12_months: '',
            actual_workdays: '',
        }));
        toast.success(`Selected ${fullName(item)} for calculation`, { id: 'ret-emp-select' });
        setTimeout(() => {
            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 60);
    };

    async function mutate(path, body) {
        if (mutationLock.current) return false;
        if ((path === '/drafts' && (!workflow.canCreate || !exitLinkReady)) ||
            (path.endsWith('/approve') && (!workflow.canApprove || !exitLinkReady)) ||
            (path.endsWith('/payment') && (!workflow.canPay || !exitLinkReady))) {
            toast.error('Refresh the linked exit case and complete its required HR step first.');
            return false;
        }
        mutationLock.current = true;
        setBusy(true);
        try {
            const response = await request('/api/retirement-pay' + path, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok)
                throw new Error(
                    result.error || 'The action could not be confirmed.'
                );
            setSelected(result.record);
            setAction(null);
            setReview({});
            toast.success(
                result.replayed
                    ? 'Previously saved action confirmed.'
                    : 'Retirement record saved.'
            );
            await refresh();
            return true;
        } catch (error) {
            toast.error(error.message);
            return false;
        } finally {
            mutationLock.current = false;
            setBusy(false);
        }
    }

    const selectRecord = (record) => {
        if (record.inputs?.exit_request_id) {
            setParams({ exit_request_id: record.inputs.exit_request_id });
            return;
        }
        setSelected(record);
        setAction(null);
        setReview({});
    };

    const exportPage = () => {
        const blob = new Blob([retirementCsv(ledger.data?.data || [])], {
            type: 'text/csv;charset=utf-8;',
        });
        const url = URL.createObjectURL(blob),
            link = document.createElement('a');
        link.href = url;
        link.download = `retirement-pay-page-${page}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const statusTabs = [
        { id: 'all', label: 'All Settlements' },
        { id: 'draft', label: 'Drafts' },
        { id: 'approved', label: 'Approved' },
        { id: 'paid', label: 'Paid' },
        { id: 'cancelled', label: 'Cancelled' },
    ];

    return (
        <div className="w-full pb-24 lg:pb-8 font-sans space-y-5">
            <PageHeader
                breadcrumbs={['Admin', 'Payroll', 'Retirement Pay']}
                actions={
                    <div className="flex items-center gap-2 flex-wrap">
                        <Link to="/admin/payroll" className={buttonClass}>
                            <i className="ti ti-arrow-left text-base text-slate-500" />
                            <span>Back to Payroll</span>
                        </Link>
                        <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonClass}
                            title="DOLE Workers' Statutory Monetary Benefits Handbook"
                        >
                            <i className="ti ti-book text-base text-slate-500" />
                            <span>DOLE Handbook</span>
                        </a>
                    </div>
                }
            />

            {/* Main Operational Split Columns */}
            <div className={exitRequestId ? 'space-y-5' : 'grid gap-5 xl:grid-cols-2 items-start'}>
                {/* Column 1: Prepare Calculation */}
                <section
                    className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 space-y-4 shadow-2xs"
                    aria-labelledby="retirement-calculate-heading"
                >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center text-base font-bold shadow-2xs">
                                <i className="ti ti-calculator" />
                            </div>
                            <div>
                                <h2
                                    id="retirement-calculate-heading"
                                    className="font-bold text-sm sm:text-base text-slate-900"
                                >
                                    Prepare Calculation
                                </h2>
                            </div>
                        </div>
                        {exitRequestId && <div role={exitLink.isError ? 'alert' : 'status'} className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm space-y-2 [overflow-wrap:anywhere]">
                            <p className="font-semibold">{fullName(employee)} · {workflow.statusLabel}</p>
                            <p>Confirmed retirement date: {exitLink.data.record.effective_date || 'Awaiting HR review'}.</p>
                            {(exitLink.isError || !exitLink.data.can_prepare || (selected && selected.retirement_date !== exitLink.data.record.effective_date) || (selected?.status === 'approved' && !workflow.canPay)) && (
                                <p className="text-xs">{exitLink.isError ? 'Case refresh failed. Financial actions paused.' :
                                    !exitLink.data.can_prepare ? 'Financial actions paused: case review or withdrawal pending.' :
                                    selected && selected.retirement_date !== exitLink.data.record.effective_date ? 'Financial actions paused: retirement date changed.' :
                                    'Awaiting finalized retirement separation.'}</p>
                            )}
                            <Link className="underline font-semibold" to={'/admin/employment-exit?id=' + exitRequestId}>Open this Employment Exit case</Link>
                            {exitLink.isError && <button type="button" className={buttonClass} onClick={() => exitLink.refetch()}>Retry case refresh</button>}
                        </div>}
                    {employee && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent-subtle text-accent border border-accent/20 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                                <span>Selected employee</span>
                            </span>
                        )}
                    </div>

                    {!exitRequestId && <>
                    <Field label="Find Employee">
                        <div className="relative">
                            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                            <input
                                className={`${inputClass} pl-9`}
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                    setEmployeePage(1);
                                }}
                                maxLength={160}
                                placeholder="Search by name, employee ID, or company ID..."
                            />
                        </div>
                    </Field>

                    {employees.isPending && (
                        <div role="status" className="flex items-center gap-2 text-xs text-slate-500 py-1">
                            <i className="ti ti-loader-2 animate-spin text-sm text-accent" />
                            <span>Loading employees roster…</span>
                        </div>
                    )}

                    {employees.error && (
                        <div role="alert" className="p-3 rounded-md bg-danger-subtle text-danger-ink border border-danger/20 text-xs sm:text-sm">
                            {employees.error.message}
                        </div>
                    )}

                    {/* Employee Directory Selection List */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-slate-600 font-semibold px-0.5">
                            <span>Select Employee to Calculate</span>
                            <span className="text-[11px] text-slate-400 font-normal">Click a card below</span>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2 space-y-1.5 bg-slate-50/40">
                            {(employees.data?.data || []).map((item) => {
                                const isSelected = employee?.id === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        aria-pressed={isSelected}
                                        onClick={() => chooseEmployee(item)}
                                        className={`w-full p-2.5 rounded-lg border text-left transition-all duration-150 flex items-center justify-between gap-3 cursor-pointer select-none group ${
                                            isSelected
                                                ? 'bg-blue-50/90 border-2 border-accent text-slate-900 shadow-xs ring-2 ring-accent/20'
                                                : 'bg-white border-slate-200 hover:border-accent hover:bg-slate-50 active:scale-[0.99] shadow-2xs'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <EmployeeAvatar employee={item} size="h-8 w-8" />
                                            <div className="truncate">
                                                <div className="text-slate-900 font-semibold text-xs sm:text-sm group-hover:text-accent transition-colors flex items-center gap-1.5">
                                                    <span>{fullName(item)}</span>
                                                    {item.archived_at && (
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 font-normal">
                                                            Archived
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                                                    <span className="font-semibold text-slate-700">{item.company_id || 'No ID'}</span>
                                                    {item.department && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="text-slate-500 font-sans">{item.department}</span>
                                                        </>
                                                    )}
                                                    {item.daily_rate != null && (
                                                        <>
                                                            <span>·</span>
                                                            <span className="text-slate-600 font-mono">₱{Number(item.daily_rate).toFixed(2)}/day</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="shrink-0 flex items-center gap-1.5">
                                            {isSelected ? (
                                                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-accent text-white shadow-2xs inline-flex items-center gap-1">
                                                    <i className="ti ti-check text-xs font-bold" />
                                                    <span>Selected</span>
                                                </span>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 group-hover:text-accent transition-colors">
                                                    <span className="hidden sm:inline">Select</span>
                                                    <div className="w-5 h-5 rounded-full border-2 border-slate-300 group-hover:border-accent group-hover:bg-accent/10 flex items-center justify-center transition-all">
                                                        <i className="ti ti-chevron-right text-xs opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}

                            {employees.data && employees.data.data.length === 0 && (
                                <div className="p-4 text-center text-xs text-slate-500">
                                    No matching employees found.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1">
                        <button
                            className={buttonClass}
                            type="button"
                            disabled={employeePage <= 1}
                            onClick={() => setEmployeePage((value) => value - 1)}
                        >
                            <i className="ti ti-chevron-left text-xs" />
                            <span>Previous</span>
                        </button>
                        <span className="text-slate-500 font-medium">
                            Page {employeePage}
                        </span>
                        <button
                            className={buttonClass}
                            type="button"
                            disabled={employeePage * 50 >= (employees.data?.total || 0)}
                            onClick={() => setEmployeePage((value) => value + 1)}
                        >
                            <span>Next</span>
                            <i className="ti ti-chevron-right text-xs" />
                        </button>
                    </div>

                    </>}
                    {employee && (!exitRequestId || workflow.canCreate) && (
                        <form
                            ref={formRef}
                            className="space-y-4 pt-3 border-t border-slate-100"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (currentPreview?.calculation.eligible && exitLinkReady && workflow.canCreate)
                                    mutate('/drafts', {
                                        employee_id: employee.id,
                                        ...form,
                                        exit_request_id: exitRequestId,
                                    });
                            }}
                        >
                            {/* Selected Employee Summary Card */}
                            <div className="p-3.5 bg-gradient-to-r from-blue-50/90 via-indigo-50/40 to-blue-50/90 border-2 border-accent/40 rounded-lg shadow-xs flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="relative">
                                        <EmployeeAvatar employee={employee} size="h-10 w-10" />
                                        <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-accent text-white flex items-center justify-center text-[10px] shadow-2xs">
                                            <i className="ti ti-check" />
                                        </span>
                                    </div>
                                    <div className="truncate">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-white">
                                                Employee
                                            </span>
                                        </div>
                                        <div className="font-bold text-sm sm:text-base text-slate-900 truncate">
                                            {fullName(employee)}
                                        </div>
                                        <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap font-medium">
                                            <span>ID: <strong className="font-mono text-slate-800">{employee.company_id || 'N/A'}</strong></span>
                                            <span>·</span>
                                            <span>Hired: <strong className="text-slate-800">{employee.date_hired || '—'}</strong></span>
                                            <span>·</span>
                                            <span>DOB: <strong className="text-slate-800">{employee.birth_date || '—'}</strong></span>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-700 whitespace-normal">
                                            Length of service: <strong>
                                                {serviceTenure
                                                    ? `${serviceTenure.years} ${serviceTenure.years === 1 ? 'year' : 'years'}, ${serviceTenure.months} ${serviceTenure.months === 1 ? 'month' : 'months'}`
                                                    : employee.date_hired ? 'Check hire and retirement dates' : 'Hire date not on file'}
                                            </strong>
                                            {serviceTenure && <span className="block text-slate-500">As of retirement date {form.retirement_date}</span>}
                                        </p>
                                    </div>
                                </div>
                                {!exitRequestId && <button
                                    type="button"
                                    onClick={() => setEmployee(null)}
                                    className="h-8 px-2.5 rounded-md text-xs font-semibold bg-white hover:bg-slate-100 text-slate-600 hover:text-danger border border-slate-200 shadow-2xs transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                                >
                                    <i className="ti ti-x text-xs" />
                                    <span>Change</span>
                                </button>}
                            </div>


                            <div className="grid sm:grid-cols-2 gap-3">
                                <Field label="Retirement Date">
                                    <input
                                        className={inputClass}
                                        type="date"
                                        readOnly={Boolean(exitRequestId)}
                                        min="1900-01-01"
                                        max="2200-12-31"
                                        required
                                        value={form.retirement_date}
                                        onChange={(event) =>
                                            changeForm(
                                                'retirement_date',
                                                event.target.value
                                            )
                                        }
                                    />
                                </Field>

                                <Field label="Verified Wage Basis">
                                    <select
                                        className={inputClass}
                                        required
                                        value={form.rate_basis}
                                        onChange={(event) =>
                                            changeForm(
                                                'rate_basis',
                                                event.target.value
                                            )
                                        }
                                    >
                                        <option value="">Choose wage basis</option>
                                        <option value="daily">
                                            Latest basic daily wage
                                        </option>
                                        <option value="monthly_equivalent">
                                            Daily equivalent of monthly salary
                                        </option>
                                        <option value="piece_rate">
                                            Piece-rate / paid-by-results (12-mo ADS)
                                        </option>
                                    </select>
                                </Field>
                            </div>

                            {form.rate_basis === 'piece_rate' ? (
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <Field label="12-Month Basic Earnings (PHP)">
                                        <input
                                            className={inputClass}
                                            type="number"
                                            inputMode="decimal"
                                            min="0.01"
                                            max="1000000000"
                                            step="0.01"
                                            required
                                            value={form.earnings_12_months}
                                            onChange={(event) =>
                                                changeForm(
                                                    'earnings_12_months',
                                                    event.target.value
                                                )
                                            }
                                        />
                                    </Field>
                                    <Field label="Actual Working Days">
                                        <input
                                            className={inputClass}
                                            type="number"
                                            min="1"
                                            max="366"
                                            step="1"
                                            required
                                            value={form.actual_workdays}
                                            onChange={(event) =>
                                                changeForm(
                                                    'actual_workdays',
                                                    event.target.value
                                                )
                                            }
                                        />
                                    </Field>
                                </div>
                            ) : (
                                <Field label="Basic Daily Rate (PHP)">
                                    <input
                                        className={inputClass}
                                        type="number"
                                        inputMode="decimal"
                                        min="0.01"
                                        max="1000000"
                                        step="0.01"
                                        required
                                        value={form.daily_rate}
                                        onChange={(event) =>
                                            changeForm(
                                                'daily_rate',
                                                event.target.value
                                            )
                                        }
                                    />
                                </Field>
                            )}

                            <Field label="Wage-Basis Evidence Note">
                                <textarea
                                    className={inputClass}
                                    rows={2}
                                    minLength={10}
                                    maxLength={1000}
                                    required
                                    placeholder="Enter reference to payroll masterlist, certified daily rate, or ADS period..."
                                    value={form.rate_note}
                                    onChange={(event) =>
                                        changeForm(
                                            'rate_note',
                                            event.target.value
                                        )
                                    }
                                />
                            </Field>

                            {preview.isFetching && (
                                <div
                                    role="status"
                                    className="flex items-center gap-2 text-xs text-slate-500 py-1"
                                >
                                    <i className="ti ti-loader-2 animate-spin text-accent text-sm" />
                                    <span>Calculating statutory amount…</span>
                                </div>
                            )}

                            {preview.error && (
                                <div
                                    role="alert"
                                    className="p-3 rounded-md bg-danger-subtle text-danger-ink border border-danger/20 text-xs sm:text-sm"
                                >
                                    {preview.error.message}
                                </div>
                            )}

                            {currentPreview && (
                                <Calculation
                                    calculation={currentPreview.calculation}
                                />
                            )}

                            <button
                                className={primaryButtonClass}
                                disabled={
                                    busy ||
                                    !currentPreview?.calculation.eligible ||
                                    !exitLinkReady || !workflow.canCreate ||
                                    preview.isFetching
                                }
                            >
                                <i className="ti ti-device-floppy text-base" />
                                <span>Save Retirement Calculation</span>
                            </button>
                            {!exitRequestId && <p className="text-xs text-slate-600">Reviewed retirement case required. <Link className="underline font-semibold" to="/admin/employment-exit">Open Employment Exit</Link></p>}
                        </form>
                    )}
                </section>

                {/* Column 2: Settlement Register */}
                {!exitRequestId && (<section
                    className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 space-y-4 shadow-2xs"
                    aria-labelledby="retirement-ledger-heading"
                >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center text-base">
                                <i className="ti ti-file-text" />
                            </div>
                            <div>
                                <h2
                                    id="retirement-ledger-heading"
                                    className="font-bold text-sm sm:text-base text-slate-900"
                                >
                                    Settlement Register
                                </h2>
                            </div>
                        </div>

                    </div>

                    {/* Filter Tabs and Actions Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {statusTabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => {
                                        setStatus(tab.id);
                                        setPage(1);
                                    }}
                                    className={`h-8 px-3 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                        status === tab.id
                                            ? 'bg-slate-900 text-white shadow-2xs'
                                            : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                className={buttonClass}
                                type="button"
                                onClick={refresh}
                                disabled={ledger.isFetching}
                                title="Refresh settlement ledger"
                            >
                                <i className={`ti ti-refresh text-sm ${ledger.isFetching ? 'animate-spin' : ''}`} />
                                <span className="hidden sm:inline">Refresh</span>
                            </button>
                            <button
                                className={buttonClass}
                                type="button"
                                disabled={
                                    !ledger.data?.data.length || ledger.isFetching
                                }
                                onClick={exportPage}
                                title="Export current page to CSV"
                            >
                                <i className="ti ti-download text-sm" />
                                <span>Export CSV</span>
                            </button>
                        </div>
                    </div>

                    {ledger.isPending && (
                        <div role="status" className="flex items-center gap-2 text-xs text-slate-500 py-3">
                            <i className="ti ti-loader-2 animate-spin text-accent text-sm" />
                            <span>Loading settlements ledger…</span>
                        </div>
                    )}

                    {ledger.error && (
                        <div role="alert" className="p-3 rounded-md bg-danger-subtle text-danger-ink border border-danger/20 text-xs sm:text-sm">
                            {ledger.error.message}
                        </div>
                    )}

                    {ledger.data?.data.length === 0 && (
                        <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-lg border border-slate-200">
                            <i className="ti ti-receipt-off text-3xl text-slate-300 block mb-1" />
                            <p className="text-sm font-bold text-slate-600">No retirement settlements found</p>
                        </div>
                    )}

                    {/* Table View */}
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left border-collapse text-xs sm:text-sm">
                            <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-semibold uppercase tracking-wider">
                                <tr>
                                    <th className="py-3 px-3.5">Employee</th>
                                    <th className="py-3 px-3.5">Retirement Date</th>
                                    <th className="py-3 px-3.5 text-right">Statutory Gross</th>
                                    <th className="py-3 px-3.5 text-center">Status</th>
                                    <th className="py-3 px-3.5 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {(ledger.data?.data || []).map((record) => {
                                    const isSelected = selected?.id === record.id;
                                    return (
                                        <tr
                                            key={record.id}
                                            className={`hover:bg-slate-50/80 transition-colors ${
                                                isSelected ? 'bg-accent-subtle/30 font-medium' : ''
                                            }`}
                                        >
                                            <td className="py-3 px-3.5">
                                                <div className="flex items-center gap-2.5">
                                                    <EmployeeAvatar employee={record.employee_snapshot} size="h-7 w-7" />
                                                    <div>
                                                        <div className="font-medium text-slate-900">{fullName(record.employee_snapshot)}</div>
                                                        <div className="text-[11px] text-slate-500 font-mono">{record.employee_snapshot?.company_id || '—'}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-3.5 text-slate-700 whitespace-nowrap">
                                                {record.retirement_date}
                                            </td>
                                            <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                                                {php(record.calculation.statutory_gross)}
                                            </td>
                                            <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                                    record.status === 'paid'
                                                        ? 'bg-success-subtle text-success-ink border border-success/20'
                                                        : record.status === 'approved'
                                                        ? 'bg-accent-subtle text-accent border border-accent/20'
                                                        : record.status === 'cancelled'
                                                        ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                                        : 'bg-warning-subtle text-warning-ink border border-warning/20'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                        record.status === 'paid' ? 'bg-success' : record.status === 'approved' ? 'bg-accent' : record.status === 'cancelled' ? 'bg-slate-400' : 'bg-warning'
                                                    }`} />
                                                    <span className="capitalize">{record.status}</span>
                                                </span>
                                            </td>
                                            <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                                <button
                                                    type="button"
                                                    onClick={() => selectRecord(record)}
                                                    className={`h-7 px-2.5 rounded text-xs font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
                                                        isSelected
                                                            ? 'bg-accent text-white shadow-2xs'
                                                            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                                                    }`}
                                                    aria-label={`Review ${fullName(record.employee_snapshot)} retirement settlement`}
                                                >
                                                    <i className="ti ti-eye text-xs" />
                                                    <span>Review</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs pt-1">
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={page <= 1}
                            onClick={() => setPage((value) => value - 1)}
                        >
                            <i className="ti ti-chevron-left text-xs" />
                            <span>Previous</span>
                        </button>
                        <span className="text-slate-500 font-medium">
                            Page {page} · {ledger.data?.total || 0} records
                        </span>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={page * 25 >= (ledger.data?.total || 0)}
                            onClick={() => setPage((value) => value + 1)}
                        >
                            <span>Next</span>
                            <i className="ti ti-chevron-right text-xs" />
                        </button>
                    </div>
                </section>)}
            </div>

            {/* Selected Settlement Statement Card */}
            {selected && (
                <section
                    className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6 space-y-5 shadow-2xs"
                    aria-labelledby="retirement-record-heading"
                >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center text-lg">
                                <i className="ti ti-file-certificate" />
                            </div>
                            <div>
                                <h2
                                    id="retirement-record-heading"
                                    className="font-bold text-base sm:text-lg text-slate-900"
                                >
                                    Settlement Details
                                </h2>
                                <p className="text-xs text-slate-500 font-mono">
                                    ID: {selected.id}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                                selected.status === 'paid'
                                    ? 'bg-success-subtle text-success-ink border border-success/20'
                                    : selected.status === 'approved'
                                    ? 'bg-accent-subtle text-accent border border-accent/20'
                                    : selected.status === 'cancelled'
                                    ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                    : 'bg-warning-subtle text-warning-ink border border-warning/20'
                            }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                    selected.status === 'paid' ? 'bg-success' : selected.status === 'approved' ? 'bg-accent' : selected.status === 'cancelled' ? 'bg-slate-400' : 'bg-warning'
                                }`} />
                                <span className="uppercase tracking-wider">{selected.status}</span>
                            </span>

                            <button
                                type="button"
                                className={buttonClass}
                                onClick={() => window.print()}
                            >
                                <i className="ti ti-printer text-base text-slate-500" />
                                <span>Print Statement</span>
                            </button>
                        </div>
                    </div>
                    {exitRequestId && <Link className="text-xs font-semibold underline text-accent" to={'/admin/employment-exit?id=' + exitRequestId}>View linked Employment Exit case</Link>}
                    {!selected.inputs?.exit_request_id && <p className="text-xs text-slate-600">Historical standalone settlement — approval and payment unavailable.</p>}

                    {/* Official Statement Container (Print Target) */}
                    <div id="retirement-statement" className="space-y-4">
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                <EmployeeAvatar employee={selected.employee_snapshot} size="h-10 w-10" />
                                <div>
                                    <h3 className="font-bold text-sm sm:text-base text-slate-900">
                                        {fullName(selected.employee_snapshot)}
                                    </h3>
                                    <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                                        <span>Company ID: <strong className="font-mono text-slate-700">{selected.employee_snapshot.company_id}</strong></span>
                                        <span>·</span>
                                        <span>Hired: <strong className="text-slate-700">{selected.employment_start}</strong></span>
                                        <span>·</span>
                                        <span>Retirement Date: <strong className="text-slate-700">{selected.retirement_date}</strong></span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <Calculation calculation={selected.calculation} />

                        <div className="grid gap-3 sm:grid-cols-2 text-xs sm:text-sm">
                            <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
                                <span className="font-bold text-slate-800 text-xs uppercase tracking-wider block">Wage Evidence</span>
                                <p className="text-slate-600 whitespace-pre-wrap break-words">{selected.inputs.rate_note}</p>
                            </div>
                            <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs space-y-1">
                                <span className="font-bold text-slate-800 text-xs uppercase tracking-wider block">HR Review Note</span>
                                <p className="text-slate-600 whitespace-pre-wrap break-words">
                                    {selected.review?.review_note || 'Pending HR review and approval.'}
                                </p>
                            </div>
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap pt-1">
                            <span>Created {selected.created_at} by <strong className="text-slate-700">{selected.created_by}</strong></span>
                            {selected.approved_at && (
                                <>
                                    <span>·</span>
                                    <span>Approved {selected.approved_at} by <strong className="text-slate-700">{selected.approved_by}</strong></span>
                                </>
                            )}
                        </div>

                        {selected.status === 'paid' && (
                            <div className="rounded-lg border border-success/20 bg-success-subtle/50 p-4 text-xs sm:text-sm space-y-2">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2 font-bold text-success-ink text-sm sm:text-base">
                                        <i className="ti ti-circle-check text-success" />
                                        <span>External Payment Recorded</span>
                                    </div>
                                    <div className="text-xs font-mono text-success-ink">
                                        Ref: {selected.payment_reference} · Date: {selected.payment_date}
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 py-2 border-y border-success/20 text-xs sm:text-sm">
                                    <div>
                                        <span className="text-slate-500 block text-[11px]">Gross Amount</span>
                                        <span className="font-mono font-bold text-slate-900">{php(selected.calculation.statutory_gross)}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block text-[11px]">Tax Withheld</span>
                                        <span className="font-mono font-bold text-danger-ink">{php(selected.tax_withheld)}</span>
                                    </div>
                                    <div>
                                        <span className="text-slate-500 block text-[11px]">Net Paid Out</span>
                                        <span className="font-mono font-bold text-success">{php(selected.net_paid)}</span>
                                    </div>
                                </div>
                                {selected.tax_review_note && (
                                    <p className="text-xs text-slate-600 whitespace-pre-wrap">
                                        <span className="font-semibold text-slate-700">Tax Review:</span> {selected.tax_review_note}
                                    </p>
                                )}
                                <div className="text-[11px] text-slate-500">
                                    Recorded on {selected.paid_at} by {selected.paid_by}.
                                </div>
                            </div>
                        )}

                        {selected.status === 'cancelled' && (
                            <div className="rounded-lg border border-danger/20 bg-danger-subtle/40 p-4 text-xs sm:text-sm text-danger-ink space-y-1">
                                <span className="font-bold flex items-center gap-1.5">
                                    <i className="ti ti-ban" />
                                    <span>Settlement Cancelled</span>
                                </span>
                                <p className="whitespace-pre-wrap break-words">{selected.cancellation_reason}</p>
                                <span className="text-[11px] text-slate-500 block">
                                    Cancelled at {selected.cancelled_at}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Action Triggers for Draft and Approved settlements */}
                    {['draft', 'approved'].includes(selected.status) && (
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                            {selected.status === 'draft' && (
                                <button
                                    className={primaryButtonClass}
                                    disabled={busy || !workflow.canApprove || !exitLinkReady}
                                    type="button"
                                    onClick={() => {
                                        setAction('approve');
                                        setReview({});
                                    }}
                                >
                                    <i className="ti ti-check text-base" />
                                    <span>Review and Approve</span>
                                </button>
                            )}

                            {selected.status === 'approved' && (
                                <button
                                    className={successButtonClass}
                                    disabled={busy || !workflow.canPay || !exitLinkReady}
                                    type="button"
                                    onClick={() => {
                                        setAction('payment');
                                        setReview({
                                            payment_date: getManilaWorkDate(),
                                            tax_withheld: '',
                                        });
                                    }}
                                >
                                    <i className="ti ti-cash text-base" />
                                    <span>Record Completed Payment</span>
                                </button>
                            )}

                            <button
                                type="button"
                                className={dangerButtonClass}
                                disabled={busy}
                                onClick={() => {
                                    setAction('cancel');
                                    setReview({});
                                }}
                            >
                                <i className="ti ti-x text-base" />
                                <span>Cancel Settlement</span>
                            </button>
                        </div>
                    )}

                    {/* Operational Action Review Forms */}
                    {action && ['draft', 'approved'].includes(selected.status) && (
                        <form
                            className="space-y-4 border-t border-slate-200 pt-4 bg-slate-50/50 p-4 rounded-lg"
                            onSubmit={(event) => {
                                event.preventDefault();
                                mutate(`/${selected.id}/${action}`, {
                                    ...review,
                                    expected_status: selected.status,
                                });
                            }}
                        >
                            {action === 'approve' && (
                                <>
                                    <div className="flex items-center gap-2 font-bold text-sm text-slate-900 border-b border-slate-200 pb-2">
                                        <i className="ti ti-shield-check text-accent text-base" />
                                        <span>HR Approval Verification</span>
                                    </div>
                                    <div className="space-y-2.5">
                                        {[
                                            [
                                                'coverage_confirmed',
                                                'General RA 7641 private-sector statutory retirement coverage verified.',
                                            ],
                                            [
                                                'rate_confirmed',
                                                'Latest basic wage or complete 12-month ADS and evidence verified.',
                                            ],
                                            [
                                                'retirement_confirmed',
                                                'Employee retirement age and service tenure verified against records.',
                                            ],
                                        ].map(([key, label]) => (
                                            <label
                                                key={key}
                                                className="flex gap-2.5 items-start text-xs sm:text-sm text-slate-700 cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    required
                                                    checked={Boolean(review[key])}
                                                    onChange={(event) =>
                                                        setReview((previous) => ({
                                                            ...previous,
                                                            [key]: event.target.checked,
                                                        }))
                                                    }
                                                    className="mt-0.5 accent-accent w-4 h-4 rounded cursor-pointer"
                                                />
                                                <span>{label}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <Field label="Eligibility Evidence & Calculation Review">
                                        <textarea
                                            className={inputClass}
                                            required
                                            rows={2}
                                            minLength={10}
                                            maxLength={1000}
                                            placeholder="Enter HR approval verification notes..."
                                            value={review.review_note || ''}
                                            onChange={(event) =>
                                                setReview((previous) => ({
                                                    ...previous,
                                                    review_note: event.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                </>
                            )}

                            {action === 'payment' && (
                                <>
                                    <div className="flex items-center gap-2 font-bold text-sm text-slate-900 border-b border-slate-200 pb-2">
                                        <i className="ti ti-cash text-success text-base" />
                                        <span>Record External Retirement Payment</span>
                                    </div>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <Field label="Actual Payment Date">
                                            <input
                                                className={inputClass}
                                                required
                                                type="date"
                                                min={selected.retirement_date}
                                                max={getManilaWorkDate()}
                                                value={review.payment_date || ''}
                                                onChange={(event) =>
                                                    setReview((previous) => ({
                                                        ...previous,
                                                        payment_date: event.target.value,
                                                    }))
                                                }
                                            />
                                        </Field>
                                        <Field label="Payment / Voucher Reference">
                                            <input
                                                className={inputClass}
                                                required
                                                maxLength={120}
                                                placeholder="e.g. Check #, BIR Form 2316 Ref, Voucher #..."
                                                value={review.payment_reference || ''}
                                                onChange={(event) =>
                                                    setReview((previous) => ({
                                                        ...previous,
                                                        payment_reference: event.target.value,
                                                    }))
                                                }
                                            />
                                        </Field>
                                    </div>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <Field label="Reviewed Tax Withheld (PHP)">
                                            <input
                                                className={inputClass}
                                                required
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                max={selected.calculation.statutory_gross}
                                                placeholder="0.00 if tax-exempt"
                                                value={review.tax_withheld}
                                                onChange={(event) =>
                                                    setReview((previous) => ({
                                                        ...previous,
                                                        tax_withheld: event.target.value,
                                                    }))
                                                }
                                            />
                                        </Field>
                                        <div className="p-3 bg-white rounded-md border border-slate-200 shadow-2xs flex flex-col justify-center">
                                            <span className="text-[11px] text-slate-500 font-medium">Net Recorded Payout</span>
                                            <span className="font-mono text-base font-bold text-success">
                                                {php(
                                                    Number(selected.calculation.statutory_gross) -
                                                    Number(review.tax_withheld || 0)
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                    <Field label="Tax-Review Evidence Note (including basis if tax exempt)">
                                        <textarea
                                            className={inputClass}
                                            required
                                            rows={2}
                                            minLength={10}
                                            maxLength={1000}
                                            placeholder="Specify BIR certificate, age 50 & 10-year tenure status, or tax deduction computation..."
                                            value={review.tax_review_note || ''}
                                            onChange={(event) =>
                                                setReview((previous) => ({
                                                    ...previous,
                                                    tax_review_note: event.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <label className="flex gap-2 items-start text-xs sm:text-sm text-slate-700 cursor-pointer">
                                        <input
                                            required
                                            type="checkbox"
                                            checked={Boolean(review.tax_review_confirmed)}
                                            onChange={(event) =>
                                                setReview((previous) => ({
                                                    ...previous,
                                                    tax_review_confirmed: event.target.checked,
                                                }))
                                            }
                                            className="mt-0.5 accent-accent w-4 h-4 rounded cursor-pointer"
                                        />
                                        <span>
                                            I confirm the external payment transaction, voucher reference, tax withholding assessment, and net amount.
                                        </span>
                                    </label>
                                </>
                            )}

                            {action === 'cancel' && (
                                <Field label="Reason for Cancelling Settlement">
                                    <textarea
                                        className={inputClass}
                                        required
                                        rows={2}
                                        minLength={10}
                                        maxLength={1000}
                                        placeholder="Explain reason for cancellation..."
                                        value={review.reason || ''}
                                        onChange={(event) =>
                                            setReview((previous) => ({
                                                ...previous,
                                                reason: event.target.value,
                                            }))
                                        }
                                    />
                                </Field>
                            )}

                            <div className="flex items-center gap-2 pt-2">
                                <button
                                    className={
                                        action === 'payment'
                                            ? successButtonClass
                                            : action === 'approve'
                                            ? primaryButtonClass
                                            : dangerButtonClass
                                    }
                                    disabled={busy || (action === 'approve' && (!workflow.canApprove || !exitLinkReady)) || (action === 'payment' && (!workflow.canPay || !exitLinkReady))}
                                >
                                    {busy ? (
                                        <>
                                            <i className="ti ti-loader-2 animate-spin text-sm" />
                                            <span>Processing…</span>
                                        </>
                                    ) : action === 'payment' ? (
                                        <>
                                            <i className="ti ti-check text-base" />
                                            <span>Confirm Payment Record</span>
                                        </>
                                    ) : action === 'approve' ? (
                                        <>
                                            <i className="ti ti-check text-base" />
                                            <span>Confirm Approval</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-ban text-base" />
                                            <span>Confirm Cancellation</span>
                                        </>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy}
                                    onClick={() => setAction(null)}
                                >
                                    Dismiss
                                </button>
                            </div>
                        </form>
                    )}
                </section>
            )}
        </div>
    );
}
