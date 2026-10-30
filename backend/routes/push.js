import express from 'express';
import { getVapidPublicKey, saveSubscription, removeSubscription, sendPushToUser } from '../services/pushService.js';

const router = express.Router();

router.use((req, res, next) => {
    if (typeof req.user?.id !== 'string' || !req.user.id) return res.status(401).json({ error: 'Authentication is required.' });
    if (req.body?.user_id !== undefined && req.body.user_id !== req.user.id) {
        return res.status(403).json({ error: 'You may only manage your own push notifications.' });
    }
    next();
});

const pushError = (res, error) => {
    const status = [400, 403, 409].includes(error.status) ? error.status : 503;
    if (status === 503) res.setHeader('Retry-After', '2');
    return res.status(status).json({ error: status === 503 ? 'Push service unavailable. Please retry shortly.' : error.message });
};

// GET Public VAPID Key for client push registration
router.get('/public-key', (req, res) => {
    res.json({ publicKey: getVapidPublicKey() });
});

// POST Subscribe Device to Push Notifications
router.post('/subscribe', async (req, res) => {
    try {
        const userAgent = req.headers['user-agent'] || '';
        await saveSubscription(req.user.id, req.body?.subscription, userAgent);

        res.json({ success: true, message: 'Device subscribed to native push notifications.' });
    } catch (err) {
        pushError(res, err);
    }
});

// POST Unsubscribe Device
router.post('/unsubscribe', async (req, res) => {
    try {
        await removeSubscription(req.body?.endpoint, req.user.id);
        res.json({ success: true, message: 'Device unsubscribed from push notifications.' });
    } catch (err) {
        pushError(res, err);
    }
});

// POST Test Notification Buzz
router.post('/test', async (req, res) => {
    try {
        const result = await sendPushToUser(req.user.id, {
            title: 'C-Point HRIS',
            body: 'Native phone lock-screen notifications are active and ready.',
            url: '/employee/dashboard',
            tag: 'test-push'
        });

        if (result.error) return pushError(res, { status: 503 });
        res.json({ success: true, result });
    } catch (err) {
        pushError(res, err);
    }
});

export default router;
