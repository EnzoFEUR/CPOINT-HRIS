import { getManilaWorkDate } from '../../shared/workPolicy.mjs';

// Process-local limits; provider quotas must also cover restarts and multiple replicas.
export function createSummaryCache({ now = Date.now, intervalMs = 10 * 60000, dailyLimit = 48 } = {}) {
    const entries = new Map();
    let budgetDay;
    let attempts = 0;
    const budget = () => {
        const day = getManilaWorkDate(now());
        if (day !== budgetDay) { budgetDay = day; attempts = 0; }
        return day;
    };
    const nextDay = day => Date.parse(`${day}T00:00:00+08:00`) + 86400000;
    const snapshot = (entry, key, day, fallback) => {
        const value = entry?.day === day ? entry.value : fallback?.();
        if (!value) return null;
        const limited = attempts >= dailyLimit;
        return {
            ...value,
            generated_at: entry?.day === day ? entry.generatedAt : null,
            refresh_after: new Date(Math.max(entry?.nextAttempt || 0, limited ? nextDay(day) : 0)).toISOString(),
            summary_status: limited ? 'daily_limit' : key !== undefined && entry?.key !== key ? 'deferred' : value.fallback ? 'fallback' : 'current',
        };
    };
    const reusable = (entry, key, day) => entry?.day === day && entry.value && (
        ((key === undefined || entry.key === key) && !entry.value.fallback) || now() < entry.nextAttempt || attempts >= dailyLimit
    );
    return {
        peek(topic, key) {
            const day = budget();
            const entry = entries.get(topic);
            return reusable(entry, key, day) ? snapshot(entry, key, day) : null;
        },
        async run(topic, key, generate, fallback) {
            const day = budget();
            let entry = entries.get(topic);
            if (entry?.inFlight) {
                await entry.inFlight;
                return snapshot(entry, key, budget(), fallback);
            }
            if (reusable(entry, key, day)) return snapshot(entry, key, day);
            if (attempts >= dailyLimit || now() < (entry?.nextAttempt || 0)) return snapshot(entry, key, day, fallback);

            attempts++;
            entry = { ...entry, nextAttempt: now() + intervalMs };
            entries.set(topic, entry);
            // Defer invocation until the shared promise is installed, including synchronous failures.
            entry.inFlight = Promise.resolve().then(generate).catch(() => fallback()).then(value => {
                Object.assign(entry, { key, day, value, generatedAt: value.fallback ? null : new Date(now()).toISOString() });
                return snapshot(entry, key, budget(), fallback);
            }).finally(() => { entry.inFlight = null; });
            return entry.inFlight;
        },
    };
}
