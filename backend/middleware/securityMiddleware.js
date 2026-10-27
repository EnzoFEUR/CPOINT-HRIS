import { API_CONTENT_SECURITY_POLICY, trustedOrigins } from '../../shared/securityPolicy.mjs';
import { recordRateLimitBlock } from '../utils/telemetry.js';

export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', API_CONTENT_SECURITY_POLICY);
    if (req.secure || process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
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

// In-memory rate limiting store: ip -> { count, resetTime }, bounded per limiter.
const isLivenessProbe = req => (req.method === 'GET' || req.method === 'HEAD') && (req.originalUrl || req.path || '').split('?')[0] === '/api/health';

const verifiedEmployeeId = req => req.user?.employee_identity_verified === true && req.user?.role_verified === true &&
    typeof req.user.id === 'string' && req.user.id ? req.user.id : null;

function createRateLimiter({ windowMs, max, maxKeys = 10000, byVerifiedEmployee = false, releaseVerified = false }, kind) {
    if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowMs) || windowMs < 1 || !Number.isInteger(maxKeys) || maxKeys < 1) throw new Error('Invalid rate limiter configuration.');
    const records = new Map();
    return (req, res, next) => {
        // The liveness probe does no database work; readiness and metrics remain rate limited.
        if (isLivenessProbe(req)) return next();
        const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
        const employeeId = byVerifiedEmployee && verifiedEmployeeId(req);
        const key = employeeId ? `employee:${employeeId}` : `ip:${ip}`;
        const now = Date.now();
        let record = records.get(key);
        if (!record || now >= record.resetTime) {
            if (record) records.delete(key);
            if (records.size >= maxKeys) {
                // Expiry order follows insertion order, avoiding an unbounded request-time sweep.
                const oldest = records.entries().next().value;
                if (oldest[1].resetTime <= now) records.delete(oldest[0]);
                else {
                    res.setHeader('Retry-After', '2');
                    return res.status(503).json({ code: 'SERVER_BUSY', error: 'The service is busy. Please retry shortly.' });
                }
            }
            record = { count: 0, resetTime: now + windowMs };
            records.set(key, record);
        }
        if (record.count >= max) {
            recordRateLimitBlock(kind);
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((record.resetTime - now) / 1000))));
            return res.status(429).json({ error: kind === 'auth'
                ? 'Too many authentication attempts. Please wait before retrying.'
                : 'Too many requests. Enterprise rate limit exceeded, please retry later.' });
        }
        record.count++;
        if (releaseVerified) {
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                // Only server-verified requests earn their own employee budget.
                if (verifiedEmployeeId(req)) record.count = Math.max(0, record.count - 1);
                res.off('finish', release);
                res.off('close', release);
            };
            res.once('finish', release);
            res.once('close', release);
        }
        next();
    };
}

export function createAdmissionControl({ maxInFlight = 64, shouldLimit = () => true } = {}) {
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 4096) throw new Error('MAX_API_IN_FLIGHT must be an integer between 1 and 4096.');
    if (typeof shouldLimit !== 'function') throw new Error('Admission shouldLimit must be a function.');
    let active = 0;
    return (req, res, next) => {
        if (isLivenessProbe(req) || !shouldLimit(req)) return next();
        if (active >= maxInFlight) {
            recordRateLimitBlock('overload');
            res.setHeader('Retry-After', '2');
            return res.status(503).json({ success: false, code: 'SERVER_BUSY', error: 'The service is busy. Please retry shortly.' });
        }
        active++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active--;
            res.off('finish', release);
            res.off('close', release);
        };
        res.once('finish', release);
        res.once('close', release);
        next();
    };
}

const isClassificationRequest = req => req.method === 'POST' &&
    /^\/api\/employee-documents\/classify\/?$/i.test(`${req.baseUrl || ''}${req.path || ''}`);

export function createClassificationAdmissionControl(env = process.env) {
    const maxInFlight = Number(env.MAX_CLASSIFICATION_IN_FLIGHT ?? 4);
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 8) throw new Error('MAX_CLASSIFICATION_IN_FLIGHT must be an integer between 1 and 8.');
    return createAdmissionControl({ maxInFlight, shouldLimit: isClassificationRequest });
}

export function createHeavyWorkAdmissionControl(env = process.env) {
    const maxInFlight = Number(env.MAX_HEAVY_IN_FLIGHT ?? 1);
    if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 16) throw new Error('MAX_HEAVY_IN_FLIGHT must be an integer between 1 and 16.');
    return createAdmissionControl({ maxInFlight, shouldLimit: req => {
        if (req.method !== 'POST' || isClassificationRequest(req)) return false;
        const pathname = `${req.baseUrl || ''}${req.path || ''}`;
        // One hot-folder request can already buffer 25 x 10 MB before storage upload.
        return /^\/api\/(?:attendance\/(?:scan|register-baseline)|profile\/avatar)\/?$/i.test(pathname) ||
            /^\/api\/(?:employee-documents|ai)(?:\/|$)/i.test(pathname);
    } });
}

/**
 * Enterprise API Rate Limiter
 * Protects against automated DevTools console request flooding and resource exhaustion.
 * Default: 300 requests per minute per IP.
 */
export const apiRateLimiter = (options = { windowMs: 60 * 1000, max: 300 }) => {
    return createRateLimiter(options, 'api');
};

/**
 * Auth Rate Limiter
 * Enforces strict attempt thresholds on authentication routes (/api/auth/*)
 * Default: 45 requests per minute per IP.
 */
export const authRateLimiter = (options = { windowMs: 60 * 1000, max: 45 }) => {
    return createRateLimiter(options, 'auth');
};
