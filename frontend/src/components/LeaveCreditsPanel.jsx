import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { getUser } from '../routes/guards';
import { getDisciplinaryCache } from '../utils/disciplinaryCache';
import {
    calculateSilConversion,
    validateCashOutRequest,
    validateCashOutDecision,
    validateCashOutTransition,
    CASH_OUT_LABELS,
    isCreditManager,
    validateCreditCommand,
    getLeaveCreditAllocationMessage,
} from '../../../shared/leavePolicy.js';
import { getEmployeeRestDays } from '../../../shared/workPolicy.mjs';
import { isBoundedDecimalInput } from '../../../shared/inputLimits.mjs';
import useEmployeeLeaveCredits, { leaveCreditKey, readLeaveCreditResponse } from '../utils/useEmployeeLeaveCredits';

const days = value => Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 });
const inputClass =
    'w-full h-8 bg-white border border-slate-200 rounded-md px-2.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 transition-colors shadow-2xs';

const STATUTORY_BASIS_OPTIONS = [
    {
        id: 'dole_standard',
        value: 'DOLE Book III Art. 95 / Non-basic wage exclusion',
        label: 'DOLE Book III Art. 95 (Standard SIL Encashment)',
        citation: 'Labor Code of the Philippines, Book III, Article 95 & Omnibus Rules',
        description:
            'Statutory exemption: Excluded from SSS, PhilHealth, Pag-IBIG salary credits and 13th-month basic pay. De minimis tax-exempt up to 10 days.',
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

const formatDate = value => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

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
    const canManage = Boolean(user?.id) && manage && isCreditManager(user);
    const queryClient = useQueryClient();
    const query = useEmployeeLeaveCredits(employeeId);
    const [liveDisciplinary, setLiveDisciplinary] = useState(() => getDisciplinaryCache(employeeId));

    useEffect(() => {
        if (!employeeId) return;
        setLiveDisciplinary(getDisciplinaryCache(employeeId));

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
    const isCooldownActive = Boolean(cooldownExpiry && cooldownExpiry.getTime() > Date.now());

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
        const diffMs = cooldownExpiry.getTime() - Date.now();
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
    const [form, setForm] = useState({
        days: '',
        opening_sil: '',
        reason: '',
        taxable_amount: '',
        basis: STATUTORY_BASIS_OPTIONS[0].value,
        confirmed: false,
    });

    let estimate = null;
    try {
        estimate = calculateSilConversion(form.days || convertible, employee?.daily_rate || employee?.daily_pay || 0);
    } catch {
        /* rate pending */
    }

    const set = (name, value) => setForm(previous => ({ ...previous, [name]: value }));

    const submit = async event => {
        event.preventDefault();
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
                    if (String(form.taxable_amount ?? '').trim() === '') {
                        throw new Error('Review the amount subject to tax before approving.');
                    }
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
                          taxable_amount: action === 'cash-out-approve' ? Number(form.taxable_amount) : null,
                          expected_daily_rate:
                              action === 'cash-out-approve'
                                  ? Number(employee?.daily_rate || employee?.daily_pay || 0)
                                  : null,
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
                                        <span className="text-slate-400">Value:</span>{' '}
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
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                        Cash-out: {days(pendingCash.days)}d (₱
                        {(
                            Number(pendingCash.days) * Number(employee?.daily_rate || employee?.daily_pay || 0)
                        ).toFixed(2)}
                        )
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            disabled={saving}
                            className="h-7 px-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded text-xs transition-colors cursor-pointer"
                            onClick={() => {
                                setAction('cash-out-approve');
                                setBasisSelection('dole_standard');
                                setCustomBasis('');
                                setForm(p => ({
                                    ...p,
                                    taxable_amount: '0.00',
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
                            className="h-7 px-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded text-xs font-semibold transition-colors cursor-pointer"
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
                <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs">
                    <fieldset disabled={saving} className="space-y-2.5">
                        {action !== 'cash-out-request' && (
                            <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                                <h4 className="font-semibold text-slate-900">
                                    {action === 'cash-out-approve'
                                        ? 'Approve Cash-Out'
                                        : action === 'cash-out-reject'
                                        ? 'Reject Cash-Out'
                                        : 'Update Cash-Out'}
                                </h4>
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
                                    <span>₱{Number(employee?.daily_rate || employee?.daily_pay || 0).toFixed(2)}/day</span>
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
                            <div className="space-y-3">
                                <div>
                                    <label htmlFor="taxable-amount-input" className="block font-medium text-slate-700 mb-1">
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
                                        value={form.taxable_amount}
                                        onChange={e => { if (isBoundedDecimalInput(e.target.value, 366000000, true)) set('taxable_amount', e.target.value); }}
                                        placeholder="0.00"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">
                                        Under BIR RR 5-2011 / RR 11-2018, monetization of unused vacation / SIL credits up to 10
                                        days is de minimis tax-exempt.
                                    </p>
                                </div>

                                <div>
                                    <label htmlFor="approve-basis-select" className="block font-medium text-slate-700 mb-1">
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
                                        <label htmlFor="custom-basis-input" className="block font-medium text-slate-700 mb-1">
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

                                {/* Clean Statutory Classification Box */}
                                <div className="p-3 bg-white rounded-md border border-slate-200 space-y-1.5">
                                    <span className="font-semibold text-slate-700 uppercase tracking-wider text-[10px] block">
                                        Statutory Classification &amp; Treatment
                                    </span>
                                    <p className="text-[11px] text-slate-600 leading-relaxed">
                                        {STATUTORY_BASIS_OPTIONS.find(opt => opt.id === basisSelection)?.description}
                                    </p>
                                    <div className="text-[10px] text-slate-400">
                                        Citation: {STATUTORY_BASIS_OPTIONS.find(opt => opt.id === basisSelection)?.citation}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-[11px]">
                                        <div className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded text-slate-600">
                                            <span>SSS / PhilHealth / Pag-IBIG</span>
                                            <span className="font-semibold text-slate-900">Excluded</span>
                                        </div>
                                        <div className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded text-slate-600">
                                            <span>13th Month Basic</span>
                                            <span className="font-semibold text-slate-900">Excluded</span>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="approve-reason-input" className="block font-medium text-slate-700 mb-1">
                                        Approval Remarks <span className="text-slate-400 font-normal">(Optional)</span>
                                    </label>
                                    <input
                                        id="approve-reason-input"
                                        type="text"
                                        maxLength={500}
                                        className={inputClass}
                                        value={form.reason || ''}
                                        onChange={e => set('reason', e.target.value)}
                                        placeholder="e.g. Approved for next cutoff payroll disbursement"
                                    />
                                </div>
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

                        <label className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer pt-1">
                            <input
                                type="checkbox"
                                required
                                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
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
                                        !form.reason?.trim()) ||
                                    (action === 'cash-out-approve' && basisSelection === 'custom' && !customBasis.trim())
                                }
                                className={`flex-1 h-7 text-white font-semibold rounded text-xs shadow-2xs transition-colors disabled:opacity-40 cursor-pointer ${
                                    action === 'cash-out-reject'
                                        ? 'bg-rose-600 hover:bg-rose-700'
                                        : 'bg-slate-900 hover:bg-slate-800'
                                }`}
                            >
                                {saving
                                    ? 'Processing...'
                                    : action === 'cash-out-reject'
                                    ? 'Confirm Rejection'
                                    : action === 'cash-out-approve'
                                    ? 'Confirm Approval'
                                    : 'Confirm'}
                            </button>
                            <button
                                type="button"
                                className="h-7 px-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded text-xs font-semibold cursor-pointer"
                                onClick={() => {
                                    setAction('');
                                    setBasisSelection('dole_standard');
                                    setCustomBasis('');
                                }}
                            >
                                Cancel
                            </button>
                        </div>
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
