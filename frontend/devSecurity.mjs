import { randomBytes } from 'node:crypto';
import { resolve, sep } from 'node:path';

export const DEV_NONCE_PLACEHOLDER = 'CPOINT_DEV_NONCE_PLACEHOLDER_00000';
const PROXY_UNAVAILABLE = Symbol('proxy-unavailable');

function reply(res, status, code, error) {
  if (code === 'BACKEND_UNAVAILABLE') res[PROXY_UNAVAILABLE] = true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('ETag');
  res.removeHeader('Content-Length');
  res.end(JSON.stringify({ success: false, code, error }));
}

export function createFrontendSecurityMiddleware(headers, { development = false, allowedFsPaths = [] } = {}) {
  const policy = headers['Content-Security-Policy'];
  const basePolicy = policy.replaceAll(` 'nonce-${DEV_NONCE_PLACEHOLDER}'`, '');
  const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  const fsRoots = allowedFsPaths.map(normalize);
  return (req, res, next) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, key === 'Content-Security-Policy' ? basePolicy : value);
    const end = res.end;
    const rawPath = (req.url || '/').split('?')[0];
    const fsRequest = rawPath.startsWith('/@fs');
    res.end = function (chunk, encoding, callback) {
      if (!this.headersSent) {
        this.removeHeader('X-Powered-By');
        this.removeHeader('Server');
        if (this.statusCode >= 500 || (fsRequest && this.statusCode >= 400)) {
          const status = this.statusCode;
          this.setHeader('Content-Type', 'application/json; charset=utf-8');
          this.setHeader('Cache-Control', 'no-store');
          this.removeHeader('ETag');
          // Preserve the intentional, sanitized proxy-unavailable response.
          if (!this[PROXY_UNAVAILABLE]) {
            chunk = JSON.stringify({ success: false, code: status >= 500 ? 'FRONTEND_UNAVAILABLE' : 'NOT_FOUND', error: status >= 500 ? 'The application could not complete this request.' : 'The requested resource is unavailable.' });
          }
          this.setHeader('Content-Length', Buffer.byteLength(chunk));
        } else if (development && this.statusCode === 200 && /text\/html/i.test(String(this.getHeader('Content-Type')))) {
          // Vite's complete HTML response is rewritten once; modules and proxy bodies are not buffered or replayed.
          const nonce = randomBytes(24).toString('base64');
          chunk = String(chunk || '').replaceAll(DEV_NONCE_PLACEHOLDER, nonce);
          this.setHeader('Content-Security-Policy', policy.replaceAll(DEV_NONCE_PLACEHOLDER, nonce));
          this.setHeader('Cache-Control', 'no-store');
          this.removeHeader('ETag');
          this.setHeader('Content-Length', Buffer.byteLength(chunk));
        }
      }
      return end.call(this, chunk, typeof encoding === 'string' ? encoding : undefined, typeof encoding === 'function' ? encoding : callback);
    };
    let path;
    try { path = decodeURIComponent(rawPath); } catch { return reply(res, 400, 'INVALID_PATH', 'The request path is invalid.'); }
    if (path.length > 2048 || /[\x00-\x1f\x7f\\]/.test(path)) return reply(res, 400, 'INVALID_PATH', 'The request path is invalid.');
    if (path.startsWith('/@fs') && !/\.[a-z\d]{1,10}$/i.test(path)) return reply(res, 404, 'NOT_FOUND', 'The requested resource is unavailable.');
    if (path.startsWith('/@fs/')) {
      const filename = normalize(path.slice('/@fs/'.length));
      if (!fsRoots.some(root => filename.startsWith(root.endsWith(sep) ? root : root + sep)) || /(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.git)(?:[\\/]|$)|\.(?:pem|crt|key)$/i.test(filename)) {
        return reply(res, 404, 'NOT_FOUND', 'The requested resource is unavailable.');
      }
    }
    if ((req.headers.accept || '').includes('text/html')) delete req.headers['if-none-match'];
    next();
  };
}

export function createBackendProxy(apiUrl) {
  const target = apiUrl && /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : 'http://127.0.0.1:5000';
  return {
    target,
    changeOrigin: true,
    secure: true,
    configure(proxy) {
      proxy.on('error', (_error, _req, res) => {
        if (!res.headersSent) reply(res, 503, 'BACKEND_UNAVAILABLE', 'The backend is unavailable. Please try again shortly.');
      });
    },
  };
}

export function frontendHttpSecurity(headers, options) {
  return {
    name: 'frontend-http-security',
    enforce: 'pre',
    configureServer(server) { server.middlewares.use(createFrontendSecurityMiddleware(headers, options)); },
    configurePreviewServer(server) { server.middlewares.use(createFrontendSecurityMiddleware(headers)); },
  };
}
