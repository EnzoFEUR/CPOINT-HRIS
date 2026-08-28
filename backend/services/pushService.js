import webpush from 'web-push';
import { supabase } from '../supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BODVOdkLj9t7eOmAvZ2wg3dCJxUtXOJGrofizabwWrG5qrfaHRojeeOWuwNKsQ6qbGdeXkoeg21IS8n11AfU85E';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '5oswtEit-CBoOd44VXX3iKcWWKRFWWASRbRsuxyBiAk';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@cpointhris.com';

// Configure Web Push with VAPID credentials
try {
    webpush.setVapidDetails(
        VAPID_SUBJECT,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
} catch (vapidErr) {
    console.error('VAPID setup error:', vapidErr.message);
}

export const getVapidPublicKey = () => VAPID_PUBLIC_KEY;

// In-memory subscription store with Supabase sync
const memorySubscriptions = new Map();

/**
 * Save or update a device push subscription for a user
 */
export const saveSubscription = async (userId, subscription, userAgent = '') => {
    if (!subscription || !subscription.endpoint || !subscription.keys) {
        throw new Error('Invalid subscription object');
    }

    const payload = {
        user_id: String(userId),
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: userAgent,
        updated_at: new Date().toISOString()
    };

    // Store in memory for instant delivery
    memorySubscriptions.set(subscription.endpoint, payload);

    try {
        await supabase
            .from('push_subscriptions')
            .upsert(payload, { onConflict: 'endpoint' });
    } catch (err) {
        // Silent fallback to memory storage if table is unavailable
    }

    return { success: true, data: payload };
};

/**
 * Remove a device push subscription
 */
export const removeSubscription = async (endpoint) => {
    memorySubscriptions.delete(endpoint);
    try {
        await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', endpoint);
    } catch (err) {
        // Silent fallback
    }
    return { success: true };
};

/**
 * Send a native OS lock-screen push notification to a specific user (or 'admin' group)
 */
export const sendPushToUser = async (target, payload) => {
    try {
        const targetStr = String(target);
        const subscriptionsMap = new Map();

        // 1. Gather from memory subscriptions
        for (const sub of memorySubscriptions.values()) {
            if (targetStr === 'admin') {
                if (sub.user_id === 'admin' || sub.user_id) {
                    subscriptionsMap.set(sub.endpoint, sub);
                }
            } else if (sub.user_id === targetStr) {
                subscriptionsMap.set(sub.endpoint, sub);
            }
        }

        // 2. Gather from Supabase push_subscriptions table if present
        try {
            let query = supabase.from('push_subscriptions').select('*');
            if (targetStr === 'admin') {
                const { data: admins } = await supabase.from('employees').select('id').eq('role', 'admin');
                const adminIds = (admins || []).map(a => a.id);
                if (adminIds.length > 0) {
                    query = query.or(`user_id.eq.admin,user_id.in.(${adminIds.join(',')})`);
                } else {
                    query = query.eq('user_id', 'admin');
                }
            } else {
                query = query.eq('user_id', targetStr);
            }

            const { data: dbSubs } = await query;
            if (Array.isArray(dbSubs)) {
                dbSubs.forEach(s => subscriptionsMap.set(s.endpoint, s));
            }
        } catch (dbErr) {
            // Memory storage fallback active
        }

        const subscriptions = Array.from(subscriptionsMap.values());
        if (subscriptions.length === 0) {
            return { sent: 0, failed: 0, message: 'No registered push devices found for user' };
        }

        const pushPayload = JSON.stringify({
            title: payload.title || 'C-Point HRIS',
            body: payload.body || payload.text || 'You have a new update in your HR portal.',
            icon: payload.icon || '/icon-192.png',
            badge: payload.badge || '/badge-72.png',
            url: payload.url || (targetStr === 'admin' ? '/admin/leaves' : '/employee/dashboard'),
            tag: payload.tag || payload.type || 'hris-alert',
            timestamp: Date.now()
        });

        const results = await Promise.allSettled(
            subscriptions.map(async (sub) => {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };

                try {
                    await webpush.sendNotification(pushSubscription, pushPayload);
                    return { status: 'sent', endpoint: sub.endpoint };
                } catch (pushErr) {
                    if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
                        await removeSubscription(sub.endpoint);
                    }
                    throw pushErr;
                }
            })
        );

        const sentCount = results.filter(r => r.status === 'fulfilled').length;
        const failedCount = results.filter(r => r.status === 'rejected').length;

        return { sent: sentCount, failed: failedCount };
    } catch (err) {
        return { sent: 0, failed: 0, error: err.message };
    }
};
