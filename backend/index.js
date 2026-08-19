import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import { supabase } from './supabaseClient.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Response compression
app.use(compression({
    level: 6,
    threshold: 1024
}));

// Core Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Supabase client moved to supabaseClient.js to avoid circular dependencies

import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import payrollRoutes from './routes/payroll.js';
import leaveRoutes from './routes/leaves.js';
import dashboardRoutes from './routes/dashboard.js';
import profileRoutes from './routes/profile.js';
import auditLogRoutes from './routes/auditLogs.js';
import shiftRoutes from './routes/shifts.js';
import disciplinaryRoutes from './routes/disciplinary.js';
import notificationRoutes from './routes/notifications.js';
import pushRoutes from './routes/push.js';
import { securityHeaders, removeExposedHeaders } from './middleware/securityMiddleware.js';
import { verifyToken, checkRole, checkAdminOrOwnership } from './middleware/authMiddleware.js';
import { startCronJobs } from './utils/cronJobs.js';

// Start background workers
startCronJobs();

// Global Security Middleware
app.use(securityHeaders);
app.use(removeExposedHeaders);

// Mount Authenticated Routes
app.use('/api/employees', verifyToken, checkAdminOrOwnership, employeeRoutes);
app.use('/api/attendance', verifyToken, attendanceRoutes);
app.use('/api/payroll', verifyToken, checkAdminOrOwnership, payrollRoutes);
app.use('/api/leaves', verifyToken, checkAdminOrOwnership, leaveRoutes);
app.use('/api/dashboard', verifyToken, dashboardRoutes);
app.use('/api/shifts', verifyToken, checkAdminOrOwnership, shiftRoutes);
app.use('/api/disciplinary', verifyToken, checkAdminOrOwnership, disciplinaryRoutes);
app.use('/api/profile', verifyToken, profileRoutes);
app.use('/api/audit-logs', verifyToken, checkRole('admin'), auditLogRoutes);
app.use('/api/notifications', verifyToken, notificationRoutes);
app.use('/api/push', verifyToken, pushRoutes);

// Root Status
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'C-Point HRIS API', timestamp: new Date().toISOString() });
});

// Basic Health Check Route to Verify Supabase Connection
app.get('/api/health', async (req, res) => {
    try {
        const { data, error } = await supabase.from('employees').select('*').limit(5);
        if (error) throw error;
        
        res.status(200).json({ 
            status: 'ok', 
            message: 'Supabase DB Connection Successful', 
            rows: data 
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'error', 
            message: 'Failed to connect to Supabase', 
            error: err.message 
        });
    }
});

// Initialize Cron Jobs
import './cron/attendanceJobs.js';

app.listen(port, () => {
    console.log('HRIS server running on port ' + port);
});
