import express from 'express';
import { supabase } from '../supabaseClient.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/documents - Fetch 201 documents for a specific employee
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, category } = req.query;
    
    // Point to the correct table
    let query = supabase
      .from('employee_documents') 
      .select('*');

    if (employee_id) query = query.eq('employee_id', employee_id);
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, documents: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/documents/record - Save document metadata
router.post('/record', authMiddleware, async (req, res) => {
  try {
    const { employee_id, title, category, file_name, file_path } = req.body;

    if (!employee_id) {
      return res.status(400).json({ success: false, message: 'employee_id is required.' });
    }

    // Verify employee separation status
    const [
      { data: employee, error: empErr },
      { data: termLog }
    ] = await Promise.all([
      supabase
        .from('employees')
        .select('id, first_name, last_name, status, is_active')
        .eq('id', employee_id)
        .single(),
      supabase
        .from('disciplinary_logs')
        .select('id')
        .eq('employee_id', employee_id)
        .eq('type', 'Termination')
        .limit(1)
    ]);

    if (empErr || !employee) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    const isTerminated = 
      employee.status === 'inactive' || 
      employee.status === 'terminated' || 
      employee.is_active === false || 
      Boolean(termLog && termLog.length > 0);

    if (isTerminated) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_TERMINATED',
        message: 'Document records cannot be added for separated or terminated employee accounts.'
      });
    }

    const { data, error } = await supabase
      .from('employee_documents')
      .insert([{
        employee_id,
        title,
        category,
        file_name,
        file_path
      }])
      .select()
      .single();

    if (error) throw error;

    // Log to Audit Trail
    await supabase.from('audit_logs').insert([{
      causer_id: req.user.id,
      log_name: 'DOCUMENT_UPLOAD',
      description: `Uploaded 201 document (${title}) for employee ID ${employee_id}`,
      properties: { document_id: data.id, category }
    }]);

    return res.status(201).json({ success: true, document: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;