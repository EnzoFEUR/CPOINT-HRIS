import express from 'express';
import { postgrestLikeValue } from '../middleware/requestValidation.js';
import { supabase } from '../supabaseClient.js';
import { Brain } from '../services/geminiBrain.js';
import { checkVerifiedManagerOrOwnership, hasVerifiedManagerRole, invalidateAuthUser } from '../middleware/authMiddleware.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { isAttendanceExempt, isWorkforceEmployee, applyAttendanceWorkforceFilters } from '../utils/workforce.js';
import { getEmployeeMonthlyAttendance } from '../utils/attendanceReconciliation.js';
import { disciplinaryService } from '../services/disciplinaryService.js';
import { publishCommittedDisciplinary } from '../services/disciplinaryEvents.js';

import { getWorkPolicy, getEmployeeRestDays, getGraceDeadline, getChargeableLateMinutes } from '../../shared/workPolicy.mjs';
import { getActiveWorkPolicy } from './payroll.js';

const router = express.Router();
const WORK_POLICY = getWorkPolicy(process.env);
const attendanceCache = cacheResponse(15);
const monthlyAttendanceCache = cacheResponse(15);

// Attendance and biometrics configuration
const CONFIG = Object.freeze({
  BIOMETRICS: {
    MATCH_THRESHOLD: parseInt(process.env.BIOMETRIC_MATCH_THRESHOLD, 10) || 55,
    LIVENESS_CONFIDENCE_MIN: parseFloat(process.env.LIVENESS_CONFIDENCE_MIN) || 0.55,
    ENROLLMENT_CONFIDENCE_MIN: parseFloat(process.env.ENROLLMENT_CONFIDENCE_MIN) || 0.60,
  },
  ATTENDANCE: {
    GRACE_PERIOD_MINUTES: WORK_POLICY.gracePeriodMinutes,
    CALL_TIME_HOUR: WORK_POLICY.callTimeHour,
    CALL_TIME_MINUTE: WORK_POLICY.callTimeMinute,
    TIMEZONE: WORK_POLICY.timeZone,
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

// Audit logger
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

// Custom error classes
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

// In-memory rate limiter (replace with redis in production)
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
      res.setHeader('Retry-After', Math.max(1, Math.ceil((timestamps[0] + windowMs - now) / 1000)));
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

// Request context middleware
router.use((req, res, next) => {
  req.reqId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-Id', req.reqId);
  next();
});

// Validation helpers
const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
const isValidISODate = (str) => /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str));
const isValidBase64Image = (str) => typeof str === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,/.test(str);
const sanitizeString = (str) => (typeof str === 'string' ? str.trim().slice(0, 500) : str);

// Timezone-aware date helpers
const getTodayString = () => {
  return new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.ATTENDANCE.TIMEZONE });
};

const getGracePeriodDeadline = () => {
  return getGraceDeadline(getTodayString(), WORK_POLICY);
};

// Verify face match and liveness
const performBiometricVerification = async (reqId, base64Data, employee = null, isEnrollment = false, livenessData = null) => {
  // Validate client liveness challenge
  if (!isEnrollment && livenessData) {
    const { challenge_passed, challenge_type, client_timestamp, depth_variance, blink_count } = livenessData;

    // Head turn challenge
    if (!challenge_passed) {
      logger.security(reqId, 'Biometric spoofing rejected: Active challenge failed', { livenessData });
      return {
        passed: false,
        confidence: 0,
        reason: 'Active 3D head-pose challenge incomplete or failed. Re-alignment required.',
        spoof_type: 'FAILED_HEAD_CHALLENGE'
      };
    }

    // Payload freshness check (within 60s)
    const clientTime = new Date(client_timestamp).getTime();
    const now = Date.now();
    if (isNaN(clientTime) || Math.abs(now - clientTime) > 60000) {
      logger.security(reqId, 'Biometric replay attack: Stale timestamp', { client_timestamp });
      return {
        passed: false,
        confidence: 0,
        reason: 'Expired or replayed biometric telemetry timestamp.',
        spoof_type: 'REPLAY_ATTACK'
      };
    }

    // Depth variance check for 2D screen or print detection
    if (typeof depth_variance === 'number' && depth_variance < 0.0005) {
      logger.security(reqId, 'Biometric spoofing rejected: Planar 2D surface detected', { depth_variance });
      return {
        passed: false,
        confidence: 0.05,
        reason: 'Planar 2D presentation attack detected (insufficient depth parallax).',
        spoof_type: 'PLANAR_2D_SPOOF'
      };
    }

    // Eye blink check
    if (typeof blink_count === 'number' && blink_count < 1) {
      logger.security(reqId, 'Biometric spoofing rejected: Biological blink unverified', { blink_count });
      return {
        passed: false,
        confidence: 0.1,
        reason: 'Biological eye blink verification incomplete.',
        spoof_type: 'NO_BLINK'
      };
    }
  }

  try {
    const cameraBuffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    // Dual-image verification against baseline photo
    if (!isEnrollment && employee?.biometric_baseline_path) {
      try {
        const { data: baselineBlob, error: dlErr } = await supabase.storage
          .from(CONFIG.STORAGE.BUCKET)
          .download(employee.biometric_baseline_path);

        if (!dlErr && baselineBlob) {
          const baselineBuffer = Buffer.from(await baselineBlob.arrayBuffer());
          const dualResult = await Brain.Biometrics.verifyIdentityMatch(cameraBuffer, baselineBuffer);
          logger.info(reqId, 'Dual-image biometric match evaluated', {
            employee_id: employee.id,
            is_same_person: dualResult.is_same_person,
            match_confidence: dualResult.match_confidence,
            liveness: dualResult.is_live_person,
            similarity: dualResult.similarity_score_percent,
            verdict: dualResult.verdict
          });
          return dualResult;
        }
      } catch (baselineErr) {
        logger.warn(reqId, 'Baseline download note, falling back to single-image liveness', { error: baselineErr.message });
      }
    }

    // Single-image liveness verification
    const result = await Brain.Biometrics.checkLiveness(cameraBuffer, isEnrollment);
    logger.info(reqId, 'Biometrics liveness evaluated via GeminiBrain', { passed: result.passed, confidence: result.confidence });
    return result;
  } catch (err) {
    logger.error(reqId, 'Biometric verification service error', { error: err.message });
    return {
      passed: false,
      is_same_person: false,
      confidence: 0,
      match_confidence: 0,
      similarity_score_percent: 0,
      reason: `Biometric verification unavailable: ${err.message}`,
      fallback: false,
      error: true
    };
  }
};

// Image storage service
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

// Security alerts service
const logSecurityViolation = async (reqId, employee_id, type, description, ip_address) => {
  const payload = {
    employee_id,
    type,
    reason: sanitizeString(description),
    severity: 'High',
    status: 'Active',
    date: getTodayString(),
    created_at: new Date().toISOString(),
  };

  // Write to disciplinary_logs
  try {
    const { error: discErr } = await supabase.from('disciplinary_logs').insert(payload);
    if (discErr) logger.error(reqId, 'Failed to write disciplinary log', { error: discErr.message });
  } catch (err) {
    logger.error(reqId, 'Failed to write disciplinary log', { error: err.message });
  }

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

// Error handler wrapper
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

// 1. GET /api/attendance (Admin View)
router.get(
  '/',
  checkVerifiedManagerOrOwnership,
  (req, res, next) => {
    if (req.query.refresh === 'true' || req.query.payroll_preview === 'true') {
      invalidateCache('/api/attendance');
      return next();
    }
    return attendanceCache(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id, start_date, end_date, date, department, roster, page = '1', limit = '100' } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(250, Math.max(1, parseInt(limit, 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    // Validate filters
    if (employee_id && !isValidUUID(employee_id)) {
      throw new ValidationError('Invalid employee_id format. Expected UUID.');
    }
    if (date && !isValidISODate(date)) {
      throw new ValidationError('Invalid date. Expected YYYY-MM-DD.');
    }
    if (start_date && !isValidISODate(start_date)) {
      throw new ValidationError('Invalid start_date. Expected YYYY-MM-DD.');
    }
    if (end_date && !isValidISODate(end_date)) {
      throw new ValidationError('Invalid end_date. Expected YYYY-MM-DD.');
    }

    // Daily workforce roster mode (when date is specified or roster=true without date range)
    if ((date || roster === 'true') && !start_date && !end_date) {
      const targetDate = date || getTodayString();
      const [allEmpsRes, dailyLogsRes, dailyLeavesRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, company_id, first_name, last_name, role, department, job_title, status, date_hired, timekeeping_effective_date, created_at'),
        supabase
          .from('attendances')
          .select('*, employees:employee_id(*)')
          .eq('date', targetDate),
        supabase
          .from('leave_requests')
          .select('id, employee_id, start_date, end_date, type, status, notes, credit_pool, requested_pay_type, employees:employee_id(*)')
          .eq('status', 'Approved')
          .lte('start_date', targetDate)
          .gte('end_date', targetDate)
      ]);

      if (allEmpsRes.error) throw new AppError(`Database error: ${allEmpsRes.error.message}`, 500, 'DB_ERROR');
      if (dailyLogsRes.error) throw new AppError(`Database error: ${dailyLogsRes.error.message}`, 500, 'DB_ERROR');

      let activeWorkforce = (allEmpsRes.data || []).filter(e => isWorkforceEmployee(e));
      if (department && department.toLowerCase() !== 'all') {
        activeWorkforce = activeWorkforce.filter(e => e.department?.toLowerCase() === department.toLowerCase());
      }
      if (employee_id) {
        activeWorkforce = activeWorkforce.filter(e => e.id === employee_id);
      }

      const attMap = new Map();
      (dailyLogsRes.data || []).forEach(a => attMap.set(a.employee_id, a));

      const leaveMap = new Map();
      (dailyLeavesRes.data || []).forEach(l => leaveMap.set(l.employee_id, l));

      const isToday = targetDate === getTodayString();

      const reconciledList = activeWorkforce.map(emp => {
        const punch = attMap.get(emp.id);
        const leave = leaveMap.get(emp.id);

        if (punch) {
          const isOnLeave = punch.status === 'On Leave' || Boolean(leave);
          if (isOnLeave) {
            const isPaid = leave
              ? (leave.requested_pay_type === 'with_pay' || leave.credit_pool === 'sil' || !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(leave.notes || ''))
              : !/unpaid/i.test(punch.status || '');
            return {
              ...punch,
              is_on_leave: true,
              status: isPaid ? 'Paid Leave' : 'On Leave',
              leave_type: leave?.type || 'Leave',
              is_paid: isPaid,
              leave_pay_type: isPaid ? 'with_pay' : 'without_pay',
              notes: punch.notes || leave?.notes || null,
              employees: punch.employees || emp
            };
          }
          return {
            ...punch,
            employees: punch.employees || emp
          };
        }

        if (leave) {
          const isPaid = (leave.requested_pay_type === 'with_pay' || leave.credit_pool === 'sil' || !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(leave.notes || ''));
          return {
            id: `leave-${leave.id}-${targetDate}`,
            employee_id: emp.id,
            date: targetDate,
            time_in: null,
            time_out: null,
            status: isPaid ? 'Paid Leave' : 'On Leave',
            is_on_leave: true,
            leave_type: leave.type || 'Leave',
            is_paid: isPaid,
            leave_pay_type: isPaid ? 'with_pay' : 'without_pay',
            employees: emp,
            notes: leave.notes || null,
            created_at: leave.created_at || new Date().toISOString()
          };
        }

        const empHireDate = String(emp.date_hired || emp.created_at || '').slice(0, 10);
        const isPreHire = Boolean(empHireDate && targetDate < empHireDate);
        if (isPreHire) {
          return {
            id: `roster-${emp.id}-${targetDate}`,
            employee_id: emp.id,
            date: targetDate,
            time_in: null,
            time_out: null,
            status: 'Pre-Hire',
            is_absent: false,
            is_pre_hire: true,
            is_awaiting: false,
            employees: emp,
            notes: 'Prior to employee commencement date',
            created_at: new Date().toISOString()
          };
        }

        const timekeepingStart = String(emp.timekeeping_effective_date || emp.created_at || emp.date_hired || '').slice(0, 10);
        const isUntracked = Boolean(timekeepingStart && targetDate < timekeepingStart);
        if (isUntracked) {
          return {
            id: `roster-${emp.id}-${targetDate}`,
            employee_id: emp.id,
            date: targetDate,
            time_in: null,
            time_out: null,
            status: 'Legacy Tenure',
            is_absent: false,
            is_not_tracked: true,
            is_awaiting: false,
            employees: emp,
            notes: 'Prior to digital timekeeping cutover',
            created_at: new Date().toISOString()
          };
        }

        return {
          id: `roster-${emp.id}-${targetDate}`,
          employee_id: emp.id,
          date: targetDate,
          time_in: null,
          time_out: null,
          status: isToday ? 'Awaiting Clock-in' : 'Absent',
          is_absent: !isToday,
          is_awaiting: isToday,
          employees: emp,
          created_at: new Date().toISOString()
        };
      });

      logger.info(reqId, 'Daily attendance roster fetched', { date: targetDate, count: reconciledList.length, department });

      const activeWorkPolicy = await getActiveWorkPolicy();

      return res.json({
        status: 'success',
        data: reconciledList,
        meta: {
          workPolicy: activeWorkPolicy,
          date: targetDate,
          department: department || 'All',
          total: reconciledList.length,
          page: 1,
          limit: reconciledList.length,
          totalPages: 1
        }
      });
    }

    let query = applyAttendanceWorkforceFilters(supabase
      .from('attendances')
      .select('*, employees:employee_id(*), workforce:employee_id()', { count: 'exact' }), department)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (employee_id) query = query.eq('employee_id', employee_id);
    if (date) query = query.eq('date', date);
    if (start_date && end_date) {
      query = query.gte('date', start_date).lte('date', end_date);
    } else if (start_date) {
      query = query.gte('date', start_date);
    } else if (end_date) {
      query = query.lte('date', end_date);
    }

    let result = await query;
    if (offset > 0 && result.error?.code === 'PGRST103') {
      // A filter change or deletion may leave the client on a page that no longer exists.
      result = { ...await query.range(0, 0), data: [] };
    }
    const { data, error, count } = result;
    if (error) throw new AppError(`Database error: ${error.message}`, 500, 'DB_ERROR');

    logger.info(reqId, 'Attendance list fetched', { count: data?.length, total: count, filters: { employee_id, start_date, end_date } });

    // Non-blocking asynchronous audit log (does not delay client response)
    auditLog(reqId, {
      employee_id: req.user?.id,
      action: 'ATTENDANCE_LIST_VIEW',
      details: { filters: { employee_id, start_date, end_date }, results: count },
      ip_address: req.ip,
    }).catch(err => logger.error(reqId, 'Background audit log failed', { error: err.message }));

    const baseList = data || [];

    // Parallel fetch matching approved leave requests to reconcile and enrich leave statuses
    const empIds = [...new Set(baseList.map(l => l.employee_id).filter(Boolean))];
    const dates = baseList.map(l => l.date).filter(Boolean);
    let approvedLeaves = [];

    if (empIds.length > 0 && dates.length > 0) {
      const minDate = dates.reduce((min, d) => d < min ? d : min, dates[0]);
      const maxDate = dates.reduce((max, d) => d > max ? d : max, dates[0]);

      const { data: leaves, error: leaveError } = await supabase
        .from('leave_requests')
        .select('id, employee_id, start_date, end_date, type, status, notes, credit_pool, requested_pay_type')
        .in('employee_id', empIds)
        .eq('status', 'Approved')
        .lte('start_date', maxDate)
        .gte('end_date', minDate);
      if (leaveError) throw new AppError(`Database error: ${leaveError.message}`, 500, 'DB_ERROR');
      approvedLeaves = leaves || [];
    }

    const filteredData = baseList.map(log => {
      const matchingLeave = approvedLeaves.find(l => 
        l.employee_id === log.employee_id && 
        log.date >= l.start_date && 
        log.date <= l.end_date
      );
      const isOnLeave = log.status === 'On Leave' || Boolean(matchingLeave);
      if (isOnLeave) {
        const isPaid = matchingLeave
          ? (matchingLeave.requested_pay_type === 'with_pay' || matchingLeave.credit_pool === 'sil' || !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(matchingLeave.notes || ''))
          : !/unpaid/i.test(log.status || '');
        return {
          ...log,
          is_on_leave: true,
          status: isPaid ? 'Paid Leave' : 'On Leave',
          leave_type: matchingLeave?.type || 'Leave',
          is_paid: isPaid,
          leave_pay_type: isPaid ? 'with_pay' : 'without_pay',
          notes: log.notes || matchingLeave?.notes || null,
        };
      }
      return log;
    });

    const activeWorkPolicy = await getActiveWorkPolicy();

    res.json({
      status: 'success',
      data: filteredData,
      meta: {
        workPolicy: activeWorkPolicy,
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  })
);

// 1.5 GET /api/attendance/verify-qr/:company_id
router.get(
  '/verify-qr/:company_id',
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    let { company_id } = req.params;

    if (!company_id) {
      throw new ValidationError('Company ID or UUID is required.');
    }

    // Sanitize and decode QR text
    let target = decodeURIComponent(company_id).trim();

    // Parse JSON QR codes if applicable (e.g. {"id":"...", "company_id":"..."})
    if (target.startsWith('{') && target.endsWith('}')) {
      try {
        const parsed = JSON.parse(target);
        target = parsed.company_id || parsed.id || parsed.employee_id || target;
      } catch (_) {}
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target);
    
    let query = supabase
      .from('employees')
      .select('id, first_name, last_name, company_id, has_registered_biometrics, biometric_baseline_path, is_active, status, job_title, department, role, medical_record_url');

    if (isUUID) {
      query = query.eq('id', target);
    } else {
      query = query.ilike('company_id', target);
    }

    let { data: employee, error } = await query.maybeSingle();

    // Fallback: If not found by primary field, search other identifiers
    if (!employee) {
      const { data: fallbackEmp } = await supabase
        .from('employees')
        .select('id, first_name, last_name, company_id, has_registered_biometrics, biometric_baseline_path, is_active, status, job_title, department, role, medical_record_url')
        .or(`company_id.ilike.${postgrestLikeValue(target)},id.eq.${isUUID ? target : '00000000-0000-0000-0000-000000000000'},email.ilike.${postgrestLikeValue(target)}`)
        .maybeSingle();

      employee = fallbackEmp;
    }

    if (!employee) {
      logger.warn(reqId, 'Employee not found for QR scan', { query: target });
      throw new NotFoundError(`Employee not found for QR value: ${target}`);

    }
    // Disciplinary boundary and expiration check on QR scan
    const isSusp = employee.status === 'Suspended' || employee.status === 'suspended';
    if (isSusp) {
      const { data: discLog } = await supabase
        .from('disciplinary_logs')
        .select('id, type, reason, date, status')
        .eq('employee_id', employee.id)
        .eq('type', 'Suspension')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const todayStr = getTodayString();
      if (discLog) {
        const matchUntil = (discLog.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        const endDateStr = matchUntil ? matchUntil[1] : null;
        const matchFrom = (discLog.reason || '').match(/From\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        const startDateStr = matchFrom ? matchFrom[1] : (discLog.date || null);

        if (endDateStr && todayStr > endDateStr) {
          const committed = await disciplinaryService.expire(employee.id, discLog.id);
          Object.assign(employee, committed.employee);
          publishCommittedDisciplinary(committed);
        } else if (startDateStr && todayStr < startDateStr) {
          // Allow only this pre-effective-date scan; keep the stored suspension for its start date.
          employee.status = 'active';
          employee.is_active = true;
        }
      }
    }

    // System operators (Admins, HR, Security Guards) do not log attendance
    if (isAttendanceExempt(employee)) {
      logger.info(reqId, 'QR scan flagged exempt: Personnel is an attendance-exempt operator', { employee_id: employee.id, role: employee.role });
      return res.json({
        status: 'success',
        data: {
          ...employee,
          is_attendance_exempt: true,
          name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Staff'
        }
      });
    }

    let isMedicalGrace = false;
    let medicalExemption = null;
    if (employee.medical_record_url) {
      try {
        const parsed = JSON.parse(employee.medical_record_url);
        if (parsed?.exempt) {
          const today = getTodayString();
          if (!parsed.valid_until || parsed.valid_until >= today) {
            isMedicalGrace = true;
            medicalExemption = parsed;
          }
        }
      } catch (_) {}
    }

    // Require biometric registration
    const hasBiometrics = Boolean(employee.has_registered_biometrics || employee.biometric_baseline_path);
    if (!hasBiometrics && !isMedicalGrace) {
      logger.warn(reqId, 'QR scan rejected: Unregistered face biometrics', { employee_id: employee.id, company_id: employee.company_id });
      throw new AuthorizationError('BIOMETRICS REQUIRED: Personnel has not completed face biometric registration. Access denied until facial profile is enrolled.');
    }

    res.json({
      status: 'success',
      data: {
        ...employee,
        is_medical_exempt: isMedicalGrace,
        medical_exemption: medicalExemption,
        name: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || 'Employee'
      }
    });
  })
);

// 2. POST /api/attendance/scan
router.post(
  '/scan',
  rateLimiter({
    windowMs: CONFIG.RATE_LIMITS.SCAN_WINDOW_MS,
    maxRequests: CONFIG.RATE_LIMITS.SCAN_MAX_REQUESTS,
    keyPrefix: 'scan',
  }),
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id, image_data, face_match_score, liveness_data } = req.body;

    // Validation
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

    // Fetch Employee (with row-level locking intent via single())
    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employee_id)
      .single();

    if (empErr || !employee) {
      logger.security(reqId, 'Scan attempt with invalid employee_id', { employee_id, ip: req.ip });
      throw new NotFoundError('Invalid credentials. Employee not found.');
    }

    if (isAttendanceExempt(employee)) {
      logger.info(reqId, 'Scan blocked: Personnel is an attendance-exempt operator', { employee_id, role: employee.role });
      throw new ValidationError('Exempt personnel (Admin / Security Guard). Attendance clock-in is not required.');
    }

    let isSuspended = employee.status === 'Suspended' || employee.status === 'suspended';
    let isTerminated = employee.status === 'Terminated' || employee.status === 'terminated';

    if (!employee.is_active || isSuspended || isTerminated) {
      const { data: discLog } = await supabase
        .from('disciplinary_logs')
        .select('id, type, reason, date, status')
        .eq('employee_id', employee_id)
        .in('type', ['Suspension', 'Termination'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const todayStr = getTodayString();

      // Check disciplinary effective-date boundary and expiration
      if (isSuspended && discLog && discLog.type === 'Suspension') {
        const matchUntil = (discLog.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        const endDateStr = matchUntil ? matchUntil[1] : null;
        const matchFrom = (discLog.reason || '').match(/From\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        const startDateStr = matchFrom ? matchFrom[1] : (discLog.date || null);

        if (endDateStr && todayStr > endDateStr) {
          // Suspension interval has ended: Auto-reinstate employee
          const committed = await disciplinaryService.expire(employee_id, discLog.id);
          Object.assign(employee, committed.employee);
          isSuspended = employee.status?.toLowerCase() === 'suspended';
          isTerminated = employee.status?.toLowerCase() === 'terminated' || employee.separation_type === 'Disciplinary Termination';
          publishCommittedDisciplinary(committed);
          logger.info(reqId, 'Expired suspension reconciled at turnstile', { employee_id, endDateStr, todayStr, employment_restored: committed.employment_restored });
        } else if (startDateStr && todayStr < startDateStr) {
          // Future suspension: Interval has not arrived yet; employee remains active before effective interval
          // Allow only this pre-effective-date scan; keep the stored suspension for its start date.
          employee.status = 'active';
          employee.is_active = true;
          isSuspended = false;
          logger.info(reqId, 'Disciplinary suspension is future-dated; employee allowed before effective interval', { employee_id, startDateStr, todayStr });
        }
      }

      if (!employee.is_active || isSuspended || isTerminated) {
        const discType = isSuspended ? 'Suspension' : (isTerminated ? 'Termination' : (discLog?.type || 'Deactivated'));
        const errorMessage = discType === 'Suspension'
          ? 'ACCESS DENIED: Attendance prohibited. Personnel account is currently under disciplinary suspension.'
          : discType === 'Termination'
          ? 'ACCESS DENIED: Attendance pass revoked. Personnel employment has been terminated.'
          : 'Employee account is deactivated. Contact HR.';

        await auditLog(reqId, { employee_id, action: `SCAN_BLOCKED_${discType.toUpperCase()}`, details: { reason: discLog?.reason }, ip_address: req.ip });
        throw new AuthorizationError(errorMessage);
      }
    }

    // Check for active medical exemption
    let isMedicalGrace = false;
    let medicalExemption = null;
    if (employee.medical_record_url) {
      try {
        const parsed = JSON.parse(employee.medical_record_url);
        if (parsed?.exempt) {
          const today = getTodayString();
          if (!parsed.valid_until || parsed.valid_until >= today) {
            isMedicalGrace = true;
            medicalExemption = parsed;
          }
        }
      } catch (_) {}
    }

    // Require biometric registration
    const hasBiometrics = Boolean(employee.has_registered_biometrics || employee.biometric_baseline_path);
    if (!hasBiometrics && !isMedicalGrace) {
      await logSecurityViolation(reqId, employee_id, 'Unregistered Biometrics', 'Turnstile clock-in rejected: Facial biometrics not registered.', req.ip);
      throw new AuthorizationError('ACCESS DENIED: Facial biometric registration required before turnstile scanning.');
    }

    // Verify biometrics (skipped for medical exemption)
    if (hasBiometrics && !isMedicalGrace) {
      if (face_match_score === undefined || face_match_score === null) {
        await logSecurityViolation(reqId, employee_id, 'Biometric Bypass', 'Missing face match score.', req.ip);
        throw new AuthorizationError('BIOMETRIC BYPASS DETECTED: Missing face match score.');
      }
      if (!image_data) {
        await logSecurityViolation(reqId, employee_id, 'Biometric Bypass', 'Missing camera frame.', req.ip);
        throw new AuthorizationError('BIOMETRIC BYPASS DETECTED: Missing camera frame.');
      }
      if (!liveness_data) {
        await logSecurityViolation(reqId, employee_id, 'Biometric Bypass', 'Missing active 3D liveness telemetry.', req.ip);
        throw new AuthorizationError('BIOMETRIC BYPASS DETECTED: Missing active liveness verification telemetry.');
      }

      const score = parseFloat(face_match_score);
      if (score < CONFIG.BIOMETRICS.MATCH_THRESHOLD) {
        const reason = `Buddy-punching attempt. Face match score: ${score}% (min: ${CONFIG.BIOMETRICS.MATCH_THRESHOLD}%).`;
        await logSecurityViolation(reqId, employee_id, 'Identity Mismatch', reason, req.ip);
        throw new AuthorizationError(`IDENTITY MISMATCH: Face verification failed (${score}%). Incident logged.`);
      }
      logger.info(reqId, 'Biometric identity passed', { employee_id, score });
    } else if (isMedicalGrace) {
      logger.info(reqId, 'Biometric face matching bypassed via Medical Grace Protocol', { employee_id, reason: medicalExemption?.reason });
    }

    const todayStr = getTodayString();

    // Check for existing attendance record today
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

    // Liveness verification
    let livenessPassed = isMedicalGrace ? true : false;
    let livenessConfidence = isMedicalGrace ? 1.0 : null;
    let livenessReason = isMedicalGrace ? 'Exempted: Medical Grace Protocol Active' : 'Not performed';

    if (image_data && !isMedicalGrace) {
      const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
      try {
        const result = await performBiometricVerification(reqId, base64Data, employee, false, liveness_data);
        livenessPassed = result.passed;
        livenessConfidence = result.confidence || result.match_confidence || 0;
        livenessReason = result.reason;

        if (result.error) {
          if (employee.has_registered_biometrics) {
            logger.security(reqId, 'Clock-in denied due to AI service issue', { employee_id, reason: result.reason });
            throw new AppError(`Biometric verification service temporarily unavailable: ${result.reason}. Please try again.`, 503, 'AI_SERVICE_UNAVAILABLE');
          }
          logger.warn(reqId, 'Liveness check skipped due to AI service issue', { employee_id });
          livenessReason = 'Skipped: AI service issue';
        } else if (!result.passed) {
          const desc = `Biometric spoofing attempt. AI Confidence: ${Math.round((livenessConfidence || 0) * 100)}%. ${result.reason}`;
          await logSecurityViolation(reqId, employee_id, 'Spoofing Attempt', desc, req.ip);
          throw new AuthorizationError(`BIOMETRIC SPOOFING DETECTED: ${result.reason} [Confidence: ${Math.round((livenessConfidence || 0) * 100)}%]`);
        }
        logger.info(reqId, 'Liveness check passed', { employee_id, confidence: livenessConfidence });
      } catch (err) {
        if (err.code === 'AI_SERVICE_UNAVAILABLE' || err.code === 'AI_CIRCUIT_OPEN') {
          if (employee.has_registered_biometrics) {
            logger.security(reqId, 'Clock-in denied due to AI outage', { employee_id });
            throw new AuthorizationError('Biometric verification service unavailable. Access denied for security.');
          }
          logger.warn(reqId, 'Liveness check skipped due to AI outage', { employee_id });
          livenessReason = 'Skipped: AI outage';
        } else {
          throw err;
        }
      }
    }

    // Execute clock-in or clock-out
    const now = new Date();
    const photoPath = await uploadImage(reqId, image_data, existing ? 'out' : 'in', employee.company_id || employee_id);

    if (!existing) {
      const activeWorkPolicy = await getActiveWorkPolicy();
      const minutesLate = getChargeableLateMinutes({ date: todayStr, time_in: now.toISOString() }, activeWorkPolicy, getEmployeeRestDays(employee));

      let status = 'Present';
      let message = isMedicalGrace 
        ? `TIME IN SUCCESS: Welcome, ${employee.first_name}! (Medical Grace Protocol Active)`
        : `TIME IN SUCCESS: Welcome, ${employee.first_name} ${employee.last_name}!`;

      if (minutesLate > 0) {
        status = 'Late';
        message = isMedicalGrace
          ? `TIME IN SUCCESS: Welcome, ${employee.first_name}! (${minutesLate}m late • Medical Grace Mode)`
          : `TIME IN SUCCESS: Welcome, ${employee.first_name}! (You are ${minutesLate} minutes late).`;
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

      logger.info(reqId, 'Time-in recorded', { employee_id, status, isMedicalGrace, minutesLate });

      await auditLog(reqId, {
        employee_id,
        action: isMedicalGrace ? 'TIME_IN_MEDICAL_GRACE' : 'TIME_IN',
        details: { status, is_medical_exempt: isMedicalGrace, reason: medicalExemption?.reason },
        ip_address: req.ip
      });

      invalidateCache(['/api/attendance', '/api/dashboard', '/api/attendance/employee-monthly']);
      Brain.Analytics.invalidateBriefing();

      return res.status(201).json({
        status: 'success',
        code: 'TIME_IN',
        message,
        data: { employee_id, date: todayStr, status, time_in: now.toISOString(), is_medical_exempt: isMedicalGrace },
      });
    } else {
      // TIME OUT
      const { data: updatedRows, error: updateErr } = await supabase
        .from('attendances')
        .update({
          time_out: now.toISOString(),
          time_out_photo: photoPath,
          liveness_confidence_out: livenessConfidence,
          liveness_verified_out: livenessPassed,
        })
        .eq('id', existing.id)
        .is('time_out', null)
        .select('id');

      if (updateErr) throw new AppError(`Database error: ${updateErr.message}`, 500, 'DB_ERROR');

      if (!updatedRows || updatedRows.length === 0) {
        throw new ConflictError('Attendance already updated. Please refresh.');
      }

      logger.info(reqId, 'Time-out recorded', { employee_id, attendance_id: existing.id, isMedicalGrace });

      await auditLog(reqId, {
        employee_id,
        action: isMedicalGrace ? 'TIME_OUT_MEDICAL_GRACE' : 'TIME_OUT',
        details: { attendance_id: existing.id, is_medical_exempt: isMedicalGrace, reason: medicalExemption?.reason },
        ip_address: req.ip
      });

      invalidateCache(['/api/attendance', '/api/dashboard', '/api/attendance/employee-monthly']);
      Brain.Analytics.invalidateBriefing();

      return res.json({
        status: 'success',
        code: 'TIME_OUT',
        message: isMedicalGrace
          ? `TIME OUT SUCCESS: Goodbye, ${employee.first_name}! (Medical Grace Protocol Active)`
          : `TIME OUT SUCCESS: Goodbye, ${employee.first_name} ${employee.last_name}!`,
        data: { employee_id, date: todayStr, time_out: now.toISOString(), is_medical_exempt: isMedicalGrace },
      });
    }
  })
);

// 3. GET /api/attendance/calendar
router.get(
  '/calendar',
  checkVerifiedManagerOrOwnership,
  cacheResponse(20),
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { date = getTodayString() } = req.query;

    if (!isValidISODate(date)) {
      throw new ValidationError('Invalid date. Expected YYYY-MM-DD.');
    }

    const [year, month] = date.split('-');
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lastDayStr = String(lastDay).padStart(2, '0');
    const startDate = `${year}-${month}-01`;
    const endDate = `${year}-${month}-${lastDayStr}`;

    const [dailyLogsResult, activeDatesResult, monthlyLeavesResult] = await Promise.all([
      supabase
        .from('attendances')
        .select('*, employees:employee_id(*)')
        .eq('date', date),
      supabase
        .from('attendances')
        .select('date')
        .gte('date', startDate)
        .lte('date', endDate),
      supabase
        .from('leave_requests')
        .select('*, employees:employee_id(*)')
        .eq('status', 'Approved')
        .lte('start_date', endDate)
        .gte('end_date', startDate),
    ]);

    if (dailyLogsResult.error) throw new AppError(`Database error: ${dailyLogsResult.error.message}`, 500, 'DB_ERROR');
    if (activeDatesResult.error) throw new AppError(`Database error: ${activeDatesResult.error.message}`, 500, 'DB_ERROR');
    if (monthlyLeavesResult.error) throw new AppError(`Database error: ${monthlyLeavesResult.error.message}`, 500, 'DB_ERROR');

    // Extract active leave dates for calendar dots
    const leaveActiveDates = [];
    (monthlyLeavesResult.data || []).forEach(l => {
      if (l.employees && !isWorkforceEmployee(l.employees)) return;
      const cur = new Date(`${l.start_date}T00:00:00Z`);
      const end = new Date(`${l.end_date}T00:00:00Z`);
      const monthStart = new Date(`${startDate}T00:00:00Z`);
      const monthEnd = new Date(`${endDate}T00:00:00Z`);
      const s = cur < monthStart ? monthStart : cur;
      const e = end > monthEnd ? monthEnd : end;
      for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
        leaveActiveDates.push(d.toISOString().slice(0, 10));
      }
    });

    const activeDates = [...new Set([
      ...(activeDatesResult.data?.map(d => d.date) || []),
      ...leaveActiveDates
    ])].sort();

    const existingDaily = (dailyLogsResult.data || []).filter(log => {
      return log.employees && isWorkforceEmployee(log.employees);
    });

    const leavesOnSelectedDate = (monthlyLeavesResult.data || []).filter(l => {
      return l.start_date <= date && l.end_date >= date && (!l.employees || isWorkforceEmployee(l.employees));
    });

    const existingEmpIds = new Set();
    const reconciledDailyLogs = existingDaily.map(log => {
      existingEmpIds.add(log.employee_id);
      const matchingLeave = leavesOnSelectedDate.find(l => l.employee_id === log.employee_id);
      const isOnLeave = log.status === 'On Leave' || Boolean(matchingLeave);
      if (isOnLeave) {
        const isPaid = matchingLeave
          ? (matchingLeave.requested_pay_type === 'with_pay' || matchingLeave.credit_pool === 'sil' || !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(matchingLeave.notes || ''))
          : !/unpaid/i.test(log.status || '');
        return {
          ...log,
          is_on_leave: true,
          status: isPaid ? 'Paid Leave' : 'On Leave',
          leave_type: matchingLeave?.type || 'Leave',
          is_paid: isPaid,
          leave_pay_type: isPaid ? 'with_pay' : 'without_pay',
          notes: log.notes || matchingLeave?.notes || null
        };
      }
      return log;
    });

    // Add employees who have approved leave on this date but had no attendance punch
    leavesOnSelectedDate.forEach(l => {
      if (!existingEmpIds.has(l.employee_id) && l.employees) {
        const isPaid = (l.requested_pay_type === 'with_pay' || l.credit_pool === 'sil' || !/\[PAY_TYPE:WITHOUT_PAY\]|\[UNPAID\]/i.test(l.notes || ''));
        reconciledDailyLogs.push({
          id: `leave-${l.id}-${date}`,
          employee_id: l.employee_id,
          date,
          time_in: null,
          time_out: null,
          status: isPaid ? 'Paid Leave' : 'On Leave',
          is_on_leave: true,
          leave_type: l.type || 'Leave',
          is_paid: isPaid,
          leave_pay_type: isPaid ? 'with_pay' : 'without_pay',
          employees: l.employees,
          notes: l.notes,
          created_at: l.created_at || new Date().toISOString()
        });
      }
    });
    logger.info(reqId, 'Calendar data fetched', { date, dailyCount: reconciledDailyLogs.length, activeDatesCount: activeDates.length });

    res.json({
      status: 'success',
      data: {
        selectedDate: date,
        dailyLogs: reconciledDailyLogs,
        activeDates,
      },
    });
  })
);

// 3.5 GET /api/attendance/employee-monthly (Monthly Work Days, Lates, Absences, and Leaves)
router.get(
  '/employee-monthly',
  checkVerifiedManagerOrOwnership,
  (req, res, next) => {
    if (req.query.refresh === 'true') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return next();
    }
    return monthlyAttendanceCache(req, res, next);
  },
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id, month } = req.query;

    if (!employee_id || typeof employee_id !== 'string') {
      throw new ValidationError('Valid employee_id is required.');
    }
    if (month && (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
      throw new ValidationError('Invalid month format. Expected YYYY-MM.');
    }

    const data = await getEmployeeMonthlyAttendance({ employeeId: employee_id, month });

    logger.info(reqId, 'Employee monthly attendance fetched', { 
      employee_id, 
      month: data.month, 
      expectedWorkDays: data.summary?.expected_work_days,
      daysPresent: data.summary?.days_present,
      daysLate: data.summary?.days_late,
      daysAbsent: data.summary?.days_absent
    });

    res.json({
      success: true,
      status: 'success',
      data,
    });
  })
);

// 4. POST /api/attendance/register-baseline
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

    // Validation
    if (!employee_id || !isValidUUID(employee_id)) {
      throw new ValidationError('Valid employee_id (UUID) is required.');
    }
    if (!hasVerifiedManagerRole(req.user) && req.user?.id !== employee_id && req.user?.auth_user_id !== employee_id) {
      throw new AuthorizationError('You are not authorized to enroll or modify biometrics for another employee.');
    }
    if (!company_id || typeof company_id !== 'string') {
      throw new ValidationError('company_id is required.');
    }
    if (!image_base64 || !isValidBase64Image(image_base64)) {
      throw new ValidationError('Valid image_base64 (data URI) is required.');
    }

    // Verify Employee
    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, company_id, is_active, role, birth_date, address, phone, emergency_contact_name')
      .eq('id', employee_id)
      .single();

    if (empErr || !employee) throw new NotFoundError('Employee not found.');
    if (!employee.is_active) throw new AuthorizationError('Cannot register biometrics for inactive employee.');

    // Enterprise Gatekeeper: Strictly enforce profile completion in DB before biometric registration
    const isExemptRole = employee.role === 'admin' || employee.role === 'security' || employee.role === 'guard';
    if (!isExemptRole) {
      const hasCompletedProfile = Boolean(
        employee.birth_date &&
        employee.address &&
        employee.phone &&
        employee.emergency_contact_name
      );
      if (!hasCompletedProfile) {
        await logSecurityViolation(
          reqId,
          employee_id,
          'Onboarding Bypass Attempt',
          'Attempted biometric registration before completing mandatory profile details (birth_date, address, phone, emergency contact).',
          req.ip
        );
        throw new AuthorizationError('Mandatory onboarding incomplete. You must complete your profile details before enrolling biometrics.');
      }
    }

    // Validate Company ID match
    const isCompanyIdMatch = employee.company_id
      ? (employee.company_id === company_id || company_id === employee.id || (employee.role === 'admin' && company_id === 'CP-MAIN'))
      : (company_id === employee.id || ['CP-MAIN', 'CP-ADMIN', 'CP-GUARD'].includes(company_id));

    if (!isCompanyIdMatch) {
      await logSecurityViolation(reqId, employee_id, 'Enrollment Tampering', 'company_id mismatch during baseline registration.', req.ip);
      throw new AuthorizationError('Company ID mismatch. Enrollment denied.');
    }

    // AI Liveness (Inline)
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");

    let livenessResult;
    try {
      livenessResult = await performBiometricVerification(reqId, base64Data, employee, true);
    } catch (err) {
      if (err.code === 'AI_SERVICE_UNAVAILABLE' || err.code === 'AI_CIRCUIT_OPEN') {
        throw new AuthorizationError('Biometric enrollment requires AI verification. Service temporarily unavailable.');
      }
      throw err;
    }

    if (livenessResult.error) {
      logger.warn(reqId, 'Biometric AI verification service issue during enrollment', { reason: livenessResult.reason });
      throw new AppError(`Biometric verification service temporarily unavailable: ${livenessResult.reason || 'Network timeout'}. Please try again.`, 503, 'AI_SERVICE_UNAVAILABLE');
    }

    if (!livenessResult.passed) {
      const desc = `Enrollment spoofing. Confidence: ${Math.round(livenessResult.confidence * 100)}%. ${livenessResult.reason}`;
      await logSecurityViolation(reqId, employee_id, 'Enrollment Spoofing', desc, req.ip);
      throw new AuthorizationError(`BIOMETRIC SPOOFING DETECTED: ${livenessResult.reason} [Confidence: ${Math.round(livenessResult.confidence * 100)}%]`);
    }

    // Store Baseline
    const safeCompanyFolder = employee.company_id || (company_id !== employee_id ? company_id : 'CP-MAIN');
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `${CONFIG.STORAGE.BASELINE_PREFIX}/${safeCompanyFolder}/${employee_id}.jpg`;

    const { error: uploadErr } = await supabase.storage
      .from(CONFIG.STORAGE.BUCKET)
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '31536000', // 1 year immutable
      });

    if (uploadErr) throw new AppError(`Storage error: ${uploadErr.message}`, 500, 'STORAGE_ERROR');

    // Update Database
    const { error: dbErr } = await supabase
      .from('employees')
      .update({
        has_registered_biometrics: true,
        biometric_baseline_path: fileName,
        biometric_registered_at: new Date().toISOString(),
        biometric_liveness_confidence: livenessResult.confidence || 0.95
      })
      .eq('id', employee_id);

    if (dbErr) {
      logger.error(reqId, 'Failed to update database with biometric status', dbErr);
    }

    // Invalidate caches so UI immediately sees updated biometric registration
    invalidateCache([`/api/employees/${employee_id}`, '/api/employees', '/api/dashboard']);

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

    // Broadcast biometric registration event
    const broadcastPayload = {
      employee_id,
      company_id,
      has_registered_biometrics: true,
      biometric_baseline_path: fileName,
      timestamp: new Date().toISOString()
    };
    [
      'scanner_disciplinary_realtime',
      `employee-live-dashboard-${employee_id}`,
      `dashboard-disciplinary-sync-${employee_id}`,
      `myprofile-realtime-${employee_id}`,
      `qr-realtime-${employee_id}`,
      `qr-disciplinary-sync-${employee_id}`
    ].forEach(chName => {
      try {
        supabase.channel(chName).send({
          type: 'broadcast',
          event: 'BIOMETRICS_REGISTERED',
          payload: broadcastPayload
        }).catch(() => {});
      } catch (_) {}
    });

    res.status(201).json({
      status: 'success',
      code: 'ENROLLMENT_COMPLETE',
      message: 'Biometric baseline registered successfully.',
      data: { employee_id, registered_at: new Date().toISOString() },
    });
  })
);

// 5. POST /api/attendance/password-changed
router.post(
  '/password-changed',
  asyncHandler(async (req, res) => {
    const { reqId } = req;
    const { employee_id } = req.body;

    if (!employee_id || !isValidUUID(employee_id)) {
      throw new ValidationError('Valid employee_id (UUID) is required.');
    }

    if (!hasVerifiedManagerRole(req.user) && req.user?.id !== employee_id && req.user?.auth_user_id !== employee_id) {
      throw new AuthorizationError('Unauthorized to update password status for another account.');
    }

    const { error } = await supabase
      .from('employees')
      .update({ requires_password_change: false, password_changed_at: new Date().toISOString() })
      .eq('id', employee_id);

    if (error) throw new AppError(`Database error: ${error.message}`, 500, 'DB_ERROR');

    try {
      await supabase.auth.admin.updateUserById(employee_id, {
        user_metadata: { temp_password: null }
      });
    } catch {
      // Continue silently if auth metadata update fails
    }

    invalidateCache([`/api/employees/${employee_id}`, '/api/employees', '/api/dashboard']);
    invalidateAuthUser(employee_id);

    logger.info(reqId, 'Password change status cleared', { employee_id });

    await auditLog(reqId, { employee_id, action: 'PASSWORD_CHANGED_ACK', details: {}, ip_address: req.ip });

    res.json({ status: 'success', code: 'PASSWORD_STATUS_CLEARED' });
  })
);

// Global error handler for this router
router.use((err, req, res, next) => {
  sendError(res, err, req.reqId);
});

export default router;
