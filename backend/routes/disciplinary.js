import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

router.get('/', cacheResponse(20), async (req, res) => {
    try {
        let query = supabase.from('disciplinary_logs').select('*, employees:employee_id(id, company_id, first_name, last_name, department)').order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }
        if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
        }

        const { data: records, error } = await query;
            
        if (error) throw error;
        
        const enrichedRecords = records
            .filter(record => record.employees && record.employees.company_id)
            .map(record => ({
                ...record,
                employee_name: `${record.employees.first_name} ${record.employees.last_name}`,
                department: record.employees.department || 'Unknown',
                company_id: record.employees.company_id || null,
                employee_id: record.employees.id || record.employee_id
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

        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Personnel';
        const avatarUrl = emp?.company_id && emp?.id 
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        await createNotification({
            target: employee_id,
            title: `Disciplinary Notice: ${type}`,
            text: `Notice issued for ${empName}: ${severity} severity (${reason}).`,
            type: 'disciplinary',
            sender_id: emp?.id,
            company_id: emp?.company_id,
            sender_name: empName,
            sender_avatar: avatarUrl
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

        invalidateCache(['/api/disciplinary', '/api/dashboard']);

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
        invalidateCache(['/api/disciplinary', '/api/dashboard']);
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
        invalidateCache(['/api/disciplinary', '/api/dashboard']);
        res.json({ success: true, message: 'Record acknowledged.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
