import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import { supabase } from './supabaseClient.js';

// Route Imports
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import payrollRoutes from './routes/payroll.js';
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
import { securityHeaders, removeExposedHeaders, apiRateLimiter, authRateLimiter } from './middleware/securityMiddleware.js';
import { verifyToken, checkRole, checkVerifiedManagerOrOwnership } from './middleware/authMiddleware.js';
import { startCronJobs } from './utils/cronJobs.js';
import './cron/attendanceJobs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 5000;

// Response compression
app.use(compression({
    level: 6,
    threshold: 1024
}));

// Core Middleware
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'Expires'],
    maxAge: 86400 // Cache OPTIONS preflight for 24 hours
}));
app.use(securityHeaders);
app.use(removeExposedHeaders);
app.use('/api', apiRateLimiter({ windowMs: 60 * 1000, max: 350 }));
app.use('/api/auth', authRateLimiter());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static brand and email assets (zero-latency WebP caching)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '../frontend/public'), { maxAge: '30d', immutable: true }));

// Start background workers
startCronJobs();

// Mount Authenticated Routes
await mountOfflineAttendance(app, verifyToken);
app.use('/api/documents', verifyToken, documentRouter);
app.use('/api/employees', verifyToken, checkVerifiedManagerOrOwnership, employeeRoutes);
app.use('/api/attendance', verifyToken, attendanceRoutes);
app.use('/api/payroll', verifyToken, checkVerifiedManagerOrOwnership, payrollRoutes);
app.use('/api/leaves', verifyToken, leaveRoutes);
app.use('/api/leave-credits', verifyToken, createLeaveCreditsRouter());
app.use('/api/dashboard', verifyToken, dashboardRoutes);
app.use('/api/disciplinary', verifyToken, disciplinaryRoutes);
app.use('/api/profile', verifyToken, profileRoutes);
app.use('/api/audit-logs', verifyToken, checkRole('admin'), auditLogRoutes);
app.use('/api/notifications', verifyToken, notificationRoutes);
app.use('/api/push', verifyToken, pushRoutes);
app.use('/api/ai', verifyToken, aiRoutes);
app.use('/api/employee-documents', verifyToken, employeeDocumentRoutes);
app.use('/api/auth/otp', otpRoutes);
app.use('/api/auth/totp', totpRoutes);
app.use('/api/auth/security', authSecurityRoutes);
app.use('/api/production-groups', verifyToken, productionGroupRoutes);

// Root Status
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'C-Point HRIS API', timestamp: new Date().toISOString() });
});

// Sanitized Health Check: Verifies DB connectivity without leaking PII or internal table rows
app.get('/api/health', async (req, res) => {
    try {
        const { error } = await supabase.from('employees').select('id', { head: true, count: 'exact' }).limit(1);
        if (error) throw error;
        
        res.status(200).json({ 
            status: 'ok', 
            service: 'C-Point HRIS API',
            timestamp: new Date().toISOString()
        });
    } catch (_) {
        res.status(500).json({ 
            status: 'error', 
            message: 'Database service unavailable'
        });
    }
});

app.listen(port, () => {
    console.log('HRIS server running on port ' + port);
});
