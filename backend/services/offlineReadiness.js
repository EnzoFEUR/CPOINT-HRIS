import { createCachedRead } from '../utils/cachedRead.js';
import { offlineConfig } from './offlineAttendance.js';

export function createOfflineReadiness(database, env = process.env) {
    const checkSchema = createCachedRead(async () => {
        const { data, error } = await database.rpc('offline_attendance_production_ready').abortSignal(AbortSignal.timeout(3000));
        if (error || data?.available !== true || data.version !== 1) throw new Error('Offline schema is not ready.');
    }, { ttlMs: 30000, errorTtlMs: 5000 });

    return async () => {
        if (env.OFFLINE_ATTENDANCE_ENABLED !== 'true') return { enabled: false, ready: false, code: 'OFFLINE_DISABLED' };
        try { offlineConfig(env); }
        catch { return { enabled: true, ready: false, code: 'OFFLINE_CONFIG_REQUIRED' }; }
        if (env.NODE_ENV === 'production') {
            try { await checkSchema(); }
            catch { return { enabled: true, ready: false, code: 'OFFLINE_SCHEMA_NOT_READY' }; }
        }
        return { enabled: true, ready: true, code: 'OFFLINE_READY' };
    };
}
