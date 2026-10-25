import express from 'express';
import { createCachedRead } from '../utils/cachedRead.js';
import { API_RATE_POLICY } from '../../shared/securityPolicy.mjs';

export function createHealthRouter(database) {
    const router = express.Router();
    const checkDatabase = createCachedRead(async () => {
        const { error } = await database.from('employees').select('id', { head: true }).limit(1)
            .abortSignal(AbortSignal.timeout(3000));
        if (error) throw error;
    }, { ttlMs: 10000, errorTtlMs: 2000 });

    router.get('/health', (req, res) => res.json({ status: 'ok', service: 'C-Point HRIS API', timestamp: new Date().toISOString(), apiRatePolicy: API_RATE_POLICY }));
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
