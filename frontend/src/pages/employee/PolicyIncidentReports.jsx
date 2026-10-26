import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../utils/api';
import { getStoredUser } from '../../utils/storedUser.mjs';
import { isAdmin } from '../../utils/userAccess.mjs';
import { isExoneratedOrCleared } from '../../utils/disciplinaryStanding';
import { supabase } from '../../supabaseClient';
import PageHeader from '../../components/ui/PageHeader';

export default function PolicyIncidentReports() {
    const user = getStoredUser() || {};
    const actorId = user.id;
    const queryClient = useQueryClient();
    const adminAccount = isAdmin(user);
    const reports = useQuery({
        queryKey: ['employeePolicyReports', actorId],
        enabled: Boolean(actorId) && !adminAccount,
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth(
                '/api/disciplinary?employee_id=' + encodeURIComponent(actorId),
                { signal }
            );
            const data = await response.json();
            if (!response.ok)
                throw new Error(
                    data.error ||
                        'Unable to load your policy and incident reports.'
                );
            const rows = Array.isArray(data) ? data : data.data;
            if (!Array.isArray(rows))
                throw new Error('Invalid report response. Try refreshing.');
            return rows;
        },
        staleTime: 15_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        retry: 1,
    });
    useEffect(() => {
        if (!actorId || adminAccount) return;
        const refresh = () =>
            queryClient.invalidateQueries({
                queryKey: ['employeePolicyReports', actorId],
            });
        const channel = supabase
            .channel('employee-policy-reports-' + actorId)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'disciplinary_logs',
                    filter: 'employee_id=eq.' + actorId,
                },
                refresh
            )
            .subscribe((state) => {
                if (state === 'SUBSCRIBED') refresh();
            });
        const onDisciplinarySync = () => refresh();
        window.addEventListener('hris_disciplinary_sync', onDisciplinarySync);
        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener(
                'hris_disciplinary_sync',
                onDisciplinarySync
            );
        };
    }, [actorId, adminAccount, queryClient]);
    const disciplinaryLogs = reports.data || [];
    const active = disciplinaryLogs.filter(
        (log) =>
            !isExoneratedOrCleared(log) &&
            ![
                'resolved',
                'overturned',
                'dismissed',
                'cleared',
                'cancelled',
                'closed',
            ].includes(String(log.status || '').toLowerCase())
    );
    const isTerminated = Boolean(
        user.archived_at ||
            ['terminated', 'separated', 'archived'].includes(
                String(user.status || '').toLowerCase()
            ) ||
            active.some((log) => log.type === 'Termination')
    );
    const isSuspended =
        !isTerminated &&
        (String(user.status || '').toLowerCase() === 'suspended' ||
            active.some((log) => log.type === 'Suspension'));
    const formatDate = (dateString, dateOnly = false) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            ...(dateOnly ? { timeZone: 'UTC' } : {}),
        });
    };

    return (
        <div className="max-w-5xl mx-auto space-y-5 pb-20 px-4 sm:px-6">
            <PageHeader
                title="Policy & Incident Reports"
                breadcrumbs={['Employee', 'Policy & Incident Reports']}
                description="Review your official notices and report history."
                actions={
                    <Link
                        to="/employee/profile"
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold"
                    >
                        My Profile
                    </Link>
                }
            />
            {adminAccount ? (
                <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
                    Employee policy reports are not applicable to administrator
                    accounts.
                </p>
            ) : reports.isPending ? (
                <p role="status">Loading reports...</p>
            ) : reports.isError ? (
                <div
                    role="alert"
                    className="rounded-md border border-danger/20 bg-danger-subtle p-4 text-sm text-danger-ink"
                >
                    {reports.error.message}{' '}
                    <button
                        type="button"
                        className="underline"
                        onClick={() => reports.refetch()}
                    >
                        Retry
                    </button>
                </div>
            ) : (
                <div className="min-w-0 [overflow-wrap:anywhere] bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2.5">
                            <div className="h-9 w-9 rounded-md bg-warning-subtle text-warning-ink flex items-center justify-center border border-warning/20">
                                <i className="ti ti-scale text-lg" />
                            </div>

                            <div>
                                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                                    Policy &amp; Incident Reports
                                </h3>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider border ${
                                    isTerminated
                                        ? 'bg-danger-subtle text-danger-ink border-danger/20'
                                        : isSuspended
                                          ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                          : disciplinaryLogs.some(
                                                  (l) => l.status === 'Active'
                                              )
                                            ? 'bg-danger-subtle text-danger-ink border-danger/20'
                                            : 'bg-surface-muted text-ink border-line'
                                }`}
                            >
                                <i
                                    className={`ti ${
                                        isTerminated
                                            ? 'ti-circle-x'
                                            : isSuspended
                                              ? 'ti-clock-pause'
                                              : disciplinaryLogs.some(
                                                      (l) =>
                                                          l.status === 'Active'
                                                  )
                                                ? 'ti-alert-triangle'
                                                : 'ti-circle-check'
                                    }`}
                                />

                                {isTerminated
                                    ? 'Separated'
                                    : isSuspended
                                      ? 'Suspension Active'
                                      : disciplinaryLogs.some(
                                              (l) => l.status === 'Active'
                                          )
                                        ? 'Action Required'
                                        : 'Good Standing'}
                            </span>
                        </div>
                    </div>

                    {disciplinaryLogs.length === 0 ? (
                        <div className="flex flex-col sm:flex-row items-center gap-3.5 p-4 rounded-md bg-surface-muted border border-line text-xs">
                            <div className="w-8 h-8 rounded-md bg-surface-muted text-ink flex items-center justify-center shrink-0">
                                <i className="ti ti-shield-check text-base" />
                            </div>

                            <div className="flex-1 text-center sm:text-left">
                                <p className="font-bold text-ink">
                                    Clean Disciplinary Standing
                                </p>

                                <p className="text-ink mt-0.5">
                                    You currently have no disciplinary
                                    infractions, warnings, or sanctions on file.
                                    Your account is in full compliance with
                                    company policies and DOLE standards.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {disciplinaryLogs.map((log) => {
                                const isOverturnedOrResolved =
                                    log.status === 'Resolved' ||
                                    log.status === 'Overturned';

                                const isResolvedTermination =
                                    log.type === 'Termination' &&
                                    isOverturnedOrResolved;

                                const isReinstatedNote =
                                    (log.reason || '').includes(
                                        '[REINSTATED'
                                    ) ||
                                    (log.reason || '').includes(
                                        '[EXONERATED'
                                    ) ||
                                    (log.reason || '').includes('[CLEARED');

                                return (
                                    <div
                                        key={log.id}
                                        className={`p-4 rounded-md border text-xs transition-colors duration-100 ${
                                            isResolvedTermination
                                                ? 'bg-success-subtle/30 border-success/20'
                                                : log.status === 'Active'
                                                  ? 'bg-danger-subtle/30 border-danger/20'
                                                  : log.status ===
                                                      'Acknowledged'
                                                    ? 'bg-accent-subtle/30 border-accent/20'
                                                    : 'bg-slate-50/70 border-slate-200'
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-200/60">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span
                                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                                                        isResolvedTermination
                                                            ? 'bg-success-subtle text-success-ink border-success/20'
                                                            : log.type ===
                                                                'Termination'
                                                              ? 'bg-danger-subtle text-danger-ink border-danger/20'
                                                              : log.type ===
                                                                  'Suspension'
                                                                ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                                                : 'bg-warning-subtle text-warning-ink border-warning/20'
                                                    }`}
                                                >
                                                    <i
                                                        className={`ti ${
                                                            isResolvedTermination
                                                                ? 'ti-circle-check'
                                                                : log.type ===
                                                                    'Termination'
                                                                  ? 'ti-ban'
                                                                  : log.type ===
                                                                      'Suspension'
                                                                    ? 'ti-player-pause'
                                                                    : 'ti-alert-triangle'
                                                        }`}
                                                    />

                                                    {isResolvedTermination
                                                        ? 'Termination (Revoked / Restored)'
                                                        : log.type}
                                                </span>

                                                <span className="text-slate-500 font-medium flex items-center gap-1">
                                                    <i className="ti ti-calendar text-xs" />

                                                    {formatDate(
                                                        log.date ||
                                                            log.created_at
                                                    )}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                                <span
                                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                                                        log.status ===
                                                        'Resolved'
                                                            ? 'bg-success-subtle text-success-ink border-success/20'
                                                            : log.status ===
                                                                'Overturned'
                                                              ? 'bg-success-subtle text-success-ink border-success/20'
                                                              : log.status ===
                                                                  'Acknowledged'
                                                                ? 'bg-accent-subtle text-accent-strong border-accent/20'
                                                                : 'bg-danger-subtle text-danger-ink border-danger/20'
                                                    }`}
                                                >
                                                    {log.status ===
                                                        'Resolved' && (
                                                        <i className="ti ti-circle-check" />
                                                    )}

                                                    {log.status ===
                                                        'Overturned' && (
                                                        <i className="ti ti-shield-check" />
                                                    )}

                                                    {log.status ===
                                                        'Acknowledged' && (
                                                        <i className="ti ti-checks" />
                                                    )}

                                                    {log.status ===
                                                        'Active' && (
                                                        <i className="ti ti-alert-triangle" />
                                                    )}

                                                    <span>
                                                        {log.status ===
                                                        'Resolved'
                                                            ? 'Resolved'
                                                            : log.status ===
                                                                'Overturned'
                                                              ? 'Cleared'
                                                              : log.status ===
                                                                  'Acknowledged'
                                                                ? 'Acknowledged'
                                                                : 'Action Required'}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>

                                        <p className="mt-2 text-slate-700 leading-relaxed whitespace-pre-line font-medium">
                                            {log.reason ||
                                                'No details provided.'}
                                        </p>

                                        {log.status === 'Active' && (
                                            <div className="mt-2.5 pt-2 border-t border-danger/60 flex items-center justify-between gap-2 text-[11px] text-danger-ink">
                                                <span className="flex items-center gap-1">
                                                    <i className="ti ti-alert-circle text-sm" />{' '}
                                                    Formal acknowledgment
                                                    required under DOLE due
                                                    process.
                                                </span>

                                                <Link
                                                    to="/employee/dashboard"
                                                    className="h-7 px-2.5 bg-danger hover:bg-danger-ink text-white font-semibold rounded-md text-[10px] uppercase transition-colors duration-100 shrink-0 flex items-center justify-center shadow-2xs"
                                                >
                                                    Review Notice
                                                </Link>
                                            </div>
                                        )}

                                        {log.status === 'Acknowledged' && (
                                            <div className="mt-2 pt-2 border-t border-accent/20 text-[11px] text-accent font-medium flex items-center gap-1">
                                                <i className="ti ti-checks text-sm" />

                                                <span>
                                                    Receipt formally
                                                    acknowledged on employee
                                                    portal.
                                                </span>
                                            </div>
                                        )}

                                        {isReinstatedNote && (
                                            <div className="mt-2 pt-2 border-t border-success/20 text-[11px] text-success-ink font-bold flex items-center gap-1">
                                                <i className="ti ti-check text-sm" />

                                                <span>
                                                    Sanction revoked and
                                                    operational standing
                                                    restored.
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
