import { useSyncExternalStore, useCallback } from 'react';

const cooldownEvent = 'cpoint_otp_cooldown_changed';
const memoryExpiries = new Map();

/**
 * Enterprise OTP Cooldown Hook
 * - Absolute timestamp persistence in localStorage prevents resets on navigation, refresh, or back button
 * - Calculates remaining time with 0ms delay on initial mount
 * - Drift-free countdown based on Date.now()
 * - Real-time cross-tab synchronization via storage event
 */
export function useOtpCooldown(scopeKey, defaultDuration = 60) {
    const normalizedKey = String(scopeKey || 'global').toLowerCase().trim();
    const storageKey = `cpoint_otp_cooldown_${encodeURIComponent(normalizedKey)}`;

    const getExpiresAt = useCallback(() => {
        if (memoryExpiries.has(storageKey)) return memoryExpiries.get(storageKey);
        try {
            const expiresAt = Number(localStorage.getItem(storageKey));
            return Number.isFinite(expiresAt) ? expiresAt : 0;
        } catch {
            return 0;
        }
    }, [storageKey]);

    const getRemaining = useCallback(() => Math.max(0, Math.ceil((getExpiresAt() - Date.now()) / 1000)), [getExpiresAt]);

    const startCooldown = useCallback((duration = defaultDuration) => {
        const seconds = Number(duration);
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        // A stale status response must not shorten an active server send limit.
        const expiresAt = Math.max(getExpiresAt(), Date.now() + seconds * 1000);
        try {
            localStorage.setItem(storageKey, String(expiresAt));
            memoryExpiries.delete(storageKey);
        } catch {
            memoryExpiries.set(storageKey, expiresAt);
        }
        window.dispatchEvent(new CustomEvent(cooldownEvent, { detail: storageKey }));
    }, [storageKey, defaultDuration, getExpiresAt]);

    const clearCooldown = useCallback(() => {
        try {
            localStorage.removeItem(storageKey);
            memoryExpiries.delete(storageKey);
        } catch {
            memoryExpiries.set(storageKey, 0);
        }
        window.dispatchEvent(new CustomEvent(cooldownEvent, { detail: storageKey }));
    }, [storageKey]);

    const subscribe = useCallback((onChange) => {
        let timer;
        const sync = () => {
            if (getRemaining() > 0) {
                if (timer === undefined) timer = setInterval(sync, 1000);
            } else {
                clearInterval(timer);
                timer = undefined;
                if (memoryExpiries.get(storageKey) > 0) memoryExpiries.delete(storageKey);
            }
            onChange();
        };

        // Keep listeners active at zero so another screen or tab can start the timer.
        const handleStorageChange = (e) => {
            if (e.key === storageKey || e.key === null) {
                memoryExpiries.delete(storageKey);
                sync();
            }
        };
        const handleLocalChange = (e) => { if (e.detail === storageKey) sync(); };
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener(cooldownEvent, handleLocalChange);
        window.addEventListener('focus', sync);
        document.addEventListener('visibilitychange', sync);
        sync();

        return () => {
            clearInterval(timer);
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener(cooldownEvent, handleLocalChange);
            window.removeEventListener('focus', sync);
            document.removeEventListener('visibilitychange', sync);
        };
    }, [storageKey, getRemaining]);

    const cooldown = useSyncExternalStore(subscribe, getRemaining, () => 0);

    const formattedTime = `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, '0')}`;

    return {
        cooldown,
        isCooldown: cooldown > 0,
        formattedTime,
        startCooldown,
        clearCooldown,
        getRemaining
    };
}
