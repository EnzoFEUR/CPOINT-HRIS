import { supabase } from '../supabaseClient.js';
import NodeCache from 'node-cache';

// Fast in-memory cache to eliminate 250ms-550ms sequential Supabase auth/DB network hops on every request
const authUserCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });

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
            .ilike('email', user.email)
            .maybeSingle();
        employee = empByEmail;
    }

    const metaRole = user.user_metadata?.role;
    const resolvedRole = employee?.role || metaRole || (user.email === 'admin@c-point.com' ? 'admin' : (user.role === 'admin' ? 'admin' : 'employee'));

    const resolvedUser = { 
        ...user, 
        ...(employee || {}),
        role: resolvedRole
    };

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

export const checkAdminOrOwnership = (req, res, next) => {
    // Admins have full access
    if (req.user && req.user.role === 'admin') return next();
    
    // For non-admins, determine the target ID from params or query or body safely
    const targetId = req.params?.id || req.query?.employee_id || req.body?.employee_id;
    
    if (!targetId || targetId !== req.user?.id) {
        console.warn(`[RBAC BLOCK] User ${req.user?.id} attempted to access data for ${targetId || 'entire company'}`);
        return res.status(403).json({ error: 'UNAUTHORIZED: You can only access your own records.' });
    }
    
    next();
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
