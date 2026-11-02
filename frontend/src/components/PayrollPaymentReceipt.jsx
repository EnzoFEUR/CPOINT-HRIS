import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getUser } from '../routes/guards';
import { supabase } from '../supabaseClient';
import { fetchWithAuth } from '../utils/api';
import { formatCurrency } from '../utils/payslipUtils';

const inputClass = 'mt-1 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
const timestamp = value => value ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '';
async function readResponse(response) {
    let body;
    try { body = await response.json(); }
    catch { throw new Error('Payment status could not be read. Refresh before retrying.'); }
    if (!response.ok || !body.success || !body.data) throw new Error(body.error || 'Unable to load payment confirmation.');
    return body.data;
}

export default function PayrollPaymentReceipt({ payroll }) {
    const actorId = getUser()?.id;
    const client = useQueryClient();
    const payrollId = payroll.id;
    const queryKey = ['payrollPaymentReceipt', actorId, payrollId];
    const endpoint = `/api/payroll/payment-receipts/${encodeURIComponent(payrollId)}`;
    const query = useQuery({
        queryKey, queryFn: async ({ signal }) => readResponse(await fetchWithAuth(endpoint, { signal })),
        enabled: Boolean(actorId && payrollId), staleTime: 10000, refetchInterval: 30000,
        refetchIntervalInBackground: false, refetchOnWindowFocus: true, retry: false,
    });
    const [reference, setReference] = useState('');
    const [today] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
    const [date, setDate] = useState(null);
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const busy = useRef(false);
    const request = useRef(null);

    useEffect(() => {
        if (!actorId || !payrollId) return;
        const refresh = () => client.invalidateQueries({ queryKey: ['payrollPaymentReceipt', actorId, payrollId], exact: true });
        const channel = supabase.channel(`payroll-payment-${payrollId}`, { config: { private: true } })
            .on('broadcast', { event: 'PAYROLL_UPDATED' }, refresh)
            .on('broadcast', { event: 'PAYROLL_PAYMENT_UPDATED' }, refresh)
            .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
        return () => { supabase.removeChannel(channel); };
    }, [actorId, payrollId, client]);

    const payment = query.data?.payment;
    const paymentDate = date ?? query.data?.server_date ?? today;
    const submit = async event => {
        event.preventDefault();
        if (busy.current || !confirmed || query.isError) return;
        const action = payment ? 'acknowledge' : 'record';
        if ((action === 'record' && !query.data?.can_record) || (action === 'acknowledge' && !query.data?.can_acknowledge)) return;
        const payload = action === 'record' ? { reference: reference.trim(), payment_date: paymentDate, confirmed: true }
            : { payment_operation_id: payment.operation_id, confirmed: true };
        const fingerprint = JSON.stringify([payrollId, action, payload]);
        if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
        busy.current = true; setSaving(true); setError(null);
        try {
            const data = await readResponse(await fetchWithAuth(`${endpoint}/${action}`, { method: 'POST', body: JSON.stringify({ ...payload, operation_id: request.current.id }) }));
            client.setQueryData(queryKey, data);
            setConfirmed(false);
            if (action === 'record') {
                for (const key of ['payroll', 'adminPayrolls', 'employeeDashboard', 'silCashOutQueue', 'employeeLeaveCredits']) client.invalidateQueries({ queryKey: [key] });
            }
            toast.success(action === 'record' ? 'Payment recorded.' : 'Payment receipt acknowledged.');
        } catch (cause) {
            setError({ action, message: cause.message || 'Unable to save. Refresh before retrying.' });
            client.invalidateQueries({ queryKey, exact: true });
        } finally { busy.current = false; setSaving(false); }
    };

    if (query.isPending) return <p role="status" className="mb-4 text-xs text-slate-500 print:hidden">Loading payment confirmation…</p>;
    if (query.isError) return <div role="alert" className="mb-4 rounded-lg border border-slate-200 p-4 text-sm print:hidden"><p>{query.error.message}</p><button type="button" disabled={query.isFetching} onClick={() => query.refetch()} className="mt-2 font-semibold underline disabled:opacity-50">Retry payment status</button></div>;
    if (!query.data) return null;
    const canRecord = query.data.can_record;
    const canAcknowledge = query.data.can_acknowledge;
    const title = payment?.acknowledged_at ? 'Employee acknowledged payment' : payment ? 'Payment recorded · Awaiting employee acknowledgment' : Number(query.data.net_pay) <= 0 ? 'No payment due' : 'Awaiting payment record';

    return <section aria-label="Payslip payment confirmation" className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-slate-800 print:hidden">
        <h3 role="status" className="text-sm font-semibold">{title}</h3>
        {payment && <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div><dt className="text-slate-500">Net payment</dt><dd className="mt-1 font-semibold">{formatCurrency(payment.net_pay)}</dd></div>
            <div className="min-w-0"><dt className="text-slate-500">Payment reference</dt><dd className="mt-1 break-all font-medium">{payment.reference}</dd></div>
            <div><dt className="text-slate-500">Payment date</dt><dd className="mt-1">{payment.payment_date || 'Not recorded'}</dd></div>
            <div><dt className="text-slate-500">Recorded by HR / Finance</dt><dd className="mt-1">{timestamp(payment.recorded_at)}</dd></div>
            {payment.acknowledged_at && <div className="sm:col-span-2"><dt className="text-slate-500">Acknowledged by employee</dt><dd className="mt-1">{timestamp(payment.acknowledged_at)}</dd></div>}
        </dl>}
        {(canRecord || canAcknowledge) && <form onSubmit={submit}>
            <fieldset disabled={saving} className="space-y-3">
                {canRecord && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="min-w-0 text-xs font-medium">Completed payment reference<input required maxLength={120} value={reference} onChange={event => setReference(event.target.value)} className={inputClass} /></label>
                    <label className="text-xs font-medium">Payment date<input type="date" required value={paymentDate} max={query.data.server_date || today} onChange={event => setDate(event.target.value)} className={inputClass} /></label>
                </div>}
                <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 shrink-0" />{canAcknowledge ? `I received ${formatCurrency(payment.net_pay)} for this payslip.` : 'I confirm this payment was completed.'}</label>
                <button type="submit" disabled={saving || !confirmed || (canRecord && (!reference.trim() || !paymentDate))} className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : canAcknowledge ? 'I received my payment' : 'Record completed payment'}</button>
            </fieldset>
        </form>}
        {error && !(error.action === 'record' ? payment : payment?.acknowledged_at) && <p role="alert" className="text-xs text-red-700">{error.message}</p>}
    </section>;
}
