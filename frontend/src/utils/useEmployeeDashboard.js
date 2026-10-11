import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from './api';
import { dashboardResponse, fetchDashboardData, readDashboardCache, writeDashboardCache } from './employeeDashboardData';

const freshness = {
    staleTime: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
    retry: (count, error) => count < 1 && ![400, 401, 403, 404].includes(error.status),
};

export default function useEmployeeDashboard(userId, enabled) {
    const queryClient = useQueryClient();
    const dashboardKey = `cpoint_emp_dash_${userId}`;
    const historyKey = `cpoint_emp_pay_history_${userId}`;
    const cachedDashboard = useMemo(() => readDashboardCache(window, dashboardKey), [dashboardKey]);
    const cachedHistory = useMemo(() => readDashboardCache(window, historyKey), [historyKey]);
    const dashboard = useQuery({
        ...freshness, queryKey: ['employeeDashboard', userId], enabled,
        queryFn: ({ signal }) => fetchDashboardData(fetchWithAuth, userId, signal),
        initialData: cachedDashboard?.data,
        initialDataUpdatedAt: cachedDashboard?.updatedAt,
    });
    const history = useQuery({
        ...freshness, queryKey: ['employeePayHistory', userId], enabled,
        // shortcut: history is capped at 100 statements; paginate when older records must be browsed.
        queryFn: async ({ signal }) => dashboardResponse(await fetchWithAuth(`/api/payroll?employee_id=${encodeURIComponent(userId)}&limit=100`, { signal })),
        initialData: cachedHistory?.data,
        initialDataUpdatedAt: cachedHistory?.updatedAt,
    });
    useEffect(() => {
        if (userId && dashboard.data && !dashboard.isError) writeDashboardCache(window, dashboardKey, dashboard.data, dashboard.dataUpdatedAt);
    }, [userId, dashboardKey, dashboard.data, dashboard.dataUpdatedAt, dashboard.isError]);
    useEffect(() => {
        if (userId && history.data && !history.isError) writeDashboardCache(window, historyKey, history.data, history.dataUpdatedAt);
    }, [userId, historyKey, history.data, history.dataUpdatedAt, history.isError]);
    const refresh = useCallback((includeHistory = true) => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['employeeDashboard', userId], exact: true }),
        ...(includeHistory ? [queryClient.invalidateQueries({ queryKey: ['employeePayHistory', userId], exact: true })] : []),
    ]), [queryClient, userId]);
    return { dashboard, history, refresh };
}
