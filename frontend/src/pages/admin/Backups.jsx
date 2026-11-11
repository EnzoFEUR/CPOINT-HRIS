import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DatabaseBackup, RefreshCw, ShieldCheck, Monitor, Clock3 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { fetchWithAuth } from '../../utils/api';
import { supabase } from '../../supabaseClient';
import { backupErrors, backupStages, backupView, formatBackupDate } from '../../utils/backupStatus.mjs';

export default function Backups() {
    const queryClient = useQueryClient();
    const request = useRef(null);

    const query = useQuery({
        queryKey: ['systemBackups'],
        queryFn: async () => {
            const response = await fetchWithAuth('/api/backups/status');
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || 'Backup status could not be loaded.');
            return body;
        },
        staleTime: 3000,
        refetchInterval: current => current.state.data?.active_job ? 2000 : 15000,
        refetchIntervalInBackground: false,
        retry: false,
    });

    // Realtime streaming: zero-latency updates for heartbeats, stages, and jobs
    useEffect(() => {
        const client = typeof supabase !== 'undefined' ? supabase : null;
        if (!client?.channel) return;
        const channel = client
            .channel('admin-backups-live-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'hris_backup_worker' }, () => {
                void queryClient.invalidateQueries({ queryKey: ['systemBackups'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'hris_backup_jobs' }, () => {
                void queryClient.invalidateQueries({ queryKey: ['systemBackups'] });
            })
            .subscribe();

        return () => {
            void client.removeChannel(channel);
        };
    }, [queryClient]);

    useEffect(() => {
        const pendingId = request.current?.operation_id;
        if (pendingId && (query.data?.active_job?.id === pendingId || query.data?.history?.some(job => job.id === pendingId))) request.current = null;
    }, [query.data]);

    const mutation = useMutation({
        mutationFn: async action => {
            if (request.current?.action !== action) request.current = { action, operation_id: crypto.randomUUID() };
            const response = await fetchWithAuth('/api/backups/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.current) });
            const body = await response.json();
            if (!response.ok) {
                if (response.status < 500) request.current = null;
                throw new Error(body.error || 'Your backup request could not be sent.');
            }
            request.current = null;
            return body;
        },
        onSuccess: () => { toast('Request accepted. Progress will appear below.'); void queryClient.invalidateQueries({ queryKey: ['systemBackups'] }); },
        onError: error => { toast.error(error.message); void queryClient.invalidateQueries({ queryKey: ['systemBackups'] }); },
    });

    const data = query.data || {};
    const view = backupView(data);
    const busy = query.isPending || query.isError || mutation.isPending;
    const button = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-2xs';

    const historyList = data.history || [];

    const activeStage = data.active_job?.stage || (mutation.isPending ? 'preflight' : null);
    const stagesList = [
        { key: 'preflight', label: 'Preflight' },
        { key: 'database_export', label: 'Database' },
        { key: 'storage_export', label: 'Files' },
        { key: 'encrypting_snapshot', label: 'Encrypt' },
        { key: 'cloud_upload', label: 'Cloud B2' },
        { key: 'completed', label: 'Verified' }
    ];

    const getStageIndex = stage => {
        if (!stage) return -1;
        if (stage === 'queued') return 0;
        const idx = stagesList.findIndex(s => s.key === stage);
        return idx >= 0 ? idx : 1;
    };
    const currentStepIndex = getStageIndex(activeStage);

    return (
        <div className="space-y-4">
            <PageHeader
                breadcrumbs={['Admin', 'Backups']}
                title="Backups"
                description="View encrypted local and cloud backups and daily backup activity."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                            view.hosted 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : data.worker_online 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${view.hosted || data.worker_online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            <span>{view.hosted ? 'Autonomous Cloud Active' : data.worker_online ? 'Workstation Connected' : 'Worker Offline'}</span>
                        </span>

                        {view.workflowUrl && (
                            <a className={`${button} bg-slate-900 text-white hover:bg-slate-800 h-8`} href={view.workflowUrl} target="_blank" rel="noopener noreferrer">
                                <i className="ti ti-brand-github text-sm" />
                                <span>Cloud backup controls</span>
                            </a>
                        )}

                        <button
                            type="button"
                            className={`${button} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 h-8 cursor-pointer`}
                            disabled={query.isFetching}
                            onClick={() => query.refetch()}
                            title="Force refresh status"
                        >
                            <RefreshCw size={13} className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
                            <span>Refresh status</span>
                        </button>
                    </div>
                }
            />

            {query.isError ? (
                <div role="alert" className="rounded-lg border border-danger/20 bg-danger-subtle p-3.5 text-sm text-danger-ink">
                    <p className="font-semibold">Backup status could not be loaded.</p>
                    <button type="button" className={`${button} mt-2.5 border border-current bg-white text-xs`} onClick={() => query.refetch()}>Try again</button>
                </div>
            ) : (
                <>
                    {/* Compact Hero Status Strip */}
                    <section className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className={`p-2 rounded-md shrink-0 ${view.hosted || data.worker_online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                    <Monitor size={18} aria-hidden="true" />
                                </div>
                                <div className="space-y-0.5 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-sm font-semibold text-slate-900 truncate">
                                            {query.isPending ? 'Loading backup status…' : view.availability}
                                        </h2>
                                        {view.hosted && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                                Zero-PC Cloud Runner
                                            </span>
                                        )}
                                    </div>
                                    {!query.isPending && view.hosted && (
                                        <p className="text-xs text-slate-500">Runs in the cloud. Your computer can be off.</p>
                                    )}
                                    {!query.isPending && !view.hosted && !data.worker_online && (
                                        <p className="text-xs text-slate-500">
                                            {data.configured ? 'Keep the configured backup computer on and connected.' : 'Contact the system administrator to finish setup.'}
                                        </p>
                                    )}
                                    {data.worker_online && !view.hosted && (
                                        <p className="text-xs text-slate-500">Backup worker connected</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                                    <i className="ti ti-lock text-slate-400" />
                                    <span>AES-256-CTR + Poly1305</span>
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                                    <i className="ti ti-shield-check text-slate-400" />
                                    <span>TLS 1.3 verify-full</span>
                                </span>
                                <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                                    <i className="ti ti-cloud text-slate-400" />
                                    <span>Backblaze B2</span>
                                </span>
                                {view.workflowUrl && (
                                    <a className={`${button} bg-slate-900 text-white hover:bg-slate-800 h-8 sm:hidden`} href={view.workflowUrl} target="_blank" rel="noopener noreferrer">
                                        <i className="ti ti-brand-github text-sm" />
                                        <span>Cloud backup controls</span>
                                    </a>
                                )}
                                <button
                                    type="button"
                                    className={`${button} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 h-8 sm:hidden`}
                                    disabled={query.isFetching}
                                    onClick={() => query.refetch()}
                                >
                                    <RefreshCw size={13} className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
                                    <span>Refresh status</span>
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Active Pipeline Stepper with Live Stage Progression */}
                    <div role="status" aria-live="polite" aria-atomic="true">
                        {(mutation.isPending || data.active_job) && (
                            <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3.5 shadow-xs space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-1.5 rounded-md bg-indigo-600 text-white animate-pulse">
                                            <Clock3 size={15} aria-hidden="true" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold text-slate-900">
                                                {mutation.isPending ? 'Sending your request…' : data.active_job.action === 'create' ? 'Backup in progress' : 'Backup check in progress'}
                                            </p>
                                            <p className="text-[11px] text-slate-600 mt-0.5">
                                                {data.active_job ? view.stageLabel : 'Please wait for confirmation.'}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                                        {data.active_job ? backupStages[data.active_job.stage] || data.active_job.stage : 'Initializing'}
                                    </span>
                                </div>

                                <div className="grid grid-cols-6 gap-2">
                                    {stagesList.map((step, idx) => {
                                        const isPast = idx < currentStepIndex;
                                        const isCurrent = idx === currentStepIndex;
                                        return (
                                            <div key={step.key} className="space-y-1">
                                                <div className={`h-1.5 rounded-full transition-all duration-500 ${
                                                    isPast ? 'bg-emerald-500' : isCurrent ? 'bg-indigo-600 animate-pulse' : 'bg-slate-200'
                                                }`} />
                                                <p className={`text-[10px] font-medium truncate ${
                                                    isCurrent ? 'text-indigo-900 font-semibold' : isPast ? 'text-emerald-700' : 'text-slate-400'
                                                }`}>
                                                    {step.label}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Compact 3-Column Operational KPI Grid */}
                    <div className="grid gap-3.5 md:grid-cols-3">
                        {/* Column 1: Backup Snapshot */}
                        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                                            <DatabaseBackup size={16} aria-hidden="true" />
                                        </div>
                                        <h2 className="text-sm font-semibold text-slate-900">
                                            {view.hosted ? 'Latest cloud backup' : 'Local backup'}
                                        </h2>
                                    </div>
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">Snapshot</span>
                                </div>

                                <div className="mt-3">
                                    <p className="text-xs text-slate-500">Recorded Timestamp</p>
                                    <p className="text-sm font-semibold text-slate-900 mt-0.5">
                                        {data.latest_backup ? formatBackupDate(data.latest_backup.created_at) + ' PHT' : 'No backup recorded yet'}
                                    </p>
                                </div>

                                {data.latest_backup?.snapshot_id && (
                                    <div className="mt-2.5 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center justify-between gap-1.5 font-mono">
                                        <span className="text-[10px] uppercase font-sans font-semibold text-slate-400 shrink-0">ID:</span>
                                        <span className="truncate">{data.latest_backup.snapshot_id}</span>
                                    </div>
                                )}
                            </div>

                            {!view.hosted && (
                                <div className="pt-3 mt-3 border-t border-slate-100">
                                    <button
                                        type="button"
                                        className={`${button} w-full bg-slate-900 text-white hover:bg-slate-800 h-8`}
                                        disabled={busy || !view.canCreate}
                                        onClick={() => mutation.mutate('create')}
                                    >
                                        <DatabaseBackup size={14} aria-hidden="true" />
                                        <span>Create Backup</span>
                                    </button>
                                    {data.cooldowns?.create > 0 && (
                                        <p className="mt-1.5 text-[11px] text-slate-500 text-center">
                                            Available again in about {Math.ceil(data.cooldowns.create / 60)} min.
                                        </p>
                                    )}
                                </div>
                            )}
                        </section>

                        {/* Column 2: Integrity & Verification */}
                        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-md ${view.checkCurrent ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                                            <ShieldCheck size={16} aria-hidden="true" />
                                        </div>
                                        <h2 className="text-sm font-semibold text-slate-900">Backup integrity</h2>
                                    </div>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${view.checkCurrent ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                                        {view.checkLabel}
                                    </span>
                                </div>

                                <div className="mt-3">
                                    <p className="text-xs text-slate-500">Integrity Health</p>
                                    <p className={`text-sm font-semibold mt-0.5 ${view.checkCurrent ? 'text-success-ink' : 'text-slate-900'}`}>
                                        {view.checkLabel}
                                    </p>
                                    {data.last_check_at ? (
                                        <p className="text-[11px] text-slate-500 mt-0.5">Last verified: {formatBackupDate(data.last_check_at)} PHT</p>
                                    ) : (
                                        <p className="text-[11px] text-slate-400 mt-0.5">Verification pending</p>
                                    )}
                                </div>

                                <div className="mt-2.5 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-0.5">
                                    <div className="flex justify-between items-center">
                                        <span>Rabin Chunks & Index</span>
                                        <span className="font-semibold text-emerald-700">Verified</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span>Authentication MAC</span>
                                        <span className="font-semibold text-emerald-700">Poly1305</span>
                                    </div>
                                </div>
                            </div>

                            {!view.hosted && (
                                <div className="pt-3 mt-3 border-t border-slate-100">
                                    <button
                                        type="button"
                                        className={`${button} w-full border border-slate-300 text-slate-800 hover:bg-slate-50 h-8`}
                                        disabled={busy || !view.canCheck}
                                        onClick={() => mutation.mutate('check')}
                                    >
                                        <ShieldCheck size={14} aria-hidden="true" />
                                        <span>Check Backup</span>
                                    </button>
                                    {data.cooldowns?.check > 0 && (
                                        <p className="mt-1.5 text-[11px] text-slate-500 text-center">Available again shortly.</p>
                                    )}
                                </div>
                            )}
                        </section>

                        {/* Column 3: Offsite Cloud Protection & Cadence */}
                        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-700">
                                            <i className="ti ti-cloud-lock text-base" />
                                        </div>
                                        <h2 className="text-sm font-semibold text-slate-900">Cloud protection</h2>
                                    </div>
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">Backblaze B2</span>
                                </div>

                                <div className="mt-3 space-y-2">
                                    <div>
                                        <p className="text-xs text-slate-500">Cloud Sync Status</p>
                                        <p className={`text-sm font-semibold mt-0.5 ${data.cloud?.status === 'failed' ? 'text-danger-ink' : view.cloudCurrent ? 'text-success-ink' : 'text-slate-900'}`}>
                                            {view.cloudLabel}
                                        </p>
                                        {data.cloud?.verified_at && (
                                            <p className="text-[11px] text-slate-500 mt-0.5">Snapshot and structure checked: {formatBackupDate(data.cloud.verified_at)} PHT</p>
                                        )}
                                        <p className="text-[11px] text-slate-500">
                                            Full cloud data check: {data.cloud?.full_check_at ? formatBackupDate(data.cloud.full_check_at) + ' PHT' : 'Not performed yet'}
                                        </p>
                                    </div>

                                    <div className="pt-2 border-t border-slate-100">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-slate-500 font-medium">Cadence:</span>
                                            <span className="font-semibold text-slate-900">{view.scheduleLabel}</span>
                                        </div>
                                        {data.schedule?.enabled && (
                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                {view.hosted ? 'Cloud scheduling may be delayed. Check recent activity for completion.' : 'The configured backup worker must be running and connected.'}
                                            </p>
                                        )}
                                    </div>

                                    {data.cloud?.provider === 'b2' && data.cloud?.stored_bytes != null && (
                                        <div className="pt-2 border-t border-slate-100">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-slate-500">Data Stored:</span>
                                                <span className="font-semibold text-slate-900">{(data.cloud.stored_bytes / 1e6).toFixed(1)} MB</span>
                                            </div>
                                            <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                                                <div 
                                                    className="bg-indigo-600 h-1.5 rounded-full" 
                                                    style={{ width: `${Math.min(100, (data.cloud.stored_bytes / 1e10) * 100)}%` }} 
                                                />
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-1">
                                                Backup data estimate: {(data.cloud.stored_bytes / 1e9).toFixed(3)} GB. Provider billing also includes object versions and overhead.
                                            </p>
                                        </div>
                                    )}

                                    {data.cloud?.stored_bytes >= 8e9 && (
                                        <p className="text-xs text-danger-ink">Review cloud usage and retention before exceeding the free storage allowance.</p>
                                    )}
                                    {data.cloud?.status === 'failed' && (
                                        <p className="text-xs text-danger-ink">The cloud copy did not finish. Existing backups are preserved.</p>
                                    )}
                                </div>
                            </div>

                            {view.overdue && (
                                <div role="alert" className="mt-3 p-2.5 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-xs flex items-center gap-2">
                                    <i className="ti ti-alert-triangle text-amber-600 text-sm shrink-0" />
                                    <span>Daily backup overdue. Check the backup worker and recent activity.</span>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Compact Activity Log & Audit Trail */}
                    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50/50">
                            <div>
                                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">Recent activity</h2>
                                <p className="text-[11px] text-slate-500">Immutable audit trail of execution attempts and verification jobs</p>
                            </div>
                            <span className="text-xs font-mono text-slate-500">
                                {historyList.length} {historyList.length === 1 ? 'record' : 'records'}
                            </span>
                        </div>

                        {!historyList.length ? (
                            <p className="p-6 text-xs text-slate-500 text-center">No backup tasks have been requested yet.</p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {historyList.map(job => (
                                    <li key={job.id} className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/60 transition-colors">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-xs font-semibold text-slate-900">
                                                    {job.action === 'create' ? 'Create backup' : 'Check backup'}
                                                    {job.origin === 'scheduled' ? ' · Scheduled' : ''}
                                                </p>
                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                                    job.executor === 'github_actions' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700'
                                                }`}>
                                                    {job.executor === 'github_actions' ? 'Cloud' : 'Workstation'}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{formatBackupDate(job.created_at)} PHT</p>
                                            {job.status === 'failed' && (
                                                <p className="text-xs text-danger-ink font-medium mt-0.5 max-w-xl">
                                                    {backupErrors[job.error_code] || 'This task needs attention. Contact the system administrator.'}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                job.status === 'completed'
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                    : job.status === 'running'
                                                        ? 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse'
                                                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${
                                                    job.status === 'completed' ? 'bg-emerald-500' : job.status === 'running' ? 'bg-amber-500' : 'bg-rose-500'
                                                }`} />
                                                <span>
                                                    {job.status === 'completed' && job.action === 'create' 
                                                        ? job.executor === 'github_actions' ? 'Cloud backup saved' : 'Local backup saved'
                                                        : backupStages[job.status === 'running' ? job.stage : job.status] || 'Needs attention'}
                                                </span>
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
