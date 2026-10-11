import { useEffect } from 'react';
import { validateLeaveCreditSnapshot } from '../../../shared/leavePolicy.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { getUser } from '../routes/guards';
import { fetchWithAuth } from './api';

export const leaveCreditKey = (actorId, employeeId) => ['employeeLeaveCredits', actorId, employeeId];

export async function readLeaveCreditResponse(response) {
    let body;
    try {
        body = await response.json();
    } catch {
        throw Object.assign(new Error(response.ok ? 'Unexpected response format from server.' : `Server error (${response.status}). Refresh before retrying.`), { status: response.status });
    }
    if (!response.ok || !body.success) throw Object.assign(new Error(body.error || 'Unable to load leave credits.'), { code: body.code, status: response.status });
    return body.data;
}

export async function fetchEmployeeLeaveCredits(employeeId, signal) {
    return validateLeaveCreditSnapshot(await readLeaveCreditResponse(await fetchWithAuth(`/api/leave-credits?employee_id=${encodeURIComponent(employeeId)}`, { signal })));
}

// Enterprise Singleton Channel Manager with Reference Counting
// Prevents Supabase Realtime "cannot add callbacks after subscribe()" when multiple components mount concurrently
const creditChannels = new Map();

function subscribeToEmployeeCredits(employeeId, onEvent) {
    let entry = creditChannels.get(employeeId);
    if (!entry) {
        const listeners = new Set();
        const dispatch = () => {
            listeners.forEach(cb => {
                try { cb(); } catch (e) { console.warn('[CREDITS_DISPATCH_WARN]', e); }
            });
        };

        // Clean up any stale or lingering channel with the same topic in the Supabase client
        const topic = `realtime:employee-leave-credits-${employeeId}`;
        const existing = supabase.getChannels().find(ch => ch.topic === topic);
        if (existing) {
            supabase.removeChannel(existing);
        }

        const channel = supabase.channel(`employee-leave-credits-${employeeId}`)
            .on('broadcast', { event: 'CREDITS_CHANGED' }, dispatch)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${employeeId}` }, dispatch)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_leave_credit_accounts', filter: `employee_id=eq.${employeeId}` }, dispatch)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'employee_leave_credit_ledger', filter: `employee_id=eq.${employeeId}` }, dispatch)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_cash_out_requests', filter: `employee_id=eq.${employeeId}` }, dispatch)
            .subscribe(status => {
                if (status === 'SUBSCRIBED') dispatch();
            });

        entry = { channel, refCount: 0, listeners };
        creditChannels.set(employeeId, entry);
    }

    entry.refCount += 1;
    entry.listeners.add(onEvent);

    return () => {
        const current = creditChannels.get(employeeId);
        if (!current) return;
        current.listeners.delete(onEvent);
        current.refCount -= 1;
        if (current.refCount <= 0) {
            creditChannels.delete(employeeId);
            supabase.removeChannel(current.channel);
        }
    };
}

export default function useEmployeeLeaveCredits(employeeId) {
    const actorId = getUser()?.id;
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: leaveCreditKey(actorId, employeeId),
        enabled: Boolean(actorId && employeeId),
        queryFn: ({ signal }) => fetchEmployeeLeaveCredits(employeeId, signal),
        staleTime: 15000, refetchInterval: 60000, refetchIntervalInBackground: false,
        refetchOnWindowFocus: true, refetchOnReconnect: true, retry: false,
    });

    useEffect(() => {
        if (!actorId || !employeeId) return;
        let timer;
        let stopped = false;
        const refresh = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!stopped) {
                    queryClient.invalidateQueries({ queryKey: leaveCreditKey(actorId, employeeId), exact: true });
                    queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', actorId, employeeId] });
                }
            }, 150);
        };

        const unsubscribe = subscribeToEmployeeCredits(employeeId, refresh);
        return () => {
            stopped = true;
            clearTimeout(timer);
            unsubscribe();
        };
    }, [actorId, employeeId, queryClient]);

    return query;
}
