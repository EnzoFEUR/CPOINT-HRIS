import { supabase } from '../supabaseClient.js';
import NodeCache from 'node-cache';

// Fast in-memory cache to eliminate 250ms-550ms sequential Supabase auth/DB network hops on every request
export const authUserCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });

/**
 * Enterprise Low-Latency Token Invalidation Helper (<1ms)
 * Immediately evicts user profile from memory when status, role, or credentials change.
 */
export const invalidateAuthUser = (employeeId) => {
    if (!employeeId) return;
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
    authUserCache.flushAll();
};

export const hasVerifiedEmployeeIdentity = (user, employee) => Boolean(user?.id && employee?.id && (
    employee.id === user.id || employee.auth_user_id === user.id ||
    (!employee.auth_user_id && user.email_confirmed_at && typeof user.email === 'string' && employee.email?.toLowerCase() === user.email.toLowerCase())
));
export const hasVerifiedEmployeeRole = (user, employee) => Boolean(employee?.role && hasVerifiedEmployeeIdentity(user, employee));

export const verifyToken = async (req, res, next) => {
    // Whitelist public scanner routes (Tablet doesn't have a user session)
    const publicRoutes = ['/verify-qr', '/scan'];
    if (publicRoutes.some(route => req.path.includes(route))) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Invalid token format' });

    // 0ms-latency cache hit
    const cachedUser = authUserCache.get(token);
    if (cachedUser) {
        req.user = cachedUser;
        return next();
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const EMP_FIELDS = 'id, auth_user_id, company_id, first_name, last_name, email, role, status, is_active, department, job_title, shift, requires_password_change, production_group_id, hourly_rate, daily_rate';

    // Fetch custom user details omitting heavy biometric vector blobs
    let { data: employee } = await supabase
        .from('employees')
        .select(EMP_FIELDS)
        .eq('id', user.id)
        .maybeSingle();

    if (!employee) {
        const { data: empByAuth } = await supabase
            .from('employees')
            .select(EMP_FIELDS)
            .eq('auth_user_id', user.id)
            .maybeSingle();
        employee = empByAuth;
    }

    if (!employee && user.email) {
        const { data: empByEmail } = await supabase
            .from('employees')
            .select(EMP_FIELDS)
            .ilike('email', user.email.replace(/[\\%_]/g, '\\$&'))
            .maybeSingle();
        employee = empByEmail;
    }

    const metaRole = user.user_metadata?.role;
    const resolvedRole = employee?.role || metaRole || (user.email === 'admin@c-point.com' ? 'admin' : (user.role === 'admin' ? 'admin' : 'employee'));

    const resolvedUser = { 
        ...user, 
        ...(employee || {}),
        role: resolvedRole,
        employee_identity_verified: hasVerifiedEmployeeIdentity(user, employee),
        role_verified: hasVerifiedEmployeeRole(user, employee)
    };

    // Enterprise DOLE & BIR 2316 Retention Policy:
    // Separated personnel retain read-only portal access to their personal archive (dashboard,
    // disciplinary separation notices, tax records / BIR 2316, payroll history, official profile documents)
    // and acknowledgment of formal notices.
    // Operational credentials (attendance clock-in, leave filing, profile mutations) are strictly revoked.
    const isSuspended = resolvedUser.status === 'Suspended' || resolvedUser.status === 'suspended';
    const isTerminated = resolvedUser.status === 'Terminated' || resolvedUser.status === 'terminated';
    const isSeparated = resolvedRole !== 'admin' && resolvedRole !== 'superadmin' && !isSuspended && (
        isTerminated || 
        Boolean(resolvedUser.archived_at) || 
        resolvedUser.is_active === false ||
        resolvedUser.status === 'inactive'
    );

    if (isSeparated) {
        req.isSeparated = true;
        const urlPath = req.originalUrl || req.url || '';
        const isAllowedArchiveRead = req.method === 'GET' && (
            urlPath.includes('/api/dashboard') ||
            urlPath.includes('/api/disciplinary') ||
            urlPath.includes('/api/payroll') ||
            urlPath.includes('/api/profile') ||
            urlPath.includes('/api/notifications') ||
            urlPath.includes('/api/documents') ||
            urlPath.includes('/api/leave-credits')
        );
        const isAllowedNoticeAcknowledge = req.method === 'PUT' && (
            urlPath.includes('/api/disciplinary') && urlPath.includes('/acknowledge')
        );

        if (!isAllowedArchiveRead && !isAllowedNoticeAcknowledge) {
            return res.status(403).json({ 
                error: 'ACCESS REVOKED: Personnel account has been separated. Operational write actions are disabled under DOLE retention policy.' 
            });
        }
    }

    authUserCache.set(token, resolvedUser);
    req.user = resolvedUser;
    next();
};

export const checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== requiredRole) {
            console.warn(`[RBAC BLOCK] User ${req.user?.id} (${req.user?.email}) with role '${req.user?.role}' attempted access requiring '${requiredRole}'`);
            return res.status(403).json({ error: 'UNAUTHORIZED ACTION.' });
        }
        next();
    };
};

const checkOwnership = (req, res, next) => {
    // For non-admins, determine the target ID from params or query or body safely
    const targetId = req.params?.id || req.query?.employee_id || req.body?.employee_id;
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

export const hasVerifiedManagerRole = user => user?.role_verified === true && user?.employee_identity_verified === true && user.is_active !== false && !user.archived_at && !['inactive', 'terminated', 'resigned', 'separated', 'suspended'].includes(String(user.status || '').toLowerCase()) && ['admin', 'superadmin', 'hr'].includes(user.role);

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
