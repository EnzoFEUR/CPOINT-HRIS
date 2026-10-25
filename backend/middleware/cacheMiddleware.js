import NodeCache from 'node-cache';
import { PRIVATE_API_CACHE_CONTROL } from '../../shared/securityPolicy.mjs';

// In-memory cache instance for frequently read endpoints
export const memoryCache = new NodeCache({ 
    stdTTL: 30, 
    checkperiod: 60,
    useClones: false 
});
const pendingReads = new Map();

// Cache GET responses in memory based on URL and user context
export const cacheResponse = (ttlSeconds = 30) => {
    return function cachedResponse(req, res, next) {
        // Only cache idempotent GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Cache key includes route URL and optional user ID / role for multi-tenant isolation
        const userId = req.user?.id || req.query?.user_id || req.query?.employee_id || 'public';
        const cacheKey = `${req.originalUrl || req.url}:${userId}:${req.user?.role || 'public'}`;

        const cachedData = memoryCache.get(cacheKey);

        const send = (body, label) => {
            res.setHeader('X-Cache', label);
            res.setHeader('X-Cache-TTL', `${ttlSeconds}s`);
            res.setHeader('Cache-Control', PRIVATE_API_CACHE_CONTROL);
            return res.json(body);
        };
        if (cachedData !== undefined) {
            return send(cachedData, 'HIT');
        }

        const pending = pendingReads.get(cacheKey);
        if (pending) {
            return pending.promise.then(result => {
                if (res.destroyed || res.writableEnded) return;
                if (!result) return cachedResponse(req, res, next);
                res.status(result.status);
                if (result.retryAfter) res.setHeader('Retry-After', result.retryAfter);
                return send(result.body, 'COALESCED');
            }).catch(next);
        }

        let resolve;
        const flight = { promise: new Promise(done => { resolve = done; }) };
        const complete = result => {
            if (pendingReads.get(cacheKey) === flight) pendingReads.delete(cacheKey);
            res.off('finish', abandon);
            res.off('close', abandon);
            resolve(result);
        };
        const abandon = () => complete(null);
        flight.invalidate = abandon;
        pendingReads.set(cacheKey, flight);
        res.once('finish', abandon);
        res.once('close', abandon);

        const originalJson = res.json.bind(res);

        res.json = (body) => {
            res.setHeader('X-Cache', 'MISS');
            res.setHeader('Cache-Control', PRIVATE_API_CACHE_CONTROL);
            try {
                const result = { body, status: res.statusCode, retryAfter: res.getHeader('Retry-After') };
                const response = originalJson(body);
                // A concurrent write must not let an older read repopulate the cache.
                if (pendingReads.get(cacheKey) === flight && res.statusCode === 200 && body && !body.error && body.success !== false && body.status !== 'error') {
                    memoryCache.set(cacheKey, body, ttlSeconds);
                }
                complete(result);
                return response;
            } catch (error) { complete(null); throw error; }
        };

        next();
    };
};

/**
 * Invalidate cache entries matching specific route prefixes or flush all
 * @param {string|string[]} prefixes - e.g. '/api/employees', '/api/leaves', '/api/payroll'
 */
export const invalidateCache = (prefixes = []) => {
    if (!prefixes || (Array.isArray(prefixes) && prefixes.length === 0)) {
        memoryCache.flushAll();
        for (const flight of pendingReads.values()) flight.invalidate();
        return;
    }

    const targetPrefixes = Array.isArray(prefixes) ? prefixes : [prefixes];
    const allKeys = memoryCache.keys();

    targetPrefixes.forEach(prefix => {
        const matchingKeys = allKeys.filter(key => key.includes(prefix));
        if (matchingKeys.length > 0) {
            memoryCache.del(matchingKeys);
        }
        for (const [key, flight] of pendingReads) if (key.includes(prefix)) flight.invalidate();
    });
};
