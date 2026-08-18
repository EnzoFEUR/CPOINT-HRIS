import express from 'express';
import { supabase } from '../supabaseClient.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { checkAdminOrOwnership } from '../middleware/authMiddleware.js';

const router = express.Router();

// Attendance and biometrics configuration
const CONFIG = Object.freeze({
  BIOMETRICS: {
    MATCH_THRESHOLD: parseInt(process.env.BIOMETRIC_MATCH_THRESHOLD, 10) || 55,
    LIVENESS_CONFIDENCE_MIN: parseFloat(process.env.LIVENESS_CONFIDENCE_MIN) || 0.55,
    ENROLLMENT_CONFIDENCE_MIN: parseFloat(process.env.ENROLLMENT_CONFIDENCE_MIN) || 0.60,
  },
  ATTENDANCE: {
    GRACE_PERIOD_MINUTES: parseInt(process.env.GRACE_PERIOD_MINUTES, 10) || 15,
    CALL_TIME_HOUR: parseInt(process.env.CALL_TIME_HOUR, 10) ?? 8,
    CALL_TIME_MINUTE: parseInt(process.env.CALL_TIME_MINUTE, 10) ?? 0,
    TIMEZONE: process.env.TZ || 'Asia/Manila',
  },
  RATE_LIMITS: {
    SCAN_WINDOW_MS: parseInt(process.env.SCAN_RATE_WINDOW_MS, 10) || 60_000,
    SCAN_MAX_REQUESTS: parseInt(process.env.SCAN_RATE_MAX, 10) || 5,
    ENROLL_WINDOW_MS: parseInt(process.env.ENROLL_RATE_WINDOW_MS, 10) || 300_000,
    ENROLL_MAX_REQUESTS: parseInt(process.env.ENROLL_RATE_MAX, 10) || 3,
  },
  STORAGE: {
    BUCKET: process.env.STORAGE_BUCKET || 'public-bucket',
    ATTENDANCE_PREFIX: 'attendance',
    BASELINE_PREFIX: 'face-baselines',
  },
  GEMINI: {
    MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    MAX_RETRIES: parseInt(process.env.GEMINI_MAX_RETRIES, 10) || 2,
    TIMEOUT_MS: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 10_000,
  },
});

/* =============================================================================
   STRUCTURED LOGGER & AUDIT TRAIL
   ============================================================================= */
const generateRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const logger = {
  info: (reqId, msg, meta = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'INFO', reqId, msg, ...meta })),
  warn: (reqId, msg, meta = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'WARN', reqId, msg, ...meta })),
  error: (reqId, msg, meta = {}) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'ERROR', reqId, msg, ...meta })),
  security: (reqId, msg, meta = {}) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'SECURITY', reqId, msg, ...meta })),
};

const auditLog = async (reqId, { employee_id, action, details, severity = 'info', ip_address }) => {
  try {
    await supabase.from('audit_logs').insert({
      employee_id,
      action,
      details: typeof details === 'string' ? details : JSON.stringify(details),
      severity,
      ip_address,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(reqId, 'Failed to write audit log', { error: err.message, action });
  }
};

/* =============================================================================
   CUSTOM ERROR CLASSES
   ============================================================================= */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}
class ValidationError extends AppError {
  constructor(message) { super(message, 400, 'VALIDATION_ERROR'); }
}
class AuthenticationError extends AppError {
  constructor(message) { super(message, 401, 'AUTHENTICATION_ERROR'); }
}
class AuthorizationError extends AppError {
  constructor(message) { super(message, 403, 'AUTHORIZATION_ERROR'); }
}
class NotFoundError extends AppError {
  constructor(message) { super(message, 404, 'NOT_FOUND'); }
}
class ConflictError extends AppError {
  constructor(message) { super(message, 409, 'CONFLICT'); }
}

/* =============================================================================
   IN-MEMORY RATE LIMITER (Replace with Redis in production)
   ============================================================================= */
const rateLimitStore = new Map();
const rateLimiter = ({ windowMs, maxRequests, keyPrefix }) => {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!rateLimitStore.has(key)) rateLimitStore.set(key, []);
    const timestamps = rateLimitStore.get(key).filter(ts => ts > windowStart);
    
    if (timestamps.length >= maxRequests) {
      logger.warn(req.reqId, 'Rate limit exceeded', { key, count: timestamps.length });
      return res.status(429).json({
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
      });
    }
    
    timestamps.push(now);
    rateLimitStore.set(key, timestamps);
    next();
  };
};

/* =============================================================================
   REQUEST CONTEXT MIDDLEWARE
   ============================================================================= */
router.use((req, res, next) => {
  req.reqId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-Id', req.reqId);
  next();
});

/* =============================================================================
   VALIDATION HELPERS
   ============================================================================= */
const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
const isValidISODate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
const isValidBase64Image = (str) => typeof str === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(str);
const sanitizeString = (str) => (typeof str === 'string' ? str.trim().slice(0, 500) : str);

/* =============================================================================
   TIMEZONE-AWARE DATE HELPERS
   ============================================================================= */
const getTodayString = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.ATTENDANCE.TIMEZONE });
};

const getGracePeriodDeadline = () => {
  const now = new Date();
  const deadline = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.ATTENDANCE.TIMEZONE }));
  deadline.setHours(CONFIG.ATTENDANCE.CALL_TIME_HOUR, CONFIG.ATTENDANCE.CALL_TIME_MINUTE + CONFIG.ATTENDANCE.GRACE_PERIOD_MINUTES, 0, 0);
  return deadline;
};

/* =============================================================================
   SERVICE: AI LIVENESS DETECTION (Circuit Breaker Pattern)
   ============================================================================= */
let aiCircuitState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
let aiCircuitOpensAt = 0;
const AI_CIRCUIT_TIMEOUT = 60_000;

const parseGeminiResponse = (rawText) => {
  const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const looksReal = /real|genuine|live|actual person|not a spoof/i.test(rawText);
    return {
      is_real_person: looksReal,
      confidence: looksReal ? 0.7 : 0.3,
      reason: rawText.substring(0, 150),
    };
  }
};

const performLivenessCheck = async (reqId, base64Data, isEnrollment = false) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new AppError('Biometric AI engine offline. Contact system administrator.', 503, 'AI_SERVICE_UNAVAILABLE');
  }

  // Circuit breaker check
  if (aiCircuitState === 'OPEN') {
    if (Date.now() < aiCircuitOpensAt) {
      throw new AppError('Biometric verification temporarily unavailable. Please retry.', 503, 'AI_CIRCUIT_OPEN');
    }
    aiCircuitState = 'HALF_OPEN';
    logger.info(reqId, 'AI circuit breaker entering HALF_OPEN state');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: CONFIG.GEMINI.MODEL });

  const prompt = `You are an enterprise-grade biometric anti-spoofing forensic AI for a factory attendance system. Perform a 7-point liveness analysis on this security camera frame:

1. DEPTH ANALYSIS: Natural 3D depth with light falloff vs flat 2D surface.
2. SCREEN DETECTION: LCD/OLED pixels, moire, bezels, reflective glass.
3. PRINT DETECTION: Paper texture, ink dots, creases, matte surface.
4. SKIN TEXTURE: Pores, micro-textures, subsurface scattering.
5. EYE ANALYSIS: Specular highlights, moisture, iris detail.
6. ENVIRONMENTAL CONSISTENCY: Face lighting matches ambient environment.
7. MASK DETECTION: Unnatural edges, seams, rigid surfaces.

${isEnrollment ? 'Be STRICT during enrollment. When in doubt, reject.' : ''}
Reply with ONLY valid JSON: {"is_real_person": true/false, "confidence": 0.0-1.0, "reason": "<brief forensic summary>"}`;

  const imagePart = { inlineData: { data: base64Data, mimeType: 'image/jpeg' } };

  let lastError;
  for (let attempt = 0; attempt < CONFIG.GEMINI.MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.GEMINI.TIMEOUT_MS);

      const result = await model.generateContent([prompt, imagePart], { signal: controller.signal });
      clearTimeout(timeoutId);

      const text = result.response.text().trim();
      logger.info(reqId, `AI scan raw response`, { preview: text.substring(0, 200) });

      const analysis = parseGeminiResponse(text);

      // Success — close circuit if it was half-open
      if (aiCircuitState === 'HALF_OPEN') aiCircuitState = 'CLOSED';

      const minConfidence = isEnrollment ? CONFIG.BIOMETRICS.ENROLLMENT_CONFIDENCE_MIN : CONFIG.BIOMETRICS.LIVENESS_CONFIDENCE_MIN;

      return {
        passed: analysis.is_real_person === true && (analysis.confidence ?? 0) >= minConfidence,
        confidence: analysis.confidence ?? 0,
        reason: analysis.reason || 'No reason provided',
        raw: analysis,
      };
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') logger.warn(reqId, 'AI request timed out', { attempt });
      else logger.error(reqId, 'AI request failed', { attempt, error: err.message });
      if (attempt < CONFIG.GEMINI.MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  // All retries failed — open circuit
  aiCircuitState = 'OPEN';
  aiCircuitOpensAt = Date.now() + AI_CIRCUIT_TIMEOUT;
  logger.security(reqId, 'AI circuit breaker OPENED due to repeated failures');

  throw new AppError(
    `Biometric liveness check failed after retries. Error: ${lastError?.message || 'Unknown API Error'}`,
    503,
    'AI_VERIFICATION_FAILED'
  );
};

/* =============================================================================
   SERVICE: IMAGE STORAGE
   ============================================================================= */
const uploadImage = async (reqId, base64Str, type, identifier) => {
  if (!base64Str) return null;
  if (!isValidBase64Image(base64Str)) {
    throw new ValidationError('Invalid image format. Only base64 JPEG/PNG/WEBP accepted.');
  }

  try {
    const buffer = Buffer.from(base64Str.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    if (buffer.length > 10 * 1024 * 1024) {
      throw new ValidationError('Image exceeds 10MB limit.');
    }

    const fileName = `${CONFIG.STORAGE.ATTENDANCE_PREFIX}/${type}-${identifier}-${Date.now()}.jpg`;
    const { data, error } = await supabase.storage
      .from(CONFIG.STORAGE.BUCKET)
      .upload(fileName, buffer, { contentType: 'image/jpeg', cacheControl: '3600' });

    if (error) throw error;
    logger.info(reqId, 'Image uploaded', { fileName });
    return fileName;
  } catch (err) {
    logger.error(reqId, 'Image upload failed', { error: err.message });
    throw new AppError(`Image storage error: ${err.message}`, 500, 'STORAGE_ERROR');
  }
};

/* =============================================================================
   SERVICE: DISCIPLINARY & SECURITY ALERTS
   ============================================================================= */
const logSecurityViolation = async (reqId, employee_id, type, description, ip_address) => {
  const payload = {
    employee_id,
    type,
    description: sanitizeString(description),
    date: getTodayString(),
    created_at: new Date().toISOString(),
  };

  // Write to disciplinary_logs
  await supabase.from('disciplinary_logs').insert(payload).catch(err => {
    logger.error(reqId, 'Failed to write disciplinary log', { error: err.message });
  });

  // Write to audit trail
  await auditLog(reqId, {
    employee_id,
    action: `SECURITY_VIOLATION:${type}`,
    details: description,
    severity: 'critical',
    ip_address,
  });

  // Broadcast to admin dashboard (fire-and-forget with timeout)
  try {
    const channel = supabase.channel('system-notifications');
    await Promise.race([
      channel.send({
        type: 'broadcast',
        event: 'DISC_LOG_ADDED',
        payload: { employee_id, type, timestamp: new Date().toISOString() },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Broadcast timeout')), 3000)),
    ]);
  } catch (err) {
    logger.warn(reqId, 'Realtime broadcast failed', { error: err.message });
  }
};

/* =============================================================================
   ERROR HANDLER WRAPPER
   ============================================================================= */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const sendError = (res, err, reqId) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
  const message = err.isOperational ? err.message : 'An unexpected error occurred.';

  if (!err.isOperational) logger.error(reqId, 'Unhandled error', { stack: err.stack });

  res.status(statusCode).json({
    status: 'error',
    code,
    message,
    requestId: reqId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/* =============================================================================
   1. GET /api/attendance (Admin View)
   ============================================================================= */
router.get(
  '/',
  checkAdminOrOwnership,
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id, start_date, end_date, page = '1', limit = '50' } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Validate filters
    if (employee_id && !isValidUUID(employee_id)) {
      throw new ValidationError('Invalid employee_id format. Expected UUID.');
    }
    if (start_date && !isValidISODate(start_date)) {
      throw new ValidationError('Invalid start_date. Expected YYYY-MM-DD.');
    }
    if (end_date && !isValidISODate(end_date)) {
      throw new ValidationError('Invalid end_date. Expected YYYY-MM-DD.');
    }

    let query = supabase
      .from('attendances')
      .select('*, employees:employee_id(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (employee_id) query = query.eq('employee_id', employee_id);
    if (start_date && end_date) {
      query = query.gte('date', start_date).lte('date', end_date);
    } else if (start_date) {
      query = query.gte('date', start_date);
    } else if (end_date) {
      query = query.lte('date', end_date);
    }

    const { data, error, count } = await query;
    if (error) throw new AppError(`Database error: ${error.message}`, 500, 'DB_ERROR');

    logger.info(reqId, 'Attendance list fetched', { count: data?.length, total: count, filters: { employee_id, start_date, end_date } });

    await auditLog(reqId, {
      employee_id: req.user?.id,
      action: 'ATTENDANCE_LIST_VIEW',
      details: { filters: { employee_id, start_date, end_date }, results: count },
      ip_address: req.ip,
    });

    res.json({
      status: 'success',
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  })
);

/* =============================================================================
   1.5 GET /api/attendance/verify-qr/:company_id
   ============================================================================= */
router.get(
  '/verify-qr/:company_id',
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { company_id } = req.params;

    // Use service role to securely fetch the employee without triggering RLS blocks
    // Smart check: Some QR codes contain the UUID instead of the CP-XXXX ID.
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(company_id);
    
    const { data: employee, error } = await supabase
      .from('employees')
      .select('id, first_name, last_name, company_id, has_registered_biometrics, is_active')
      .eq(isUUID ? 'id' : 'company_id', company_id)
      .single();

    if (error || !employee) {
      throw new NotFoundError('Employee not found.');
    }

    res.json({ status: 'success', data: employee });
  })
);

/* =============================================================================
   2. POST /api/attendance/scan
   ============================================================================= */
router.post(
  '/scan',
  rateLimiter({
    windowMs: CONFIG.RATE_LIMITS.SCAN_WINDOW_MS,
    maxRequests: CONFIG.RATE_LIMITS.SCAN_MAX_REQUESTS,
    keyPrefix: 'scan',
  }),
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id, image_data, face_match_score } = req.body;

    // ── Validation ──
    if (!employee_id || !isValidUUID(employee_id)) {
      throw new ValidationError('Valid employee_id (UUID) is required.');
    }
    if (image_data && !isValidBase64Image(image_data)) {
      throw new ValidationError('image_data must be a valid base64 data URI (jpeg/png/webp).');
    }
    if (face_match_score !== undefined && face_match_score !== null) {
      const score = parseFloat(face_match_score);
      if (Number.isNaN(score) || score < 0 || score > 100) {
        throw new ValidationError('face_match_score must be a number between 0 and 100.');
      }
    }

    // ── Fetch Employee (with row-level locking intent via single()) ──
    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, company_id, has_registered_biometrics, is_active, requires_password_change')
      .eq('id', employee_id)
      .single();

    if (empErr || !employee) {
      logger.security(reqId, 'Scan attempt with invalid employee_id', { employee_id, ip: req.ip });
      throw new NotFoundError('Invalid credentials. Employee not found.');
    }

    if (!employee.is_active) {
      await auditLog(reqId, { employee_id, action: 'SCAN_BLOCKED_INACTIVE', details: {}, ip_address: req.ip });
      throw new AuthorizationError('Employee account is deactivated. Contact HR.');
    }

    // ── Biometric Enforcement ──
    if (employee.has_registered_biometrics) {
      if (face_match_score === undefined || face_match_score === null) {
        await logSecurityViolation(reqId, employee_id, 'Biometric Bypass', 'Missing face match score.', req.ip);
        throw new AuthorizationError('BIOMETRIC BYPASS DETECTED: Missing face match score.');
      }
      if (!image_data) {
        await logSecurityViolation(reqId, employee_id, 'Biometric Bypass', 'Missing camera frame.', req.ip);
        throw new AuthorizationError('BIOMETRIC BYPASS DETECTED: Missing camera frame.');
      }

      const score = parseFloat(face_match_score);
      if (score < CONFIG.BIOMETRICS.MATCH_THRESHOLD) {
        const reason = `Buddy-punching attempt. Face match score: ${score}% (min: ${CONFIG.BIOMETRICS.MATCH_THRESHOLD}%).`;
        await logSecurityViolation(reqId, employee_id, 'Identity Mismatch', reason, req.ip);
        throw new AuthorizationError(`IDENTITY MISMATCH: Face verification failed (${score}%). Incident logged.`);
      }
      logger.info(reqId, 'Biometric identity passed', { employee_id, score });
    }

    const todayStr = getTodayString();

    // ── Atomic Check: Existing Record ──
    const { data: existing, error: existErr } = await supabase
      .from('attendances')
      .select('id, time_in, time_out, date')
      .eq('employee_id', employee_id)
      .eq('date', todayStr)
      .maybeSingle();

    if (existErr) throw new AppError(`Database error: ${existErr.message}`, 500, 'DB_ERROR');

    if (existing?.time_out) {
      throw new ConflictError('You have already completed your attendance for today.');
    }

    // ── AI Liveness Verification ──
    let livenessPassed = false;
    let livenessConfidence = null;
    let livenessReason = 'Not performed';

    if (image_data) {
      const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
      try {
        const result = await performLivenessCheck(reqId, base64Data, false);
        livenessPassed = result.passed;
        livenessConfidence = result.confidence;
        livenessReason = result.reason;

        if (!result.passed) {
          const desc = `Biometric spoofing attempt. AI Confidence: ${Math.round(result.confidence * 100)}%. ${result.reason}`;
          await logSecurityViolation(reqId, employee_id, 'Spoofing Attempt', desc, req.ip);
          throw new AuthorizationError(`BIOMETRIC SPOOFING DETECTED: ${result.reason} [Confidence: ${Math.round(result.confidence * 100)}%]`);
        }
        logger.info(reqId, 'Liveness check passed', { employee_id, confidence: result.confidence });
      } catch (err) {
        if (err.code === 'AI_SERVICE_UNAVAILABLE' || err.code === 'AI_CIRCUIT_OPEN') {
          // Fail-safe: deny if biometrics are required but AI is down
          if (employee.has_registered_biometrics) {
            logger.security(reqId, 'Clock-in denied due to AI outage', { employee_id });
            throw new AuthorizationError('Biometric verification service unavailable. Please contact administrator.');
          }
          // If no biometrics registered, log warning but allow (legacy mode)
          logger.warn(reqId, 'Liveness check skipped due to AI outage', { employee_id });
          livenessReason = 'Skipped: AI outage';
        } else {
          throw err;
        }
      }
    }

    // ── Execute Clock-In or Clock-Out ──
    const now = new Date();
    const photoPath = await uploadImage(reqId, image_data, existing ? 'out' : 'in', employee.company_id || employee_id);

    if (!existing) {
      // ═══ TIME IN ═══
      const callTime = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.ATTENDANCE.TIMEZONE }));
      callTime.setHours(CONFIG.ATTENDANCE.CALL_TIME_HOUR, CONFIG.ATTENDANCE.CALL_TIME_MINUTE, 0, 0);
      const graceDeadline = new Date(callTime.getTime() + CONFIG.ATTENDANCE.GRACE_PERIOD_MINUTES * 60_000);

      let status = 'Present';
      let message = `TIME IN SUCCESS: Welcome, ${employee.first_name} ${employee.last_name}!`;

      if (now > graceDeadline) {
        status = 'Late';
        const minutesLate = Math.floor((now - callTime) / 60_000);
        message = `TIME IN SUCCESS: Welcome, ${employee.first_name}! (You are ${minutesLate} minutes late).`;
      }

      const { error: insertErr } = await supabase.from('attendances').insert({
        employee_id,
        date: todayStr,
        time_in: now.toISOString(),
        status,
        time_in_photo: photoPath,
        liveness_confidence: livenessConfidence,
        liveness_verified: livenessPassed,
        scanned_from_ip: req.ip,
      });

      if (insertErr) {
        // Handle unique constraint race condition
        if (insertErr.code === '23505') {
          throw new ConflictError('Attendance record already created. Please scan again for time-out.');
        }
        throw new AppError(`Database error: ${insertErr.message}`, 500, 'DB_ERROR');
      }

      logger.info(reqId, 'Time-in recorded', { employee_id, status, minutesLate: status === 'Late' ? Math.floor((now - callTime) / 60_000) : 0 });

      await auditLog(reqId, { employee_id, action: 'TIME_IN', details: { status, livenessConfidence }, ip_address: req.ip });

      return res.status(201).json({
        status: 'success',
        code: 'TIME_IN',
        message,
        data: { employee_id, date: todayStr, status, time_in: now.toISOString() },
      });
    } else {
      // ═══ TIME OUT ═══
      const { error: updateErr } = await supabase
        .from('attendances')
        .update({
          time_out: now.toISOString(),
          time_out_photo: photoPath,
          liveness_confidence_out: livenessConfidence,
          liveness_verified_out: livenessPassed,
        })
        .eq('id', existing.id)
        .eq('time_out', null); // Optimistic lock

      if (updateErr) throw new AppError(`Database error: ${updateErr.message}`, 500, 'DB_ERROR');

      // Verify update succeeded (optimistic lock check)
      const { data: verify } = await supabase.from('attendances').select('time_out').eq('id', existing.id).single();
      if (!verify?.time_out) {
        throw new ConflictError('Attendance already updated. Please refresh.');
      }

      logger.info(reqId, 'Time-out recorded', { employee_id, attendance_id: existing.id });

      await auditLog(reqId, { employee_id, action: 'TIME_OUT', details: { attendance_id: existing.id }, ip_address: req.ip });

      return res.json({
        status: 'success',
        code: 'TIME_OUT',
        message: `TIME OUT SUCCESS: Goodbye, ${employee.first_name} ${employee.last_name}!`,
        data: { employee_id, date: todayStr, time_out: now.toISOString() },
      });
    }
  })
);

/* =============================================================================
   3. GET /api/attendance/calendar
   ============================================================================= */
router.get(
  '/calendar',
  checkAdminOrOwnership,
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { date = getTodayString() } = req.query;

    if (!isValidISODate(date)) {
      throw new ValidationError('Invalid date. Expected YYYY-MM-DD.');
    }

    const [year, month] = date.split('-');

    const [dailyLogsResult, activeDatesResult] = await Promise.all([
      supabase
        .from('attendances')
        .select('*, employees:employee_id(*)')
        .eq('date', date),
      supabase
        .from('attendances')
        .select('date')
        .gte('date', `${year}-${month}-01`)
        .lte('date', `${year}-${month}-31`),
    ]);

    if (dailyLogsResult.error) throw new AppError(`Database error: ${dailyLogsResult.error.message}`, 500, 'DB_ERROR');
    if (activeDatesResult.error) throw new AppError(`Database error: ${activeDatesResult.error.message}`, 500, 'DB_ERROR');

    const activeDates = [...new Set(activeDatesResult.data?.map(d => d.date))].sort();

    logger.info(reqId, 'Calendar data fetched', { date, dailyCount: dailyLogsResult.data?.length, activeDatesCount: activeDates.length });

    res.json({
      status: 'success',
      data: {
        selectedDate: date,
        dailyLogs: dailyLogsResult.data,
        activeDates,
      },
    });
  })
);

/* =============================================================================
   4. POST /api/attendance/register-baseline
   ============================================================================= */
router.post(
  '/register-baseline',
  rateLimiter({
    windowMs: CONFIG.RATE_LIMITS.ENROLL_WINDOW_MS,
    maxRequests: CONFIG.RATE_LIMITS.ENROLL_MAX_REQUESTS,
    keyPrefix: 'enroll',
  }),
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id, company_id, image_base64 } = req.body;

    // ── Validation ──
    if (!employee_id || !isValidUUID(employee_id)) {
      throw new ValidationError('Valid employee_id (UUID) is required.');
    }
    if (!company_id || typeof company_id !== 'string') {
      throw new ValidationError('company_id is required.');
    }
    if (!image_base64 || !isValidBase64Image(image_base64)) {
      throw new ValidationError('Valid image_base64 (data URI) is required.');
    }

    // ── Verify Employee ──
    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, company_id, is_active')
      .eq('id', employee_id)
      .single();

    if (empErr || !employee) throw new NotFoundError('Employee not found.');
    if (!employee.is_active) throw new AuthorizationError('Cannot register biometrics for inactive employee.');
    if (employee.company_id !== company_id) {
      await logSecurityViolation(reqId, employee_id, 'Enrollment Tampering', 'company_id mismatch during baseline registration.', req.ip);
      throw new AuthorizationError('Company ID mismatch. Enrollment denied.');
    }

    // ── AI Liveness (Inline) ──
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");

    let livenessResult;
    try {
      livenessResult = await performLivenessCheck(reqId, base64Data, true);
    } catch (err) {
      if (err.code === 'AI_SERVICE_UNAVAILABLE' || err.code === 'AI_CIRCUIT_OPEN') {
        throw new AuthorizationError('Biometric enrollment requires AI verification. Service temporarily unavailable.');
      }
      throw err;
    }

    if (!livenessResult.passed) {
      const desc = `Enrollment spoofing. Confidence: ${Math.round(livenessResult.confidence * 100)}%. ${livenessResult.reason}`;
      await logSecurityViolation(reqId, employee_id, 'Enrollment Spoofing', desc, req.ip);
      throw new AuthorizationError(`BIOMETRIC SPOOFING DETECTED: ${livenessResult.reason} [Confidence: ${Math.round(livenessResult.confidence * 100)}%]`);
    }

    // ── Store Baseline ──
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `${CONFIG.STORAGE.BASELINE_PREFIX}/${company_id}/${employee_id}.jpg`;

    const { error: uploadErr } = await supabase.storage
      .from(CONFIG.STORAGE.BUCKET)
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '31536000', // 1 year immutable
      });

    if (uploadErr) throw new AppError(`Storage error: ${uploadErr.message}`, 500, 'STORAGE_ERROR');

    // ── Update Database ──
    const { error: dbErr } = await supabase
      .from('employees')
      .update({
        has_registered_biometrics: true,
        biometric_baseline_path: fileName,
        biometric_registered_at: new Date().toISOString(),
        biometric_liveness_confidence: livenessResult.confidence
      })
      .eq('id', employee_id);

    if (dbErr) {
      logger.error(reqId, 'Failed to update database with biometric status', dbErr);
    }

    // Update auth user metadata
    const { error: metaErr } = await supabase.auth.admin.updateUserById(employee_id, {
      user_metadata: { has_registered_biometrics: true }
    });
    if (metaErr) {
      logger.error(reqId, `Failed to update user_metadata for ${employee_id}`, metaErr);
    }
    
    logger.info(reqId, 'Biometric baseline registered', { employee_id, fileName, confidence: livenessResult.confidence });

    await auditLog(reqId, {
      employee_id,
      action: 'BIOMETRIC_ENROLLMENT',
      details: { fileName, confidence: livenessResult.confidence },
      ip_address: req.ip,
    });

    res.status(201).json({
      status: 'success',
      code: 'ENROLLMENT_COMPLETE',
      message: 'Biometric baseline registered successfully.',
      data: { employee_id, registered_at: new Date().toISOString() },
    });
  })
);

/* =============================================================================
   5. POST /api/attendance/password-changed
   ============================================================================= */
router.post(
  '/password-changed',
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id } = req.body;

    if (!employee_id || !isValidUUID(employee_id)) {
      throw new ValidationError('Valid employee_id (UUID) is required.');
    }

    const { error } = await supabase
      .from('employees')
      .update({ requires_password_change: false, password_changed_at: new Date().toISOString() })
      .eq('id', employee_id);

    if (error) throw new AppError(`Database error: ${error.message}`, 500, 'DB_ERROR');

    logger.info(reqId, 'Password change status cleared', { employee_id });

    await auditLog(reqId, { employee_id, action: 'PASSWORD_CHANGED_ACK', details: {}, ip_address: req.ip });

    res.json({ status: 'success', code: 'PASSWORD_STATUS_CLEARED' });
  })
);

/* =============================================================================
   GLOBAL ERROR HANDLER FOR THIS ROUTER
   ============================================================================= */
router.use((err, req, res, next) => {
  sendError(res, err, req.reqId);
});

export default router;
