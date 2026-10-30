import { verifyIdentityToken, verifyToken } from './authMiddleware.js';

const purposes = new Set(['login_2fa', 'modal_stepup', 'authenticator_manage']);
const clean = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const phone = value => clean(value).replace(/[^\d]/g, '').replace(/^63/, '0');

export const bindOwnLoginChallenge = (req, res, next) => {
    const input = (req.method === 'GET' ? req.query : req.body) || {};
    const purpose = input.purpose || 'login_2fa';
    if (!purposes.has(purpose)) return res.status(400).json({ success: false, error: 'Invalid verification purpose.' });
    const authenticate = purpose === 'login_2fa' ? verifyIdentityToken : verifyToken;
    return authenticate(req, res, () => {
        const user = req.user;
        const ids = new Set([clean(user.id), clean(user._auth_user_id)]);
        const identifiers = new Set([...ids, clean(user.email), clean(user.company_id), clean(user.phone)]);
        const foreign = (input.email !== undefined && clean(input.email) !== clean(user.email)) ||
            (input.user_id !== undefined && !ids.has(clean(input.user_id))) ||
            (input.identifier !== undefined && !identifiers.has(clean(input.identifier))) ||
            (input.phone !== undefined && (!phone(user.phone) || phone(input.phone) !== phone(user.phone)));
        if (foreign) return res.status(403).json({ success: false, error: 'Verification must use your signed-in account.' });
        if (req.method !== 'GET') {
            req.body = { ...input, purpose, email: user.email, user_id: user.id, identifier: user.email, phone: user.phone || undefined };
        }
        return next();
    });
};
