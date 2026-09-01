import express from 'express';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

export const createAuditLog = async ({ log_name, description, subject_type, subject_id, event, causer_id, properties }) => {
    try {
        await supabase.from('activity_log').insert({
            log_name: log_name || 'system',
            description: description || event || 'Action performed',
            subject_type: subject_type || 'System',
            subject_id: subject_id || null,
            event: event || 'action',
            causer_type: 'App\\Models\\User',
            causer_id: causer_id || null,
            properties: properties || {}
        });
    } catch (err) {
        console.error("Failed to create audit log in activity_log, attempting fallback to audit_logs:", err.message);
        try {
            await supabase.from('audit_logs').insert({
                employee_id: causer_id || null,
                action: event || log_name || 'SYSTEM_ACTION',
                details: typeof properties === 'object' ? JSON.stringify(properties) : (description || ''),
                severity: 'info'
            });
        } catch (fallbackErr) {
            console.error("Fallback audit log insert failed:", fallbackErr.message);
        }
    }
};

router.get('/', async (req, res) => {
    try {
        const { date, user_id, limit = 250 } = req.query;

        // 1. Fetch from activity_log
        let actQuery = supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(Number(limit));
        if (date) {
            actQuery = actQuery.gte('created_at', `${date}T00:00:00Z`).lte('created_at', `${date}T23:59:59Z`);
        }
        if (user_id) {
            actQuery = actQuery.eq('causer_id', user_id);
        }

        // 2. Fetch from audit_logs
        let auditQuery = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(Number(limit));
        if (date) {
            auditQuery = auditQuery.gte('created_at', `${date}T00:00:00Z`).lte('created_at', `${date}T23:59:59Z`);
        }
        if (user_id) {
            auditQuery = auditQuery.eq('employee_id', user_id);
        }

        const [actRes, auditRes] = await Promise.allSettled([actQuery, auditQuery]);

        const rawActivity = actRes.status === 'fulfilled' && !actRes.value.error ? (actRes.value.data || []) : [];
        const rawAudit = auditRes.status === 'fulfilled' && !auditRes.value.error ? (auditRes.value.data || []) : [];

        // 3. Extract unique user/causer IDs to fetch employee names
        const causerIds = new Set();
        rawActivity.forEach(d => { if (d.causer_id) causerIds.add(d.causer_id); });
        rawAudit.forEach(d => { if (d.employee_id) causerIds.add(d.employee_id); });

        let usersMap = new Map();
        if (causerIds.size > 0) {
            const { data: users } = await supabase
                .from('employees')
                .select('id, first_name, last_name, email, role, company_id')
                .in('id', Array.from(causerIds));
            
            if (users) {
                users.forEach(u => {
                    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || 'Admin';
                    usersMap.set(u.id, { ...u, name: fullName });
                });
            }
        }

        // 4. Normalize activity_log entries
        const normalizedActivity = rawActivity.map(item => {
            const user = usersMap.get(item.causer_id);
            const action = (item.event || item.log_name || 'ACTION').toUpperCase();
            const targetType = (item.subject_type || item.log_name || 'System').replace(/^App\\Models\\/, '');
            
            return {
                id: item.id,
                created_at: item.created_at,
                event: item.event || 'action',
                action: action,
                log_name: item.log_name || 'activity',
                subject_type: targetType,
                target_type: targetType,
                subject_id: item.subject_id,
                target_id: item.subject_id,
                description: item.description || '',
                details: item.description || '',
                properties: item.properties || {},
                causer_id: item.causer_id,
                user_id: item.causer_id,
                causer: user ? { name: user.name, email: user.email } : null,
                user_name: user ? user.name : 'System',
                source: 'activity_log'
            };
        });

        // 5. Normalize audit_logs entries
        const normalizedAudit = rawAudit.map(item => {
            const user = usersMap.get(item.employee_id);
            let parsedDetails = item.details;
            if (typeof parsedDetails === 'string') {
                try { parsedDetails = JSON.parse(item.details); } catch {}
            }

            const action = (item.action || 'SYSTEM_EVENT').toUpperCase();
            let subjectType = 'Attendance';
            if (action.includes('SCAN') || action.includes('BIOMETRIC')) subjectType = 'Biometrics';
            else if (action.includes('PASSWORD') || action.includes('AUTH') || action.includes('LOGIN')) subjectType = 'Security';
            else if (action.includes('DOCUMENT')) subjectType = 'Document';

            let description = '';
            if (typeof parsedDetails === 'object' && parsedDetails !== null) {
                description = Object.entries(parsedDetails)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                    .join(', ');
            } else if (parsedDetails) {
                description = String(parsedDetails);
            }

            return {
                id: item.id,
                created_at: item.created_at,
                event: item.action?.toLowerCase() || 'event',
                action: action,
                log_name: subjectType.toLowerCase(),
                subject_type: subjectType,
                target_type: subjectType,
                subject_id: item.employee_id,
                target_id: item.employee_id,
                description: description || action,
                details: description || action,
                properties: typeof parsedDetails === 'object' ? parsedDetails : {},
                causer_id: item.employee_id,
                user_id: item.employee_id,
                causer: user ? { name: user.name, email: user.email } : null,
                user_name: user ? user.name : 'System Terminal',
                ip_address: item.ip_address || null,
                severity: item.severity || 'info',
                source: 'audit_logs'
            };
        });

        // 6. Merge and sort descending by created_at
        const allLogs = [...normalizedActivity, ...normalizedAudit].sort((a, b) => {
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        res.json({ success: true, data: allLogs });
    } catch (err) {
        console.error("Audit log router error:", err);
        res.status(500).json({ success: false, error: err.message, data: [] });
    }
});

export default router;
