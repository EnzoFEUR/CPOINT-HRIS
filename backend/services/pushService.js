import webpush from 'web-push';
import { supabase } from '../supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BPJ9MCFzg2K4kELE60QBJGUQDbzaZ16-ereDk-pQbBx6n_69RQ58MqOEfTYs2tLDCrEWcDGSdbjtZXEqfmwvRIk';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'eHDF9N3R_s2rR_TZl_3yeYlFy28Of_tFv3ycSZhB-G0';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@cpointhris.com';

// Configure Web Push with VAPID credentials
webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

export const getVapidPublicKey = () => VAPID_PUBLIC_KEY;

/**
 * Save or update a device push subscription for a user
 */
export const saveSubscription = async (userId, subscription, userAgent = '') => {
    if (!subscription || !subscription.endpoint || !subscription.keys) {
        throw new Error('Invalid subscription object');
    }

    try {
        const payload = {
            user_id: userId,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            user_agent: userAgent,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('push_subscriptions')
            .upsert(payload, { onConflict: 'endpoint' })
            .select('*');

        if (error) {
            console.warn('[PUSH_SERVICE] Database table push_subscriptions note:', error.message);
        }

        return { success: true, data };
    } catch (err) {
        console.error('[PUSH_SERVICE] Error saving subscription:', err.message);
        return { success: false, error: err.message };
    }
};

/**
 * Remove a device push subscription
 */
export const removeSubscription = async (endpoint) => {
    try {
        await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', endpoint);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

/**
 * Send a native OS lock-screen push notification to a specific user (or 'admin' group)
 */
export const sendPushToUser = async (target, payload) => {
    try {
        let query = supabase.from('push_subscriptions').select('*');

        if (target === 'admin') {
            // Find all admin user IDs
            const { data: admins } = await supabase
                .from('employees')
                .select('id')
                .eq('role', 'admin');
            
            const adminIds = (admins || []).map(a => a.id);
            if (adminIds.length > 0) {
                query = query.or(`user_id.eq.admin,user_id.in.(${adminIds.join(',')})`);
            } else {
                query = query.eq('user_id', 'admin');
            }
        } else {
            query = query.eq('user_id', target);
        }

        const { data: subscriptions, error } = await query;
        if (error || !subscriptions || subscriptions.length === 0) {
            return { sent: 0, failed: 0 };
        }

        const pushPayload = JSON.stringify({
            title: payload.title || 'C-Point HRIS Notification',
            body: payload.body || payload.text || 'You have a new update in your HR portal.',
            icon: payload.icon || '/icon-192.png',
            badge: payload.badge || '/badge-72.png',
            url: payload.url || (target === 'admin' ? '/admin/leaves' : '/employee/dashboard'),
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
                    // Purge expired subscriptions (404 Not Found or 410 Gone)
                    if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
                        console.log('[PUSH_SERVICE] Purging expired push endpoint:', sub.endpoint);
                        await removeSubscription(sub.endpoint);
                    }
                    throw pushErr;
                }
            })
        );

        const sentCount = results.filter(r => r.status === 'fulfilled').length;
        const failedCount = results.filter(r => r.status === 'rejected').length;

        console.log(`[PUSH_SERVICE] Dispatched push to target ${target}: ${sentCount} sent, ${failedCount} failed.`);
        return { sent: sentCount, failed: failedCount };
    } catch (err) {
        console.error('[PUSH_SERVICE] Dispatch failed:', err.message);
        return { sent: 0, failed: 0, error: err.message };
    }
};
