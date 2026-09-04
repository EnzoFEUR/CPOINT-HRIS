import express from 'express';
import multer from 'multer';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// Configure multer to hold file buffers in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

// GET /api/employee-documents?employee_id=...
router.get('/', async (req, res) => {
    try {
        const { employee_id } = req.query;

        let query = supabase.from('employee_documents').select('*');

        if (employee_id) {
            query = query.eq('employee_id', employee_id);
        }

        const { data, error } = await query;

        if (error) throw error;

        return res.status(200).json({
            success: true,
            documents: data || []
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// POST /api/employee-documents
router.post('/', upload.single('file'), async (req, res) => {
    try {
        const { employee_id, title, category, expiry_date } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        if (!employee_id || !title) {
            return res.status(400).json({ success: false, message: 'Employee ID and Title are required' });
        }

        // Security check: Verify employee status & disciplinary separation
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
            return res.status(404).json({ success: false, message: 'Employee record not found.' });
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
                message: 'Document uploads are disabled for separated or terminated employee accounts. Existing records remain available for compliance audit.'
            });
        }

        // 1. Build unique storage path
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${employee_id}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

        // 2. Upload file directly to Supabase Storage
        const { error: storageError } = await supabase.storage
            .from('documents')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype || 'application/octet-stream',
                upsert: true
            });

        if (storageError) throw storageError;

        // 3. Insert record into database table (file_type removed)
        const { data: dbData, error: dbError } = await supabase
            .from('employee_documents')
            .insert([
                {
                    employee_id,
                    title,
                    category: category || 'General',
                    file_name: file.originalname,
                    file_path: fileName,
                    file_size: file.size,
                    expiry_date: expiry_date || null
                }
            ])
            .select();

        if (dbError) throw dbError;

        return res.status(200).json({
            success: true,
            message: 'Document uploaded successfully',
            document: dbData?.[0] || null
        });
    } catch (err) {
        console.error('Upload Error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Failed to upload document'
        });
    }
});

export default router;