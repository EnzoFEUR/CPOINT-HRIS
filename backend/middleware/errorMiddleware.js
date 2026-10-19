import { PRIVATE_API_CACHE_CONTROL } from '../../shared/securityPolicy.mjs';

const DEFAULT_ERRORS = {
  400: ['INVALID_INPUT', 'The request is invalid.'],
  401: ['AUTHENTICATION_REQUIRED', 'Authentication is required.'],
  403: ['ACCESS_DENIED', 'You are not authorized to perform this action.'],
  404: ['NOT_FOUND', 'The requested resource was not found.'],
  409: ['CONFLICT', 'This request conflicts with an existing record.'],
  413: ['PAYLOAD_TOO_LARGE', 'The request is too large.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'This content type is not supported.'],
  429: ['RATE_LIMITED', 'Too many requests. Please retry later.'],
  500: ['INTERNAL_ERROR', 'The request could not be completed. Please try again.'],
  503: ['SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please retry later.'],
};
const DISCLOSURE = /(?:\b(?:relation|column|table)\b.{0,100}\b(?:does not exist|schema|constraint)\b|violates .{0,60}constraint|\bSQLSTATE\b|\bPGRST\d+\b|\b(?:SELECT .{0,60} FROM|INSERT INTO|DELETE FROM)\b|postgres(?:ql)?:\/\/|\bat \S+ ?\([^\n]+:\d+:\d+\)|[A-Z]:\\|\/(?:Users|home|workspace)\/)/i;

function safeErrorBody(status, body = {}) {
  const [fallbackCode, fallbackMessage] = DEFAULT_ERRORS[status] || DEFAULT_ERRORS[500];
  const candidate = typeof body.error === 'string' ? body.error : body.message;
  const safeMessage = status !== 500 && typeof candidate === 'string' && candidate.length <= 500 && !DISCLOSURE.test(candidate) ? candidate : fallbackMessage;
  const code = typeof body.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(body.code) ? body.code : fallbackCode;
  const { stack, details, hint, sql, query, ...rest } = body;
  // Internal failures may contain arbitrary database/provider fields beyond their message.
  if (status >= 500) return { success: false, code: status === 500 ? 'INTERNAL_ERROR' : code, error: safeMessage, message: safeMessage };
  return { ...rest, success: false, code, error: safeMessage, ...(body.message ? { message: safeMessage } : {}) };
}

export function protectApiResponses(req, res, next) {
  const setHeader = res.setHeader;
  res.setHeader = function (name, value) {
    return setHeader.call(this, name, name.toLowerCase() === 'cache-control' ? PRIVATE_API_CACHE_CONTROL : value);
  };
  res.setHeader('Cache-Control', PRIVATE_API_CACHE_CONTROL);
  res.setHeader('Pragma', 'no-cache');
  const json = res.json;
  res.json = function (body) {
    return json.call(this, this.statusCode >= 400 ? safeErrorBody(this.statusCode, body && typeof body === 'object' ? body : {}) : body);
  };
  next();
}

export function apiNotFound(req, res) {
  res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'The requested endpoint was not found.' });
}

export function apiErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = Number(error.status || error.statusCode) || 500;
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  let code = error.code;
  if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; }
  if (error.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; }
  if (error.code === '23505') { status = 409; code = 'CONFLICT'; }
  if (error.code === '22P02') { status = 400; code = 'INVALID_INPUT'; }
  if (status >= 500) console.error('[API_ERROR]', JSON.stringify({ status, code: 'INTERNAL_ERROR', requestId: req.reqId || null }));
  const exposed = error.expose === true && status < 500;
  res.status(status).json(safeErrorBody(status, { code, error: exposed ? error.message : undefined }));
}
