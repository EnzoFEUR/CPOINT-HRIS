import {useQuery} from '@tanstack/react-query';
import {fetchWithAuth} from './api';

export async function readPaymentResponse(response) {
    let body;
    try { body = await response.json(); }
    catch { throw new Error('Payment status could not be read. Refresh before retrying.'); }
    if (!response.ok || !body.success || !body.data) throw new Error(body.error || 'Unable to load payment confirmation.');
    return body.data;
}

export default function usePayrollPaymentReceipt(actorId, payrollId, poll = true) {
    return useQuery({
        queryKey: ['payrollPaymentReceipt', actorId, payrollId],
        queryFn: async ({signal}) => readPaymentResponse(await fetchWithAuth(`/api/payroll/payment-receipts/${encodeURIComponent(payrollId)}`, {signal})),
        enabled: Boolean(actorId && payrollId), staleTime: 10000, refetchInterval: poll ? 30000 : false,
        refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnReconnect: true, retry: false,
    });
}
