import express from 'express';
import multer from 'multer';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// Configure multer to hold file buffers in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

// Hot Folder document category keywords, checked in order - first match wins.
// Add new synonyms here as real-world filenames reveal new patterns.
const CATEGORY_KEYWORDS = [
    { category: 'Government ID', keywords: ['govid', 'sss', 'philhealth', 'pagibig', 'umid', 'tin', 'passport', 'license', 'drivers', 'voters', 'philsys', 'nationalid'] },
    { category: 'Contract', keywords: ['contract', 'employment', 'coe', 'offer', 'appointment'] },
    { category: 'Clearance', keywords: ['clearance', 'nbi', 'police', 'barangay'] },
    { category: 'Certificate', keywords: ['certificate', 'cert', 'diploma', 'training'] },
    { category: 'Performance', keywords: ['performance', 'eval', 'evaluation', 'appraisal', 'review'] },
];

function detectCategory(filename) {
    const normalized = filename.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const { category, keywords } of CATEGORY_KEYWORDS) {
        if (keywords.some(kw => normalized.includes(kw))) return category;
    }
    return 'Other';
}

/**
 * Matches a filename to exactly one employee via Company ID or full-name tokens.
 * Returns { employee, confidence } on a clean single match, or null if there's no
 * match or more than one plausible match - this never guesses between multiple
 * candidates. Assigning a document to the wrong employee is a real privacy/
 * compliance risk, so ambiguity always loses to "flag for manual review."
 */
function matchEmployeeToFilename(filename, employees) {
    const upperFilename = filename.toUpperCase();

    // 1. Company ID is the most reliable signal - look for an exact CP-YYYY-NNN pattern.
    const idMatch = upperFilename.match(/CP-\d{4}-\d{3}/);
    if (idMatch) {
        const found = employees.filter(e => (e.company_id || '').toUpperCase() === idMatch[0]);
        if (found.length === 1) return { employee: found[0], confidence: 'company_id' };
    }

    // 2. Fall back to full-name matching - both first AND last name must appear as
    // separate tokens in the filename (avoids false positives on common first names).
    const normalized = filename.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const tokens = new Set(normalized.split(' ').filter(Boolean));

    const nameMatches = employees.filter(e => {
        const first = (e.first_name || '').toLowerCase();
        const last = (e.last_name || '').toLowerCase();
        return first && last && tokens.has(first) && tokens.has(last);
    });

    if (nameMatches.length === 1) return { employee: nameMatches[0], confidence: 'name' };

    return null;
}

// GET /api/employee-documents?employee_id=...
// GET /api/employee-documents?employee_id=...
router.get('/', async (req, res) => {
    try {
        const { employee_id } = req.query;
        const targetId = employee_id || req.user?.id;

        if (!targetId) {
            return res.status(400).json({ success: false, message: 'Employee ID is required.' });
        }

        // Ownership check: regular employees can only query their own documents
        const isAdmin = ['admin', 'hr', 'superadmin'].includes(req.user?.role);
        if (!isAdmin && req.user?.id !== targetId && req.user?.employee_id !== targetId) {
            return res.status(403).json({ success: false, message: 'Unauthorized to view these documents.' });
        }

        const { data: documents, error } = await supabase
            .from('employee_documents')
            .select('*')
            .eq('employee_id', targetId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            documents: documents || []
        });
    } catch (err) {
        console.error('Error fetching employee documents:', err);
        return res.status(500).json({ success: false, error: err.message });
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

        // Security check: Verify employee's current status
        const { data: employee, error: empErr } = await supabase
            .from('employees')
            .select('id, first_name, last_name, status, is_active')
            .eq('id', employee_id)
            .single();

        if (empErr || !employee) {
            return res.status(404).json({ success: false, message: 'Employee record not found.' });
        }

        const isTerminated =
            employee.status === 'inactive' ||
            employee.status === 'terminated' ||
            employee.is_active === false;

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

/**
 * POST /api/employee-documents/hot-folder
 * Drop multiple files at once. Each file is auto-assigned to an employee and
 * category by parsing its filename - NEVER by guessing when a match is
 * ambiguous or absent. Files that can't be confidently matched are NOT
 * uploaded; they come back in `unassigned` for the admin to resolve manually
 * (e.g. by re-submitting them individually through the existing single-file
 * POST /api/employee-documents route above, once an employee_id is chosen).
 */
router.post('/hot-folder', upload.array('files', 25), async (req, res) => {
    try {
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded.' });
        }

        const { data: employees, error: empErr } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name, status, is_active');
        if (empErr) throw empErr;

        const uploaded = [];
        const unassigned = [];
        const blocked = [];

        for (const file of files) {
            const match = matchEmployeeToFilename(file.originalname, employees || []);
            const detectedCategory = detectCategory(file.originalname);

            if (!match) {
                unassigned.push({
                    file_name: file.originalname,
                    suggested_category: detectedCategory,
                    reason: 'No confident single employee match found in the filename.'
                });
                continue;
            }

            const { employee } = match;
            const isTerminated =
                employee.status === 'inactive' ||
                employee.status === 'terminated' ||
                employee.is_active === false;

            if (isTerminated) {
                blocked.push({
                    file_name: file.originalname,
                    matched_employee: `${employee.first_name} ${employee.last_name}`,
                    reason: 'Matched employee is separated/terminated - uploads are locked for compliance.'
                });
                continue;
            }

            try {
                const fileExt = file.originalname.split('.').pop();
                const storagePath = `${employee.id}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

                const { error: storageError } = await supabase.storage
                    .from('documents')
                    .upload(storagePath, file.buffer, {
                        contentType: file.mimetype || 'application/octet-stream',
                        upsert: true
                    });
                if (storageError) throw storageError;

                const { data: dbData, error: dbError } = await supabase
                    .from('employee_documents')
                    .insert([{
                        employee_id: employee.id,
                        title: file.originalname,
                        category: detectedCategory,
                        file_name: file.originalname,
                        file_path: storagePath,
                        file_size: file.size
                    }])
                    .select();
                if (dbError) throw dbError;

                uploaded.push({
                    file_name: file.originalname,
                    matched_employee: `${employee.first_name} ${employee.last_name}`,
                    matched_via: match.confidence,
                    category: detectedCategory,
                    document: dbData?.[0] || null
                });
            } catch (fileErr) {
                unassigned.push({
                    file_name: file.originalname,
                    suggested_category: detectedCategory,
                    reason: `Upload failed: ${fileErr.message}`
                });
            }
        }

        return res.status(200).json({
            success: true,
            summary: {
                total: files.length,
                auto_assigned: uploaded.length,
                needs_manual_review: unassigned.length,
                blocked: blocked.length
            },
            uploaded,
            unassigned,
            blocked
        });
    } catch (err) {
        console.error('Hot Folder Upload Error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Failed to process hot folder upload'
        });
    }
});

export default router;