import { useEffect, useId, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { getUser } from '../routes/guards';

export default function useSilRateSources(employeeId, enabled, onChange, sourceDocumentId) {
    const actorId = getUser()?.id;
    const queryClient = useQueryClient();
    const instanceId = useId();
    const callback = useRef(onChange);
    const selectedDocument = useRef(sourceDocumentId);
    useEffect(() => { callback.current = onChange; }, [onChange]);
    useEffect(() => { selectedDocument.current = sourceDocumentId; }, [sourceDocumentId]);

    useEffect(() => {
        if (!enabled || !actorId || !employeeId) return;
        let stopped = false;
        let timer;
        let connected = false;
        const changed = () => {
            if (stopped) return;
            callback.current();
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!stopped) queryClient.invalidateQueries({ queryKey: ['silValuationPeriods', actorId, employeeId] });
                if (!stopped) queryClient.invalidateQueries({ queryKey: ['silWageSources', actorId, employeeId] });
            }, 200);
        };
        const documentChanged = event => {
            if (stopped) return;
            const documentId = event?.new?.id || event?.old?.id;
            if (selectedDocument.current && (!documentId || String(documentId) === selectedDocument.current)) changed();
            else queryClient.invalidateQueries({ queryKey: ['silWageSources', actorId, employeeId] });
        };
        const channel = supabase.channel(`sil-rate-sources-${actorId}-${employeeId}-${instanceId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls', filter: `employee_id=eq.${employeeId}` }, changed)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', filter: `employee_id=eq.${employeeId}` }, changed)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_documents', filter: `employee_id=eq.${employeeId}` }, documentChanged)
            .subscribe(status => {
                if (status === 'SUBSCRIBED') {
                    if (connected) changed();
                    connected = true;
                }
            });
        window.addEventListener('focus', changed);
        window.addEventListener('online', changed);
        return () => {
            stopped = true;
            clearTimeout(timer);
            window.removeEventListener('focus', changed);
            window.removeEventListener('online', changed);
            supabase.removeChannel(channel);
        };
    }, [actorId, employeeId, enabled, instanceId, queryClient]);
}
