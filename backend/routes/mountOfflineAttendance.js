import { supabase } from '../supabaseClient.js';
import { createOfflineReadiness } from '../services/offlineReadiness.js';

export async function mountOfflineAttendance(app, verifyToken, env = process.env, loadRouter = () => import('./attendanceOffline.js'), availability = createOfflineReadiness(supabase, env)) {
    app.get('/api/attendance-offline/availability', verifyToken, async (_req, res) => res.json(await availability()));
    const requireReady = async (_req, res, next) => {
        const status = await availability();
        if (status.ready) return next();
        res.setHeader('Retry-After', '60');
        res.status(503).json({ code: status.code, error: status.enabled ? 'Offline attendance setup is incomplete. Contact your administrator.' : 'Offline attendance is disabled on this server.' });
    };
    if (env.OFFLINE_ATTENDANCE_ENABLED !== 'true') {
        app.use('/api/attendance-offline', verifyToken, requireReady);
        return false;
    }
    const { default: router } = await loadRouter();
    app.use('/api/attendance-offline', verifyToken, requireReady, router);
    return true;
}
