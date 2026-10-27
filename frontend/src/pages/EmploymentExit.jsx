import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { fetchWithAuth } from '../utils/api';
import { getStoredUser } from '../utils/storedUser.mjs';
import { createDisciplinaryMutation } from '../utils/disciplinaryMutation';
import { uploadEmployeeDocument } from '../utils/documentApi';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import { supabase } from '../supabaseClient';
import {
    EXIT_KINDS,
    EXIT_STATUSES,
    EXIT_SOURCES,
    EXIT_INPUT_LIMITS,
    EXIT_REVIEW_ACTIONS,
    exitPayload,
    RETIREMENT_PAY_STATUSES,
    getExitLifecycle,
    findOpenExitRequest,
    RETIREMENT_LETTER_ACCEPT,
    requiresRetirementLetter,
    retirementLetterDocumentId,
    validRetirementLetterFile,
} from '../../../shared/employmentExit.mjs';
import { getManilaWorkDate } from '../../../shared/workPolicy.mjs';
import { employmentTenure } from '../utils/employmentTenure.mjs';

const sourceHandbookUrl =
    'https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf';

const inputClass =
    'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent shadow-2xs';

const buttonClass =
    'h-8 px-3 bg-white hover:bg-slate-50 active:bg-slate-100 active:scale-[0.98] text-slate-700 rounded-md font-medium text-xs transition-all flex items-center justify-center gap-1.5 border border-slate-200 shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';

const primaryButtonClass =
    'h-8 px-3.5 bg-accent hover:bg-accent-hover active:bg-accent-hover active:scale-[0.98] text-white rounded-md font-medium text-xs transition-all shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';

const dangerButtonClass =
    'h-8 px-3.5 bg-danger hover:bg-danger-ink active:scale-[0.98] text-white rounded-md font-medium text-xs transition-all shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100';

const name = (employee) =>
    [employee?.first_name, employee?.last_name].filter(Boolean).join(' ') ||
    employee?.name ||
    employee?.employee_name ||
    'Unnamed Employee';

const timestamp = (value) =>
    value
        ? new Date(value).toLocaleString('en-PH', {
              timeZone: 'Asia/Manila',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          })
        : '—';

async function read(path, options) {
    const response = await fetchWithAuth('/api' + path, options);
    const data = await response.json();
    if (!response.ok)
        throw new Error(
            data.error ||
                'The outcome could not be confirmed. Refresh before retrying.'
        );
    return data;
}

function Field({ label, hint, required = false, children, className = '' }) {
    return (
        <label className={`block space-y-1 text-xs text-slate-700 ${className}`}>
            <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">
                    {label} {required && <span className="text-danger">*</span>}
                </span>
            </div>
            {children}
            {hint && <span className="block text-[11px] text-slate-400 font-normal">{hint}</span>}
        </label>
    );
}

function Check({ label, checked, onChange, required = false, description }) {
    return (
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer select-none group">
            <input
                type="checkbox"
                className="mt-0.5 rounded border-slate-300 text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer h-3.5 w-3.5 shrink-0 transition-colors"
                required={required}
                checked={checked || false}
                onChange={(event) => onChange(event.target.checked)}
            />
            <div className="space-y-0.5">
                <span className="font-medium text-slate-800 group-hover:text-slate-900 transition-colors">
                    {label}
                </span>
                {description && (
                    <span className="block text-[11px] text-slate-500">{description}</span>
                )}
            </div>
        </label>
    );
}

function StatusBadge({ status, reviewPending, withdrawalRequested }) {
    let colorClass = 'bg-slate-100 text-slate-600 border-slate-200';

    if (status === 'eligibility_verified' || status === 'notice_acknowledged') {
        colorClass = 'bg-success-subtle text-success-ink border-success/20';
    } else if (status === 'separated') {
        colorClass = 'bg-purple-50 text-purple-700 border-purple-200';
    } else if (status === 'withdrawn') {
        colorClass = 'bg-slate-100 text-slate-500 border-slate-200';
    } else if (status === 'needs_information' || status === 'eligibility_disputed') {
        colorClass = 'bg-warning-subtle text-warning-ink border-warning/20';
    } else if (status === 'received') {
        colorClass = 'bg-accent-subtle text-accent border-accent/20';
    }

    return (
        <div className="inline-flex flex-wrap items-center gap-1">
            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${colorClass}`}>
                {EXIT_STATUSES[status] || status}
            </span>
            {reviewPending && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    Review Pending
                </span>
            )}
            {withdrawalRequested && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                    Withdrawal Requested
                </span>
            )}
        </div>
    );
}

function KindBadge({ kind }) {
    let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';

    if (kind === 'retirement_review') {
        badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
    } else if (kind === 'early_retirement_inquiry') {
        badgeClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
    } else if (kind === 'resignation_notice') {
        badgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
    }

    return (
        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${badgeClass}`}>
            {EXIT_KINDS[kind] || kind}
        </span>
    );
}

export default function EmploymentExit({ manager = false }) {
    const actor = getStoredUser();
    const actorId = actor?.id;
    const separated = Boolean(actor?.archived_at || actor?.is_active === false ||
        ['terminated', 'resigned', 'separated', 'inactive'].includes(String(actor?.status).toLowerCase()));
    const client = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedKind = searchParams.get('request');
    const startKind = (manager || !separated) && Object.hasOwn(EXIT_KINDS, requestedKind) ? requestedKind : null;
    const request = useMemo(
        () => createDisciplinaryMutation(fetchWithAuth),
        []
    );
    const submissionLock = useRef(false);
    const requestPreparationLock = useRef(false);
    const reviewNoteRef = useRef(null);
    const [reviewFeedback, setReviewFeedback] = useState(null);
    const [retirementLetterFile, setRetirementLetterFile] = useState(null);
    const [uploadedLetter, setUploadedLetter] = useState(null);
    const [preparingRequest, setPreparingRequest] = useState(false);
    const [previewReceiptId, setPreviewReceiptId] = useState(null);
    const [workDate, setWorkDate] = useState(getManilaWorkDate);
    useEffect(() => {
        const timer = setInterval(() => setWorkDate(getManilaWorkDate()), 60_000);
        return () => clearInterval(timer);
    }, []);
    const [activeTab, setActiveTab] = useState(startKind ? 'new' : 'register');
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState('all');
    const [selectedId, setSelectedId] = useState(searchParams.get('id') || null);
    const [formVersion, setFormVersion] = useState(null);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState({
        kind: startKind || 'retirement_review',
        requested_date: getManilaWorkDate(),
        source: manager ? 'hr_assisted' : 'employee_app',
        note: '',
        evidence_reference: '',
        received_at: '',
        consent_confirmed: false,
    });
    const [search, setSearch] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [employee, setEmployee] = useState(null);
    const [review, setReview] = useState({
        finding: 'needs_information',
        effective_date: getManilaWorkDate(),
        note: '',
        notice_basis: 'standard_notice',
    });
    const [response, setResponse] = useState({ action: 'reply', note: '' });
    const [separationConfirmed, setSeparationConfirmed] = useState(false);

    const change = (key, value) =>
        setForm((previous) => ({ ...previous, [key]: value }));
    const reviewChange = (key, value) => {
        setReviewFeedback(null);
        setReview((previous) => ({ ...previous, [key]: value }));
    };

    useEffect(() => {
        const timer = setTimeout(() => setSearchTerm(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const register = useQuery({
        queryKey: ['employmentExit', actorId, manager, status, page],
        queryFn: ({ signal }) =>
            read(`/employment-exit?page=${page}&status=${status}`, { signal }),
        staleTime: 10_000,
        refetchInterval: 30_000,
        retry: 1,
    });

    const detail = useQuery({
        queryKey: ['employmentExitDetail', actorId, selectedId],
        enabled: Boolean(selectedId),
        queryFn: ({ signal }) =>
            read('/employment-exit/' + selectedId, { signal }),
        staleTime: 10_000,
        refetchInterval: 30_000,
        retry: 1,
    });

    const openRequests = useQuery({
        queryKey: ['employmentExitOpen', actorId, manager ? employee?.id : actorId],
        enabled: Boolean(actorId && (!manager || employee?.id)),
        queryFn: ({ signal }) => read('/employment-exit/open' + (manager ? '?employee_id=' + encodeURIComponent(employee.id) : ''), { signal }),
        staleTime: 10_000,
        refetchInterval: 30_000,
        retry: 1,
    });
    const blockedRequest = findOpenExitRequest(openRequests.data?.data, form.kind);
    const letterPreview = useQuery({
        queryKey: ['employmentExitLetter', actorId, previewReceiptId],
        enabled: Boolean(previewReceiptId),
        queryFn: ({ signal }) => read('/employment-exit/' + previewReceiptId + '/retirement-letter', { signal }),
        retry: 1,
    });

    const employees = useQuery({
        queryKey: ['exitEmployeeSearch', actorId, searchTerm],
        enabled: manager && searchTerm.trim().length >= 2,
        queryFn: ({ signal }) =>
            read(
                '/retirement-pay/employees?search=' +
                    encodeURIComponent(searchTerm),
                { signal }
            ),
        staleTime: 30_000,
        retry: 1,
    });

    const receipt = detail.data?.record;
    // Initialize a deep-linked case once; later revisions still require an explicit reload.
    if (receipt && formVersion === null && !detail.isFetching) {
        setFormVersion(receipt.version);
        setReview(previous => ({ ...previous, effective_date: receipt.effective_date || receipt.requested_date, notice_basis: receipt.notice_basis || 'standard_notice' }));
    }
    const lifecycle = getExitLifecycle(receipt, workDate);
    const isOwner = receipt?.employee_id === actorId;
    const staleReceipt = Boolean(receipt && receipt.version !== formVersion);

    const openReceipt = useCallback((item) => {
        setReviewFeedback(null);
        setSelectedId(item.id);
        setFormVersion(item.version);
        setSeparationConfirmed(false);
        setResponse({ action: 'reply', note: '' });
        setReview({
            finding: 'needs_information',
            effective_date: item.effective_date || item.requested_date,
            note: '',
            notice_basis: item.notice_basis || 'standard_notice',
        });
        if (searchParams.get('id') !== item.id) {
            setSearchParams({ id: item.id }, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    if (activeTab === 'register' && !selectedId && register.data?.data?.length > 0) {
        setSelectedId(register.data.data[0].id);
    }
    useEffect(() => {
        if (activeTab === 'register' && selectedId && searchParams.get('id') !== selectedId) {
            setSearchParams({ id: selectedId }, { replace: true });
        }
    }, [selectedId, activeTab, searchParams, setSearchParams]);

    const refresh = () =>
        Promise.all([
            client.invalidateQueries({ queryKey: ['employmentExit', actorId] }),
            client.invalidateQueries({ queryKey: ['employmentExitOpen', actorId] }),
            client.invalidateQueries({
                queryKey: ['employmentExitDetail', actorId],
            }),
        ]);

    useEffect(() => {
        const update = () => {
            client.invalidateQueries({ queryKey: ['employmentExit', actorId] });
            client.invalidateQueries({ queryKey: ['employmentExitOpen', actorId] });
            client.invalidateQueries({
                queryKey: ['employmentExitDetail', actorId],
            });
        };
        const channel = supabase
            .channel(
                manager ? 'employment-exit-hr' : 'employment-exit-' + actorId,
                { config: { private: true } }
            )
            .on('broadcast', { event: 'EXIT_CHANGED' }, update)
            .subscribe((state) => {
                if (state === 'SUBSCRIBED') update();
            });
        return () => {
            supabase.removeChannel(channel);
        };
    }, [actorId, manager, client]);

    async function mutate(path, body) {
        if (submissionLock.current) return false;
        if (path && staleReceipt) {
            toast.error(
                'The receipt changed. Load the latest revision and review it before submitting.'
            );
            return false;
        }
        setReviewFeedback(null);
        submissionLock.current = true;
        setBusy(true);
        try {
            const res = await request('/api/employment-exit' + path, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const result = await res.json();
            if (!res.ok)
                throw new Error(
                    result.error ||
                        'The outcome could not be confirmed. Refresh and retry the same request.'
                );
            setSelectedId(result.record.id);
            if (!path) setSearchParams({ id: result.record.id }, { replace: true });
            setFormVersion(result.record.version);
            setReview({
                finding: ['withdrawn', 'separated'].includes(result.record.status) ? 'response' : result.action === 'review' ? body.finding : 'needs_information',
                effective_date:
                    result.record.effective_date ||
                    result.record.requested_date,
                note: '',
                notice_basis: result.record.notice_basis || 'standard_notice',
            });
            setResponse({ action: 'reply', note: '' });
            setSeparationConfirmed(false);
            await refresh();
            if (result.action === 'separate') {
                for (const key of [
                    'adminEmployees',
                    'employeeDetails',
                    'dashboard',
                    'retirementEmployees',
                ])
                    client.invalidateQueries({ queryKey: [key] });
            }
            toast.success(
                result.replayed
                    ? 'Previously saved action confirmed.'
                    : 'Receipt updated.'
            );
            return true;
        } catch (error) {
            toast.error(error.message);
            if (path.endsWith('/review')) setReviewFeedback({ type: 'error', message: error.message });
            await refresh();
            return false;
        } finally {
            submissionLock.current = false;
            setBusy(false);
        }
    }

    async function submitHrFinding(event) {
        event.preventDefault();
        if (submissionLock.current) return;
        setReviewFeedback(null);
        if (staleReceipt) {
            setReviewFeedback({ type: 'error', message: 'This case changed. Reload the current revision before saving your finding.' });
            return;
        }
        const body = { ...review, finding, version: formVersion };
        try {
            exitPayload(body, 'review');
        } catch (error) {
            setReviewFeedback({ type: 'error', message: review.note.trim().length < 10 ? 'Write an HR explanation of at least 10 characters before saving.' : error.message });
            reviewNoteRef.current?.focus();
            return;
        }
        if (!event.currentTarget.reportValidity()) {
            setReviewFeedback({ type: 'error', message: 'Complete the highlighted date or required confirmations before saving.' });
            return;
        }
        const saved = await mutate('/' + receipt.id + '/review', body);
        if (saved) {
            const status = finding === 'response' ? receipt.status : finding;
            setReviewFeedback({ type: 'success', message: EXIT_REVIEW_ACTIONS[finding].success + ' Status: ' + EXIT_STATUSES[status] + '.' });
        }
    }

    async function submitRequest(event) {
        event.preventDefault();
        if (requestPreparationLock.current || submissionLock.current) return;
        if (manager && !employee) {
            toast.error('Select an employee first.');
            return;
        }
        const needsLetter = requiresRetirementLetter(form.kind, form.source);
        if (needsLetter && !uploadedLetter && !validRetirementLetterFile(retirementLetterFile?.name, retirementLetterFile?.size)) {
            toast.error('Choose your retirement letter: PDF, Word, JPG or PNG, up to 10 MB.');
            return;
        }
        requestPreparationLock.current = true;
        setPreparingRequest(true);
        try {
            const current = await openRequests.refetch({ throwOnError: true });
            if (!Array.isArray(current.data?.data)) throw new Error('Open requests could not be verified. Refresh and try again.');
            const existing = findOpenExitRequest(current.data.data, form.kind);
            if (existing) {
                openReceipt(existing);
                setActiveTab('register');
                toast.error('An open case already exists. Add your message to that case for HR review.');
                return;
            }
            let letter = uploadedLetter;
            if (needsLetter && !letter) {
                letter = await uploadEmployeeDocument({
                    employeeId: actorId,
                    file: retirementLetterFile,
                    title: 'Retirement Letter',
                    category: 'Other',
                    documentType: 'Retirement Letter',
                });
                if (!letter?.id) throw new Error('The letter upload could not be confirmed. No retirement request was sent.');
                setUploadedLetter(letter);
            }
            const body = {
                ...form,
                ...(needsLetter ? { retirement_letter_document_id: String(letter.id) } : {}),
                ...(manager ? {
                    employee_id: employee.id,
                    received_at: new Date(form.received_at).toISOString(),
                } : {}),
            };
            if (await mutate('', body)) {
                setForm(previous => ({ ...previous, note: '', consent_confirmed: false }));
                setRetirementLetterFile(null);
                setUploadedLetter(null);
                if (manager) setEmployee(null);
                setActiveTab('register');
            }
        } catch (error) {
            toast.error(error.message || 'The retirement letter upload failed. No request was sent.');
        } finally {
            requestPreparationLock.current = false;
            setPreparingRequest(false);
        }
    }



    const tenure = employmentTenure(
        receipt?.employee_snapshot?.date_hired,
        receipt?.effective_date || receipt?.requested_date
    );
    const retirementLetterId = requiresRetirementLetter(receipt?.kind, receipt?.source)
        ? retirementLetterDocumentId(receipt?.evidence_reference) : null;
    const responseAction =
        receipt?.status === 'separated' ? 'review-request' : response.action;
    const finding = ['withdrawn', 'separated'].includes(receipt?.status)
        ? 'response'
        : review.finding;
    const approvedFinding = [
        'eligibility_verified',
        'notice_acknowledged',
    ].includes(review.finding);

    return (
        <div className="w-full pb-20 font-sans space-y-4">
            <PageHeader
                breadcrumbs={
                    manager
                        ? ['Admin', 'Employees', 'Employment Exit']
                        : ['Self Service', 'Exit & Retirement']
                }
                actions={
                    <div className="flex items-center gap-2 flex-wrap">
                        <a
                            href={sourceHandbookUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonClass}
                            title="DOLE Workers' Statutory Monetary Benefits Handbook"
                        >
                            <i className="ti ti-book text-slate-500" />
                            <span className="hidden sm:inline">DOLE Handbook</span>
                        </a>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={busy || register.isFetching}
                            onClick={() => refresh()}
                            title="Refresh data"
                        >
                            <i
                                className={`ti ti-refresh ${
                                    register.isFetching ? 'animate-spin' : ''
                                }`}
                            />
                            <span>Refresh</span>
                        </button>
                        {(!separated || manager) && (
                            <button
                                type="button"
                                className={activeTab === 'new' ? buttonClass : primaryButtonClass}
                                onClick={() =>
                                    setActiveTab(activeTab === 'new' ? 'register' : 'new')
                                }
                            >
                                <i className={`ti ${activeTab === 'new' ? 'ti-arrow-left' : 'ti-plus'}`} />
                                <span>
                                    {activeTab === 'new'
                                        ? 'Back to Register'
                                        : manager
                                        ? 'Record Assisted Exit'
                                        : 'File Exit Request'}
                                </span>
                            </button>
                        )}
                    </div>
                }
            />

            {/* TAB 1: NEW SUBMISSION (Focused & Uncluttered) */}
            {activeTab === 'new' && (!separated || manager) && (
                <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-lg shadow-2xs p-5 sm:p-6 space-y-4">
                    <div className="border-b border-slate-100 pb-3">
                        <h2 className="text-base font-bold text-slate-900">
                            {manager ? 'Record Assisted Exit Submission' : 'Submit Exit Request'}
                        </h2>
                    </div>

                    <form
                        className="space-y-4"
                        onSubmit={submitRequest}
                    >
                        {manager && (
                            <div className="space-y-2">
                                <Field
                                    label="Employee"
                                    required
                                    hint="Minimum 2 characters"
                                >
                                    <div className="relative">
                                        <i className="ti ti-search text-slate-400 absolute left-3 top-2 text-sm" />
                                        <input
                                            className={`${inputClass} pl-8`}
                                            placeholder="Search by name or company ID..."
                                            value={search}
                                            maxLength={EXIT_INPUT_LIMITS.search}
                                            onChange={(event) => {
                                                setSearch(event.target.value);
                                                setEmployee(null);
                                            }}
                                        />
                                    </div>
                                </Field>

                                {employees.isFetching && (
                                    <p className="text-xs text-slate-400">Searching...</p>
                                )}

                                {!employee && employees.data?.data?.length > 0 && (
                                    <div className="border border-slate-200 rounded-md max-h-48 overflow-y-auto divide-y divide-slate-100 bg-white">
                                        {employees.data.data.map((item) => (
                                            <button
                                                type="button"
                                                key={item.id}
                                                onClick={() => {
                                                    setEmployee(item);
                                                    setSearch('');
                                                }}
                                                className="w-full flex items-center justify-between p-2 hover:bg-slate-50 text-left text-xs cursor-pointer"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <EmployeeAvatar
                                                        employee={item}
                                                        size="h-7 w-7"
                                                        rounded="rounded-full"
                                                    />
                                                    <div>
                                                        <p className="font-semibold text-slate-800">{name(item)}</p>
                                                        <p className="text-[10px] text-slate-400">{item.company_id || 'No ID'}</p>
                                                    </div>
                                                </div>
                                                <span className="text-[11px] text-slate-400">Hired: {item.date_hired || '—'}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {employee && (
                                    <div className="flex items-center justify-between p-2.5 rounded-md border border-accent/30 bg-blue-50/50">
                                        <div className="flex items-center gap-2.5">
                                            <EmployeeAvatar
                                                employee={employee}
                                                size="h-8 w-8"
                                                rounded="rounded-full"
                                            />
                                            <div className="text-xs">
                                                <p className="font-bold text-slate-800">{name(employee)}</p>
                                                <p className="text-[11px] text-slate-500">ID: {employee.company_id || 'N/A'} · Hired: {employee.date_hired || '—'}</p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setEmployee(null)}
                                            className="text-xs font-semibold text-accent hover:underline cursor-pointer"
                                        >
                                            Change
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="grid sm:grid-cols-2 gap-3">
                            <Field label="Submission Type" required>
                                <select
                                    className={inputClass}
                                    value={form.kind}
                                    onChange={(event) =>
                                        change('kind', event.target.value)
                                    }
                                >
                                    {Object.entries(EXIT_KINDS).map(
                                        ([value, label]) => (
                                            <option key={value} value={value} disabled={Boolean(findOpenExitRequest(openRequests.data?.data, value))}>
                                                {label}{findOpenExitRequest(openRequests.data?.data, value) ? ' (case already open)' : ''}
                                            </option>
                                        )
                                    )}
                                </select>
                            </Field>

                            <Field label="Proposed Effective Date" required>
                                <input
                                    type="date"
                                    required
                                    min="1900-01-01"
                                    max="2200-12-31"
                                    className={inputClass}
                                    value={form.requested_date}
                                    onChange={(event) =>
                                        change(
                                            'requested_date',
                                            event.target.value
                                        )
                                    }
                                />
                            </Field>

                            {manager && (
                                <>
                                    <Field label="Original Source" required>
                                        <select
                                            className={inputClass}
                                            value={form.source}
                                            onChange={(event) =>
                                                change(
                                                    'source',
                                                    event.target.value
                                                )
                                            }
                                        >
                                            {Object.entries(EXIT_SOURCES)
                                                .filter(
                                                    ([value]) =>
                                                        value !== 'employee_app'
                                                )
                                                .map(([value, label]) => (
                                                    <option
                                                        key={value}
                                                        value={value}
                                                    >
                                                        {label}
                                                    </option>
                                                ))}
                                        </select>
                                    </Field>

                                    <Field label="Original Received Date/Time" required>
                                        <input
                                            type="datetime-local"
                                            required
                                            min="1900-01-01T00:00"
                                            max="2200-12-31T23:59"
                                            className={inputClass}
                                            value={form.received_at}
                                            onChange={(event) =>
                                                change(
                                                    'received_at',
                                                    event.target.value
                                                )
                                            }
                                        />
                                    </Field>

                                    <Field
                                        label="Evidence Reference"
                                        required
                                        hint={`${form.evidence_reference.length}/${EXIT_INPUT_LIMITS.evidence} characters`}
                                        className="sm:col-span-2"
                                    >
                                        <textarea
                                            required
                                            minLength={10}
                                            maxLength={EXIT_INPUT_LIMITS.evidence}
                                            rows={2}
                                            placeholder="e.g., Signed paper letter received in HR office; scanned to archive ref #402."
                                            className={inputClass}
                                            value={form.evidence_reference}
                                            onChange={(event) =>
                                                change(
                                                    'evidence_reference',
                                                    event.target.value
                                                )
                                            }
                                        />
                                    </Field>
                                </>
                            )}
                        </div>

                        {blockedRequest && (
                            <div role="status" className="text-sm bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2">
                                <p>{blockedRequest.kind === 'resignation_notice' ? 'An open resignation notice already exists.' : 'An open retirement case already exists. Resignation remains available.'}</p>
                                <button type="button" className="font-semibold text-accent underline" onClick={() => { openReceipt(blockedRequest); setActiveTab('register'); }}>Open existing case</button>
                                {blockedRequest.kind !== 'resignation_notice' && !findOpenExitRequest(openRequests.data?.data, 'resignation_notice') && <button type="button" className="ml-3 font-semibold text-accent underline" onClick={() => change('kind', 'resignation_notice')}>Choose resignation notice</button>}
                            </div>
                        )}
                        {openRequests.isError && (
                            <p role="alert" className="text-sm text-danger">Open-case verification failed. Submission unavailable until refresh succeeds.</p>
                        )}

                        {requiresRetirementLetter(form.kind, form.source) && !blockedRequest && (
                            <Field label="Retirement Letter" required hint="PDF, Word, JPG or PNG · maximum 10 MB">
                                <input
                                    type="file"
                                    accept={RETIREMENT_LETTER_ACCEPT}
                                    required={!retirementLetterFile && !uploadedLetter}
                                    disabled={busy || preparingRequest}
                                    className={inputClass}
                                    onChange={event => {
                                        setRetirementLetterFile(event.target.files?.[0] || null);
                                        setUploadedLetter(null);
                                    }}
                                />
                                {(uploadedLetter || retirementLetterFile) && (
                                    <p className="text-xs text-slate-600 mt-1 [overflow-wrap:anywhere]">
                                        {uploadedLetter ? 'Uploaded: ' : 'Selected: '}{uploadedLetter?.file_name || retirementLetterFile?.name}
                                    </p>
                                )}
                            </Field>
                        )}

                        <Field label="Remarks / Explanation (Optional)" hint={`${form.note.length}/${EXIT_INPUT_LIMITS.note} characters`}>
                            <textarea
                                className={inputClass}
                                rows={2}
                                maxLength={EXIT_INPUT_LIMITS.note}
                                placeholder="Additional details or context..."
                                value={form.note}
                                onChange={(event) =>
                                    change('note', event.target.value)
                                }
                            />
                        </Field>

                        <div className="pt-1">
                            <Check
                                required
                                checked={form.consent_confirmed}
                                onChange={(value) =>
                                    change('consent_confirmed', value)
                                }
                                label={
                                    manager
                                        ? 'I verified this genuine employee submission and retained physical/email evidence.'
                                        : 'I confirm this is my genuine submission and understand the selected type.'
                                }
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                className={buttonClass}
                                onClick={() => setActiveTab('register')}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className={primaryButtonClass}
                                disabled={busy || preparingRequest || Boolean(blockedRequest) || openRequests.isPending || openRequests.isError || (manager && !employee)}
                            >
                                <i className="ti ti-check" />
                                <span>{preparingRequest ? 'Uploading / submitting...' : 'Submit Request'}</span>
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* TAB 2: REGISTER & DETAIL WORKBENCH */}
            {activeTab === 'register' && (
                <div className="grid lg:grid-cols-12 gap-4 items-start">
                    {/* Left Panel: Register List */}
                    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
                        <div className="p-3 border-b border-slate-100 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs sm:text-sm text-slate-800">
                                    {manager ? 'Submissions' : 'My Requests'}
                                </span>
                                <span className="text-[11px] font-mono text-slate-400">
                                    ({register.data?.total || register.data?.data?.length || 0})
                                </span>
                            </div>

                            <select
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-accent"
                                value={status}
                                onChange={(event) => {
                                    setStatus(event.target.value);
                                    setPage(1);
                                }}
                            >
                                <option value="all">All Statuses</option>
                                {Object.entries({
                                    ...EXIT_STATUSES,
                                    review_pending: 'Review Pending',
                                }).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {register.isError ? (
                            <p className="p-4 text-xs text-danger">{register.error.message}</p>
                        ) : register.isPending ? (
                            <div className="p-8 text-center text-xs text-slate-400">Loading...</div>
                        ) : !register.data?.data?.length ? (
                            <div className="p-8 text-center text-slate-400 space-y-2">
                                <i className="ti ti-inbox text-3xl block text-slate-300" />
                                <p className="text-xs">No exit records found.</p>
                                {(!separated || manager) && (
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('new')}
                                        className="text-xs font-semibold text-accent hover:underline cursor-pointer"
                                    >
                                        + Submit a request
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {register.data.data.map((item) => {
                                    const isSelected = selectedId === item.id;
                                    return (
                                        <button
                                            type="button"
                                            key={item.id}
                                            onClick={() => openReceipt(item)}
                                            className={`w-full text-left p-3 transition-colors cursor-pointer block ${
                                                isSelected
                                                    ? 'bg-blue-50/60 border-l-3 border-l-accent'
                                                    : 'hover:bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    {manager && (
                                                        <p className="font-semibold text-xs text-slate-900 truncate">
                                                            {name(item.employee_snapshot)}
                                                        </p>
                                                    )}
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <KindBadge kind={item.kind} />
                                                        <StatusBadge
                                                            status={item.status}
                                                            reviewPending={item.review_pending}
                                                            withdrawalRequested={item.withdrawal_requested}
                                                        />
                                                    </div>
                                                </div>
                                                <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
                                                    {item.requested_date}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}

                                <div className="p-2.5 flex items-center justify-between text-xs text-slate-500 bg-slate-50/50">
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={page === 1}
                                        onClick={() => setPage(page - 1)}
                                    >
                                        Prev
                                    </button>
                                    <span className="text-[11px]">
                                        Page {page} of {Math.max(1, Math.ceil((register.data?.total || 0) / 25))}
                                    </span>
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        disabled={page * 25 >= (register.data?.total || 0)}
                                        onClick={() => setPage(page + 1)}
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Panel: Selected Receipt Details & Actions */}
                    <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg shadow-2xs p-4 sm:p-5 space-y-4">
                        {detail.isError ? (
                            <p className="text-xs text-danger">{detail.error.message}</p>
                        ) : !selectedId ? (
                            <div className="py-16 text-center text-slate-400 space-y-1">
                                <i className="ti ti-file-search text-3xl text-slate-300 block" />
                                <p className="text-xs font-medium">No submission selected.</p>
                            </div>
                        ) : detail.isPending || !receipt || formVersion === null ? (
                            <div className="py-16 text-center text-xs text-slate-400">Loading details...</div>
                        ) : (
                            <>
                                {staleReceipt && (
                                    <div
                                        role="alert"
                                        className="rounded-md border border-amber-300 bg-amber-50 p-2.5 flex items-center justify-between text-xs text-amber-900"
                                    >
                                        <span>Receipt changed concurrently.</span>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            onClick={() => openReceipt(receipt)}
                                        >
                                            Reload Revision
                                        </button>
                                    </div>
                                )}

                                {/* Header Row */}
                                <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                                    <div className="flex items-center gap-3">
                                        <EmployeeAvatar
                                            employee={receipt.employee_snapshot}
                                            size="h-10 w-10"
                                            rounded="rounded-md"
                                        />
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-bold text-sm sm:text-base text-slate-900">
                                                    {name(receipt.employee_snapshot)}
                                                </h3>
                                                <KindBadge kind={receipt.kind} />
                                            </div>
                                            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                                                ID: {receipt.employee_snapshot?.company_id || 'N/A'} · Rev v{receipt.version}
                                            </p>
                                        </div>
                                    </div>
                                    <StatusBadge
                                        status={receipt.status}
                                        reviewPending={receipt.review_pending}
                                        withdrawalRequested={receipt.withdrawal_requested}
                                    />
                                </div>

                                {/* Key-Value Details Row */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-2 text-xs">
                                    <div>
                                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                                            Proposed Date
                                        </span>
                                        <span className="font-semibold text-slate-800 mt-0.5 block">
                                            {receipt.requested_date}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                                            Effective Date
                                        </span>
                                        <span className="font-semibold text-slate-800 mt-0.5 block">
                                            {receipt.effective_date || 'Pending Review'}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                                            Service Tenure
                                        </span>
                                        <span className="font-semibold text-slate-800 mt-0.5 block">
                                            {tenure ? `${tenure.years}y ${tenure.months}m` : '—'}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
                                            Source Channel
                                        </span>
                                        <span className="font-semibold text-slate-800 mt-0.5 block">
                                            {EXIT_SOURCES[receipt.source] || receipt.source}
                                        </span>
                                    </div>
                                </div>

                                {/* Evidence Reference (if present) */}
                                <div role="status" className="text-xs bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1">
                                    <p className="font-semibold text-slate-800">{lifecycle.label}</p>
                                </div>
                                {retirementLetterId && (
                                    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs space-y-2">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-8 h-8 rounded-md bg-accent-subtle/80 text-accent flex items-center justify-center shrink-0 border border-accent/15">
                                                    <i className="ti ti-file-certificate text-base" />
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                                                        Attached Document
                                                    </span>
                                                    <p className="text-xs font-semibold text-slate-800 truncate">
                                                        Formal Retirement Letter
                                                    </p>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                disabled={letterPreview.isFetching}
                                                onClick={() => {
                                                    setPreviewReceiptId(receipt.id);
                                                    if (previewReceiptId === receipt.id) letterPreview.refetch();
                                                }}
                                                className="w-full sm:w-auto h-8 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md border border-slate-200 bg-white text-slate-700 hover:text-accent hover:border-accent/40 hover:bg-accent-subtle/40 active:scale-[0.98] shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shrink-0"
                                                aria-label="Open retirement letter preview"
                                            >
                                                {letterPreview.isFetching && previewReceiptId === receipt.id ? (
                                                    <>
                                                        <i className="ti ti-loader-2 animate-spin text-accent text-sm" />
                                                        <span>Opening letter...</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <i className="ti ti-file-text text-accent text-sm" />
                                                        <span>Open retirement letter</span>
                                                        <i className="ti ti-external-link text-slate-400 text-xs ml-0.5" />
                                                    </>
                                                )}
                                            </button>
                                        </div>

                                        {previewReceiptId === receipt.id && letterPreview.isError && (
                                            <p role="alert" className="text-xs text-danger font-medium flex items-center gap-1 pt-1.5 border-t border-slate-100">
                                                <i className="ti ti-alert-circle text-xs shrink-0" />
                                                <span>{letterPreview.error.message}</span>
                                            </p>
                                        )}
                                    </div>
                                )}
                                {receipt.evidence_reference && !retirementLetterId && (
                                    <div className="text-xs bg-slate-50 border border-slate-200/80 rounded-md p-2.5 space-y-0.5">
                                        <span className="font-semibold text-slate-600 block">Source Evidence Reference:</span>
                                        <p className="text-slate-700 whitespace-pre-wrap [overflow-wrap:anywhere]">{receipt.evidence_reference}</p>
                                    </div>
                                )}

                                {/* Latest HR Note (if present) */}
                                {receipt.review_note && (
                                    <div className="text-xs bg-blue-50/50 border border-blue-200/70 rounded-md p-2.5 space-y-0.5">
                                        <span className="font-semibold text-blue-900 block">Latest HR Determination:</span>
                                        <p className="text-blue-800 whitespace-pre-wrap [overflow-wrap:anywhere]">{receipt.review_note}</p>
                                    </div>
                                )}

                                {/* Collapsible Audit History */}
                                <details className="text-xs border-t border-slate-100 pt-2.5 group">
                                    <summary className="font-semibold text-slate-600 hover:text-slate-900 cursor-pointer select-none flex items-center justify-between py-1">
                                        <span>Audit History ({detail.data?.events?.length || 0} events)</span>
                                        <i className="ti ti-chevron-down text-slate-400 group-open:rotate-180 transition-transform" />
                                    </summary>
                                    <div className="mt-2.5 pl-3 border-l-2 border-slate-200 space-y-2 text-xs">
                                        {detail.data?.events?.map((ev) => (
                                            <div key={ev.id} className="space-y-0.5">
                                                <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                                                    <span className={`px-1.5 py-0.2 rounded font-semibold uppercase text-[9px] ${ev.actor_id === receipt.employee_id ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-800'}`}>
                                                        {ev.actor_id === receipt.employee_id ? 'Employee' : 'HR'}
                                                    </span>
                                                    <span className="capitalize font-medium text-slate-700">{ev.action.replaceAll('_', ' ')}</span>
                                                    <span>·</span>
                                                    <span>{timestamp(ev.created_at)}</span>
                                                </div>
                                                {ev.note && <p className="text-slate-600 bg-slate-50 p-1.5 rounded whitespace-pre-wrap [overflow-wrap:anywhere]">{ev.note}</p>}
                                            </div>
                                        ))}
                                    </div>
                                </details>

                                {/* Employee Response Action */}
                                {isOwner && receipt.status !== 'withdrawn' && (
                                    <form
                                        className="space-y-3 pt-3 border-t border-slate-100"
                                        onSubmit={async (event) => {
                                            event.preventDefault();
                                            if (
                                                await mutate(
                                                    '/' +
                                                        receipt.id +
                                                        '/' +
                                                        responseAction,
                                                    {
                                                        version: formVersion,
                                                        note: response.note,
                                                    }
                                                )
                                            )
                                                setResponse((previous) => ({
                                                    ...previous,
                                                    note: '',
                                                }));
                                        }}
                                    >
                                        <span className="font-bold text-xs text-slate-800 block">
                                            Add Note or Request Review
                                        </span>

                                        <div className="grid sm:grid-cols-2 gap-2">
                                            <Field label="Action">
                                                <select
                                                    className={inputClass}
                                                    value={responseAction}
                                                    onChange={(event) =>
                                                        setResponse((previous) => ({
                                                            ...previous,
                                                            action: event.target.value,
                                                        }))
                                                    }
                                                >
                                                    {receipt.status !== 'separated' && (
                                                        <option value="reply">Add information</option>
                                                    )}
                                                    <option value="review-request">Request review of finding</option>
                                                    {receipt.status !== 'separated' && (
                                                        <option value="withdrawal-request">Ask HR to review withdrawal</option>
                                                    )}
                                                </select>
                                            </Field>
                                        </div>

                                        <Field label="Explanation" required hint={`${response.note.length}/${EXIT_INPUT_LIMITS.note} characters`}>
                                            <textarea
                                                required
                                                minLength={10}
                                                maxLength={EXIT_INPUT_LIMITS.note}
                                                rows={2}
                                                placeholder="Provide details or reasoning..."
                                                className={inputClass}
                                                value={response.note}
                                                onChange={(event) =>
                                                    setResponse((previous) => ({
                                                        ...previous,
                                                        note: event.target.value,
                                                    }))
                                                }
                                            />
                                        </Field>

                                        <div className="flex justify-end">
                                            <button
                                                type="submit"
                                                className={primaryButtonClass}
                                                disabled={busy || staleReceipt}
                                            >
                                                Send to HR
                                            </button>
                                        </div>
                                    </form>
                                )}

                                {/* Manager Actions */}
                                {manager && (
                                    <div className="space-y-3 pt-3 border-t border-slate-100">
                                        {/* Retirement Pay link */}
                                        {receipt.kind === 'retirement_review' &&
                                            (receipt.retirement_settlement_id ||
                                                (['eligibility_verified', 'separated'].includes(receipt.status) &&
                                                !receipt.review_pending && !receipt.withdrawal_requested)) && (
                                                <div className="p-2.5 rounded-md border border-accent/20 bg-accent-subtle flex items-center justify-between text-xs">
                                                    <div>
                                                        <span className="font-bold text-slate-900 block">{RETIREMENT_PAY_STATUSES[receipt.retirement_status] || 'Retirement calculation ready'}</span>
                                                        <span className="text-[11px] text-slate-500">{receipt.review_pending || receipt.withdrawal_requested ? 'Case follow-up pending. The saved calculation remains available for review.' : receipt.retirement_settlement_id ? 'Linked to this exit case. Open the saved record and its next step.' : 'Employee and confirmed date will be filled automatically.'}</span>
                                                    </div>
                                                    <Link
                                                        to={'/admin/payroll/retirement?exit_request_id=' + receipt.id}
                                                        className="px-2.5 py-1 bg-accent text-white rounded text-xs font-semibold hover:bg-accent-hover inline-flex items-center gap-1 shadow-2xs"
                                                    >
                                                        <span>{receipt.retirement_settlement_id ? 'View Retirement Pay' : 'Prepare Retirement Pay'}</span>
                                                        <i className="ti ti-arrow-right text-xs" />
                                                    </Link>
                                                </div>
                                            )}

                                        {/* Record HR Finding Form */}
                                        <form
                                            noValidate
                                            className="space-y-3 bg-slate-50/50 p-3 rounded-md border border-slate-200"
                                            onSubmit={submitHrFinding}
                                        >
                                            <span className="font-bold text-xs text-slate-800 block">
                                                Record HR Finding
                                            </span>

                                            <div className="grid sm:grid-cols-2 gap-2">
                                                <Field label="Finding" required>
                                                    <select
                                                        className={inputClass}
                                                        value={finding}
                                                        onChange={(event) =>
                                                            reviewChange('finding', event.target.value)
                                                        }
                                                    >
                                                        {!['withdrawn', 'separated'].includes(receipt.status) && (
                                                            <>
                                                                <option value="needs_information">Request more information</option>
                                                                {receipt.kind === 'resignation_notice' ? (
                                                                    <option value="notice_acknowledged">Acknowledge resignation notice</option>
                                                                ) : (
                                                                    <>
                                                                        {receipt.kind === 'retirement_review' && (
                                                                            <option value="eligibility_verified">Verify statutory retirement eligibility</option>
                                                                        )}
                                                                        <option value="eligibility_disputed">Record eligibility issue / review</option>
                                                                    </>
                                                                )}
                                                                {receipt.withdrawal_requested && (
                                                                    <option value="withdrawn">Confirm employee withdrawal</option>
                                                                )}
                                                            </>
                                                        )}
                                                        <option value="response">Written response (retain status)</option>
                                                    </select>
                                                </Field>

                                                {approvedFinding && !['withdrawn', 'separated'].includes(receipt.status) && (
                                                    <Field label="Confirmed Effective Date" required>
                                                        <input
                                                            type="date"
                                                            required
                                                            min="1900-01-01"
                                                            max="2200-12-31"
                                                            className={inputClass}
                                                            value={review.effective_date}
                                                            onChange={(event) =>
                                                                reviewChange('effective_date', event.target.value)
                                                            }
                                                        />
                                                    </Field>
                                                )}
                                            </div>

                                            {reviewFeedback && <p id="hr-review-feedback" role={reviewFeedback.type === 'error' ? 'alert' : 'status'} className={`rounded-md border p-3 text-xs ${reviewFeedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{reviewFeedback.message}</p>}

                                            {approvedFinding && !['withdrawn', 'separated'].includes(receipt.status) && (
                                                <div className="space-y-1.5 pt-1">
                                                    {review.finding === 'notice_acknowledged' ? (
                                                        <Field label="Notice Basis" required>
                                                            <select
                                                                className={inputClass}
                                                                value={review.notice_basis}
                                                                onChange={(event) =>
                                                                    reviewChange('notice_basis', event.target.value)
                                                                }
                                                            >
                                                                <option value="standard_notice">Standard one-month notice</option>
                                                                <option value="shorter_notice_agreed">Employer agreed to shorter notice</option>
                                                                <option value="immediate_exit_legal_review">Immediate exit — legal basis reviewed</option>
                                                            </select>
                                                        </Field>
                                                    ) : (
                                                        <div className="space-y-1">
                                                            <Check
                                                                required
                                                                label="Statutory coverage, age and actual service verified."
                                                                checked={review.coverage_confirmed}
                                                                onChange={(value) =>
                                                                    reviewChange('coverage_confirmed', value)
                                                                }
                                                            />
                                                            <Check
                                                                required
                                                                label="Employee retirement intent verified; no compulsory waiver."
                                                                checked={review.consent_confirmed}
                                                                onChange={(value) =>
                                                                    reviewChange('consent_confirmed', value)
                                                                }
                                                            />
                                                        </div>
                                                    )}

                                                    {review.effective_date !== receipt.requested_date && (
                                                        <Check
                                                            required
                                                            label="Employee agreed to modified date; note records basis."
                                                            checked={review.date_agreement_confirmed}
                                                            onChange={(value) =>
                                                                reviewChange('date_agreement_confirmed', value)
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            )}

                                            <Field label="Written Finding / Response" required hint={`${review.note.length}/${EXIT_INPUT_LIMITS.note} characters · minimum 10`}>
                                                <textarea
                                                    ref={reviewNoteRef}
                                                    aria-describedby={reviewFeedback ? 'hr-review-feedback' : undefined}
                                                    required
                                                    minLength={10}
                                                    maxLength={EXIT_INPUT_LIMITS.note}
                                                    rows={2}
                                                    placeholder="Document findings visible to employee..."
                                                    className={inputClass}
                                                    value={review.note}
                                                    onChange={(event) =>
                                                        reviewChange('note', event.target.value)
                                                    }
                                                />
                                            </Field>

                                            <div className="flex justify-end">
                                                <button
                                                    type="submit"
                                                    className={primaryButtonClass}
                                                    disabled={busy || staleReceipt}
                                                >
                                                    {busy ? 'Saving…' : EXIT_REVIEW_ACTIONS[finding]?.button || 'Save HR Finding'}
                                                </button>
                                            </div>
                                        </form>

                                        {/* Finalize Due Separation */}
                                        {['eligibility_verified', 'notice_acknowledged'].includes(receipt.status) && (
                                            <div className="p-3 rounded-md border border-danger/20 bg-danger-subtle/30 space-y-2 text-xs">
                                                <div>
                                                    <span className="font-bold text-slate-900 block">Finalize Due Separation</span>
                                                </div>

                                                <Check
                                                    label="I verified the due effective date and separation evidence. Operational access will end."
                                                    checked={separationConfirmed}
                                                    onChange={setSeparationConfirmed}
                                                />

                                                {!lifecycle.canFinalize && lifecycle.stage === 'scheduled' && (
                                                    <p className="text-[11px] text-amber-700">
                                                        Cannot finalize before confirmed effective date ({receipt.effective_date}).
                                                    </p>
                                                )}

                                                <div className="flex justify-end">
                                                    <button
                                                        type="button"
                                                        className={dangerButtonClass}
                                                        disabled={
                                                            busy ||
                                                            staleReceipt ||
                                                            !separationConfirmed ||
                                                            receipt.review_pending ||
                                                            receipt.withdrawal_requested ||
                                                            !lifecycle.canFinalize
                                                        }
                                                        onClick={() =>
                                                            mutate(
                                                                '/' + receipt.id + '/separate',
                                                                { version: formVersion }
                                                            )
                                                        }
                                                    >
                                                        Finalize Separation
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
            <DocumentPreviewModal isOpen={Boolean(previewReceiptId && letterPreview.data?.document)} onClose={() => setPreviewReceiptId(null)} document={letterPreview.data?.document} />
        </div>
    );
}
