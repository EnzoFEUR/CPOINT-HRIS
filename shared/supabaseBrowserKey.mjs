export function isPublicSupabaseKey(key) {
    if (typeof key !== 'string' || !key) return false;
    if (key.startsWith('sb_publishable_')) return key.length > 'sb_publishable_'.length;
    try {
        const segments = key.split('.');
        return segments.length === 3 && JSON.parse(atob(segments[1].replaceAll('-', '+').replaceAll('_', '/'))).role === 'anon';
    } catch { return false; }
}
