import express from 'express';
import { supabase } from '../index.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase.from('employees').select('*').eq('id', id).single();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { first_name, last_name, email, department, job_title, monthly_salary, role = 'employee' } = req.body;

        // Input validation
        if (!first_name || typeof first_name !== 'string' || first_name.length > 255) return res.status(400).json({ success: false, error: 'Invalid first name' });
        if (!last_name || typeof last_name !== 'string' || last_name.length > 255) return res.status(400).json({ success: false, error: 'Invalid last name' });
        if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
        if (!department || typeof department !== 'string') return res.status(400).json({ success: false, error: 'Invalid department' });
        if (!job_title || typeof job_title !== 'string') return res.status(400).json({ success: false, error: 'Invalid job title' });
        if (monthly_salary === undefined || isNaN(monthly_salary) || monthly_salary < 0) return res.status(400).json({ success: false, error: 'Invalid monthly salary' });
        if (!['admin', 'employee', 'security'].includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });

        // Normalize and hash email
        const normalizedEmail = email.trim().toLowerCase();
        const crypto = await import('crypto');
        const APP_KEY = process.env.APP_KEY || 'default_fallback_key';
        const lookupHash = crypto.createHash('sha256').update(normalizedEmail + APP_KEY).digest('hex');

        // Check duplicate hash
        const { data: existingUser } = await supabase
            .from('employees')
            .select('id')
            .eq('email_hash', lookupHash)
            .maybeSingle();

        if (existingUser) {
            return res.status(400).json({ success: false, error: 'This email is already registered.' });
        }

        // Create auth user
        const defaultPassword = 'Emp-' + Math.floor(1000 + Math.random() * 9000);
        
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password: defaultPassword,
            email_confirm: true,
            user_metadata: { first_name, last_name, role }
        });

        if (authError) {
            return res.status(400).json({ success: false, error: authError.message });
        }

        // Insert into employees table
        const { data: empData, error: empError } = await supabase
            .from('employees')
            .insert({
                id: authData.user.id,
                auth_user_id: authData.user.id,
                first_name,
                last_name,
                email: normalizedEmail,
                role,
                department,
                job_title,
                salary: monthly_salary,
                email_hash: lookupHash,
                status: 'active',
                requires_password_change: true
            })
            .select()
            .single();

        if (empError) throw empError;

        res.status(201).json({ 
            success: true, 
            data: empData, 
            message: 'Employee created successfully!',
            temp_password: defaultPassword 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { first_name, last_name, department, job_title, monthly_salary } = req.body;
        const { error } = await supabase
            .from('employees')
            .update({ first_name, last_name, department, job_title, monthly_salary })
            .eq('id', req.params.id);

        if (error) throw error;

        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Updated employee profile for ID ${req.params.id}`,
                subject_type: 'App\\Models\\Employee',
                subject_id: req.params.id,
                event: 'updated',
                causer_id: req.body.admin_id,
                properties: { department, job_title, monthly_salary }
            });
        }

        res.json({ success: true, message: 'Employee updated successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        // Delete from auth (cascades via foreign key)
        const { error } = await supabase.auth.admin.deleteUser(req.params.id);
        if (error) throw error;
        
        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Deleted employee record ID ${req.params.id}`,
                subject_type: 'App\\Models\\Employee',
                subject_id: req.params.id,
                event: 'deleted',
                causer_id: req.body.admin_id,
                properties: {}
            });
        }

        res.json({ success: true, message: 'Employee deleted permanently.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
