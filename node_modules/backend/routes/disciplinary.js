import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        let query = supabase.from('disciplinary_logs').select('*, employees:employee_id(first_name, last_name, department)').order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }

        const { data: records, error } = await query;
            
        if (error) throw error;
        
        const enrichedRecords = records.map(record => ({
            ...record,
            employee_name: record.employees ? `${record.employees.first_name} ${record.employees.last_name}` : 'Unknown',
            department: record.employees?.department || 'Unknown'
        }));

        res.json(enrichedRecords);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { employee_id, type, reason, severity } = req.body;
        
        if (!employee_id || !type || !reason || !severity) {
            return res.status(400).json({ error: 'All fields are required.' });
        }
        
        const { error } = await supabase
            .from('disciplinary_logs')
            .insert({
                employee_id,
                type,
                reason,
                severity,
                status: 'Active',
                date: new Date().toISOString().split('T')[0]
            });

        if (error) throw error;

        // Send notification to employee
        await createNotification({
            target: employee_id,
            title: 'New HR Notice',
            text: `You have a new disciplinary notice: ${type}`,
            type: 'system'
        });

        if (req.user && req.user.role === 'admin') {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'disciplinary',
                description: `Issued ${type} to employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Disciplinary',
                subject_id: employee_id,
                event: 'created',
                causer_id: req.user.id,
                properties: { type, severity, reason }
            });
        }

        res.json({ success: true, message: 'Disciplinary log recorded successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/resolve', async (req, res) => {
    try {
        const { error } = await supabase
            .from('disciplinary_logs')
            .update({ status: 'Resolved' })
            .eq('id', req.params.id);
            
        if (error) throw error;
        res.json({ success: true, message: 'Record marked as resolved.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/acknowledge', async (req, res) => {
    try {
        const { error } = await supabase
            .from('disciplinary_logs')
            .update({ status: 'Acknowledged' })
            .eq('id', req.params.id);
            
        if (error) throw error;
        res.json({ success: true, message: 'Record acknowledged.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
