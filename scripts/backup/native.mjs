import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lists match Supabase CLI v2.101.0 pkg/migration/dump.go; scripts are vendored with attribution.
const internal = ['information_schema','pg_*','_analytics','_realtime','_supavisor','auth','etl','extensions','pgbouncer','realtime','storage','supabase_functions','supabase_migrations','cron','dbdev','graphql','graphql_public','net','pgmq','pgsodium','pgsodium_masks','pgtle','repack','tiger','tiger_data','timescaledb_*','_timescaledb_*','topology','vault'];
const excludedData = ['information_schema','pg_*','graphql','graphql_public','pgsodium','pgsodium_masks','pgtle','repack','tiger','tiger_data','timescaledb_*','_timescaledb_*','topology','vault','etl','extensions','pgbouncer','realtime','supabase_migrations','_analytics','_realtime','_supavisor'];
const reserved = ['anon','authenticated','authenticator','cli_login_.*','dashboard_user','pgbouncer','postgres','service_role','supabase_.*','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker','pgtle_admin'];
const allowedConfigs = ['pgaudit.*','pgrst.*','session_replication_role','statement_timeout','track_io_timing'];
const vendor = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor/supabase-v2.101.0');

export function nativeFailureCode(text) {
    if(/password authentication failed|tenant or user not found/i.test(text))return 'DB_AUTH_FAILED';
    if(/certificate verify failed|root certificate|SSL error/i.test(text))return 'DB_TLS_FAILED';
    if(/permission denied/i.test(text))return 'DB_PERMISSION_DENIED';
    if(/could not translate host name|network is unreachable|connection refused|timeout expired|connection timed out/i.test(text))return 'DB_NETWORK_FAILED';
    return 'BACKUP_TOOL_FAILED';
}

export function nativeConnection(value, project, passwordFile) {
    let url;
    try { url = new URL(value.trim()); } catch { throw new Error('Invalid native database connection.'); }
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!['postgres:','postgresql:'].includes(url.protocol) || !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
        || url.port !== '5432' || url.pathname !== '/postgres' || user !== `postgres.${project}` || !password || /[\r\n\0]/.test(password)
        || Array.from(url.searchParams.keys()).some(key => key !== 'sslmode')) throw new Error('Use the matching Supabase Session pooler connection on port 5432.');
    const escape = part => part.replaceAll('\\','\\\\').replaceAll(':','\\:');
    return { passwordEntry: [url.hostname,'5432','postgres',user,password].map(escape).join(':') + '\n',
        env: { PGHOST: url.hostname, PGPORT: '5432', PGUSER: user, PGDATABASE: 'postgres', PGPASSWORD: '', PGPASSFILE: passwordFile,
            PGSSLMODE: 'verify-full', PGSSLROOTCERT: fileURLToPath(new URL('./certificates/supabase-root-2021.crt', import.meta.url)), PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'cpoint-encrypted-backup',
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000' } };
}

export async function dumpNative(bundle, environment, run) {
    const common = { ...environment, EXTRA_SED: '/^--/d', EXTRA_FLAGS: '', EXCLUDED_SCHEMAS: '', INCLUDED_SCHEMAS: '*', RESERVED_ROLES: reserved.join('|'), ALLOWED_CONFIGS: allowedConfigs.join('|') };
    for (const [file, script, extra] of [
        ['roles.sql','dump_role.sh',{}],
        ['schema.sql','dump_schema.sh',{ EXCLUDED_SCHEMAS: internal.join('|') }],
        ['data.sql','dump_data.sh',{ EXCLUDED_SCHEMAS: excludedData.join('|'), EXTRA_FLAGS: '--exclude-table storage.buckets_vectors --exclude-table storage.vector_indexes' }],
    ]) await run('bash', [path.join(vendor, script)], { ...common, ...extra }, 30 * 60000, path.join(bundle, file));
}
