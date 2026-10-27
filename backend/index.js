import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import { API_RATE_POLICY } from '../shared/securityPolicy.mjs';
import { supabase } from './supabaseClient.js';

// Route Imports
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import payrollRoutes from './routes/payroll.js';
import retirementPayRoutes from './routes/retirementPay.js';
import employmentExitRoutes from './routes/employmentExit.js';
import leaveRoutes, { createLeaveCreditsRouter } from './routes/leaves.js';
import dashboardRoutes from './routes/dashboard.js';
import profileRoutes from './routes/profile.js';
import auditLogRoutes from './routes/auditLogs.js';
import disciplinaryRoutes from './routes/disciplinary.js';
import notificationRoutes from './routes/notifications.js';
import pushRoutes from './routes/push.js';
import aiRoutes from './routes/ai.js';
import employeeDocumentRoutes from './routes/employeeDocuments.js';
import otpRoutes from './routes/otp.js';
import totpRoutes from './routes/totp.js';
import authSecurityRoutes from './routes/authSecurity.js';
import productionGroupRoutes from './routes/productionGroups.js';
import documentRouter from './routes/document.js';
import { mountOfflineAttendance } from './routes/mountOfflineAttendance.js';

// Middleware & Utilities
import { register, telemetryMiddleware, getTelemetrySummary, getPrometheusMetrics } from './utils/telemetry.js';
import { securityHeaders, removeExposedHeaders, apiRateLimiter, authRateLimiter, createCorsOptions, createAdmissionControl, createHeavyWorkAdmissionControl, createClassificationAdmissionControl } from './middleware/securityMiddleware.js';
import { createHealthRouter } from './routes/health.js';
import { validateApiInput } from './middleware/requestValidation.js';
import { protectApiResponses, apiNotFound, apiErrorHandler } from './middleware/errorMiddleware.js';
import { verifyToken as verifyIdentityToken, checkRole, checkVerifiedManagerOrOwnership } from './middleware/authMiddleware.js';
import { startCronJobs } from './utils/cronJobs.js';
import './cron/attendanceJobs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 5000;
app.disable('x-powered-by');
app.set('query parser', 'simple');
if (process.env.TRUST_PROXY_CIDRS) app.set('trust proxy', process.env.TRUST_PROXY_CIDRS.split(',').map(value => value.trim()).filter(Boolean));
app.use(telemetryMiddleware);
app.use(securityHeaders);
app.use(removeExposedHeaders);
app.use('/api', protectApiResponses);
app.use(cors(createCorsOptions()));

// Response compression
app.use(compression({
    level: 6,
    threshold: 1024
}));

// Core Middleware
app.use('/api', createHeavyWorkAdmissionControl(), createClassificationAdmissionControl());
app.use('/api', createAdmissionControl({ maxInFlight: Number(process.env.MAX_API_IN_FLIGHT || 64) }));
app.use('/api', apiRateLimiter({ windowMs: API_RATE_POLICY.windowMs, max: API_RATE_POLICY.anonymousRequestsPerIp, releaseVerified: true }));
app.use('/api/auth', authRateLimiter());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb', parameterLimit: 1000 }));
app.use('/api', validateApiInput);
app.use('/api', createHealthRouter(supabase));

// Static brand and email assets (zero-latency WebP caching)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '../frontend/public'), { maxAge: '30d', immutable: true }));

// Start background workers
startCronJobs();

// Mount Authenticated Routes
const verifiedUserLimiter = apiRateLimiter({ windowMs: API_RATE_POLICY.windowMs, max: API_RATE_POLICY.verifiedRequestsPerEmployee, byVerifiedEmployee: true });
const verifyToken = (req, res, next) => verifyIdentityToken(req, res, () => verifiedUserLimiter(req, res, next));
await mountOfflineAttendance(app, verifyToken);
app.use('/api/documents', verifyToken, documentRouter);
app.use('/api/employees', verifyToken, checkVerifiedManagerOrOwnership, employeeRoutes);
app.use('/api/attendance', verifyToken, attendanceRoutes);
app.use('/api/payroll', verifyToken, checkVerifiedManagerOrOwnership, payrollRoutes);
app.use('/api/retirement-pay', verifyToken, retirementPayRoutes);
app.use('/api/employment-exit', verifyToken, employmentExitRoutes);
app.use('/api/leaves', verifyToken, leaveRoutes);
app.use('/api/leave-credits', verifyToken, createLeaveCreditsRouter());
app.use('/api/dashboard', verifyToken, dashboardRoutes);
app.use('/api/disciplinary', verifyToken, disciplinaryRoutes);
app.use('/api/profile', verifyToken, profileRoutes);
app.use('/api/audit-logs', verifyToken, checkRole('admin', 'hr'), auditLogRoutes);
app.use('/api/notifications', verifyToken, notificationRoutes);
app.use('/api/push', verifyToken, pushRoutes);
app.use('/api/ai', verifyToken, aiRoutes);
app.use('/api/employee-documents', verifyToken, employeeDocumentRoutes);
app.use('/api/auth/otp', otpRoutes);
app.use('/api/auth/totp', totpRoutes);
app.use('/api/auth/security', authSecurityRoutes);
app.use('/api/production-groups', verifyToken, productionGroupRoutes);


// Prometheus Exporter & In-App Telemetry Endpoints
app.get('/metrics', apiRateLimiter({ windowMs: 60000, max: 30 }), async (req, res) => {
    if (process.env.NODE_ENV === 'production' && (!process.env.METRICS_BEARER_TOKEN || req.headers.authorization !== `Bearer ${process.env.METRICS_BEARER_TOKEN}`)) {
        return res.status(404).end();
    }
    try {
        res.set('Content-Type', register.contentType);
        res.set('Cache-Control', 'no-store');
        res.end(await getPrometheusMetrics());
    } catch (err) {
        res.status(503).end('Metrics temporarily unavailable');
    }
});

app.get('/api/metrics/summary', verifyToken, checkRole('admin', 'hr'), async (req, res) => {
    try {
        const summary = await getTelemetrySummary();
        res.json({ success: true, ...summary });
    } catch (err) {
        res.status(503).json({ success: false, error: 'Metrics temporarily unavailable' });
    }
});

// Root Status
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'C-Point HRIS API', timestamp: new Date().toISOString() });
});

// Sanitized Health Check: /api/health is liveness; /api/ready checks DB connectivity.

app.use('/api', apiNotFound);
app.use(apiErrorHandler);

const server = app.listen(port, () => {
    console.log('HRIS server running on port ' + port);
});
server.headersTimeout = 15000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 5000;
