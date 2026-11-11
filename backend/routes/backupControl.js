import express from 'express';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const missing = error => ['PGRST202','42883','42P01'].includes(error?.code);
const errors = {
    BACKUP_FORBIDDEN: [403, 'Only an active, verified administrator can manage backups.'],
    BACKUP_INVALID: [400, 'Choose a valid backup action and try again.'],
    BACKUP_BUSY: [409, 'A backup task is already in progress.'],
    BACKUP_COOLDOWN: [429, 'Please wait a few minutes before starting another task of this type.'],
    BACKUP_WORKER_UNAVAILABLE: [503, 'The backup computer is unavailable. Turn it on and check its connection.'],
    BACKUP_IDEMPOTENCY_CONFLICT: [409, 'This request has already been used. Refresh the page and try again.'],
    BACKUP_HOSTED_CONTROLS: [409, 'Use Cloud backup controls to run or check a hosted backup.'],
};

export function createBackupControlRouter(client) {
    const router = express.Router();
    router.use((req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Sign in to manage backups.' });
        if (req.user.role !== 'admin' || !hasVerifiedManagerRole(req.user)) return res.status(403).json({ error: errors.BACKUP_FORBIDDEN[1] });
        next();
    });
    router.use(express.json({ limit: '1kb' }));
    const fail = (res, error, action) => {
        const code = Object.keys(errors).find(value => error?.message?.split(':')[0] === value) || 'BACKUP_UNAVAILABLE';
        const [status, message] = errors[code] || [503, 'The backup service needs attention. Please try again later.'];
        if (status === 429) res.setHeader('Retry-After', action === 'create' ? '300' : '60');
        return res.status(status).json({ error: missing(error) ? 'The backup service has not been configured yet.' : message, code });
    };
    router.get('/status', async (req, res) => {
        try {
            const { data, error } = await client.rpc('hris_backup_status', { p_actor_id: req.user.id });
            if (missing(error)) return res.json({ configured: false, worker_online: false, latest_backup: null, last_check_at: null, active_job: null, history: [] });
            if (error) return fail(res, error);
            res.json({ ...data, configured: true });
        } catch { fail(res); }
    });
    router.post('/jobs', async (req, res) => {
        const body = req.body;
        if (!body || Array.isArray(body) || Object.keys(body).length !== 2 || Object.keys(body).some(key => !['action','operation_id'].includes(key))
            || !['create','check'].includes(body.action) || typeof body.operation_id !== 'string' || !uuid.test(body.operation_id)) {
            return res.status(400).json({ error: 'Choose Create Backup or Check Backup and try again.' });
        }
        try {
            const { data, error } = await client.rpc('hris_backup_request', { p_actor_id: req.user.id, p_operation_id: body.operation_id, p_action: body.action });
            if (error) return fail(res, error, body.action);
            res.status(202).json({ id: data.id, status: data.status });
        } catch { fail(res); }
    });
    router.use((error, _req, res, _next) => res.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'The backup request could not be read.' }));
    return router;
}
