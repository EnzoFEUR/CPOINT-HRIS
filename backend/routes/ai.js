import express from 'express';
import { supabase } from '../supabaseClient.js';
import { Brain } from '../services/geminiBrain.js';

const router = express.Router();

/**
 * GET /api/ai/analytics/daily-briefing
 * Fetches real-time workforce metrics and generates an executive AI briefing
 */
router.get('/analytics/daily-briefing', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const forceFresh = req.query.fresh === 'true';

    // Fetch active employees, today's attendance, and approved leaves
    const [employeesRes, attendanceRes, leavesRes] = await Promise.all([
      supabase.from('employees').select('id, department, role').neq('role', 'admin'),
      supabase.from('attendances').select('id, employee_id, status, time_in').eq('date', today),
      supabase.from('leave_requests').select('id, employee_id, type, status').eq('status', 'Approved').lte('start_date', today).gte('end_date', today)
    ]);

    const employees = employeesRes.data || [];
    const attendances = attendanceRes.data || [];
    const leaves = leavesRes.data || [];

    const totalEmployees = employees.length || 1;
    const presentCount = attendances.length;
    const lateCount = attendances.filter(a => (a.status || '').toLowerCase().includes('late')).length;
    const onLeaveCount = leaves.length;
    const absentCount = Math.max(0, totalEmployees - presentCount - onLeaveCount);
    const attendanceRate = Math.round((presentCount / totalEmployees) * 100);

    // Group headcount by department
    const deptMap = {};
    employees.forEach(e => {
      const d = e.department || 'Production';
      deptMap[d] = (deptMap[d] || 0) + 1;
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

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: briefingData,
      briefing
    });
  } catch (err) {
    console.error('[AI_ROUTE] Daily briefing error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/ai/analytics/anomalies
 * Detects attendance anomalies, habitual late patterns, and attendance drops
 */
router.get('/analytics/anomalies', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: logs, error } = await supabase
      .from('attendances')
      .select('id, employee_id, date, status, time_in, employees(id, first_name, last_name, department, company_id)')
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: false })
      .limit(200);

    if (error) throw error;

    const anomalyReport = await Brain.Analytics.detectAttendanceAnomalies(logs || []);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      report: anomalyReport
    });
  } catch (err) {
    console.error('[AI_ROUTE] Anomalies error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ai/analytics/retention-risk
 * Predicts turnover / burnout risk for a specific employee
 */
router.post('/analytics/retention-risk', async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) {
      return res.status(400).json({ error: 'employee_id is required' });
    }

    const [empRes, logsRes] = await Promise.all([
      supabase.from('employees').select('*').eq('id', employee_id).single(),
      supabase.from('attendances').select('date, status, time_in').eq('employee_id', employee_id).order('date', { ascending: false }).limit(30)
    ]);

    if (empRes.error || !empRes.data) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const riskEvaluation = await Brain.Analytics.predictAttritionRisk(empRes.data, logsRes.data || []);

    res.json({
      success: true,
      employee_id,
      evaluation: riskEvaluation
    });
  } catch (err) {
    console.error('[AI_ROUTE] Retention risk error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ai/assistant/chat
 * Legal & Policy AI Copilot answering HR and Philippine Labor Code questions
 */
router.post('/assistant/chat', async (req, res) => {
  try {
    const { question, context } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' });
    }

    const answer = await Brain.Compliance.askHRAssistant(question, context || {});

    res.json({
      success: true,
      query: question,
      response: answer
    });
  } catch (err) {
    console.error('[AI_ROUTE] Assistant error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
