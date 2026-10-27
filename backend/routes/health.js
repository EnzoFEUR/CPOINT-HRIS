import express from 'express';
import { createCachedRead } from '../utils/cachedRead.js';
import { API_RATE_POLICY } from '../../shared/securityPolicy.mjs';

export function createHealthRouter(database, env = process.env) {
    const router = express.Router();
    const revision = /^[a-f0-9]{7,40}$/i.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT.slice(0, 12) : undefined;
    const checkDatabase = createCachedRead(async () => {
        const signal = AbortSignal.timeout(3000);
        const results = await Promise.all([
            database.from('employees').select('id', { head: true }).limit(1).abortSignal(signal),
            database.rpc('get_hris_login_verification', { p_auth_user_id: '00000000-0000-0000-0000-000000000000', p_session_id: '00000000-0000-0000-0000-000000000000' }).abortSignal(signal),
        ]);
        const error = results.find(result => result.error)?.error;
        if (error) throw error;
    }, { ttlMs: 10000, errorTtlMs: 2000 });

    router.get('/health', (req, res) => res.json({ status: 'ok', service: 'C-Point HRIS API', timestamp: new Date().toISOString(), apiRatePolicy: API_RATE_POLICY, revision }));
    router.get('/ready', async (req, res) => {
        try {
            await checkDatabase();
            res.json({ status: 'ok', service: 'C-Point HRIS API', timestamp: new Date().toISOString() });
        } catch {
            res.setHeader('Retry-After', '2');
            res.status(503).json({ code: 'DATABASE_UNAVAILABLE', error: 'Database service unavailable' });
        }
    });
    return router;
}
