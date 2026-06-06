import express from 'express';
import { supabase } from '../index.js';
import { createNotification } from './notifications.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        let query = supabase.from('leave_requests').select('*, employees:employee_id(*)').order('created_at', { ascending: false });
        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { employee_id, leave_type, start_date, end_date, reason } = req.body;
        
        // Strict Validation
        if (!leave_type || typeof leave_type !== 'string') throw new Error('Invalid leave_type');
        if (!start_date || isNaN(Date.parse(start_date))) throw new Error('Invalid start_date');
        if (!end_date || isNaN(Date.parse(end_date)) || new Date(end_date) < new Date(start_date)) {
            throw new Error('Invalid end_date or end_date is before start_date');
        }
        if (!reason || typeof reason !== 'string' || reason.length > 255) throw new Error('Invalid reason: max 255 chars');

        const { error } = await supabase
            .from('leave_requests')
            .insert({
                employee_id,
                type: leave_type,
                start_date,
                end_date,
                notes: reason,
                status: 'New'
            });

        if (error) throw error;
        
        await createNotification({
            target: 'admin',
            title: 'New Leave Request',
            text: `A new ${leave_type} request was submitted.`,
            type: 'leave'
        });

        res.json({ success: true, message: 'Leave request submitted successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const { data: updatedLeave, error } = await supabase
            .from('leave_requests')
            .update({ status })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;
        
        if (updatedLeave) {
            await createNotification({
                target: updatedLeave.employee_id,
                title: 'Leave Request Update',
                text: `Your leave request was ${status.toLowerCase()}.`,
                type: 'leave'
            });

            if (req.body.admin_id) {
                const { createAuditLog } = await import('./auditLogs.js');
                await createAuditLog({
                    log_name: 'leaves',
                    description: `Marked leave request ${req.params.id} as ${status}`,
                    subject_type: 'App\\Models\\LeaveRequest',
                    subject_id: req.params.id,
                    event: 'updated',
                    causer_id: req.body.admin_id,
                    properties: { status }
                });
            }
        }

        res.json({ success: true, message: `Leave request ${status.toLowerCase()} successfully!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
