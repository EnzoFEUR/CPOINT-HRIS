import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const notifFilePath = path.join(__dirname, '../data/notifications.json');

const router = express.Router();

const initNotifs = () => {
    if (!fs.existsSync(path.join(__dirname, '../data'))) {
        fs.mkdirSync(path.join(__dirname, '../data'));
    }
    if (!fs.existsSync(notifFilePath)) {
        fs.writeFileSync(notifFilePath, JSON.stringify([]));
    }
};
initNotifs();

// GET notifications for a user
router.get('/', (req, res) => {
    try {
        const { user_id, role } = req.query;
        if (!user_id) return res.status(400).json({ error: 'User ID is required' });

        const notifs = JSON.parse(fs.readFileSync(notifFilePath, 'utf8'));
        
        // Filter: If admin, show 'admin' target notifications. If employee, show their specific ID.
        const userNotifs = notifs.filter(n => {
            if (role === 'admin' && n.target === 'admin') return true;
            if (n.target === user_id) return true;
            return false;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(userNotifs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export const createNotification = async ({ target, title, text, type }) => {
    const notifs = JSON.parse(fs.readFileSync(notifFilePath, 'utf8'));
    const newNotif = {
        id: uuidv4(),
        target,
        title,
        text,
        type: type || 'system',
        read: false,
        created_at: new Date().toISOString()
    };
    notifs.push(newNotif);
    fs.writeFileSync(notifFilePath, JSON.stringify(notifs, null, 2));

    const channel = supabase.channel('system-notifications');
    await channel.send({
        type: 'broadcast',
        event: 'NEW_NOTIFICATION',
        payload: newNotif
    });
    return newNotif;
};

// POST new notification
router.post('/', async (req, res) => {
    try {
        const newNotif = await createNotification(req.body);
        res.json({ success: true, notification: newNotif });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark all as read for user
router.put('/read-all', (req, res) => {
    try {
        const { user_id, role } = req.body;
        const notifs = JSON.parse(fs.readFileSync(notifFilePath, 'utf8'));
        
        const updatedNotifs = notifs.map(n => {
            if (role === 'admin' && n.target === 'admin') return { ...n, read: true };
            if (n.target === user_id) return { ...n, read: true };
            return n;
        });

        fs.writeFileSync(notifFilePath, JSON.stringify(updatedNotifs, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
