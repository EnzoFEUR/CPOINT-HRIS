import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { createNotification } from './notifications.js';

const router = express.Router();

/**
 * Determines employee operational status (Terminated, Suspended, or Active)
 * based on employee account status and disciplinary records.
 */
function evaluateOperationalStanding(emp, logs = [], now = new Date()) {
    const termLog = logs.find(l => l.type === 'Termination');
    const isDeactivated = emp.status === 'inactive' || emp.status === 'terminated' || emp.is_active === false;

    // 1. Termination Evaluation
    const isTerminated = Boolean(
        (termLog && isDeactivated) || 
        emp.status === 'terminated'
    );

    // 2. Suspension Evaluation
    const activeSuspension = logs.find(l => {
        if (l.type !== 'Suspension') return false;

        const logStatus = (l.status || '').toLowerCase();
        // If HR marked it Resolved, Closed, Dismissed, or Cancelled, it is lifted
        if (logStatus === 'resolved' || logStatus === 'dismissed' || logStatus === 'cancelled' || logStatus === 'closed') {
            return false;
        }

        // If an expiration date is present, ensure it hasn't expired
        const match = (l.reason || '').match(/Until\s+(\d{4}-\d{2}-\d{2})/i);
        if (match) {
            const endDate = new Date(match[1] + 'T23:59:59');
            if (endDate < now) return false;
        }

        return l.status === 'Active' || l.status === 'Under Review';
    });

    const isSuspended = !isTerminated && Boolean(
        (activeSuspension && isDeactivated) ||
        emp.status === 'suspended'
    );

    let operational_status = 'Active';
    if (isTerminated) operational_status = 'Terminated';
    else if (isSuspended) operational_status = 'Suspended';

    return {
        is_terminated: isTerminated,
        is_suspended: isSuspended,
        operational_status,
        active_suspension: activeSuspension || null,
        termination_record: termLog || null,
        past_suspensions_count: logs.filter(l => l.type === 'Suspension').length,
        disciplinary_count: logs.length
    };
}

router.get('/', cacheResponse(15), async (req, res) => {
    try {
        let query = supabase
            .from('employees')
            .select(`
                *,
                disciplinary_logs (
                    id, type, reason, status, date, created_at
                )
            `)
            .order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('id', req.query.employee_id);
        }
        const { data, error } = await query;
        if (error) throw error;

        const now = new Date();
        const enriched = (data || []).map(emp => {
            const logs = emp.disciplinary_logs || [];
            const standing = evaluateOperationalStanding(emp, logs, now);
            return {
                ...emp,
                ...standing
            };
        });

        res.json({ success: true, data: enriched });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get employee details and 201 documents in a single parallel batch
router.get('/:id', cacheResponse(15), async (req, res) => {
    try {
        const { id } = req.params;
        const [empRes, docsRes, discRes] = await Promise.all([
            supabase.from('employees').select('*').eq('id', id).single(),
            supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
            supabase.from('disciplinary_logs').select('*').eq('employee_id', id).order('created_at', { ascending: false })
        ]);
        if (empRes.error) throw empRes.error;

        const emp = empRes.data;
        const logs = discRes.data || [];
        const now = new Date();
        const standing = evaluateOperationalStanding(emp, logs, now);

        const enrichedEmp = {
            ...emp,
            ...standing,
            disciplinary_logs: logs
        };

        res.json({ success: true, data: enrichedEmp, documents: docsRes.data || [] });
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
            piece_rate,
            shift
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
        if (shift) updatePayload.shift = shift;

        const { error } = await supabase
            .from('employees')
            .update(updatePayload)
            .eq('id', req.params.id);

        if (error) throw error;

        // Notify employee if compensation or shift was modified
        if (parsedSalary !== null || parsedPieceRate !== null || shift) {
            const { data: emp } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name')
                .eq('id', req.params.id)
                .maybeSingle();

            const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
            const avatarUrl = emp?.company_id && emp?.id
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            if (shift) {
                await createNotification({
                    target: req.params.id,
                    title: `Shift Schedule: ${shift}`,
                    text: `Your shift schedule has been updated to ${shift}.`,
                    type: 'shift',
                    sender_id: emp?.id,
                    company_id: emp?.company_id,
                    sender_name: empName,
                    sender_avatar: avatarUrl
                });
            } else if (parsedSalary !== null || parsedPieceRate !== null) {
                await createNotification({
                    target: req.params.id,
                    title: 'Compensation Updated',
                    text: parsedSalary !== null
                        ? `Your monthly compensation is set to ₱${parsedSalary.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`
                        : `Your piece rate has been updated.`,
                    type: 'payroll',
                    sender_id: emp?.id,
                    company_id: emp?.company_id,
                    sender_name: 'HR & Payroll',
                    sender_avatar: avatarUrl
                });
            }
        }

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