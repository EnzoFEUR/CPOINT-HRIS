import express from 'express';
import { supabase } from '../supabaseClient.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { sanitizeGender, validateBirthDate, sanitizeAddress } from '../utils/personalDetailsValidation.js';
import { createAuditLog } from './auditLogs.js';

const router = express.Router();

// Get profile, 201 documents, and disciplinary logs in a single parallel batch
router.get('/', verifyToken, cacheResponse(15), async (req, res) => {
    try {
        const userId = req.user.id;
        const [empRes, docsRes, discRes] = await Promise.all([
            supabase.from('employees').select('*, production_groups (id, code, name, target_output_pairs, is_active)').eq('id', userId).single(),
            supabase.from('employee_documents').select('*').eq('employee_id', userId).order('created_at', { ascending: false }),
            supabase.from('disciplinary_logs').select('*').eq('employee_id', userId).order('created_at', { ascending: false })
        ]);

        const rawEmployee = empRes.data || req.user;
        const documents = docsRes.data || [];
        const disciplinary_logs = discRes.data || [];

        const termLog = (disciplinary_logs || []).find(d => {
            const isTermType = d.action_taken === 'Termination' || d.type === 'Termination';
            const s = (d.status || '').toLowerCase();
            return isTermType && s !== 'resolved' && s !== 'overturned' && s !== 'dismissed' && s !== 'cancelled' && s !== 'closed';
        });

        const suspLog = (disciplinary_logs || []).find(d => {
            const isSuspType = d.action_taken === 'Suspension' || d.type === 'Suspension';
            const s = (d.status || '').toLowerCase();
            return isSuspType && s !== 'resolved' && s !== 'overturned' && s !== 'dismissed' && s !== 'cancelled' && s !== 'closed';
        });

        const isSuspended = (rawEmployee?.status === 'suspended' || Boolean(suspLog)) && !Boolean(termLog);
        const isTerminated = !isSuspended && Boolean(
            rawEmployee?.status === 'terminated' ||
            Boolean(termLog) ||
            (rawEmployee?.archived_at && rawEmployee?.status !== 'active')
        );

        const employee = {
            ...rawEmployee,
            is_terminated: isTerminated,
            is_suspended: isSuspended,
            operational_status: isSuspended ? 'Suspended' : (isTerminated ? 'Terminated' : 'Active')
        };

        res.json({
            success: true,
            user: employee,
            employee,
            documents,
            disciplinary_logs
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, user: req.user, documents: [], disciplinary_logs: [] });
    }
});

// Update profile
router.patch('/', verifyToken, async (req, res) => {
    try {
        const { first_name, last_name, email, gender, birth_date, address } = req.body;
        
        // Update Supabase Auth if email changes
        if (email && email !== req.user.email) {
            const { error: authError } = await supabase.auth.admin.updateUserById(req.user.id, { email });
            if (authError) throw authError;
        }

        const updatePayload = {};
        if (first_name !== undefined) updatePayload.first_name = String(first_name).trim();
        if (last_name !== undefined) updatePayload.last_name = String(last_name).trim();
        if (email) updatePayload.email = email.trim().toLowerCase();

        // Validate and sanitize Gender
        if (gender !== undefined) {
            const sanitizedGender = sanitizeGender(gender);
            if (gender && !sanitizedGender && String(gender).trim().toUpperCase() !== 'N/A') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid gender selection. Choose from Male, Female, Other, or Prefer not to say.'
                });
            }
            updatePayload.gender = sanitizedGender;
        }

        // Validate and sanitize Birth Date (Philippine DOLE Labor Compliance)
        if (birth_date !== undefined) {
            const birthCheck = validateBirthDate(birth_date);
            if (!birthCheck.isValid) {
                return res.status(400).json({
                    success: false,
                    error: birthCheck.error
                });
            }
            updatePayload.birth_date = birthCheck.birthDate;
        }

        // Sanitize Residential Address (PII Protection & XSS/Injection Prevention)
        if (address !== undefined) {
            const cleanAddress = sanitizeAddress(address);
            updatePayload.address = cleanAddress;
        }

        if (Object.keys(updatePayload).length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields provided for update.' });
        }

        // Update Employees table
        const { data, error } = await supabase
            .from('employees')
            .update(updatePayload)
            .eq('id', req.user.id)
            .select('*, production_groups (id, code, name, target_output_pairs, is_active)')
            .single();

        if (error) throw error;

        // Invalidate profile and workforce caches for instant consistency
        invalidateCache(['/api/profile', '/api/employees', `/api/employees/${req.user.id}`]);

        // Real-time broadcast (<5ms) to update all open client sessions
        try {
            const broadcastPayload = {
                employee_id: req.user.id,
                first_name: data.first_name,
                last_name: data.last_name,
                gender: data.gender,
                birth_date: data.birth_date,
                address: data.address,
                email: data.email,
                updated_at: new Date().toISOString()
            };

            const channels = [
                `myprofile-realtime-${req.user.id}`,
                `employee-live-dashboard-${req.user.id}`,
                'admin-live-employees-directory'
            ];

            channels.forEach(ch => {
                supabase.channel(ch).send({
                    type: 'broadcast',
                    event: 'PROFILE_UPDATED',
                    payload: broadcastPayload
                }).catch(() => {});
            });
        } catch (_) {}

        // Enterprise audit logging
        try {
            await createAuditLog({
                log_name: 'profile',
                description: `Employee updated profile information (gender: ${data.gender || 'N/A'}, birth_date: ${data.birth_date || 'N/A'}, address: ${data.address ? 'Registered' : 'None'})`,
                subject_type: 'App\\Models\\Employee',
                subject_id: req.user.id,
                event: 'updated',
                causer_id: req.user.id
            });
        } catch (_) {}

        res.json({
            success: true,
            message: 'profile-updated',
            user: data,
            employee: data
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload / Update Profile Avatar
router.post('/avatar', verifyToken, async (req, res) => {
    try {
        const { image_base64 } = req.body;
        if (!image_base64) {
            return res.status(400).json({ error: 'image_base64 is required' });
        }

        // Check if user is terminated or archived
        const { data: empCheck } = await supabase
            .from('employees')
            .select('id, status, is_active, archived_at')
            .eq('id', req.user.id)
            .single();

        if (empCheck && (empCheck.status === 'inactive' || empCheck.status === 'terminated' || empCheck.is_active === false || empCheck.archived_at)) {
            return res.status(403).json({ error: 'Profile modifications are disabled for separated/terminated accounts.' });
        }

        const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const companyId = req.user.company_id || 'CP-MAIN';
        const filePath = `face-baselines/${companyId}/${req.user.id}.jpg`;

        const { error: uploadError } = await supabase.storage
            .from('public-bucket')
            .upload(filePath, buffer, {
                contentType: 'image/jpeg',
                upsert: true,
            });

        if (uploadError) throw uploadError;

        const publicUrl = `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${filePath}?t=${Date.now()}`;

        await supabase
            .from('employees')
            .update({ avatar_url: publicUrl, has_registered_biometrics: true })
            .eq('id', req.user.id);

        res.json({ success: true, avatar_url: publicUrl });
    } catch (err) {
        console.error('Avatar upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete account
router.delete('/', verifyToken, async (req, res) => {
    try {
        // Must verify password in a real scenario
        const { error } = await supabase.auth.admin.deleteUser(req.user.id);
        if (error) throw error;
        res.json({ success: true, message: 'account-deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
