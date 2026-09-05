import express from 'express';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

/**
 * Dispatch official formal written disciplinary memo via Brevo REST API v3
 */
async function dispatchDisciplinaryEmail(employee, { type, severity, reason, date, duration_days, end_date }) {
    if (!process.env.BREVO_API_KEY || !employee?.email) return;

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
                <td class="meta-label">Suspension Duration:</td>
                <td class="meta-val" style="color: #EA580C; font-weight: bold;">${duration_days || 3} Days (Until ${end_date || 'N/A'})</td>
            </tr>
            <tr>
                <td class="meta-label">Portal Access:</td>
                <td class="meta-val" style="color: #DC2626; font-weight: bold;">Temporarily Locked</td>
            </tr>
        `;
    } else if (type === 'Termination') {
        badgeColor = '#DC2626';
        badgeText = 'Notice of Employment Termination';
        extraRows = `
            <tr>
                <td class="meta-label">Effective Date:</td>
                <td class="meta-val" style="color: #DC2626; font-weight: bold;">Effective Immediately (${date})</td>
            </tr>
            <tr>
                <td class="meta-label">Account Status:</td>
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
                            <td class="meta-label">Personnel:</td>
                            <td class="meta-val">${fullName} (${employee.company_id || 'ID N/A'})</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Date Issued:</td>
                            <td class="meta-val">${date}</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Action / Category:</td>
                            <td class="meta-val">${type}</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Severity Level:</td>
                            <td class="meta-val" style="color: ${badgeColor};">${severity}</td>
                        </tr>
                        ${extraRows}
                    </table>

                    <div class="desc-box">
                        <strong style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 6px;">Grounds / Official HR Statement:</strong>
                        <p>${reason}</p>
                    </div>

                    <p class="legal-notice">
                        <strong>DOLE Procedural Compliance Notice:</strong> In accordance with Philippine Labor Standards (DOLE Department Order 147-15), you have the right to consult your HR representative. All historical employment files, statutory contributions, and tax records are permanently preserved.
                    </p>
                </div>
                <div class="footer">
                    <p style="margin:0;">C-Point Enterprise HRIS • Compliance & Governance Subsystem</p>
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

// GET /api/disciplinary - Fetch disciplinary logs with employee metadata
router.get('/', cacheResponse(15), async (req, res) => {
    try {
        let query = supabase
            .from('disciplinary_logs')
            .select('*, employees:employee_id(id, company_id, first_name, last_name, department, email, status, is_active)')
            .order('created_at', { ascending: false });

        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr' || req.user?.role === 'superadmin';
        if (!isAdmin) {
            query = query.eq('employee_id', req.user?.id);
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
        
        const enrichedRecords = (records || []).map(record => ({
            ...record,
            employee_name: record.employees ? `${record.employees.first_name} ${record.employees.last_name}` : 'Employee',
            department: record.employees?.department || 'Operations',
            company_id: record.employees?.company_id || null,
            employee_email: record.employees?.email || null,
            employee_status: record.employees?.status || 'active',
            employee_is_active: record.employees?.is_active ?? true,
            employee_id: record.employees?.id || record.employee_id
        }));

        res.json(enrichedRecords);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/disciplinary - Issue Warning, Suspension (3-7 days), or Termination
router.post('/', async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr' || req.user?.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required to issue disciplinary actions.' });
        }

        const { employee_id, type, reason, severity, duration_days } = req.body;
        
        if (!employee_id || !type || !reason) {
            return res.status(400).json({ error: 'Employee, type, and detailed reason are required.' });
        }

        // Standardize types: Warning, Suspension, Termination
        const validTypes = ['Warning', 'Suspension', 'Termination'];
        const resolvedType = validTypes.find(t => t.toLowerCase() === type.toLowerCase()) || 'Warning';

        const todayStr = new Date().toISOString().split('T')[0];
        let formattedReason = reason.trim();
        let resolvedSeverity = severity || 'Low';
        let durationDays = 0;
        let endDateStr = null;

        // 1. Logic for Warning: Account remains active
        if (resolvedType === 'Warning') {
            resolvedSeverity = severity || 'Low';
        }

        // 2. Logic for Suspension: Account temporarily locked out
        else if (resolvedType === 'Suspension') {
            durationDays = Math.max(1, Math.min(60, parseInt(duration_days, 10) || 3));
            const endObj = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
            endDateStr = endObj.toISOString().split('T')[0];
            
            formattedReason = `[SUSPENDED: ${durationDays} DAYS | Until ${endDateStr}] ${formattedReason}`;
            resolvedSeverity = severity || 'High';

            // Lockout employee login access
            await supabase
                .from('employees')
                .update({ status: 'inactive', is_active: false })
                .eq('id', employee_id);
        }

        // 3. Logic for Termination: Permanent deactivation without deleting the row
        else if (resolvedType === 'Termination') {
            formattedReason = `[TERMINATED: Effective ${todayStr}] ${formattedReason}`;
            resolvedSeverity = 'Critical';

            // Deactivate account permanently - records are NEVER hard deleted
            await supabase
                .from('employees')
                .update({ status: 'inactive', is_active: false })
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
        let notifTitle = `Formal Notice: Written Warning`;
        let notifText = `HR Compliance has issued a ${resolvedSeverity} severity warning notice: "${reason}". Please review and acknowledge in your dashboard.`;

        if (resolvedType === 'Suspension') {
            notifTitle = `Account Suspended: ${durationDays} Days`;
            notifText = `Your HRIS access has been temporarily suspended until ${endDateStr} (${durationDays} days). Reason: "${reason}". Contact HR for inquiries.`;
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
            sender_id: req.user?.id || null,
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
        import('./auditLogs.js').then(({ createAuditLog }) => {
            createAuditLog({
                log_name: 'disciplinary',
                description: `Issued ${resolvedType} (${resolvedSeverity}) to ${empName} (${emp?.company_id || employee_id})`,
                subject_type: 'App\\Models\\Disciplinary',
                subject_id: employee_id,
                event: 'created',
                causer_id: req.user?.id || 'admin',
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

// PUT /api/disciplinary/:id/status - Update status & handle suspension reinstatement
router.put('/:id/status', async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr' || req.user?.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required.' });
        }

        const { status } = req.body;
        if (!status) {
            return res.status(400).json({ error: 'Status is required.' });
        }

        const validStatuses = ['Active', 'Acknowledged', 'Under Review', 'Resolved'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const { data: record, error } = await supabase
            .from('disciplinary_logs')
            .update({ status })
            .eq('id', req.params.id)
            .select('*, employees:employee_id(id, company_id, first_name, last_name, email)')
            .single();
            
        if (error) throw error;

        // If resolving a Suspension, automatically reinstate the employee's active status!
        if (status === 'Resolved' && record?.employee_id) {
            if (record.type === 'Suspension') {
                await supabase
                    .from('employees')
                    .update({ status: 'active', is_active: true })
                    .eq('id', record.employee_id);

                await createNotification({
                    target: record.employee_id,
                    title: 'Suspension Lifted & Account Reinstated',
                    text: `HR Compliance has officially resolved your suspension. Your portal access and employment status have been fully restored.`,
                    type: 'disciplinary',
                    sender_name: 'HR & Compliance Management'
                });
            } else {
                await createNotification({
                    target: record.employee_id,
                    title: 'Disciplinary Case Resolved',
                    text: `Your ${record.type} notice issued on ${record.date} has been officially marked as Resolved and Closed by HR.`,
                    type: 'disciplinary',
                    sender_name: 'HR & Compliance Management'
                });
            }
        }

        invalidateCache(['/api/disciplinary', '/api/dashboard', '/api/employees']);
        res.json({ success: true, message: `Disciplinary record marked as ${status}.`, data: record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/disciplinary/:id/resolve - Backward-compatible resolve & reinstate route
router.put('/:id/resolve', async (req, res) => {
    try {
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr' || req.user?.role === 'superadmin';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Administrative privileges required.' });
        }

        const { data: record, error } = await supabase
            .from('disciplinary_logs')
            .update({ status: 'Resolved' })
            .eq('id', req.params.id)
            .select('*, employees:employee_id(id, company_id, first_name, last_name)')
            .single();
            
        if (error) throw error;

        if (record?.employee_id) {
            if (record.type === 'Suspension') {
                await supabase
                    .from('employees')
                    .update({ status: 'active', is_active: true })
                    .eq('id', record.employee_id);

                await createNotification({
                    target: record.employee_id,
                    title: 'Suspension Lifted & Account Reinstated',
                    text: `HR Compliance has officially resolved your suspension. Your portal access is fully restored.`,
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

        invalidateCache(['/api/disciplinary', '/api/dashboard', '/api/employees']);
        res.json({ success: true, message: 'Record marked as resolved and account reinstated if suspended.', data: record });
    } catch (err) {
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

        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'hr' || req.user?.role === 'superadmin';
        if (!isAdmin && existing.employee_id !== req.user?.id) {
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
        const emp = record?.employees;
        const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
        const companyId = emp?.company_id ? `(${emp.company_id})` : '';

        await createNotification({
            target: 'admin',
            title: 'Disciplinary Memo Acknowledged',
            text: `${empName} ${companyId} has officially acknowledged receipt of the ${record?.type || 'disciplinary'} notice issued on ${record?.date}.`,
            type: 'disciplinary',
            sender_id: record?.employee_id,
            sender_name: empName,
            company_id: emp?.company_id
        });

        invalidateCache(['/api/disciplinary', '/api/dashboard']);
        res.json({ success: true, message: 'Disciplinary notice acknowledged.', data: record });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
