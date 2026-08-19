import express from 'express';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// GET notifications for a user
router.get('/', async (req, res) => {
    try {
        const { user_id, role } = req.query;
        if (!user_id) return res.status(400).json({ error: 'User ID is required' });

        let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
        
        if (role === 'admin') {
            query = query.or(`target.eq.admin,target.eq.${user_id}`);
        } else {
            query = query.eq('target', user_id);
        }

        const { data: notifications, error } = await query;
        if (error) throw error;

        // Only fetch specific employees related to these notifications (targeted query, no full-table scan)
        const relevantEmpIds = Array.from(new Set(
            (notifications || [])
                .map(n => n.sender_id || (n.target !== 'admin' ? n.target : null))
                .filter(Boolean)
        ));

        let empMap = new Map();
        if (relevantEmpIds.length > 0) {
            const { data: employees } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name')
                .in('id', relevantEmpIds);

            (employees || []).forEach(emp => {
                empMap.set(emp.id, emp);
                const fullName = `${emp.first_name} ${emp.last_name}`.toLowerCase();
                empMap.set(fullName, emp);
            });
        }

        const enriched = (notifications || []).map(notif => {
            let matchedEmp = null;
            if (notif.sender_id && empMap.has(notif.sender_id)) {
                matchedEmp = empMap.get(notif.sender_id);
            } else if (notif.target && empMap.has(notif.target)) {
                matchedEmp = empMap.get(notif.target);
            } else {
                for (const emp of (employees || [])) {
                    const fullName = `${emp.first_name} ${emp.last_name}`;
                    if ((notif.title && notif.title.includes(fullName)) || (notif.text && notif.text.includes(fullName))) {
                        matchedEmp = emp;
                        break;
                    }
                }
            }

            const company_id = notif.company_id || matchedEmp?.company_id || null;
            const sender_id = notif.sender_id || matchedEmp?.id || null;
            const sender_name = notif.sender_name || (matchedEmp ? `${matchedEmp.first_name} ${matchedEmp.last_name}` : null);
            const sender_avatar = notif.sender_avatar || (company_id && sender_id 
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${company_id}/${sender_id}.jpg`
                : null);

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

    const enrichedPayload = {
        ...newNotif,
        sender_id,
        company_id,
        sender_name,
        sender_avatar
    };

    const channel = supabase.channel('system-notifications');
    await channel.send({
        type: 'broadcast',
        event: 'NEW_NOTIFICATION',
        payload: enrichedPayload
    });

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
router.post('/', async (req, res) => {
    try {
        const newNotif = await createNotification(req.body);
        if (!newNotif) return res.status(500).json({ error: 'Failed to create notification' });
        res.json({ success: true, notification: newNotif });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark all as read for user
router.put('/read-all', async (req, res) => {
    try {
        const { user_id, role } = req.body;
        
        let query = supabase.from('notifications').update({ read: true }).eq('read', false);
        
        if (role === 'admin') {
            query = query.or(`target.eq.admin,target.eq.${user_id}`);
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
