import NodeCache from 'node-cache';

// In-memory cache instance for frequently read endpoints
export const memoryCache = new NodeCache({ 
    stdTTL: 30, 
    checkperiod: 60,
    useClones: false 
});

// Cache GET responses in memory based on URL and user context
export const cacheResponse = (ttlSeconds = 30) => {
    return (req, res, next) => {
        // Only cache idempotent GET requests
        if (req.method !== 'GET') {
            return next();
        }

        // Cache key includes route URL and optional user ID / role for multi-tenant isolation
        const userId = req.user?.id || req.query?.user_id || req.query?.employee_id || 'public';
        const cacheKey = `${req.originalUrl || req.url}:${userId}`;

        const cachedData = memoryCache.get(cacheKey);

        if (cachedData) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('X-Cache-TTL', `${ttlSeconds}s`);
            return res.json(cachedData);
        }

        // Intercept res.json to capture and store payload
        const originalJson = res.json.bind(res);

        res.json = (body) => {
            // Only cache successful 200 responses
            if (res.statusCode >= 200 && res.statusCode < 300 && body && !body.error) {
                memoryCache.set(cacheKey, body, ttlSeconds);
            }
            res.setHeader('X-Cache', 'MISS');
            return originalJson(body);
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
        return;
    }

    const targetPrefixes = Array.isArray(prefixes) ? prefixes : [prefixes];
    const allKeys = memoryCache.keys();

    targetPrefixes.forEach(prefix => {
        const matchingKeys = allKeys.filter(key => key.includes(prefix));
        if (matchingKeys.length > 0) {
            memoryCache.del(matchingKeys);
        }
    });
};
