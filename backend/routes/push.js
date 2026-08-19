import express from 'express';
import { getVapidPublicKey, saveSubscription, removeSubscription, sendPushToUser } from '../services/pushService.js';

const router = express.Router();

// GET Public VAPID Key for client push registration
router.get('/public-key', (req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
});

// POST Subscribe Device to Push Notifications
router.post('/subscribe', async (req, res) => {
    try {
        const { user_id, subscription } = req.body;
        const targetUserId = user_id || req.user?.id;

        if (!targetUserId) {
            return res.status(400).json({ error: 'User ID is required to register push subscription' });
        }

        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Valid push subscription object is required' });
        }

        const userAgent = req.headers['user-agent'] || '';
        const result = await saveSubscription(targetUserId, subscription, userAgent);

        res.json({ success: true, message: 'Device subscribed to native push notifications.', data: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST Unsubscribe Device
router.post('/unsubscribe', async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint is required' });
        }

        await removeSubscription(endpoint);
        res.json({ success: true, message: 'Device unsubscribed from push notifications.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST Test Notification Buzz
router.post('/test', async (req, res) => {
    try {
        const targetUserId = req.body.user_id || req.user?.id;
        if (!targetUserId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const result = await sendPushToUser(targetUserId, {
            title: 'C-Point HRIS',
            body: 'Native phone lock-screen notifications are active and ready.',
            url: '/employee/dashboard',
            tag: 'test-push'
        });

        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
