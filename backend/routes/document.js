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