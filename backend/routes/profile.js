import express from 'express';
import crypto from 'crypto';
import { supabase, createIsolatedAuthClient } from '../supabaseClient.js';
import { closePasswordSession } from '../services/passwordService.js';
import { isPasswordReuseError, PASSWORD_REUSE_MESSAGE } from '../../shared/passwordPolicy.mjs';
import { verifyToken, invalidateAuthUser } from '../middleware/authMiddleware.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { sanitizeGender, validateBirthDate, sanitizeAddress } from '../utils/personalDetailsValidation.js';
import { sanitizePhPhone } from './employees.js';
import { createAuditLog } from './auditLogs.js';
import { DOCUMENT_URL_TTL } from '../services/documentService.js';
import { getOrGenerateOtp, storeOtp, verifyOtpCode, sendEmailOtp, acquireOtpLock, releaseOtpLock } from '../services/otpService.js';
import { verifyTotpCode, verifyAndConsumeBackupCode, checkTotpRateLimit, recordTotpFailure, clearTotpRateLimit } from '../services/totpService.js';

const router = express.Router();

// Get profile, documents, and disciplinary logs in a single parallel batch
router.get('/', verifyToken, cacheResponse(15), async (req, res) => {
    try {
        const userId = req.user.id;
        let empRes = await supabase.from('employees').select('*, production_groups (id, code, name, target_output_pairs, is_active)').eq('id', userId).maybeSingle();
        if (!empRes.data && req.user.auth_user_id) {
            empRes = await supabase.from('employees').select('*, production_groups (id, code, name, target_output_pairs, is_active)').eq('auth_user_id', req.user.auth_user_id).maybeSingle();
        }
        if (!empRes.data && req.user.email) {
            empRes = await supabase.from('employees').select('*, production_groups (id, code, name, target_output_pairs, is_active)').ilike('email', req.user.email.replace(/[\\%_]/g, '\\$&')).maybeSingle();
        }

        const rawEmployee = empRes?.data || req.user;
        const resolvedEmpId = rawEmployee?.id || userId;
        const role = String(rawEmployee?.role || req.user?.role || '').toLowerCase();
        const email = String(rawEmployee?.email || req.user?.email || '').toLowerCase();
        const isAdmin = role === 'admin' || email === 'admin@c-point.com';

        let documents = [];
        let disciplinary_logs = [];
        let recent_activity = [];

        if (isAdmin) {
            const { data: actData } = await supabase
                .from('activity_log')
                .select('*')
                .eq('causer_id', resolvedEmpId)
                .order('created_at', { ascending: false })
                .limit(10);
            recent_activity = actData || [];
        } else {
            const [docsRes, discRes] = await Promise.all([
                supabase.from('employee_documents').select('*').or(`employee_id.eq.${resolvedEmpId},employee_id.eq.${userId}`).order('created_at', { ascending: false }),
                supabase.from('disciplinary_logs').select('*').or(`employee_id.eq.${resolvedEmpId},employee_id.eq.${userId}`).order('created_at', { ascending: false })
            ]);

            documents = docsRes.data || [];
            if (documents.length > 0) {
                try {
                    const paths = documents
                        .filter(d => d.file_path)
                        .map(d => {
                            let p = d.file_path;
                            if (p.includes('/')) return p;
                            return `${resolvedEmpId}/${p}`;
                        })
                        .filter(Boolean);
                    if (paths.length > 0) {
                        const { data: signedList } = await supabase.storage.from('documents').createSignedUrls([...new Set(paths)], DOCUMENT_URL_TTL);
                        if (Array.isArray(signedList)) {
                            const signedMap = new Map(signedList.filter(s => s?.path && s?.signedUrl).map(s => [s.path, s.signedUrl]));
                            for (const doc of documents) {
                                let p = doc.file_path;
                                doc.preview_url = signedMap.get(p) || signedMap.get(`${resolvedEmpId}/${p}`) || null;
                            }
                        }
                    }
                } catch (_) {}
            }
            disciplinary_logs = discRes.data || [];
        }

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
            sex: rawEmployee?.gender || req.user?.gender || null,
            phone: rawEmployee?.phone || req.user?.phone || null,
            emergency_contact_name: rawEmployee?.emergency_contact_name || req.user?.emergency_contact_name || req.user?.user_metadata?.emergency_contact_name || null,
            emergency_contact_phone: rawEmployee?.emergency_contact_phone || req.user?.emergency_contact_phone || req.user?.user_metadata?.emergency_contact_phone || null,
            emergency_contact_relationship: rawEmployee?.emergency_contact_relationship || req.user?.emergency_contact_relationship || req.user?.user_metadata?.emergency_contact_relationship || null,
            is_admin: isAdmin,
            role: rawEmployee?.role || req.user?.role || (isAdmin ? 'admin' : 'employee'),
            job_title: isAdmin && (!rawEmployee?.job_title || /super\s*admin/i.test(rawEmployee?.job_title)) ? 'Admin' : (rawEmployee?.job_title || 'Staff Member'),
            is_terminated: isTerminated,
            is_suspended: isSuspended,
            operational_status: isSuspended ? 'Suspended' : (isTerminated ? 'Terminated' : 'Active')
        };

        res.json({
            success: true,
            user: employee,
            employee,
            documents,
            disciplinary_logs,
            recent_activity
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, user: req.user, documents: [], disciplinary_logs: [], recent_activity: [] });
    }
});

// Update profile
router.patch('/', verifyToken, async (req, res) => {
    try {
        const {
            first_name,
            last_name,
            email,
            phone,
            gender,
            sex,
            birth_date,
            address,
            emergency_contact_name,
            emergency_contact_phone,
            emergency_contact_relationship
        } = req.body;

        const candidateSex = sex !== undefined ? sex : gender;
        
        // Update Supabase Auth if email changes
        if (email && email !== req.user.email) {
            const { error: authError } = await supabase.auth.admin.updateUserById(req.user.id, { email });
            if (authError) throw authError;
        }

        const updatePayload = {};
        if (first_name !== undefined) updatePayload.first_name = String(first_name).trim();
        if (last_name !== undefined) updatePayload.last_name = String(last_name).trim();
        if (email) updatePayload.email = email.trim().toLowerCase();

        // Validate and sanitize Sex
        if (candidateSex !== undefined) {
            const sanitizedGender = sanitizeGender(candidateSex);
            if (candidateSex && !sanitizedGender && String(candidateSex).trim().toUpperCase() !== 'N/A') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid selection for Sex. Choose from Male or Female.'
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

        // Sanitize and validate mobile phone (Philippine 10-digit starting with 9)
        let sanitizedPhone = undefined;
        if (phone !== undefined) {
            if (phone === null || String(phone).trim() === '') {
                sanitizedPhone = null;
            } else {
                sanitizedPhone = sanitizePhPhone(phone);
                if (!sanitizedPhone) {
                    return res.status(400).json({
                        success: false,
                        error: 'A valid 10-digit Philippine mobile phone number starting with 9 is required (e.g. 917 123 4567).'
                    });
                }
            }
        }

        // Sanitize and validate emergency contact phone
        let sanitizedEmergencyPhone = undefined;
        if (emergency_contact_phone !== undefined) {
            if (emergency_contact_phone === null || String(emergency_contact_phone).trim() === '') {
                sanitizedEmergencyPhone = null;
            } else {
                sanitizedEmergencyPhone = sanitizePhPhone(emergency_contact_phone);
                if (!sanitizedEmergencyPhone) {
                    return res.status(400).json({
                        success: false,
                        error: 'A valid 10-digit Philippine mobile phone number starting with 9 is required for emergency contact.'
                    });
                }
            }
        }

        // Synchronize Auth metadata (phone, emergency contacts)
        const authMetadataUpdates = {};
        if (sanitizedPhone !== undefined) authMetadataUpdates.phone = sanitizedPhone;
        if (emergency_contact_name !== undefined) authMetadataUpdates.emergency_contact_name = emergency_contact_name ? String(emergency_contact_name).trim().slice(0, 100) : null;
        if (sanitizedEmergencyPhone !== undefined) authMetadataUpdates.emergency_contact_phone = sanitizedEmergencyPhone;
        if (emergency_contact_relationship !== undefined) authMetadataUpdates.emergency_contact_relationship = emergency_contact_relationship ? String(emergency_contact_relationship).trim().slice(0, 50) : null;

        if (Object.keys(authMetadataUpdates).length > 0) {
            try {
                const targetAuthUserId = req.user.auth_user_id || req.user.id;
                const { data: currentAuth } = await supabase.auth.admin.getUserById(targetAuthUserId);
                const currentMeta = currentAuth?.user?.user_metadata || {};
                await supabase.auth.admin.updateUserById(targetAuthUserId, {
                    user_metadata: {
                        ...currentMeta,
                        ...authMetadataUpdates
                    }
                });
            } catch (authMetaErr) {
                console.error('[Profile Update] Auth metadata update error:', authMetaErr);
            }
        }

        if (sanitizedPhone !== undefined) {
            updatePayload.phone = sanitizedPhone;
        }
        if (emergency_contact_name !== undefined) {
            updatePayload.emergency_contact_name = emergency_contact_name ? String(emergency_contact_name).trim().slice(0, 100) : null;
        }
        if (sanitizedEmergencyPhone !== undefined) {
            updatePayload.emergency_contact_phone = sanitizedEmergencyPhone;
        }
        if (emergency_contact_relationship !== undefined) {
            updatePayload.emergency_contact_relationship = emergency_contact_relationship ? String(emergency_contact_relationship).trim().slice(0, 50) : null;
        }

        if (Object.keys(updatePayload).length === 0 && Object.keys(authMetadataUpdates).length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields provided for update.' });
        }

        let data = { ...req.user };

        // Update Employees table if there are DB fields to update
        if (Object.keys(updatePayload).length > 0) {
            let updateRes = await supabase
                .from('employees')
                .update(updatePayload)
                .eq('id', req.user.id)
                .select('*, production_groups (id, code, name, target_output_pairs, is_active)')
                .maybeSingle();

            if (updateRes.error && updateRes.error.message?.includes('phone')) {
                const { phone: _dropPhone, ...payloadWithoutPhone } = updatePayload;
                updateRes = await supabase
                    .from('employees')
                    .update(payloadWithoutPhone)
                    .eq('id', req.user.id)
                    .select('*, production_groups (id, code, name, target_output_pairs, is_active)')
                    .maybeSingle();
            }

            if (!updateRes.data && req.user.auth_user_id) {
                updateRes = await supabase
                    .from('employees')
                    .update(updatePayload)
                    .eq('auth_user_id', req.user.auth_user_id)
                    .select('*, production_groups (id, code, name, target_output_pairs, is_active)')
                    .maybeSingle();

                if (updateRes.error && updateRes.error.message?.includes('phone')) {
                    const { phone: _dropPhone, ...payloadWithoutPhone } = updatePayload;
                    updateRes = await supabase
                        .from('employees')
                        .update(payloadWithoutPhone)
                        .eq('auth_user_id', req.user.auth_user_id)
                        .select('*, production_groups (id, code, name, target_output_pairs, is_active)')
                        .maybeSingle();
                }
            }

            if (updateRes.error) throw updateRes.error;
            data = updateRes.data || { ...req.user, ...updatePayload };
        }

        // Merge updated contact and emergency contact fields
        data = {
            ...data,
            sex: data.gender,
            phone: sanitizedPhone !== undefined ? sanitizedPhone : (data.phone || req.user?.phone || null),
            emergency_contact_name: emergency_contact_name !== undefined ? (emergency_contact_name ? String(emergency_contact_name).trim().slice(0, 100) : null) : (req.user?.emergency_contact_name || null),
            emergency_contact_phone: sanitizedEmergencyPhone !== undefined ? sanitizedEmergencyPhone : (req.user?.emergency_contact_phone || null),
            emergency_contact_relationship: emergency_contact_relationship !== undefined ? (emergency_contact_relationship ? String(emergency_contact_relationship).trim().slice(0, 50) : null) : (req.user?.emergency_contact_relationship || null)
        };

        // Invalidate auth memory cache (<1ms) and HTTP route cache
        invalidateAuthUser(req.user.id);
        if (req.user.auth_user_id && req.user.auth_user_id !== req.user.id) {
            invalidateAuthUser(req.user.auth_user_id);
        }
        invalidateCache(['/api/profile', '/api/employees', `/api/employees/${req.user.id}`]);

        // Real-time broadcast (<5ms) to update all open client sessions
        try {
            const broadcastPayload = {
                employee_id: req.user.id,
                first_name: data.first_name,
                last_name: data.last_name,
                gender: data.gender,
                sex: data.gender,
                birth_date: data.birth_date,
                address: data.address,
                phone: data.phone,
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
                description: `Employee updated profile information (gender: ${data.gender || 'N/A'}, birth_date: ${data.birth_date || 'N/A'}, address: ${data.address ? 'Registered' : 'None'}, phone: ${data.phone ? 'Registered' : 'None'})`,
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

// POST /api/profile/request-password-otp - Request single-use OTP for administrative password change
router.post('/request-password-otp', verifyToken, async (req, res) => {
    try {
        let userEmail = (req.user.email || '').toLowerCase().trim();
        let userName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Administrator';

        if (!userEmail) {
            const { data: emp } = await supabase
                .from('employees')
                .select('email, first_name, last_name')
                .eq('id', req.user.id)
                .maybeSingle();
            if (emp?.email) {
                userEmail = emp.email.toLowerCase().trim();
                userName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || userName;
            }
        }

        if (!userEmail) {
            return res.status(400).json({ success: false, message: 'No registered corporate email found for this administrator account.' });
        }

        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const rateLimitKey = `pwd_otp_req:${req.user.id}:${clientIp}`;
        const rateCheck = checkTotpRateLimit(rateLimitKey, 5, 10 * 60 * 1000, 15 * 60 * 1000);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                success: false,
                message: `Too many verification requests. Please wait ${rateCheck.retryAfterSeconds} seconds before requesting another code.`,
                retry_after: rateCheck.retryAfterSeconds
            });
        }

        const purpose = 'change_password';
        const identifier = `${purpose}_${userEmail}`.toLowerCase().trim();
        const lockKeys = [identifier, `dest_email_${purpose}_${userEmail}`];

        const lock = acquireOtpLock(lockKeys);
        if (!lock.acquired) {
            const remaining = lock.remainingSeconds || 60;
            return res.set('Retry-After', String(remaining)).status(429).json({
                success: false,
                message: lock.reason === 'in_flight'
                    ? 'A verification code dispatch is currently in progress. Please check your inbox.'
                    : `Please wait ${remaining}s before requesting a new verification code.`,
                retry_after: remaining
            });
        }

        try {
            const otpInfo = getOrGenerateOtp(identifier);
            const code = otpInfo.code;
            storeOtp(identifier, code, 'email');

            const isMock = Boolean(req.body?.mock || req.body?.is_mock);
            let dispatchResult;
            if (isMock) {
                dispatchResult = { simulated: true, provider: 'mock', success: true };
            } else {
                dispatchResult = await sendEmailOtp(userEmail, code, userName);
            }

            releaseOtpLock(lockKeys, true);

            await createAuditLog({
                log_name: 'security',
                description: `Password change verification OTP dispatched to ${userEmail}`,
                subject_type: 'App\\Models\\User',
                subject_id: req.user.id,
                event: 'PASSWORD_CHANGE_OTP_DISPATCHED',
                causer_id: req.user.id,
                properties: { email: userEmail, client_ip: clientIp }
            });

            return res.json({
                success: true,
                message: `Verification code sent to ${userEmail}. Valid for 5 minutes.`,
                cooldown: 60,
                expiresIn: otpInfo.remainingSeconds
            });
        } catch (dispatchErr) {
            releaseOtpLock(lockKeys, false);
            throw dispatchErr;
        }
    } catch (err) {
        console.error('[PASSWORD_OTP_REQUEST_ERROR]', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to dispatch verification code.' });
    }
});

// POST /api/profile/change-password - Change password with multi-factor OTP/TOTP verification & brute force protection
router.post('/change-password', verifyToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const rateLimitKey = `pwd_change_rate:${req.user.id}:${clientIp}`;
    let passwordClient;
    let hasPasswordSession = false;

    try {
        const { current_password, new_password, otp } = req.body || {};

        if (typeof current_password !== 'string' || typeof new_password !== 'string' || !current_password.trim() || !new_password.trim()) {
            return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
        }

        if (!otp || !String(otp).trim()) {
            return res.status(400).json({
                success: false,
                message: 'Security verification code is required. Please provide the 6-digit OTP from your email or Google Authenticator.'
            });
        }

        if (typeof new_password !== 'string' || new_password.length < 8) {
            return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long.' });
        }
        if (current_password.length > 1024 || new_password.length > 1024) return res.status(400).json({ success: false, message: 'Passwords must be at most 1024 characters long.' });

        if (String(current_password).trim() === String(new_password).trim()) {
            return res.status(400).json({ success: false, code: 'PASSWORD_REUSED', message: PASSWORD_REUSE_MESSAGE });
        }

        // Brute force protection check (max 5 failed attempts per 15 min window, 15 min lockout)
        const rateCheck = checkTotpRateLimit(rateLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000);
        if (!rateCheck.allowed) {
            await createAuditLog({
                log_name: 'security',
                description: `Brute force password change blocked for user ${req.user.email || req.user.id} from IP ${clientIp}`,
                subject_type: 'App\\Models\\User',
                subject_id: req.user.id,
                event: 'PASSWORD_CHANGE_BRUTE_FORCE_BLOCKED',
                causer_id: req.user.id,
                properties: { client_ip: clientIp, retry_after: rateCheck.retryAfterSeconds }
            });

            return res.status(429).json({
                success: false,
                message: `Too many failed password change attempts. Access temporarily locked for ${rateCheck.retryAfterSeconds} seconds.`,
                retry_after: rateCheck.retryAfterSeconds
            });
        }

        let userEmail = (req.user.email || '').toLowerCase().trim();
        if (!userEmail) {
            const { data: emp } = await supabase.from('employees').select('email').eq('id', req.user.id).maybeSingle();
            if (emp?.email) userEmail = emp.email.toLowerCase().trim();
        }

        // Step 1: Verify current password via Supabase Auth
        const targetAuthId = req.user.auth_user_id || req.user.id;
        passwordClient = createIsolatedAuthClient();
        const { data: passwordAuth, error: signInErr } = await passwordClient.auth.signInWithPassword({
            email: userEmail,
            password: String(current_password).trim()
        });
        hasPasswordSession = Boolean(passwordAuth?.session?.access_token);

        if (signInErr) {
            const fail = recordTotpFailure(rateLimitKey, 5, 15 * 60 * 1000);
            await createAuditLog({
                log_name: 'security',
                description: `Failed password change attempt (incorrect current password) for ${userEmail}`,
                subject_type: 'App\\Models\\User',
                subject_id: req.user.id,
                event: 'PASSWORD_CHANGE_AUTH_FAILED',
                causer_id: req.user.id,
                properties: { client_ip: clientIp, remaining_attempts: fail.remainingAttempts }
            });

            return res.status(400).json({
                success: false,
                message: fail.locked
                    ? 'Current password incorrect. Maximum attempts exceeded. Password change locked for 15 minutes.'
                    : `Current password is incorrect. ${fail.remainingAttempts} attempt${fail.remainingAttempts === 1 ? '' : 's'} remaining.`,
                remainingAttempts: fail.remainingAttempts,
                locked: fail.locked,
                retry_after: fail.retryAfterSeconds
            });
        }

        if (!hasPasswordSession || passwordAuth?.user?.id !== targetAuthId) {
            return res.status(403).json({ success: false, message: 'The authenticated account does not match your personnel record. Contact HR.' });
        }

        // Step 2: Multi-Factor Verification (Email OTP OR Google Authenticator TOTP OR Backup Code)
        const cleanOtp = String(otp).trim();
        const emailOtpIdentifier = `change_password_${userEmail}`;
        let isCodeValid = false;
        let verifiedVia = 'EMAIL_OTP';

        // Check Email OTP first
        const otpCheck = verifyOtpCode(emailOtpIdentifier, cleanOtp);
        if (otpCheck.valid) {
            isCodeValid = true;
            verifiedVia = 'EMAIL_OTP';
        } else {
            // Check Google Authenticator TOTP or Backup code fallback
            try {
                const targetAuthId = req.user.auth_user_id || req.user.id;
                const { data: authData } = await supabase.auth.admin.getUserById(targetAuthId);
                const meta = authData?.user?.user_metadata || {};

                if (meta.totp_enabled && meta.totp_secret) {
                    if (cleanOtp.startsWith('CP-') || cleanOtp.length > 6) {
                        const backupRes = verifyAndConsumeBackupCode(cleanOtp, meta.totp_backup_codes || []);
                        if (backupRes.valid) {
                            isCodeValid = true;
                            verifiedVia = 'BACKUP_CODE';
                            await supabase.auth.admin.updateUserById(targetAuthId, {
                                user_metadata: { ...meta, totp_backup_codes: backupRes.remainingCodes }
                            });
                        }
                    } else {
                        const totpRes = verifyTotpCode(meta.totp_secret, cleanOtp);
                        if (totpRes.valid) {
                            isCodeValid = true;
                            verifiedVia = 'TOTP_AUTHENTICATOR';
                        }
                    }
                }
            } catch (totpErr) {
                console.error('[PASSWORD_CHANGE_TOTP_CHECK_ERR]', totpErr);
            }
        }

        if (!isCodeValid) {
            const fail = recordTotpFailure(rateLimitKey, 5, 15 * 60 * 1000);
            await createAuditLog({
                log_name: 'security',
                description: `Failed password change attempt (invalid OTP/2FA code) for ${userEmail}`,
                subject_type: 'App\\Models\\User',
                subject_id: req.user.id,
                event: 'PASSWORD_CHANGE_OTP_FAILED',
                causer_id: req.user.id,
                properties: { client_ip: clientIp, remaining_attempts: fail.remainingAttempts }
            });

            return res.status(400).json({
                success: false,
                message: fail.locked
                    ? 'Invalid verification code. Maximum attempts exceeded. Password change locked for 15 minutes.'
                    : `Invalid or expired verification code. ${fail.remainingAttempts} attempt${fail.remainingAttempts === 1 ? '' : 's'} remaining.`,
                remainingAttempts: fail.remainingAttempts,
                locked: fail.locked,
                retry_after: fail.retryAfterSeconds
            });
        }

        // Step 3: Keep the provider's same-password protection after our OTP/TOTP checks.
        const { error: updateErr } = await passwordClient.auth.updateUser({
            password: new_password.trim(),
            current_password: current_password.trim()
        });

        if (updateErr) {
            if (isPasswordReuseError(updateErr)) return res.status(400).json({ success: false, code: 'PASSWORD_REUSED', message: PASSWORD_REUSE_MESSAGE });
            return res.status(updateErr.code === 'weak_password' ? 400 : updateErr.status === 429 ? 429 : 503).json({ success: false, message: 'Unable to update your password. Review the password requirements and try again.' });
        }

        // Clear rate limiter upon successful update
        clearTotpRateLimit(rateLimitKey);

        await supabase.from('employees').update({
            requires_password_change: false,
            password_changed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq('id', req.user.id);

        invalidateAuthUser(req.user.id);

        // Enterprise audit logging
        const auditLogPayload = {
            log_name: 'security',
            description: `Administrative password successfully rotated for ${userEmail} via ${verifiedVia} verification`,
            subject_type: 'App\\Models\\User',
            subject_id: req.user.id,
            event: 'ADMIN_PASSWORD_ROTATED',
            causer_id: req.user.id,
            properties: { email: userEmail, verified_via: verifiedVia, client_ip: clientIp }
        };
        await createAuditLog(auditLogPayload);

        // Real-time broadcast to admin channels (<5ms)
        try {
            supabase.channel(`admin-profile-activity-${req.user.id}`).send({
                type: 'broadcast',
                event: 'ACTIVITY_LOGGED',
                payload: {
                    id: crypto.randomUUID(),
                    event: 'ADMIN_PASSWORD_ROTATED',
                    description: `Password rotated via ${verifiedVia}`,
                    created_at: new Date().toISOString(),
                    subject_type: 'Security'
                }
            }).catch(() => {});

            supabase.channel('admin-live-security-alerts').send({
                type: 'broadcast',
                event: 'SECURITY_EVENT',
                payload: {
                    type: 'ADMIN_PASSWORD_ROTATED',
                    user_id: req.user.id,
                    email: userEmail,
                    timestamp: new Date().toISOString()
                }
            }).catch(() => {});
        } catch (_) {}

        res.json({
            success: true,
            message: 'Administrative password updated successfully with top-grade multi-factor verification.',
            verifiedVia
        });
    } catch (err) {
        console.error('[CHANGE_PASSWORD_ERROR]', { code: err?.code || 'UNAVAILABLE' });
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred during password change.'
        });
    } finally {
        if (hasPasswordSession) await closePasswordSession(passwordClient);
    }
});

export default router;
