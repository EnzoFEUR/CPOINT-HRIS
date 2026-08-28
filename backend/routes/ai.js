import express from 'express';
import { supabase } from '../supabaseClient.js';
import { Brain } from '../services/geminiBrain.js';
import { computeAttendanceSignals } from '../services/attendanceIntelligence.js';
import { cacheResponse } from '../middleware/cacheMiddleware.js';

const router = express.Router();

// Robust Role Validator supporting strings and arrays with case-insensitivity
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Unauthorized. No active user session.' });
        }
        const userRole = (req.user.role || '').toLowerCase();
        const rolesList = Array.isArray(allowedRoles)
            ? allowedRoles.map(r => String(r).toLowerCase())
            : [String(allowedRoles).toLowerCase()];

        if (userRole === 'admin' || rolesList.includes(userRole)) {
            return next();
        }
        return res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions.' });
    };
};

/**
 * GET /api/ai/analytics/daily-briefing
 * Fetches real-time workforce metrics and generates an executive AI briefing
 */
router.get('/analytics/daily-briefing', requireRole(['admin', 'hr', 'manager']), cacheResponse(120), async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const forceFresh = req.query.fresh === 'true';

        const [employeesRes, attendanceRes, leavesRes] = await Promise.all([
            supabase.from('employees').select('id, department, role').neq('role', 'admin'),
            supabase.from('attendances').select('id, employee_id, status, time_in').eq('date', today),
            supabase.from('leave_requests').select('id, employee_id, type, status').eq('status', 'Approved').lte('start_date', today).gte('end_date', today)
        ]);

        if (employeesRes.error) throw employeesRes.error;
        if (attendanceRes.error) throw attendanceRes.error;
        if (leavesRes.error) throw leavesRes.error;

        const employees = employeesRes.data || [];
        const attendances = attendanceRes.data || [];
        const leaves = leavesRes.data || [];

        const totalEmployees = employees.length || 1;
        const presentCount = attendances.length;
        const lateCount = attendances.filter(a => (a.status || '').toLowerCase().includes('late')).length;
        const onLeaveCount = leaves.length;
        const absentCount = Math.max(0, totalEmployees - presentCount - onLeaveCount);
        const attendanceRate = Math.round((presentCount / totalEmployees) * 100);

        const deptMap = {};
        employees.forEach(e => {
            const dept = e.department || 'Production';
            deptMap[dept] = (deptMap[dept] || 0) + 1;
        });

        const briefingData = {
            totalEmployees,
            presentCount,
            lateCount,
            onLeaveCount,
            absentCount,
            attendanceRate,
            departments: Object.entries(deptMap).map(([name, count]) => ({ name, count }))
        };

        const briefing = await Brain.Analytics.generateWorkforceBriefing(briefingData, forceFresh);

        return res.json({
            success: true,
            timestamp: new Date().toISOString(),
            metrics: briefingData,
            briefing
        });
    } catch (err) {
        console.error('[AI_ROUTE] Daily briefing error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ai/analytics/anomalies
 * Analyzes historical timecards for habitual late patterns, weekend spikes, and burnout indicators.
 *
 * IMPORTANT: counts, names, and streak lengths below are computed deterministically in
 * attendanceIntelligence.js - NOT by the LLM. Gemini is only used to phrase a short
 * executive-readable narrative on top of numbers that are already known to be correct.
 * This avoids the two failure modes of the old LLM-only approach: hallucinated counts/names,
 * and a 200-record cap that silently dropped data for larger companies.
 */
router.get('/analytics/anomalies', requireRole(['admin', 'hr', 'manager']), cacheResponse(300), async (req, res) => {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const { data: logs, error } = await supabase
            .from('attendances')
            .select('id, employee_id, date, status, time_in, employees:employee_id(id, first_name, last_name, department, company_id)')
            .gte('date', thirtyDaysAgo)
            .order('date', { ascending: false });
            // NOTE: no .limit() here - the old 200-record cap could silently truncate the
            // 30-day window for any company with more than ~7 employees, corrupting the
            // late-count and consecutive-streak math. Pagination can be added later if this
            // table grows large enough that a full 30-day pull becomes a real cost concern.

        if (error) throw error;

        const signals = computeAttendanceSignals(logs || []);

        // AI narrative is optional flavor text on top of verified numbers - never let it block
        // or corrupt the response if Gemini is slow/unavailable.
        const narrative = await Brain.Analytics.narrateAttendanceHealth(signals).catch(() => null);

        const general_health_assessment = narrative?.general_health_assessment
            || (signals.anomalies_detected_count === 0
                ? 'All attendance patterns are within acceptable organizational thresholds.'
                : `${signals.anomalies_detected_count} attendance pattern(s) flagged across ${signals.sample_size} active employees in the last 30 days.`);

        return res.json({
            success: true,
            timestamp: new Date().toISOString(),
            report: {
                ...signals,
                general_health_assessment
            }
        });
    } catch (err) {
        console.error('[AI_ROUTE] Anomalies detection error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

export default router;