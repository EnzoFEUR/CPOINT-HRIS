import { supabase } from '../supabaseClient';
import { fetchWithAuth } from './api';

const projectOrigin = new URL(supabase.supabaseUrl).origin;
const storagePrefix = '/storage/v1/object/';
const cache = new Map();
const pending = new Map();
const queued = new Map();
const listeners = new Set();
let sessionKey = '';
let generation = 0;
let scheduled = false;

// undefined means unrelated media; null means protected media with an invalid key.
export function privateMediaKey(source) {
    if (typeof source !== 'string' || !source) return undefined;
    let path = source.trim();
    if (/^(?:https?:)?\/\//i.test(path)) {
        let url;
        try { url = new URL(path, projectOrigin); } catch { return undefined; }
        if (url.origin !== projectOrigin) return undefined;
        // Inspect the original pathname: URL normalizes traversal segments away.
        let rawPath = path.replace(/^(?:https?:)?\/\/[^/]+/i, '').split(/[?#]/)[0];
        try { rawPath = decodeURIComponent(rawPath); } catch { return null; }
        const match = rawPath.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/public-bucket\/(.*)$/);
        if (!match) return undefined;
        path = match[1];
    } else {
        path = path.replace(/^\/+/, '');
        if (!/^(?:face-baselines|avatars|attendance)\//.test(path)) return undefined;
        try { path = decodeURIComponent(path); } catch { return null; }
    }
    if (/[\\%?#]/.test(path) || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
        || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return path;
}

export const getPrivateMediaSession = () => generation;
export const subscribePrivateMediaSession = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

function updateSession(session) {
    const key = session?.access_token && session?.user?.id ? `${session.user.id}:${session.access_token}` : '';
    if (key === sessionKey) return;
    sessionKey = key;
    generation++;
    cache.clear();
    for (const entry of pending.values()) entry.reject(new Error('MEDIA_SESSION_CHANGED'));
    pending.clear();
    queued.clear();
    for (const listener of listeners) listener();
}

const initialGeneration = generation;
const initialized = supabase.auth.getSession().then(({ data }) => {
    if (generation === initialGeneration) updateSession(data?.session);
}).catch(() => { if (generation === initialGeneration) updateSession(null); });
// Keep this callback synchronous: Supabase auth callbacks must not await auth APIs.
supabase.auth.onAuthStateChange((_event, session) => updateSession(session));

function signedResult(file, key) {
    if (file?.error === 'FORBIDDEN') throw new Error('MEDIA_FORBIDDEN');
    if (file?.error === 'INVALID_PATH') throw new Error('MEDIA_INVALID_PATH');
    if (!file?.url || file.error) throw new Error('MEDIA_UNAVAILABLE');
    const prefix = `${storagePrefix}sign/public-bucket/`;
    try {
        const url = new URL(file.url);
        if (url.origin !== projectOrigin || !url.pathname.startsWith(prefix) || decodeURIComponent(url.pathname.slice(prefix.length)) !== key) {
            throw new Error('MEDIA_INVALID_RESPONSE');
        }
    } catch { throw new Error('MEDIA_INVALID_RESPONSE'); }
    const expiresAt = Math.min(Date.parse(file.expires_at), Date.now() + 120000);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 5000) throw new Error('MEDIA_EXPIRED');
    return { url: file.url, expiresAt };
}

async function flush() {
    scheduled = false;
    const entries = [...queued.entries()];
    queued.clear();
    const requestGeneration = generation;
    for (let start = 0; start < entries.length; start += 40) {
        const batch = entries.slice(start, start + 40);
        try {
            if (requestGeneration !== generation) throw new Error('MEDIA_SESSION_CHANGED');
            const response = await fetchWithAuth('/api/storage/media-urls', {
                method: 'POST', cache: 'no-store', body: JSON.stringify({ paths: batch.map(([, entry]) => entry.source) }),
            });
            if (response.status === 401) throw new Error('MEDIA_UNAUTHENTICATED');
            if (response.status === 403) throw new Error('MEDIA_FORBIDDEN');
            if (!response.ok) throw new Error('MEDIA_UNAVAILABLE');
            const body = await response.json();
            if (requestGeneration !== generation) throw new Error('MEDIA_SESSION_CHANGED');
            if (!body.success || !Array.isArray(body.files)) throw new Error('MEDIA_INVALID_RESPONSE');
            const files = new Map(body.files.map(file => [file.path, file]));
            for (const [key, entry] of batch) {
                try {
                    const result = signedResult(files.get(entry.source), key);
                    cache.delete(key);
                    cache.set(key, result);
                    if (cache.size > 256) cache.delete(cache.keys().next().value);
                    entry.resolve(result);
                } catch (error) { entry.reject(error); }
            }
        } catch (error) {
            const failure = error?.message === 'Unauthorized' ? new Error('MEDIA_UNAUTHENTICATED') : error;
            for (const [, entry] of batch) entry.reject(failure);
        } finally {
            for (const [key, entry] of batch) {
                if (pending.get(key) === entry) pending.delete(key);
            }
        }
    }
}

function waitForMedia(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    let cancel;
    const aborted = new Promise((_, reject) => {
        cancel = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', cancel, { once: true });
    });
    return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', cancel));
}

export async function resolvePrivateMedia(source, { force = false, signal } = {}) {
    signal?.throwIfAborted();
    const key = privateMediaKey(source);
    if (key === undefined) return { url: source, expiresAt: null };
    if (key === null) throw new Error('MEDIA_INVALID_PATH');
    await waitForMedia(initialized, signal);
    if (!sessionKey) throw new Error('MEDIA_UNAUTHENTICATED');
    const existing = cache.get(key);
    if (!force && existing?.expiresAt > Date.now() + 5000) return existing;
    cache.delete(key);
    if (pending.has(key)) return waitForMedia(pending.get(key).promise, signal);
    const entry = { source };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    pending.set(key, entry);
    queued.set(key, entry);
    if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
    }
    return waitForMedia(entry.promise, signal);
}
