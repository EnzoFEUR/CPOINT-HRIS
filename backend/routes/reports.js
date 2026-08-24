import express from 'express';
import { supabase } from '../supabaseClient.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/reports/dtr - Query strict plural "attendances" table
router.get('/dtr', authMiddleware, async (req, res) => {
  try {
    const { start_date, end_date, department } = req.query;

    let query = supabase
      .from('attendances') // Strictly plural table
      .select('*, employees!inner(id, company_id, first_name, last_name, department)')
      .gte('date', start_date)
      .lte('date', end_date)
      .order('date', { ascending: true });

    if (department && department !== 'All') {
      query = query.eq('employees.department', department);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/dole-statutory - Monthly statutory remittances summary
router.get('/dole-statutory', authMiddleware, async (req, res) => {
  try {
    const { year, month } = req.query;

    const { data, error } = await supabase
      .from('payrolls')
      .select('*, employees(company_id, first_name, last_name, department)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Filter by year and month
    const filtered = data.filter(p => {
      const d = new Date(p.created_at);
      return d.getFullYear() === Number(year) && (d.getMonth() + 1) === Number(month);
    });

    const summary = filtered.reduce((acc, curr) => {
      acc.total_basic += Number(curr.basic_pay || 0);
      acc.total_sss += Number(curr.sss_deduction || 0);
      acc.total_philhealth += Number(curr.philhealth_deduction || 0);
      acc.total_pagibig += Number(curr.pagibig_deduction || 0);
      acc.total_tax += Number(curr.withholding_tax || 0);
      return acc;
    }, { total_basic: 0, total_sss: 0, total_philhealth: 0, total_pagibig: 0, total_tax: 0 });

    return res.json({ success: true, summary, records: filtered });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/leave-utilization
router.get('/leave-utilization', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leaves')
      .select('*, employees(company_id, first_name, last_name, department)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, leaves: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;