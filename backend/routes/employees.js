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
        const {
            first_name,
            last_name,
            email,
            department,
            job_title,
            monthly_salary,
            piece_rate,
            role = 'employee'
        } = req.body;

        // Input validation
        if (!first_name || typeof first_name !== 'string' || first_name.length > 255) return res.status(400).json({ success: false, error: 'Invalid first name' });
        if (!last_name || typeof last_name !== 'string' || last_name.length > 255) return res.status(400).json({ success: false, error: 'Invalid last name' });
        if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
        if (!department || typeof department !== 'string') return res.status(400).json({ success: false, error: 'Invalid department' });
        if (!job_title || typeof job_title !== 'string') return res.status(400).json({ success: false, error: 'Invalid job title' });
        if (!['admin', 'employee', 'security'].includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });

        const parsedSalary = monthly_salary !== undefined && monthly_salary !== null && !isNaN(monthly_salary)
            ? parseFloat(monthly_salary)
            : null;

        const parsedPieceRate = piece_rate !== undefined && piece_rate !== null && !isNaN(piece_rate)
            ? parseFloat(piece_rate)
            : null;

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
                monthly_salary: parsedSalary,
                piece_rate: parsedPieceRate,
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
        const {
            first_name,
            last_name,
            email,
            role,
            department,
            job_title,
            monthly_salary,
            piece_rate
        } = req.body;

        const parsedSalary = monthly_salary !== undefined && monthly_salary !== null && !isNaN(monthly_salary)
            ? parseFloat(monthly_salary)
            : null;

        const parsedPieceRate = piece_rate !== undefined && piece_rate !== null && !isNaN(piece_rate)
            ? parseFloat(piece_rate)
            : null;

        const updatePayload = {
            first_name,
            last_name,
            department,
            job_title,
            monthly_salary: parsedSalary,
            piece_rate: parsedPieceRate
        };

        if (email) updatePayload.email = email;
        if (role) updatePayload.role = role;

        const { error } = await supabase
            .from('employees')
            .update(updatePayload)
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
                properties: updatePayload
            });
        }

        res.json({ success: true, message: 'Employee updated successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { data: empData } = await supabase.from('employees').select('company_id').eq('id', req.params.id).single();

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

        if (empData?.company_id) {
            photosToShred.push(`face-baselines/${empData.company_id}/${req.params.id}.jpg`);
        } else {
            photosToShred.push(`face-baselines/${req.params.id}/${req.params.id}.jpg`);
        }

        if (photosToShred.length > 0) {
            await supabase.storage.from('public-bucket').remove(photosToShred).catch(() => { });
        }

        const tablesToClean = [
            'attendances',
            'schedules',
            'leave_requests',
            'payrolls',
            'audit_logs',
            'disciplinary_logs'
        ];

        for (const table of tablesToClean) {
            await supabase.from(table).delete().eq('employee_id', req.params.id);
            await supabase.from(table).delete().eq('user_id', req.params.id);
        }

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