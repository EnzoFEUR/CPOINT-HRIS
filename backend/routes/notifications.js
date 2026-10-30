import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { postgrestValue } from '../middleware/requestValidation.js';
import { HUMAN_TEXT_LIMITS } from '../../shared/inputLimits.mjs';

const router = express.Router();
const MAX_NOTIFICATION_MESSAGE_LENGTH = 1000;

export function authorizeNotifications(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication is required.' });
    const input = req.method === 'GET' ? req.query : req.body || {};
    const target = req.method === 'POST' ? input.target : input.user_id || (req.method === 'GET' ? req.user.id : undefined);
    if (!target) return res.status(400).json({ error: 'A notification target is required.' });
    const manager = hasVerifiedManagerRole(req.user);
    const own = [req.user.id, req.user.auth_user_id, req.user.company_id].includes(target);
    const managerRoleRequested = ['admin', 'hr', 'hr_manager'].includes(input.role);
    if ((!manager && managerRoleRequested && input.role !== req.user.role) || (!manager && !own && !(req.method === 'POST' && target === 'admin'))) {
        return res.status(403).json({ error: 'You may only access your own notifications.' });
    }
    next();
}

// GET notifications for a user (15-second in-memory response cache)
router.get('/', authorizeNotifications, cacheResponse(15), async (req, res) => {
    try {
        const user_id = req.query.user_id || req.user.id;
        const role = req.query.role || req.user.role;
        if (!user_id) return res.status(400).json({ error: 'User ID is required' });

        let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
        
        if (hasVerifiedManagerRole(req.user) && ['admin', 'hr', 'hr_manager'].includes(role)) {
            query = query.or(`target.eq.admin,target.eq.${postgrestValue(user_id)}`);
        } else {
            query = query.eq('target', user_id);
        }

        const { data: notifications, error } = await query;
        if (error) throw error;
        if (!notifications?.length) return res.json([]);

        // Fetch active employees to enrich notifications with real biometric photos and names
        const { data: employees } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, biometric_baseline_path');

        const empMap = new Map();
        (employees || []).forEach(emp => {
            empMap.set(emp.id, emp);
            if (emp.company_id) empMap.set(emp.company_id, emp);
            if (emp.first_name && emp.last_name) {
                const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
                empMap.set(fullName, emp);
            }
        });

        const enriched = (notifications || []).map(notif => {
            let matchedEmp = null;
            if (notif.sender_id && empMap.has(notif.sender_id)) {
                matchedEmp = empMap.get(notif.sender_id);
            } else if (notif.target && empMap.has(notif.target)) {
                matchedEmp = empMap.get(notif.target);
            } else {
                for (const emp of (employees || [])) {
                    const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
                    if (
                        (notif.title && notif.title.toLowerCase().includes(fullName)) ||
                        (notif.text && notif.text.toLowerCase().includes(fullName))
                    ) {
                        matchedEmp = emp;
                        break;
                    }
                }
            }

            const company_id = notif.company_id || matchedEmp?.company_id || null;
            const sender_id = notif.sender_id || matchedEmp?.id || null;
            const sender_name = notif.sender_name || (matchedEmp ? `${matchedEmp.first_name} ${matchedEmp.last_name}` : null);
            
            let sender_avatar = notif.sender_avatar || null;
            if (!sender_avatar && matchedEmp) {
                if (matchedEmp.biometric_baseline_path) {
                    sender_avatar = matchedEmp.biometric_baseline_path.startsWith('http')
                        ? matchedEmp.biometric_baseline_path
                        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${matchedEmp.biometric_baseline_path.replace(/^\/+/, '')}`;
                } else if (company_id && sender_id) {
                    sender_avatar = `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${company_id}/${sender_id}.jpg`;
                }
            }

            return {
                ...notif,
                company_id,
                sender_id,
                sender_name,
                sender_avatar
            };
        });

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export const createNotification = async ({ target, title, text, type, sender_id, company_id, sender_name, sender_avatar }) => {
    const { data: newNotif, error } = await supabase
        .from('notifications')
        .insert({
            target,
            title,
            text,
            type: type || 'system',
            read: false
        })
        .select()
        .single();
        
    if (error) {
        console.error('Error inserting notification to DB:', error);
        return null;
    }

    // Auto-resolve avatar and sender info if missing
    let resolvedAvatar = sender_avatar || null;
    let resolvedName = sender_name || null;
    let resolvedCompanyId = company_id || null;
    let resolvedSenderId = sender_id || null;

    try {
        const empLookupId = sender_id || (target !== 'admin' ? target : null);
        let matchedEmp = null;
        if (empLookupId) {
            const { data } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name, biometric_baseline_path')
                .eq('id', empLookupId)
                .maybeSingle();
            matchedEmp = data;
        }
        if (matchedEmp) {
            resolvedCompanyId = resolvedCompanyId || matchedEmp.company_id;
            resolvedSenderId = resolvedSenderId || matchedEmp.id;
            resolvedName = resolvedName || `${matchedEmp.first_name} ${matchedEmp.last_name}`;
            if (!resolvedAvatar) {
                if (matchedEmp.biometric_baseline_path) {
                    resolvedAvatar = matchedEmp.biometric_baseline_path.startsWith('http')
                        ? matchedEmp.biometric_baseline_path
                        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${matchedEmp.biometric_baseline_path.replace(/^\/+/, '')}`;
                } else if (matchedEmp.company_id && matchedEmp.id) {
                    resolvedAvatar = `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${matchedEmp.company_id}/${matchedEmp.id}.jpg`;
                }
            }
        }
    } catch {
        // Fallback silently
    }

    const enrichedPayload = {
        ...newNotif,
        sender_id: resolvedSenderId,
        company_id: resolvedCompanyId,
        sender_name: resolvedName,
        sender_avatar: resolvedAvatar
    };

    // Realtime table events enforce recipient RLS; personal alerts must not use a public broadcast.

    // Dispatch push notification to user devices
    import('../services/pushService.js')
        .then(({ sendPushToUser }) => {
            sendPushToUser(target, {
                title,
                body: text,
                type: type || 'system',
                url: target === 'admin' ? '/admin/leaves' : '/employee/dashboard'
            }).catch(err => console.error('[PUSH_DISPATCH] Error:', err.message));
        })
        .catch(err => console.error('[PUSH_IMPORT] Error:', err.message));

    invalidateCache('/api/notifications');
    return enrichedPayload;
};

// POST new notification
router.post('/', authorizeNotifications, async (req, res) => {
    try {
        if ((req.body.type !== undefined && (typeof req.body.type !== 'string' || req.body.type.length > 80)) ||
            typeof req.body.target !== 'string' || !req.body.target.trim() || req.body.target.length > 128) {
            return res.status(400).json({ error: 'Provide a valid notification target and a type of at most 80 characters.' });
        }
        if (String(req.body.type || '').trim().toLowerCase() === 'employment_exit' ||
            req.body.exit_request_id !== undefined || req.body.exit_event_id !== undefined) {
            return res.status(400).json({ error: 'Employment Exit alerts are created only from verified case actions.' });
        }
        const { text, title } = req.body;
        if (typeof text !== 'string' || text.length > MAX_NOTIFICATION_MESSAGE_LENGTH || !text.trim()) {
            return res.status(400).json({ error: 'Notification text is required and must be at most 1000 characters.' });
        }
        if (title !== undefined && (typeof title !== 'string' || title.length > HUMAN_TEXT_LIMITS.title || !title.trim())) {
            return res.status(400).json({ error: `Notification title must be nonempty text of at most ${HUMAN_TEXT_LIMITS.title} characters.` });
        }
        const payload = hasVerifiedManagerRole(req.user) ? req.body : { ...req.body, sender_id: req.user.id, company_id: req.user.company_id, sender_name: `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() };
        const newNotif = await createNotification(payload);
        if (!newNotif) return res.status(500).json({ error: 'Failed to create notification' });
        res.json({ success: true, notification: newNotif });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark all as read for user
router.put('/read-all', authorizeNotifications, async (req, res) => {
    try {
        const { user_id, role } = req.body;
        
        let query = supabase.from('notifications').update({ read: true }).eq('read', false);
        
        if (hasVerifiedManagerRole(req.user) && ['admin', 'hr', 'hr_manager'].includes(role)) {
            query = query.or(`target.eq.admin,target.eq.${postgrestValue(user_id)}`);
        } else {
            query = query.eq('target', user_id);
        }

        const { error } = await query;
        if (error) throw error;

        invalidateCache('/api/notifications');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
