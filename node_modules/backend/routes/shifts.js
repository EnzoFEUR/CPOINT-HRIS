import express from 'express';
import { supabase } from '../index.js';
import { createNotification } from './notifications.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .order('first_name', { ascending: true });

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

        // Send notification to employee
        await createNotification({
            target: employee_id,
            title: 'Shift Assignment Updated',
            text: `Your shift has been updated to: ${shift}`,
            type: 'system'
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

        res.json({ success: true, message: 'Shift assigned successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
