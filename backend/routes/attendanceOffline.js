import express from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabaseClient.js';
import { isWorkforceEmployee } from '../utils/workforce.js';
import { OfflineError, offlineConfig, isOfflineManager, requireOfflineManager, publicDeviceKey, verifyOfflineEvent, assertOfflineUuid, databaseError } from '../services/offlineAttendance.js';

export function createOfflineAttendanceRouter(client = supabase, env = process.env) {
    const router = express.Router();
    const syncWindows = new Map();
    router.use((req, res, next) => { try {
        if (!req.user?.id || req.user.employee_identity_verified !== true) throw new OfflineError(401, 'Verified employee authentication is required.');
        req.offlineConfig = offlineConfig(env); next();
    } catch (error) { next(error); } });
    const wrap = action => (req, res, next) => Promise.resolve(action(req, res)).catch(next);
    router.get('/sites', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        res.json({ sites: [...new Set(req.offlineConfig.sites)] });
    }));
    const deviceFor = async (req, id) => {
        assertOfflineUuid(id);
        const { data, error } = await client.from('offline_attendance_devices').select('*').eq('id', id).maybeSingle();
        databaseError(error);
        if (!data || data.company_scope !== req.offlineConfig.companyScope || !req.offlineConfig.sites.includes(data.site_id)) throw new OfflineError(404, 'Offline device not found.');
        if (data.revoked_at) throw new OfflineError(403, 'Offline device has been revoked.');
        if (!isOfflineManager(req.user) && !(req.user?.employee_identity_verified === true && req.user.id === data.operator_id && req.user.is_active !== false && !['inactive','suspended','terminated','resigned','separated'].includes(String(req.user.status || '').toLowerCase()))) throw new OfflineError(403, 'Only the assigned operator may use this device.');
        return data;
    };
    const rosterFor = async (device, config) => {
        const generatedAt = new Date().toISOString();
        const expiresAt = new Date(Math.min(Date.parse(device.expires_at), Date.now() + config.hours * 3600000)).toISOString();
        if (Date.parse(expiresAt) <= Date.now()) throw new OfflineError(403, 'Device lease expired. Enroll the device again.');
        const employees = [];
        for (let offset = 0; ; offset += 1000) {
            const { data, error } = await client.from('employees').select('id,company_id,first_name,last_name,role,status,is_active,archived_at,department,job_title').order('id').range(offset, offset + 999);
            databaseError(error);
            if (!Array.isArray(data)) throw new OfflineError(503, 'Roster unavailable.');
            employees.push(...data.filter(employee => employee.is_active !== false && !employee.archived_at && isWorkforceEmployee(employee)).map(({ id, company_id, first_name, last_name }) => ({ id, company_id, first_name, last_name })));
            if (data.length < 1000) break;
        }
        const version = randomUUID();
        const { error } = await client.from('offline_attendance_rosters').insert({ version, device_id: device.id, generated_at: generatedAt, expires_at: expiresAt, employee_ids: employees.map(employee => employee.id) });
        databaseError(error);
        return { device: { id: device.id, operator_id: device.operator_id, company_scope: device.company_scope, site_id: device.site_id, expires_at: device.expires_at, offline_hours: config.hours }, roster: { version, generated_at: generatedAt, expires_at: expiresAt, employees }, server_time: generatedAt };
    };
    router.post('/devices', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        const { public_key, operator_id, operator_email, site_id } = req.body || {};
        publicDeviceKey(public_key);
        if (!req.offlineConfig.sites.includes(site_id)) throw new OfflineError(400, 'Select a configured site.');
        let lookup;
        if (operator_email !== undefined) {
            if (operator_id !== undefined || typeof operator_email !== 'string' || operator_email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator_email.trim())) throw new OfflineError(400, 'Enter the security operator’s email address.');
            const email = operator_email.trim().toLowerCase();
            lookup = await client.from('employees').select('id,role,status,is_active,archived_at').ilike('email', email.replace(/[\\%_]/g, '\\$&')).limit(2);
            databaseError(lookup.error);
            if (lookup.data?.length !== 1) throw new OfflineError(400, 'No unique scanner operator matches this email. Ask HR to check the employee account.');
            lookup = { data: lookup.data[0] };
        } else {
            assertOfflineUuid(operator_id);
            lookup = await client.from('employees').select('id,role,status,is_active,archived_at').eq('id', operator_id).maybeSingle();
        }
        const { data: operator, error: operatorError } = lookup;
        databaseError(operatorError);
        if (!operator || operator.is_active === false || operator.archived_at || !['security','guard','security_guard','admin','hr','superadmin'].includes(operator.role) || ['inactive','suspended','terminated','resigned','separated'].includes(String(operator.status || '').toLowerCase())) throw new OfflineError(400, 'Select an active scanner operator.');
        const device = { id: randomUUID(), operator_id: operator.id, company_scope: req.offlineConfig.companyScope, site_id, public_key: { kty: public_key.kty, crv: public_key.crv, x: public_key.x, y: public_key.y }, enrolled_by: req.user.id, authorized_by: req.user.id, authorized_at: new Date().toISOString(), expires_at: new Date(Date.now() + req.offlineConfig.hours * 3600000).toISOString() };
        const { error } = await client.from('offline_attendance_devices').insert(device); databaseError(error);
        res.status(201).json(await rosterFor(device, req.offlineConfig));
    }));
    router.get('/devices/:id/roster', wrap(async (req, res) => res.json(await rosterFor(await deviceFor(req, req.params.id), req.offlineConfig))));
    router.get('/devices/:id/events', wrap(async (req, res) => {
        const device = await deviceFor(req, req.params.id);
        const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
        if (!ids.length || ids.length > 50) throw new OfflineError(400, 'Select between 1 and 50 event receipts.');
        ids.forEach(assertOfflineUuid);
        const { data, error } = await client.from('offline_attendance_events').select('event_id,status,received_at').eq('device_id', device.id).in('event_id', ids);
        databaseError(error);
        res.json({ results: data });
    }));
    router.post('/devices/:id/renew', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        const device = await deviceFor(req, req.params.id);
        const { public_key, operator_id, site_id } = req.body || {};
        publicDeviceKey(public_key);
        if (device.operator_id !== operator_id || device.site_id !== site_id || ['kty', 'crv', 'x', 'y'].some(key => device.public_key[key] !== public_key[key])) throw new OfflineError(409, 'Renew this terminal with its existing operator, site and key. Pending records must be reconciled before reassignment.');
        const expires_at = new Date(Date.now() + req.offlineConfig.hours * 3600000).toISOString();
        const { data: renewed, error } = await client.from('offline_attendance_devices').update({ expires_at, authorized_at: new Date().toISOString(), authorized_by: req.user.id }).eq('id', device.id).is('revoked_at', null).select('id').maybeSingle();
        databaseError(error);
        if (!renewed) throw new OfflineError(403, 'This device was revoked while renewal was being processed.');
        res.json(await rosterFor({ ...device, expires_at }, req.offlineConfig));
    }));
    router.get('/devices/:id/status', wrap(async (req, res) => {
        const device = await deviceFor(req, req.params.id);
        res.json({ device: { id: device.id, operator_id: device.operator_id, company_scope: device.company_scope, site_id: device.site_id, expires_at: device.expires_at, offline_hours: req.offlineConfig.hours }, server_time: new Date().toISOString() });
    }));
    router.post('/sync', wrap(async (req, res) => {
        const now = Date.now();
        for (const [actor, window] of syncWindows) if (window.expires <= now) syncWindows.delete(actor);
        const window = syncWindows.get(req.user.id) || { expires: now + 60000, count: 0 };
        if (window.count >= 6) throw new OfflineError(429, 'Wait before retrying offline synchronization.');
        window.count++; syncWindows.set(req.user.id, window);
        const { device_id, events } = req.body || {};
        if (!Array.isArray(events) || !events.length || events.length > 100) throw new OfflineError(400, 'Submit between 1 and 100 events.');
        const device = await deviceFor(req, device_id);
        const results = [];
        for (const event of events) {
            try {
                assertOfflineUuid(event?.payload?.roster_snapshot_version);
                const { data: snapshot, error } = await client.from('offline_attendance_rosters').select('*').eq('version', event.payload.roster_snapshot_version).eq('device_id', device.id).maybeSingle();
                databaseError(error);
                if (!snapshot) throw new OfflineError(403, 'Roster snapshot not found.');
                const hash = verifyOfflineEvent(event, device, snapshot, req.offlineConfig);
                const result = await client.rpc('receive_offline_attendance_event', { p_actor_id: req.user.id, p_payload: event.payload, p_signature: event.signature, p_hash: hash });
                databaseError(result.error);
                results.push(result.data);
            } catch (error) { results.push({ event_id: event?.payload?.event_id || null, status: 'error', http_status: error.status || 400, error: error.status ? error.message : 'Invalid offline event.' }); }
        }
        res.json({ results });
    }));
    router.get('/events', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        const statuses = ['needs_review','rejected','needs_verification'];
        const status = req.query.status || 'needs_review';
        if (!statuses.includes(status)) throw new OfflineError(400, 'Invalid review status.');
        const { data, error } = await client.from('offline_attendance_events').select('*').eq('company_scope', req.offlineConfig.companyScope).in('site_id', req.offlineConfig.sites).eq('status', status).order('received_at').limit(250);
        databaseError(error);
        const employeeIds = [...new Set((data || []).map(event => event.employee_id))];
        const { data: employees, error: employeeError } = employeeIds.length ? await client.from('employees').select('id,first_name,last_name,company_id,status,is_active,archived_at').in('id', employeeIds) : { data: [] };
        databaseError(employeeError);
        const names = new Map((employees || []).map(employee => [employee.id, employee]));
        res.json({ events: (data || []).map(event => ({ ...event, employee_name: [names.get(event.employee_id)?.first_name, names.get(event.employee_id)?.last_name].filter(Boolean).join(' '), current_eligible: names.get(event.employee_id)?.is_active !== false && !names.get(event.employee_id)?.archived_at && String(names.get(event.employee_id)?.status || '').toLowerCase() === 'active' })) });
    }));
    router.get('/events/:id/history', wrap(async (req, res) => {
        requireOfflineManager(req.user); assertOfflineUuid(req.params.id);
        const { data: event, error: eventError } = await client.from('offline_attendance_events').select('company_scope,site_id').eq('event_id', req.params.id).maybeSingle();
        databaseError(eventError);
        if (!event || event.company_scope !== req.offlineConfig.companyScope || !req.offlineConfig.sites.includes(event.site_id)) throw new OfflineError(404, 'Offline event not found.');
        const { data, error } = await client.from('offline_attendance_decisions').select('actor_id,decision,reason,created_at').eq('event_id', req.params.id).order('created_at').limit(100);
        databaseError(error); res.json({ decisions: data });
    }));
    router.post('/events/:id/decision', wrap(async (req, res) => {
        requireOfflineManager(req.user); assertOfflineUuid(req.params.id);
        const { decision, reason, corrected_at } = req.body || {};
        if (!['approve','reject','needs_verification'].includes(decision) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new OfflineError(400, 'A review decision and reason are required.');
        if (decision === 'approve') throw new OfflineError(503, 'Offline approval is not released. Payroll concurrency and database verification are required before attendance can be changed.');
        if (corrected_at != null) throw new OfflineError(400, 'Timestamp corrections are available only with approval.');
        const { data, error } = await client.rpc('decide_offline_attendance_event', { p_actor_id: req.user.id, p_event_id: req.params.id, p_decision: decision, p_reason: reason.trim(), p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites });
        databaseError(error); res.json(data);
    }));
    router.post('/devices/:id/revoke', wrap(async (req, res) => {
        requireOfflineManager(req.user); const device = await deviceFor(req, req.params.id);
        const { error } = await client.from('offline_attendance_devices').update({ revoked_at: new Date().toISOString(), revoked_by: req.user.id }).eq('id', device.id);
        databaseError(error); res.json({ id: device.id, revoked: true });
    }));
    router.use((error, req, res, next) => { res.status(error.status || 500).json({ error: error.status ? error.message : 'Offline attendance request failed.' }); });
    return router;
}

export default createOfflineAttendanceRouter();
