import { useEffect, useId, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { documentRequest } from './documentApi';

export default function useEmployeeDocuments({ employeeId, actorId, enabled = true, status = 'all', category = 'All', sort = 'newest', search = '' }) {
    const queryClient = useQueryClient();
    const channelId = useId();
    const [debouncedSearch, setDebouncedSearch] = useState(search);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 200);
        return () => clearTimeout(timer);
    }, [search]);
    const query = useInfiniteQuery({
        queryKey: ['employeeDocuments', actorId, employeeId || 'all', status, category, sort, debouncedSearch],
        enabled: enabled && Boolean(actorId),
        initialPageParam: 1,
        queryFn: ({ pageParam, signal }) => {
            const params = new URLSearchParams({ page: String(pageParam), limit: '100', sort });
            if (employeeId) params.set('employee_id', employeeId);
            if (status !== 'all') params.set('status', status);
            if (category !== 'All') params.set('category', category);
            if (debouncedSearch) params.set('search', debouncedSearch);
            return documentRequest(`/api/documents?${params}`, { signal });
        },
        getNextPageParam: page => page.meta?.has_more ? page.meta.page + 1 : undefined,
        staleTime: 15000,
        refetchOnWindowFocus: true,
        // Reconciliation also works when the database table is not in the Realtime publication.
        refetchInterval: 60000,
        refetchIntervalInBackground: false,
    });
    useEffect(() => {
        if (!enabled || !actorId) return;
        let timer;
        let disposed = false;
        const invalidate = () => {
            if (disposed || timer) return;
            timer = setTimeout(() => {
                timer = null;
                queryClient.invalidateQueries({ queryKey: ['employeeDocuments', actorId, employeeId || 'all'] });
            }, 150);
        };
        const filter = { event: '*', schema: 'public', table: 'employee_documents' };
        if (employeeId) filter.filter = `employee_id=eq.${employeeId}`;
        const changes = supabase.channel(`document-rows-${channelId}`).on('postgres_changes', filter, invalidate);
        if (employeeId) changes.on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${employeeId}` }, invalidate);
        changes.subscribe(state => { if (state === 'SUBSCRIBED') invalidate(); });
        const broadcasts = supabase.channel('document-updates').on('broadcast', { event: 'DOCUMENT_CHANGED' }, ({ payload }) => {
            if (!employeeId || payload?.employee_id === employeeId) invalidate();
        }).subscribe(state => { if (state === 'SUBSCRIBED') invalidate(); });
        return () => { disposed = true; clearTimeout(timer); supabase.removeChannel(changes); supabase.removeChannel(broadcasts); };
    }, [actorId, employeeId, enabled, channelId, queryClient]);
    const documents = useMemo(() => [...new Map((query.data?.pages.flatMap(page => page.documents || []) || []).map(document => [document.id, document])).values()], [query.data]);
    return { ...query, documents, employee: query.data?.pages[0]?.employee, uploadLocked: query.data?.pages[0]?.upload_locked, refresh: () => queryClient.invalidateQueries({ queryKey: ['employeeDocuments', actorId, employeeId || 'all'] }) };
}
