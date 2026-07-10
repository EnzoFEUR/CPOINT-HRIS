import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-url.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';
export const supabase = createClient(supabaseUrl, supabaseKey);

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
import { securityHeaders, removeExposedHeaders } from './middleware/securityMiddleware.js';
import { verifyToken, checkRole } from './middleware/authMiddleware.js';

// Global Security Middleware
app.use(securityHeaders);
app.use(removeExposedHeaders);

// Mount Authenticated Routes
app.use('/api/employees', verifyToken, employeeRoutes);
app.use('/api/attendance', verifyToken, attendanceRoutes);
app.use('/api/payroll', verifyToken, payrollRoutes);
app.use('/api/leaves', verifyToken, leaveRoutes);
app.use('/api/dashboard', verifyToken, dashboardRoutes);
app.use('/api/shifts', verifyToken, shiftRoutes);
app.use('/api/disciplinary', verifyToken, disciplinaryRoutes);
app.use('/api/profile', verifyToken, profileRoutes);
app.use('/api/audit-logs', verifyToken, checkRole('admin'), auditLogRoutes);
app.use('/api/notifications', verifyToken, notificationRoutes);

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

app.listen(port, () => {
    console.log('HRIS server running on port ' + port);
});
