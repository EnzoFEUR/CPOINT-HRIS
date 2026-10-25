import express from 'express';
import { validateRecordId } from '../middleware/requestValidation.js';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';
import { publishCommittedDisciplinary } from '../services/disciplinaryEvents.js';
import { HUMAN_TEXT_LIMITS } from '../../shared/inputLimits.mjs';
import { isLeaveDate } from '../../shared/leavePolicy.js';
import { getManilaWorkDate } from '../../shared/workPolicy.mjs';

import { disciplinaryService } from '../services/disciplinaryService.js';

const router = express.Router();
router.param('id', validateRecordId);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

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
                            <td class="meta-val">${escapeHtml(fullName)} (${escapeHtml(employee.company_id || 'ID N/A')})</td>
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
                        <p>${escapeHtml(reason)}</p>
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
                            <td class="meta-val">${escapeHtml(fullName)} (${escapeHtml(employee.company_id || 'ID N/A')})</td>
                        </tr>
                        <tr>
                            <td class="meta-label">Action Cleared</td>
                            <td class="meta-val">${escapeHtml(original_type || 'Disciplinary Action')}</td>
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
                        <p>${escapeHtml(reasonText)}</p>
                        ${investigation_notes ? `<p style="margin-top: 8px; font-size: 12px; color: #047857;"><strong>Notes:</strong> ${escapeHtml(investigation_notes)}</p>` : ''}
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

// Senior-Fullstack Policy: Disciplinary exemption check for administrative and security guard personnel
// GET /api/disciplinary - Fetch disciplinary logs with employee metadata
router.get('/', cacheResponse(15), async (req, res) => {
    try {
        let query = supabase
            .from('disciplinary_logs')
            .select('*, employees:employee_id(id, company_id, first_name, last_name, department, email, status, is_active, biometric_baseline_path, job_title, date_hired, shift, role)')
            .order('created_at', { ascending: false });

        const isAdmin = req.user.role === 'admin' || req.user.role === 'hr';
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
        
        const enrichedRecords = (records || [])
            .filter(record => !isDisciplinaryExempt(record.employees))
            .map(record => {
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

// Each mutation commits its record, employment state, audit, and operation key together.
function afterCommit(req, result) {
    if (result.replayed) return;
    const record = result.record, employee = result.employee;
    publishCommittedDisciplinary(result);
    if (result.action !== 'delete') createNotification({
        target: result.action === 'acknowledge' ? 'admin' : employee.id,
        title: result.action === 'issue' ? 'Disciplinary Notice' : 'Disciplinary Status Updated',
        text: 'Your ' + record.type + ' notice is ' + record.status + '. Employment status: ' + employee.status + '.',
        type: 'disciplinary', sender_id: req.user.id, sender_name: 'HR & Compliance Management', company_id: employee.company_id
    }).catch(() => console.error('[DISCIPLINARY_NOTIFICATION] Post-commit notification failed.'));
    if (result.action === 'issue' && record.status === 'Active' && employee.email) dispatchDisciplinaryEmail(employee, {
        type: record.type, severity: record.severity, reason: record.reason, date: record.date, duration_days: result.duration_days, end_date: result.end_date
    }).catch(() => console.error('[DISCIPLINARY_EMAIL] Post-commit email failed.'));
    if (result.action === 'overturn' && employee.email) dispatchClearanceEmail(employee, {
        exoneration_reason: req.body.clearing_reason || req.body.exoneration_reason || req.body.reason,
        investigation_notes: req.body.investigation_notes || null, original_type: record.type, date: getManilaWorkDate()
    }).catch(() => console.error('[DISCIPLINARY_EMAIL] Post-commit clearance email failed.'));
}

function committedResponse(req, res, result) {
    afterCommit(req, result);
    const record = { ...result.record, employees: result.employee, employee_name: [result.employee.first_name, result.employee.last_name].filter(Boolean).join(' '),
        employee_status: result.employee.status, employee_is_active: result.employee.is_active };
    return res.json({ success: true, data: record, employee: result.employee, replayed: result.replayed });
}
function transactionError(res, error) {
    if (error.status === 503) res.setHeader('Retry-After', '2');
    return res.status(error.status || 503).json({ success: false, code: error.code, error: error.status ? error.message : 'The disciplinary action could not be confirmed.' });
}

router.post('/', async (req, res) => {
    try {
        if (!['admin', 'hr'].includes(req.user?.role)) return res.status(403).json({ error: 'Administrative privileges required.' });
        const { employee_id, type, reason, severity, duration_days, effective_date, date } = req.body;
        if (duration_days !== undefined && duration_days !== '' && (!['number','string'].includes(typeof duration_days) || !/^\d{1,2}$/.test(String(duration_days)) || Number(duration_days)<1 || Number(duration_days)>60)) return res.status(400).json({ error: 'Suspension duration must be a whole number from 1 to 60 days.' });
        if (typeof reason !== 'string' || !reason.trim() || reason.length > HUMAN_TEXT_LIMITS.reason) return res.status(400).json({ error: 'Incident details must contain 1-' + HUMAN_TEXT_LIMITS.reason + ' characters.' });
        const kind = typeof type === 'string' && ['Warning','Suspension','Termination'].find(value => value.toLowerCase() === type.toLowerCase());
        if (!kind) return res.status(400).json({ error: 'Invalid disciplinary type.' });
        const today = getManilaWorkDate(), effective = effective_date ?? date ?? today;
        if (!isLeaveDate(effective) || kind !== 'Warning' && effective > today || kind === 'Termination' && effective !== today) return res.status(400).json({ error: 'Enter a valid supported effective date. Future sanctions are not supported.' });
        const payload = { type: kind, reason: reason.trim(), effective_date: effective };
        if (severity) payload.severity = severity;
        if (kind === 'Suspension') payload.duration_days = Number(duration_days || 3);
        const result = await disciplinaryService.command({ actorId: req.user.id, employeeId: employee_id, action: 'issue', payload, operationId: req.body.operation_id });
        return committedResponse(req, res, result);
    } catch (error) { return transactionError(res, error); }
});

router.put('/:id/status', async (req, res) => {
    try {
        if (!['admin','hr'].includes(req.user?.role)) return res.status(403).json({ error: 'Administrative privileges required.' });
        if (!['Active','Acknowledged','Under Review','Resolved','Overturned'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid disciplinary status.' });
        const result = await disciplinaryService.command({ actorId: req.user.id, recordId: req.params.id, action: 'status',
            payload: { status: req.body.status, expected_status: req.body.expected_status }, operationId: req.body.operation_id });
        return committedResponse(req, res, result);
    } catch (error) { return transactionError(res, error); }
});
router.put('/:id/resolve', async (req, res) => {
    try {
        const result = await disciplinaryService.command({ actorId: req.user.id, recordId: req.params.id, action: 'resolve',
            payload: { expected_status: req.body?.expected_status }, operationId: req.body?.operation_id });
        return committedResponse(req, res, result);
    } catch (error) { return transactionError(res, error); }
});
router.put('/:id/overturn', async (req, res) => {
    try {
        const reason = req.body.clearing_reason || req.body.exoneration_reason || req.body.reason;
        if (typeof reason !== 'string' || !reason.trim() || reason.length>HUMAN_TEXT_LIMITS.reason || typeof req.body.investigation_notes !== 'undefined' && (typeof req.body.investigation_notes !== 'string' || req.body.investigation_notes.length>1000)) return res.status(400).json({ error: 'Enter a valid clearing reason and investigation notes of at most 1000 characters.' });
        const result = await disciplinaryService.command({ actorId: req.user.id, recordId: req.params.id, action: 'overturn',
            payload: { clearing_reason: reason.trim(), investigation_notes: req.body.investigation_notes || '', expected_status: req.body.expected_status }, operationId: req.body.operation_id });
        return committedResponse(req, res, result);
    } catch (error) { return transactionError(res, error); }
});
router.put('/:id/acknowledge', async (req, res) => {
    try {
        const result = await disciplinaryService.command({ actorId: req.user.id, recordId: req.params.id, action: 'acknowledge',
            operationId: req.body?.operation_id });
        return committedResponse(req, res, result);
    } catch (error) { return transactionError(res, error); }
});
router.delete('/:id', async (req, res) => {
    try {
        const result = await disciplinaryService.command({ actorId: req.user.id, recordId: req.params.id, action: 'delete',
            payload: { expected_status: req.body?.expected_status }, operationId: req.body?.operation_id });
        return committedResponse(req, res, result);
    } catch (error) { return transactionError(res, error); }
});

export default router;
