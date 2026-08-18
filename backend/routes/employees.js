import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

router.get('/', cacheResponse(30), async (req, res) => {
    try {
        let query = supabase.from('employees').select('*').order('created_at', { ascending: false });
        if (req.query.employee_id) {
            query = query.eq('id', req.query.employee_id);
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/:id', cacheResponse(30), async (req, res) => {
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

        // Generate Company ID (e.g., CP-2026-001)
        const currentYear = new Date().getFullYear();
        
        // Fix: Don't use COUNT() because deleting employees breaks the sequence.
        // Instead, get the highest company_id for this year and add 1.
        const { data: latestEmp } = await supabase
            .from('employees')
            .select('company_id')
            .like('company_id', `CP-${currentYear}-%`)
            .order('company_id', { ascending: false })
            .limit(1)
            .maybeSingle();

        let newIdNum = 1;
        if (latestEmp && latestEmp.company_id) {
            const parts = latestEmp.company_id.split('-');
            if (parts.length === 3) {
                const lastNum = parseInt(parts[2], 10);
                if (!isNaN(lastNum)) newIdNum = lastNum + 1;
            }
        }
        
        const company_id = `CP-${currentYear}-${String(newIdNum).padStart(3, '0')}`;

        // Insert into employees table
        const { data: empData, error: empError } = await supabase
            .from('employees')
            .insert({
                id: authData.user.id,
                auth_user_id: authData.user.id,
                company_id: company_id,
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

        invalidateCache(['/api/employees', '/api/dashboard']);

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

        invalidateCache(['/api/employees', '/api/dashboard']);

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
        // Fetch company_id BEFORE deleting the user, because the deleteUser cascades and wipes the employee row!
        const { data: empData } = await supabase.from('employees').select('company_id').eq('id', req.params.id).single();

        // Delete stored attendance and biometric photos
        const { data: attendanceLogs } = await supabase
            .from('attendances')
            .select('time_in_photo, time_out_photo')
            .eq('employee_id', req.params.id);

        let photosToShred = [];
        if (attendanceLogs) {
            attendanceLogs.forEach(log => {
                if (log.time_in_photo) photosToShred.push(log.time_in_photo);
                if (log.time_out_photo) photosToShred.push(log.time_out_photo);
            });
        }
        
        // Add baseline face photo to deletion list
        if (empData?.company_id) {
            photosToShred.push(`face-baselines/${empData.company_id}/${req.params.id}.jpg`);
        } else {
            photosToShred.push(`face-baselines/${req.params.id}/${req.params.id}.jpg`);
        }

        // Delete photos from storage bucket
        if (photosToShred.length > 0) {
            await supabase.storage.from('public-bucket').remove(photosToShred).catch(() => {});
        }

        // Clean up related records in dependent tables
        const tablesToClean = [
            'attendances', 
            'schedules', 
            'leave_requests', 
            'payrolls', 
            'audit_logs', 
            'disciplinary_logs'
        ];
        
        for (const table of tablesToClean) {
            // Delete where employee_id matches
            await supabase.from(table).delete().eq('employee_id', req.params.id);
            // Delete where user_id matches (for tables that use user_id instead)
            await supabase.from(table).delete().eq('user_id', req.params.id);
        }

        // 1. Delete from auth.users (This CASCADES and deletes the employee row too)
        const { error } = await supabase.auth.admin.deleteUser(req.params.id);
        if (error && !error.message.includes('User not found')) throw error;

        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Deleted employee record ID ${req.params.id}. Shredded ${photosToShred.length} associated biometric/attendance files.`,
                subject_type: 'App\\Models\\Employee',
                subject_id: req.params.id,
                event: 'deleted',
                causer_id: req.body.admin_id,
                properties: { files_shredded: photosToShred.length }
            });
        }

        invalidateCache(['/api/employees', '/api/dashboard']);

        res.json({ success: true, message: `Employee deleted permanently. Shredded ${photosToShred.length} orphaned files.` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
