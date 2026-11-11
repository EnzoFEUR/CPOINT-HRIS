import express from 'express';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { validateHolidayCommand, validHolidayDate } from '../../shared/holidayCalendar.mjs';
import { isCreditUuid } from '../../shared/leaveCredits.mjs';
import { readHolidayCalendar, applicableHolidays, publicHolidayItems, missingHolidaySchema } from '../services/holidayCalendar.js';

const messages = {
    HOLIDAY_FORBIDDEN: [403, 'Verified HR or administrator access is required.'],
    HOLIDAY_INVALID: [400, 'Check the holiday date, source, personnel coverage and input limits.'],
    HOLIDAY_NOT_FOUND: [404, 'This holiday was not found.'],
    HOLIDAY_CHANGED: [409, 'This holiday changed. Refresh before trying again.'],
    HOLIDAY_DUPLICATE: [409, 'An overlapping record of this same declaration already exists.'],
    HOLIDAY_OVERLAP_REVIEW_REQUIRED: [409, 'This combination overlaps another declaration. Review the applicable payroll rule before publishing.'],
    HOLIDAY_IDEMPOTENCY_CONFLICT: [409, 'This request identifier was already used for a different change.'],
    HOLIDAY_RECONCILIATION_REQUIRED: [409, 'Approved leave overlaps this change. Reconcile the affected leave through its review workflow before publishing.'],
};

export function holidayRouteError(res, error) {
    const code = error?.code?.startsWith('HOLIDAY_') ? error.code : error?.message?.split(':')[0];
    const [status, message] = messages[code] || (missingHolidaySchema(error) ? [503, 'Install the dynamic holiday calendar migration before managing holidays.']
        : error?.status ? [error.status, error.message] : [503, 'Holiday calendar could not be verified. Please retry.']);
    return res.status(status).json({ error: message, code: code || 'HOLIDAY_UNAVAILABLE' });
}

export function createHolidayRouter(client) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'private, no-store');
        if (!req.user) return res.status(401).json({ error: 'Sign in to view the holiday calendar.' });
        next();
    });
    const manager = (req, res, next) => hasVerifiedManagerRole(req.user) ? next() : res.status(403).json({ error: messages.HOLIDAY_FORBIDDEN[1] });
    const range = query => {
        const year = Number(query.year || new Date().getFullYear());
        const start = query.start || `${year}-01-01`, end = query.end || `${year}-12-31`;
        if (!Number.isInteger(year) || year < 1990 || year > 2100 || !validHolidayDate(start) || !validHolidayDate(end)
            || start > end || Date.parse(end) - Date.parse(start) > 366 * 86400000) throw Object.assign(new Error('Choose a valid holiday range of up to 367 days.'), { status: 400 });
        return { start, end };
    };
    router.get('/version', async (_req, res) => {
        try {
        const { data, error } = await client.from('holiday_calendar_state').select('version').eq('id', 1).maybeSingle();
        if (missingHolidaySchema(error)) return res.json({ configured: false, version: null });
        if (error || !data) return holidayRouteError(res, error);
        res.json({ configured: true, version: Number(data.version) });
        } catch (error) { holidayRouteError(res, error); }
    });
    router.get('/applicable', async (req, res) => {
        try {
            const employeeId = hasVerifiedManagerRole(req.user) && req.query.employee_id ? req.query.employee_id : req.user.id;
            if (!isCreditUuid(employeeId)) return res.status(400).json({ error: 'Invalid employee identifier.' });
            if (req.query.employee_id && req.query.employee_id !== req.user.id && !hasVerifiedManagerRole(req.user)) return res.status(403).json({ error: 'You can view only your applicable holiday calendar.' });
            const { start, end } = range(req.query);
            const calendar = await readHolidayCalendar(client, start, end, employeeId);
            res.json({ ...calendar, items: publicHolidayItems(applicableHolidays(calendar, employeeId)) });
        } catch (error) { holidayRouteError(res, error); }
    });
    router.get('/employees', manager, async (_req, res) => {
        try {
            const { data, error, count } = await client.from('employees').select('id,first_name,last_name,company_id,department', { count: 'exact' })
                .eq('role', 'employee').is('deleted_at', null).order('last_name').limit(1000);
            if (error) throw error;
            if (count !== data.length) throw new Error('Personnel list is incomplete.');
            res.json({ items: data });
        } catch (error) { holidayRouteError(res, error); }
    });
    router.get('/', manager, async (req, res) => {
        try {
            const { start, end } = range(req.query);
            const calendar = await readHolidayCalendar(client, start, end);
            const { data, error, count } = await client.from('holidays').select('*', { count: 'exact' }).gte('date', start).lte('date', end).order('date').limit(1000);
            if (error) throw error;
            if (count !== data.length) throw new Error('Holiday register is incomplete.');
            res.json({ ...calendar, items: data });
        } catch (error) { holidayRouteError(res, error); }
    });
    router.post('/commands', manager, async (req, res) => {
        try {
            const { operation_id, ...command } = validateHolidayCommand(req.body);
            const { data, error } = await client.rpc('hris_holiday_command', { p_actor_id: req.user.id, p_operation_id: operation_id, p_command: command });
            if (error) throw error;
            invalidateCache(['/api/payroll', '/api/attendance', '/api/dashboard', '/api/leaves', '/api/leave-credits', '/api/holidays']);
            res.json(data);
        } catch (error) { holidayRouteError(res, error); }
    });
    router.get('/:id/history', manager, async (req, res) => {
        try {
            if (!isCreditUuid(req.params.id)) return res.status(400).json({ error: 'Invalid holiday identifier.' });
            const { data, error } = await client.from('holiday_calendar_events').select('id,action,actor_id,before_record,after_record,impact,created_at,command')
                .eq('holiday_id', req.params.id).order('created_at', { ascending: false }).limit(100);
            if (error) throw error;
            res.json({ items: data });
        } catch (error) { holidayRouteError(res, error); }
    });
    return router;
}
