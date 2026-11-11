import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { assertRestoreTarget, assertSafeArchive, assertSeparated, exportStorage, hashFile, inside, inventoryFingerprint, validateDumps, verifyFiles } from './backup/core.mjs';
import { readCloudSettings, cloudEnvironment, readCloudStatus, saveCloudStatus, syncCloud, checkCloudData } from './backup/cloud.mjs';
import { nativeConnection, dumpNative, nativeFailureCode } from './backup/native.mjs';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = path.resolve(process.env.HRIS_BACKUP_STATE_DIR || path.join(homedir(), '.config', 'cpoint-hris-backup'));
const configFile = path.join(state, 'config.json');
const action = process.argv[2] || 'help';
const options = Object.fromEntries(process.argv.slice(3).map((value, index, args) => value.startsWith('--') ? [value.slice(2), args[index + 1]] : []).filter(entry => entry.length));
const log = (stage, extra = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), stage, ...extra }));

// Capture output privately: CLI errors can contain connection strings or personal data.
async function command(executable, args, env = {}, timeout = 1800000, outputFile) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable.endsWith('.js') ? process.execPath : executable, executable.endsWith('.js') ? [executable, ...args] : args,
            { cwd: source, env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', size = 0, diagnostic = '';
        const destination = outputFile ? createWriteStream(outputFile, { flags: 'wx', mode: 0o600 }) : null;
        const written = destination ? finished(destination) : Promise.resolve();
        written.catch(() => child.kill());
        if (destination) child.stdout.pipe(destination);
        const timer = setTimeout(() => child.kill(), timeout);
        child.stdout.on('data', chunk => { size += chunk.length; if (size > (outputFile ? 2 * 1024 * 1024 * 1024 : 64 * 1024 * 1024)) child.kill(); else if (!destination) output += chunk; });
        child.stderr.on('data',chunk=>{if(['psql','pg_dump','pg_dumpall','bash'].includes(path.basename(executable))&&diagnostic.length<8192)diagnostic+=chunk.toString().slice(0,8192-diagnostic.length);});
        child.on('error', () => { clearTimeout(timer); destination?.destroy(); reject(new Error('Required backup tool could not start. Check installation and operator permissions.')); });
        child.on('close', async code => {
            clearTimeout(timer);
            try { await written; } catch { reject(new Error('Backup export file could not be completed.')); return; }
            code === 0 ? resolve(output) : reject(Object.assign(new Error(code === 11 ? 'The encrypted repository is busy. Wait for the current backup/check and retry.' : `Backup tool failed (exit ${code ?? 'terminated'}). Raw output was suppressed to protect secrets.`),{code:nativeFailureCode(diagnostic)}));
        });
    });
}

async function privateDirectory(directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
        const identity = await command('whoami.exe', ['/user', '/fo', 'csv', '/nh']);
        const sid = identity.match(/S-1-5-21-[0-9-]+/)?.[0];
        if (!sid) throw new Error('Cannot determine the backup operator identity.');
        await command('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
    }
}

const supabaseBin = process.env.HRIS_SUPABASE_BIN || (process.platform === 'win32' ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'supabase', 'dist', 'supabase.js') : 'supabase');
const parseQuery = output => JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)).rows[0].backup_inventory;
const inventorySql = `BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT jsonb_build_object(
 'postgres_version',current_setting('server_version'),
 'buckets',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM storage.buckets b),'[]'::jsonb),
 'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'updated_at',updated_at,'metadata',metadata) ORDER BY bucket_id,name) FROM storage.objects),'[]'::jsonb),
 'app_tables',coalesce((SELECT jsonb_agg(schemaname||'.'||tablename ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN('public','private')),'[]'::jsonb),
 'managed_policies',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname IN('auth','storage')),'[]'::jsonb),
 'managed_triggers',coalesce((SELECT jsonb_agg(pg_get_triggerdef(t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN('auth','storage')),'[]'::jsonb)
) AS backup_inventory; COMMIT;`;

async function settings() {
    let config;
    try { config = JSON.parse(await readFile(configFile, 'utf8')); }
    catch { throw new Error('Run npm run backup:tools, then npm run backup:init before creating a backup.'); }
    await assertSeparated(state, [source, config.repository]);
    await assertSeparated(config.repository, [source, state]);
    await assertSeparated(config.passwordFile, [source, config.repository]);
    return config;
}

async function restic(config, args) {
    return command(config.resticBin, ['--repo', config.repository, '--password-file', config.passwordFile, '--no-cache', '--retry-lock', '30s', ...args]);
}

async function cloudRestic(config, cloud, args) {
    return command(config.resticBin, ['--repo', cloud.repository, '--password-file', cloud.passwordFile, '--no-cache', '--retry-lock', '30s',
        '--limit-upload', '2048', '--limit-download', '4096', '-o', 's3.connections=2', ...args], await cloudEnvironment(cloud), 2 * 3600000);
}

async function cloudCopy(config, requestedId) {
    const cloud = await readCloudSettings(config, state, source);
    if (!cloud) { log('cloud_status', { cloud: await readCloudStatus(state, cloud), schedule: { enabled: false, hour: 2, minute: 0 } }); return; }
    const previous = await readCloudStatus(state, cloud);
    try {
        await withLock(async () => {
            const rows = JSON.parse(await restic(config, ['snapshots', '--json', '--tag', 'cpoint-hris-complete']));
            const newest = rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
            // Copy full immutable IDs, never a moving "latest" during an upload.
            const snapshotId = requestedId ? rows.find(row => row.id.startsWith(requestedId))?.id : newest?.id;
            const result = await syncCloud({ local: config, cloud, snapshotId,
                run: (target, args) => target === config ? restic(config, args) : cloudRestic(config, cloud, args), onProgress: stage => log(stage) });
            if (previous.full_check_at) result.full_check_at = previous.full_check_at;
            await saveCloudStatus(state, cloud, result);
            log('cloud_status', { cloud: result, schedule: cloud.schedule });
        });
    } catch {
        const result = { ...previous, configured: true, provider: cloud.provider, status: 'failed', last_attempt_at: new Date().toISOString() };
        await saveCloudStatus(state, cloud, result);
        log('cloud_status', { cloud: result, schedule: cloud.schedule });
        if (action !== 'create') throw new Error('Cloud copy or verification failed. Existing local and cloud backups were preserved.');
    }
}

async function cloudInit(config) {
    const cloud = await readCloudSettings(config, state, source);
    if (!cloud) throw new Error('Configure a private cloud destination in the protected operator configuration first.');
    // Preserve the same recovery key if initialization was interrupted or the repository exists.
    if (!existsSync(cloud.passwordFile)) await writeFile(cloud.passwordFile, randomBytes(48).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
    await cloudRestic(config, cloud, ['init', '--from-repo', config.repository, '--from-password-file', config.passwordFile, '--copy-chunker-params']);
    log('cloud_initialized', { provider: cloud.provider, reminder: 'Keep the independent recovery password securely offsite.' });
}

async function emitCloudStatus(config) {
    try {
        const cloud = await readCloudSettings(config, state, source);
        log('cloud_status', { cloud: await readCloudStatus(state, cloud), schedule: cloud?.schedule || { enabled: false, hour: 2, minute: 0 } });
    } catch {
        log('cloud_status', { cloud: { configured: true, provider: 'b2', status: 'failed' }, schedule: { enabled: false, hour: 2, minute: 0 } });
    }
}

async function cloudCheck(config) {
    const cloud = await readCloudSettings(config, state, source);
    if (!cloud) return;
    await withLock(async () => {
        log('cloud_check');
        const previous = await readCloudStatus(state, cloud);
        try {
            const result = await checkCloudData({ cloud, status: previous, run: (_target, args) => cloudRestic(config, cloud, args) });
            await saveCloudStatus(state, cloud, result);
            log('cloud_status', { cloud: result, schedule: cloud.schedule });
        } catch {
            const result = { ...previous, status: 'failed', last_attempt_at: new Date().toISOString() };
            await saveCloudStatus(state, cloud, result);
            log('cloud_status', { cloud: result, schedule: cloud.schedule });
            throw new Error('Cloud data check failed. Existing backups are preserved.');
        }
    });
}

async function preflight(config) {
    log('preflight');
    await restic(config, ['version']);
    await command('tar', ['--version']);
    const envFile = config.envFile || path.join(source, 'backend', '.env');
    if (config.envFile && (!path.isAbsolute(envFile) || !inside(state, envFile))) throw new Error('Hosted connection settings must stay in protected operator state.');
    const env = dotenv.parse(await readFile(envFile));
    const url = new URL(env.SUPABASE_URL || '');
    const project = url.hostname.split('.')[0];
    if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('A project HTTPS URL and server-only service key are required.');
    if (config.databaseUrlFile) {
        if (!path.isAbsolute(config.databaseUrlFile) || !inside(state, config.databaseUrlFile)) throw new Error('Database connection must stay in protected operator state.');
        const connection = nativeConnection(await readFile(config.databaseUrlFile, 'utf8'), project, path.join(state, 'postgres.pgpass'));
        await writeFile(connection.env.PGPASSFILE, connection.passwordEntry, { mode: 0o600 });
        const version = await command('pg_dump', ['--version']);
        if (!/PostgreSQL\) 17\./.test(version)) throw new Error('Native backup requires PostgreSQL 17 client tools.');
        await command('pg_dumpall', ['--version']); await command('psql', ['--version']); await command('bash', ['--version']);
        return { env, project, origin: url.origin, native: connection.env, envFile };
    }
    await command(supabaseBin, ['--version']);
    try { await command('docker', ['info', '--format', '{{.ServerVersion}}'], {}, 15000); }
    catch { throw new Error('Docker Desktop must be running for the workstation Supabase CLI export. Native hosted backups do not require Docker.'); }
    const linked = (await readFile(path.join(source, 'supabase', '.temp', 'project-ref'), 'utf8')).trim();
    if (linked !== project) throw new Error('Linked database and Storage project do not match. Stop and verify the project link.');
    return { env, project, origin: url.origin, envFile };
}

async function init() {
    await assertSeparated(state, [source]);
    if (existsSync(configFile)) { log('already_initialized', { configFile }); return; }
    const root = path.resolve(options.root || path.join(homedir(), 'CPoint-HRIS-Backups'));
    await assertRestoreTarget(root, { source, repository: state });
    const resticBin = process.env.HRIS_RESTIC_BIN || path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'CPoint-HRIS-Backup', 'restic.exe');
    await command(resticBin, ['version']);
    await privateDirectory(state);
    await privateDirectory(root);
    const passwordFile = path.join(state, 'repository-password.txt');
    await writeFile(passwordFile, randomBytes(48).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
    const config = { version: 1, repository: path.join(root, 'repository'), passwordFile, resticBin };
    await restic(config, ['init']);
    await writeFile(configFile, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
    log('initialized', { repository: config.repository, configFile, passwordFile, reminder: 'Keep a separate protected copy of the password; it is not inside the encrypted repository.' });
}

async function withLock(callback) {
    const lockPath = path.join(state, 'job.lock');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); } catch { throw new Error('A backup job is running, or a previous interrupted job left job.lock. Verify no job is running before removing that lock.'); }
    try { await lock.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); return await callback(); }
    finally { await lock.close(); await rm(lockPath); }
}

async function create(config) {
    const connection = await preflight(config);
    return withLock(async () => {
        const stagingRoot = path.join(state, 'staging');
        await privateDirectory(stagingRoot);
        const staging = await mkdtemp(path.join(stagingRoot, 'run-'));
        const bundle = path.join(staging, 'bundle');
        await mkdir(bundle, { mode: 0o700 });
        const started = new Date().toISOString();
        try {
            const queryFile = path.join(staging, 'inventory-query.sql');
            await writeFile(queryFile, inventorySql, { mode: 0o600 });
            const inventory = async () => connection.native
                ? JSON.parse((await command('psql', ['-X','--no-password','-qAt','--file',queryFile], connection.native)).trim())
                : parseQuery(await command(supabaseBin, ['db', 'query', '--linked', '--file', queryFile, '--output', 'json']));
            const before = await inventory();
            log('database_export');
            if (connection.native) await dumpNative(bundle, connection.native, command);
            else for (const [file, flags] of [['roles.sql', ['--role-only']], ['schema.sql', []], ['data.sql', ['--data-only', '--use-copy', '--exclude', 'storage.buckets_vectors', '--exclude', 'storage.vector_indexes']]]) {
                    await command(supabaseBin, ['db', 'dump', '--linked', ...flags, '--file', path.join(bundle, file)], { SUPABASE_DB_PASSWORD: process.env.SUPABASE_DB_PASSWORD || '' });
                }
            await validateDumps(bundle, [...before.app_tables, 'auth.users', 'storage.buckets', 'storage.objects']);
            await writeFile(path.join(bundle, 'source-inventory.json'), JSON.stringify(before), { mode: 0o600 });
            log('storage_export', { objects: before.objects.length });
            const storageFiles = await exportStorage(bundle, before.objects, object => fetch(`${connection.origin}/storage/v1/object/authenticated/${encodeURIComponent(object.bucket_id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`, {
                headers: { apikey: connection.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${connection.env.SUPABASE_SERVICE_ROLE_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(120000),
            }));
            const after = await inventory();
            if (inventoryFingerprint(before.objects) !== inventoryFingerprint(after.objects) || inventoryFingerprint(before.buckets) !== inventoryFingerprint(after.buckets)) throw new Error('Storage changed during export. No completed snapshot was created; retry in a quiet window.');
            const migrations = path.join(source, 'supabase', 'migrations');
            await mkdir(path.join(bundle, 'migrations'), { mode: 0o700 });
            if (existsSync(migrations)) for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) await copyFile(path.join(migrations, file), path.join(bundle, 'migrations', file));
            await mkdir(path.join(bundle, 'local-configuration'), { mode: 0o700 });
            await copyFile(connection.envFile, path.join(bundle, 'local-configuration', 'backend.env'));
            const files = [...storageFiles];
            async function collect(directory, prefix = '') {
                for (const entry of await readdir(directory, { withFileTypes: true })) {
                    const relative = prefix + entry.name;
                    if (entry.isSymbolicLink()) throw new Error('Unexpected link in backup staging.');
                    if (entry.isDirectory()) { if (relative !== 'storage') await collect(path.join(directory, entry.name), relative + '/'); }
                    else files.push({ file: relative, ...await hashFile(path.join(directory, entry.name)) });
                }
            }
            await collect(bundle);
            await writeFile(path.join(bundle, 'manifest.json'), JSON.stringify({ version: 1, project: connection.project, started_at: started, completed_at: new Date().toISOString(), files,
                consistency: 'Separate database exports and Storage drift checks; not an atomic cross-service snapshot. Use a quiet window.',
                configuration: connection.native ? 'Scoped hosted worker settings only. Deployment secrets, original application encryption keys and provider settings require the separate recovery inventory.' : 'Local backend environment only. Cloud dashboards, external keys and provider settings need a separate recovery inventory.' }, null, 2), { mode: 0o600 });
            await verifyFiles(bundle, files);
            log('encrypting_snapshot');
            const output = await restic(config, ['backup', '--stdin-from-command', '--stdin-filename', 'bundle.tar', '--json', '--tag', 'cpoint-hris-complete', '--host', 'cpoint-backup', '--', 'tar', '-cf', '-', '-C', bundle, '.']);
            const summary = output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)).find(row => row.message_type === 'summary');
            if (!/^[a-f0-9]{8,64}$/.test(summary?.snapshot_id || '')) throw new Error('Encrypted snapshot completion could not be verified.');
            log('encrypted_snapshot_saved', { snapshot: summary.snapshot_id, files: files.length, objects: storageFiles.length, databaseRestoreTested: false });
            return summary.snapshot_id;
        } finally {
            if (!inside(stagingRoot, staging) || path.dirname(staging) !== stagingRoot || !path.basename(staging).startsWith('run-')) throw new Error('Unsafe staging cleanup path.');
            await rm(staging, { recursive: true, force: true });
        }
    });
}

async function restoreFiles(config) {
    if (!/^[a-f0-9]{8,64}$/.test(options.snapshot || '') || !options.target || !path.isAbsolute(options.target)) throw new Error('Supply --snapshot <explicit ID> and --target <absolute empty directory>.');
    const target = path.resolve(options.target);
    await assertRestoreTarget(target, { source, repository: config.repository, state });
    await privateDirectory(target);
    await restic(config, ['restore', options.snapshot, '--target', target, '--verify']);
    const archive = path.join(target, 'bundle.tar');
    const entries = (await command('tar', ['-tf', archive])).split(/\r?\n/).filter(Boolean);
    const types = (await command('tar', ['-tvf', archive])).split(/\r?\n/).filter(Boolean);
    assertSafeArchive(entries, types);
    const bundle = path.join(target, 'bundle');
    await mkdir(bundle, { mode: 0o700 });
    await command('tar', ['-xf', archive, '-C', bundle, '--no-same-owner', '--no-same-permissions']);
    const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Unsupported backup manifest.');
    await verifyFiles(bundle, manifest.files);
    await validateDumps(bundle);
    log('files_restored_and_hash_verified', { target, files: manifest.files.length, databaseRestoreTested: false });
}

try {
    if (action === 'init') await init();
    else if (action === 'help') console.log('Commands: init [--root PATH], preflight, create, check, snapshots, cloud-init, cloud-copy, cloud-check, cloud-status, restore-files --snapshot ID --target EMPTY_PATH. No command restores a live database or deletes snapshots.');
    else {
        const config = await settings();
        if (action === 'preflight') { await preflight(config); log('preflight_passed'); }
        else if (action === 'create') {
            const id = await create(config);
            try { await cloudCopy(config, id); }
            catch { await emitCloudStatus(config); } // Cloud setup/report failure must not erase a completed local backup.
        }
        else if (action === 'cloud-init') await withLock(() => cloudInit(config));
        else if (action === 'cloud-copy') await cloudCopy(config);
        else if (action === 'cloud-check') await cloudCheck(config);
        else if (action === 'cloud-status') await emitCloudStatus(config);
        else if (action === 'check') { await restic(config, ['check', '--read-data']); await cloudCheck(config); log('encrypted_repository_check_passed'); }
        else if (action === 'snapshots') { const rows = JSON.parse(await restic(config, ['snapshots', '--json', '--tag', 'cpoint-hris-complete'])); log('snapshots', { snapshots: rows.map(({ id, time }) => ({ id, time })) }); }
        else if (action === 'restore-files') await withLock(() => restoreFiles(config));
        else throw new Error('Unknown backup command. Run node scripts/backup.mjs help.');
    }
} catch (error) {
    const code=['DB_AUTH_FAILED','DB_TLS_FAILED','DB_PERMISSION_DENIED','DB_NETWORK_FAILED'].includes(error.code)?error.code:error.message==='Native backup requires PostgreSQL 17 client tools.'?'PG_CLIENT_VERSION'
        : error.message.startsWith('Required backup tool could not start')?'BACKUP_TOOL_START'
        : error.message.startsWith('Backup tool failed')?'BACKUP_TOOL_FAILED'
        : /connection|pooler|project.*match/i.test(error.message)?'SOURCE_CONNECTION':'BACKUP_FAILED';
    log('failed', { code, message: error.message.startsWith('fetch') ? 'Storage download failed; no successful backup was recorded.' : error.message });
    process.exitCode = 1;
}
