import { supabase } from '../supabaseClient.js';

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const METHODS = new Set(['EMAIL_OTP', 'SMS_OTP', 'TOTP', 'BACKUP_CODE']);
const failure = (message, status = 503, code = 'LOGIN_VERIFICATION_UNAVAILABLE') => Object.assign(new Error(message), { status, code });

// Call only after Supabase has authenticated the bearer token; decoded claims alone are not identity proof.
export function readLoginSession(req, now = Date.now()) {
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
    let claims;
    try {
        if (token?.split('.').length !== 3) throw new Error();
        claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    } catch { throw failure('Your sign-in session could not be verified. Please sign in again.', 401, 'AUTH_SESSION_INVALID'); }
    const authUserId = req.user?._auth_user_id;
    if (!UUID.test(authUserId || '') || claims.sub !== authUserId || !UUID.test(claims.session_id || '') ||
        !Number.isFinite(claims.exp) || claims.exp * 1000 <= now) {
        throw failure('Your sign-in session has expired or is invalid. Please sign in again.', 401, 'AUTH_SESSION_INVALID');
    }
    return { authUserId, sessionId: claims.session_id };
}

export function createLoginSessionService(client, now = Date.now) {
    const cache = new Map();
    const pending = new Map();
    const keyFor = session => `${session.authUserId}:${session.sessionId}`;
    function remember(key, until) {
        if (cache.size >= 1024) cache.delete(cache.keys().next().value);
        cache.set(key, { until, checkUntil: Math.min(until, now() + 15000) });
    }
    async function query(name, session, method) {
        const args = { p_auth_user_id: session.authUserId, p_session_id: session.sessionId };
        if (method) args.p_method = method;
        const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(4000));
        if (error) throw failure('Sign-in verification is temporarily unavailable. Please retry.');
        const value = data?.[0]?.verified_until;
        const until = value ? Date.parse(value) : 0;
        if (value && !Number.isFinite(until)) throw failure('Sign-in verification is temporarily unavailable. Please retry.');
        return until > now() ? until : 0;
    }
    return {
        async isVerified(req) {
            const session = readLoginSession(req, now());
            const key = keyFor(session);
            const cached = cache.get(key);
            if (cached?.checkUntil > now() && cached.until > now()) return true;
            cache.delete(key);
            if (!pending.has(key)) {
                const flight = query('get_hris_login_verification', session).then(until => {
                    if (until) remember(key, until);
                    return Boolean(until);
                }).finally(() => { if (pending.get(key) === flight) pending.delete(key); });
                pending.set(key, flight);
            }
            return pending.get(key);
        },
        async markVerified(req, method) {
            if (!METHODS.has(method)) throw failure('Invalid login verification method.', 400, 'LOGIN_METHOD_INVALID');
            const session = readLoginSession(req, now());
            const until = await query('mark_hris_login_verified', session, method);
            if (!until) throw failure('Your sign-in session could not be verified. Please sign in again.', 401, 'AUTH_SESSION_INVALID');
            // Do not reuse an earlier in-flight negative check after recording a successful challenge.
            pending.delete(keyFor(session));
            remember(keyFor(session), until);
            return new Date(until).toISOString();
        },
    };
}

export const loginSessionService = createLoginSessionService(supabase);
