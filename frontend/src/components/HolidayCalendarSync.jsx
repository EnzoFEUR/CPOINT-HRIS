import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabaseClient';
import { fetchWithAuth } from '../utils/api';
import { readHolidayResponse, refreshHolidayCalendar } from '../utils/holidayCalendar.mjs';

export default function HolidayCalendarSync({ user }) {
    const queryClient = useQueryClient();
    const lastVersion = useRef(undefined);
    const query = useQuery({
        queryKey: ['holidayCalendarVersion'],
        queryFn: async ({ signal }) => readHolidayResponse(await fetchWithAuth('/api/holidays/version', { signal })),
        enabled: Boolean(user?.id),
        refetchInterval: 60000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
        retry: false,
    });

    useEffect(() => {
        const version = query.data?.version;
        if (version == null) return;
        if (lastVersion.current !== undefined && lastVersion.current !== version) refreshHolidayCalendar(queryClient, version);
        lastVersion.current = version;
    }, [query.data?.version, queryClient]);

    useEffect(() => {
        if (!user?.id) return;
        const refresh = () => {
            void queryClient.invalidateQueries({ queryKey: ['holidayCalendarVersion'] });
            refreshHolidayCalendar(queryClient);
        };
        const channel = supabase.channel(`holiday-calendar-${user.id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'holiday_calendar_state', filter: 'id=eq.1' }, refresh)
            .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
        window.addEventListener('online', refresh);
        return () => {
            window.removeEventListener('online', refresh);
            void supabase.removeChannel(channel);
        };
    }, [queryClient, user?.id]);
    return null;
}
