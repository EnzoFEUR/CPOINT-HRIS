import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { applyWorkforceFilter } from '../utils/workforce.js';

const router = express.Router();

router.get('/', cacheResponse(30), async (req, res) => {
    try {
        let query = applyWorkforceFilter(supabase.from('employees').select('*')).order('first_name', { ascending: true });
        
        if (req.query.employee_id) {
            query = query.eq('id', req.query.employee_id);
        }

        const { data: employees, error } = await query;

        if (error) throw error;
        
        // Ensure every employee object returns 'Unassigned' if shift is null, for frontend consistency
        const employeesWithShifts = employees.map(emp => ({
            ...emp,
            shift: emp.shift || 'Unassigned'
        }));

        res.json(employeesWithShifts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/assign', async (req, res) => {
    try {
        const { employee_id, shift } = req.body;
        
        const { error } = await supabase
            .from('employees')
            .update({ shift })
            .eq('id', employee_id);
            
        if (error) throw error;

        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
        const avatarUrl = emp?.company_id && emp?.id 
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        await createNotification({
            target: employee_id,
            title: `Shift Schedule: ${shift}`,
            text: `Shift schedule for ${empName} updated to ${shift}.`,
            type: 'shift',
            sender_id: emp?.id,
            company_id: emp?.company_id,
            sender_name: empName,
            sender_avatar: avatarUrl
        });

        // Optional Audit Logging
        if (req.user && req.user.role === 'admin') {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'shifts',
                description: `Reassigned shift for employee ${employee_id} to ${shift}`,
                subject_type: 'App\\Models\\Employee',
                subject_id: employee_id,
                event: 'updated',
                causer_id: req.user.id,
                properties: { new_shift: shift }
            });
        }

        invalidateCache(['/api/shifts', '/api/employees']);

        res.json({ success: true, message: 'Shift assigned successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
