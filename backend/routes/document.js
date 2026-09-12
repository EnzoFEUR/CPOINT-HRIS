import express from 'express';
import { supabase } from '../supabaseClient.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/documents - Fetch documents (global vault or employee specific)
router.get('/', verifyToken, async (req, res) => {
  try {
    const { employee_id, status, category } = req.query;

    let query = supabase
      .from('employee_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (employee_id) query = query.eq('employee_id', employee_id);
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, data, documents: data });
  } catch (err) {
    console.error('Error fetching employee documents:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error', message: err.message });
  }
});

// POST /api/documents - Record metadata after Supabase Storage upload
router.post('/', verifyToken, async (req, res) => {
  try {
    const { employee_id, category, title, file_name, file_path, file_size, file_type } = req.body || {};

    if (!employee_id || !file_path) {
      return res.status(400).json({ success: false, error: 'employee_id and file_path are required' });
    }

    // Verify employee separation status
    const { data: emp, error: empErr } = await supabase
  .from('employees')
  .select('id, operational_status, is_terminated')
  .eq('id', employee_id)
  .single();

if (empErr || !emp) {
  return res.status(404).json({ success: false, error: 'Employee not found' });
}
if (emp.operational_status === 'Terminated' || emp.is_terminated) {
  return res.status(403).json({ success: false, error: 'Cannot upload documents for a separated/terminated employee' });
}

    const { data, error } = await supabase
      .from('employee_documents')
      .insert({
        employee_id,
        category: category || 'Other',
        title: title || file_name,
        file_name,
        file_path,
        file_size: file_size || null,
        file_type: file_type || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error creating employee document record:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error' });
  }
});

// POST /api/documents/record - Save document metadata (legacy endpoint)
router.post('/record', verifyToken, async (req, res) => {
  try {
    const { employee_id, title, category, file_name, file_path } = req.body;

    if (!employee_id) {
      return res.status(400).json({ success: false, message: 'employee_id is required.' });
    }

    const [
      { data: employee, error: empErr },
      { data: termLog }
    ] = await Promise.all([
      supabase
        .from('employees')
        .select('id, first_name, last_name, operational_status, is_terminated')
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
  employee.operational_status === 'Terminated' || 
  employee.is_terminated || 
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
      causer_id: req.user?.id,
      log_name: 'DOCUMENT_UPLOAD',
      description: `Uploaded 201 document (${title}) for employee ID ${employee_id}`,
      properties: { document_id: data.id, category }
    }]);

    return res.status(201).json({ success: true, document: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/documents/:id/status - Approve or Reject a document
router.patch('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason, reviewed_by } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid document status.' });
    }

    const updateData = {
      status,
      rejection_reason: status === 'rejected' ? rejection_reason || 'Document does not meet requirements.' : null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewed_by || req.user?.id || null
    };

    const { data, error } = await supabase
      .from('employee_documents')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log to Audit Trail
    await supabase.from('audit_logs').insert([{
      causer_id: req.user?.id,
      log_name: 'DOCUMENT_STATUS_UPDATE',
      description: `Updated document status to ${status.toUpperCase()} for document ID ${id}`,
      properties: { document_id: id, status, rejection_reason }
    }]);

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating document status:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error.' });
  }
});

// DELETE /api/documents/:id - Delete document metadata
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('employee_documents').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting employee document:', err);
    return res.status(500).json({ success: false, error: err.message || 'Server error' });
  }
});

export default router;