import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { homedir } from 'node:os';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { publicCloudStatus, recordCloudFailure } from './cloud.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = new Set(['preflight','database_export','storage_export','encrypting_snapshot','encrypted_snapshot_saved','encrypted_repository_check_passed','preflight_passed','snapshots','cloud_upload','cloud_check','cloud_status']);
const snapshot = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value < 1e9;
const diagnosticCodes=new Set(['PG_CLIENT_VERSION','BACKUP_TOOL_START','BACKUP_TOOL_FAILED','SOURCE_CONNECTION','BACKUP_FAILED','DB_AUTH_FAILED','DB_TLS_FAILED','DB_PERMISSION_DENIED','DB_NETWORK_FAILED']);

export function safeProgress(row) {
    if (!stages.has(row?.stage)) return null;
    if (row.stage === 'cloud_status') {
        const schedule = row.schedule;
        if (typeof schedule?.enabled !== 'boolean' || !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23
            || !Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) return null;
        return { stage: row.stage, cloud: publicCloudStatus(row.cloud), schedule: { enabled: schedule.enabled, hour: schedule.hour, minute: schedule.minute } };
    }
    if (row.stage === 'encrypted_snapshot_saved') return snapshot(row.snapshot) && count(row.files) && count(row.objects)
        ? { stage: row.stage, snapshot_id: row.snapshot, files: row.files, objects: row.objects } : null;
    if (row.stage === 'snapshots') return { stage: row.stage, snapshots: (Array.isArray(row.snapshots) ? row.snapshots : [])
        .filter(item => snapshot(item.id) && Number.isFinite(Date.parse(item.time))).map(item => ({ id: item.id, time: item.time })) };
    return { stage: row.stage };
}

export async function executeBackupTask(action, { onProgress = () => {}, signal, cli = path.join(root, 'scripts/backup.mjs') } = {}) {
    if (!['create','check','preflight','snapshots','cloud-status'].includes(action)) throw new Error('Unsupported backup worker command.');
    if (signal?.aborted) throw new Error('Backup task stopped.');
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, action], { cwd: root, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
        let buffered = '', evidence, cloudEvidence, cloudStarted = false, failureCode, chain = Promise.resolve(), stopped = false;
        const stop = () => {
            stopped = true;
            if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
            else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Process may already have exited. */ } }
        };
        const timer = setTimeout(stop, action === 'preflight' ? 30000 : ['snapshots','cloud-status'].includes(action) ? 60000 : 3 * 3600000);
        signal?.addEventListener('abort', stop, { once: true });
        child.stderr.resume();
        child.stdout.on('data', chunk => {
            buffered += chunk;
            if (buffered.length > 65536) { stop(); return; }
            const lines = buffered.split(/\r?\n/); buffered = lines.pop();
            for (const line of lines) {
                let row; try {
                    const parsed=JSON.parse(line);
                    if(parsed.stage==='failed'&&diagnosticCodes.has(parsed.code))failureCode=parsed.code;
                    row = safeProgress(parsed);
                } catch { continue; }
                if (!row) continue;
                if (['cloud_upload','cloud_check'].includes(row.stage)) cloudStarted = true;
                if (row.stage === 'cloud_status') cloudEvidence = { cloud: row.cloud, schedule: row.schedule };
                if (['encrypted_snapshot_saved','encrypted_repository_check_passed','preflight_passed','snapshots'].includes(row.stage)) evidence = row;
                chain = chain.then(() => onProgress(row)).catch(() => {});
            }
        });
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
        child.on('error', () => { cleanup(); reject(new Error('Backup task could not start.')); });
        child.on('close', async code => {
            cleanup(); await chain;
            if (stopped || code !== 0) {
                if (action === 'create' && cloudStarted && evidence?.stage === 'encrypted_snapshot_saved') return resolve({ snapshot_id: evidence.snapshot_id, files: evidence.files, objects: evidence.objects,
                    cloud: { configured: true, provider: 'b2', status: 'failed', last_attempt_at: new Date().toISOString() } });
                return reject(Object.assign(new Error('Backup task failed or was interrupted.'),{code:failureCode||'BACKUP_FAILED'}));
            }
            if (action === 'create' && evidence?.stage === 'encrypted_snapshot_saved') return resolve({ snapshot_id: evidence.snapshot_id, files: evidence.files, objects: evidence.objects, ...cloudEvidence });
            if (action === 'cloud-status' && cloudEvidence) return resolve(cloudEvidence);
            if (action === 'check' && evidence?.stage === 'encrypted_repository_check_passed') return resolve({ integrity_passed: true });
            if (action === 'preflight' && evidence?.stage === 'preflight_passed') return resolve({ ready: true });
            if (action === 'snapshots' && evidence?.stage === 'snapshots') return resolve(evidence.snapshots);
            reject(new Error('Backup completion could not be verified.'));
        });
    });
}

export async function runBackupWorker() {
    const env = dotenv.parse(await readFile(path.join(root, 'backend/.env')));
    if (!env.SUPABASE_URL?.startsWith('https://') || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Backup operator configuration is missing.');
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const workerId = randomUUID();
    let ready = false, latest = {}, automation, lastAutomation = 0, lastHeartbeat = 0, lastProbe = 0, probe, task, taskController, stopping = false, warnedSetup = false;
    const rpc = async (name, args) => {
        const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(10000));
        if (error) throw new Error(error.code === 'PGRST202' ? 'BACKUP_SETUP_REQUIRED' : error.message?.startsWith('BACKUP_WORKER_IN_USE') ? 'BACKUP_WORKER_IN_USE' : 'BACKUP_CONNECTION_UNAVAILABLE');
        return data;
    };
    const stop = () => { stopping = true; taskController?.abort(); };
    const reportAutomation = async (force = false) => {
        if (!automation || (!force && Date.now() - lastAutomation < 60000)) return;
        try {
            await rpc('hris_backup_automation', { p_worker_id: workerId, p_cloud: automation.cloud, p_schedule: automation.schedule });
        } catch (error) {
            if (error.message !== 'BACKUP_SETUP_REQUIRED') throw error;
            if (!warnedSetup) console.warn('Cloud reporting and daily scheduling need the reviewed backup automation database update. Manual local backups remain available.');
            warnedSetup = true;
        }
        lastAutomation = Date.now();
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log('Backup worker started. Waiting for authorized administrator requests.');
    try {
        while (!stopping) {
            try {
                if (Date.now() - lastHeartbeat >= 15000) {
                    await rpc('hris_backup_heartbeat', { p_worker_id: workerId, p_ready: ready, p_latest: latest });
                    lastHeartbeat = Date.now();
                }
                if (!task && !probe && Date.now() - lastProbe >= 60000) {
                    lastProbe = Date.now();
                    probe = (async () => {
                        try {
                            await executeBackupTask('preflight');
                            const rows = await executeBackupTask('snapshots');
                            const newest = rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
                            latest = newest ? { snapshot_id: newest.id, created_at: newest.time } : {};
                            automation = await executeBackupTask('cloud-status');
                            ready = true; lastHeartbeat = 0;
                        } catch { ready = false; }
                    })().finally(() => { probe = undefined; });
                }
                if (ready && !task && !probe) {
                    await reportAutomation();
                    const job = await rpc('hris_backup_claim', { p_worker_id: workerId });
                    if (job) {
                        taskController = new AbortController();
                        task = (async () => {
                            let success = false, result;
                            try {
                                result = await executeBackupTask(job.action, { signal: taskController.signal, onProgress: row => {
                                    if (row.stage === 'cloud_status') { automation = { cloud: row.cloud, schedule: row.schedule }; return reportAutomation(true); }
                                    if (['preflight','database_export','storage_export','encrypting_snapshot','cloud_upload','cloud_check'].includes(row.stage)) return rpc('hris_backup_progress', { p_worker_id: workerId, p_job_id: job.id, p_stage: row.stage });
                                } });
                                if (result.cloud) {
                                    if (result.cloud.status === 'failed') {
                                        try { result.cloud = await recordCloudFailure(path.resolve(process.env.HRIS_BACKUP_STATE_DIR || path.join(homedir(), '.config', 'cpoint-hris-backup')), root); }
                                        catch { /* The sanitized failure still reaches Admin if local status persistence is unavailable. */ }
                                    }
                                    automation = { cloud: result.cloud, schedule: result.schedule || automation?.schedule || { enabled: false, hour: 2, minute: 0 } };
                                    delete result.cloud; delete result.schedule;
                                    try { await reportAutomation(true); } catch { console.warn('Cloud status reporting is pending; local backup remains saved.'); }
                                }
                                success = true;
                            } catch { result = { error_code: 'BACKUP_FAILED' }; }
                            try { await rpc('hris_backup_finish', { p_worker_id: workerId, p_job_id: job.id, p_success: success, p_result: result }); }
                            catch { console.warn('Backup result could not be synchronized. Check the administrator page and local repository.'); }
                            latest = {}; lastProbe = 0;
                        })().finally(() => { task = undefined; taskController = undefined; });
                    }
                }
            } catch (error) {
                if (['BACKUP_WORKER_IN_USE','BACKUP_SETUP_REQUIRED'].includes(error.message)) throw error;
                if (Date.now() - lastHeartbeat > 60000) { ready = false; taskController?.abort(); }
                console.warn('Backup service connection unavailable; retrying.');
            }
            if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
        }
    } finally {
        taskController?.abort(); await task; await probe;
        try { await rpc('hris_backup_heartbeat', { p_worker_id: workerId, p_ready: false, p_latest: {} }); } catch { /* Lease expires if disconnected. */ }
        await client.removeAllChannels();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runBackupWorker().catch(error => { console.error(error.message === 'BACKUP_SETUP_REQUIRED' ? 'Backup page setup is not active yet. Ask the system administrator to apply its reviewed database update.' : 'Backup worker stopped. Check its setup or another running worker.'); process.exitCode = 1; });
}
