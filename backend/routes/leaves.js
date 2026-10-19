import express from 'express';
import { validateRecordId, validateUuidParam } from '../middleware/requestValidation.js';
import { supabase } from '../supabaseClient.js';
import { createNotification } from './notifications.js';
import { createAuditLog } from './auditLogs.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { getLeaveSummaryForPeriod } from '../utils/leaveUtils.js';
import { randomUUID } from 'node:crypto';
import {
    isCreditUuid,
    isLeaveDate,
    isCreditLeaveType,
    isCreditManager,
    validateSilPolicy,
    validateCashOutRequest,
    validateCashOutDecision,
    validateCashOutTransition,
    CASH_OUT_LABELS,
    validateCreditCommand,
    validateLeaveCreditSnapshot,
    validateLeaveRange,
    validateLeaveRequest,
    validateLeaveWorkdayEndpoints,
    getLeavePaymentMismatch,
    getLeaveReviewDates,
    getEmployeeRestDays
} from '../../shared/leavePolicy.js';

// --- Shared Credit & Permission Error Helpers ---
export const isMissingCreditSchema = error => ['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(error?.code);
export const isVerifiedCreditManager = user => user?.role_verified === true && isCreditManager(user) && user.is_active !== false && !user.archived_at && !['inactive', 'suspended', 'terminated', 'resigned', 'separated'].includes(String(user.status || '').toLowerCase());

const conflicts = {
    INSUFFICIENT_CONVERTIBLE_CREDITS: 'These days are not available for cash conversion. Refresh the balance and eligibility date.',
    SIL_CLASSIFICATION_REQUIRED: 'Payroll compliance must review contribution and tax treatment before approval.',
    SIL_PAYROLL_LOCKED: 'This payslip contains committed SIL earnings and cannot be changed or deleted.',
    SIL_REVIEW_CHANGED: 'Leave records changed during review. Refresh and review the balance again.',
    SIL_POLICY_CHANGED: 'The SIL policy changed during editing. Refresh and review it again.',
    SIL_CASH_REQUEST_OPEN: 'You already have a cash-out request awaiting review or payroll.',
    SIL_CASH_COOLDOWN_ACTIVE: 'A 24-hour cooldown is active following a rejected cash-out request. Please wait before submitting another request.',
    SIL_CASH_DECISION_CHANGED: 'This cash-out request was already reviewed. Refresh before retrying.',
    SIL_DAILY_RATE_REQUIRED: 'HR must save a valid daily rate before approving cash-out.',
    SIL_DAILY_RATE_CHANGED: 'The daily rate changed during review. Refresh the employee and review the amount again.',
    SIL_TAX_REVIEW_REQUIRED: 'Review the cash amount and amount subject to tax before approving.',
    LEAVE_SERVICE_DATE_MISMATCH: 'HR must review the hire date used by existing leave records. No recorded balances were changed.',
    EMPLOYEE_HIRE_DATE_REVIEW_REQUIRED: 'Leave records already use this start date. HR must review them before the date can change. No leave credits were changed.',
    COMPANY_INCENTIVE_DISABLED: 'Company incentive credits are not supported. Only statutory SIL credits are available.',
    LEAVE_REST_DAY: 'The first or last date is now a rest day. Choose scheduled workdays and file revised dates.',
    LEAVE_PAYMENT_PREFERENCE_CHANGED: 'Approve the employee requested payment and credit pool, or reject the request for revision.',
    SIL_NOT_ELIGIBLE: 'HR has not confirmed statutory SIL eligibility for this account.',
    LEAVE_DECISION_CHANGED: 'This leave decision changed during review. Refresh before retrying.',
    INSUFFICIENT_LEAVE_CREDITS: 'Insufficient leave credits. Refresh the balance and review the funding source.',
    ACCOUNT_ALREADY_EXISTS: 'The account already exists. Opening balances cannot be applied twice.',
    CREDIT_ACCOUNT_REQUIRED: 'Automatic allocation requires a verified hire date and reconciled historical opening balances.',
    EMPLOYEE_HIRE_DATE_REQUIRED: 'HR must record the employee hire date before SIL can be allocated automatically.',
    HISTORICAL_SIL_REVIEW_REQUIRED: 'HR must reconcile historical service and opening balances once; future SIL grants are automatic.',
    EMPLOYEE_SCHEDULE_REVIEW_REQUIRED: 'HR must correct the employee work schedule before automatic SIL allocation.',
    IDEMPOTENCY_CONFLICT: 'This request ID belongs to a different operation. Refresh and retry.',
    ATTENDANCE_CONFLICT: 'Attendance punches exist on these dates. Reconcile attendance before approval.',
    LEAVE_OVERLAP: 'Another approved leave overlaps these dates.',
    NO_LEAVE_WORK_DAYS: 'This request has no chargeable workdays.',
    PAYMENT_REFERENCE_EXISTS: 'This employee’s payment reference has already been recorded.',
};

export function sendCreditError(res, error) {
    if (error?.code === 'LEAVE_CREDIT_STATUS_UNAVAILABLE') return res.status(503).json({ code: error.code, error: error.message });
    if (isMissingCreditSchema(error)) return res.status(503).json({ code: 'LEAVE_CREDITS_UNAVAILABLE', error: 'Leave credits are unavailable until the database migration is installed.' });
    if (conflicts[error?.message]) return res.status(409).json({ code: error.message, error: conflicts[error.message] });
    if (error?.message === 'FORBIDDEN') return res.status(403).json({ error: 'HR or administrator access is required.' });
    if (['EMPLOYEE_NOT_FOUND', 'LEAVE_NOT_FOUND', 'SIL_CASH_REQUEST_NOT_FOUND', 'PAYROLL_NOT_FOUND'].includes(error?.message)) return res.status(404).json({ error: 'Employee, payslip or request not found.' });
    if (error?.message === 'INVALID_CREDIT_COMMAND' || error?.message === 'INVALID_EMPLOYEE_HIRE_DATE') return res.status(400).json({ error: 'Invalid leave credit operation.' });
    if (error?.status === 400) return res.status(400).json({ error: error.message });
    console.error('[leaves] Operation failed:', error?.code || 'UNKNOWN');
    return res.status(500).json({ error: 'Unable to complete the leave credit operation. Refresh before retrying.' });
}

export function refreshLeaveCredits(client, employeeId) {
    invalidateCache(['/api/leaves', '/api/dashboard', '/api/payroll']);
    try {
        const channel = client.channel(`employee-leave-credits-${employeeId}`);
        Promise.resolve(channel.httpSend('CREDITS_CHANGED', { employee_id: employeeId })).catch(() => {}).finally(() => { client.removeChannel?.(channel); });
    } catch { /* Polling and Postgres change feeds recover a missed refresh hint. */ }
}

/**
 * Creates subrouter for leave credit balance, grants, conversions, and cash-outs.
 */
export function createLeaveCreditsRouter(client = supabase, notify = createNotification, audit = createAuditLog) {
    const router = express.Router();
    router.param('id', validateUuidParam);
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!req.user?.id) return res.status(401).json({ error: 'Authentication required.' });
        if (req.user.employee_identity_verified !== true) return res.status(403).json({ error: 'A verified employee account is required. Contact HR to reconcile your Auth link.' });
        next();
    });

    router.get('/', async (req, res) => {
        const employeeId = req.query.employee_id || req.user.id;
        if (!isVerifiedCreditManager(req.user) && employeeId !== req.user.id) return res.status(403).json({ error: 'You may only read your own leave credits.' });
        if (!isCreditUuid(employeeId)) return res.status(400).json({ error: 'Invalid employee ID.' });
        try {
            const { data, error } = await client.rpc('sync_employee_leave_credits', { p_employee_id: employeeId });
            if (error) throw error;
            res.json({ success: true, data: validateLeaveCreditSnapshot(data) });
        } catch (error) { sendCreditError(res, error); }
    });

    router.get('/policy', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        try {
            const { data, error } = await client.rpc('get_sil_policy', { p_actor_id: req.user.id });
            if (error) throw error;
            res.json({ success: true, data });
        } catch (error) {
            if (isMissingCreditSchema(error)) return res.status(503).json({ error: 'Install the SIL policy settings migration to edit annual credits.' });
            sendCreditError(res, error);
        }
    });

    router.put('/policy', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        try {
            const command = validateSilPolicy(req.body);
            const { data, error } = await client.rpc('set_sil_policy', { p_actor_id: req.user.id, p_request_id: command.request_id, p_expected_id: command.expected_id, p_annual_days: command.annual_days });
            if (error) throw error;
            try {
                const channel = client.channel('sil-policy-settings');
                Promise.resolve(channel.httpSend('SIL_POLICY_CHANGED', {})).catch(() => {}).finally(() => client.removeChannel?.(channel));
            } catch { /* Polling recovers missed refresh hints. */ }
            res.json({ success: true, data });
        } catch (error) {
            if (isMissingCreditSchema(error)) return res.status(503).json({ error: 'Install the SIL policy settings migration to edit annual credits.' });
            sendCreditError(res, error);
        }
    });

    router.get('/conversion-settings', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        try {
            const { data, error } = await client.rpc('get_sil_conversion_settings', { p_actor_id: req.user.id });
            if (error) throw error;
            res.json({ success: true, data });
        } catch (error) { sendCreditError(res, error); }
    });

    router.put('/conversion-settings', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        const body = req.body || {};
        if (!isCreditUuid(body.request_id) || !isCreditUuid(body.expected_id) || !['service_anniversary', 'calendar'].includes(body.year_boundary) || typeof body.allow_early !== 'boolean' || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) return res.status(400).json({ error: 'Review the conversion year, early conversions and policy reference.' });
        try {
            const { data, error } = await client.rpc('set_sil_conversion_settings', { p_actor_id: req.user.id, p_request_id: body.request_id, p_expected_id: body.expected_id, p_year_boundary: body.year_boundary, p_allow_early: body.allow_early, p_reason: body.reason.trim() });
            if (error) throw error;
            res.json({ success: true, data });
        } catch (error) { sendCreditError(res, error); }
    });

    router.get('/obligations', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        const page = Number(req.query.page || 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
        if (!Number.isInteger(page) || page < 1 || page > 10000) return res.status(400).json({ error: 'Invalid page.' });
        try {
            const from = (page - 1) * limit;
            const to = from + limit - 1;
            const { data, error, count } = await client
                .from('sil_obligations')
                .select('*, employees:employee_id!inner(first_name,last_name,company_id,department,role)', { count: 'exact' })
                .not('employees.role', 'in', '("admin","security")')
                .neq('status', 'settled')
                .order('checked_at', { ascending: false })
                .order('id')
                .range(from, to);
            if (error) throw error;
            res.json({ success: true, data: data || [], count: count || 0 });
        } catch (error) { sendCreditError(res, error); }
    });

    router.get('/payment-employees', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        const page = Number(req.query.page || 1);
        const name = String(req.query.name || '').trim();
        if (!Number.isInteger(page) || page < 1 || page > 10000 || name.length > 80) return res.status(400).json({ error: 'Invalid employee search.' });
        try {
            let query = client.from('employees').select('id,first_name,last_name,company_id,daily_rate,date_hired', { count: 'exact' });
            if (name) query = query.ilike('last_name', `%${name.replace(/[\\%_]/g, '\\$&')}%`);
            const { data, error, count } = await query.order('last_name').order('first_name').order('id').range((page - 1) * 25, page * 25 - 1);
            if (error) throw error;
            res.json({ success: true, data: data || [], count: count || 0 });
        } catch (error) { sendCreditError(res, error); }
    });

    router.get('/preview', async (req, res) => {
        const { employee_id, start_date, end_date } = req.query;
        if (!isVerifiedCreditManager(req.user) && employee_id !== req.user.id) return res.status(403).json({ error: 'You may only preview your own leave credits.' });
        if (!isCreditUuid(employee_id) || !isLeaveDate(start_date) || !isLeaveDate(end_date) || end_date < start_date || (Date.parse(end_date) - Date.parse(start_date)) / 86400000 > 365) return res.status(400).json({ error: 'A valid employee and leave range of at most 366 days are required.' });
        try {
            const { data, error } = await client.rpc('preview_employee_leave_credits', { p_employee_id: employee_id, p_start_date: start_date, p_end_date: end_date });
            if (error) throw error;
            res.json({ success: true, data: { dates: data || [], days: data?.length || 0 } });
        } catch (error) { sendCreditError(res, error); }
    });

    router.get('/cash-out-requests', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        const page = Number(req.query.page || 1);
        if (!Number.isInteger(page) || page < 1 || page > 10000) return res.status(400).json({ error: 'Invalid page.' });
        try {
            const status = String(req.query.status || 'open');
            const name = String(req.query.name || '').trim();
            const from = req.query.from; const to = req.query.to;
            if ((!['open', 'all', ...Object.keys(CASH_OUT_LABELS)].includes(status)) || name.length > 80 || (from && !isLeaveDate(from)) || (to && !isLeaveDate(to)) || (from && to && from > to)) return res.status(400).json({ error: 'Invalid cash-out filters.' });
            let query = client.from('sil_cash_out_requests').select('*, employees:employee_id!inner(first_name,last_name,company_id)', { count: 'exact' });
            if (status === 'open') query = query.in('status', ['requested', 'approved', 'queued_for_payroll', 'needs_correction', 'payment_failed']);
            else if (status !== 'all') query = query.eq('status', status);
            if (name) query = query.ilike('employees.last_name', `%${name.replace(/[\\%_]/g, '\\$&')}%`);
            if (from) query = query.gte('created_at', `${from}T00:00:00+08:00`);
            if (to) query = query.lte('created_at', `${to}T23:59:59.999999+08:00`);
            const { data, error, count } = await query.order('created_at', { ascending: true }).order('id').range((page - 1) * 10, page * 10 - 1);
            if (['42P01', 'PGRST205'].includes(error?.code)) return res.json({ success: true, data: [], count: 0, available: false });
            if (error) throw error;
            res.json({ success: true, data: data || [], count: count || 0, available: true });
        } catch (error) { sendCreditError(res, error); }
    });

    router.post('/cash-out-requests', async (req, res) => {
        if (req.body.employee_id !== req.user.id) return res.status(403).json({ error: 'You may only request your own SIL cash-out.' });
        const userStatus = String(req.user?.status || '').toLowerCase();
        const isSusp = userStatus === 'suspended' || Boolean(req.user?.is_suspended) || req.user?.operational_status === 'Suspended';
        const isTerm = userStatus === 'terminated' || Boolean(req.user?.is_terminated) || Boolean(req.user?.archived_at) || req.user?.is_active === false || Boolean(req.user?.separation_type) || req.user?.operational_status === 'Terminated' || req.isSeparated;
        if (isTerm) {
            return res.status(403).json({ error: 'Service Incentive Leave cash-out is disabled for separated or inactive accounts. Remaining credits are resolved via final pay clearance.' });
        }
        if (isSusp) {
            return res.status(403).json({ error: 'Service Incentive Leave cash-out is paused during disciplinary suspension.' });
        }
        try {
            const command = validateCashOutRequest(req.body);
            const { data, error } = await client.rpc('request_sil_cash_out', { p_actor_id: req.user.id, p_employee_id: command.employee_id, p_request_id: command.request_id, p_days: command.days });
            if (error) throw error;
            refreshLeaveCredits(client, command.employee_id);

            // Enterprise Real-Time Admin Notification
            try {
                const { data: requester } = await client
                    .from('employees')
                    .select('id, first_name, last_name, company_id, daily_rate')
                    .eq('id', command.employee_id)
                    .maybeSingle();

                const senderName = requester ? `${requester.first_name} ${requester.last_name}`.trim() : 'An employee';
                const estAmount = requester?.daily_rate ? (Number(command.days) * Number(requester.daily_rate)).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }) : '';

                await notify({
                    target: 'admin',
                    title: `SIL Cash-Out Request: ${senderName}`,
                    text: `${senderName} submitted a cash-out request for ${command.days} SIL day(s)${estAmount ? ` (${estAmount})` : ''}. Awaiting HR review.`,
                    type: 'cash_out',
                    sender_id: command.employee_id,
                    company_id: requester?.company_id || null,
                    sender_name: senderName
                });
            } catch (notifyErr) {
                console.warn('[leaves] SIL Cash-out notification warning:', notifyErr.message);
            }

            res.json({ success: true, data });
        } catch (error) { sendCreditError(res, error); }
    });

    router.post('/cash-out-requests/:id/transition', async (req, res) => {
        try {
            if (!isCreditUuid(req.params.id)) throw Object.assign(new Error('Invalid cash-out request ID.'), { status: 400 });
            const command = validateCashOutTransition({ ...req.body, employee_id: req.user.id });
            if (['approved', 'rejected', 'needs_correction'].includes(command.action) && !isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
            const { operation_id, ...payload } = command;
            const { data, error } = await client.rpc('transition_sil_cash_out', { p_actor_id: req.user.id, p_request_id: req.params.id, p_operation_id: operation_id, p_command: payload });
            if (error) throw error;
            refreshLeaveCredits(client, data.employee_id);

            // Real-time Notification to Employee on Decision
            try {
                const targetEmployeeId = data?.employee_id;
                const requestRecord = Array.isArray(data?.cash_out_requests)
                    ? data.cash_out_requests.find(r => r.id === req.params.id)
                    : null;
                const reqDays = requestRecord?.days ?? payload.days ?? 'your requested';
                const decidedDate = new Date().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });

                let notificationTitle = 'SIL Cash-Out Update';
                let notificationText = 'Your SIL cash-out request status has been updated.';

                if (payload.action === 'approved') {
                    notificationTitle = 'SIL Cash-Out Approved';
                    notificationText = `Your SIL cash-out request for ${reqDays} day(s) was approved on ${decidedDate} and queued for payroll.`;
                } else if (payload.action === 'rejected') {
                    notificationTitle = 'SIL Cash-Out Request Rejected';
                    const reasonSnippet = payload.reason ? ` Reason: "${payload.reason}".` : '';
                    notificationText = `Your SIL cash-out request for ${reqDays} day(s) was rejected on ${decidedDate}.${reasonSnippet} Your leave credits have been restored to your available balance.`;
                } else if (payload.action === 'needs_correction') {
                    notificationTitle = 'SIL Cash-Out Needs Correction';
                    const reasonSnippet = payload.reason ? ` Note: "${payload.reason}".` : '';
                    notificationText = `Your SIL cash-out request for ${reqDays} day(s) requires correction as of ${decidedDate}.${reasonSnippet}`;
                }

                if (targetEmployeeId) {
                    await notify({
                        target: targetEmployeeId,
                        title: notificationTitle,
                        text: notificationText,
                        type: 'cash_out',
                        sender_id: req.user.id
                    });
                }
            } catch (notifyErr) {
                console.warn('[leaves] Cash-out transition employee notification warning:', notifyErr.message);
            }

            res.json({ success: true, data });
        } catch (error) { sendCreditError(res, error); }
    });

    router.get('/history', async (req, res) => {
        const employeeId = req.query.employee_id || req.user.id;
        const page = Number(req.query.page || 1);
        const tables = { credits: 'employee_leave_credit_ledger', cash: 'sil_cash_out_requests', audit: 'sil_cash_events' };
        const table = tables[req.query.kind || 'credits'];
        if (!isVerifiedCreditManager(req.user) && employeeId !== req.user.id) return res.status(403).json({ error: 'You may only read your own leave records.' });
        if (!isCreditUuid(employeeId) || !table || !Number.isInteger(page) || page < 1 || page > 10000) return res.status(400).json({ error: 'Invalid history query.' });
        try {
            const { data, error, count } = await client.from(table).select('*', { count: 'exact' }).eq('employee_id', employeeId).order('created_at', { ascending: false }).order('id').range((page - 1) * 20, page * 20 - 1);
            if (error) throw error;
            res.json({ success: true, data: data || [], count: count || 0 });
        } catch (error) { sendCreditError(res, error); }
    });

    router.post('/cash-out-requests/:id/decision', async (req, res) => {
        if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
        try {
            if (!isCreditUuid(req.params.id)) throw Object.assign(new Error('Invalid cash-out request ID.'), { status: 400 });
            const command = validateCashOutDecision(req.body);
            const { data, error } = await client.rpc('decide_sil_cash_out', { p_actor_id: req.user.id, p_request_id: req.params.id, p_decision_id: command.decision_id, p_status: command.status, p_taxable_amount: command.taxable_amount, p_expected_daily_rate: command.expected_daily_rate });
            if (error?.code === '42501') return res.status(409).json({ code: 'SIL_CASH_DECISION_CHANGED', error: 'The cash-out workflow changed. Refresh and review the request again.' });
            if (error) throw error;
            refreshLeaveCredits(client, data.employee_id);

            // Real-time Notification to Employee on Decision
            try {
                const statusLabel = command.status === 'approved' || command.status === 'queued_for_payroll'
                    ? 'Approved & Queued for Payroll'
                    : command.status === 'rejected'
                    ? 'Rejected'
                    : command.status;

                const decidedDate = new Date().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });

                await notify({
                    target: data.employee_id,
                    title: `SIL Cash-Out: ${statusLabel}`,
                    text: command.status === 'rejected'
                        ? `Your SIL cash-out request was rejected on ${decidedDate}. Your leave credits have been restored to your available balance.`
                        : `Your SIL cash-out request decision was recorded as ${statusLabel} on ${decidedDate}.`,
                    type: 'cash_out',
                    sender_id: req.user.id
                });
            } catch (notifyErr) {
                console.warn('[leaves] Cash-out decision employee notification warning:', notifyErr.message);
            }

            res.json({ success: true, data });
        } catch (error) { sendCreditError(res, error); }
    });

    for (const [path, kind, rpc] of [
        ['setup', 'setup', 'setup_leave_credit_account'],
        ['reconcile', 'reconcile', 'reconcile_employee_leave_credits'],
        ['grant', 'grant', 'grant_leave_credits'],
        ['cash-conversion', 'cash_conversion', 'record_sil_cash_conversion']
    ]) {
        router.post(`/${path}`, async (req, res) => {
            if (!isVerifiedCreditManager(req.user)) return res.status(403).json({ error: 'HR or administrator access is required.' });
            try {
                let input = req.body;
                if (kind === 'setup') {
                    if (!isCreditUuid(input?.employee_id)) throw Object.assign(new Error('A valid employee ID is required.'), { status: 400 });
                    const { data: employee, error: readError } = await client.from('employees').select('*').eq('id', input.employee_id).maybeSingle();
                    if (readError) throw readError;
                    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
                    if (!isLeaveDate(employee.date_hired)) throw new Error('EMPLOYEE_HIRE_DATE_REQUIRED');
                    if (input.service_start_date != null && input.service_start_date !== employee.date_hired) throw new Error('LEAVE_SERVICE_DATE_MISMATCH');
                    let restDays;
                    try { restDays = getEmployeeRestDays(employee); } catch { throw new Error('EMPLOYEE_SCHEDULE_REVIEW_REQUIRED'); }
                    input = { ...input, service_start_date: employee.date_hired, rest_days: restDays };
                }
                const command = validateCreditCommand(kind, input);
                const payload = Object.fromEntries(Object.entries(command).map(([key, value]) => [`p_${key}`, value]));
                const { data, error } = await client.rpc(rpc, { ...payload, p_actor_id: req.user.id });
                if (error) throw error;
                refreshLeaveCredits(client, command.employee_id);
                res.json({ success: true, data });
            } catch (error) { sendCreditError(res, error); }
        });
    }

    return router;
}

/**
 * Unified Leaves Router: handles leaves, credit deductions, filing, approvals, and settlements.
 */
export function createLeavesRouter(client = supabase, notify = createNotification, audit = createAuditLog) {
    const router = express.Router();
    router.param('id', validateRecordId);

    // Authenticated access boundary
    router.use((req, res, next) => {
        if (!req.user?.id) return res.status(401).json({ error: 'Authentication required.' });
        if (req.user.employee_identity_verified !== true) return res.status(403).json({ error: 'A verified employee account is required. Contact HR to reconcile your Auth link.' });
        if (isVerifiedCreditManager(req.user)) return next();
        const target = req.method === 'GET' ? req.query.employee_id : req.body?.employee_id;
        if (!['GET', 'POST'].includes(req.method) || (target && target !== req.user.id)) return res.status(403).json({ error: 'You may only access your own leave requests.' });
        next();
    });

    // Subrouter for leave credits: mounted on /credits
    const creditsRouter = createLeaveCreditsRouter(client, notify, audit);
    router.use('/credits', creditsRouter);

    // Dedicated payroll integration endpoint: Get leave summary (paid vs unpaid) for pay period
    router.get('/summary', cacheResponse(30), async (req, res) => {
        try {
            const { employee_id, start_date, end_date } = req.query;
            if (!employee_id || !start_date || !end_date) {
                return res.status(400).json({ error: 'employee_id, start_date, and end_date are required query parameters.' });
            }

            const summary = await getLeaveSummaryForPeriod({
                employeeId: employee_id,
                periodStart: start_date,
                periodEnd: end_date
            }, client);

            res.json(summary);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        try {
            let query = client.from('leave_requests').select('*, employees:employee_id(*)').order('created_at', { ascending: false });
            if (req.query.employee_id) {
                query = query.eq('employee_id', req.query.employee_id);
            }
            if (req.query.limit) {
                const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
                query = query.limit(limitNum);
            }
            const { data, error } = await query;
            if (error) throw error;
            
            const validDates = (data || []).flatMap(leave => [leave.start_date, leave.end_date]).filter(isLeaveDate).sort();
            let holidays = [];
            if (validDates.length) {
                const result = await client.from('holidays').select('date, type', { count: 'exact' })
                    .gte('date', validDates[0]).lte('date', validDates[validDates.length - 1]);
                if (result.error) throw result.error;
                if (!Array.isArray(result.data) || result.count !== result.data.length) throw new Error('The holiday calendar could not be loaded completely. Retry before reviewing leave.');
                holidays = result.data;
            }
            const leaves = (data || []).map(leave => {
                let reviewDates = null;
                let scheduleError = null;
                try { reviewDates = getLeaveReviewDates(leave, holidays); }
                catch (err) { scheduleError = err.message; }

                const rawNotes = leave.notes || '';
                const isExplicitUnpaid = /\[PAY_TYPE:WITHOUT_PAY\]/i.test(rawNotes) || /\[UNPAID\]/i.test(rawNotes);
                const isPaid = !isExplicitUnpaid;
                const payType = isPaid ? 'with_pay' : 'without_pay';
                const cleanNotes = rawNotes
                    .replace(/\[PAY_TYPE:[^\]]+\]/gi, '')
                    .replace(/\[(PAID|UNPAID)\]/gi, '')
                    .trim();

                const s = new Date(leave.start_date);
                const e = new Date(leave.end_date);
                const daysCount = (!isNaN(s.getTime()) && !isNaN(e.getTime()))
                    ? Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1)
                    : 1;

                return {
                    ...leave,
                    notes: cleanNotes,
                    raw_notes: rawNotes,
                    is_paid: isPaid,
                    pay_type: payType,
                    days_count: leave.credit_pool || (leave.requested_pay_type && leave.status === 'Approved') ? Number(leave.credit_days) : daysCount,
                    calendar_days: daysCount,
                    scheduled_work_dates: reviewDates,
                    scheduled_workdays: reviewDates?.length ?? null,
                    schedule_error: scheduleError
                };
            });

            res.json(leaves);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    async function readSchedule(employee, start_date, end_date) {
        const holidays = await client.from('holidays').select('date, type', { count: 'exact' }).gte('date', start_date).lte('date', end_date);
        if (holidays.error) throw holidays.error;
        if (!Array.isArray(holidays.data) || holidays.count !== holidays.data.length) throw new Error('The holiday calendar could not be loaded completely. Please retry.');
        return getLeaveReviewDates({ start_date, end_date, employees: employee }, holidays.data);
    }

    router.get('/holidays', async (req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=300');
        try {
            const { data, error } = await client.from('holidays').select('id, date, name, type').order('date');
            if (error) throw error;
            res.json({ success: true, data: data || [] });
        } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
    });

    router.get('/schedule', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const { employee_id } = req.query;
            if (!isCreditUuid(employee_id)) return res.status(400).json({ error: 'A valid employee ID is required.' });
            const [employee, holidays] = await Promise.all([
                client.from('employees').select('*').eq('id', employee_id).maybeSingle(),
                client.from('holidays').select('id, date, name, type').order('date')
            ]);
            if (employee.error) throw employee.error;
            if (!employee.data) return res.status(404).json({ error: 'Employee record not found.' });
            res.json({
                success: true,
                data: {
                    rest_days: getEmployeeRestDays(employee.data),
                    date_hired: isLeaveDate(employee.data.date_hired) ? employee.data.date_hired : null,
                    holidays: holidays.data || []
                }
            });
        } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
    });

    router.get('/preview', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const { employee_id, start_date, end_date } = req.query;
            if (!isCreditUuid(employee_id)) return res.status(400).json({ error: 'A valid employee ID is required.' });
            validateLeaveRange(start_date, end_date);
            const employee = await client.from('employees').select('*').eq('id', employee_id).maybeSingle();
            if (employee.error) throw employee.error;
            if (!employee.data) return res.status(404).json({ error: 'Employee record not found.' });
            const dates = await readSchedule(employee.data, start_date, end_date);
            res.json({ success: true, data: { dates, days: dates.length, calendar_days: (Date.parse(end_date) - Date.parse(start_date)) / 86400000 + 1, rest_days: getEmployeeRestDays(employee.data), department: employee.data.department } });
        } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
    });

    // Leave filing: locks balances upon request if paid
    router.post('/', async (req, res) => {
        try {
            const command = validateLeaveRequest(req.body || {});
            const { employee_id, leave_type, start_date, end_date, reason } = command;

            // 1. Account Lifecycle & Standing Verification
            const { data: emp, error: empErr } = await client
                .from('employees')
                .select('*')
                .eq('id', employee_id)
                .maybeSingle();

            if (empErr) throw empErr;
            if (!emp) {
                return res.status(404).json({ error: 'Employee record not found.' });
            }

            const standing = String(emp.status || '').trim().toLowerCase();
            const isSuspended = standing === 'suspended';
            const isTerminated = ['terminated', 'inactive', 'resigned', 'separated', 'archived'].includes(standing);

            if (isSuspended) {
                return res.status(403).json({ 
                    error: 'ACCESS RESTRICTED: Leave filing is prohibited while account is under disciplinary suspension.' 
                });
            }

            if (isTerminated || emp.archived_at || emp.is_active === false) {
                return res.status(403).json({ 
                    error: 'ACCESS DENIED: Personnel account has been separated or deactivated.' 
                });
            }

            if (isLeaveDate(emp.date_hired) && start_date < emp.date_hired) return res.status(400).json({ error: 'Leave cannot start before your hire date.' });
            validateLeaveWorkdayEndpoints({ leave_type, start_date, end_date }, emp);
            const scheduledDates = await readSchedule(emp, start_date, end_date);
            if (isCreditLeaveType(leave_type) && !scheduledDates.length) return res.status(400).json({ error: 'Select at least one scheduled workday for this leave type.' });

            // 2. Overlapping Leave Request Prevention
            const { data: overlappingLeaves, error: overlapError } = await client
                .from('leave_requests')
                .select('id, start_date, end_date, status, type')
                .eq('employee_id', employee_id)
                .in('status', ['New', 'Pending', 'Approved'])
                .lte('start_date', end_date)
                .gte('end_date', start_date);

            if (overlapError) throw overlapError;
            if (!Array.isArray(overlappingLeaves)) throw new Error('Existing leave requests could not be verified. Please retry.');

            if (overlappingLeaves && overlappingLeaves.length > 0) {
                const conflict = overlappingLeaves[0];
                return res.status(409).json({ 
                    error: `A leave request (${conflict.type}) is already active or pending for overlapping dates (${conflict.start_date} to ${conflict.end_date}).` 
                });
            }

            // 3. Insert Request atomically
            const { data: insertedLeave, error } = command.requested_pay_type ? await client.rpc('submit_leave_request', {
                p_actor_id: req.user.id, p_employee_id: employee_id, p_leave_type: leave_type,
                p_start_date: start_date, p_end_date: end_date, p_reason: reason,
                p_requested_pay_type: command.requested_pay_type, p_requested_credit_pool: command.requested_credit_pool,
            }) : await client
                .from('leave_requests')
                .insert({
                    employee_id,
                    type: leave_type,
                    start_date,
                    end_date,
                    notes: reason,
                    status: 'New'
                })
                .select('*')
                .single();

            if (error && command.requested_pay_type) {
                if (isMissingCreditSchema(error)) return res.status(503).json({ code: 'LEAVE_PAYMENT_UNAVAILABLE', error: 'Paid/unpaid leave requests are unavailable until the leave payment database migration is installed.' });
                return sendCreditError(res, error);
            }
            if (error) throw error;
            
            // Rich notification delivery
            const senderName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
            const avatarUrl = emp.company_id && emp.id 
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            try { await notify({
                target: 'admin',
                title: `Leave Request: ${senderName}`,
                text: `${senderName} submitted a ${leave_type} request (${start_date} to ${end_date}).`,
                type: 'leave',
                sender_id: emp.id,
                company_id: emp.company_id,
                sender_name: senderName,
                sender_avatar: avatarUrl
            }); } catch (err) { console.warn('[LEAVE_REQUEST] Saved, but notification failed:', err.message); }

            invalidateCache(['/api/leaves', '/api/dashboard']);

            try {
                const ch = client.channel('admin-leaves-sync');
                ch.send({
                    type: 'broadcast',
                    event: 'LEAVE_REQUEST_CREATED',
                    payload: {
                        id: insertedLeave.id,
                        employee_id,
                        status: insertedLeave.status
                    }
                }).catch(() => {});
            } catch (_) {}

            res.json({ success: true, message: 'Leave request submitted successfully!', data: insertedLeave });
        } catch (err) {
            res.status(err.message?.includes('LEAVE_OVERLAP') ? 409 : err.status || 500).json({ error: err.message?.includes('LEAVE_OVERLAP') ? 'A leave request already covers these dates. Refresh your recent requests.' : err.message });
        }
    });

    // Leave approval/rejection: deducts leave balance atomically and once upon approval
    router.put('/:id/status', async (req, res) => {
        try {
            const { status, pay_type, is_paid } = req.body;
            if (!['Approved', 'Rejected'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }

            if (pay_type !== undefined && !['with_pay', 'without_pay'].includes(pay_type)) return res.status(400).json({ error: 'Invalid pay_type.' });
            if (is_paid !== undefined && typeof is_paid !== 'boolean') return res.status(400).json({ error: 'is_paid must be a boolean.' });
            if (pay_type !== undefined && is_paid !== undefined && (pay_type === 'with_pay') !== is_paid) return res.status(400).json({ error: 'pay_type and is_paid disagree.' });

            const { data: currentLeave, error: fetchErr } = await client
                .from('leave_requests')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (fetchErr || !currentLeave) {
                return res.status(404).json({ error: 'Leave request not found' });
            }

            const isApproved = status === 'Approved';
            if (isApproved && (!isLeaveDate(currentLeave.start_date) || !isLeaveDate(currentLeave.end_date) || currentLeave.end_date < currentLeave.start_date || Date.parse(currentLeave.end_date) - Date.parse(currentLeave.start_date) > 365 * 86400000)) return res.status(400).json({ error: 'A valid leave range of at most 366 days is required.' });
            const leaveIsPaid = isApproved 
                ? (pay_type === 'without_pay' || is_paid === false ? false : true)
                : false;

            const requestedPool = req.body.credit_pool;
            const historicalPaidRetry = currentLeave.status === 'Approved' && !currentLeave.credit_pool && !currentLeave.requested_pay_type && requestedPool == null && !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(currentLeave.notes || '');
            const creditPool = isApproved && leaveIsPaid && isCreditLeaveType(currentLeave.type) && !historicalPaidRetry ? 'sil' : null;
            if (requestedPool != null && (requestedPool !== 'sil' || !creditPool)) return res.status(400).json({ error: 'Only statutory SIL credits can fund approved ordinary paid leave.' });
            const paymentMismatch = isApproved ? getLeavePaymentMismatch(currentLeave, leaveIsPaid ? 'with_pay' : 'without_pay', creditPool) : '';
            if (paymentMismatch) return res.status(409).json({ code: 'LEAVE_PAYMENT_PREFERENCE_CHANGED', error: paymentMismatch });
            if (req.body.expected_status !== undefined) {
                if (!['New', 'Pending', 'Approved', 'Rejected'].includes(req.body.expected_status)) return res.status(400).json({ error: 'Invalid expected_status.' });
            }
            const requestId = req.body.request_id || randomUUID();
            if (!isCreditUuid(requestId)) return res.status(400).json({ error: 'Invalid request_id.' });
            const reviewed = req.body.expected_status !== undefined;
            const transaction = await client.rpc(reviewed ? 'set_leave_status_with_credits_reviewed' : 'set_leave_status_with_credits', {
                p_actor_id: req.user.id, p_leave_id: String(req.params.id), p_request_id: requestId,
                p_status: status, p_is_paid: leaveIsPaid, p_credit_pool: creditPool,
                ...(reviewed ? { p_expected_status: req.body.expected_status } : {}),
            });
            const legacy = transaction.error && ['PGRST202', '42883'].includes(transaction.error.code) && !creditPool && !currentLeave.credit_pool && !currentLeave.credit_operation_id && !currentLeave.requested_pay_type;
            if (transaction.error && !legacy) return sendCreditError(res, transaction.error);

            const rawNotes = currentLeave.notes || '';
            const cleanNotes = rawNotes
                .replace(/\[PAY_TYPE:[^\]]+\]/gi, '')
                .replace(/\[(PAID|UNPAID)\]/gi, '')
                .trim();

            const updatedNotes = isApproved
                ? `${cleanNotes} [PAY_TYPE:${leaveIsPaid ? 'WITH_PAY' : 'WITHOUT_PAY'}]`.trim()
                : cleanNotes;

            const legacyUnchanged = legacy && currentLeave.status === status && currentLeave.notes === updatedNotes;
            if (legacyUnchanged) transaction.data = { unchanged: true };
            if (legacy && req.body.expected_status !== undefined && currentLeave.status !== req.body.expected_status && !legacyUnchanged) return res.status(409).json({ error: 'This leave decision changed during review. Refresh before retrying.' });
            if (legacy && isApproved && !legacyUnchanged) {
                const attendance = await client.from('attendances').select('id, time_in, time_out')
                    .eq('employee_id', currentLeave.employee_id).gte('date', currentLeave.start_date).lte('date', currentLeave.end_date)
                    .or('time_in.not.is.null,time_out.not.is.null').limit(1);
                if (attendance.error || !Array.isArray(attendance.data)) return res.status(500).json({ error: 'Attendance conflicts could not be checked. Retry before approving.' });
                if (attendance.data.length) return sendCreditError(res, { message: 'ATTENDANCE_CONFLICT' });
            }
            const { data: updatedLeave, error } = legacyUnchanged ? { data: currentLeave, error: null } : legacy ? await client
                .from('leave_requests')
                .update({ 
                    status,
                    notes: updatedNotes
                })
                .eq('id', req.params.id)
                .eq('status', currentLeave.status)
                .select('*')
                .maybeSingle() : { data: transaction.data?.leave, error: null };

            if (error?.message === 'Use the leave approval transaction') return res.status(503).json({ code: 'LEAVE_APPROVAL_REVIEW_UNAVAILABLE', error: 'The reviewed leave approval migration must be installed before this decision can be saved.' });
            if (error) throw error;

            if (!updatedLeave) return res.status(409).json({ error: 'This leave decision changed during review. Refresh before retrying.' });

            invalidateCache(['/api/leaves', '/api/dashboard', '/api/attendance', '/api/payroll']);
            if (!legacy) refreshLeaveCredits(client, currentLeave.employee_id);
            try {
                const channel = client.channel(`monthly-attendance-live-${currentLeave.employee_id}`);
                Promise.resolve(channel.httpSend('LEAVE_STATUS_UPDATED', { employee_id: currentLeave.employee_id }))
                    .catch(() => {}).finally(() => client.removeChannel?.(channel)).catch(() => {});
            } catch { /* Channel retry fallback */ }

            if (updatedLeave && !transaction.data?.unchanged && !transaction.data?.replayed) {
                const { data: emp } = await client
                    .from('employees')
                    .select('id, company_id, first_name, last_name')
                    .eq('id', updatedLeave.employee_id)
                    .maybeSingle();

                const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
                const avatarUrl = emp?.company_id && emp?.id 
                    ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                    : null;

                const payNotice = isApproved ? ` (${leaveIsPaid ? 'With Pay' : 'Without Pay / Deducted'})` : '';

                await notify({
                    target: updatedLeave.employee_id,
                    title: `Leave Request: ${status}`,
                    text: `Your ${updatedLeave.type || 'leave'} request has been ${status.toLowerCase()}${payNotice}.`,
                    type: 'leave',
                    sender_id: emp?.id,
                    company_id: emp?.company_id,
                    sender_name: empName,
                    sender_avatar: avatarUrl
                }).catch(() => console.warn('[leaves] Approval saved; notification delivery failed.'));

                if (req.user.id) {
                    await audit({
                        log_name: 'leaves',
                        description: `Marked leave request ${req.params.id} as ${status}${isApproved ? (leaveIsPaid ? ' (With Pay)' : ' (Without Pay)') : ''}`,
                        subject_type: 'App\\Models\\LeaveRequest',
                        subject_id: req.params.id,
                        event: 'updated',
                        causer_id: req.user.id,
                        properties: { status, is_paid: leaveIsPaid, pay_type: leaveIsPaid ? 'with_pay' : 'without_pay' }
                    }).catch(() => console.warn('[leaves] Approval saved; audit delivery failed.'));
                }

                try {
                    const targetTopics = [
                        'admin-leaves-sync',
                        `employee-live-dashboard-${updatedLeave.employee_id}`,
                        `dashboard-disciplinary-sync-${updatedLeave.employee_id}`
                    ];
                    const broadcastPayload = {
                        id: req.params.id,
                        employee_id: updatedLeave.employee_id,
                        status,
                        is_paid: leaveIsPaid,
                        pay_type: leaveIsPaid ? 'with_pay' : 'without_pay',
                        updated_at: new Date().toISOString()
                    };
                    targetTopics.forEach(topic => {
                        client.channel(topic).send({
                            type: 'broadcast',
                            event: 'LEAVE_STATUS_UPDATED',
                            payload: broadcastPayload
                        }).catch(() => {});
                    });
                } catch (_) {}
            }

            res.json({ 
                success: true, 
                message: `Leave request ${status.toLowerCase()} successfully!`,
                leave: {
                    ...updatedLeave,
                    status,
                    is_paid: leaveIsPaid,
                    pay_type: leaveIsPaid ? 'with_pay' : 'without_pay',
                    notes: cleanNotes
                },
                is_paid: leaveIsPaid,
                pay_type: leaveIsPaid ? 'with_pay' : 'without_pay'
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

export default createLeavesRouter();
