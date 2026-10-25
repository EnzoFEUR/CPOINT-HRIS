export const PRIVATE_API_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, private';
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'";
export const DEFAULT_APP_ORIGIN = 'https://cpointhris.vercel.app';
export const API_RATE_POLICY = Object.freeze({ windowMs: 60000, anonymousRequestsPerIp: 350, verifiedRequestsPerEmployee: 350 });

function httpOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Security origins must be HTTP(S) URLs without credentials.');
  return url.origin;
}

export function trustedOrigins(env = {}) {
  const origins = new Set([DEFAULT_APP_ORIGIN]);
  for (const value of [env.FRONTEND_URL, env.APP_URL, ...(env.CORS_ALLOWED_ORIGINS || '').split(',')]) {
    if (value?.trim()) origins.add(httpOrigin(value.trim()));
  }
  if (env.NODE_ENV !== 'production') {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      for (const port of [5173, 5174, 4173]) origins.add(`http://${host}:${port}`);
    }
  }
  return origins;
}

export function frontendSecurityHeaders({ apiUrl = 'https://cpoint-hris.onrender.com', supabaseUrl = 'https://lzqshktnrvtlattdiwxf.supabase.co', modelUrl, development = false, nonce } = {}) {
  if (nonce && !/^[A-Za-z\d+/_-]{24,128}={0,2}$/.test(nonce)) throw new Error('Invalid CSP nonce.');
  const nonceSource = nonce ? ` 'nonce-${nonce}'` : '';
  const api = apiUrl.startsWith('/') ? "'self'" : httpOrigin(apiUrl);
  const database = httpOrigin(supabaseUrl);
  const realtime = database.replace(/^http/, 'ws');
  const model = modelUrl ? httpOrigin(modelUrl) : 'https://raw.githubusercontent.com';
  const connections = new Set(["'self'", api, database, realtime, model, 'https://raw.githubusercontent.com', 'https://cdn.jsdelivr.net', 'https://vitals.vercel-insights.com', 'https://va.vercel-insights.com']);
  if (development) {
    // CSP host-source syntax does not support bracketed IPv6 literals; localhost covers local development.
    for (const host of ['localhost', '127.0.0.1']) {
      connections.add(`http://${host}:*`);
      connections.add(`ws://${host}:*`);
    }
  }
  const csp = [
    "default-src 'self'", "base-uri 'self'", "frame-ancestors 'self'", "object-src 'none'", "form-action 'self'",
    `script-src 'self' 'wasm-unsafe-eval' https://va.vercel-scripts.com${nonceSource}`,
    `script-src-attr 'none'`,
    `style-src 'self' https://cdn.jsdelivr.net${nonceSource}`,
    "font-src 'self' data: https://cdn.jsdelivr.net",
    `img-src 'self' data: blob: ${database}`,
    `connect-src ${[...connections].join(' ')}`,
    "worker-src 'self' blob:", "media-src 'self' blob:", `frame-src 'self' blob: ${database}`,
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
  };
}
