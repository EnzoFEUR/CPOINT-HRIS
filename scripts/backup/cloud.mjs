import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { setTimeout as waitFor } from 'node:timers/promises';
import { assertSeparated, inside } from './core.mjs';

const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateCloudSettings(value) {
    let url;
    try { url = new URL(value.repository.slice(3)); } catch { throw new Error('Invalid cloud destination.'); }
    if (value.provider !== 'b2' || !value.repository.startsWith('s3:') || url.protocol !== 'https:'
        || !/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash
        || !/^\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[a-zA-Z0-9/_-]+)?$/.test(url.pathname)) throw new Error('Invalid cloud destination.');
    if (!value.passwordFile || !value.credentialsFile) throw new Error('Cloud password and credentials files are required.');
    const schedule = value.schedule || { enabled: false, hour: 2, minute: 0 };
    if (typeof schedule.enabled !== 'boolean' || !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23
        || !Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) throw new Error('Invalid daily backup schedule.');
    return { provider: 'b2', repository: value.repository, passwordFile: value.passwordFile, credentialsFile: value.credentialsFile, schedule };
}

export async function readCloudSettings(config, state, source) {
    if (!config.cloud) return null;
    const cloud = validateCloudSettings(config.cloud);
    for (const filename of [cloud.passwordFile, cloud.credentialsFile]) {
        if (!path.isAbsolute(filename) || !inside(state, filename) || path.resolve(filename) === path.resolve(config.passwordFile)) throw new Error('Keep independent cloud credentials inside protected backup configuration.');
        await assertSeparated(filename, [source, config.repository]);
    }
    if (path.resolve(cloud.passwordFile) === path.resolve(cloud.credentialsFile)) throw new Error('Cloud password and API credentials must use separate files.');
    return cloud;
}

export async function cloudEnvironment(cloud) {
    const credentials = dotenv.parse(await readFile(cloud.credentialsFile));
    if (!credentials.AWS_ACCESS_KEY_ID || !credentials.AWS_SECRET_ACCESS_KEY) throw new Error('Cloud credentials are incomplete.');
    return { AWS_ACCESS_KEY_ID: credentials.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: credentials.AWS_SECRET_ACCESS_KEY,
        AWS_SESSION_TOKEN: '', AWS_PROFILE: '', AWS_SHARED_CREDENTIALS_FILE: cloud.credentialsFile,
        AWS_DEFAULT_REGION: new URL(cloud.repository.slice(3)).hostname.split('.')[1] };
}

export function publicCloudStatus(value = {}) {
    if (value.configured !== true) return { configured: false, status: 'not_configured' };
    if (value.provider !== 'b2' || !['pending','verified','failed'].includes(value.status)) throw new Error('Invalid cloud evidence.');
    if (value.status === 'verified' && (!validId(value.snapshot_id) || !validDate(value.verified_at))) throw new Error('Invalid cloud verification evidence.');
    const result = { configured: true, provider: 'b2', status: value.status };
    if (validId(value.snapshot_id)) result.snapshot_id = value.snapshot_id;
    for (const key of ['verified_at','last_attempt_at','full_check_at']) if (validDate(value[key])) result[key] = value[key];
    if (value.verification === 'structure') result.verification = 'structure';
    if (Number.isSafeInteger(value.stored_bytes) && value.stored_bytes >= 0) result.stored_bytes = value.stored_bytes;
    return result;
}

const identity = cloud => createHash('sha256').update(cloud.repository).digest('hex');
export async function readCloudStatus(state, cloud) {
    if (!cloud) return publicCloudStatus();
    try {
        const value = JSON.parse(await readFile(path.join(state, 'cloud-status.json'), 'utf8'));
        if (value.destination_hash === identity(cloud)) return publicCloudStatus(value);
    } catch { /* Missing/invalid status cannot establish a verified backup. */ }
    return { configured: true, provider: cloud.provider, status: 'pending' };
}

export async function saveCloudStatus(state, cloud, status) {
    const value = { ...publicCloudStatus(status), destination_hash: identity(cloud) };
    const filename = path.join(state, 'cloud-status.json');
    const temporary = filename + '.tmp';
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, filename);
}

export async function recordCloudFailure(state, source) {
    const config = JSON.parse(await readFile(path.join(state, 'config.json'), 'utf8'));
    const cloud = await readCloudSettings(config, state, source);
    if (!cloud) return publicCloudStatus();
    const previous = await readCloudStatus(state, cloud);
    const result = { ...previous, status: 'failed', last_attempt_at: new Date().toISOString() };
    await saveCloudStatus(state, cloud, result);
    return result;
}

export async function syncCloud({ local, cloud, run, snapshotId, onProgress = () => {}, wait = waitFor }) {
    if (!validId(snapshotId)) throw new Error('An explicit completed source snapshot is required.');
    const rows = JSON.parse(await run(local, ['snapshots', '--json', '--tag', 'cpoint-hris-complete']));
    if (!rows.some(row => row.id === snapshotId && row.tags?.includes('cpoint-hris-complete'))) throw new Error('Completed source snapshot not found.');
    onProgress('cloud_upload');
    for (let attempt = 0; attempt < 3; attempt++) {
        try { await run(cloud, ['copy', '--from-repo', local.repository, '--from-password-file', local.passwordFile, snapshotId]); break; }
        catch (error) {
            if (attempt === 2) throw error;
            await wait(1000 * (2 ** attempt) + Math.floor(Math.random() * 250));
        }
    }
    const remote = JSON.parse(await run(cloud, ['snapshots', '--json', '--tag', 'cpoint-hris-complete']));
    if (!remote.some(row => row.original === snapshotId || row.id === snapshotId)) throw new Error('Cloud snapshot completion could not be verified.');
    onProgress('cloud_check');
    await run(cloud, ['check']);
    const result = { configured: true, provider: cloud.provider, status: 'verified', verification: 'structure', snapshot_id: snapshotId, verified_at: new Date().toISOString(), last_attempt_at: new Date().toISOString() };
    try {
        const stats = JSON.parse(await run(cloud, ['stats', '--mode', 'raw-data', '--json']));
        if (Number.isSafeInteger(stats.total_size) && stats.total_size >= 0) result.stored_bytes = stats.total_size;
    } catch { /* Usage reporting is optional; the cryptographic check already passed. */ }
    return result;
}

export async function checkCloudData({ cloud, run, status }) {
    await run(cloud, ['check', '--read-data']);
    return publicCloudStatus({ ...status, full_check_at: new Date().toISOString() });
}
