import client from 'prom-client';
import { createCachedRead } from './cachedRead.js';

// 1. Dedicated Prometheus Registry
export const register = new client.Registry();

// Set default labels across all metrics
register.setDefaultLabels({
    app: 'cpoint-hris',
    env: process.env.NODE_ENV || 'production'
});

// Enable default Node.js runtime and OS metrics
client.collectDefaultMetrics({
    register,
    prefix: 'hris_node_',
});

// 2. HTTP Golden Signals Metrics
export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total count of HTTP requests processed by C-Point HRIS API',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

export const httpRequestsInFlight = new client.Gauge({
    name: 'http_requests_in_flight',
    help: 'Current number of concurrent HTTP requests being processed',
    labelNames: ['method'],
    registers: [register],
});

// 3. HRIS Domain & Security Telemetry
export const hrisAttendanceScansTotal = new client.Counter({
    name: 'hris_attendance_scans_total',
    help: 'Total number of turnstile and biometric clock-in/out events',
    labelNames: ['method', 'status'],
    registers: [register],
});

export const hrisAuthEventsTotal = new client.Counter({
    name: 'hris_auth_events_total',
    help: 'Authentication, OTP, and TOTP verification events',
    labelNames: ['action', 'status'],
    registers: [register],
});

export const hrisRateLimitBlocksTotal = new client.Counter({
    name: 'hris_rate_limit_blocks_total',
    help: 'Requests intercepted and blocked by rate limiting policies',
    labelNames: ['limiter'],
    registers: [register],
});

export const hrisLeaveRequestsTotal = new client.Counter({
    name: 'hris_leave_requests_total',
    help: 'Total leave requests filed and status changes',
    labelNames: ['type', 'action'],
    registers: [register],
});

export const hrisPayrollCalculationsTotal = new client.Counter({
    name: 'hris_payroll_calculations_total',
    help: 'Total payroll runs and piece-rate computations processed',
    labelNames: ['type', 'status'],
    registers: [register],
});

export const hrisDatabaseQueryDurationSeconds = new client.Histogram({
    name: 'hris_database_query_duration_seconds',
    help: 'Database query latencies in seconds',
    labelNames: ['table', 'operation'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
});

/**
 * Route normalizer to eliminate high-cardinality label explosions
 */
export function normalizeRoute(req) {
    if (req.route?.path) {
        const baseUrl = req.baseUrl || '';
        const routePath = typeof req.route.path === 'string' ? req.route.path : String(req.route.path);
        return `${baseUrl}${routePath}`;
    }
    // Unmatched URLs are attacker-controlled and must not become metric labels.
    return '/unmatched';
}

/**
 * Express middleware to observe HTTP traffic, latency, and in-flight gauges
 */
export const telemetryMiddleware = (req, res, next) => {
    // Avoid double counting
    if (req._telemetryStartNs) return next();

    const startNs = process.hrtime.bigint();
    req._telemetryStartNs = startNs;
    const method = req.method;

    httpRequestsInFlight.inc({ method });

    let recorded = false;
    const recordMetrics = () => {
        if (recorded) return;
        recorded = true;
        httpRequestsInFlight.dec({ method });

        const endNs = process.hrtime.bigint();
        const durationSeconds = Number(endNs - startNs) / 1e9;
        const statusCode = String(res.statusCode || 200);
        const route = normalizeRoute(req);

        httpRequestsTotal.inc({ method, route, status_code: statusCode });
        httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationSeconds);
    };

    res.once('finish', recordMetrics);
    res.once('close', recordMetrics);

    next();
};

// Domain event helpers
export const recordAttendanceScan = (method = 'biometric', status = 'success') => {
    try { hrisAttendanceScansTotal.inc({ method, status }); } catch (_) {}
};

export const recordAuthEvent = (action = 'login', status = 'success') => {
    try { hrisAuthEventsTotal.inc({ action, status }); } catch (_) {}
};

export const recordRateLimitBlock = (limiter = 'api') => {
    try { hrisRateLimitBlocksTotal.inc({ limiter }); } catch (_) {}
};

export const recordLeaveEvent = (type = 'Leave', action = 'submitted') => {
    try { hrisLeaveRequestsTotal.inc({ type, action }); } catch (_) {}
};

export const recordPayrollCalc = (type = 'regular', status = 'success') => {
    try { hrisPayrollCalculationsTotal.inc({ type, status }); } catch (_) {}
};

export const recordDatabaseQuery = (table = 'unknown', operation = 'select', durationSeconds = 0) => {
    try { hrisDatabaseQueryDurationSeconds.observe({ table, operation }, durationSeconds); } catch (_) {}
};

/**
 * Returns human-readable telemetry summary for in-app diagnostics
 */
export const getPrometheusMetrics = createCachedRead(() => register.metrics());

export const getTelemetrySummary = createCachedRead(async () => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptimeSec = Math.floor(process.uptime());

    const metricsData = await Promise.all([httpRequestsTotal.get(), hrisAttendanceScansTotal.get(), hrisAuthEventsTotal.get(), hrisRateLimitBlocksTotal.get()]);

    // Extract totals
    const findMetric = (name) => metricsData.find(m => m.name === name);
    const sumValues = (metric) => (metric?.values || []).reduce((acc, v) => acc + (v.value || 0), 0);

    const requestsTotal = sumValues(findMetric('http_requests_total'));
    const requests5xx = (findMetric('http_requests_total')?.values || [])
        .filter(v => String(v.labels?.status_code || '').startsWith('5'))
        .reduce((acc, v) => acc + v.value, 0);

    const errorRatePct = requestsTotal > 0 ? Number(((requests5xx / requestsTotal) * 100).toFixed(2)) : 0;
    const scansTotal = sumValues(findMetric('hris_attendance_scans_total'));
    const authTotal = sumValues(findMetric('hris_auth_events_total'));
    const rateLimitBlocks = sumValues(findMetric('hris_rate_limit_blocks_total'));

    return {
        service: 'cpoint-hris-api',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime_seconds: uptimeSec,
        uptime_human: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`,
        system: {
            node_version: process.version,
            platform: process.platform,
            arch: process.arch,
            memory: {
                heap_used_mb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
                heap_total_mb: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
                rss_mb: Number((mem.rss / 1024 / 1024).toFixed(2)),
                external_mb: Number((mem.external / 1024 / 1024).toFixed(2)),
            },
            cpu: {
                user_seconds: Number((cpu.user / 1e6).toFixed(2)),
                system_seconds: Number((cpu.system / 1e6).toFixed(2)),
            }
        },
        metrics: {
            total_requests: requestsTotal,
            error_rate_pct: errorRatePct,
            attendance_scans: scansTotal,
            auth_events: authTotal,
            rate_limit_blocks: rateLimitBlocks,
        },
        prometheus: {
            endpoint: '/metrics',
            format: register.contentType,
        }
    };
});
