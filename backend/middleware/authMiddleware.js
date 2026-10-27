import { supabase, createIsolatedAuthClient } from '../supabaseClient.js';
import NodeCache from 'node-cache';
import { loginSessionService } from '../services/loginSessionService.js';

// Fast in-memory cache to eliminate 250ms-550ms sequential Supabase auth/DB network hops on every request
export const authUserCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });
const pendingAuthUsers = new Map();
let authCacheGeneration = 0;

/**
 * Enterprise Low-Latency Token Invalidation Helper (<1ms)
 * Immediately evicts user profile from memory when status, role, or credentials change.
 */
export const invalidateAuthUser = (employeeId) => {
    if (!employeeId) return;
    authCacheGeneration++;
    pendingAuthUsers.clear();
    const strId = String(employeeId).trim().toLowerCase();
    const keys = authUserCache.keys();
    for (const key of keys) {
        const val = authUserCache.get(key);
        if (val) {
            const matchesId = val.id && String(val.id).trim().toLowerCase() === strId;
            const matchesAuthId = val.auth_user_id && String(val.auth_user_id).trim().toLowerCase() === strId;
            const matchesCompanyId = val.company_id && String(val.company_id).trim().toLowerCase() === strId;
            const matchesEmail = val.email && String(val.email).trim().toLowerCase() === strId;
            if (matchesId || matchesAuthId || matchesCompanyId || matchesEmail) {
                authUserCache.del(key);
            }
        }
    }
};

export const clearAuthUserCache = () => {
    authCacheGeneration++;
    pendingAuthUsers.clear();
    authUserCache.flushAll();
};

export const hasVerifiedEmployeeIdentity = (user, employee) => Boolean(user?.id && employee?.id && (
    employee.id === user.id || employee.auth_user_id === user.id ||
    (!employee.auth_user_id && user.email_confirmed_at && typeof user.email === 'string' && employee.email?.toLowerCase() === user.email.toLowerCase())
));
export const hasVerifiedEmployeeRole = (user, employee) => Boolean(employee?.role && hasVerifiedEmployeeIdentity(user, employee));

const resolveAuthUser = async (token, signal) => {
    const { data: { user }, error } = await createIsolatedAuthClient(signal).auth.getUser(token);
    signal.throwIfAborted();
    
    if (error && error.status !== 400 && error.status !== 401 && error.status !== 403 && error.status !== 422) throw error;
    if (error || !user) {
        return null;
    }

    const EMP_FIELDS = 'id, auth_user_id, company_id, first_name, last_name, email, role, status, is_active, archived_at, deleted_at, separation_type, separation_date, department, job_title, shift, requires_password_change, production_group_id, hourly_rate, daily_rate, birth_date, address, gender, phone, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, has_registered_biometrics, biometric_baseline_path';

    // Fetch custom user details omitting heavy biometric vector blobs
    let { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select(EMP_FIELDS)
        .eq('id', user.id)
        .abortSignal(signal)
        .maybeSingle();
    signal.throwIfAborted();
    if (employeeError) throw employeeError;

    if (!employee) {
        const { data: empByAuth, error: authLookupError } = await supabase
            .from('employees')
            .select(EMP_FIELDS)
            .eq('auth_user_id', user.id)
            .abortSignal(signal)
            .maybeSingle();
        signal.throwIfAborted();
        if (authLookupError) throw authLookupError;
        employee = empByAuth;
    }

    if (!employee && user.email) {
        const { data: empByEmail, error: emailLookupError } = await supabase
            .from('employees')
            .select(EMP_FIELDS)
            .ilike('email', user.email.replace(/[\\%_]/g, '\\$&'))
            .abortSignal(signal)
            .maybeSingle();
        signal.throwIfAborted();
        if (emailLookupError) throw emailLookupError;
        employee = empByEmail;
    }

    const metaRole = user.user_metadata?.role;
    const resolvedRole = employee?.role || metaRole || (user.email === 'admin@c-point.com' ? 'admin' : (user.role === 'admin' ? 'admin' : 'employee'));

    const metaPhone = user.user_metadata?.phone || (user.phone ? String(user.phone).replace(/^\+63/, '') : null);

    const resolvedUser = { 
        ...user, 
        ...(employee || {}),
        sex: employee?.gender || null,
        phone: employee?.phone || metaPhone || null,
        emergency_contact_name: employee?.emergency_contact_name || user.user_metadata?.emergency_contact_name || null,
        emergency_contact_phone: employee?.emergency_contact_phone || user.user_metadata?.emergency_contact_phone || null,
        emergency_contact_relationship: employee?.emergency_contact_relationship || user.user_metadata?.emergency_contact_relationship || null,
        role: resolvedRole,
        employee_identity_verified: hasVerifiedEmployeeIdentity(user, employee),
        role_verified: hasVerifiedEmployeeRole(user, employee),
        _auth_user_id: user.id
    };
    return resolvedUser;
};

const loadAuthUser = async token => {
    const controller = new AbortController();
    // PostgREST recognizes TimeoutError and skips retries after this overall deadline.
    const timer = setTimeout(() => controller.abort(new DOMException('Authentication dependency timeout', 'TimeoutError')), 5000);
    try {
        return await resolveAuthUser(token, controller.signal);
    } finally {
        clearTimeout(timer);
    }
};

export const verifyIdentityToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Invalid token format' });

    // 0ms-latency cache hit
    let resolvedUser = authUserCache.get(token);
    if (!resolvedUser) {
        let pending = pendingAuthUsers.get(token);
        if (!pending) {
            const generation = authCacheGeneration;
            pending = loadAuthUser(token).then(user => {
                // A permission change must invalidate the pending authorization as well as its cache.
                if (generation !== authCacheGeneration) throw new Error('Employment permissions changed during verification.');
                if (user) authUserCache.set(token, user);
                return user;
            });
            pendingAuthUsers.set(token, pending);
        }
        try { resolvedUser = await pending; }
        catch {
            res.setHeader('Retry-After', '2');
            return res.status(503).json({ code: 'AUTH_SERVICE_UNAVAILABLE', error: 'Sign-in verification is temporarily unavailable. Please retry shortly.' });
        }
        finally { if (pendingAuthUsers.get(token) === pending) pendingAuthUsers.delete(token); }
        if (!resolvedUser) return res.status(401).json({ error: 'Unauthorized' });
    }
    if (resolvedUser.employee_identity_verified !== true || resolvedUser.role_verified !== true) {
        return res.status(403).json({ error: 'A verified employee account is required.' });
    }
    const resolvedRole = resolvedUser.role;
    const path = (req.originalUrl || req.url || '').split('?')[0].toLowerCase().replace(/\/$/, '');
    const isLoginBootstrap = (req.method === 'GET' && ['/api/auth/security/login-context', '/api/auth/totp/status', '/api/auth/otp/status'].includes(path)) ||
        (req.method === 'POST' && ['/api/auth/otp/status', '/api/auth/otp/send', '/api/auth/otp/verify', '/api/auth/totp/verify'].includes(path));
    const isOwnStatusRefresh = req.method === 'POST' && path === '/api/auth/security/refresh-employment-status';
    if (resolvedUser.deleted_at || (!isLoginBootstrap && !isOwnStatusRefresh && ['admin', 'hr', 'hr_manager', 'security', 'guard', 'security_guard'].includes(resolvedRole) &&
        (resolvedUser.is_active === false || resolvedUser.archived_at || ['suspended', 'terminated', 'inactive', 'retired', 'resigned'].includes(String(resolvedUser.status).toLowerCase())))) {
        return res.status(403).json({ code: 'ACCOUNT_UNAVAILABLE', error: 'This account is not authorized for operational access.' });
    }

    // Enterprise Mandatory Password Change Enforcement:
    // When a user requires a password change, strictly deny access to all workforce/payroll/attendance APIs
    // except the acknowledgement endpoint (/api/attendance/password-changed), password-rotation endpoints,
    // and non-sensitive session metadata.
    if (resolvedUser.requires_password_change) {
        const isPasswordChangeAllowed = isLoginBootstrap || (
            (req.method === 'POST' && ['/api/attendance/password-changed', '/api/profile/change-password', '/api/profile/request-password-otp'].includes(path)) ||
            (req.method === 'GET' && /^\/api\/(profile|notifications)(?:\/|$)/.test(path))
        );
        if (!isPasswordChangeAllowed) {
            return res.status(403).json({
                error: 'PASSWORD_CHANGE_REQUIRED: Mandatory password change required before accessing system resources.',
                code: 'PASSWORD_CHANGE_REQUIRED',
                redirectUrl: '/force-password-change'
            });
        }
    }

    // Enterprise DOLE & BIR 2316 Retention Policy:
    // Separated personnel retain read-only portal access to their personal archive (dashboard,
    // disciplinary separation notices, tax records / BIR 2316, payroll history, official profile documents)
    // and acknowledgment of formal notices.
    // Operational credentials (attendance clock-in, leave filing, profile mutations) are strictly revoked.
    const isSuspended = resolvedUser.status === 'Suspended' || resolvedUser.status === 'suspended';
    const isTerminated = resolvedUser.status === 'Terminated' || resolvedUser.status === 'terminated';
    const isSeparated = resolvedRole !== 'admin' && !isSuspended && (
        isTerminated || 
        Boolean(resolvedUser.archived_at) || 
        resolvedUser.is_active === false ||
        resolvedUser.status === 'inactive'
    );

    if (isSeparated) {
        req.isSeparated = true;
        const isAllowedArchiveRead = req.method === 'GET' && (
            /^\/api\/(dashboard|disciplinary|payroll|profile|notifications|documents|leave-credits|employment-exit)(?:\/|$)/.test(path) ||
            /^\/api\/retirement-pay\/my-statements(?:\/|$)/.test(path)
        );
        const isAllowedNoticeAcknowledge = req.method === 'PUT' && (
            /^\/api\/disciplinary\/[a-f0-9-]{36}\/acknowledge$/.test(path)
        );

        const isAllowedExitReview = req.method === 'POST' && /^\/api\/employment-exit\/[a-f0-9-]{36}\/review-request$/.test(path);
        const isAllowedNotificationReadState = req.method === 'PUT' && path === '/api/notifications/read-all';
        if (!isLoginBootstrap && !isAllowedArchiveRead && !isAllowedNoticeAcknowledge && !isAllowedExitReview && !isAllowedNotificationReadState) {
            return res.status(403).json({ 
                error: 'ACCESS REVOKED: Personnel account has been separated. Operational write actions are disabled under DOLE retention policy.' 
            });
        }
    }

    req.user = resolvedUser;
    return next();
};

export const verifyToken = (req, res, next) => verifyIdentityToken(req, res, async () => {
    try {
        if (!await loginSessionService.isVerified(req)) {
            return res.status(403).json({ code: 'SECOND_FACTOR_REQUIRED', error: 'Complete your sign-in verification to continue.', redirectUrl: '/login' });
        }
        return next();
    } catch (error) {
        if (error.status !== 401) res.setHeader('Retry-After', '2');
        return res.status(error.status === 401 ? 401 : 503).json({ code: error.status === 401 ? 'AUTH_SESSION_INVALID' : 'LOGIN_VERIFICATION_UNAVAILABLE', error: error.status === 401 ? error.message : 'Sign-in verification is temporarily unavailable. Please retry.' });
    }
});

export const checkRole = (...allowedRoles) => {
    const roles = allowedRoles.flat();
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            console.warn(`[RBAC BLOCK] User ${req.user?.id} (${req.user?.email}) with role '${req.user?.role}' attempted access requiring '${roles.join(" or ")}'`);
            return res.status(403).json({ error: 'UNAUTHORIZED ACTION.' });
        }
        next();
    };
};

const checkOwnership = (req, res, next) => {
    // For non-admins, determine the target ID from path, params, query, or body safely
    let pathId = null;
    const segments = (req.path || '').split('/').filter(Boolean);
    const nonIdKeywords = new Set([
        'check-email', 'provision-admin', 'holidays', 'bulk-delete',
        'statutory-settings', 'preview', 'batch', 'factory-logs',
        'scan', 'register-baseline', 'password-changed', 'summary',
        'policy', 'conversion-settings', 'obligations', 'payment-employees',
        'cash-out-requests', 'history', 'decision', '13th-month-report'
    ]);
    if (segments.length > 0 && !nonIdKeywords.has(segments[0])) {
        pathId = segments[0];
    }

    const targetId = req.params?.id || pathId || req.query?.employee_id || req.body?.employee_id;
    const matchesSelf = targetId && (
        targetId === req.user?.id || 
        targetId === req.user?.company_id ||
        targetId === req.user?.auth_user_id
    );
    
    if (!targetId || !matchesSelf) {
        console.warn(`[RBAC BLOCK] User ${req.user?.id} attempted to access data for ${targetId || 'entire company'}`);
        return res.status(403).json({ error: 'UNAUTHORIZED: You can only access your own records.' });
    }
    
    next();
};

export const checkAdminOrOwnership = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    return checkOwnership(req, res, next);
};

export const hasVerifiedManagerRole = user => user?.role_verified === true && user?.employee_identity_verified === true && user.is_active !== false && !user.archived_at && !['inactive', 'terminated', 'resigned', 'separated', 'suspended'].includes(String(user.status || '').toLowerCase()) && ['admin', 'hr'].includes(user.role);

export const checkVerifiedManagerOrOwnership = (req, res, next) => {
    if (hasVerifiedManagerRole(req.user)) return next();
    if (req.user?.employee_identity_verified !== true) return res.status(403).json({ error: 'Verified employee identity is required.' });
    return checkOwnership(req, res, next);
};

export const forcePasswordChange = (req, res, next) => {
    // If the route is already the force-change route, let it pass
    if (req.path.includes('/force-password-change')) {
        return next();
    }

    if (req.user && req.user.requires_password_change) {
        return res.status(403).json({ 
            error: 'Password change required.',
            redirectUrl: '/force-password-change'
        });
    }
    next();
};
