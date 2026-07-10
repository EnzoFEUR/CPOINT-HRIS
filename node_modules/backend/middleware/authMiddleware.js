import { supabase } from '../index.js';

export const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log(`[Auth] Checking token for ${req.path}. Header: ${authHeader ? 'Present' : 'Missing'}`);
    
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Invalid token format' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        console.log(`[Auth] Verify failed:`, error?.message || 'No user found');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch custom user details from our DB
    const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('id', user.id)
        .single();

    req.user = { ...user, ...employee };
    next();
};

export const checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== requiredRole) {
            return res.status(403).json({ error: 'UNAUTHORIZED ACTION.' });
        }
        next();
    };
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
