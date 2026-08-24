import express from 'express';
import { supabase } from '../supabaseClient.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { generateCOEPDF } from '../utils/pdfGenerator.js';

const router = express.Router();

// GET /api/document-requests - Retrieve requests
router.get('/', authMiddleware, async (req, res) => {
  try {
    let query = supabase
      .from('document_requests')
      .select('*, employees(id, first_name, last_name, company_id, department, salary, role)')
      .order('created_at', { ascending: false });

    if (req.user.role === 'employee') {
      query = query.eq('employee_id', req.user.id);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ success: true, requests: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/document-requests - Employee requisition
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { document_type, purpose } = req.body;
    const employee_id = req.user.id;

    const { data, error } = await supabase
      .from('document_requests')
      .insert([{
        employee_id,
        document_type,
        purpose,
        status: 'Pending'
      }])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, request: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/document-requests/:id/process - Admin status pipeline & auto PDF generator
router.patch('/:id/process', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks } = req.body; // 'Approved' | 'Ready for Download' | 'Rejected'

    // Fetch existing request with employee record
    const { data: request, error: reqErr } = await supabase
      .from('document_requests')
      .select('*, employees(*)')
      .eq('id', id)
      .single();

    if (reqErr || !request) return res.status(404).json({ success: false, message: 'Request not found' });

    let generated_file_path = request.generated_file_path;

    // Automated Certificate Generation when transitioning to Ready for Download
    if (status === 'Ready for Download' && request.document_type === 'COE') {
      const pdfBuffer = await generateCOEPDF(request.employees, request.purpose);
      const filePath = `generated_certificates/COE_${request.employee_id}_${Date.now()}.pdf`;

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(filePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

      if (uploadErr) throw uploadErr;
      generated_file_path = filePath;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('document_requests')
      .update({
        status,
        remarks,
        generated_file_path,
        processed_by: req.user.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return res.json({ success: true, request: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;