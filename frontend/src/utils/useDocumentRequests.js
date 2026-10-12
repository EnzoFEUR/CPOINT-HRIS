import { useEffect, useId, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchDocumentRequests } from './documentApi';

export default function useDocumentRequests({ employeeId, actorId, enabled = true, status = 'all' } = {}) {
    const queryClient = useQueryClient();
    const channelId = useId();

    const queryKey = useMemo(() => ['documentRequests', actorId || 'guest', employeeId || 'all', status], [actorId, employeeId, status]);

    const query = useQuery({
        queryKey,
        enabled: enabled && Boolean(actorId),
        queryFn: ({ signal }) => fetchDocumentRequests({ employeeId, status, signal }),
        staleTime: 10000,
        refetchOnWindowFocus: true,
        refetchInterval: 30000,
        refetchIntervalInBackground: false
    });

    useEffect(() => {
        if (!enabled || !actorId) return;
        let timer;
        let disposed = false;
        const invalidate = () => {
            if (disposed || timer) return;
            timer = setTimeout(() => {
                timer = null;
                queryClient.invalidateQueries({ queryKey: ['documentRequests'] });
            }, 100);
        };

        const filter = { event: '*', schema: 'public', table: 'document_requests' };
        if (employeeId) filter.filter = `employee_id=eq.${employeeId}`;

        const reqChannel = supabase
            .channel(`doc-requests-realtime-${channelId}`)
            .on('postgres_changes', filter, invalidate)
            .subscribe(state => { if (state === 'SUBSCRIBED') invalidate(); });

        const broadcastChannel = supabase
            .channel(`doc-requests-broadcast-${channelId}`)
            .on('broadcast', { event: 'DOCUMENT_CHANGED' }, ({ payload }) => {
                if (!employeeId || payload?.employee_id === employeeId) invalidate();
            })
            .subscribe();

        return () => {
            disposed = true;
            clearTimeout(timer);
            supabase.removeChannel(reqChannel);
            supabase.removeChannel(broadcastChannel);
        };
    }, [actorId, employeeId, enabled, channelId, queryClient]);

    return {
        ...query,
        requests: query.data || [],
        refresh: () => queryClient.invalidateQueries({ queryKey: ['documentRequests'] })
    };
}
