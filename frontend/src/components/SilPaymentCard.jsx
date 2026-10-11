import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getUser } from '../routes/guards';
import { isCreditManager, validateCreditCommand, getLeaveCreditAllocationMessage } from '../../../shared/leavePolicy.js';
import { fetchWithAuth } from '../utils/api';
import useEmployeeLeaveCredits, { leaveCreditKey, readLeaveCreditResponse } from '../utils/useEmployeeLeaveCredits';

const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs';
const money = amount => Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 1. Cash Earnings Breakdown (Payslip Line Item)
 */
export function SilCashEarnings({ payroll }) {
    if (!(Number(payroll?.sil_cash_pay) > 0)) return null;
    const lines = Array.isArray(payroll.sil_cash_lines) ? payroll.sil_cash_lines : [];
    return <div className="space-y-1 py-1 text-xs text-slate-700">
        <div className="flex justify-between gap-3"><span>SIL Cash Conversion</span><span>PHP {money(payroll.sil_cash_pay)}</span></div>
        {lines.map(line => <div key={line.request_id} className="flex justify-between gap-3 text-[11px] text-slate-500">
            <span>{Number(line.days)} days × PHP {money(line.daily_rate)}{line.conversion_on ? ` · ${line.conversion_on}` : ''}</span><span>PHP {money(line.amount)}</span>
        </div>)}
    </div>;
}

/**
 * 2. Payroll Payment Confirmation (Manager Net Pay Receipt)
 */
export function SilPayrollPayment({ payroll }) {
    const client = useQueryClient();
    const [reference, setReference] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const request = useRef(null);
    const busy = useRef(false);
    const canManage = isCreditManager(getUser());
    if (!canManage || payroll?.status !== 'Pending' || !payroll?.sil_cash_lines?.length) return null;
    const submit = async event => {
        event.preventDefault();
        if (busy.current || !confirmed || !reference.trim()) return;
        const fingerprint = `${payroll.id}:${reference.trim()}`;
        if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
        busy.current = true; setSaving(true);
        try {
            await readLeaveCreditResponse(await fetchWithAuth(`/api/payroll/${payroll.id}/confirm-sil-payment`, {
                method: 'POST', body: JSON.stringify({ operation_id: request.current.id, reference: reference.trim() }),
            }));
            await Promise.all(['payroll', 'adminPayrolls', 'employeeLeaveCredits', 'employeeDashboard', 'silCashOutQueue'].map(key => client.invalidateQueries({ queryKey: [key] })));
            toast.success('Payment recorded.');
        } catch (error) { toast.error(error.message || 'Unable to confirm payment. Retry with the same reference.'); }
        finally { busy.current = false; setSaving(false); }
    };
    return <form onSubmit={submit} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden" aria-label="Confirm payroll payment">
        <h3 className="text-sm font-semibold">Awaiting payment confirmation</h3>
        <fieldset disabled={saving} className="space-y-3">
            <label className="block text-xs font-medium">Completed payment reference<input required maxLength="120" value={reference} onChange={event => setReference(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
            <label className="flex gap-2 text-xs"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm the employee received this payslip's net payment.</label>
            <button type="submit" disabled={saving || !confirmed || !reference.trim()} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Confirm payment received'}</button>
        </fieldset>
    </form>;
}

/**
 * 3. Direct Cash Payment Recording (HR Direct Settlement)
 */
export function SilCashPayment({ employeeId, employee }) {
    const user = getUser();
    const queryClient = useQueryClient();
    const query = useEmployeeLeaveCredits(employeeId);
    const canManage = Boolean(user?.id) && isCreditManager(user);
    const verifiedAccount = query.data?.account && ['ready', 'employee_inactive'].includes(query.data.allocation_status);
    const canRecordPayment = canManage && !query.isError && !query.isPending && !query.isLoading && verifiedAccount;
    const [action, setAction] = useState('');
    const [saving, setSaving] = useState(false);
    const request = useRef(null);
    const busy = useRef(false);
    const [form, setForm] = useState({ days: '', daily_rate: employee?.daily_rate || '', payment_reference: '', confirmed: false });
    const set = (name, value) => setForm(previous => ({ ...previous, [name]: value }));
    const submit = async event => {
        event.preventDefault();
        if (busy.current || !canRecordPayment || !form.confirmed || action !== 'cash-conversion') return;
        try {
            const payload = { employee_id: employeeId, reason: 'Completed SIL cash payment recorded.', days: Number(form.days), daily_rate: Number(form.daily_rate), payment_reference: form.payment_reference };
            const fingerprint = JSON.stringify(payload);
            if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
            const body = validateCreditCommand('cash_conversion', { ...payload, request_id: request.current.id });
            busy.current = true; setSaving(true);
            const data = await readLeaveCreditResponse(await fetchWithAuth('/api/leaves/credits/cash-conversion', { method: 'POST', body: JSON.stringify(body) }));
            if (data?.allocation_status) queryClient.setQueryData(leaveCreditKey(user.id, employeeId), data);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: leaveCreditKey(user.id, employeeId), exact: true }),
                queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', user.id, employeeId] }),
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', employeeId] }),
                queryClient.invalidateQueries({ queryKey: ['adminLeaves', user.id] }),
                queryClient.invalidateQueries({ queryKey: ['payrollLeavePay'] }),
            ]);
            request.current = null; setAction('');
            setForm(previous => ({ ...previous, days: '', payment_reference: '', confirmed: false }));
            toast.success('Cash payment recorded.');
        } catch (error) {
            toast.error(error.message || 'Unable to record payment. Refresh before retrying.');
            if (busy.current) query.refetch();
        } finally { busy.current = false; setSaving(false); }
    };
    if (!employeeId || !canManage) return null;
    return <div className="space-y-3" aria-label="Completed SIL payment">
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-600">{query.isPending || query.isLoading ? 'Loading leave credits...' : query.isError ? null : verifiedAccount ? `Available: ${Number(query.data.sil_balance).toLocaleString('en-PH', { maximumFractionDigits: 3 })} days` : getLeaveCreditAllocationMessage(query.data)}</span>
            <button type="button" disabled={query.isFetching || saving} className="font-semibold text-accent disabled:opacity-50" onClick={() => query.refetch()}>Refresh</button>
        </div>
        {query.isError && <p role="alert" className="text-xs text-danger-ink">{query.error.message}</p>}
        {canRecordPayment && <button type="button" disabled={saving} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50" onClick={() => { setAction('cash-conversion'); set('confirmed', false); }}>Record cash payment</button>}
        {canRecordPayment && action === 'cash-conversion' && <form onSubmit={submit} className="space-y-2.5 rounded-md border border-slate-200 bg-slate-50/40 p-3">
            <fieldset disabled={saving} className="space-y-2.5">
                <label className="block text-xs font-medium text-slate-700">Days paid out<input type="number" required min="0.001" max="366" step="0.001" className={inputClass} value={form.days} onChange={e => set('days', e.target.value)} /></label>
                <label className="block text-xs font-medium text-slate-700">Daily rate at conversion (₱)<input type="number" required min="0.01" max="1000000" step="0.01" className={inputClass} value={form.daily_rate} onChange={e => set('daily_rate', e.target.value)} /></label>
                <label className="block text-xs font-medium text-slate-700">Completed payment reference<input required maxLength="120" className={inputClass} value={form.payment_reference} onChange={e => set('payment_reference', e.target.value)} /></label>
                <p className="text-[11px] leading-snug text-slate-500">Cash equivalent: ₱{(Number(form.days || 0) * Number(form.daily_rate || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. This records a completed payment; it does not transfer funds.</p>
                <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-600"><input type="checkbox" required checked={form.confirmed} onChange={e => set('confirmed', e.target.checked)} />I confirm this SIL payment, rate, reference, and days are correct.</label>
                <div className="flex gap-2 pt-0.5"><button type="submit" disabled={!form.confirmed || saving} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Confirm'}</button><button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700" onClick={() => setAction('')}>Cancel</button></div>
            </fieldset>
        </form>}
    </div>;
}

/**
 * Consolidated Unified Component
 */
export default function SilPaymentCard({ variant, payroll, employeeId, employee, silCashPay = 0, className = '' }) {
    if (variant === 'earnings') {
        return <SilCashEarnings payroll={payroll} />;
    }
    if (variant === 'confirm') {
        return <SilPayrollPayment payroll={payroll} />;
    }
    if (variant === 'record') {
        return <SilCashPayment employeeId={employeeId} employee={employee} />;
    }
    if (variant === 'badge' || silCashPay > 0) {
        if (silCashPay <= 0) return null;
        return <div className={`rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700 ${className}`}>
            SIL cash payout: PHP {money(silCashPay)}
        </div>;
    }
    // If payroll is provided without explicit variant:
    if (payroll) {
        return <>
            <SilPayrollPayment payroll={payroll} />
            <SilCashEarnings payroll={payroll} />
        </>;
    }
    if (employeeId) {
        return <SilCashPayment employeeId={employeeId} employee={employee} />;
    }
    return null;
}
