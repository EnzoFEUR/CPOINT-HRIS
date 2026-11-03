import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { getUser } from '../routes/guards';
import { getDisciplinaryCache } from '../utils/disciplinaryCache';
import { useCurrentTime } from '../utils/useCurrentTime';
import { VACATION_MONETIZATION_EXEMPT_DAY_CAP } from '../../../shared/statutoryLeave.mjs';
import SilValuationFields from './SilValuationFields';
import { findPreviousSilReview, silRateReviewItems } from '../utils/silRateAssistant.mjs';
import useSilRateSources from '../utils/useSilRateSources';
import {
    calculateSilConversion,
    validateCashOutRequest,
    validateCashOutDecision,
    validateCashOutTransition,
    CASH_OUT_LABELS,
    formatSilEvidenceReference,
    isCreditManager,
    validateCreditCommand,
    getLeaveCreditAllocationMessage,
} from '../../../shared/leavePolicy.js';
import { getEmployeeRestDays, getManilaWorkDate } from '../../../shared/workPolicy.mjs';
import { isBoundedDecimalInput } from '../../../shared/inputLimits.mjs';
import useEmployeeLeaveCredits, { leaveCreditKey, readLeaveCreditResponse } from '../utils/useEmployeeLeaveCredits';

const days = value => Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const emptyValuation = () => ({ daily_rate: '', source_document_id: '', evidence_reference: '', calculation_basis: '', reference_start: '', reference_end: '', as_of: '', verified: false });
const inputClass =
    'w-full h-8 bg-surface border border-line rounded-md px-2.5 text-xs text-ink font-medium focus:outline-none focus:border-line-strong focus:ring-1 focus:ring-accent/20 transition-colors shadow-2xs';

const STATUTORY_BASIS_OPTIONS = [
    {
        id: 'dole_standard',
        value: 'DOLE Book III Art. 95 / Non-basic wage exclusion',
        label: 'DOLE Book III Art. 95 (Standard SIL Encashment)',
        citation: 'Labor Code of the Philippines, Book III, Article 95 & Omnibus Rules',
        description:
            `Documented payroll exclusions require HR review. BIR RR 29-2025 permits qualifying unused vacation-credit monetization up to ${VACATION_MONETIZATION_EXEMPT_DAY_CAP} days per year; other cash-outs require their own tax assessment.`,
        sss: 'Excluded',
        philhealth: 'Excluded',
        pagibig: 'Excluded',
        thirteenth_month: 'Excluded',
    },
    {
        id: 'company_cba',
        value: 'Company CBA / HR Policy Rule - Leave Encashment Provision',
        label: 'Company CBA / HR Policy Provision',
        citation: 'Certified Collective Bargaining Agreement / Enterprise HR Policy',
        description:
            'Encashment authorized under certified CBA or enterprise HR policy provision without altering statutory contribution bases.',
        sss: 'Excluded',
        philhealth: 'Excluded',
        pagibig: 'Excluded',
        thirteenth_month: 'Excluded',
    },
    {
        id: 'final_settlement',
        value: 'DOLE Advisory Final Pay Settlement - Separation Encashment',
        label: 'DOLE Advisory Final Pay Settlement',
        citation: 'DOLE Labor Advisory No. 06-20 (Payment of Final Pay)',
        description:
            'Separation or retirement final settlement of accumulated service credits pursuant to DOLE regulations.',
        sss: 'Excluded',
        philhealth: 'Excluded',
        pagibig: 'Excluded',
        thirteenth_month: 'Excluded',
    },
    {
        id: 'custom',
        value: 'custom',
        label: 'Custom Legal / Special Order Citation...',
        citation: 'Enterprise Board Resolution or Specific Legal Order',
        description: 'Specify documented enterprise legal citation, board resolution number, or DOLE ruling reference.',
        sss: 'Excluded',
        philhealth: 'Excluded',
        pagibig: 'Excluded',
        thirteenth_month: 'Excluded',
    },
];



const formatDateTime = value => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

export default function LeaveCreditsPanel({
    employeeId,
    employee,
    manage = false,
    compact = false,
    isTerminated = false,
    isSuspended = false,
}) {
    const user = getUser();
    const now = useCurrentTime();
    const canManage = Boolean(user?.id) && manage && isCreditManager(user);
    const queryClient = useQueryClient();
    const query = useEmployeeLeaveCredits(employeeId);
    const [liveDisciplinary, setLiveDisciplinary] = useState(() => getDisciplinaryCache(employeeId));
    const [disciplinaryEmployee, setDisciplinaryEmployee] = useState(employeeId);
    if (disciplinaryEmployee !== employeeId) {
        setDisciplinaryEmployee(employeeId);
        setLiveDisciplinary(getDisciplinaryCache(employeeId));
    }

    useEffect(() => {
        if (!employeeId) return;
        const handleSync = (e) => {
            if (!e?.detail?.userId || e.detail.userId === employeeId) {
                setLiveDisciplinary(getDisciplinaryCache(employeeId));
            }
        };

        window.addEventListener('hris_disciplinary_sync', handleSync);
        return () => window.removeEventListener('hris_disciplinary_sync', handleSync);
    }, [employeeId]);

    const isSeparatedEmployee = Boolean(
        isTerminated ||
        liveDisciplinary?.isTerminated ||
        employee?.is_terminated ||
        employee?.operational_status === 'Terminated' ||
        ['terminated', 'separated', 'archived'].includes(String(employee?.status || '').toLowerCase()) ||
        (String(employee?.status || '').toLowerCase() === 'inactive' && Boolean(employee?.separation_type || employee?.archived_at))
    );

    const isSuspendedEmployee = !isSeparatedEmployee && Boolean(
        isSuspended ||
        liveDisciplinary?.isSuspended ||
        employee?.is_suspended ||
        employee?.operational_status === 'Suspended' ||
        String(employee?.status || '').toLowerCase() === 'suspended'
    );

    const isSilDisabled = isSeparatedEmployee || isSuspendedEmployee;

    const allocationReady = query.data?.account && query.data.allocation_status === 'ready';
    const reconciling = Boolean(query.data?.account) && query.data?.allocation_status === 'service_date_review_required';
    const canReview =
        canManage &&
        !query.isError &&
        !query.isPending &&
        !query.isLoading &&
        ((!query.data?.account && query.data?.allocation_status === 'opening_balance_review_required') || reconciling);
    const cashRequests = query.data?.cash_out_requests || [];
    const cashEvents = query.data?.cash_events || [];
    const pendingCash = cashRequests.find(item => item.status === 'requested');
    const valuedCash = cashRequests.find(item => item.valuation_basis);
    const valuationBasis = valuedCash?.valuation_basis;
    const openCash = cashRequests.find(item =>
        ['requested', 'approved', 'queued_for_payroll', 'needs_correction', 'payment_failed'].includes(item.status)
    );
    const recentRejectedCash = cashRequests.find(item => item.status === 'rejected');
    const rejectedTimestamp = recentRejectedCash
        ? recentRejectedCash.decided_at ||
          cashEvents.find(e => e.request_id === recentRejectedCash.id && e.action === 'rejected')?.created_at ||
          recentRejectedCash.created_at
        : null;
    const cooldownHours = 24;
    const cooldownExpiry = rejectedTimestamp
        ? new Date(new Date(rejectedTimestamp).getTime() + cooldownHours * 60 * 60 * 1000)
        : null;
    const isCooldownActive = Boolean(cooldownExpiry && cooldownExpiry.getTime() > now);

    const [dismissedRejectionId, setDismissedRejectionId] = useState(() => {
        try {
            return localStorage.getItem(`sil_cash_dismissed_rejection_${employeeId}`) || null;
        } catch {
            return null;
        }
    });

    const handleDismissRejection = id => {
        try {
            localStorage.setItem(`sil_cash_dismissed_rejection_${employeeId}`, id);
        } catch {
            /* storage fallback */
        }
        setDismissedRejectionId(id);
    };

    const getCooldownRemaining = () => {
        if (!cooldownExpiry) return '';
        const diffMs = cooldownExpiry.getTime() - now;
        if (diffMs <= 0) return '';
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours === 0) return `${minutes}m`;
        return `${hours}h ${minutes}m`;
    };

    const showCashRequest = !manage && Boolean(user?.id) && user.id === employeeId;
    const cashOutAvailable = Array.isArray(query.data?.cash_out_requests);
    const convertible = Number(query.data?.conversion?.convertible_days ?? query.data?.sil_balance ?? 0);
    const canReviewCash = canManage && user.id !== employeeId;
    const canRequestCash =
        !isSilDisabled &&
        showCashRequest &&
        allocationReady &&
        !query.isError &&
        !query.isPending &&
        !query.isLoading &&
        convertible > 0 &&
        cashOutAvailable &&
        !openCash &&
        !isCooldownActive;

    const [action, setAction] = useState('');
    const [saving, setSaving] = useState(false);
    const request = useRef(null);
    const busy = useRef(false);
    const [basisSelection, setBasisSelection] = useState('dole_standard');
    const [customBasis, setCustomBasis] = useState('');
    const [valuation, setValuation] = useState(emptyValuation);
    const [taxTreatment, setTaxTreatment] = useState('');
    const [approveStep, setApproveStep] = useState(1);
    const [sourceRevision, setSourceRevision] = useState(0);
    const [sourceNotice, setSourceNotice] = useState('');
    const savedRate = Number(employee?.daily_rate) || Number(employee?.daily_pay) || 0;
    const needsValuation = !Number.isFinite(savedRate) || savedRate <= 0;
    const supportsValuation = query.data?.valuation_version === 3 && query.data?.workflow_version === 2;
    const reviewedRate = needsValuation ? Number(valuation.daily_rate) : savedRate;
    const conversionDate = getManilaWorkDate(now);
    const previousWageReview = findPreviousSilReview(cashRequests, employeeId, conversionDate);
    const approveSteps = needsValuation
        ? [
              { id: 1, title: 'Wage Rate' },
              { id: 2, title: 'Tax & Compliance' },
              { id: 3, title: 'Authorization' },
          ]
        : [
              { id: 1, title: 'Tax & Compliance' },
              { id: 2, title: 'Authorization' },
          ];
    const isStep1Valid =
        !needsValuation ||
        (supportsValuation && silRateReviewItems(valuation, conversionDate).every(item => item.complete));
    const [form, setForm] = useState({
        days: '',
        opening_sil: '',
        reason: '',
        taxable_amount: '',
        basis: STATUTORY_BASIS_OPTIONS[0].value,
        confirmed: false,
    });

    let estimate = null;
    let pendingEstimate = null;
    try {
        estimate = calculateSilConversion(action === 'cash-out-approve' ? pendingCash?.days : form.days || convertible, action === 'cash-out-approve' ? reviewedRate : savedRate);
    } catch {
        /* rate pending */
    }
    try {
        pendingEstimate = calculateSilConversion(pendingCash?.days, savedRate);
    } catch {
        /* pending HR valuation */
    }

    const set = (name, value) => setForm(previous => ({ ...previous, [name]: value }));
    const taxableAmount = taxTreatment === 'exempt' ? (estimate == null ? '' : '0')
        : taxTreatment === 'taxable' ? (estimate == null ? '' : String(estimate)) : form.taxable_amount;
    const isStep2Valid =
        Boolean(taxTreatment) &&
        String(taxableAmount ?? '').trim() !== '' &&
        (basisSelection !== 'custom' || Boolean(customBasis.trim())) &&
        (estimate == null || Number(taxableAmount) <= estimate);
    const updateValuation = next => {
        setValuation(next);
        setTaxTreatment('');
        setForm(previous => ({ ...previous, taxable_amount: '', confirmed: false }));
    };
    useSilRateSources(employeeId, action === 'cash-out-approve' && needsValuation && supportsValuation, () => {
        setSourceRevision(previous => previous + 1);
        setSourceNotice('Saved payroll, attendance or wage evidence changed, or the connection resumed. Refresh sources and review the rate again.');
        updateValuation(previous => previous.source || previous.calculation ? emptyValuation() : { ...previous, verified: false });
        setApproveStep(1);
    }, valuation.source_document_id);

    const submit = async event => {
        event.preventDefault();
        if (action === 'cash-out-approve' && approveStep < (needsValuation ? 3 : 2)) return;
        const reviewing = ['setup', 'reconcile'].includes(action);
        const requesting = action === 'cash-out-request';
        const deciding = ['cash-out-approve', 'cash-out-reject', 'cash-out-correct'].includes(action);
        const revising = ['cash-out-cancel', 'cash-out-resubmit'].includes(action);

        if (requesting || deciding || revising) {
            if (requesting && isSilDisabled) {
                toast.error(
                    isSeparatedEmployee
                        ? 'Service Incentive Leave cash-out is disabled for separated personnel.'
                        : 'Service Incentive Leave cash-out is paused during disciplinary suspension.'
                );
                return;
            }
            if (
                busy.current ||
                !form.confirmed ||
                (requesting ? !canRequestCash : revising ? !showCashRequest || !openCash : !canReviewCash || !pendingCash)
            )
                return;

            try {
                if (requesting && Number(form.days) > convertible) {
                    throw new Error('Choose days within your available SIL balance.');
                }
                if (action === 'cash-out-approve') {
                    if (needsValuation && !supportsValuation) throw new Error('Install the linked SIL wage-evidence database update before approving this request.');
                    if (!taxTreatment || String(taxableAmount ?? '').trim() === '') {
                        throw new Error('Review the amount subject to tax before approving.');
                    }
                    if (estimate != null && Number(taxableAmount) > estimate) throw new Error('The taxable portion cannot exceed the SIL cash-out amount.');
                    if (basisSelection === 'custom' && !customBasis.trim()) {
                        throw new Error('Enter a valid custom statutory compliance citation.');
                    }
                }
                if (['cash-out-reject', 'cash-out-correct', 'cash-out-cancel'].includes(action) && !form.reason?.trim()) {
                    throw new Error('Enter a reason (up to 500 characters).');
                }

                const target = revising ? openCash : pendingCash;
                const transition = {
                    'cash-out-approve': 'approved',
                    'cash-out-reject': 'rejected',
                    'cash-out-correct': 'needs_correction',
                    'cash-out-cancel': 'cancelled',
                    'cash-out-resubmit': 'resubmit',
                }[action];

                const finalReason =
                    form.reason?.trim() || (action === 'cash-out-approve' ? 'Approved for payroll disbursement' : '');
                const effectiveDays = Number(form.days || target?.days || 0);
                const finalBasis =
                    action === 'cash-out-approve'
                        ? basisSelection === 'custom'
                            ? customBasis.trim()
                            : form.basis?.trim() || STATUTORY_BASIS_OPTIONS[0].value
                        : null;

                const values = requesting
                    ? { employee_id: employeeId, days: Number(form.days) }
                    : {
                          request_id: target.id,
                          status: transition,
                          taxable_amount: action === 'cash-out-approve' ? Number(taxableAmount) : null,
                          expected_daily_rate:
                              action === 'cash-out-approve'
                                  ? reviewedRate
                                  : null,
                          ...(action === 'cash-out-approve' && needsValuation ? { valuation_basis: { ...valuation, method: 'documented_conversion_rate' } } : {}),
                          ...(query.data?.workflow_version === 2
                              ? {
                                    action: transition,
                                    reason: finalReason,
                                    days: effectiveDays,
                                    employee_id: employeeId,
                                    classification:
                                        action === 'cash-out-approve'
                                            ? {
                                                  sss: 'excluded',
                                                  philhealth: 'excluded',
                                                  pagibig: 'excluded',
                                                  thirteenth_month: 'excluded',
                                                  basis: finalBasis,
                                              }
                                            : null,
                                }
                              : {}),
                      };

                const fingerprint = JSON.stringify({ action, ...values });
                if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };

                const body = requesting
                    ? validateCashOutRequest({ ...values, request_id: request.current.id })
                    : query.data?.workflow_version === 2
                    ? validateCashOutTransition({ ...values, operation_id: request.current.id })
                    : validateCashOutDecision({ ...values, decision_id: request.current.id });

                busy.current = true;
                setSaving(true);
                const path = requesting
                    ? 'cash-out-requests'
                    : `cash-out-requests/${target.id}/${query.data?.workflow_version === 2 ? 'transition' : 'decision'}`;
                const data = await readLeaveCreditResponse(
                    await fetchWithAuth(`/api/leave-credits/${path}`, { method: 'POST', body: JSON.stringify(body) })
                );

                if (data?.allocation_status) queryClient.setQueryData(leaveCreditKey(user.id, employeeId), data);

                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: leaveCreditKey(user.id, employeeId), exact: true }),
                    queryClient.invalidateQueries({ queryKey: ['payrollLeavePay'] }),
                    queryClient.invalidateQueries({ queryKey: ['adminLeaves'] }),
                    queryClient.invalidateQueries({ queryKey: ['silCashOutQueue'] }),
                ]);

                request.current = null;
                setAction('');
                setBasisSelection('dole_standard');
                setCustomBasis('');
                setValuation(emptyValuation());
                setTaxTreatment('');
                setForm(previous => ({
                    ...previous,
                    days: '',
                    reason: '',
                    taxable_amount: '',
                    basis: STATUTORY_BASIS_OPTIONS[0].value,
                    confirmed: false,
                }));

                toast.success(
                    requesting
                        ? 'Cash-out requested.'
                        : action === 'cash-out-approve'
                        ? 'Approved for the next eligible payslip.'
                        : action === 'cash-out-reject'
                        ? 'Cash-out request rejected.'
                        : 'Cash-out updated.'
                );
            } catch (error) {
                toast.error(error.message || 'Unable to save cash-out. Refresh before retrying.');
                if (busy.current) query.refetch();
            } finally {
                busy.current = false;
                setSaving(false);
            }
            return;
        }

        if (busy.current || !form.confirmed || !reviewing || !canReview) return;

        try {
            if (reviewing && (form.opening_sil == null || String(form.opening_sil).trim() === '')) {
                throw new Error('Enter the verified remaining days.');
            }
            const payload =
                action === 'reconcile'
                    ? {
                          employee_id: employeeId,
                          reason: form.reason,
                          service_start_date: form.service_start_date,
                          expected_service_start_date: form.expected_service_start_date,
                          expected_balance: form.expected_balance,
                          remaining_days: Number(form.opening_sil),
                      }
                    : {
                          employee_id: employeeId,
                          reason: form.reason,
                          service_start_date: employee?.date_hired,
                          rest_days: getEmployeeRestDays(employee),
                          sil_eligible: true,
                          opening_sil: Number(form.opening_sil),
                      };

            const fingerprint = JSON.stringify({ action, ...payload });
            if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };

            const body = validateCreditCommand(action, { ...payload, request_id: request.current.id });
            busy.current = true;
            setSaving(true);
            const data = await readLeaveCreditResponse(
                await fetchWithAuth(`/api/leave-credits/${action}`, { method: 'POST', body: JSON.stringify(body) })
            );

            if (data?.allocation_status) queryClient.setQueryData(leaveCreditKey(user.id, employeeId), data);

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: leaveCreditKey(user.id, employeeId), exact: true }),
                queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', user.id, employeeId] }),
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', employeeId] }),
                queryClient.invalidateQueries({ queryKey: ['adminLeaves', user.id] }),
            ]);

            request.current = null;
            setAction('');
            setForm(previous => ({ ...previous, days: '', opening_sil: '', reason: '', confirmed: false }));
            toast.success('Starting balance confirmed.');
        } catch (error) {
            toast.error(error.message || 'Unable to update leave credits. Refresh before retrying.');
            if (busy.current) query.refetch();
        } finally {
            busy.current = false;
            setSaving(false);
        }
    };

    if (!employeeId) return null;

    return (
        <section
            className={`${compact ? '' : 'bg-white rounded-lg p-5 shadow-xs border border-slate-200'} space-y-4`}
            aria-label="Employee leave credits"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Service Incentive Leave</h3>
                    {isSeparatedEmployee && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
                            <i className="ti ti-lock text-[11px]" />
                            <span>Locked · Separated</span>
                        </span>
                    )}
                    {isSuspendedEmployee && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                            <i className="ti ti-clock-pause text-[11px]" />
                            <span>Paused · Suspended</span>
                        </span>
                    )}
                </div>
            </div>

            {/* Content States */}
            {!user?.id ? (
                <p role="status" className="text-xs text-slate-400 py-2">
                    Sign in to view leave credits.
                </p>
            ) : query.isPending || query.isLoading ? (
                <div className="py-4 flex items-center gap-2 text-xs text-slate-400">
                    <i className="ti ti-loader-2 animate-spin text-slate-500 text-sm" />
                    <span>Loading leave balance...</span>
                </div>
            ) : query.isError ? (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
                    {query.error.message}
                </div>
            ) : !query.data?.account ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-600">
                    {getLeaveCreditAllocationMessage(query.data)}
                </div>
            ) : (
                <div className="space-y-2">
                    {/* Primary Balance Row */}
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">
                            {days(query.data.sil_balance)}
                        </span>
                        <span className="text-xs font-medium text-slate-500">
                            {Number(query.data.sil_balance) === 1 ? 'day available' : 'days available'}
                        </span>
                    </div>

                    {!allocationReady && (
                        <p role="status" className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-md border border-amber-200">
                            {getLeaveCreditAllocationMessage(query.data)}
                        </p>
                    )}

                    {/* Inline Breakdown */}
                    {allocationReady && query.data?.conversion && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 pt-0.5">
                            <div>
                                <span className="text-slate-400">Convertible:</span>{' '}
                                <span className="font-semibold text-slate-700">{days(convertible)}d</span>
                            </div>
                            <span className="text-slate-300">&bull;</span>
                            <div>
                                <span className="text-slate-400">Reserved:</span>{' '}
                                <span className="font-semibold text-slate-700">
                                    {days(query.data.conversion.reserved_days)}d
                                </span>
                            </div>
                            {estimate != null && estimate > 0 && (
                                <>
                                    <span className="text-slate-300">&bull;</span>
                                    <div>
                                        <span className="text-slate-400">{needsValuation ? 'Preview:' : 'Value:'}</span>{' '}
                                        <span className="font-semibold text-slate-900">
                                            ₱
                                            {estimate.toLocaleString('en-PH', {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* DOLE Separation Advisory Banner */}
            {isSeparatedEmployee && (
                <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-3.5 text-xs space-y-1.5">
                    <div className="flex items-center gap-2">
                        <i className="ti ti-shield-lock text-rose-600 text-sm shrink-0" />
                        <span className="font-semibold text-rose-900">
                            DOLE Advisory No. 06-20 · SIL Encashment Deactivated
                        </span>
                    </div>
                    <p className="text-rose-700 text-[11px] leading-relaxed pl-5">
                        Remaining statutory credits are audited and liquidated through final clearance pay.
                    </p>
                </div>
            )}

            {/* Disciplinary Suspension Advisory Banner */}
            {isSuspendedEmployee && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-3 text-xs flex items-start gap-2.5">
                    <i className="ti ti-lock text-amber-600 text-sm mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                        <span className="font-semibold text-amber-900">SIL Encashment Paused during Disciplinary Suspension</span>
                        <p className="text-[11px] text-amber-800 leading-relaxed">
                            Leave conversions and applications are temporarily withheld under active administrative disciplinary terms.
                        </p>
                    </div>
                </div>
            )}

            {/* Active Cash-Out Request Banner */}
            {!manage && openCash && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs flex items-center justify-between gap-2">
                    <span className="font-medium flex items-center gap-2 text-slate-700 truncate">
                        <i className="ti ti-clock text-slate-400 text-sm shrink-0" />
                        <span>
                            Cash-out filed: <strong>{days(openCash.days)} {Number(openCash.days) === 1 ? 'day' : 'days'}</strong>
                        </span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            {CASH_OUT_LABELS[openCash.status] || openCash.status}
                        </span>
                        {showCashRequest && ['requested', 'needs_correction'].includes(openCash.status) && (
                            <button
                                type="button"
                                disabled={saving}
                                className="text-[11px] text-slate-500 hover:text-slate-900 underline cursor-pointer"
                                onClick={() => {
                                    setAction('cash-out-cancel');
                                    set('confirmed', false);
                                }}
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            )}

            {valuationBasis && <details className="rounded-md border border-slate-200 p-3 text-xs">
                    <summary className="cursor-pointer font-semibold text-slate-700">SIL valuation · PHP {Number(valuedCash.cash_amount).toFixed(2)} · {CASH_OUT_LABELS[valuedCash.status] || valuedCash.status}</summary>
                    <dl className="mt-2 space-y-1 break-words text-slate-600">
                        <div><dt className="inline font-medium">Rate: </dt><dd className="inline">{days(valuedCash.days)} days × PHP {Number(valuedCash.daily_rate).toFixed(2)} · as of {valuationBasis.as_of}</dd></div>
                        <div><dt className="inline font-medium">Basis: </dt><dd className="inline whitespace-pre-wrap">{valuationBasis.calculation_basis}</dd></div>
                        <div><dt className="inline font-medium">Review basis: </dt><dd className="inline">{valuationBasis.authority_reference}</dd></div>
                        <div><dt className="inline font-medium">Evidence: </dt><dd className="inline">{formatSilEvidenceReference(valuationBasis.evidence_reference)}{valuationBasis.reference_start ? ` · ${valuationBasis.reference_start} to ${valuationBasis.reference_end}` : ''}</dd></div>
                    </dl>
                </details>}
            {/* Cash-Out Rejection Notice (Light Rose Alert) */}
            {!manage &&
                recentRejectedCash &&
                (!openCash || recentRejectedCash.id === cashRequests[0]?.id) &&
                dismissedRejectionId !== recentRejectedCash.id && (
                    <div className="bg-rose-50/70 border border-rose-200 rounded-lg p-3.5 text-xs space-y-2">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                                    <i className="ti ti-alert-circle text-xs" />
                                    <span>Cash-Out Rejected</span>
                                </span>
                                <span className="font-medium text-rose-900">
                                    {days(recentRejectedCash.days)} {Number(recentRejectedCash.days) === 1 ? 'day' : 'days'}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleDismissRejection(recentRejectedCash.id)}
                                className="text-rose-400 hover:text-rose-700 p-1 -mr-1 -mt-0.5 rounded cursor-pointer transition-colors"
                                title="Dismiss notice"
                                aria-label="Dismiss rejection notice"
                            >
                                <i className="ti ti-x text-sm" />
                            </button>
                        </div>

                        <div className="space-y-1.5 pl-1">
                            <p className="text-[11px] text-rose-600">
                                Decided on{' '}
                                {formatDateTime(
                                    recentRejectedCash.decided_at ||
                                        cashEvents.find(e => e.request_id === recentRejectedCash.id && e.action === 'rejected')
                                            ?.created_at ||
                                        recentRejectedCash.created_at
                                )}
                            </p>

                            <div className="p-2.5 bg-white border border-rose-200 rounded-md">
                                <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider block mb-0.5">
                                    Reason
                                </span>
                                <p className="text-xs text-rose-950 font-medium whitespace-pre-wrap break-words leading-relaxed">
                                    {recentRejectedCash.review_reason ||
                                        cashEvents.find(e => e.request_id === recentRejectedCash.id && e.action === 'rejected')
                                            ?.payload?.reason ||
                                        'No specific remarks recorded.'}
                                </p>
                            </div>

                            <p className="text-[11px] text-rose-700 pt-1">
                                All {days(recentRejectedCash.days)}{' '}
                                {Number(recentRejectedCash.days) === 1 ? 'day has' : 'days have'} been restored to your leave balance.
                            </p>
                        </div>
                    </div>
                )}

            {/* 24-Hour Cooldown Banner (Soft Amber Alert) */}
            {isCooldownActive && showCashRequest && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-3 text-xs flex items-start gap-2.5">
                    <i className="ti ti-clock-pause text-amber-600 text-sm mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-amber-900">Encashment temporarily unavailable</span>
                            <span className="text-[11px] font-medium text-amber-700 tabular-nums">
                                ({getCooldownRemaining()} left)
                            </span>
                        </div>
                        <p className="text-[11px] text-amber-800">
                            You can submit a new request on <strong>{formatDateTime(cooldownExpiry)}</strong>.
                        </p>
                    </div>
                </div>
            )}

            {/* Action CTA */}
            {canRequestCash && !action && !openCash && (
                <div className="pt-1">
                    <button
                        type="button"
                        disabled={saving}
                        className="h-8 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md shadow-xs transition-colors flex items-center justify-center gap-1.5 w-full sm:w-auto cursor-pointer"
                        onClick={() => {
                            setAction('cash-out-request');
                            set('confirmed', false);
                        }}
                    >
                        <i className="ti ti-cash text-sm" />
                        <span>Request SIL Cash-Out</span>
                    </button>
                </div>
            )}

            {/* Disabled Action CTA when Separated or Suspended */}
            {showCashRequest && !manage && !openCash && !action && isSilDisabled && (
                <div className="pt-1">
                    <button
                        type="button"
                        disabled
                        className="h-8 px-4 bg-slate-100 border border-slate-200 text-slate-400 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 w-full sm:w-auto cursor-not-allowed opacity-80"
                        title={isSeparatedEmployee ? 'SIL cash-out disabled for separated personnel' : 'SIL cash-out paused during suspension'}
                    >
                        <i className="ti ti-lock text-sm" />
                        <span>
                            {isSeparatedEmployee
                                ? 'SIL Cash-Out Locked (Separated)'
                                : 'SIL Cash-Out Paused (Suspended)'}
                        </span>
                    </button>
                </div>
            )}

            {/* Admin Actions */}
            {canReview && !action && (
                <button
                    type="button"
                    disabled={saving}
                    className="w-full h-8 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    onClick={() => {
                        setAction(reconciling ? 'reconcile' : 'setup');
                        setForm(previous => ({
                            ...previous,
                            confirmed: false,
                            opening_sil: '',
                            service_start_date: employee?.date_hired,
                            expected_service_start_date: query.data?.account?.service_start_date,
                            expected_balance: Number(query.data?.conversion?.ledger_balance ?? query.data?.sil_balance),
                        }));
                    }}
                >
                    <i className="ti ti-edit text-xs" />
                    <span>{reconciling ? 'Reconcile Service Date & Balance' : 'Set Initial Starting Balance'}</span>
                </button>
            )}

            {/* Admin Review Banner */}
            {canReviewCash && pendingCash && !action && (
                <div className="bg-surface-muted border border-line rounded-lg p-3 text-xs flex items-center justify-between gap-3 shadow-2xs">
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-accent block">Pending Cash-Out Request</span>
                        <span className="font-semibold text-ink">
                            {days(pendingCash.days)} day(s) · {pendingEstimate == null ? 'HR valuation required' : `PHP ${pendingEstimate.toFixed(2)}`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            disabled={saving}
                            className="h-7 px-3 bg-ink hover:bg-slate-800 text-white font-semibold rounded text-xs transition-colors cursor-pointer shadow-2xs"
                            onClick={() => {
                                setAction('cash-out-approve');
                                setApproveStep(1);
                                setValuation(emptyValuation());
                                setSourceNotice('');
                                setTaxTreatment('');
                                setBasisSelection('dole_standard');
                                setCustomBasis('');
                                setForm(p => ({
                                    ...p,
                                    taxable_amount: '',
                                    basis: STATUTORY_BASIS_OPTIONS[0].value,
                                    reason: '',
                                    confirmed: false,
                                }));
                            }}
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            disabled={saving}
                            className="h-7 px-2.5 border border-line bg-surface hover:bg-surface-muted text-ink-muted rounded text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                            onClick={() => {
                                setAction('cash-out-reject');
                                setForm(p => ({ ...p, reason: '', confirmed: false }));
                            }}
                        >
                            Reject
                        </button>
                    </div>
                </div>
            )}

            {/* Embedded Action Form */}
            {((canRequestCash && action === 'cash-out-request') ||
                (showCashRequest && openCash && ['cash-out-resubmit', 'cash-out-cancel'].includes(action)) ||
                (canReviewCash && pendingCash && ['cash-out-approve', 'cash-out-reject', 'cash-out-correct'].includes(action))) && (
                <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-surface p-3.5 text-xs shadow-xs">
                    <fieldset disabled={saving} className="space-y-3">
                        {action !== 'cash-out-request' && (
                            <div className="flex items-center justify-between border-b border-line pb-2">
                                <div>
                                    <h4 className="font-bold text-xs uppercase tracking-wider text-ink">
                                        {action === 'cash-out-approve'
                                            ? 'Approve SIL Cash-Out'
                                            : action === 'cash-out-reject'
                                            ? 'Reject SIL Cash-Out'
                                            : 'Update SIL Cash-Out'}
                                    </h4>
                                    <p className="text-[11px] text-ink-subtle">
                                        {action === 'cash-out-approve'
                                            ? 'Authorize statutory conversion and reviewed tax treatment.'
                                            : action === 'cash-out-reject'
                                            ? 'Provide an official reason for rejection.'
                                            : 'Adjust pending cash-out parameters.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {['cash-out-request', 'cash-out-resubmit'].includes(action) && (
                            <div>
                                <label htmlFor="cashout-days-input" className="block font-medium text-slate-700 mb-1">
                                    Days to Cash Out
                                </label>
                                <input
                                    id="cashout-days-input"
                                    type="number"
                                    required
                                    min="0.001"
                                    max={convertible}
                                    step="0.001"
                                    className={inputClass}
                                    value={form.days}
                                    onChange={e => set('days', e.target.value)}
                                    placeholder={`Up to ${days(convertible)}`}
                                />
                                <div className="flex justify-between text-[11px] text-slate-500 mt-1">
                                    <span>{needsValuation ? 'HR valuation required' : `PHP ${savedRate.toFixed(2)}/day`}</span>
                                    <span>
                                        Est:{' '}
                                        <strong className="text-slate-800">
                                            {estimate == null ? 'Pending rate' : `₱${estimate.toFixed(2)}`}
                                        </strong>
                                    </span>
                                </div>
                            </div>
                        )}

                        {action === 'cash-out-approve' && (
                            <div className="space-y-3.5">
                                {/* Stepper Header */}
                                <div className="flex items-center justify-between pb-2.5 border-b border-line">
                                    <div className="flex items-center gap-2">
                                        {approveSteps.map((s, idx) => {
                                            const isActive = approveStep === s.id;
                                            const isDone = approveStep > s.id;
                                            return (
                                                <div key={s.id} className="flex items-center gap-2">
                                                    {idx > 0 && <span className="text-line-strong text-xs">/</span>}
                                                    <button
                                                        type="button"
                                                        disabled={!isDone}
                                                        onClick={() => isDone && setApproveStep(s.id)}
                                                        className={`flex items-center gap-1.5 text-xs transition-colors ${
                                                            isActive
                                                                ? 'font-bold text-ink'
                                                                : isDone
                                                                ? 'font-medium text-ink-muted hover:text-ink cursor-pointer'
                                                                : 'font-normal text-ink-subtle opacity-60 cursor-not-allowed'
                                                        }`}
                                                    >
                                                        <span
                                                            className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                                                isActive
                                                                    ? 'bg-ink text-white shadow-2xs'
                                                                    : isDone
                                                                    ? 'bg-success text-white'
                                                                    : 'bg-surface-muted text-ink-subtle border border-line'
                                                            }`}
                                                        >
                                                            {isDone ? '✓' : s.id}
                                                        </span>
                                                        <span className="hidden sm:inline">{s.title}</span>
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted bg-surface-muted px-2 py-0.5 rounded border border-line">
                                        Step {approveStep} of {approveSteps.length}
                                    </span>
                                </div>

                                {/* Step 1: Wage Rate Valuation (Only when employee needs piece-rate valuation) */}
                                {needsValuation && approveStep === 1 && (
                                    <div className="space-y-3">
                                        {supportsValuation ? (
                                            <SilValuationFields
                                                key={`${employeeId}:${conversionDate}:${sourceRevision}`}
                                                employeeId={employeeId}
                                                previousReview={previousWageReview}
                                                requestedDays={pendingCash?.days}
                                                sourceNotice={sourceNotice}
                                                onSourceReviewed={() => setSourceNotice('')}
                                                value={valuation}
                                                onChange={updateValuation}
                                                asOf={conversionDate}
                                                inputClass={inputClass}
                                            />
                                        ) : (
                                            <p role="alert" className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-md border border-amber-200">
                                                Database update required for linked SIL wage evidence.
                                            </p>
                                        )}
                                        <div className="flex items-center justify-between pt-1 border-t border-line">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setAction('');
                                                    setApproveStep(1);
                                                    setBasisSelection('dole_standard');
                                                    setCustomBasis('');
                                                }}
                                                className="h-8 px-3.5 border border-line bg-surface hover:bg-surface-muted text-ink-muted rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!isStep1Valid}
                                                onClick={() => setApproveStep(2)}
                                                className="h-8 px-4 bg-ink hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer"
                                            >
                                                Next: Tax Treatment →
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Step 2 (or Step 1 if !needsValuation): Tax & Statutory Compliance */}
                                {((needsValuation && approveStep === 2) || (!needsValuation && approveStep === 1)) && (
                                    <div className="space-y-3">
                                        {/* Executive Disbursement Summary */}
                                        <div className="rounded-lg border border-accent/25 bg-accent-subtle/50 p-3 flex items-center justify-between gap-3 shadow-2xs">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-accent">Disbursement Total</span>
                                                    <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-surface border border-accent/20 text-ink-muted">Weekly Payroll</span>
                                                </div>
                                                <p className="text-[11px] text-ink-muted mt-0.5">
                                                    {pendingCash?.days ? `${days(pendingCash.days)} day(s) requested` : 'Days requested'}
                                                    {reviewedRate > 0 && ` × ₱${reviewedRate.toFixed(2)}/day`}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] uppercase font-semibold text-ink-subtle block">Gross Payout</span>
                                                <span className="text-base font-bold font-mono text-ink tracking-tight tabular-nums">
                                                    {estimate == null ? 'Pending Rate' : `₱${estimate.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Tax Treatment Grid */}
                                        <div className="space-y-1.5">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                <div>
                                                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                                                        Tax Classification <span className="text-rose-500">*</span>
                                                    </label>
                                                    <select
                                                        aria-label="HR-reviewed tax treatment"
                                                        required
                                                        value={taxTreatment}
                                                        onChange={event => {
                                                            setTaxTreatment(event.target.value);
                                                            set('confirmed', false);
                                                        }}
                                                        className={inputClass}
                                                    >
                                                        <option value="">Select tax classification</option>
                                                        <option value="exempt">Exempt — reviewed by HR</option>
                                                        <option value="taxable">Fully taxable — reviewed by HR</option>
                                                        <option value="partial">Partly taxable — enter reviewed portion</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label htmlFor="taxable-amount-input" className="block text-[11px] font-medium text-ink-muted mb-1">
                                                        Amount Subject to Tax (PHP) <span className="text-rose-500">*</span>
                                                    </label>
                                                    <input
                                                        id="taxable-amount-input"
                                                        type="text"
                                                        inputMode="decimal"
                                                        maxLength={12}
                                                        required
                                                        min="0"
                                                        step="0.01"
                                                        className={inputClass}
                                                        readOnly={taxTreatment !== 'partial'}
                                                        value={taxableAmount}
                                                        onChange={e => {
                                                            if (isBoundedDecimalInput(e.target.value, 366000000, true)) set('taxable_amount', e.target.value);
                                                        }}
                                                        placeholder={
                                                            taxTreatment === 'exempt'
                                                                ? '₱0.00 (Exempt)'
                                                                : taxTreatment === 'taxable'
                                                                ? (estimate == null ? 'Full amount' : `₱${estimate.toFixed(2)}`)
                                                                : 'Enter taxable portion'
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between text-[10px] text-ink-subtle px-0.5">
                                                <span>Portion subject to tax (withholding calculated at payroll run).</span>
                                                <span>BIR RR 29-2025 cap: {VACATION_MONETIZATION_EXEMPT_DAY_CAP}d/yr</span>
                                            </div>
                                        </div>

                                        {/* Statutory Compliance Basis */}
                                        <div className="space-y-1.5">
                                            <label htmlFor="approve-basis-select" className="block text-[11px] font-medium text-ink-muted mb-1">
                                                Statutory Compliance Basis <span className="text-rose-500">*</span>
                                            </label>
                                            <select
                                                id="approve-basis-select"
                                                required
                                                className={inputClass}
                                                value={basisSelection}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setBasisSelection(val);
                                                    if (val === 'custom') {
                                                        set('basis', customBasis);
                                                    } else {
                                                        const match = STATUTORY_BASIS_OPTIONS.find(opt => opt.id === val);
                                                        set('basis', match ? match.value : '');
                                                    }
                                                }}
                                            >
                                                {STATUTORY_BASIS_OPTIONS.map(opt => (
                                                    <option key={opt.id} value={opt.id}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {basisSelection === 'custom' && (
                                            <div>
                                                <label htmlFor="custom-basis-input" className="block text-[11px] font-medium text-ink-muted mb-1">
                                                    Custom Citation <span className="text-rose-500">*</span>
                                                </label>
                                                <input
                                                    id="custom-basis-input"
                                                    type="text"
                                                    required
                                                    maxLength={500}
                                                    className={inputClass}
                                                    value={customBasis}
                                                    onChange={e => {
                                                        setCustomBasis(e.target.value);
                                                        set('basis', e.target.value);
                                                    }}
                                                    placeholder="e.g. Board Resolution No. 2026-04"
                                                />
                                            </div>
                                        )}

                                        {/* Compact Statutory Classification Card */}
                                        <div className="p-2.5 bg-surface-muted rounded-md border border-line space-y-1.5">
                                            <div className="flex items-center justify-between text-[10px] text-ink-subtle">
                                                <span className="font-semibold uppercase tracking-wider text-ink-muted">Statutory Treatment</span>
                                                <span className="truncate max-w-[220px]" title={STATUTORY_BASIS_OPTIONS.find(opt => opt.id === basisSelection)?.citation}>
                                                    {STATUTORY_BASIS_OPTIONS.find(opt => opt.id === basisSelection)?.citation}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                                <div className="flex items-center justify-between bg-surface px-2.5 py-1.5 rounded border border-line text-ink-muted">
                                                    <span>SSS / PhilHealth / Pag-IBIG</span>
                                                    <span className="font-semibold text-ink">Excluded</span>
                                                </div>
                                                <div className="flex items-center justify-between bg-surface px-2.5 py-1.5 rounded border border-line text-ink-muted">
                                                    <span>13th Month Basic</span>
                                                    <span className="font-semibold text-ink">Excluded</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-1 border-t border-line">
                                            {needsValuation ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setApproveStep(1)}
                                                    className="h-8 px-3.5 border border-line bg-surface hover:bg-surface-muted text-ink-muted rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                                                >
                                                    ← Back to Wage Rate
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAction('');
                                                        setApproveStep(1);
                                                        setBasisSelection('dole_standard');
                                                        setCustomBasis('');
                                                    }}
                                                    className="h-8 px-3.5 border border-line bg-surface hover:bg-surface-muted text-ink-muted rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                disabled={!isStep2Valid}
                                                onClick={() => setApproveStep(needsValuation ? 3 : 2)}
                                                className="h-8 px-4 bg-ink hover:bg-slate-800 text-white rounded-md text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer"
                                            >
                                                Next: Final Review →
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Step 3 (or Step 2 if !needsValuation): Final Review & Authorization */}
                                {((needsValuation && approveStep === 3) || (!needsValuation && approveStep === 2)) && (
                                    <div className="space-y-3">
                                        {/* Verification Receipt Card */}
                                        <div className="p-3 bg-surface-muted rounded-lg border border-line space-y-2">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block">
                                                Approval Summary Receipt
                                            </span>
                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                    <span className="text-[10px] text-ink-subtle block">Requested Days</span>
                                                    <span className="font-bold font-mono text-ink">{days(pendingCash?.days)} days</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-ink-subtle block">Daily Rate</span>
                                                    <span className="font-bold font-mono text-ink">₱{reviewedRate.toFixed(2)}/day</span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-ink-subtle block">Gross Payout</span>
                                                    <span className="font-bold font-mono text-accent">
                                                        ₱{estimate == null ? '0.00' : estimate.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-[10px] text-ink-subtle block">Taxable Portion</span>
                                                    <span className="font-bold font-mono text-ink">
                                                        ₱{Number(taxableAmount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        <span className="text-[10px] font-normal text-ink-subtle ml-1">
                                                            ({taxTreatment === 'exempt' ? 'Exempt' : taxTreatment === 'taxable' ? 'Taxable' : 'Partial'})
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="pt-2 border-t border-line text-[11px] text-ink-muted flex items-center justify-between">
                                                <span>Disbursement Schedule</span>
                                                <span className="font-semibold text-ink">Weekly Factory Payroll</span>
                                            </div>
                                        </div>

                                        {/* Approval Remarks */}
                                        <div>
                                            <label htmlFor="approve-reason-input" className="block text-[11px] font-medium text-ink-muted mb-1">
                                                Approval Remarks <span className="text-ink-subtle font-normal">(Optional)</span>
                                            </label>
                                            <input
                                                id="approve-reason-input"
                                                type="text"
                                                maxLength={500}
                                                className={inputClass}
                                                value={form.reason || ''}
                                                onChange={e => set('reason', e.target.value)}
                                                placeholder="e.g. Approved for next weekly cutoff payroll disbursement"
                                            />
                                        </div>

                                        {/* Confirmation Checkbox */}
                                        <label className="flex items-start gap-2 text-[11px] text-ink-muted cursor-pointer pt-1">
                                            <input
                                                type="checkbox"
                                                required
                                                className="mt-0.5 h-3.5 w-3.5 rounded border-line text-accent focus:ring-accent"
                                                checked={form.confirmed}
                                                onChange={e => set('confirmed', e.target.checked)}
                                            />
                                            <span>I confirm this statutory cash-out authorization and reviewed entries.</span>
                                        </label>

                                        {/* Action Buttons */}
                                        <div className="flex items-center gap-2 pt-1 border-t border-line">
                                            <button
                                                type="button"
                                                onClick={() => setApproveStep(needsValuation ? 2 : 1)}
                                                className="h-8 px-3.5 border border-line bg-surface hover:bg-surface-muted text-ink-muted rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                                            >
                                                ← Back to Tax
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={!form.confirmed || saving}
                                                className="flex-1 h-8 bg-ink hover:bg-slate-800 text-white font-semibold rounded-md text-xs shadow-2xs transition-colors disabled:opacity-40 cursor-pointer"
                                            >
                                                {saving ? 'Processing…' : 'Authorize Cash-Out'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {['cash-out-reject', 'cash-out-correct', 'cash-out-cancel'].includes(action) && (
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label htmlFor="cashout-reason-input" className="block font-medium text-slate-700">
                                        {action === 'cash-out-reject'
                                            ? 'Rejection Reason'
                                            : action === 'cash-out-correct'
                                            ? 'Correction Note'
                                            : 'Cancellation Reason'}{' '}
                                        <span className="text-rose-500">*</span>
                                    </label>
                                    <span className="text-[10px] text-slate-400">{(form.reason || '').length}/500</span>
                                </div>
                                <textarea
                                    id="cashout-reason-input"
                                    required
                                    maxLength={500}
                                    rows={3}
                                    className="w-full bg-white border border-slate-200 rounded-md p-2 text-xs text-slate-800 font-medium focus:outline-none focus:border-slate-400 transition-colors shadow-2xs resize-none"
                                    value={form.reason || ''}
                                    onChange={e => set('reason', e.target.value)}
                                    placeholder={
                                        action === 'cash-out-reject'
                                            ? 'Enter the official reason for rejecting this cash-out request...'
                                            : action === 'cash-out-correct'
                                            ? 'Explain the required corrections...'
                                            : 'Enter reason for cancelling this request...'
                                    }
                                />
                                {action === 'cash-out-reject' && (
                                    <p className="mt-1 text-[11px] text-rose-700 bg-rose-50 px-2 py-1 rounded border border-rose-100">
                                        Rejecting releases the leave credits back to the employee's available balance.
                                    </p>
                                )}
                            </div>
                        )}

                        {action !== 'cash-out-approve' && (
                            <>
                                <label className="flex items-start gap-2 text-[11px] text-ink-muted cursor-pointer pt-1">
                                    <input
                                        type="checkbox"
                                        required
                                        className="mt-0.5 h-3.5 w-3.5 rounded border-line text-accent focus:ring-accent"
                                        checked={form.confirmed}
                                        onChange={e => set('confirmed', e.target.checked)}
                                    />
                                    <span>
                                        {action === 'cash-out-request'
                                            ? 'Submit for HR review and payroll processing.'
                                            : 'I confirm this cash-out change.'}
                                    </span>
                                </label>

                                <div className="flex items-center gap-2 pt-1">
                                    <button
                                        type="submit"
                                        disabled={
                                            !form.confirmed ||
                                            saving ||
                                            (['cash-out-reject', 'cash-out-correct', 'cash-out-cancel'].includes(action) &&
                                                !form.reason?.trim())
                                        }
                                        className={`flex-1 h-8 text-white font-semibold rounded-md text-xs shadow-2xs transition-colors disabled:opacity-40 cursor-pointer ${
                                            action === 'cash-out-reject'
                                                ? 'bg-danger hover:bg-danger-ink'
                                                : 'bg-ink hover:bg-slate-800'
                                        }`}
                                    >
                                        {saving
                                            ? 'Processing…'
                                            : action === 'cash-out-reject'
                                            ? 'Confirm Rejection'
                                            : 'Confirm'}
                                    </button>
                                    <button
                                        type="button"
                                        className="h-8 px-3.5 border border-line bg-surface hover:bg-surface-muted text-ink-muted rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
                                        onClick={() => {
                                            setAction('');
                                            setBasisSelection('dole_standard');
                                            setCustomBasis('');
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </>
                        )}
                    </fieldset>
                </form>
            )}

            {/* Admin Starting Balance Form */}
            {canReview && ['setup', 'reconcile'].includes(action) && (
                <form onSubmit={submit} className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                    <fieldset disabled={saving} className="space-y-2">
                        <h4 className="font-semibold text-slate-800 border-b border-slate-200 pb-1.5">
                            {action === 'reconcile' ? 'Reconcile Balance' : 'Configure Starting Balance'}
                        </h4>
                        <div>
                            <label htmlFor="opening-sil-input" className="block font-medium text-slate-700 mb-1">
                                Verified Remaining Days
                            </label>
                            <input
                                id="opening-sil-input"
                                type="number"
                                required
                                min="0"
                                max="366"
                                step="0.001"
                                className={inputClass}
                                value={form.opening_sil}
                                onChange={e => set('opening_sil', e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor="balance-reason-input" className="block font-medium text-slate-700 mb-1">
                                Audit Note
                            </label>
                            <textarea
                                id="balance-reason-input"
                                required
                                maxLength={500}
                                rows="2"
                                className="w-full bg-white border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-slate-400"
                                value={form.reason}
                                onChange={e => set('reason', e.target.value)}
                            />
                        </div>
                        <label className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer">
                            <input
                                type="checkbox"
                                required
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                checked={form.confirmed}
                                onChange={e => set('confirmed', e.target.checked)}
                            />
                            <span>I verified past leave records.</span>
                        </label>
                        <div className="flex items-center gap-2 pt-1">
                            <button
                                type="submit"
                                disabled={!form.confirmed || saving}
                                className="flex-1 h-7 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded text-xs transition-colors disabled:opacity-40 cursor-pointer"
                            >
                                {saving ? 'Saving...' : 'Confirm'}
                            </button>
                            <button
                                type="button"
                                className="h-7 px-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded text-xs font-semibold cursor-pointer"
                                onClick={() => setAction('')}
                            >
                                Cancel
                            </button>
                        </div>
                    </fieldset>
                </form>
            )}
        </section>
    );
}
