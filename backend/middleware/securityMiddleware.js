export const securityHeaders = (req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Access-Control-Max-Age', '86400');
    next();
};

export const removeExposedHeaders = (req, res, next) => {
    res.removeHeader('X-Powered-By');
    next();
};
