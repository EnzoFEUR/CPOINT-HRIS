import webpush from 'web-push';
import { supabase } from '../supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@cpointhris.com';

// Configure Web Push with VAPID credentials if set in environment
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(
            VAPID_SUBJECT,
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY
        );
    } catch (vapidErr) {
        console.error('[VAPID] Configuration error:', vapidErr.message);
    }
}

export const getVapidPublicKey = () => VAPID_PUBLIC_KEY;

const pushError = (status, message) => Object.assign(new Error(message), { status });

function validateEndpoint(endpoint) {
    let url;
    try { url = new URL(endpoint); } catch { /* Report the same bounded input error below. */ }
    const host = url?.hostname;
    const provider = host === 'fcm.googleapis.com' || host === 'web.push.apple.com' ||
        host?.endsWith('.push.services.mozilla.com') || host?.endsWith('.notify.windows.com');
    if (typeof endpoint !== 'string' || endpoint.length > 2048 || /[\s\x00-\x1f\x7f]/.test(endpoint) ||
        !provider || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) {
        throw pushError(400, 'Provide a valid HTTPS browser push endpoint.');
    }
}

function validateUserId(userId) {
    if (typeof userId !== 'string' || !userId.trim() || userId.length > 128 || userId === 'admin') {
        throw pushError(400, 'A valid employee ID is required.');
    }
}

async function readDatabase(query) {
    let result;
    try { result = await query; }
    catch { throw pushError(503, 'Push service unavailable. Please retry shortly.'); }
    if (result.error?.code === '23505') throw pushError(409, 'This device registration changed. Please retry.');
    if (result.error) throw pushError(503, 'Push service unavailable. Please retry shortly.');
    return result.data;
}

async function checkOwner(endpoint, userId) {
    const existing = await readDatabase(supabase.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).maybeSingle());
    if (existing && existing.user_id !== userId) throw pushError(403, 'This device belongs to another account.');
    return existing;
}

/**
 * Save or update a device push subscription for a user
 */
export const saveSubscription = async (userId, subscription, userAgent = '') => {
    validateUserId(userId);
    validateEndpoint(subscription?.endpoint);
    const keys = subscription?.keys;
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' ||
        keys.p256dh.length > 90 || keys.auth.length > 24 ||
        !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(keys.auth) ||
        Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.p256dh, 'base64url')[0] !== 4 ||
        Buffer.from(keys.auth, 'base64url').length !== 16) {
        throw pushError(400, 'Valid browser push encryption keys are required.');
    }

    const payload = {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: String(userAgent).slice(0, 512),
        updated_at: new Date().toISOString()
    };

    const existing = await checkOwner(subscription.endpoint, userId);
    // Unique endpoint insertion and owner-constrained updates also protect concurrent registrations.
    const query = existing
        ? supabase.from('push_subscriptions').update(payload).eq('endpoint', subscription.endpoint).eq('user_id', userId)
        : supabase.from('push_subscriptions').insert(payload);
    const saved = await readDatabase(query.select('endpoint').maybeSingle());
    if (!saved) throw pushError(409, 'This device registration changed. Please retry.');
    return { success: true };
};

/**
 * Remove a device push subscription
 */
export const removeSubscription = async (endpoint, userId) => {
    validateUserId(userId);
    validateEndpoint(endpoint);
    await checkOwner(endpoint, userId);
    await readDatabase(supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', userId));
    return { success: true };
};

/**
 * Send a native OS lock-screen push notification to a specific user (or 'admin' group)
 */
export const sendPushToUser = async (target, payload) => {
    try {
        const targetStr = String(target);
        let query = supabase.from('push_subscriptions').select('user_id,endpoint,p256dh,auth');
        if (targetStr === 'admin') {
            // Match shared notification recipient RLS, using current authoritative employee roles.
            const admins = await readDatabase(supabase.from('employees').select('id')
                .in('role', ['admin', 'hr']).eq('is_active', true).ilike('status', 'active')
                .is('archived_at', null).is('deleted_at', null));
            if (!admins?.length) return { sent: 0, failed: 0, message: 'No authorized push recipients found' };
            query = query.in('user_id', admins.map(employee => employee.id));
        } else {
            validateUserId(target);
            query = query.eq('user_id', targetStr);
        }
        const subscriptions = await readDatabase(query) || [];
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
                validateEndpoint(sub.endpoint);
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
                        // An expired delivery must not delete another owner's or renewed device registration.
                        await readDatabase(supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
                            .eq('user_id', sub.user_id).eq('p256dh', sub.p256dh).eq('auth', sub.auth));
                    }
                    throw pushErr;
                }
            })
        );

        const sentCount = results.filter(r => r.status === 'fulfilled').length;
        const failedCount = results.filter(r => r.status === 'rejected').length;

        return { sent: sentCount, failed: failedCount };
    } catch (err) {
        return { sent: 0, failed: 0, error: 'Push service unavailable. Please retry shortly.' };
    }
};
