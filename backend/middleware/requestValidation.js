const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const UUID_FIELDS = new Set(['employee_id', 'employeeId', 'auth_user_id', 'user_id', 'device_id', 'event_id', 'operation_id', 'decision_id', 'exclude_id', 'production_group_id']);
const DATE_FIELDS = new Set(['date', 'date_hired', 'timekeeping_effective_date', 'start_date', 'end_date', 'period_start', 'period_end']);
const TEXT_FIELDS = new Set(['email', 'identifier', 'phone', 'first_name', 'last_name', 'name', 'title', 'password', 'new_password']);
const EMPLOYEE_ACTIONS = new Set(['check-email', 'provision-admin']);

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_INPUT', expose: true });
}

function validateField(key, value, validDates) {
  if (value === null || value === undefined || value === '') return;
  if (TEXT_FIELDS.has(key) && (typeof value !== 'string' || value.length > (key.includes('password') ? 1024 : 255))) invalid(`${key} must be bounded text.`);
  if (key === 'email' && !/^[^\s@<>()\\",;]+@[^\s@<>()\\",;]+\.[^\s@<>()\\",;]+$/.test(value)) invalid('Email address has an invalid format.');
  if (UUID_FIELDS.has(key) && (typeof value !== 'string' || !UUID.test(value))) invalid(`${key} must be a valid UUID.`);
  if (key === 'company_id' && (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))) invalid('Company ID has an invalid format.');
  if (DATE_FIELDS.has(key)) {
    if (validDates.has(value)) return;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${key} must use YYYY-MM-DD.`);
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(`${key} is not a valid calendar date.`);
    validDates.add(value);
  }
}

// Inspect structure without changing signed payloads. Work is bounded by nodes, not binary-string bytes.
export function validateApiInput(req, res, next) {
  try {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (path.length > 2048) invalid('Request path is too long.');
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { invalid('Request path encoding is invalid.'); }
    if (decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded) || decoded.split('/').some(part => part === '..' || part === '.')) invalid('Request path is invalid.');
    const employeePath = /^\/api\/employees\/([^/]+)/.exec(decoded);
    if (employeePath && !EMPLOYEE_ACTIONS.has(employeePath[1]) && !UUID.test(employeePath[1])) invalid('Employee ID must be a valid UUID.');
    const query = req.query || {};
    // Payroll rows share period dates; validate each distinct date once per request.
    const validDates = new Set();
    const queryKeys = Object.keys(query);
    if (queryKeys.length > 100) invalid('Too many query parameters.');
    for (const key of queryKeys) {
      if (UNSAFE_KEYS.has(key) || /[\[\]]/.test(key) || typeof query[key] !== 'string') invalid('Query parameters must be unique scalar values.');
      if (key.length > 100 || query[key].length > 4096) invalid('Query parameter is too long.');
      validateField(key, query[key], validDates);
    }
    const pending = req.body && typeof req.body === 'object' ? [[req.body, 0]] : [];
    let nodes = 0;
    while (pending.length) {
      const [value, depth] = pending.pop();
      if (depth > 24) invalid('Request structure is too deeply nested.');
      for (const key of Object.keys(value)) {
        if (++nodes > 20000) invalid('Request contains too many fields.');
        if (key.length > 128) invalid('Request property name is too long.');
        if (UNSAFE_KEYS.has(key) || /(?:^|\[)(?:__proto__|constructor|prototype)(?:\]|$)/.test(key)) invalid('Request contains a forbidden property.');
        const child = value[key];
        if (['mock', 'is_mock'].includes(key) && typeof child !== 'boolean') invalid('Mock flags must be Boolean values.');
        validateField(key, child, validDates);
        if (child && typeof child === 'object') pending.push([child, depth + 1]);
      }
    }
    next();
  } catch (error) { next(error); }
}

export const postgrestValue = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export const postgrestLikeValue = value => postgrestValue(String(value).replace(/[\\%_]/g, '\\$&'));

export function validateUuidParam(req, res, next, value) {
  if (typeof value === 'string' && UUID.test(value)) return next();
  next(Object.assign(new Error('The resource ID must be a valid UUID.'), { status: 400, code: 'INVALID_INPUT', expose: true }));
}

export function validateRecordId(req, res, next, value) {
  if (typeof value === 'string' && (UUID.test(value) || (/^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n))) return next();
  next(Object.assign(new Error('The record ID must be a UUID or positive integer.'), { status: 400, code: 'INVALID_INPUT', expose: true }));
}
