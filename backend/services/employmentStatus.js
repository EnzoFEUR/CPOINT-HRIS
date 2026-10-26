import { supabase, createIsolatedAuthClient } from '../supabaseClient.js';
import { disciplinaryService } from './disciplinaryService.js';
import { publishCommittedDisciplinary } from './disciplinaryEvents.js';
import { getManilaWorkDate } from '../../shared/workPolicy.mjs';

export function createEmploymentStatusHandler({ client = supabase, createAuthClient = createIsolatedAuthClient, service = disciplinaryService, onCommit = publishCommittedDisciplinary } = {}) {
    return async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ success: false, error: 'This action accepts no employee identifier.' });
        const match = /^Bearer (\S{1,8192})$/i.exec(req.headers.authorization || '');
        if (!match) return res.status(401).json({ success: false, error: 'Sign in before refreshing employment status.' });
        try {
            const { data, error } = await createAuthClient().auth.getUser(match[1]);
            const authId = data?.user?.id;
            if (error || !/^[a-f0-9-]{36}$/i.test(authId || '')) return res.status(401).json({ success: false, error: 'Your sign-in session could not be verified.' });
            const account = await client.from('employees').select('*')
                .or(`auth_user_id.eq.${authId},and(auth_user_id.is.null,id.eq.${authId})`)
                .abortSignal(AbortSignal.timeout(10000)).maybeSingle();
            if (account.error) throw account.error;
            let employee = account.data;
            if (!employee || employee.deleted_at) return res.status(403).json({ success: false, error: 'Employment account unavailable.' });
            if (String(employee.status).toLowerCase() === 'suspended' && !employee.archived_at) {
                const logs = await client.from('disciplinary_logs').select('id,reason')
                    .eq('employee_id', employee.id).eq('type', 'Suspension')
                    .in('status', ['Active', 'Action Required', 'Under Review', 'Acknowledged'])
                    .order('created_at', { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(10000));
                if (logs.error) throw logs.error;
                const record = logs.data?.[0];
                const until = record?.reason?.match(/Until\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
                if (until && until < getManilaWorkDate()) {
                    const committed = await service.expire(employee.id, record.id);
                    employee = { ...employee, ...committed.employee };
                    onCommit(committed);
                }
            }
            return res.json({ success: true, data: employee });
        } catch {
            return res.status(503).json({ success: false, error: 'Employment status could not be refreshed. Please retry.' });
        }
    };
}
