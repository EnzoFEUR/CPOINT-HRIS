import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPrivateMediaSession, privateMediaKey, resolvePrivateMedia, subscribePrivateMediaSession } from '../utils/privateMedia';

// Preserve the image's existing layout and event handlers while URLs remain session-bound.
export default function ProtectedImage({ src, onLoad, onError, loading = 'lazy', style, ...props }) {
    const session = useSyncExternalStore(subscribePrivateMediaSession, getPrivateMediaSession);
    const imageRef = useRef(null);
    const handlers = useRef({ onLoad, onError });
    const retried = useRef(false);
    const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState(null);
    const protectedMedia = privateMediaKey(src) !== undefined;
    const current = result?.src === src && result?.session === session ? result : null;

    useEffect(() => { handlers.current = { onLoad, onError }; }, [onLoad, onError]);
    useEffect(() => { retried.current = false; }, [src, session]);
    useEffect(() => {
        if (!protectedMedia || !imageRef.current) return;
        if (typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
        observer.observe(imageRef.current);
        return () => observer.disconnect();
    }, [src, protectedMedia, attempt, session, current?.url]);

    useEffect(() => {
        if (!protectedMedia || !visible) return;
        let active = true;
        let timer;
        const renew = async (force = false) => {
            try {
                const media = await resolvePrivateMedia(src, { force });
                if (!active || session !== getPrivateMediaSession()) return;
                setResult({ src, session, ...media });
                timer = setTimeout(() => renew(true), Math.max(1000, media.expiresAt - Date.now() - 5000));
            } catch (error) {
                if (!active || session !== getPrivateMediaSession()) return;
                setResult({ src, session, failed: true });
                if (imageRef.current) handlers.current.onError?.({ type: 'error', target: imageRef.current, currentTarget: imageRef.current });
                if (!['MEDIA_FORBIDDEN', 'MEDIA_INVALID_PATH', 'MEDIA_UNAUTHENTICATED', 'MEDIA_INVALID_RESPONSE'].includes(error?.message)) {
                    timer = setTimeout(() => renew(true), 15000);
                }
            }
        };
        renew(attempt > 0);
        return () => { active = false; clearTimeout(timer); };
    }, [src, session, protectedMedia, visible, attempt]);

    return <img
        {...props}
        key={`${session}:${attempt}:${current?.url || ''}`}
        ref={imageRef}
        src={protectedMedia ? current?.url : src}
        loading={loading}
        style={protectedMedia && !current?.url ? { ...style, visibility: 'hidden' } : style}
        onLoad={event => { retried.current = false; onLoad?.(event); }}
        onError={event => {
            if (protectedMedia && !retried.current) {
                retried.current = true;
                setAttempt(value => value + 1);
            } else {
                if (protectedMedia) setResult({ src, session, failed: true });
                onError?.(event);
            }
        }}
    />;
}
