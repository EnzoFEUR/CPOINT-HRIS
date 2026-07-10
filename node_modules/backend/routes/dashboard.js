import express from 'express';
import { supabase } from '../index.js';

const router = express.Router();

router.get('/admin', async (req, res) => {
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
            supabase.from('employees').select('*', { count: 'exact', head: true }),
            supabase.from('employees').select('*', { count: 'exact', head: true }).eq('department', 'Factory'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).eq('department', 'Retail'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).eq('department', 'IT'),
            supabase.from('employees').select('*', { count: 'exact', head: true }).eq('department', 'HR/Admin'),
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

router.get('/employee/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: recentLogs, error } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', id)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;
        res.json({ recentLogs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
