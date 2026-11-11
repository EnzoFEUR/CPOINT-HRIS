const formatter = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const formatBackupDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? formatter.format(new Date(value)) : 'Not available';
export const backupStages = {
    queued: 'Waiting to start', preflight: 'Preparing backup', database_export: 'Copying database', storage_export: 'Copying uploaded files',
    encrypting_snapshot: 'Encrypting and saving', checking: 'Checking backup integrity', completed: 'Completed', failed: 'Needs attention',
    cloud_upload: 'Copying encrypted backup to cloud', cloud_check: 'Verifying cloud backup',
};
export const backupErrors = {
    REQUESTER_NO_LONGER_AUTHORIZED: 'The request was stopped because administrator access changed.',
    WORKER_INTERRUPTED: 'The backup computer disconnected before the task finished.',
    WORKER_NOT_READY: 'The backup computer needs attention. Contact the system administrator.',
    BACKUP_TIMEOUT: 'The task took too long. Contact the system administrator before retrying.',
    BACKUP_FAILED: 'The task could not finish. Existing backups are preserved. Contact the system administrator.',
};

export function backupView(data = {}, now = Date.now()) {
    const hosted = data.executor === 'github_actions';
    const online = data.configured === true && data.worker_online === true;
    const hasBackup = Boolean(data.latest_backup?.created_at);
    const checked = hasBackup && Number.isFinite(Date.parse(data.last_check_at)) && Date.parse(data.last_check_at) >= Date.parse(data.latest_backup.created_at);
    const cloud = data.cloud || {};
    const cloudCurrent = cloud.configured === true && cloud.status === 'verified' && Boolean(cloud.snapshot_id)
        && cloud.snapshot_id === data.latest_backup?.snapshot_id && Number.isFinite(Date.parse(cloud.verified_at));
    const scheduled = data.schedule?.enabled === true;
    const overdue = scheduled && (!hasBackup || now - Date.parse(data.latest_backup.created_at) > 26 * 3600000);
    return {
        hosted,
        workflowUrl: hosted && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/workflows\/backup\.yml$/.test(data.workflow_url || '') ? data.workflow_url : null,
        cloudCurrent,
        cloudLabel: !cloud.configured ? 'Cloud storage not connected' : cloud.status === 'failed' ? 'Cloud backup needs attention'
            : cloudCurrent ? 'Latest cloud copy checked' : cloud.status === 'verified' ? 'Newer local backup needs a cloud copy' : 'Waiting for first checked cloud backup',
        scheduleLabel: scheduled ? `Daily ${hosted ? 'around' : 'at'} ${String(data.schedule.hour).padStart(2, '0')}:${String(data.schedule.minute).padStart(2, '0')} PHT` : 'Automatic backups are off',
        overdue,
        availability: !data.configured ? 'Backup service needs setup' : hosted ? scheduled ? 'Cloud backup schedule enabled' : 'Cloud backup schedule disabled' : online ? 'Backup computer available' : 'Backup computer unavailable',
        canCreate: !hosted && online && !data.active_job && !(data.cooldowns?.create > 0),
        canCheck: !hosted && online && !data.active_job && hasBackup && !(data.cooldowns?.check > 0),
        checkLabel: !data.last_check_at ? 'Not checked yet' : checked ? 'Passed' : 'Needs checking',
        checkCurrent: checked,
        stageLabel: backupStages[data.active_job?.stage] || 'Working on your request',
    };
}
