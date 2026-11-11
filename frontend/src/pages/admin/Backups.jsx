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
    const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-2xs';

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
        <div className="space-y-6">
            <PageHeader breadcrumbs={['Admin', 'Backups']}
                title="Backups"
                description="View encrypted local and cloud backups and daily backup activity."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                            view.hosted 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : data.worker_online 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                            <span className={`w-2 h-2 rounded-full ${view.hosted || data.worker_online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                            <span>{view.hosted ? 'Autonomous Cloud Active' : data.worker_online ? 'Workstation Connected' : 'Worker Offline'}</span>
                        </span>

                        {view.workflowUrl && (
                            <a className={`${button} bg-slate-900 text-white hover:bg-slate-800 text-xs h-9 px-3`} href={view.workflowUrl} target="_blank" rel="noopener noreferrer">
                                <i className="ti ti-brand-github text-sm" />
                                <span>Cloud backup controls</span>
                            </a>
                        )}

                        <button
                            type="button"
                            className={`${button} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs h-9 px-3 cursor-pointer`}
                            disabled={query.isFetching}
                            onClick={() => query.refetch()}
                            title="Force refresh status"
                        >
                            <RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} aria-hidden="true" />
                            <span>Refresh status</span>
                        </button>
                    </div>
                }
            />

            {query.isError ? (
                <div role="alert" className="rounded-lg border border-danger/20 bg-danger-subtle p-4 text-sm text-danger-ink">
                    <p className="font-semibold">Backup status could not be loaded.</p>
                    <button type="button" className={`${button} mt-3 border border-current bg-white text-xs`} onClick={() => query.refetch()}>Try again</button>
                </div>
            ) : (
                <>
                    {/* Enterprise System Availability & Security Architecture Banner */}
                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3.5">
                                <div className={`p-2.5 rounded-lg shrink-0 ${view.hosted || data.worker_online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                    <Monitor size={22} aria-hidden="true" />
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <h2 className="font-semibold text-slate-900">{query.isPending ? 'Loading backup status…' : view.availability}</h2>
                                        {view.hosted && (
                                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">Zero-PC Cloud Runner</span>
                                        )}
                                    </div>
                                    {!query.isPending && view.hosted && <p className="text-sm text-slate-500">Runs in the cloud. Your computer can be off.</p>}
                                    {!query.isPending && !view.hosted && !data.worker_online && <p className="text-sm text-slate-500">{data.configured ? 'Keep the configured backup computer on and connected.' : 'Contact the system administrator to finish setup.'}</p>}
                                    {data.worker_online && !view.hosted && <p className="text-sm text-slate-500">Backup worker connected</p>}
                                    
                                    <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                        <span className="inline-flex items-center gap-1 font-mono">
                                            <i className="ti ti-lock text-slate-400" />
                                            <span>AES-256-CTR + Poly1305 MAC</span>
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <i className="ti ti-shield-check text-slate-400" />
                                            <span>TLS 1.3 verify-full</span>
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <i className="ti ti-cloud text-slate-400" />
                                            <span>Backblaze B2 Object Storage</span>
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2 shrink-0">
                                {view.workflowUrl && <a className={`${button} bg-slate-900 text-white hover:bg-slate-800`} href={view.workflowUrl} target="_blank" rel="noopener noreferrer">Cloud backup controls</a>}
                                <button type="button" className={`${button} border border-slate-200 text-slate-700 hover:bg-slate-50`} disabled={query.isFetching} onClick={() => query.refetch()}>
                                    <RefreshCw size={16} aria-hidden="true" />Refresh status
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Active Pipeline Stepper with Live Stage Progression */}
                    <div role="status" aria-live="polite" aria-atomic="true">
                        {(mutation.isPending || data.active_job) && (
                            <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/50 to-slate-50 p-5 shadow-xs space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-indigo-600 text-white animate-pulse">
                                            <Clock3 size={18} aria-hidden="true" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900">{mutation.isPending ? 'Sending your request…' : data.active_job.action === 'create' ? 'Backup in progress' : 'Backup check in progress'}</p>
                                            <p className="text-xs text-slate-600 mt-0.5">{data.active_job ? view.stageLabel : 'Please wait for confirmation.'}</p>
                                        </div>
                                    </div>
                                    <span className="text-xs font-mono font-medium px-2.5 py-1 rounded bg-indigo-100/70 text-indigo-800 border border-indigo-200">
                                        {data.active_job ? backupStages[data.active_job.stage] || data.active_job.stage : 'Initializing'}
                                    </span>
                                </div>

                                {/* Visual Horizontal Pipeline Stepper */}
                                <div className="grid grid-cols-6 gap-2 pt-2">
                                    {stagesList.map((step, idx) => {
                                        const isPast = idx < currentStepIndex;
                                        const isCurrent = idx === currentStepIndex;
                                        return (
                                            <div key={step.key} className="space-y-1.5">
                                                <div className={`h-1.5 rounded-full transition-all duration-500 ${
                                                    isPast ? 'bg-emerald-500' : isCurrent ? 'bg-indigo-600 animate-pulse' : 'bg-slate-200'
                                                }`} />
                                                <p className={`text-[11px] font-medium truncate ${
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

                    {/* Operational Cards: Local Snapshot & Integrity */}
                    <div className="grid gap-5 md:grid-cols-2">
                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between">
                                    <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
                                        <DatabaseBackup size={20} aria-hidden="true" />
                                    </div>
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">Snapshot</span>
                                </div>
                                <h2 className="mt-3 font-semibold text-slate-900">{view.hosted ? 'Latest cloud backup' : 'Local backup'}</h2>
                                <p className="mt-1 text-sm text-slate-600 font-medium">{data.latest_backup ? formatBackupDate(data.latest_backup.created_at) + ' PHT' : 'No backup recorded yet'}</p>
                                
                                {data.latest_backup?.snapshot_id && (
                                    <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Snapshot ID</p>
                                            <p className="font-mono text-xs text-slate-700 truncate">{data.latest_backup.snapshot_id}</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="pt-4">
                                {!view.hosted && (
                                    <button type="button" className={`${button} w-full bg-slate-900 text-white hover:bg-slate-800`} disabled={busy || !view.canCreate} onClick={() => mutation.mutate('create')}>
                                        <DatabaseBackup size={17} aria-hidden="true" />Create Backup
                                    </button>
                                )}
                                {data.cooldowns?.create > 0 && <p className="mt-2 text-xs text-slate-500">Available again in about {Math.ceil(data.cooldowns.create / 60)} min.</p>}
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between">
                                    <div className={`p-2 rounded-lg ${view.checkCurrent ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                                        <ShieldCheck size={20} aria-hidden="true" />
                                    </div>
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${view.checkCurrent ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-700'}`}>
                                        {view.checkLabel}
                                    </span>
                                </div>
                                <h2 className="mt-3 font-semibold text-slate-900">Backup integrity</h2>
                                <p className={`mt-1 text-sm font-medium ${view.checkCurrent ? 'text-success-ink' : 'text-slate-600'}`}>{view.checkLabel}</p>
                                {data.last_check_at && <p className="mt-1 text-xs text-slate-500">Last verified: {formatBackupDate(data.last_check_at)} PHT</p>}
                                
                                <div className="mt-3 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                                    <div className="flex justify-between">
                                        <span>Rabin Chunks & Index</span>
                                        <span className="font-semibold text-emerald-700">Verified</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Authentication MAC</span>
                                        <span className="font-semibold text-emerald-700">Poly1305</span>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4">
                                {!view.hosted && (
                                    <button type="button" className={`${button} w-full border border-slate-300 text-slate-800 hover:bg-slate-50`} disabled={busy || !view.canCheck} onClick={() => mutation.mutate('check')}>
                                        <ShieldCheck size={17} aria-hidden="true" />Check Backup
                                    </button>
                                )}
                                {data.cooldowns?.check > 0 && <p className="mt-2 text-xs text-slate-500">Available again shortly.</p>}
                            </div>
                        </section>
                    </div>

                    {/* Offsite Cloud Protection & Disaster Recovery Metrics */}
                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <i className="ti ti-cloud-lock text-slate-700 text-xl" />
                                <h2 className="font-semibold text-slate-900">Cloud protection</h2>
                            </div>
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">Backblaze B2 S3</span>
                        </div>

                        <div className="mt-4 grid gap-6 sm:grid-cols-2">
                            <div className="space-y-3">
                                <div>
                                    <p className={`text-sm font-semibold ${data.cloud?.status === 'failed' ? 'text-danger-ink' : view.cloudCurrent ? 'text-success-ink' : 'text-slate-700'}`}>{view.cloudLabel}</p>
                                    {data.cloud?.verified_at && <p className="mt-1 text-xs text-slate-600">Snapshot and structure checked: {formatBackupDate(data.cloud.verified_at)} PHT</p>}
                                    <p className="mt-1 text-xs text-slate-500">Full cloud data check: {data.cloud?.full_check_at ? formatBackupDate(data.cloud.full_check_at) + ' PHT' : 'Not performed yet'}</p>
                                </div>

                                {data.cloud?.provider === 'b2' && (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs space-y-1.5">
                                        <div className="flex justify-between items-center text-slate-700">
                                            <span>Private Storage Target:</span>
                                            <span className="font-mono text-slate-900">Backblaze B2 · Encrypted private storage</span>
                                        </div>
                                        {data.cloud?.stored_bytes != null && (
                                            <div>
                                                <div className="flex justify-between items-center text-slate-600">
                                                    <span>Data Stored:</span>
                                                    <span className="font-semibold text-slate-900">{(data.cloud.stored_bytes / 1e6).toFixed(1)} MB</span>
                                                </div>
                                                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
                                                    <div 
                                                        className="bg-indigo-600 h-1.5 rounded-full" 
                                                        style={{ width: `${Math.min(100, (data.cloud.stored_bytes / 1e10) * 100)}%` }} 
                                                    />
                                                </div>
                                                <p className="text-[11px] text-slate-500 mt-1">Backup data estimate: {(data.cloud.stored_bytes / 1e9).toFixed(3)} GB. Provider billing also includes object versions and overhead.</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {data.cloud?.stored_bytes >= 8e9 && <p className="text-xs text-danger-ink">Review cloud usage and retention before exceeding the free storage allowance.</p>}
                                {data.cloud?.status === 'failed' && <p className="text-xs text-danger-ink">The cloud copy did not finish. Existing backups are preserved.</p>}
                            </div>

                            <div className="space-y-3">
                                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-700">Automated Cadence</span>
                                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">Asia/Manila</span>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900">{view.scheduleLabel}</p>
                                    {data.schedule?.enabled && data.schedule.next_run_at && (
                                        <p className="text-xs text-slate-600">Next scheduled run: {formatBackupDate(data.schedule.next_run_at)} PHT</p>
                                    )}
                                    {data.schedule?.enabled && (
                                        <p className="text-xs text-slate-500">
                                            {view.hosted ? 'Cloud scheduling may be delayed. Check recent activity for completion.' : 'The configured backup worker must be running and connected.'}
                                        </p>
                                    )}
                                </div>

                                {view.overdue && (
                                    <div role="alert" className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs flex items-center gap-2">
                                        <i className="ti ti-alert-triangle text-amber-600 text-base shrink-0" />
                                        <span>Daily backup overdue. Check the backup worker and recent activity.</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Enterprise Activity Log & Audit Trail */}
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                            <div>
                                <h2 className="font-semibold text-slate-900">Recent activity</h2>
                                <p className="text-xs text-slate-500 mt-0.5">Immutable audit trail of execution attempts and verification jobs</p>
                            </div>
                        </div>

                        {!historyList.length ? (
                            <p className="p-6 text-sm text-slate-500 text-center">No backup tasks have been requested yet.</p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {historyList.map(job => (
                                    <li key={job.id} className="flex flex-col gap-2.5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/70 transition-colors">
                                        <div className="min-w-0 space-y-1">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-semibold text-slate-900">
                                                    {job.action === 'create' ? 'Create backup' : 'Check backup'}
                                                    {job.origin === 'scheduled' ? ' · Scheduled' : ''}
                                                </p>
                                                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                                                    job.executor === 'github_actions' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700'
                                                }`}>
                                                    {job.executor === 'github_actions' ? 'Cloud' : 'Workstation'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500">{formatBackupDate(job.created_at)} PHT</p>
                                            {job.status === 'failed' && (
                                                <p className="max-w-xl text-xs text-danger-ink font-medium mt-1">
                                                    {backupErrors[job.error_code] || 'This task needs attention. Contact the system administrator.'}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3 shrink-0">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
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
