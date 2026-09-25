import { useState, useEffect, useCallback } from 'react';

/**
 * Enterprise OTP Cooldown Hook
 * - Absolute timestamp persistence in localStorage prevents resets on navigation, refresh, or back button
 * - Calculates remaining time with 0ms delay on initial mount
 * - Drift-free countdown based on Date.now()
 * - Real-time cross-tab synchronization via storage event
 */
export function useOtpCooldown(scopeKey, defaultDuration = 60) {
    const sanitizedKey = String(scopeKey || 'global').toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '_');
    const storageKey = `cpoint_otp_cooldown_${sanitizedKey}`;

    const getRemaining = useCallback(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            if (!stored) return 0;
            const expiresAt = parseInt(stored, 10);
            if (isNaN(expiresAt)) return 0;
            const diff = Math.ceil((expiresAt - Date.now()) / 1000);
            if (diff <= 0) {
                localStorage.removeItem(storageKey);
                return 0;
            }
            return diff;
        } catch {
            return 0;
        }
    }, [storageKey]);

    const [cooldown, setCooldown] = useState(getRemaining);

    const startCooldown = useCallback((duration = defaultDuration) => {
        const expiresAt = Date.now() + duration * 1000;
        try {
            localStorage.setItem(storageKey, String(expiresAt));
        } catch {}
        setCooldown(duration);
    }, [storageKey, defaultDuration]);

    const clearCooldown = useCallback(() => {
        try {
            localStorage.removeItem(storageKey);
        } catch {}
        setCooldown(0);
    }, [storageKey]);

    useEffect(() => {
        // Sync state on mount or key change
        const initialRemaining = getRemaining();
        setCooldown(initialRemaining);

        if (initialRemaining <= 0) return;

        const timer = setInterval(() => {
            const currentRemaining = getRemaining();
            setCooldown(currentRemaining);
            if (currentRemaining <= 0) {
                clearInterval(timer);
            }
        }, 1000);

        // Instant cross-tab synchronization
        const handleStorageChange = (e) => {
            if (e.key === storageKey) {
                setCooldown(getRemaining());
            }
        };
        window.addEventListener('storage', handleStorageChange);

        return () => {
            clearInterval(timer);
            window.removeEventListener('storage', handleStorageChange);
        };
    }, [storageKey, getRemaining]);

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
