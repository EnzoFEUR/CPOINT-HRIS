import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

// Dispatch official formal written disciplinary memo via Brevo REST API v3
async function dispatchDisciplinaryEmail(employee, { type, severity, reason, date, duration_days, end_date }) {
    if (!process.env.BREVO_API_KEY || !employee.email) return;

    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'marikinahris2026@gmail.com';
    const senderName = process.env.BREVO_SENDER_NAME || 'C-Point HRIS Security';
    const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Employee';

    let badgeColor = '#3B82F6';
    let badgeText = 'Formal Written Warning';
    let extraRows = '';

    if (type === 'Suspension') {
        badgeColor = '#EA580C';
        badgeText = `Notice of Account Suspension (${duration_days || 3} Days)`;
        extraRows = `
            <tr>
                <td class="meta-label">Suspension Duration</td>
                <td class="meta-val" style="color: #EA580C; font-weight: bold;">${duration_days || 3} Days (Until ${end_date || 'N/A'})</td>
            </tr>
            <tr>
                <td class="meta-label">Portal Access</td>
                <td class="meta-val" style="color: #DC2626; font-weight: bold;">Temporarily Locked</td>
            </tr>
        `;
    } else if (type === 'Termination') {
        badgeColor = '#DC2626';
        badgeText = 'Notice of Employment Termination';
        extraRows = `
            <tr>
                <td class="meta-label">Effective Date</td>
                <td class="meta-val" style="color: #DC2626; font-weight: bold;">Effective Immediately (${date})</td>
            </tr>
            <tr>
                <td class="meta-label">Account Status</td>
                <td class="meta-val" style="color: #DC2626; font-weight: bold;">Access Revoked (Records Preserved)</td>
            </tr>
        `;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Disciplinary Notice - C-Point HRIS</title>
        <style>
            body { margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1E293B; }
            .wrapper { padding: 40px 16px; }
            .card { max-width: 520px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background: #0F172A; padding: 28px 24px; text-align: center; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
            .badge-bar { background: ${badgeColor}; color: #FFFFFF; text-align: center; padding: 8px 16px; font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
            .content { padding: 32px 28px; }
            .title { font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 8px; }
            .meta-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #F8FAFC; border-radius: 10px; overflow: hidden; border: 1px solid #E2E8F0; }
            .meta-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #E2E8F0; }
            .meta-label { font-weight: 600; color: #64748B; width: 38%; }
            .meta-val { font-weight: 600; color: #0F172A; }
            .desc-box { background: #FEF2F2; border: 1px solid #FEE2E2; border-radius: 10px; padding: 14px 16px; margin: 20px 0; }
            .desc-box p { margin: 0; font-size: 13px; line-height: 1.6; color: #991B1B; }
            .legal-notice { font-size: 11.5px; line-height: 1.6; color: #64748B; margin: 24px 0 0; padding-top: 16px; border-top: 1px dashed #CBD5E1; }
            .footer { background: #F1F5F9; padding: 16px 24px; text-align: center; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="card">
                <div class="header">
                    <h1>C-POINT HRIS COMPLIANCE</h1>
                </div>
                <div class="badge-bar">${badgeText}</div>
                <div class="content">
                    <p class="title">${type === 'Warning' ? 'Disciplinary Warning Notice' : (type === 'Suspension' ? `Account Suspension Notice (${duration_days} Days)` : 'Employment Termination Notice')}</p>
                    <p style="font-size: 14px; color: #475569; margin: 0 0 16px;">This official communication has been served to your personnel profile.</p>
                    
                    <table class="meta-table">
                        <tr>
                            <td class="meta-label">Personnel</td>
                            <td class="meta-val">${fullName} (${employee.company_id || 'ID N/A'})</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Date Issued</td>
                            <td class="meta-val">${date}</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Action Category</td>
                            <td class="meta-val">${type}</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Severity Level</td>
                            <td class="meta-val" style="color: ${badgeColor};">${severity}</td>
                        </tr>
                        ${extraRows}
                    </table>

                    <div class="desc-box">
                        <strong style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Grounds & Official HR Statement</strong>
                        <p>${reason}</p>
                    </div>

                    <p class="legal-notice">
                        <strong>DOLE Procedural Compliance Notice:</strong> In accordance with Philippine Labor Standards (DOLE Department Order 147-15), you have the right to consult your HR representative. All historical employment files, statutory contributions, and tax records are permanently preserved.
                    </p>
                </div>
                <div class="footer">
                    <p style="margin: 0;">C-Point Enterprise HRIS • Compliance & Governance Subsystem</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: senderName, email: senderEmail },
                to: [{ email: employee.email.trim().toLowerCase(), name: fullName }],
                subject: `Official Notice: ${type} - C-Point HRIS Compliance`,
                htmlContent: htmlContent,
                textContent: `Official Notice: ${type} has been issued on ${date}. Reason: ${reason}. Please contact HR Management.`
            })
        });
        console.log(`[DISCIPLINARY_EMAIL_SENT] Official ${type} memo sent to ${employee.email}`);
    } catch (err) {
        console.warn(`[DISCIPLINARY_EMAIL_FAIL] Could not send email:`, err.message);
    }
}

// Dispatch formal clearance memo via Brevo REST API v3
async function dispatchClearanceEmail(employee, { exoneration_reason, investigation_notes, original_type, date }) {
    if (!process.env.BREVO_API_KEY || !employee.email) return;

    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'marikinahris2026@gmail.com';
    const senderName = process.env.BREVO_SENDER_NAME || 'C-Point HRIS Compliance';
    const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Employee';
    const reasonText = exoneration_reason || 'Record reviewed and cleared';

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Disciplinary Record Cleared - C-Point HRIS</title>
        <style>
            body { margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1E293B; }
            .wrapper { padding: 40px 16px; }
            .card { max-width: 540px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
            .header { background: #047857; padding: 28px 24px; text-align: center; }
            .header h1 { color: #FFFFFF; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; }
            .badge-bar { background: #059669; color: #FFFFFF; text-align: center; padding: 8px 16px; font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
            .content { padding: 32px 28px; }
            .title { font-size: 19px; font-weight: 800; color: #065F46; margin: 0 0 8px; }
            .meta-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #F0FDF4; border-radius: 10px; overflow: hidden; border: 1px solid #BBF7D0; }
            .meta-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #DCFCE7; }
            .meta-label { font-weight: 600; color: #047857; width: 38%; }
            .meta-val { font-weight: 700; color: #064E3B; }
            .desc-box { background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 10px; padding: 16px; margin: 20px 0; }
            .desc-box p { margin: 0; font-size: 13px; line-height: 1.6; color: #065F46; }
            .legal-notice { font-size: 11.5px; line-height: 1.6; color: #64748B; margin: 24px 0 0; padding-top: 16px; border-top: 1px dashed #CBD5E1; }
            .footer { background: #F1F5F9; padding: 16px 24px; text-align: center; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="card">
                <div class="header">
                    <h1>C-POINT HRIS COMPLIANCE</h1>
                </div>
                <div class="badge-bar">NOTICE OF RECORD CLEARANCE</div>
                <div class="content">
                    <p class="title">Disciplinary Record Cleared</p>
                    <p style="font-size: 14px; color: #475569; margin: 0 0 16px;">This official communication confirms that upon review, the disciplinary record previously recorded has been cleared.</p>
                    
                    <table class="meta-table">
                        <tr>
                            <td class="meta-label">Personnel</td>
                            <td class="meta-val">${fullName} (${employee.company_id || 'ID N/A'})</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Action Cleared</td>
                            <td class="meta-val">${original_type || 'Disciplinary Action'}</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Effective Date</td>
                            <td class="meta-val">${date}</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Account Status</td>
                            <td class="meta-val" style="color: #059669;">Active & In Good Standing</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Facility Access</td>
                            <td class="meta-val" style="color: #059669;">Biometric & Scanner Access Restored</td>
                        </tr>
                    </table>

                    <div class="desc-box">
                        <strong style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px; color: #047857;">Reason for Clearance</strong>
                        <p>${reasonText}</p>
                        ${investigation_notes ? `<p style="margin-top: 8px; font-size: 12px; color: #047857;"><strong>Notes:</strong> ${investigation_notes}</p>` : ''}
                    </div>

                    <p class="legal-notice">
                        In accordance with company policy and fair labor standards, this record has been cleared to preserve your personnel standing. Your file and statutory benefits are in active, good standing.
                    </p>
                </div>
                <div class="footer">
                    <p style="margin: 0;">C-Point Enterprise HRIS • Compliance</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: senderName, email: senderEmail },
                to: [{ email: employee.email.trim().toLowerCase(), name: fullName }],
                subject: `Notice: Disciplinary Record Cleared - C-Point HRIS`,
                htmlContent: htmlContent,
                textContent: `Notice: Your disciplinary notice (${original_type}) has been cleared on ${date}. Reason: ${reasonText}. Account and facility access are restored.`
            })
        });
    } catch (err) {
        console.warn(`[CLEARANCE_EMAIL_FAIL] Could not send clearance email:`, err.message);
    }
}
const dispatchExonerationEmail = dispatchClearanceEmail;

// GET /api/disciplinary - Fetch disciplinary logs with employee metadata
router.get('/', cacheResponse(15), async (req, res) => {
    try {
        let query = supabase
            .from('disciplinary_logs')
            .select('*, employees:employee_id(id, company_id, first_name, last_name, department, email, status, is_active, biometric_baseline_path, job_title, date_hired, shift)')
            .order('created_at', { ascending: false });

        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin) {
            query = query.eq('employee_id', req.user.id);
        } else if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }

        if (req.query.status && req.query.status !== 'All') {
            query = query.eq('status', req.query.status);
        }
        if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
        }

        const { data: records, error } = await query;
        if (error) throw error;
        
        const enrichedRecords = (records || []).map(record => {
            const emp = record.employees;
            const photoPath = emp?.biometric_baseline_path || (emp?.company_id && emp?.id ? `face-baselines/${emp.company_id}/${emp.id}.jpg` : null);
            const avatarUrl = photoPath ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${photoPath.replace(/^\/+/, '')}` : null;
            return {
                ...record,
                employee_name: emp ? `${emp.first_name} ${emp.last_name}`.trim() : 'Employee',
                first_name: emp?.first_name || '',
                last_name: emp?.last_name || '',
                department: emp?.department || 'Operations',
                company_id: emp?.company_id || null,
                employee_email: emp?.email || null,
                employee_status: emp?.status || 'active',
                employee_is_active: emp?.is_active ?? true,
                employee_id: emp?.id || record.employee_id,
                avatar_url: avatarUrl,
                photo_url: avatarUrl,
                biometric_baseline_path: emp?.biometric_baseline_path || null,
                job_title: emp?.job_title || 'Staff',
                date_hired: emp?.date_hired || null,
                shift: emp?.shift || 'Regular Shift'
            };
        });

        res.json(enrichedRecords);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/disciplinary - Issue Warning, Suspension (3-7 days), or Termination
router.post('/', async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required to issue disciplinary actions.' });
        }

        const { employee_id, type, reason, severity, duration_days } = req.body;
        
        if (!employee_id || !type || !reason) {
            return res.status(400).json({ error: 'Employee, type, and detailed reason are required.' });
        }

        // Standardize types Warning, Suspension, Termination
        const validTypes = ['Warning', 'Suspension', 'Termination'];
        const resolvedType = validTypes.find(t => t.toLowerCase() === type.toLowerCase()) || 'Warning';

        const todayStr = new Date().toISOString().split('T')[0];
        let formattedReason = reason.trim();
        let resolvedSeverity = severity || 'Low';
        let durationDays = 0;
        let endDateStr = null;

        // 1. Logic for Warning Account remains active
        // 1. Logic for Warning Account remains active
        if (resolvedType === 'Warning') {
            resolvedSeverity = severity || 'Low';
        } 
        // 2. Logic for Suspension - Temporarily locked out (Mananatili sa Personnel Directory as Suspended)
        else if (resolvedType === 'Suspension') {
            durationDays = Math.max(1, Math.min(60, parseInt(duration_days, 10) || 3));
            const endObj = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
            endDateStr = endObj.toISOString().split('T')[0];

            formattedReason = `[SUSPENDED ${durationDays} DAYS - Until ${endDateStr}] ${formattedReason}`;
            resolvedSeverity = severity || 'High';

            await supabase
                .from('employees')
                .update({ status: 'suspended', is_active: false })
                .eq('id', employee_id);
        } 
        // Archive terminated employee record
        else if (resolvedType === 'Termination') {
            formattedReason = `[TERMINATED Effective ${todayStr}] ${formattedReason}`;
            resolvedSeverity = 'Critical';

            const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
            const validArchivedBy = isUUID(req.user?.id) ? req.user.id : null;

            const terminationPayload = {
                status: 'inactive',
                is_active: false,
                archived_at: new Date().toISOString(),
                separation_type: 'Disciplinary Termination',
                separation_reason: reason.trim(),
                separation_date: todayStr,
                archived_by: validArchivedBy,
                separation_notes: `Terminated via Disciplinary Action: ${reason.trim()}`,
                updated_at: new Date().toISOString()
            };

            // Update employee record to inactive/archived with full separation details
            await supabase
                .from('employees')
                .update(terminationPayload)
                .eq('id', employee_id);
        }
        
        const { data: newRecord, error } = await supabase
            .from('disciplinary_logs')
            .insert({
                employee_id,
                type: resolvedType,
                reason: formattedReason,
                severity: resolvedSeverity,
                status: 'Active',
                date: todayStr
            })
            .select()
            .single();

        if (error) throw error;

        // Fetch employee bio for proper dispatching
        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, email, department')
            .eq('id', employee_id)
            .maybeSingle();

        const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Personnel';

        // Notification copy based on action
        let notifTitle = `Formal Notice Written Warning`;
        let notifText = `HR Compliance has issued a ${resolvedSeverity} severity warning notice: ${reason}. Please review and acknowledge in your dashboard.`;

        if (resolvedType === 'Suspension') {
            notifTitle = `Account Suspended ${durationDays} Days`;
            notifText = `Your HRIS access has been temporarily suspended until ${endDateStr} (${durationDays} days). Reason: ${reason}. Contact HR for inquiries.`;
        } else if (resolvedType === 'Termination') {
            notifTitle = `Notice of Employment Termination`;
            notifText = `Your employment is terminated effective ${todayStr}. Access has been revoked. Contact HR for final clearance and processing.`;
        }

        // In-app notification
        await createNotification({
            target: employee_id,
            title: notifTitle,
            text: notifText,
            type: 'disciplinary',
            sender_id: req.user.id || null,
            company_id: emp?.company_id,
            sender_name: 'HR & Compliance Management',
            sender_avatar: null
        });

        // Official written email memo via Brevo
        if (emp?.email) {
            dispatchDisciplinaryEmail(emp, { 
                type: resolvedType, 
                severity: resolvedSeverity, 
                reason: formattedReason, 
                date: todayStr,
                duration_days: durationDays,
                end_date: endDateStr
            });
        }

        // Structured Audit Log
        import('../auditLogs.js').then(({ createAuditLog }) => {
            createAuditLog({
                log_name: 'disciplinary',
                description: `Issued ${resolvedType} (${resolvedSeverity}) to ${empName} (${emp?.company_id || employee_id})`,
                subject_type: 'App\\Models\\Disciplinary',
                subject_id: employee_id,
                event: 'created',
                causer_id: req.user.id || 'admin',
                properties: { type: resolvedType, severity: resolvedSeverity, reason: formattedReason, date: todayStr }
            }).catch(() => {});
        }).catch(() => {});

        invalidateCache(['/api/disciplinary', '/api/dashboard', '/api/employees']);

        res.json({ 
            success: true, 
            message: `${resolvedType} action successfully recorded and applied to personnel account.`, 
            data: newRecord 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update disciplinary status and handle employee reinstatement
router.put('/:id/status', async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required.' });
        }

        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required.' });
        }

        const validStatuses = ['Active', 'Acknowledged', 'Under Review', 'Resolved', 'Overturned'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
        }

        const { data: record, error } = await supabase
            .from('disciplinary_logs')
            .update({ status })
            .eq('id', req.params.id)
            .select('*')
            .single();

        if (error) throw error;

        let updatedEmployee = null;

        // Reinstate employee if resolving or overturning a suspension or termination
        if ((status === 'Resolved' || status === 'Overturned') && record.employee_id) {
            const infractionType = String(record.type || '').toLowerCase();

            if (infractionType === 'suspension' || infractionType === 'termination') {
                const { data: empData, error: empErr } = await supabase
                    .from('employees')
                    .update({
                        status: 'active',
                        is_active: true,
                        archived_at: null,
                        separation_reason: null,
                        separation_type: null,
                        separation_date: null,
                        separation_notes: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', record.employee_id)
                    .select('id, company_id, first_name, last_name, email, status, is_active, department, job_title, shift, biometric_baseline_path')
                    .single();

                if (!empErr && empData) {
                    updatedEmployee = empData;
                }

                if (infractionType === 'suspension') {
                    await supabase
                        .from('disciplinary_logs')
                        .update({ status: 'Resolved' })
                        .eq('employee_id', record.employee_id)
                        .eq('type', 'Suspension')
                        .neq('id', req.params.id);
                }
            }
        }

        if (!updatedEmployee && record.employee_id) {
            const { data: empData } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name, email, status, is_active, department, job_title, shift, biometric_baseline_path')
                .eq('id', record.employee_id)
                .maybeSingle();
            updatedEmployee = empData;
        }

        await createNotification({
            target: record.employee_id,
            title: 'Disciplinary Status Updated',
            text: `Your disciplinary notice (${record.type}) status has been updated to: ${status}`,
            type: 'disciplinary',
            sender_name: 'HR & Compliance Management'
        });

        try {
            const channel = supabase.channel('disciplinary-updates');
            await channel.send({
                type: 'broadcast',
                event: 'DISCIPLINARY_STATUS_UPDATED',
                payload: {
                    id: record.id,
                    employee_id: record.employee_id,
                    status,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (_) {}

        invalidateCache([
            '/api/disciplinary',
            '/api/dashboard',
            '/api/employees',
            `/api/employees/${record.employee_id}`,
            '/api/profile'
        ]);

        const enrichedRecord = {
            ...record,
            employees: updatedEmployee || null,
            employee_name: updatedEmployee ? `${updatedEmployee.first_name || ''} ${updatedEmployee.last_name || ''}`.trim() : 'Employee',
            employee_status: updatedEmployee?.status || 'active',
            employee_is_active: updatedEmployee?.is_active ?? true
        };

        res.json({ success: true, data: enrichedRecord });

    } catch (err) {
        console.error('Error updating status:', err);
        res.status(500).json({ error: err.message });
    }
});

// Resolve and reinstate employee
router.put('/:id/resolve', async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required.' });
        }

        const { data: record, error } = await supabase
            .from('disciplinary_logs')
            .update({ status: 'Resolved' })
            .eq('id', req.params.id)
            .select('*')
            .single();
            
        if (error) throw error;

        let updatedEmployee = null;

        if (record.employee_id) {
            const infractionType = String(record.type || '').toLowerCase();
            if (infractionType === 'suspension' || infractionType === 'termination') {
                const { data: empData } = await supabase
                    .from('employees')
                    .update({
                        status: 'active',
                        is_active: true,
                        archived_at: null,
                        separation_reason: null,
                        separation_type: null,
                        separation_date: null,
                        separation_notes: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', record.employee_id)
                    .select('id, company_id, first_name, last_name, email, status, is_active')
                    .single();

                updatedEmployee = empData;

                if (infractionType === 'suspension') {
                    await supabase
                        .from('disciplinary_logs')
                        .update({ status: 'Resolved' })
                        .eq('employee_id', record.employee_id)
                        .eq('type', 'Suspension')
                        .neq('id', req.params.id);
                }

                await createNotification({
                    target: record.employee_id,
                    title: infractionType === 'termination' ? 'Employment Restored' : 'Suspension Lifted',
                    text: `HR Compliance has officially resolved your disciplinary file. Your portal and facility access are fully restored.`,
                    type: 'disciplinary',
                    sender_name: 'HR & Compliance Management'
                });
            } else {
                await createNotification({
                    target: record.employee_id,
                    title: 'Disciplinary Case Resolved',
                    text: `Your ${record.type} notice issued on ${record.date} has been officially marked as Resolved by HR.`,
                    type: 'disciplinary',
                    sender_name: 'HR & Compliance Management'
                });
            }
        }

        if (!updatedEmployee && record.employee_id) {
            const { data: empData } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name, email, status, is_active')
                .eq('id', record.employee_id)
                .maybeSingle();
            updatedEmployee = empData;
        }

        try {
            const channel = supabase.channel('disciplinary-updates');
            await channel.send({
                type: 'broadcast',
                event: 'DISCIPLINARY_RESOLVED',
                payload: {
                    id: record.id,
                    employee_id: record.employee_id,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (_) {}

        invalidateCache([
            '/api/disciplinary',
            '/api/dashboard',
            '/api/employees',
            `/api/employees/${record.employee_id}`,
            '/api/profile'
        ]);

        const enrichedRecord = {
            ...record,
            employees: updatedEmployee || null,
            employee_name: updatedEmployee ? `${updatedEmployee.first_name || ''} ${updatedEmployee.last_name || ''}`.trim() : 'Employee',
            employee_status: updatedEmployee?.status || 'active',
            employee_is_active: updatedEmployee?.is_active ?? true
        };

        res.json({ success: true, message: 'Record marked as resolved and account reinstated.', data: enrichedRecord });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/disciplinary/:id/overturn - Clear disciplinary record & restore employee standing
router.put('/:id/overturn', async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required to clear disciplinary records.' });
        }

        const rawReason = req.body.clearing_reason || req.body.exoneration_reason || req.body.reason;
        const clearingReason = (rawReason || '').trim();
        const investigationNotes = (req.body.investigation_notes || '').trim();

        if (!clearingReason) {
            return res.status(400).json({ error: 'A reason is required to clear this record.' });
        }

        const todayStr = new Date().toISOString().split('T')[0];

        // Fetch existing disciplinary record and employee
        const { data: existing, error: fetchErr } = await supabase
            .from('disciplinary_logs')
            .select('*, employees:employee_id(*)')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !existing) {
            return res.status(404).json({ error: 'Disciplinary log record not found.' });
        }

        const employee = existing.employees;
        const employeeId = existing.employee_id;
        const originalType = existing.type;
        const originalReason = existing.reason;

        // Structured clearance note
        const clearanceHeader = `[CLEARED | ${todayStr}] Reason: ${clearingReason}`;
        const updatedReason = `${clearanceHeader}\n${investigationNotes ? `Notes: ${investigationNotes}\n` : ''}---\nOriginal Record: ${originalReason}`;

        // 1. Update disciplinary log to Overturned (Cleared)
        const { data: updatedRecord, error: updateErr } = await supabase
            .from('disciplinary_logs')
            .update({
                status: 'Overturned',
                reason: updatedReason
            })
            .eq('id', req.params.id)
            .select('*, employees:employee_id(id, company_id, first_name, last_name, email, department, status, is_active)')
            .single();

        if (updateErr) throw updateErr;

        // 2. If employee was Suspended or Terminated, or is inactive, reinstate immediately
        if (employeeId) {
            await supabase
                .from('employees')
                .update({
                    status: 'active',
                    is_active: true,
                    archived_at: null,
                    separation_reason: null,
                    separation_type: null,
                    separation_date: null,
                    separation_notes: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', employeeId);

            if (originalType === 'Suspension') {
                await supabase
                    .from('disciplinary_logs')
                    .update({ status: 'Resolved' })
                    .eq('employee_id', employeeId)
                    .eq('type', 'Suspension')
                    .neq('id', req.params.id);
            }
        }

        // 3. Send official in-app notification to employee
        const empName = employee ? `${employee.first_name} ${employee.last_name}` : 'Employee';
        await createNotification({
            target: employeeId,
            title: 'Disciplinary Record Cleared',
            text: `HR has cleared the ${originalType} notice on your record. Your standing is active and facility access is restored.`,
            type: 'disciplinary',
            sender_name: 'HR & Compliance Management',
            company_id: employee?.company_id
        });

        // 4. Send formal written clearance memo via Brevo
        if (employee?.email) {
            dispatchClearanceEmail(employee, {
                exoneration_reason: clearingReason,
                investigation_notes: investigationNotes || null,
                original_type: originalType,
                date: todayStr
            });
        }

        // 5. Audit Log
        import('../auditLogs.js').then(({ createAuditLog }) => {
            createAuditLog({
                log_name: 'disciplinary',
                description: `Cleared ${originalType} for ${empName} (${employee?.company_id || employeeId})`,
                subject_type: 'App\\Models\\Disciplinary',
                subject_id: employeeId,
                event: 'cleared',
                causer_id: req.user.id || 'admin',
                properties: {
                    record_id: req.params.id,
                    type: originalType,
                    clearing_reason: clearingReason,
                    investigation_notes: investigationNotes || null,
                    date: todayStr
                }
            }).catch(() => {});
        }).catch(() => {});

        // 6. Broadcast Realtime event
        try {
            const channel = supabase.channel('disciplinary-updates');
            await channel.send({
                type: 'broadcast',
                event: 'DISCIPLINARY_OVERTURNED',
                payload: {
                    record_id: req.params.id,
                    employee_id: employeeId,
                    company_id: employee?.company_id,
                    status: 'Overturned',
                    timestamp: new Date().toISOString()
                }
            });
        } catch (bErr) {
            console.warn('[REALTIME_BROADCAST_FAILED]', bErr.message);
        }

        invalidateCache([
            '/api/disciplinary',
            '/api/dashboard',
            '/api/employees',
            `/api/employees/${employeeId}`,
            '/api/attendance',
            '/api/profile'
        ]);

        res.json({
            success: true,
            message: `Disciplinary record cleared. ${empName} has been restored to active standing.`,
            data: updatedRecord
        });
    } catch (err) {
        console.error('Error overturning disciplinary action:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/disciplinary/:id/acknowledge - Employee acknowledges receipt of notice
router.put('/:id/acknowledge', async (req, res) => {
    try {
        // Fetch record first to check existence and ownership
        const { data: existing, error: fetchErr } = await supabase
            .from('disciplinary_logs')
            .select('*, employees:employee_id(id, company_id, first_name, last_name)')
            .eq('id', req.params.id)
            .maybeSingle();

        if (fetchErr || !existing) {
            return res.status(404).json({ error: 'Disciplinary record not found.' });
        }

        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin && existing.employee_id !== req.user.id) {
            return res.status(403).json({ error: 'You are only authorized to acknowledge your own disciplinary notices.' });
        }

        const { data: record, error } = await supabase
            .from('disciplinary_logs')
            .update({ status: 'Acknowledged' })
            .eq('id', req.params.id)
            .select('*, employees:employee_id(id, company_id, first_name, last_name)')
            .single();
            
        if (error) throw error;

        // Notify HR/Admin that employee acknowledged receipt
        const emp = record.employees;
        const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
        const companyId = emp?.company_id ? `(${emp.company_id})` : '';

        await createNotification({
            target: 'admin',
            title: 'Disciplinary Memo Acknowledged',
            text: `${empName} ${companyId} has officially acknowledged receipt of the ${record.type || 'disciplinary'} notice issued on ${record.date}.`,
            type: 'disciplinary',
            sender_id: record.employee_id,
            sender_name: empName,
            company_id: emp?.company_id
        });

        invalidateCache(['/api/disciplinary', '/api/dashboard']);
        res.json({ success: true, message: 'Disciplinary notice acknowledged.', data: record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/disciplinary/:id - Permanently remove disciplinary log (Admin only)
router.delete('/:id', async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr' || req.user.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required to delete disciplinary records.' });
        }

        const { data: record, error: fetchErr } = await supabase
            .from('disciplinary_logs')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !record) {
            return res.status(404).json({ error: 'Disciplinary log not found.' });
        }

        // If the record being deleted was an active suspension or termination, reinstate employee
        if (record.status === 'Active' && (record.type === 'Suspension' || record.type === 'Termination')) {
            await supabase
                .from('employees')
                .update({
                    status: 'active',
                    is_active: true,
                    archived_at: null,
                    separation_reason: null,
                    separation_type: null,
                    separation_date: null,
                    separation_notes: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', record.employee_id);
        }

        const { error: delErr } = await supabase
            .from('disciplinary_logs')
            .delete()
            .eq('id', req.params.id);

        if (delErr) throw delErr;

        // Broadcast realtime
        try {
            const channel = supabase.channel('disciplinary-updates');
            await channel.send({
                type: 'broadcast',
                event: 'DISCIPLINARY_DELETED',
                payload: {
                    id: req.params.id,
                    employee_id: record.employee_id,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (_) {}

        invalidateCache(['/api/disciplinary', '/api/dashboard', '/api/employees']);

        res.json({ success: true, message: 'Disciplinary record permanently deleted.' });
    } catch (err) {
        console.error('Error deleting disciplinary record:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;