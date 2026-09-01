import { fetchWithAuth } from './api';
import toast from 'react-hot-toast';

const DEFAULT_VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

/**
 * Convert base64 url string to Uint8Array for PushManager
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Check if the browser and OS support Web Push
 */
export const isPushSupported = () => {
    return (
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );
};

/**
 * Get current browser notification permission
 */
export const getNotificationPermission = () => {
    if (!isPushSupported()) return 'unsupported';
    return Notification.permission;
};

/**
 * Request notification permission and register device subscription
 */
export const subscribeUserToPush = async (userId, silent = false) => {
    if (!isPushSupported()) {
        if (!silent) toast.error('Push notifications are not supported on this browser.');
        return { success: false, error: 'Unsupported' };
    }

    try {
        // 1. Request OS Permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            if (!silent) toast.error('Notification permission denied by user.');
            return { success: false, error: 'Permission denied' };
        }

        // 2. Wait for Service Worker registration
        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) {
            if (!silent) toast.error('PushManager not available on this Service Worker.');
            return { success: false, error: 'PushManager unavailable' };
        }

        // 3. Get VAPID Public Key
        let vapidPublicKey = DEFAULT_VAPID_PUBLIC_KEY;
        try {
            const keyRes = await fetchWithAuth('/api/push/public-key');
            if (keyRes.ok) {
                const keyData = await keyRes.json();
                if (keyData.publicKey) vapidPublicKey = keyData.publicKey;
            }
        } catch (e) {
            console.warn('[PUSH] Using default public key fallback');
        }

        // 4. Subscribe to browser push service
        const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedKey
            });
        }

        // 5. Save subscription to backend database
        const subJson = subscription.toJSON();
        const res = await fetchWithAuth('/api/push/subscribe', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                subscription: subJson
            })
        });

        let data = {};
        try {
            data = await res.json();
        } catch {
            data = { error: 'Server response unavailable' };
        }

        if (res.ok && data.success) {
            if (!silent) toast.success('Phone lock-screen notifications enabled!', { duration: 4000 });
            return { success: true, subscription };
        } else {
            if (!silent) toast.error(data.error || 'Failed to register subscription.');
            return { success: false, error: data.error };
        }
    } catch (err) {
        console.error('[PUSH_REGISTER] Error:', err);
        if (!silent) toast.error('Failed to enable push notifications: ' + err.message);
        return { success: false, error: err.message };
    }
};

/**
 * Send a test push notification to verify the phone buzzes
 */
export const sendTestPush = async (userId) => {
    try {
        // Ensure this device is registered with the backend
        await subscribeUserToPush(userId, true);

        const res = await fetchWithAuth('/api/push/test', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId })
        });
        
        let data = {};
        try {
            data = await res.json();
        } catch {
            data = { error: 'Server response unavailable' };
        }

        if (res.ok && data.success) {
            // Trigger local notification for verification
            try {
                const reg = await navigator.serviceWorker.ready;
                await reg.showNotification('C-Point HRIS', {
                    body: 'Native phone lock-screen alert received.',
                    icon: '/icon-192.png',
                    badge: '/badge-72.png',
                    vibrate: [200, 100, 200],
                    tag: 'test-push',
                    renotify: true
                });
            } catch (swErr) {
                console.warn('[SW_NOTIF] Direct notification note:', swErr);
            }

            toast.success('Test notification sent! Check your phone.');
            return data;
        } else {
            toast.error(data.error || 'Failed to send test push.');
            return { success: false, error: data.error };
        }
    } catch (err) {
        toast.error('Network Error: ' + err.message);
        return { success: false, error: err.message };
    }
};
