import express from 'express';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// GET notifications for a user
router.get('/', async (req, res) => {
    try {
        const { user_id, role } = req.query;
        if (!user_id) return res.status(400).json({ error: 'User ID is required' });

        let query = supabase.from('notifications').select('*').order('created_at', { ascending: false });
        
        if (role === 'admin') {
            query = query.or(`target.eq.admin,target.eq.${user_id}`);
        } else {
            query = query.eq('target', user_id);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json(data);
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
