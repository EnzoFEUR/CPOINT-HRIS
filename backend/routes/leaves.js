import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

router.get('/', cacheResponse(20), async (req, res) => {
    try {
        let query = supabase.from('leave_requests').select('*, employees:employee_id(*)').order('created_at', { ascending: false });
        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }
        if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
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
        
        // Fetch sender employee details for rich notification
        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const senderName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
        const avatarUrl = emp?.company_id && emp?.id 
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        await createNotification({
            target: 'admin',
            title: `Leave Request: ${senderName}`,
            text: `${senderName} submitted a ${leave_type} request (${start_date} to ${end_date}).`,
            type: 'leave',
            sender_id: emp?.id,
            company_id: emp?.company_id,
            sender_name: senderName,
            sender_avatar: avatarUrl
        });

        invalidateCache(['/api/leaves', '/api/dashboard']);

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
        
        invalidateCache(['/api/leaves', '/api/dashboard']);

        if (updatedLeave) {
            const { data: emp } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name')
                .eq('id', updatedLeave.employee_id)
                .maybeSingle();

            const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
            const avatarUrl = emp?.company_id && emp?.id 
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            await createNotification({
                target: updatedLeave.employee_id,
                title: `Leave Request: ${status}`,
                text: `Your ${updatedLeave.type || 'leave'} request has been ${status.toLowerCase()}.`,
                type: 'leave',
                sender_id: emp?.id,
                company_id: emp?.company_id,
                sender_name: empName,
                sender_avatar: avatarUrl
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
