import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { postgrestValue } from '../middleware/requestValidation.js';

const router = express.Router();

export function authorizeNotifications(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication is required.' });
    const input = req.method === 'GET' ? req.query : req.body || {};
    const target = req.method === 'POST' ? input.target : input.user_id || (req.method === 'GET' ? req.user.id : undefined);
    if (!target) return res.status(400).json({ error: 'A notification target is required.' });
    const manager = hasVerifiedManagerRole(req.user);
    const own = [req.user.id, req.user.auth_user_id, req.user.company_id].includes(target);
    if ((!manager && input.role === 'admin') || (!manager && !own && !(req.method === 'POST' && target === 'admin'))) {
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
        
        if (role === 'admin') {
            query = query.or(`target.eq.admin,target.eq.${postgrestValue(user_id)}`);
        } else {
            query = query.eq('target', user_id);
        }

        const { data: notifications, error } = await query;
        if (error) throw error;

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

// Singleton Realtime Channel to prevent channel leaks and socket degradation
let systemNotifChannel = null;
const getSystemNotifChannel = () => {
    if (!systemNotifChannel) {
        systemNotifChannel = supabase.channel('system-notifications');
    }
    return systemNotifChannel;
};

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

    try {
        const channel = getSystemNotifChannel();
        await channel.send({
            type: 'broadcast',
            event: 'NEW_NOTIFICATION',
            payload: enrichedPayload
        });
    } catch (chErr) {
        console.warn('[NOTIF_BROADCAST_WARN]', chErr.message);
    }

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

    return enrichedPayload;
};

// POST new notification
router.post('/', authorizeNotifications, async (req, res) => {
    try {
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
        
        if (role === 'admin') {
            query = query.or(`target.eq.admin,target.eq.${postgrestValue(user_id)}`);
        } else {
            query = query.eq('target', user_id);
        }

        const { error } = await query;
        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
