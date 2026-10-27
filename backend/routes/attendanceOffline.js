import express from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../supabaseClient.js';
import { isWorkforceEmployee } from '../utils/workforce.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { canUseAttendanceTerminal } from '../../shared/offlineAttendance.mjs';
import { OfflineError, offlineConfig, isOfflineManager, requireOfflineManager, publicDeviceKey, verifyOfflineEvent, assertOfflineUuid, databaseError } from '../services/offlineAttendance.js';

export function createOfflineAttendanceRouter(client = supabase, env = process.env, loadWorkPolicy = async () => (await import('./payroll.js')).getActiveWorkPolicy()) {
    const router = express.Router();
    const syncWindows = new Map();
    let reviewChannel;
    const publishChange = () => {
        if (!client.channel) return;
        try {
            reviewChannel ||= client.channel('offline-attendance-review', { config: { private: true } });
            // Refresh signals contain no attendance evidence or employee identities.
            Promise.resolve(reviewChannel.httpSend('OFFLINE_ATTENDANCE_CHANGED', { changed: true }, { timeout: 2000 }))
                .catch(() => console.warn('[OFFLINE_REALTIME] Refresh signal unavailable; clients will poll.'));
        } catch { console.warn('[OFFLINE_REALTIME] Refresh signal unavailable; clients will poll.'); }
    };
    router.use((req, res, next) => { try {
        if (!req.user?.id || req.user.employee_identity_verified !== true) throw new OfflineError(401, 'Verified employee authentication is required.');
        if (/^\/(devices|sites|sync)(\/|$)/.test(req.path) && (req.user.role_verified !== true || !canUseAttendanceTerminal(req.user))) throw new OfflineError(403, 'Attendance terminals are restricted to Security Guard and Admin.');
        req.offlineConfig = offlineConfig(env); next();
    } catch (error) { next(error); } });
    const wrap = action => (req, res, next) => Promise.resolve(action(req, res)).then(() => {
        if (req.method === 'POST') publishChange();
    }).catch(next);
    const countsFor = async req => {
        const { data, error } = await client.rpc('offline_attendance_counts', { p_actor_id: req.user.id, p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites });
        databaseError(error);
        if (!data || ['needs_review', 'needs_verification', 'synced', 'rejected', 'all'].some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)) throw new OfflineError(503, 'Offline attendance counts are unavailable.');
        return data;
    };
    const approvalReady = async actor => {
        const { data, error } = await client.rpc('offline_attendance_approval_ready', { p_actor_id: actor });
        if (error?.code === 'PGRST202') return { available: false };
        databaseError(error);
        return { available: data?.available === true, ...(data?.missing_time_out === true ? { missing_time_out: true } : {}) };
    };
    const reviewPair = async (req, eventId, decision, reason, policy) => {
        const { data, error } = await client.rpc('review_offline_attendance_pair', { p_actor_id: req.user.id, p_event_id: eventId, p_decision: decision, p_reason: reason.trim(), p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites, p_policy: policy });
        if (error?.code === 'PGRST202') throw new OfflineError(503, 'Install 202610140004_offline_attendance_paired_review.sql before approving or rejecting complete shifts.');
        databaseError(error);
        return data;
    };
    router.get('/approval-status', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        res.json(await approvalReady(req.user.id));
    }));
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
        const attendance = [];
        const workDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
        const today = workDate(generatedAt);
        const earliest = workDate(Date.parse(generatedAt) - 18 * 3600000);
        for (let start = 0; start < employees.length; start += 200) {
            const employeeIds = employees.slice(start, start + 200).map(employee => employee.id);
            for (let offset = 0; ; offset += 1000) {
                const { data, error } = await client.from('attendances').select('employee_id,date,time_in,time_out').in('employee_id', employeeIds).gte('date', earliest).lte('date', today).order('id').range(offset, offset + 999);
                databaseError(error);
                if (!Array.isArray(data)) throw new OfflineError(503, 'Attendance snapshot unavailable. Retry roster refresh while connected.');
                attendance.push(...data.map(({ employee_id, date, time_in, time_out }) => ({ employee_id, date, time_in, time_out })));
                if (data.length < 1000) break;
            }
        }
        const version = randomUUID();
        const { error } = await client.from('offline_attendance_rosters').insert({ version, device_id: device.id, generated_at: generatedAt, expires_at: expiresAt, employee_ids: employees.map(employee => employee.id) });
        databaseError(error);
        return { device: { id: device.id, operator_id: device.operator_id, company_scope: device.company_scope, site_id: device.site_id, expires_at: device.expires_at, offline_hours: config.hours }, roster: { version, generated_at: generatedAt, expires_at: expiresAt, employees, attendance }, server_time: generatedAt };
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
        if (!canUseAttendanceTerminal(operator)) throw new OfflineError(400, 'Select an active Security Guard or Admin operator.');
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
        if (window.count >= 6) {
            const error = new OfflineError(429, 'Wait before retrying offline synchronization.');
            error.retryAfter = Math.max(1, Math.ceil((window.expires - now) / 1000));
            throw error;
        }
        window.count++; syncWindows.set(req.user.id, window);
        const { device_id, events } = req.body || {};
        if (!Array.isArray(events) || !events.length || events.length > 100) throw new OfflineError(400, 'Submit between 1 and 100 events.');
        const device = await deviceFor(req, device_id);
        const request_id = randomUUID();
        const results = [];
        const snapshots = new Map();
        for (const event of events) {
            let stage = 'event_validation';
            try {
                assertOfflineUuid(event?.payload?.roster_snapshot_version);
                stage = 'roster_lookup';
                const version = event.payload.roster_snapshot_version;
                let snapshot = snapshots.get(version);
                if (!snapshot) {
                    const { data, error } = await client.from('offline_attendance_rosters').select('*').eq('version', version).eq('device_id', device.id).maybeSingle();
                    databaseError(error);
                    if (!data) throw new OfflineError(403, 'Roster snapshot not found.');
                    snapshot = data;
                    snapshots.set(version, snapshot);
                }
                stage = 'signature_validation';
                const hash = verifyOfflineEvent(event, device, snapshot, req.offlineConfig);
                stage = 'receipt_transaction';
                const result = await client.rpc('receive_offline_attendance_event', { p_actor_id: req.user.id, p_payload: event.payload, p_signature: event.signature, p_hash: hash });
                databaseError(result.error);
                if (result.data?.status === 'synced') result.data.reason_code = 'OFFLINE_HR_APPROVED';
                results.push(result.data);
            } catch (error) {
                const event_id = typeof event?.payload?.event_id === 'string' && /^[0-9a-f-]{36}$/i.test(event.payload.event_id) ? event.payload.event_id : null;
                const diagnostic = { request_id, stage, database_code: error.database_code, reason_code: error.reason_code };
                console.warn(JSON.stringify({ event: 'offline_attendance_sync_failed', event_id, device_id: device.id, http_status: error.status || 400, ...diagnostic, constraint: error.constraint }));
                results.push({ event_id: event?.payload?.event_id || null, status: 'error', http_status: error.status || 400, error: error.status ? error.message : 'Invalid offline event.', diagnostic });
            }
        }
        res.json({ results });
    }));
    router.get('/stats', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        res.json({ counts: await countsFor(req) });
    }));
    router.get('/events', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        const statuses = ['needs_review','rejected','needs_verification','synced','all'];
        const status = req.query.status || 'needs_review';
        if (!statuses.includes(status)) throw new OfflineError(400, 'Invalid review status.');
        let query = client.from('offline_attendance_events').select('*').eq('company_scope', req.offlineConfig.companyScope).in('site_id', req.offlineConfig.sites);
        if (status !== 'all') {
            query = query.eq('status', status);
        }
        const { data, error } = await query.order('received_at', { ascending: false }).limit(250);
        databaseError(error);

        const counts = await countsFor(req);

        const employeeIds = [...new Set((data || []).map(event => event.employee_id))];
        const { data: employees, error: employeeError } = employeeIds.length ? await client.from('employees').select('id,first_name,last_name,company_id,department,job_title,status,is_active,archived_at').in('id', employeeIds) : { data: [] };
        databaseError(employeeError);
        const empMap = new Map((employees || []).map(employee => [employee.id, employee]));
        let pairs = {};
        if (data?.length) {
            const result = await client.rpc('offline_attendance_review_pairs', { p_actor_id: req.user.id, p_event_ids: data.map(event => event.event_id), p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites });
            if (result.error?.code !== 'PGRST202') {
                databaseError(result.error);
                pairs = result.data || {};
            }
        }
        res.json({
            events: (data || []).map(event => {
                const emp = empMap.get(event.employee_id);
                return {
                    ...event,
                    employee: emp || null,
                    employee_name: [emp?.first_name, emp?.last_name].filter(Boolean).join(' ') || 'Unknown Worker',
                    employee_company_id: emp?.company_id || null,
                    review_pair: pairs[event.event_id] || { complete: false, can_approve: false, can_reject: false, issue: 'Paired review setup required' },
                    current_eligible: emp?.is_active !== false && !emp?.archived_at && String(emp?.status || '').toLowerCase() === 'active'
                };
            }),
            counts
        });
    }));
    router.post('/events/batch-decision', wrap(async (req, res) => {
        requireOfflineManager(req.user);
        const { event_ids, decision, reason } = req.body || {};
        if (!Array.isArray(event_ids) || !event_ids.length || event_ids.length > 50 || new Set(event_ids).size !== event_ids.length) throw new OfflineError(400, 'Submit between 1 and 50 unique events.');
        if (!['approve','reject','needs_verification'].includes(decision) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new OfflineError(400, 'A review decision and reason are required.');
        event_ids.forEach(assertOfflineUuid);
        const results = [];
        const policy = decision === 'approve' ? await loadWorkPolicy() : null;
        if (decision === 'approve' && !(await approvalReady(req.user.id)).available) {
            throw new OfflineError(503, 'Install the offline attendance approval migration before approving captures.');
        }
        for (const event_id of event_ids) {
            try {
                if (decision === 'approve') {
                    const data = await reviewPair(req, event_id, decision, reason, policy);
                    results.push({ event_id, status: 'synced', success: true, data });
                } else if (decision === 'reject') {
                    const data = await reviewPair(req, event_id, decision, reason, null);
                    results.push({ event_id, status: data?.status, success: true, data });
                } else {
                    const { data, error } = await client.rpc('decide_offline_attendance_event', { p_actor_id: req.user.id, p_event_id: event_id, p_decision: decision, p_reason: reason.trim(), p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites });
                    databaseError(error);
                    results.push({ event_id, status: data?.status, success: true, data });
                }
            } catch (err) {
                results.push({ event_id, success: false, error: err.message });
            }
        }
        if (decision === 'approve') {
            invalidateCache(['/api/attendance', '/api/dashboard']);
        }
        res.json({ results });
    }));
    router.get('/events/:id/history', wrap(async (req, res) => {
        requireOfflineManager(req.user); assertOfflineUuid(req.params.id);
        const { data: event, error: eventError } = await client.from('offline_attendance_events').select('company_scope,site_id').eq('event_id', req.params.id).maybeSingle();
        databaseError(eventError);
        if (!event || event.company_scope !== req.offlineConfig.companyScope || !req.offlineConfig.sites.includes(event.site_id)) throw new OfflineError(404, 'Offline event not found.');
        const { data, error } = await client.from('offline_attendance_decisions').select('actor_id,decision,reason,created_at').eq('event_id', req.params.id).order('created_at', { ascending: false }).limit(100);
        databaseError(error);
        const corrections = await client.from('offline_attendance_corrections').select('actor_id,reason,verified_time_out,created_at').eq('event_id', req.params.id);
        if (!['PGRST205', '42P01'].includes(corrections.error?.code)) databaseError(corrections.error);
        const history = [...(data || []), ...(corrections.data || []).map(entry => ({ ...entry, decision: 'resolve_missing_time_out' }))].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        const actorIds = [...new Set(history.map(d => d.actor_id))];
        const { data: actors } = actorIds.length ? await client.from('employees').select('id,first_name,last_name,company_id').in('id', actorIds) : { data: [] };
        const actorMap = new Map((actors || []).map(a => [a.id, a]));
        const enrichedDecisions = history.map(d => {
            const actor = actorMap.get(d.actor_id);
            return {
                ...d,
                actor_name: actor ? `${actor.first_name || ''} ${actor.last_name || ''}`.trim() : 'HR Administrator',
                actor_company_id: actor?.company_id || null
            };
        });
        res.json({ decisions: enrichedDecisions });
    }));
    router.post('/events/:id/resolve-time-out', wrap(async (req, res) => {
        requireOfflineManager(req.user); assertOfflineUuid(req.params.id);
        const { verified_time_out, reason } = req.body || {};
        const timestamp = typeof verified_time_out === 'string' ? Date.parse(verified_time_out) : NaN;
        const calendar = typeof verified_time_out === 'string' ? Date.parse(`${verified_time_out.slice(0, 10)}T00:00:00Z`) : NaN;
        if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000
            || typeof verified_time_out !== 'string' || verified_time_out.length > 40
            || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(verified_time_out)
            || verified_time_out.startsWith('0000') || !Number.isFinite(timestamp) || timestamp > Date.now()
            || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== verified_time_out.slice(0, 10)) {
            throw new OfflineError(400, 'Enter a valid, non-future verified Time Out with a timezone and a reason of up to 1000 characters.');
        }
        const { data, error } = await client.rpc('resolve_offline_missing_time_out', {
            p_actor_id: req.user.id, p_event_id: req.params.id, p_verified_time_out: new Date(timestamp).toISOString(),
            p_reason: reason.trim(), p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites,
            p_policy: await loadWorkPolicy(),
        });
        if (error?.code === 'PGRST202') throw new OfflineError(503, 'Install 202610180001_offline_missing_time_out.sql before resolving a missing Time Out.');
        databaseError(error);
        if (data?.status !== 'synced' || !data.attendance_reference) throw new OfflineError(503, 'The server did not confirm the attendance correction. Refresh before retrying.');
        invalidateCache(['/api/attendance', '/api/dashboard']);
        res.json(data);
    }));
    router.post('/events/:id/decision', wrap(async (req, res) => {
        requireOfflineManager(req.user); assertOfflineUuid(req.params.id);
        const { decision, reason, corrected_at } = req.body || {};
        if (!['approve','reject','needs_verification'].includes(decision) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new OfflineError(400, 'A review decision and reason are required.');
        if (corrected_at != null) throw new OfflineError(400, 'Timestamp corrections are available only with approval.');
        if (decision === 'approve') {
            if (!(await approvalReady(req.user.id)).available) throw new OfflineError(503, 'Install the offline attendance approval migration before approving captures.');
            const data = await reviewPair(req, req.params.id, decision, reason, await loadWorkPolicy());
            invalidateCache(['/api/attendance', '/api/dashboard']);
            return res.json(data);
        }
        if (decision === 'reject') return res.json(await reviewPair(req, req.params.id, decision, reason, null));
        const { data, error } = await client.rpc('decide_offline_attendance_event', { p_actor_id: req.user.id, p_event_id: req.params.id, p_decision: decision, p_reason: reason.trim(), p_company_scope: req.offlineConfig.companyScope, p_site_ids: req.offlineConfig.sites });
        databaseError(error); res.json(data);
    }));
    router.post('/devices/:id/revoke', wrap(async (req, res) => {
        requireOfflineManager(req.user); const device = await deviceFor(req, req.params.id);
        const { error } = await client.from('offline_attendance_devices').update({ revoked_at: new Date().toISOString(), revoked_by: req.user.id }).eq('id', device.id);
        databaseError(error); res.json({ id: device.id, revoked: true });
    }));
    router.use((error, req, res, next) => {
        if (error.status === 429 && error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'Offline attendance request failed.' });
    });
    return router;
}

export default createOfflineAttendanceRouter();
