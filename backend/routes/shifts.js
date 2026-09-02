import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { applyWorkforceFilter } from '../utils/workforce.js';

const router = express.Router();

// Get employee shift roster
router.get('/', cacheResponse(30), async (req, res) => {
    try {
        let query = applyWorkforceFilter(supabase.from('employees').select('*')).order('first_name', { ascending: true });
        
        if (req.query.employee_id) {
            query = query.eq('id', req.query.employee_id);
        }

        const { data: employees, error } = await query;
        if (error) throw error;
        
        const employeesWithShifts = (employees || []).map(emp => ({
            ...emp,
            shift: emp.shift || 'Unassigned'
        }));

        res.json(employeesWithShifts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Assign shift with single-pass update and async notifications
router.post('/assign', async (req, res) => {
    try {
        const { employee_id, shift } = req.body;
        if (!employee_id || !shift) {
            return res.status(400).json({ error: 'Missing employee_id or shift' });
        }
        
        // Single-pass database update and select
        const { data: emp, error } = await supabase
            .from('employees')
            .update({ shift })
            .eq('id', employee_id)
            .select('id, company_id, first_name, last_name, shift')
            .single();
            
        if (error) throw error;

        // Invalidate cache immediately
        invalidateCache(['/api/shifts', '/api/employees', '/api/dashboard/overview']);

        // Return instant response to client
        res.json({ success: true, message: 'Shift assigned successfully.', data: emp });

        // Non-blocking background notification and audit log
        const empName = emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() : 'Employee';
        const avatarUrl = emp?.company_id && emp?.id 
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        Promise.allSettled([
            createNotification({
                target: employee_id,
                title: `Shift Schedule: ${shift}`,
                text: `Shift schedule for ${empName} updated to ${shift}.`,
                type: 'shift',
                sender_id: emp?.id,
                company_id: emp?.company_id,
                sender_name: empName,
                sender_avatar: avatarUrl
            }),
            (async () => {
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
            })()
        ]).catch(err => console.warn('[SHIFTS] Background logging note:', err));

    } catch (err) {
        console.error('[SHIFTS] Shift assign error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;
