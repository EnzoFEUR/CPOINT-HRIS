import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getUser } from '../routes/guards';
import { fetchWithAuth } from '../utils/api';
import { supabase } from '../supabaseClient';
import { fetchEmployeeLeaveCredits, leaveCreditKey } from '../utils/useEmployeeLeaveCredits';
import { getLeaveApprovalBlock, isCreditLeaveType, LEAVE_REQUEST_TYPES, validateLeaveFilingDates, validateLeaveRequest, validateLeaveWorkdayEndpoints } from '../../../shared/leavePolicy.js';
import LeaveDatePicker from './LeaveDatePicker';
import { getEmployeeRestDays, getManilaWorkDate } from '../../../shared/workPolicy.mjs';

const emptyForm = { leave_type: 'Sick Leave', start_date: '', end_date: '', reason: '', requested_pay_type: '' };


export default function EmployeeLeaveRequest({ open, employee, statusReady, blockedReason, onClose }) {
    const actorId = getUser()?.id;
    const queryClient = useQueryClient();
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const busy = useRef(false);
    const dialog = useRef(null);
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);
    const set = (name, value) => { setForm(previous => ({ ...previous, [name]: value })); setError(''); };
    const creditType = isCreditLeaveType(form.leave_type);
    const schedule = useQuery({
        queryKey: ['employeeLeaveRequestSchedule', actorId, employee.id],
        enabled: Boolean(open && actorId && employee.id && statusReady && !blockedReason),
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth(`/api/leaves/schedule?employee_id=${encodeURIComponent(employee.id)}`, { signal });
            const body = await response.json();
            if (!response.ok || !body.success || !Array.isArray(body.data?.rest_days)) throw new Error(body.error || 'Unable to load your rest days.');
            return {
                ...body.data,
                rest_days: getEmployeeRestDays(body.data),
                holidays: Array.isArray(body.data?.holidays) ? body.data.holidays : []
            };
        },
        staleTime: 15000, refetchInterval: open ? 60000 : false, refetchIntervalInBackground: false,
        refetchOnWindowFocus: true, refetchOnReconnect: true, retry: false,
    });
    const scheduleUnavailable = !schedule.data || schedule.isError || schedule.isFetching;
    const today = getManilaWorkDate();
    const minimumDate = schedule.data?.date_hired > today ? schedule.data.date_hired : today;
    let restError = '';
    try { if (schedule.data) validateLeaveWorkdayEndpoints(form, schedule.data); }
    catch (error) { restError = error.message; }
    let rangeError = '';
    try { validateLeaveFilingDates(form.start_date, form.end_date, today); }
    catch (error) { rangeError = error.message; }
    const previewKey = ['employeeLeaveRequestPreview', actorId, employee.id, form.start_date, form.end_date];
    const preview = useQuery({
        queryKey: previewKey,
        enabled: Boolean(open && actorId && employee.id && statusReady && !blockedReason && !rangeError && !restError && !scheduleUnavailable),
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ employee_id: employee.id, start_date: form.start_date, end_date: form.end_date });
            const response = await fetchWithAuth(`/api/leaves/preview?${params}`, { signal });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to verify your schedule.');
            return body.data;
        },
        staleTime: 15000, refetchInterval: open ? 60000 : false, refetchIntervalInBackground: false,
        refetchOnWindowFocus: true, refetchOnReconnect: true, retry: false,
    });
    // Reuse the dashboard cache and its single credit realtime subscription.
    const paidRequest = creditType && form.requested_pay_type === 'with_pay';
    const credits = useQuery({ queryKey: leaveCreditKey(actorId, employee.id), queryFn: ({ signal }) => fetchEmployeeLeaveCredits(employee.id, signal),
        enabled: Boolean(open && actorId && paidRequest && statusReady && !blockedReason), staleTime: 15000, retry: false });
    const creditPreview = useQuery({
        queryKey: ['leaveCreditPreview', actorId, employee.id, form.start_date, form.end_date],
        enabled: Boolean(open && actorId && paidRequest && statusReady && !blockedReason && !rangeError && !restError && !scheduleUnavailable),
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ employee_id: employee.id, start_date: form.start_date, end_date: form.end_date });
            const response = await fetchWithAuth(`/api/leave-credits/preview?${params}`, { signal });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to verify chargeable credit dates.');
            return body.data;
        },
        staleTime: 15000, refetchInterval: open ? 60000 : false, refetchIntervalInBackground: false,
        refetchOnWindowFocus: true, refetchOnReconnect: true, retry: false,
    });
    const paymentBlock = creditType && !form.requested_pay_type ? 'Choose paid or unpaid leave.' : paidRequest ? getLeaveApprovalBlock({
        leave: { ...form, requested_credit_pool: paidRequest ? 'sil' : null, type: form.leave_type, status: 'New' }, payType: form.requested_pay_type, creditPool: 'sil',
        snapshot: credits.data, preview: creditPreview.data,
        checking: credits.isFetching || credits.isLoading || creditPreview.isFetching || creditPreview.isLoading,
        error: credits.error?.message || creditPreview.error?.message || '',
    }) : '';
    useEffect(() => {
        if (!open || !actorId || !employee.id) return;
        let stopped = false;
        let timer;
        const refresh = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (stopped) return;
                queryClient.invalidateQueries({ queryKey: ['employeeLeaveRequestSchedule', actorId, employee.id], exact: true });
                queryClient.invalidateQueries({ queryKey: ['employeeLeaveRequestPreview', actorId, employee.id] });
                queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', actorId, employee.id] });
            }, 150);
        };
        const channel = supabase.channel(`employee-leave-request-${employee.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${employee.id}` }, refresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, refresh)
            .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
        return () => { stopped = true; clearTimeout(timer); supabase.removeChannel(channel); };
    }, [open, actorId, employee.id, queryClient]);
    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement;
        dialog.current?.querySelector('select')?.focus();
        const keydown = event => {
            if (event.key === 'Escape') { event.preventDefault(); if (!busy.current) close.current(); }
            if (event.key !== 'Tab') return;
            const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary:not([aria-disabled="true"])')].filter(control => control.getClientRects().length > 0);
            const first = controls[0], last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); dialog.current.focus(); }
            else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.removeEventListener('keydown', keydown); if (opener?.isConnected) opener.focus(); };
    }, [open]);
    const zeroWorkdays = creditType && preview.data?.days === 0;
    const refreshRequests = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employeeDashboard', employee.id], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['adminLeaves'] }),
        queryClient.invalidateQueries({ queryKey: ['employeeMonthlyAttendance', employee.id] }),
        ...(paidRequest ? [queryClient.invalidateQueries({ queryKey: leaveCreditKey(actorId, employee.id), exact: true }), queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', actorId, employee.id] })] : []),
    ]);
    const submit = async event => {
        event.preventDefault();
        if (busy.current) return;
        setError('');
        try {
            if (!statusReady || blockedReason) throw new Error(blockedReason || 'Refresh your account status before filing.');
            if (rangeError || restError || scheduleUnavailable || !preview.data || preview.isError || preview.isFetching || zeroWorkdays) throw new Error('Verify a valid scheduled leave range before submitting.');
            if (paymentBlock) throw new Error(paymentBlock);
            const payload = validateLeaveRequest({ employee_id: employee.id, ...form, requested_pay_type: creditType ? form.requested_pay_type : undefined, requested_credit_pool: paidRequest ? 'sil' : null });
            busy.current = true;
            setSaving(true);
            const response = await fetchWithAuth('/api/leaves', { method: 'POST', body: JSON.stringify(payload) });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to submit your leave request.');
            setForm(emptyForm);
            onClose();
            toast.success('Leave request submitted. Pending HR review.');
            await refreshRequests();
        } catch (error) {
            setError(error.message || 'Unable to submit. Refresh recent requests before retrying.');
            if (busy.current) await refreshRequests();
        } finally { busy.current = false; setSaving(false); }
    };

    useEffect(() => {
        if (!open) return;
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [open]);

    if (!open) return null;
    const requestClose = () => { if (!busy.current) onClose(); };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div
                className="fixed inset-0 w-screen h-screen min-h-[100dvh] bg-slate-950/75 backdrop-blur-xs transition-opacity"
                onClick={requestClose}
                aria-hidden="true"
            />
            <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="employee-leave-title" tabIndex={-1} className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 overflow-visible my-auto">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                        <i className="ti ti-calendar-plus text-base" />
                    </div>
                    <div>
                        <h2 id="employee-leave-title" className="text-base font-bold text-slate-900">File Leave Request</h2>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={requestClose}
                    disabled={saving}
                    className="w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors disabled:opacity-50"
                    aria-label="Close modal"
                >
                    <i className="ti ti-x text-sm" />
                </button>
            </div>
            <form onSubmit={submit} className="space-y-3.5 pt-3">
                <fieldset disabled={saving || Boolean(blockedReason) || !statusReady} className="space-y-3 disabled:opacity-60">
                    {/* Row 1: Leave Type & Payment Preference */}
                    <div className={`grid grid-cols-1 ${creditType ? 'sm:grid-cols-2' : ''} gap-3`}>
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Type</label>
                            <select
                                required
                                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs"
                                value={form.leave_type}
                                onChange={e => set('leave_type', e.target.value)}
                            >
                                {LEAVE_REQUEST_TYPES.map(type => (
                                    <option key={type}>{type}</option>
                                ))}
                            </select>
                        </div>

                        {creditType && (
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Preference</label>
                                <select
                                    required
                                    className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs"
                                    value={form.requested_pay_type}
                                    onChange={e => set('requested_pay_type', e.target.value)}
                                >
                                    <option value="">Select paid or unpaid</option>
                                    <option value="with_pay">Paid Leave (SIL)</option>
                                    <option value="without_pay">Unpaid Leave</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Row 2: Start Date & End Date with directional alignment */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <LeaveDatePicker
                            label="Start Date"
                            value={form.start_date}
                            min={minimumDate}
                            restDays={creditType ? schedule.data?.rest_days || [] : []}
                            holidays={schedule.data?.holidays || []}
                            disabled={saving || Boolean(blockedReason) || !statusReady || scheduleUnavailable}
                            align="left"
                            placeholder="Select start date"
                            onChange={date => { set('start_date', date); if (!form.end_date || form.end_date < date) set('end_date', date); }}
                        />
                        <LeaveDatePicker
                            label="End Date"
                            value={form.end_date}
                            min={form.start_date > minimumDate ? form.start_date : minimumDate}
                            max={form.start_date ? new Date(Date.parse(form.start_date) + 365 * 86400000).toISOString().slice(0, 10) : undefined}
                            restDays={creditType ? schedule.data?.rest_days || [] : []}
                            holidays={schedule.data?.holidays || []}
                            disabled={saving || Boolean(blockedReason) || !statusReady || scheduleUnavailable}
                            align="right"
                            placeholder="Select end date"
                            onChange={date => set('end_date', date)}
                        />
                    </div>

                    {form.start_date && form.end_date && rangeError && (
                        <p role="alert" className="text-xs text-danger-ink">{rangeError}</p>
                    )}

                    {/* Real-time Workdays Estimation */}
                    {preview.data && preview.data.days > 0 && (
                        <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-accent-subtle/40 border border-accent/20 text-xs">
                            <span className="text-slate-700 font-medium flex items-center gap-1.5">
                                <i className="ti ti-calendar-stats text-accent" />
                                <span>Chargeable Workdays:</span>
                            </span>
                            <span className="font-bold text-accent font-mono">
                                {preview.data.days} {preview.data.days === 1 ? 'workday' : 'workdays'}
                            </span>
                        </div>
                    )}

                    {paidRequest && (
                        <div aria-live="polite" className="text-xs">
                            {paymentBlock && (
                                <p role="status" className="text-warning-ink bg-warning-subtle p-2 rounded-md border border-warning/20">
                                    {paymentBlock}
                                </p>
                            )}
                            {(credits.isError || creditPreview.isError) && (
                                <button type="button" className="text-xs text-accent underline font-semibold mt-1" onClick={() => { credits.refetch(); creditPreview.refetch(); }}>
                                    Retry credit check
                                </button>
                            )}
                        </div>
                    )}

                    {!creditType && (
                        <p className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-md border border-slate-100">
                            This benefit has separate statutory entitlement rules. HR will verify your qualification upon review.
                        </p>
                    )}

                    {/* Row 3: Reason for Leave */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-semibold text-slate-700">Reason for Leave</label>
                            <span className="text-[10px] text-slate-400 font-mono">{form.reason.length}/255</span>
                        </div>
                        <textarea
                            required
                            maxLength={255}
                            rows={2}
                            placeholder="Provide details for HR review..."
                            className="w-full bg-white border border-slate-200 rounded-md p-2.5 text-xs text-slate-800 font-medium focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors shadow-2xs resize-none"
                            value={form.reason}
                            onChange={e => set('reason', e.target.value)}
                        />
                    </div>
                </fieldset>

                {(blockedReason || !statusReady || error) && (
                    <p role="alert" className="text-xs text-danger-ink bg-danger-subtle p-2.5 rounded-md border border-danger/20">
                        {blockedReason || (!statusReady ? 'Refresh your account status before filing.' : error)}
                    </p>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                    <button
                        type="button"
                        disabled={saving}
                        onClick={requestClose}
                        className="h-8 px-4 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-2xs"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !statusReady || Boolean(blockedReason) || Boolean(rangeError) || Boolean(restError) || scheduleUnavailable || !form.reason.trim() || !preview.data || preview.isFetching || preview.isError || zeroWorkdays || Boolean(paymentBlock)}
                        className="h-8 px-4 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-md shadow-2xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {saving && <i className="ti ti-loader-2 animate-spin text-xs" />}
                        <span>{saving ? 'Submitting...' : 'Submit Request'}</span>
                    </button>
                </div>
            </form>
        </div>
    </div>,
    document.body
    );
}
