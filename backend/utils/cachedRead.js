// Single-flight, short-lived cache for read-only operational probes, never financial mutations.
export function createCachedRead(read, { ttlMs = 2000, errorTtlMs = 1000 } = {}) {
    let value, error, expiresAt = 0, pending;
    return () => {
        if (Date.now() < expiresAt) return error ? Promise.reject(error) : Promise.resolve(value);
        if (!pending) pending = Promise.resolve().then(read).then(result => {
            value = result;
            error = null;
            expiresAt = Date.now() + ttlMs;
            return value;
        }, failure => {
            error = failure;
            expiresAt = Date.now() + errorTtlMs;
            throw failure;
        }).finally(() => { pending = null; });
        return pending;
    };
}
