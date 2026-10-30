import express from 'express';
import { isFinalVoluntarySeparation, getArchiveReviewDaysRemaining } from '../../shared/employmentExit.mjs';
import { hasRegisteredFace } from '../../shared/medicalGrace.mjs';
import { randomUUID } from 'node:crypto';
import { getEmployeePayError } from '../../shared/personnelInput.mjs';
import { postgrestValue, postgrestLikeValue, validateUuidParam } from '../middleware/requestValidation.js';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache, readCachedSource } from '../middleware/cacheMiddleware.js';
import { invalidateAuthUser, hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { createNotification } from './notifications.js';
import { DOCUMENT_URL_TTL } from '../services/documentService.js';
import { computeDisciplinaryStanding } from '../utils/disciplinaryStanding.js';
import { sanitizeGender, validateBirthDate, sanitizeAddress, validateHireDate } from '../utils/personalDetailsValidation.js';
import { isLeaveDate } from '../../shared/leaveCredits.mjs';
import { getManilaWorkDate } from '../../shared/workPolicy.mjs';
import { parseListQuery, employeeListRecord, employeeDirectoryPage, readAllRows } from '../utils/listViews.js';
import { readDocumentPendingCounts } from '../utils/documentPendingCounts.js';
import { listEmployeePhotoFiles } from '../utils/employeePhotoFiles.js';

import { isVerifiedCreditManager, isMissingCreditSchema, sendCreditError, refreshLeaveCredits } from './leaves.js';

const router = express.Router();
router.param('id', validateUuidParam);
const ASSIGNMENT_TEXT_LIMITS = Object.freeze({ department: 100, shift: 160 });
const ASSIGNMENT_TEXT_PATTERN = /^[\p{L}\p{M}\p{N} .,&'’_()\/:·-]+$/u;

export function sanitizePhPhone(phone) {
    if (!phone) return null;
    let clean = String(phone).replace(/\D/g, '');
    if (clean.startsWith('63') && (clean.length === 12 || clean.length === 11)) {
        clean = clean.slice(2);
    }
    clean = clean.replace(/^0+/, '');
    if (/^[89]\d{9}$/.test(clean)) {
        return clean;
    }
    return null;
}

/**
 * Determines employee operational status (Terminated, Suspended, or Active)
 * based on employee account status and disciplinary records.
 */
function evaluateOperationalStanding(emp, logs = [], now = new Date()) {
    const termLog = logs.find(l => {
        if (l.type !== 'Termination') return false;
        const s = (l.status || '').toLowerCase();
        return s !== 'resolved' && s !== 'overturned' && s !== 'dismissed' && s !== 'cancelled' && s !== 'closed';
    });

    // 1. Suspension Evaluation (Suspended personnel remain in workforce directory with paused attendance/QR)
    const activeSuspension = logs.find(l => {
        if (l.type !== 'Suspension') return false;

        const logStatus = (l.status || '').toLowerCase();
        // If HR marked it Resolved, Closed, Dismissed, or Cancelled, it is lifted
        if (logStatus === 'resolved' || logStatus === 'dismissed' || logStatus === 'cancelled' || logStatus === 'closed' || logStatus === 'overturned') {
            return false;
        }

        // If an expiration date is present, ensure it hasn't expired
        const match = (l.reason || '').match(/Until\s+(\d{4}-\d{2}-\d{2})/i);
        if (match) {
            const endDate = new Date(match[1] + 'T23:59:59');
            if (endDate < now) return false;
        }

        return ['active', 'action required', 'under review', 'acknowledged'].includes(logStatus);
    });

    const isSuspended = (emp.status === 'suspended' || Boolean(activeSuspension)) && !Boolean(termLog);

    // 2. Termination Evaluation (Strictly excluded if employee is suspended)
    const isTerminated = !isSuspended && Boolean(
        emp.status === 'terminated' ||
        Boolean(termLog) || 
        (Boolean(emp.archived_at) && emp.status !== 'active' && emp.status !== 'suspended')
    );

    let operational_status = 'Active';
    if (isSuspended) operational_status = 'Suspended';
    else if (isTerminated) operational_status = 'Terminated';

    const standing = computeDisciplinaryStanding({
        isTerminated,
        isSuspended,
        status: emp.status,
        operational_status,
        disciplinaryLogs: logs
    });

    return {
        is_terminated: isTerminated,
        is_suspended: isSuspended,
        operational_status,
        active_suspension: activeSuspension || (isSuspended ? {
            type: 'Suspension',
            reason: 'Operational Disciplinary Suspension',
            status: 'Active'
        } : null),
        termination_record: !isSuspended && (termLog || (isTerminated ? {
            type: 'Termination',
            reason: emp.separation_reason || 'Contract Concluded / Terminated',
            status: 'Active',
            date: emp.separation_date || emp.archived_at || new Date().toISOString()
        } : null)),
        past_suspensions_count: standing.served_suspensions_count,
        served_suspensions_count: standing.served_suspensions_count,
        cleared_suspensions_count: standing.cleared_suspensions_count,
        disciplinary_count: logs.length,
        disciplinary_standing: standing
    };
}

router.get('/', cacheResponse(15), async (req, res) => {
    try {
        const view = req.query.view;
        if (view !== undefined && !['directory', 'roster'].includes(view)) return res.status(400).json({ error: 'Invalid employee list view.' });
        const filters = view ? parseListQuery(req.query) : null;
        if (view && !hasVerifiedManagerRole(req.user)) return res.status(403).json({ error: 'Administrative access is required.' });
        const employeeId = hasVerifiedManagerRole(req.user) ? req.query.employee_id : req.user.id;
        const makeQuery = () => {
            let query = supabase
                .from('employees')
                .select(`
                    *,
                    production_groups (
                        id, code, name, target_output_pairs, is_active
                    ),
                    disciplinary_logs (
                        id, type, reason, severity, status, date, created_at
                    )
                `, view ? { count: 'exact' } : undefined)
                .order('last_name', { ascending: true })
                .order('first_name', { ascending: true });

            if (employeeId) {
                query = query.eq('id', employeeId);
            }
            return view ? query.order('id', { ascending: true }) : query;
        };
        const readWorkforce = () => readAllRows(makeQuery);
        const [employeeResult, pendingCounts] = await Promise.all([
            view ? (req.query.employee_id ? readWorkforce() : readCachedSource('/api/employees/workforce', readWorkforce)).then(data => ({ data })) : makeQuery(),
            view === 'directory' ? readCachedSource('/api/employees/pending-documents', () => readDocumentPendingCounts(supabase)) : null,
        ]);
        const { data, error } = employeeResult;
        if (error) throw error;

        const now = new Date();
        const enriched = (data || []).map(emp => {
            const logs = emp.disciplinary_logs || [];
            const standing = evaluateOperationalStanding(emp, logs, now);
            return {
                ...emp,
                sex: emp.gender,
                phone: emp.phone || null,
                ...standing
            };
        });

        // Priority ordering: active workforce first, separated records last. Both groups sorted alphabetically (A-Z).
        enriched.sort((a, b) => {
            const aTerm = a.is_terminated ? 1 : 0;
            const bTerm = b.is_terminated ? 1 : 0;
            if (aTerm !== bTerm) return aTerm - bTerm;

            const lastNameA = (a.last_name || '').trim();
            const lastNameB = (b.last_name || '').trim();
            const comp = lastNameA.localeCompare(lastNameB, undefined, { sensitivity: 'base' });
            if (comp !== 0) return comp;
            return (a.first_name || '').trim().localeCompare((b.first_name || '').trim(), undefined, { sensitivity: 'base' });
        });

        let result = { success: true, data: enriched };
        if (view === 'directory') {
            result = employeeDirectoryPage(enriched, pendingCounts, filters, now);
        } else if (view === 'roster') {
            result = { success: true, data: enriched.map(employeeListRecord) };
        }
        if (view !== 'roster' && result.data.some(emp => !emp.phone)) {
            try {
                const phones = await readCachedSource('/api/employees/auth-phones', async () => {
                    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                    if (error || !Array.isArray(data?.users)) throw error || new Error('Optional employee phone metadata unavailable.');
                    return new Map(data.users.map(u => [u.id, u.user_metadata?.phone || u.phone || null]));
                });
                result.data = result.data.map(emp => ({ ...emp, phone: emp.phone || phones.get(emp.id) || null }));
            } catch {}
        }
        res.json(result);
    } catch (error) {
        res.status(error.status === 400 ? 400 : 500).json({ success: false, error: error.message });
    }
});

// Real-time email uniqueness and conflict verification endpoint
router.get('/check-email', async (req, res) => {
    try {
        if (!hasVerifiedManagerRole(req.user)) return res.status(403).json({ error: 'Administrative access is required.' });
        const rawEmail = String(req.query.email || '').trim().toLowerCase();
        const excludeId = req.query.exclude_id ? String(req.query.exclude_id).trim() : null;

        if (!rawEmail) {
            return res.json({ available: true });
        }

        let query = supabase
            .from('employees')
            .select('id, first_name, last_name, company_id, status, is_active, archived_at')
            .ilike('email', rawEmail);

        if (excludeId) {
            query = query.neq('id', excludeId);
        }

        const { data: existing, error } = await query.maybeSingle();
        if (error) throw error;

        if (!existing) {
            return res.json({ available: true, message: 'Email is available' });
        }

        const isArchived = Boolean(existing.archived_at) || existing.is_active === false || existing.status === 'terminated';
        if (isArchived) {
            return res.json({
                available: true,
                heldByArchived: true,
                message: `Currently attached to archived record (${existing.first_name} ${existing.last_name}). Will be automatically reassigned upon saving.`
            });
        }

        return res.json({
            available: false,
            heldByArchived: false,
            message: `Already registered to active personnel: ${existing.first_name} ${existing.last_name} (${existing.company_id || 'ID ' + existing.id})`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get employee details and documents in a single parallel batch
router.get('/:id', cacheResponse(15), async (req, res) => {
    try {
        const { id } = req.params;
        if (!hasVerifiedManagerRole(req.user) && id !== req.user?.id && id !== req.user?.auth_user_id) {
            return res.status(403).json({ success: false, error: 'You may only view your own employee record.' });
        }
        const [empRes, docsRes, discRes] = await Promise.all([
            supabase.from('employees').select('*, production_groups (id, code, name, target_output_pairs, is_active)').eq('id', id).single(),
            supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
            supabase.from('disciplinary_logs').select('*').eq('employee_id', id).order('created_at', { ascending: false })
        ]);
        if (empRes.error) throw empRes.error;

        const emp = empRes.data;
        if (emp && emp.medical_record_url) {
            try {
                const parsed = typeof emp.medical_record_url === 'string' ? JSON.parse(emp.medical_record_url) : emp.medical_record_url;
                if (parsed && parsed.granted_by && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.granted_by)) {
                    parsed.granted_by_id = parsed.granted_by;
                    parsed.granted_by = 'System Administrator';
                    parsed.granted_by_role = parsed.granted_by_role || 'HR Administrator';
                    emp.medical_record_url = JSON.stringify(parsed);
                }
            } catch (_) {}
        }
        const logs = discRes.data || [];
        const now = new Date();
        const standing = evaluateOperationalStanding(emp, logs, now);

        let tempPassword = null;
        let phone = emp.phone || null;
        if (!phone || (emp.requires_password_change && hasVerifiedManagerRole(req.user))) {
            try {
                const { data: authUser } = await supabase.auth.admin.getUserById(id);
                if (emp.requires_password_change && hasVerifiedManagerRole(req.user)) {
                    tempPassword = authUser?.user?.user_metadata?.temp_password || null;
                }
                if (!phone) {
                    phone = authUser?.user?.user_metadata?.phone || authUser?.user?.phone || null;
                }
            } catch {
                // Ignore auth fetch failure
            }
        }

        const enrichedEmp = {
            ...emp,
            sex: emp.gender,
            phone,
            ...standing,
            temp_password: tempPassword,
            is_registered: !emp.requires_password_change,
            disciplinary_logs: logs
        };

        const empDocs = docsRes.data || [];
        if (empDocs.length > 0) {
            try {
                const paths = empDocs
                    .filter(d => d.file_path)
                    .map(d => {
                        let p = d.file_path;
                        if (p.includes('/')) return p;
                        return `${id}/${p}`;
                    })
                    .filter(Boolean);
                if (paths.length > 0) {
                    const { data: signedList } = await supabase.storage.from('documents').createSignedUrls([...new Set(paths)], DOCUMENT_URL_TTL);
                    if (Array.isArray(signedList)) {
                        const signedMap = new Map(signedList.filter(s => s?.path && s?.signedUrl).map(s => [s.path, s.signedUrl]));
                        for (const doc of empDocs) {
                            let p = doc.file_path;
                            doc.preview_url = signedMap.get(p) || signedMap.get(`${id}/${p}`) || null;
                        }
                    }
                }
            } catch (_) {}
        }

        res.json({ success: true, data: enrichedEmp, documents: empDocs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    let creationStage = 'validation';
    try {
        if (!hasVerifiedManagerRole(req.user)) {
            return res.status(403).json({ success: false, error: 'Administrative privileges required to register employees.' });
        }
        if (req.body?.role === 'admin' && req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Only administrators can create administrator accounts.' });
        }
        const {
            first_name,
            last_name,
            email,
            phone,
            department,
            job_title,
            shift,
            production_group_id,
            production_group_name,
            daily_rate,
            hourly_rate,
            monthly_salary,
            piece_rate,
            role = 'employee',
            gender,
            sex,
            birth_date,
            date_hired,
            timekeeping_effective_date,
            address
        } = req.body;

        const isSecurityRole = role === 'security';
        const effectiveDepartment = isSecurityRole ? (department || 'Security') : department;
        const effectiveJobTitle = isSecurityRole ? (job_title || 'Security Guard') : job_title;

        const effectiveHireDate = (isSecurityRole && !date_hired) ? (getManilaWorkDate ? getManilaWorkDate() : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })) : date_hired;
        const hireCheck = validateHireDate(effectiveHireDate);
        if (!hireCheck.isValid) return res.status(400).json({ success: false, error: hireCheck.error });

        let validatedTimekeepingDate = null;
        if (timekeeping_effective_date !== undefined && timekeeping_effective_date !== null && String(timekeeping_effective_date).trim()) {
            const tkStr = String(timekeeping_effective_date).trim().slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(tkStr) || isNaN(Date.parse(tkStr))) {
                return res.status(400).json({ success: false, error: 'Invalid timekeeping effective date format. Expected YYYY-MM-DD.' });
            }
            validatedTimekeepingDate = tkStr;
        } else {
            validatedTimekeepingDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        }

        // Input validation
        if (!first_name || typeof first_name !== 'string' || first_name.length > 255) return res.status(400).json({ success: false, error: 'Invalid first name' });
        if (!last_name || typeof last_name !== 'string' || last_name.length > 255) return res.status(400).json({ success: false, error: 'Invalid last name' });
        if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });

        // Validate and sanitize Sex
        const candidateSex = sex !== undefined ? sex : gender;
        let sanitizedGender = null;
        if (candidateSex !== undefined && candidateSex !== null && String(candidateSex).trim()) {
            sanitizedGender = sanitizeGender(candidateSex);
            if (!sanitizedGender && String(candidateSex).trim().toUpperCase() !== 'N/A') {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid selection for Sex. Choose from Male or Female.'
                });
            }
        }

        // Validate and sanitize Birth Date (Philippine DOLE Labor Compliance)
        let validatedBirthDate = null;
        if (birth_date !== undefined && birth_date !== null && String(birth_date).trim()) {
            const birthCheck = validateBirthDate(birth_date);
            if (!birthCheck.isValid) {
                return res.status(400).json({
                    success: false,
                    error: birthCheck.error
                });
            }
            validatedBirthDate = birthCheck.birthDate;
        }

        // Sanitize Residential Address
        const sanitizedAddr = address ? sanitizeAddress(address) : null;

        // Enterprise Phone Number Validation (Philippine Standard: 9XXXXXXXXX)
        let sanitizedPhone = null;
        if (phone !== undefined && phone !== null && String(phone).trim()) {
            sanitizedPhone = sanitizePhPhone(phone);
            if (!sanitizedPhone) {
                return res.status(400).json({
                    success: false,
                    error: 'A valid 10-digit Philippine mobile phone number starting with 9 is required (e.g. 917 123 4567).'
                });
            }
        }

        if (!effectiveDepartment || typeof effectiveDepartment !== 'string') return res.status(400).json({ success: false, error: 'Invalid department' });
        if (!effectiveJobTitle || typeof effectiveJobTitle !== 'string') return res.status(400).json({ success: false, error: 'Invalid job title' });
        
        if (role === 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Privilege Escalation Blocked: Administrator accounts cannot be created through standard workforce onboarding. Use the dedicated Admin Provisioning Portal.'
            });
        }
        if (!['employee', 'security'].includes(role)) {
            return res.status(400).json({ success: false, error: 'Invalid role selection for workforce onboarding.' });
        }

        let parsedDailyRate = isSecurityRole
            ? 0
            : (daily_rate !== undefined && daily_rate !== null && !isNaN(daily_rate) ? parseFloat(daily_rate) : null);

        let parsedHourlyRate = isSecurityRole
            ? 0
            : (hourly_rate !== undefined && hourly_rate !== null && !isNaN(hourly_rate) ? parseFloat(hourly_rate) : null);

        // Auto-compute between daily_rate and hourly_rate (Philippine DOLE standard 8-hour workday)
        if (!isSecurityRole) {
            if (parsedDailyRate && (!parsedHourlyRate || parsedHourlyRate === 0)) {
                parsedHourlyRate = parseFloat((parsedDailyRate / 8).toFixed(2));
            } else if (parsedHourlyRate && (!parsedDailyRate || parsedDailyRate === 0)) {
                parsedDailyRate = parseFloat((parsedHourlyRate * 8).toFixed(2));
            } else if (!parsedDailyRate && monthly_salary && !isNaN(monthly_salary)) {
                parsedDailyRate = parseFloat((parseFloat(monthly_salary) / 26).toFixed(2));
                parsedHourlyRate = parseFloat((parsedDailyRate / 8).toFixed(2));
            }
        }

        const payError = getEmployeePayError({ daily_rate: parsedDailyRate, hourly_rate: parsedHourlyRate });
        if (payError) return res.status(400).json({ success: false, code: 'EMPLOYEE_PAY_OUT_OF_RANGE', error: payError });

        // Normalize and hash email
        const normalizedEmail = email.trim().toLowerCase();
        const crypto = await import('crypto');
        const APP_KEY = process.env.APP_KEY || 'default_fallback_key';
        const lookupHash = crypto.createHash('sha256').update(normalizedEmail + APP_KEY).digest('hex');

        // Check if an employee record already exists with this email or hash
        creationStage = 'employee_email_lookup';
        const { data: existingEmp, error: lookupError } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, status, is_active, archived_at, separation_notes')
            .or(`email_hash.eq.${lookupHash},email.eq.${postgrestValue(normalizedEmail)}`)
            .maybeSingle();
        if (lookupError) throw lookupError;

        if (existingEmp) {
            const isArchived = Boolean(existingEmp.archived_at) || existingEmp.is_active === false || existingEmp.status === 'terminated';
            if (isArchived) {
                // Auto-release email from archived employee so new personnel can be onboarded
                const [userPart, domainPart] = normalizedEmail.split('@');
                const releasedEmail = `${userPart}+archived_${Date.now()}@${domainPart || 'cpointhris.archive'}`;
                await supabase
                    .from('employees')
                    .update({
                        email: releasedEmail,
                        email_hash: null,
                        separation_notes: existingEmp.separation_notes
                            ? `${existingEmp.separation_notes} | [Email ${normalizedEmail} reassigned on ${new Date().toISOString().split('T')[0]}]`
                            : `[Email ${normalizedEmail} reassigned on ${new Date().toISOString().split('T')[0]}]`,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingEmp.id);

                try {
                    await supabase.auth.admin.updateUserById(existingEmp.id, {
                        email: releasedEmail,
                        email_confirm: true
                    });
                } catch (_) {}
            } else {
                return res.status(409).json({
                    success: false,
                    conflict: true,
                    error: `This email is already registered to active personnel: ${existingEmp.first_name || ''} ${existingEmp.last_name || ''} (${existingEmp.company_id || existingEmp.id}).`
                });
            }
        }

        // Generate initial temporary password
        const defaultPassword = 'Emp-' + Math.floor(1000 + Math.random() * 9000);

        // Attempt creating the auth user
        creationStage = 'auth_create';
        let authData;
        const { data: createdAuth, error: authError } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password: defaultPassword,
            email_confirm: true,
            user_metadata: { first_name, last_name, role, phone: sanitizedPhone, temp_password: defaultPassword }
        });

        if (authError) {
            // Check if this error is caused by an orphaned auth user not present in the employees table
            const isDuplicate = authError.message?.toLowerCase().includes('already') || authError.status === 422;
            if (isDuplicate) {
                // Find and reconcile orphaned auth account
                creationStage = 'orphan_lookup';
                const { data: userList, error: userListError } = await supabase.auth.admin.listUsers();
                if (userListError) throw userListError;
                const orphanUser = userList?.users?.find(u => u.email?.toLowerCase() === normalizedEmail);

                if (orphanUser) {
                    // Verify that no employee row is bound to this orphan user
                    const { data: boundEmp, error: boundError } = await supabase
                        .from('employees')
                        .select('id')
                        .eq('id', orphanUser.id)
                        .maybeSingle();
                    if (boundError) throw boundError;

                    if (!boundEmp) {
                        // Purge orphan and recreate
                        const { error: orphanDeleteError } = await supabase.auth.admin.deleteUser(orphanUser.id);
                        if (orphanDeleteError) throw orphanDeleteError;
                        const retry = await supabase.auth.admin.createUser({
                            email: normalizedEmail,
                            password: defaultPassword,
                            email_confirm: true,
                            user_metadata: { first_name, last_name, role, phone: sanitizedPhone, temp_password: defaultPassword }
                        });

                        if (retry.error) {
                            return res.status(400).json({ success: false, error: retry.error.message });
                        }
                        authData = retry.data;
                    } else {
                        return res.status(400).json({ success: false, error: 'This email is already registered.' });
                    }
                } else {
                    return res.status(400).json({ success: false, error: authError.message });
                }
            } else {
                return res.status(400).json({ success: false, error: authError.message });
            }
        } else {
            authData = createdAuth;
        }

        // Insert into employees table with rollback protection
        try {
            // Generate next Company ID (e.g., CP-2026-001)
            creationStage = 'company_id_lookup';
            const currentYear = new Date().getFullYear();

            const { data: latestEmp, error: latestError } = await supabase
                .from('employees')
                .select('company_id')
                .like('company_id', `CP-${currentYear}-%`)
                .order('company_id', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (latestError) throw latestError;

            let newIdNum = 1;
            if (latestEmp && latestEmp.company_id) {
                const parts = latestEmp.company_id.split('-');
                if (parts.length === 3) {
                    const lastNum = parseInt(parts[2], 10);
                    if (!isNaN(lastNum)) newIdNum = lastNum + 1;
                }
            }

            const company_id = `CP-${currentYear}-${String(newIdNum).padStart(3, '0')}`;

            // Resolve production group for factory workers
            let resolvedGroupId = null;
            let resolvedGroupName = 'Line A';

            if (department === 'Factory') {
                creationStage = 'production_group_lookup';
                if (production_group_id) {
                    const { data: groupById, error: groupLookupError } = await supabase
                        .from('production_groups')
                        .select('id, name')
                        .eq('id', production_group_id)
                        .maybeSingle();
                    if (groupLookupError) throw groupLookupError;

                    if (groupById) {
                        resolvedGroupId = groupById.id;
                        resolvedGroupName = groupById.name;
                    }
                }

                if (!resolvedGroupId) {
                    const candidateName = (production_group_name || (shift ? shift.split('·')[0].trim() : 'Line A')).trim();
                    const generatedCode = candidateName.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

                    const { data: matchedGroup, error: groupMatchError } = await supabase
                        .from('production_groups')
                        .select('id, name')
                        .or(`name.ilike.${postgrestLikeValue(candidateName)},code.ilike.${postgrestLikeValue(generatedCode)}`)
                        .maybeSingle();
                    if (groupMatchError) throw groupMatchError;

                    if (matchedGroup) {
                        resolvedGroupId = matchedGroup.id;
                        resolvedGroupName = matchedGroup.name;
                    } else if (candidateName) {
                        creationStage = 'production_group_create';
                        const { data: createdGroup, error: groupCreateError } = await supabase
                            .from('production_groups')
                            .insert({
                                code: generatedCode || `LINE-${Date.now()}`,
                                name: candidateName,
                                target_output_pairs: 100,
                                is_active: true
                            })
                            .select('id, name')
                            .single();
                        if (groupCreateError) throw groupCreateError;

                        if (createdGroup) {
                            resolvedGroupId = createdGroup.id;
                            resolvedGroupName = createdGroup.name;
                        }
                    }
                }
            }

            const resolvedShift = shift || (
                isSecurityRole
                    ? 'Security Shift · Gate Terminal'
                    : effectiveDepartment === 'Factory'
                        ? `${resolvedGroupName} · Factory (08:00 AM - 05:00 PM)`
                        : 'Regular Worker (08:00 AM - 08:00 PM)'
            );

            const insertRecord = {
                id: authData.user.id,
                auth_user_id: authData.user.id,
                company_id: company_id,
                first_name,
                last_name,
                email: normalizedEmail,
                role,
                department: effectiveDepartment,
                job_title: effectiveJobTitle,
                shift: resolvedShift,
                production_group_id: resolvedGroupId,
                daily_rate: parsedDailyRate,
                hourly_rate: parsedHourlyRate,
                email_hash: lookupHash,
                status: 'active',
                requires_password_change: true,
                gender: sanitizedGender,
                birth_date: validatedBirthDate,
                ...(hireCheck.hireDate ? { date_hired: hireCheck.hireDate } : {}),
                timekeeping_effective_date: validatedTimekeepingDate,
                address: sanitizedAddr
            };

            let empData = null;
            creationStage = 'employee_insert';
            const tryInsert = await supabase
                .from('employees')
                .insert({ ...insertRecord, phone: sanitizedPhone })
                .select(`
                    *,
                    production_groups (
                        id, code, name, target_output_pairs, is_active
                    )
                `)
                .single();

            if (['PGRST204', '42703'].includes(tryInsert.error?.code) && /['"]phone['"]/.test(tryInsert.error.message || '')) {
                // Table doesn't have phone column; fallback to inserting without phone column
                const retryInsert = await supabase
                    .from('employees')
                    .insert(insertRecord)
                    .select(`
                        *,
                        production_groups (
                            id, code, name, target_output_pairs, is_active
                        )
                    `)
                    .single();
                if (retryInsert.error) throw retryInsert.error;
                empData = { ...retryInsert.data, phone: sanitizedPhone };
            } else if (tryInsert.error) {
                throw tryInsert.error;
            } else {
                empData = tryInsert.data;
            }

            invalidateCache(['/api/employees', '/api/dashboard', '/api/production-groups']);

            return res.status(201).json({
                success: true,
                data: {
                    ...empData,
                    temp_password: defaultPassword
                },
                message: 'Employee created successfully!',
                temp_password: defaultPassword
            });
        } catch (dbError) {
            // Compensate the newly created Auth account if the employee insert fails.
            if (authData?.user?.id) {
                try {
                    const { error: rollbackError } = await supabase.auth.admin.deleteUser(authData.user.id);
                    if (rollbackError) throw rollbackError;
                } catch {
                    console.error('[EMPLOYEE_CREATE_ROLLBACK]', { requestId, code: 'AUTH_CLEANUP_FAILED' });
                }
            }
            throw dbError;
        }
    } catch (error) {
        const msg = error.message || '';
        const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNEXPECTED_ERROR';
        const field = msg.match(/(?:find the|column) ['"]([a-z_][a-z0-9_]*)['"]/i)?.[1] || null;
        console.error('[EMPLOYEE_CREATE]', { requestId, stage: creationStage, code, field });
        if (code === '22003') {
            return res.status(400).json({ success: false, code: 'EMPLOYEE_PAY_OUT_OF_RANGE', error: 'A pay amount exceeds the supported range. Check the daily and hourly pay rates.' });
        }
        if (msg.includes('employees_email_key') || msg.includes('duplicate key') || error.code === '23505') {
            return res.status(409).json({
                success: false,
                conflict: true,
                error: 'An employee with this email address already exists. Please verify the email address.'
            });
        }
        if (['PGRST200', 'PGRST201', 'PGRST204', '42703', '42P01', '42883'].includes(code)) {
            return res.status(503).json({ success: false, code: 'EMPLOYEE_SCHEMA_UNAVAILABLE', error: 'Employee registration needs a database setup update. Contact the administrator.' });
        }
        res.status(500).json({ success: false, error: 'The employee account could not be created. Please retry or contact the administrator.' });
    }
});

// Dedicated Administrator Account Provisioning Endpoint
router.post('/provision-admin', async (req, res) => {
    try {
        if (req.user?.role !== 'admin' || !hasVerifiedManagerRole(req.user)) {
            return res.status(403).json({ success: false, error: 'Only verified administrators can provision administrator accounts.' });
        }
        const {
            first_name,
            last_name,
            email,
            phone,
            department = 'Human Resources',
            job_title = 'System Administrator',
            admin_notes = ''
        } = req.body;

        if (!first_name || typeof first_name !== 'string' || first_name.trim().length > 255) {
            return res.status(400).json({ success: false, error: 'Valid first name is required for administrator provisioning.' });
        }
        if (!last_name || typeof last_name !== 'string' || last_name.trim().length > 255) {
            return res.status(400).json({ success: false, error: 'Valid last name is required for administrator provisioning.' });
        }
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, error: 'Valid corporate email address is required.' });
        }

        const sanitizedPhone = sanitizePhPhone(phone);
        if (!sanitizedPhone) {
            return res.status(400).json({
                success: false,
                error: 'A valid 10-digit Philippine mobile phone number starting with 9 is required for multi-factor security alerts.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const crypto = await import('crypto');
        const APP_KEY = process.env.APP_KEY || 'default_fallback_key';
        const lookupHash = crypto.createHash('sha256').update(normalizedEmail + APP_KEY).digest('hex');

        // Check for existing account with this email
        const { data: existingEmp, error: lookupError } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, status, is_active, role')
            .or(`email_hash.eq.${lookupHash},email.eq.${postgrestValue(normalizedEmail)}`)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (existingEmp) {
            return res.status(409).json({
                success: false,
                conflict: true,
                error: `An active account already exists with this email address (${existingEmp.first_name} ${existingEmp.last_name}, Role: ${existingEmp.role}).`
            });
        }

        // Generate high-entropy temporary password
        const defaultPassword = `Adm@${crypto.randomBytes(4).toString('hex')}#2026`;

        // Create Supabase Auth administrator user
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            password: defaultPassword,
            email_confirm: true,
            user_metadata: {
                first_name: first_name.trim(),
                last_name: last_name.trim(),
                role: 'admin',
                phone: sanitizedPhone,
                temp_password: defaultPassword,
                requires_password_change: true
            }
        });

        if (authError) throw authError;

        try {
            const currentYear = new Date().getFullYear();
            const { data: latestAdmin, error: latestAdminError } = await supabase
                .from('employees')
                .select('company_id')
                .ilike('company_id', `CP-ADM-${currentYear}-%`)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestAdminError) throw latestAdminError;

            let newIdNum = 1;
            if (latestAdmin && latestAdmin.company_id) {
                const parts = latestAdmin.company_id.split('-');
                if (parts.length === 4) {
                    const lastNum = parseInt(parts[3], 10);
                    if (!isNaN(lastNum)) newIdNum = lastNum + 1;
                }
            }

            const company_id = `CP-ADM-${currentYear}-${String(newIdNum).padStart(3, '0')}`;

            const insertRecord = {
                id: authData.user.id,
                auth_user_id: authData.user.id,
                first_name: first_name.trim(),
                last_name: last_name.trim(),
                email: normalizedEmail,
                company_id,
                department: department.trim(),
                job_title: job_title.trim(),
                role: 'admin',
                email_hash: lookupHash,
                status: 'active',
                is_active: true,
                requires_password_change: true,
                date_hired: new Date().toISOString().split('T')[0]
            };

            // Contact numbers live in Auth metadata; employees.phone is not part of the deployed schema.

            const { data: empData, error: insertError } = await supabase
                .from('employees')
                .insert(insertRecord)
                .select('*')
                .single();

            if (insertError) throw insertError;

            // Security audit log for elevated administrative account creation
            try {
                const { createAuditLog } = await import('./auditLogs.js');
                await createAuditLog({
                    log_name: 'security',
                    description: `Elevated administrator account provisioned: ${first_name.trim()} ${last_name.trim()} (${company_id}, ${normalizedEmail})`,
                    subject_type: 'App\\Models\\Employee',
                    subject_id: authData.user.id,
                    event: 'created',
                    causer_id: req.user?.id || authData.user.id,
                    properties: {
                        department,
                        job_title,
                        company_id,
                        notes: admin_notes
                    }
                });
            } catch (_) {}

            invalidateCache(['/api/employees', '/api/dashboard', '/api/production-groups']);

            try {
                await supabase.channel('employee-updates').send({
                    type: 'broadcast',
                    event: 'admin_provisioned',
                    payload: { id: empData.id, company_id, name: `${first_name} ${last_name}` }
                });
            } catch (_) {}

            return res.status(201).json({
                success: true,
                data: {
                    ...empData,
                    phone: sanitizedPhone,
                    temp_password: defaultPassword
                },
                message: 'Administrator account provisioned successfully.',
                temp_password: defaultPassword
            });
        } catch (dbError) {
            if (authData?.user?.id) {
                try {
                    const { error: rollbackError } = await supabase.auth.admin.deleteUser(authData.user.id);
                    if (rollbackError) console.error('[ADMIN PROVISION ROLLBACK]', { code: rollbackError.code || 'AUTH_CLEANUP_FAILED', request_id: req.reqId || null });
                } catch {
                    console.error('[ADMIN PROVISION ROLLBACK]', { code: 'AUTH_CLEANUP_FAILED', request_id: req.reqId || null });
                }
            }
            throw dbError;
        }
    } catch (error) {
        if (['email_exists', 'user_already_exists', '23505'].includes(error.code)) {
            return res.status(409).json({ success: false, code: 'ACCOUNT_CONFLICT', error: 'An account with these details already exists. Check existing accounts before retrying.' });
        }
        console.error('[ADMIN PROVISION ERROR]', { code: error.code || 'ADMIN_PROVISION_FAILED', request_id: req.reqId || null });
        res.status(500).json({ success: false, error: 'Administrator account could not be created. Please try again.' });
    }
});

// Reset or issue a new temporary password for unregistered employee
router.post('/:id/reset-temp-password', async (req, res) => {
    try {
        if (!hasVerifiedManagerRole(req.user)) {
            return res.status(403).json({ success: false, error: 'Administrative privileges required to reset temporary passwords.' });
        }
        const { id } = req.params;
        const newTempPassword = 'Emp-' + Math.floor(1000 + Math.random() * 9000);

        const { error: authError } = await supabase.auth.admin.updateUserById(id, {
            password: newTempPassword,
            user_metadata: { temp_password: newTempPassword }
        });
        if (authError) throw authError;

        const { error: empError } = await supabase
            .from('employees')
            .update({ requires_password_change: true, password_changed_at: null })
            .eq('id', id);
        if (empError) throw empError;

        invalidateCache([`/api/employees/${id}`, '/api/employees']);

        res.json({
            success: true,
            temp_password: newTempPassword,
            message: 'Temporary password generated successfully!'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        if (!hasVerifiedManagerRole(req.user)) {
            return res.status(403).json({ success: false, error: 'Administrative privileges required to edit employee records.' });
        }
        if (req.body?.role !== undefined && req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Only administrators can modify employee system roles.' });
        }
        for (const field in ASSIGNMENT_TEXT_LIMITS) {
            const value = req.body[field];
            if (value === undefined) continue;
            const normalized = typeof value === 'string' && value.length <= ASSIGNMENT_TEXT_LIMITS[field] ? value.trim() : '';
            if (!normalized || !ASSIGNMENT_TEXT_PATTERN.test(normalized)) {
                return res.status(400).json({ success: false, error: `Enter a valid ${field} using at most ${ASSIGNMENT_TEXT_LIMITS[field]} characters.` });
            }
            req.body[field] = normalized;
        }
        const {
            first_name,
            last_name,
            email,
            phone,
            role,
            department,
            job_title,
            daily_rate,
            hourly_rate,
            monthly_salary,
            piece_rate,
            shift,
            production_group_id,
            gender,
            sex,
            birth_date,
            date_hired,
            timekeeping_effective_date,
            address
        } = req.body;

        const candidateSex = sex !== undefined ? sex : gender;

        const birthCheck = birth_date !== undefined ? validateBirthDate(birth_date) : null;
        if (birthCheck && !birthCheck.isValid) return res.status(400).json({ success: false, error: birthCheck.error });

        if (date_hired !== undefined) {
            if (req.user?.employee_identity_verified !== true || !isVerifiedCreditManager(req.user)) return res.status(403).json({ success: false, error: 'Only HR or an administrator can change the date hired.' });
            const hireCheck = validateHireDate(date_hired);
            if (!hireCheck.isValid || !hireCheck.hireDate) return res.status(400).json({ success: false, error: hireCheck.error || 'Enter the date the employee started working. The saved date cannot be cleared.' });
            const { error } = await supabase.rpc('check_employee_hire_date_change', { p_employee_id: req.params.id, p_date_hired: hireCheck.hireDate });
            if (error) {
                if (isMissingCreditSchema(error)) return res.status(503).json({ code: 'HIRE_DATE_UPDATE_UNAVAILABLE', error: 'Changing the date hired is not ready yet. Ask an administrator to finish the database setup.' });
                return sendCreditError(res, error);
            }
        }

        let parsedDailyRate = daily_rate !== undefined && daily_rate !== null && !isNaN(daily_rate)
            ? parseFloat(daily_rate)
            : null;

        let parsedHourlyRate = hourly_rate !== undefined && hourly_rate !== null && !isNaN(hourly_rate)
            ? parseFloat(hourly_rate)
            : null;

        // Auto-compute between daily_rate and hourly_rate (Philippine DOLE standard 8-hour workday)
        if (parsedDailyRate && (!parsedHourlyRate || parsedHourlyRate === 0)) {
            parsedHourlyRate = parseFloat((parsedDailyRate / 8).toFixed(2));
        } else if (parsedHourlyRate && (!parsedDailyRate || parsedDailyRate === 0)) {
            parsedDailyRate = parseFloat((parsedHourlyRate * 8).toFixed(2));
        } else if (!parsedDailyRate && monthly_salary && !isNaN(monthly_salary)) {
            parsedDailyRate = parseFloat((parseFloat(monthly_salary) / 26).toFixed(2));
            parsedHourlyRate = parseFloat((parsedDailyRate / 8).toFixed(2));
        }

        const payError = getEmployeePayError({ daily_rate: parsedDailyRate, hourly_rate: parsedHourlyRate });
        if (payError) return res.status(400).json({ success: false, code: 'EMPLOYEE_PAY_OUT_OF_RANGE', error: payError });

        const updatePayload = {
            first_name,
            last_name,
            department,
            job_title
        };

        if (date_hired !== undefined) updatePayload.date_hired = date_hired;
        if (timekeeping_effective_date !== undefined) {
            if (timekeeping_effective_date === null || !String(timekeeping_effective_date).trim()) {
                updatePayload.timekeeping_effective_date = null;
            } else {
                const tkStr = String(timekeeping_effective_date).trim().slice(0, 10);
                if (/^\d{4}-\d{2}-\d{2}$/.test(tkStr) && !isNaN(Date.parse(tkStr))) {
                    updatePayload.timekeeping_effective_date = tkStr;
                }
            }
        }
        if (parsedDailyRate !== null) updatePayload.daily_rate = parsedDailyRate;
        if (email !== undefined && email !== null) {
            const normalizedEmail = String(email).trim().toLowerCase();
            if (!normalizedEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'A valid email address is required.'
                });
            }

            // 1. Check for email uniqueness across the employee directory
            const { data: existingEmp, error: checkError } = await supabase
                .from('employees')
                .select('id, first_name, last_name, company_id, status, is_active, archived_at, separation_notes')
                .ilike('email', normalizedEmail)
                .neq('id', req.params.id)
                .maybeSingle();

            if (checkError) {
                console.warn('[EMAIL_CHECK_WARN]', checkError.message);
            }

            if (existingEmp) {
                const isArchived = Boolean(existingEmp.archived_at) || existingEmp.is_active === false || existingEmp.status === 'terminated';
                if (isArchived) {
                    // Enterprise automatic email release: The administrator archived/removed the prior employee.
                    // Release the email from the cold storage record so the active employee can use it without constraint collision.
                    const [userPart, domainPart] = normalizedEmail.split('@');
                    const releasedEmail = `${userPart}+archived_${Date.now()}@${domainPart || 'cpointhris.archive'}`;
                    const releaseNote = `[Email ${normalizedEmail} reassigned to active personnel on ${new Date().toISOString().split('T')[0]}]`;

                    await supabase
                        .from('employees')
                        .update({
                            email: releasedEmail,
                            separation_notes: existingEmp.separation_notes
                                ? `${existingEmp.separation_notes} | ${releaseNote}`
                                : releaseNote,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', existingEmp.id);

                    // Reconcile Supabase Auth user if attached to archived employee
                    try {
                        await supabase.auth.admin.updateUserById(existingEmp.id, {
                            email: releasedEmail,
                            email_confirm: true
                        });
                    } catch (_) {}
                } else {
                    // Conflict with an active personnel record
                    return res.status(409).json({
                        success: false,
                        conflict: true,
                        error: `Email "${normalizedEmail}" is already registered to active personnel: ${existingEmp.first_name} ${existingEmp.last_name} (${existingEmp.company_id || 'ID ' + existingEmp.id}). Please verify the email or transfer it first.`
                    });
                }
            }

            // 2. Clear any lingering orphan auth accounts holding this email
            try {
                const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                const conflictingAuth = authList?.users?.find(u => u.email?.toLowerCase() === normalizedEmail && u.id !== req.params.id);
                if (conflictingAuth) {
                    const { data: boundActive } = await supabase
                        .from('employees')
                        .select('id, is_active, archived_at')
                        .eq('id', conflictingAuth.id)
                        .maybeSingle();

                    if (!boundActive || !boundActive.is_active || boundActive.archived_at) {
                        const [userPart, domainPart] = normalizedEmail.split('@');
                        const releasedEmail = `${userPart}+archived_${Date.now()}@${domainPart || 'cpointhris.archive'}`;
                        await supabase.auth.admin.updateUserById(conflictingAuth.id, {
                            email: releasedEmail
                        }).catch(() => {});
                    }
                }
            } catch (_) {}

            updatePayload.email = normalizedEmail;

            // 3. Synchronize new email to Supabase Auth for this employee
            try {
                await supabase.auth.admin.updateUserById(req.params.id, {
                    email: normalizedEmail,
                    email_confirm: true
                });
            } catch (authErr) {
                console.warn('[AUTH_SYNC_EMAIL_WARN]', authErr.message);
            }
        }
        if (phone !== undefined && phone !== null && phone !== '') {
            const sanitizedPhone = sanitizePhPhone(phone);
            if (!sanitizedPhone) {
                return res.status(400).json({
                    success: false,
                    error: 'A valid 10-digit Philippine mobile phone number starting with 9 is required (e.g. 917 123 4567).'
                });
            }
            updatePayload.phone = sanitizedPhone;

            // Update user in Supabase Auth
            try {
                const { data: currentAuth } = await supabase.auth.admin.getUserById(req.params.id);
                await supabase.auth.admin.updateUserById(req.params.id, {
                    phone: `+63${sanitizedPhone}`,
                    user_metadata: {
                        ...(currentAuth?.user?.user_metadata || {}),
                        phone: sanitizedPhone
                    }
                });
            } catch (authErr) {
                console.warn('[AUTH_SYNC_PHONE_WARN]', authErr.message);
            }
        }
        if (role) updatePayload.role = role;
        if (shift) updatePayload.shift = shift;
        if (production_group_id !== undefined) updatePayload.production_group_id = production_group_id;

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

        if (birth_date !== undefined) {
            updatePayload.birth_date = birthCheck.birthDate;
        }

        if (address !== undefined) {
            updatePayload.address = sanitizeAddress(address);
        }

        if (req.body.emergency_contact_name !== undefined) {
            updatePayload.emergency_contact_name = req.body.emergency_contact_name ? String(req.body.emergency_contact_name).trim().slice(0, 100) : null;
        }
        if (req.body.emergency_contact_phone !== undefined) {
            const rawEmergPhone = req.body.emergency_contact_phone;
            updatePayload.emergency_contact_phone = rawEmergPhone ? (sanitizePhPhone(rawEmergPhone) || String(rawEmergPhone).trim().slice(0, 20)) : null;
        }
        if (req.body.emergency_contact_relationship !== undefined) {
            updatePayload.emergency_contact_relationship = req.body.emergency_contact_relationship ? String(req.body.emergency_contact_relationship).trim().slice(0, 50) : null;
        }

        let { data: updatedEmployee, error } = await supabase
            .from('employees')
            .update(updatePayload)
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error && error.message?.includes('phone')) {
            const fallbackPayload = { ...updatePayload };
            delete fallbackPayload.phone;
            const retryRes = await supabase
                .from('employees')
                .update(fallbackPayload)
                .eq('id', req.params.id)
                .select('*')
                .single();
            if (retryRes.error) throw retryRes.error;
            updatedEmployee = retryRes.data;
        } else if (error) {
            throw error;
        }

        // Notify employee if compensation or shift was modified
        if (parsedDailyRate !== null || parsedHourlyRate !== null || shift) {
            const emp = updatedEmployee;

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
            } else if (parsedDailyRate !== null || parsedHourlyRate !== null || monthly_salary || piece_rate) {
                const displaySalary = parsedDailyRate !== null
                    ? `₱${(parsedDailyRate * 26).toLocaleString('en-US', { minimumFractionDigits: 2 })} (Daily: ₱${parsedDailyRate.toFixed(2)})`
                    : monthly_salary
                    ? `₱${Number(monthly_salary).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                    : `Piece Rate: ₱${piece_rate || 0}`;
                await createNotification({
                    target: req.params.id,
                    title: 'Compensation Updated',
                    text: `Your compensation schedule has been updated: ${displaySalary}.`,
                    type: 'payroll',
                    sender_id: emp?.id,
                    company_id: emp?.company_id,
                    sender_name: 'HR & Payroll',
                    sender_avatar: avatarUrl
                });
            }
        }

        invalidateCache(['/api/employees', '/api/profile', '/api/dashboard', '/api/production-groups']);
        invalidateAuthUser(req.params.id);
        if (date_hired !== undefined) refreshLeaveCredits(supabase, req.params.id);

        // Send only refresh hints; profile data is read through authenticated APIs.
        try {
            const broadcastPayload = { employee_id: req.params.id };

            const targetTopics = [
                'admin-live-employees-directory',
                `admin-live-employee-${req.params.id}`,
                `monthly-attendance-live-${req.params.id}`,
                'disciplinary_realtime_sync',
                'disciplinary-updates',
                `employee-live-dashboard-${req.params.id}`,
                `myprofile-realtime-${req.params.id}`,
                `qr-realtime-${req.params.id}`
            ];

            targetTopics.forEach(topic => {
                const channel = supabase.channel(topic);
                Promise.resolve(channel.httpSend('EMPLOYEE_UPDATED', broadcastPayload)).catch(() => {}).finally(() => supabase.removeChannel(channel)).catch(() => {});
            });
        } catch (_) {}

        if (req.body.admin_id || date_hired !== undefined) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Updated employee profile for ID ${req.params.id}`,
                subject_type: 'App\\Models\\Employee',
                subject_id: req.params.id,
                event: 'updated',
                causer_id: req.user?.id || req.body.admin_id,
                properties: updatePayload
            });
        }

        res.json({ success: true, data: updatedEmployee, message: 'Employee updated successfully.' });
    } catch (error) {
        if (error.message === 'EMPLOYEE_HIRE_DATE_REVIEW_REQUIRED' || error.message === 'INVALID_EMPLOYEE_HIRE_DATE') return sendCreditError(res, error);
        const msg = error.message || '';
        if (msg.includes('employees_email_key') || msg.includes('duplicate key') || error.code === '23505') {
            return res.status(409).json({
                success: false,
                conflict: true,
                error: 'An employee with this email address already exists. Please verify the email address.'
            });
        }
        res.status(500).json({ success: false, error: msg });
    }
});

// POST /api/employees/:id/archive - Enterprise DOLE Separation & Cold Storage Archival
router.post('/:id/archive', async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr';
        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'Administrative privileges required to separate and archive personnel.' });
        }

        const targetId = req.params.id;
        const {
            separation_type = 'Resignation',
            separation_reason = 'Voluntary Resignation',
            separation_date = getManilaWorkDate(),
            separation_notes = ''
        } = req.body;

        const admin_id = req.user.id;
        if (!isLeaveDate(separation_date) || separation_date > getManilaWorkDate()) {
            return res.status(400).json({ success: false, error: 'Record separation only on or after the effective date. Keep future-dated notices in Employment Exit.' });
        }

        const { data: targetEmp, error: fetchErr } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, email, status, role')
            .eq('id', targetId)
            .single();

        if (fetchErr || !targetEmp) {
            return res.status(404).json({ success: false, error: 'Employee record not found.' });
        }

        const nowIso = new Date().toISOString();

        // 1. Update employee operational status to terminated and seal in archive
        const { data: archivedEmp, error: updateError } = await supabase
            .from('employees')
            .update({
                status: 'terminated',
                is_active: false,
                separation_type,
                separation_reason,
                separation_date,
                archived_at: nowIso,
                archived_by: admin_id || null,
                separation_notes,
                updated_at: nowIso
            })
            .eq('id', targetId)
            .select()
            .single();

        if (updateError) throw updateError;

        // 1.5. Record official separation entry in disciplinary_logs for statutory DOLE tracking
        try {
            await supabase
                .from('disciplinary_logs')
                .insert({
                    employee_id: targetId,
                    type: 'Termination',
                    status: 'Active',
                    severity: 'Critical',
                    reason: `${separation_type}: ${separation_reason}${separation_notes ? ` - ${separation_notes}` : ''}`,
                    date: separation_date || nowIso.split('T')[0],
                    created_at: nowIso
                });
        } catch (discErr) {
            console.warn('[ARCHIVE_DISCIPLINARY_LOG_NOTICE]', discErr.message);
        }

        // 2. Real-time access revocation: invalidate Supabase Auth sessions & memory cache
        invalidateAuthUser(targetId);
        try {
            await supabase.auth.admin.signOut(targetId);
        } catch (authErr) {
            console.warn('[AUTH_SIGNOUT_NOTICE]', authErr.message);
        }

        // 3. Low-latency broadcast across gate scanner, archive vault, and directory sync channels
        try {
            const broadcastPayload = {
                employee_id: targetId,
                company_id: targetEmp.company_id,
                name: `${targetEmp.first_name} ${targetEmp.last_name}`,
                separated_at: nowIso,
                status: 'terminated',
                is_active: false,
                separation_type,
                separation_reason
            };

            const targetTopics = [
                'admin-live-employees-directory',
                'employee-presence',
                'employee-archive-sync',
                'scanner_disciplinary_realtime',
                'disciplinary_realtime_sync',
                'disciplinary-updates',
                `qr-realtime-${targetId}`,
                `dashboard-disciplinary-sync-${targetId}`
            ];

            await Promise.allSettled(
                targetTopics.flatMap(topic => {
                    const ch = supabase.channel(topic);
                    return [
                        ch.send({
                            type: 'broadcast',
                            event: 'EMPLOYEE_TERMINATED',
                            payload: broadcastPayload
                        }),
                        ch.send({
                            type: 'broadcast',
                            event: 'DISCIPLINARY_CREATED',
                            payload: {
                                ...broadcastPayload,
                                type: 'Termination',
                                status: 'Active'
                            }
                        })
                    ];
                })
            );
        } catch (broadcastErr) {
            console.warn('[REALTIME_BROADCAST_NOTICE]', broadcastErr.message);
        }

        // 4. Create immutable audit log
        if (admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Separated and archived employee ${targetEmp.first_name} ${targetEmp.last_name} (${separation_type}: ${separation_reason}). Records preserved for DOLE compliance.`,
                subject_type: 'App\\Models\\Employee',
                subject_id: targetId,
                event: 'archived',
                causer_id: admin_id,
                properties: {
                    separation_type,
                    separation_reason,
                    separation_date,
                    archived_at: nowIso
                }
            });
        }

        invalidateCache(['/api/employees', '/api/dashboard', '/api/production-groups']);

        res.json({
            success: true,
            data: archivedEmp,
            message: `Employee ${targetEmp.first_name} ${targetEmp.last_name} successfully separated and archived. Digital & biometric access revoked.`
        });
    } catch (error) {
        if (error.message?.includes('EXIT_WORKFLOW_REQUIRED')) return res.status(409).json({ success: false, error: 'This employee has an open Employment Exit receipt. Review and finalize it through Employment Exit to preserve pending reviews and withdrawal requests.' });
        if (error.message?.includes('EXIT_NOT_DUE')) return res.status(409).json({ success: false, error: 'The separation effective date has not arrived.' });
        console.error('[EMPLOYEE_ARCHIVE_ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/employees/:id/restore - Enterprise reinstatement from Pending Termination
router.post('/:id/restore', async (req, res) => {
    try {
        const isAdmin = hasVerifiedManagerRole(req.user);
        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'Administrative privileges required to reinstate employees.' });
        }

        const targetId = req.params.id;

        // Fetch current employee record to check lifecycle state
        const { data: targetEmp, error: fetchErr } = await supabase
            .from('employees')
            .select('id, first_name, last_name, status, is_active, archived_at, separation_type, separation_date, updated_at')
            .eq('id', targetId)
            .single();

        if (fetchErr || !targetEmp) {
            return res.status(404).json({ success: false, error: 'Employee record not found.' });
        }

        if (isFinalVoluntarySeparation(targetEmp)) {
            return res.status(409).json({ success: false, code: 'EXIT_REACTIVATION_REVIEW_REQUIRED',
                error: 'A finalized retirement or resignation cannot use generic reinstatement. HR must review any correction or re-employment separately.' });
        }

        const isPermanentlyArchived = getArchiveReviewDaysRemaining(targetEmp) === 0 &&
            ['inactive', 'terminated'].includes(targetEmp.status);

        // In an enterprise model, cold storage records in the Archive Vault cannot be casually restored.
        // Returning employees must undergo formal Re-hire onboarding.
        if (isPermanentlyArchived && !req.body.force_rehire) {
            return res.status(400).json({
                success: false,
                error: 'This record is outside the app archive-review window. HR must review any correction or re-employment separately.'
            });
        }

        // 1. Restore employee to active status and clear archive/separation fields
        const { data: updatedEmp, error: updateError } = await supabase
            .from('employees')
            .update({
                status: 'active',
                is_active: true,
                archived_at: null,
                archived_by: null,
                separation_reason: null,
                separation_type: null,
                separation_date: null,
                separation_notes: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', targetId)
            .select()
            .single();

        if (updateError) throw updateError;

        // 2. Resolve any associated active, pending, or under review disciplinary logs
        const todayStr = new Date().toISOString().split('T')[0];
        const { data: openLogs } = await supabase
            .from('disciplinary_logs')
            .select('id, reason, type')
            .eq('employee_id', targetId)
            .in('status', ['Active', 'Action Required', 'Pending', 'Under Review']);

        if (openLogs && openLogs.length > 0) {
            for (const log of openLogs) {
                const updatedReason = `[REINSTATED - ${todayStr}] Sanction revoked upon employee reinstatement from pending termination review.\n---\n${log.reason || ''}`;
                await supabase
                    .from('disciplinary_logs')
                    .update({ 
                        status: 'Resolved',
                        reason: updatedReason
                    })
                    .eq('id', log.id);
            }
        }

        // 3. Structured Audit Log
        if (req.user?.id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Reinstated employee ${updatedEmp.first_name} ${updatedEmp.last_name} (${updatedEmp.company_id || targetId}) to Active operational standing.`,
                subject_type: 'App\\Models\\Employee',
                subject_id: targetId,
                event: 'reinstated',
                causer_id: req.user.id,
                properties: { restored_at: new Date().toISOString() },
            }).catch(() => {});
        }

        invalidateAuthUser(targetId);

        // 4. Send Realtime broadcast to unblock Gate Scanner & update directory across all channels
        try {
            const broadcastPayload = {
                employee_id: targetId,
                company_id: updatedEmp.company_id,
                status: 'active',
                is_active: true,
                timestamp: new Date().toISOString()
            };

            const targetTopics = [
                'admin-live-employees-directory',
                'employee-presence',
                'employee-archive-sync',
                'disciplinary_realtime_sync',
                'disciplinary-updates',
                'scanner_disciplinary_realtime',
                `dashboard-disciplinary-sync-${targetId}`,
                `qr-disciplinary-sync-${targetId}`,
                `qr-realtime-${targetId}`
            ];

            targetTopics.forEach(topic => {
                try {
                    const ch = supabase.channel(topic);
                    ch.send({
                        type: 'broadcast',
                        event: 'EMPLOYEE_RESTORED',
                        payload: broadcastPayload
                    }).catch(() => {});
                    ch.send({
                        type: 'broadcast',
                        event: 'DISCIPLINARY_RESOLVED',
                        payload: broadcastPayload
                    }).catch(() => {});
                    ch.send({
                        type: 'broadcast',
                        event: 'DISCIPLINARY_STATUS_UPDATED',
                        payload: {
                            ...broadcastPayload,
                            status: 'Resolved'
                        }
                    }).catch(() => {});
                } catch (_) {}
            });
        } catch (_) {}

        invalidateCache(['/api/employees', `/api/employees/${targetId}`, '/api/dashboard', '/api/disciplinary', '/api/attendance']);

        res.json({
            success: true,
            message: `${updatedEmp.first_name} ${updatedEmp.last_name} reinstated successfully to Active standing.`,
            data: updatedEmp
        });
    } catch (error) {
        console.error('Error reinstating employee:', error);
        if (error.message?.includes('EXIT_REACTIVATION_REVIEW_REQUIRED')) {
            return res.status(409).json({ success: false, code: 'EXIT_REACTIVATION_REVIEW_REQUIRED',
                error: 'This separation was finalized. Refresh the record; HR must review any correction or re-employment separately.' });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/employees/:id/biometric-exemption - Enterprise Medical Grace / Trauma Exemption
router.patch('/:id/biometric-exemption', async (req, res) => {
    try {
        const isAdmin = hasVerifiedManagerRole(req.user);
        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized: Administrative privileges required.' });
        }

        const targetId = req.params.id;
        const { action, reason, cert_ref, valid_until, document_url } = req.body;
        if (!['enable', 'revoke'].includes(action)) return res.status(400).json({ success: false, error: 'Choose enable or revoke for Medical Grace.' });
        if (action === 'enable' && valid_until !== undefined && (!isLeaveDate(valid_until) || valid_until < getManilaWorkDate())) return res.status(400).json({ success: false, error: 'Medical Grace needs a valid current or future expiry date.' });

        const { data: emp, error: fetchErr } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, has_registered_biometrics, biometric_baseline_path, medical_record_url')
            .eq('id', targetId)
            .single();

        if (fetchErr || !emp) {
            return res.status(404).json({ success: false, error: 'Employee record not found.' });
        }

        let updatePayload = {};
        let auditAction = '';
        let auditDetails = {};
        let exemptionData = null;

        if (action === 'enable') {
            if (!hasRegisteredFace(emp)) return res.status(409).json({ success: false, error: 'Face registration is required before Medical Grace can be activated. Register the employee first.' });
            const granterName = [req.user?.first_name, req.user?.last_name].filter(Boolean).join(' ') || 
                                req.user?.name || 
                                (req.user?.email && req.user.email !== 'admin@c-point.com' ? req.user.email.split('@')[0] : 'System Administrator');
            const granterRole = req.user?.role === 'admin' ? 'HR Administrator' : (req.user?.job_title || 'HR Officer');
            const targetDate = valid_until || getManilaWorkDate(Date.now() + 14 * 86400000);

            exemptionData = {
                exempt: true,
                type: 'MEDICAL_GRACE',
                reason: reason || 'Physical facial trauma / medical dressing per physician clearance',
                cert_ref: cert_ref || 'PENDING_DOCUMENTATION',
                valid_until: targetDate,
                expires_at: targetDate,
                document_url: document_url || null,
                granted_by: granterName,
                granted_by_id: req.user?.id || 'admin',
                granted_by_role: granterRole,
                granted_at: new Date().toISOString()
            };

            updatePayload = {
                medical_record_url: JSON.stringify(exemptionData),
                updated_at: new Date().toISOString()
            };

            auditAction = 'BIOMETRIC_MEDICAL_EXEMPTION_GRANTED';
            auditDetails = exemptionData;
        } else {
            // Revoke exemption
            const hadBaseline = hasRegisteredFace(emp);
            let prevExemption = null;
            try {
                prevExemption = typeof emp.medical_record_url === 'string' ? JSON.parse(emp.medical_record_url) : emp.medical_record_url;
            } catch (_) {}

            updatePayload = {
                has_registered_biometrics: hadBaseline,
                medical_record_url: prevExemption ? JSON.stringify({ ...prevExemption, exempt: false, revoked_at: new Date().toISOString(), revoked_by: req.user?.id }) : null,
                updated_at: new Date().toISOString()
            };

            auditAction = 'BIOMETRIC_MEDICAL_EXEMPTION_REVOKED';
            auditDetails = { previous_exemption: prevExemption, restored_baseline: hadBaseline };
        }

        const { data: updatedEmp, error: updateErr } = await supabase
            .from('employees')
            .update(updatePayload)
            .eq('id', targetId)
            .select()
            .single();

        if (updateErr) throw updateErr;

        invalidateAuthUser(targetId);

        // Structured Audit Trail
        const { createAuditLog } = await import('./auditLogs.js');
        await createAuditLog({
            log_name: 'employees',
            description: `${auditAction === 'BIOMETRIC_MEDICAL_EXEMPTION_GRANTED' ? 'Activated Medical Grace Exemption (QR-Only Mode)' : 'Revoked Medical Grace Exemption (Restored Dual-Factor)'} for ${emp.first_name} ${emp.last_name} (${emp.company_id || targetId})`,
            subject_type: 'App\\Models\\Employee',
            subject_id: targetId,
            event: auditAction,
            causer_id: req.user?.id,
            properties: auditDetails
        }).catch(() => {});

        // Instant Realtime sync across channels so Kiosk, Admin, and Employee update in 0ms
        try {
            const broadcastPayload = {
                employee_id: targetId,
                company_id: emp.company_id,
                is_exempt: action === 'enable',
                exemption: action === 'enable' ? exemptionData : null,
                timestamp: new Date().toISOString()
            };

            const chScanner = supabase.channel('scanner_disciplinary_realtime');
            chScanner.send({ type: 'broadcast', event: 'BIOMETRIC_EXEMPTION_UPDATED', payload: broadcastPayload }).catch(() => {});

            const chEmp = supabase.channel(`employee-live-dashboard-${targetId}`);
            chEmp.send({ type: 'broadcast', event: 'BIOMETRIC_EXEMPTION_UPDATED', payload: broadcastPayload }).catch(() => {});

            const chProfile = supabase.channel(`myprofile-realtime-${targetId}`);
            chProfile.send({ type: 'broadcast', event: 'BIOMETRIC_EXEMPTION_UPDATED', payload: broadcastPayload }).catch(() => {});

            const chQr = supabase.channel(`qr-realtime-${targetId}`);
            chQr.send({ type: 'broadcast', event: 'BIOMETRIC_EXEMPTION_UPDATED', payload: broadcastPayload }).catch(() => {});
        } catch (_) {}

        invalidateCache([
            '/api/employees', 
            `/api/employees/${targetId}`, 
            '/api/attendance', 
            '/api/dashboard', 
            `/api/dashboard/employee/${targetId}`,
            '/api/profile'
        ]);

        res.json({
            success: true,
            message: action === 'enable' 
                ? `Medical Grace Exemption activated for ${emp.first_name} ${emp.last_name}. QR-Only kiosk verification is now active.`
                : `Medical Grace Exemption revoked. Standard dual-factor biometric verification restored.`,
            data: updatedEmp
        });
    } catch (err) {
        console.error('Error toggling biometric exemption:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/employees/:id/reset-biometrics - Wipe baseline for post-healing re-registration
router.post('/:id/reset-biometrics', async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr';
        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized: Administrative privileges required.' });
        }

        const targetId = req.params.id;
        const { data: emp, error: fetchErr } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, biometric_baseline_path')
            .eq('id', targetId)
            .single();

        if (fetchErr || !emp) {
            return res.status(404).json({ success: false, error: 'Employee not found.' });
        }

        // A folder sweep could delete a concurrent enrollment's newly uploaded image.
        const photoBucket = supabase.storage.from('public-bucket');
        const oldBaselines = emp.biometric_baseline_path ? [emp.biometric_baseline_path] : [];

        // 2. Reset biometric columns
        const { data: updatedEmp, error: updateErr } = await supabase
            .from('employees')
            .update({
                has_registered_biometrics: false,
                biometric_baseline_path: null,
                biometric_registered_at: null,
                biometric_liveness_confidence: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', targetId)
            .select()
            .single();

        if (updateErr) throw updateErr;
        invalidateAuthUser(targetId);
        let cleanupPending = false;
        try {
            if (oldBaselines.length) {
                const { error: cleanupError } = await photoBucket.remove(oldBaselines);
                if (cleanupError) throw cleanupError;
            }
        } catch (error) {
            cleanupPending = true;
            console.warn('[BIOMETRICS RESET] Image cleanup needs review:', { employee_id: targetId, code: error?.code || 'UNKNOWN' });
        }

        // 3. Log to audit trail
        const { createAuditLog } = await import('./auditLogs.js');
        await createAuditLog({
            log_name: 'employees',
            description: `Reset biometric profile for ${emp.first_name} ${emp.last_name} (${emp.company_id || targetId}). ${cleanupPending ? 'Previous baseline cleanup requires review.' : 'Previously referenced baseline removed.'}`,
            subject_type: 'App\\Models\\Employee',
            subject_id: targetId,
            event: 'BIOMETRICS_RESET',
            causer_id: req.user?.id,
            properties: { baseline_paths: oldBaselines, cleanup_pending: cleanupPending }
        }).catch(() => {});

        // Realtime broadcast to Kiosks, Admin, and Employee channels
        try {
            const broadcastPayload = {
                employee_id: targetId,
                company_id: emp.company_id,
                has_registered_biometrics: false,
                timestamp: new Date().toISOString()
            };

            const chScanner = supabase.channel('scanner_disciplinary_realtime');
            chScanner.send({ type: 'broadcast', event: 'BIOMETRICS_RESET', payload: broadcastPayload }).catch(() => {});

            const chEmp = supabase.channel(`employee-live-dashboard-${targetId}`);
            chEmp.send({ type: 'broadcast', event: 'BIOMETRICS_RESET', payload: broadcastPayload }).catch(() => {});

            const chProfile = supabase.channel(`myprofile-realtime-${targetId}`);
            chProfile.send({ type: 'broadcast', event: 'BIOMETRICS_RESET', payload: broadcastPayload }).catch(() => {});

            const chQr = supabase.channel(`qr-realtime-${targetId}`);
            chQr.send({ type: 'broadcast', event: 'BIOMETRICS_RESET', payload: broadcastPayload }).catch(() => {});
        } catch (_) {}

        invalidateCache([
            '/api/employees', 
            `/api/employees/${targetId}`, 
            '/api/attendance',
            '/api/dashboard',
            `/api/dashboard/employee/${targetId}`,
            '/api/profile'
        ]);

        res.json({
            success: true,
            message: cleanupPending ? 'Biometric profile reset. Previous baseline cleanup requires administrator review.' : 'Biometric profile reset successfully. Personnel can now perform a fresh registration in the Biometric Setup portal.',
            cleanup_pending: cleanupPending,
            data: updatedEmp
        });
    } catch (err) {
        console.error('Error resetting biometrics:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const requestId = req.reqId || randomUUID();
    let deletionCommitted = false;
    let stage = 'employee_lookup';
    try {
        if (req.user?.role !== 'admin' || !hasVerifiedManagerRole(req.user)) {
            return res.status(403).json({ success: false, error: 'Only verified administrators can delete employee accounts.' });
        }
        const empId = req.params.id;

        // 1. Fetch employee metadata prior to deletion for storage and audit cleanup
        const { data: empData, error: employeeError } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, auth_user_id, biometric_baseline_path, avatar_url')
            .eq('id', empId)
            .maybeSingle();
        if (employeeError) throw employeeError;
        if (!empData) return res.status(404).json({ success: false, error: 'Employee not found.' });

        // 2. Fetch biometric/attendance photos from attendances
        stage = 'attendance_lookup';
        const { data: attendanceLogs, error: attendanceError } = await supabase
            .from('attendances')
            .select('time_in_photo, time_out_photo')
            .eq('employee_id', empId);
        if (attendanceError) throw attendanceError;

        let photosToShred = [];
        if (attendanceLogs) {
            attendanceLogs.forEach(log => {
                if (log.time_in_photo) photosToShred.push(log.time_in_photo);
                if (log.time_out_photo) photosToShred.push(log.time_out_photo);
            });
        }

        photosToShred.push(...await listEmployeePhotoFiles(supabase.storage.from('public-bucket'), empData));

        // 3. Fetch uploaded documents from employee_documents and vault
        stage = 'document_lookup';
        const { data: docLogs, error: documentError } = await supabase
            .from('employee_documents')
            .select('file_path')
            .eq('employee_id', empId);
        if (documentError) throw documentError;

        let docsToShred = [];
        if (docLogs) {
            docLogs.forEach(doc => {
                if (doc.file_path) docsToShred.push(doc.file_path);
            });
        }

        try {
            const { data: folderFiles } = await supabase.storage.from('documents').list(empId);
            if (folderFiles && folderFiles.length > 0) {
                folderFiles.forEach(f => {
                    docsToShred.push(`${empId}/${f.name}`);
                });
            }
        } catch (_) { }

        // 4. Execute atomic PostgreSQL cascading purge via stored procedure
        stage = 'database_purge';
        const { data: cascadeResult, error: cascadeError } = await supabase.rpc('purge_employee_cascade', {
            target_emp_id: empId
        });

        if (cascadeError) throw cascadeError;
        if (cascadeResult?.success !== true) throw Object.assign(new Error('Employee deletion was not confirmed.'), { code: 'PURGE_NOT_CONFIRMED' });
        deletionCommitted = true;

        // Never remove files or accounts while a database rollback can still preserve the employee.
        let cleanupPending = false;
        let totalShredded = 0;
        stage = 'storage_cleanup';
        for (const [bucket, files] of [['public-bucket', photosToShred], ['documents', docsToShred]]) {
            const paths = [...new Set(files)];
            if (!paths.length) continue;
            try {
                const { error } = await supabase.storage.from(bucket).remove(paths);
                if (error) throw error;
                totalShredded += paths.length;
            } catch (error) {
                cleanupPending = true;
                console.warn('[EMPLOYEE PURGE] Cleanup needs review:', { requestId, stage, code: error?.code || 'UNKNOWN' });
            }
        }

        // 5. Invalidate auth user cache in authMiddleware
        invalidateAuthUser(empId);
        if (empData?.auth_user_id && empData.auth_user_id !== empId) {
            invalidateAuthUser(empData.auth_user_id);
        }

        // 6. Delete user account from Supabase Auth admin
        stage = 'auth_cleanup';
        const authUserIds = [empId];
        if (empData?.auth_user_id && empData.auth_user_id !== empId) {
            authUserIds.push(empData.auth_user_id);
        }

        for (const authId of authUserIds) {
            try {
                const { error: authError } = await supabase.auth.admin.deleteUser(authId);
                if (authError && authError.code !== 'user_not_found' && !authError.message?.includes('User not found')) {
                    cleanupPending = true;
                    console.warn('[EMPLOYEE PURGE] Cleanup needs review:', { requestId, stage, code: authError.code || 'UNKNOWN' });
                }
            } catch (err) {
                cleanupPending = true;
                console.warn('[EMPLOYEE PURGE] Cleanup needs review:', { requestId, stage, code: err?.code || 'UNKNOWN' });
            }
        }

        // 7. Record enterprise audit log if admin_id is provided
        if (req.body?.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'employees',
                description: `Forensically purged employee record ${empData?.first_name || ''} ${empData?.last_name || ''} (ID: ${empId}). Shredded ${totalShredded} associated biometric/document files.`,
                subject_type: 'App\\Models\\Employee',
                subject_id: empId,
                event: 'deleted',
                causer_id: req.user.id,
                properties: {
                    files_shredded: totalShredded,
                    company_id: empData?.company_id,
                    cascade_result: cascadeResult
                }
            }).catch(() => { });
        }

        // 8. Real-time broadcast to all connected administrative dashboards
        try {
            await supabase.channel('employee-updates').send({
                type: 'broadcast',
                event: 'employee_purged',
                payload: {
                    id: empId,
                    company_id: empData?.company_id,
                    purged_at: new Date().toISOString()
                }
            });
        } catch (_) { }

        // 9. Invalidate server-side cached queries
        invalidateCache(['/api/employees', '/api/dashboard', '/api/production-groups', '/api/documents/admin-overview']);

        return res.json({
            success: true,
            cleanup_pending: cleanupPending,
            message: cleanupPending ? 'Employee deleted. Some file or account cleanup needs administrator review.' : 'Employee account and associated records deleted.',
            details: {
                employee_id: empId,
                files_shredded: totalShredded,
                cascade_result: cascadeResult
            }
        });
    } catch (error) {
        const constraint = typeof error?.message === 'string' ? error.message.match(/constraint "([a-zA-Z0-9_]+)"/)?.[1] : undefined;
        console.error('[EMPLOYEE PURGE] Deletion could not complete:', { requestId, stage, code: error?.code || 'UNKNOWN', constraint });
        if (deletionCommitted) return res.json({ success: true, cleanup_pending: true, message: 'Employee deleted. Remaining account cleanup needs administrator review.' });
        if (['23503', '23502', 'P0001'].includes(error?.code)) {
            const offlineHistory = constraint?.startsWith('offline_attendance_');
            return res.status(409).json({ success: false, code: 'EMPLOYEE_HISTORY_PROTECTED', error: offlineHistory
                ? 'This employee has protected offline attendance records. Archive the employee instead to preserve the history.'
                : 'This employee has linked records that must be kept. Archive the employee instead of permanently deleting them.' });
        }
        return res.status(error?.code ? 503 : 500).json({ success: false, code: 'EMPLOYEE_DELETE_UNAVAILABLE', error: 'Employee deletion could not be verified. No file or account cleanup was started. Please contact your administrator.' });
    }
});

export default router;
