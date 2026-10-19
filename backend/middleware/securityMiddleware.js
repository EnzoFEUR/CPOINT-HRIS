import { API_CONTENT_SECURITY_POLICY, trustedOrigins } from '../../shared/securityPolicy.mjs';

export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.removeHeader('Server');
    res.removeHeader('X-Powered-By');
    next();
};

export function createCorsOptions(env = process.env) {
    const allowed = trustedOrigins(env);
    return {
        origin(origin, callback) {
            if (!origin || allowed.has(origin)) return callback(null, true);
            callback(Object.assign(new Error('This origin is not allowed.'), { status: 403, code: 'CORS_ORIGIN_DENIED', expose: true }));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'Expires'],
        exposedHeaders: ['Retry-After', 'X-Request-ID', 'X-Cache'],
        maxAge: 86400,
    };
}

export const removeExposedHeaders = (req, res, next) => {
    res.removeHeader('X-Powered-By');
    next();
};

// In-memory rate limiting store: ip -> { count, resetTime }
const apiRateLimitMap = new Map();
const authRateLimitMap = new Map();

// Periodic cleanup every 5 minutes to prevent memory leaks
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of apiRateLimitMap.entries()) {
        if (now > data.resetTime) apiRateLimitMap.delete(ip);
    }
    for (const [ip, data] of authRateLimitMap.entries()) {
        if (now > data.resetTime) authRateLimitMap.delete(ip);
    }
}, 5 * 60 * 1000);
if (cleanupInterval.unref) {
    cleanupInterval.unref();
}

/**
 * Enterprise API Rate Limiter
 * Protects against automated DevTools console request flooding and resource exhaustion.
 * Default: 300 requests per minute per IP.
 */
export const apiRateLimiter = (options = { windowMs: 60 * 1000, max: 300 }) => {
    return (req, res, next) => {
        // Bypass rate limiting for static assets and root health probe
        const path = req.path || '';
        if (path.startsWith('/assets') || path.startsWith('/public') || path === '/' || path === '/api/health') {
            return next();
        }

        const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
        const now = Date.now();
        let record = apiRateLimitMap.get(ip);

        if (!record || now > record.resetTime) {
            record = { count: 1, resetTime: now + options.windowMs };
            apiRateLimitMap.set(ip, record);
            return next();
        }

        record.count++;
        if (record.count > options.max) {
            res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
            return res.status(429).json({
                error: 'Too many requests. Enterprise rate limit exceeded, please retry later.'
            });
        }

        next();
    };
};

/**
 * Auth Rate Limiter
 * Enforces strict attempt thresholds on authentication routes (/api/auth/*)
 * Default: 45 requests per minute per IP.
 */
export const authRateLimiter = (options = { windowMs: 60 * 1000, max: 45 }) => {
    return (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
        const now = Date.now();
        let record = authRateLimitMap.get(ip);

        if (!record || now > record.resetTime) {
            record = { count: 1, resetTime: now + options.windowMs };
            authRateLimitMap.set(ip, record);
            return next();
        }

        record.count++;
        if (record.count > options.max) {
            res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
            return res.status(429).json({
                error: 'Too many authentication attempts. Please wait before retrying.'
            });
        }

        next();
    };
};
