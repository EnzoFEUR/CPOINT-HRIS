import express from 'express';
import { supabase } from '../supabaseClient.js';
import { checkRole } from '../middleware/authMiddleware.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';

const router = express.Router();

router.get('/admin', checkRole('admin'), cacheResponse(15), async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];

        const [
            { count: totalStaff },
            { count: factoryStaffCount },
            { count: retailStaffCount },
            { count: itStaffCount },
            { count: hrStaffCount },
            { count: presentTodayCount },
            { count: lateTodayCount },
            { count: onLeaveCount },
            { count: pendingLeavesCount },
            { data: recentLogs }
        ] = await Promise.all([
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'Factory'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'Retail'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'IT'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).not('company_id', 'is', null).neq('role', 'admin').neq('role', 'security').eq('department', 'HR/Admin'),
            supabase.from('attendances').select('*', { count: 'exact', head: true }).eq('date', todayStr),
            supabase.from('attendances').select('*', { count: 'exact', head: true }).eq('date', todayStr).ilike('status', '%Late%'),
            supabase.from('leave_requests').select('*', { count: 'exact', head: true })
                .eq('status', 'Approved')
                .lte('start_date', todayStr)
                .gte('end_date', todayStr),
            supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'New'),
            supabase.from('attendances').select('*, employees:employee_id(*)').eq('date', todayStr).order('created_at', { ascending: false }).limit(5)
        ]);

        // Placeholder weekly trend data
        const weeklyTrends = [
            { day: 'Mon', value: 92 },
            { day: 'Tue', value: 95 },
            { day: 'Wed', value: 89 },
            { day: 'Thu', value: 98 },
            { day: 'Fri', value: 94 },
            { day: 'Sat', value: 65 },
            { day: 'Sun', value: 50 },
        ];

        res.json({
            totalStaff: totalStaff || 0,
            deptBreakdown: {
                Factory: factoryStaffCount || 0,
                Retail: retailStaffCount || 0,
                IT: itStaffCount || 0,
                HR: hrStaffCount || 0
            },
            presentTodayCount: presentTodayCount || 0,
            lateTodayCount: lateTodayCount || 0,
            onLeaveCount: onLeaveCount || 0,
            pendingLeavesCount: pendingLeavesCount || 0,
            recentLogs: recentLogs || [],
            weeklyTrends
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Consolidated BFF Endpoint for Employee Dashboard (Single-Trip High Performance)
router.get('/employee/:id', cacheResponse(15), async (req, res) => {
    try {
        const { id } = req.params;

        const [
            { data: attendanceData, error: attErr },
            { data: payrollData, error: payErr },
            { data: shiftData, error: shiftErr },
            { data: discData, error: discErr },
            { data: leaveData, error: leaveErr }
        ] = await Promise.all([
            supabase.from('attendances').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10),
            supabase.from('payrolls').select('*').eq('employee_id', id).order('period_start', { ascending: false }).limit(1),
            supabase.from('employees').select('id, shift, department, job_title, first_name, last_name, company_id').eq('id', id).limit(1),
            supabase.from('disciplinary_logs').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10),
            supabase.from('leave_requests').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10)
        ]);

        if (attErr || payErr || shiftErr || discErr || leaveErr) {
            const err = attErr || payErr || shiftErr || discErr || leaveErr;
            throw err;
        }

        res.json({
            attendanceData: attendanceData || [],
            payrollData: payrollData || [],
            shiftData: shiftData || [],
            discData: discData || [],
            leaveData: leaveData || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
