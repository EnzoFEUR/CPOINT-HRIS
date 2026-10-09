import express from 'express';
import multer from 'multer';
import { supabase } from '../supabaseClient.js';
import { assertDocumentOwner, assertUuid, DOCUMENT_MAX_BYTES, DOCUMENT_URL_TTL, DocumentError, documentRoute, ensureWritableEmployee, findDocument, listDocuments, normalizeDocumentPath, requireDocumentAdmin, uploadDocument } from '../services/documentService.js';
import { documentClassifier } from '../services/documentClassifier.js';
import { importEmployeeDocument, requireBulkAdmin } from '../services/bulkDocumentImport.js';

export function createEmployeeDocumentsRouter(client = supabase, classifier = documentClassifier) {
const router = express.Router();
router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
    next();
});

// Configure multer to hold file buffers in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DOCUMENT_MAX_BYTES, fields: 12, fieldSize: 4096, parts: 40 } // 10 MB per file
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

// Keep the legacy list envelope, with server-enforced employee scope.
router.get('/', documentRoute(async (req, res) => {
    const result = await listDocuments(client, req.user, req.query);
    res.json({ success: true, ...result });
}));

// Adapted from commit 4ba2955: links expire after five minutes and are never cached.
router.get('/:id/url', documentRoute(async (req, res) => {
    const document = await findDocument(client, req.params.id);
    assertDocumentOwner(req.user, document.employee_id);
    const path = normalizeDocumentPath(document.file_path, document.employee_id, client.supabaseUrl);
    const { data, error } = await client.storage.from('documents').createSignedUrl(path, DOCUMENT_URL_TTL);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Storage did not return a signed URL.');
    res.json({ success: true, url: data.signedUrl, expires_in: DOCUMENT_URL_TTL });
}));

// Advisory classification only: no storage upload, document write, or draft broadcast.
router.post('/classify', requireDocumentAdmin, classifier.admit, upload.single('file'), documentRoute(async (req, res) => {
    if (req.body.analysis_consent !== 'true') throw new DocumentError(400, 'Consent to content analysis is required.');
    const employeeId = assertUuid(req.body.employee_id, 'Employee ID');
    await ensureWritableEmployee(client, employeeId);
    if (res.destroyed) return;
    const controller = new AbortController();
    const disconnect = () => controller.abort(new Error('Client disconnected'));
    res.once('close', disconnect);
    try {
        const classification = await classifier.classify(req.file, { actorId: req.user.id, signal: controller.signal });
        if (!res.destroyed) res.json({ success: true, classification });
    } catch (error) {
        if (!controller.signal.aborted) throw error;
    } finally { res.removeListener('close', disconnect); }
}));

router.post('/', upload.single('file'), requireBulkAdmin, documentRoute(async (req, res) => {
    const document = await importEmployeeDocument(client, req.user, req.body, req.file);
    res.json({ success: true, message: 'Document uploaded successfully', document });
}));

/**
 * POST /api/employee-documents/hot-folder
 * Drop multiple files at once. Each file is auto-assigned to an employee and
 * category by parsing its filename - NEVER by guessing when a match is
 * ambiguous or absent. Files that can't be confidently matched are NOT
 * uploaded; they come back in `unassigned` for the admin to resolve manually
 * (e.g. by re-submitting them individually through the existing single-file
 * POST /api/employee-documents route above, once an employee_id is chosen).
 */
router.post('/hot-folder', requireDocumentAdmin, upload.array('files', 25), async (req, res) => {
    try {
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded.' });
        }

        const { data: employees, error: empErr } = await client
            .from('employees')
            .select('id, company_id, first_name, last_name, status, is_active, archived_at');
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
                ['inactive', 'terminated', 'separated', 'archived'].includes(String(employee.status || '').toLowerCase()) ||
                Boolean(employee.archived_at) || employee.is_active === false;

            if (isTerminated) {
                blocked.push({
                    file_name: file.originalname,
                    matched_employee: `${employee.first_name} ${employee.last_name}`,
                    reason: 'Matched employee is separated/terminated - uploads are locked for compliance.'
                });
                continue;
            }

            try {
                const document = await uploadDocument(client, req.user, { employee_id: employee.id, title: file.originalname, category: detectedCategory }, file);
                uploaded.push({
                    file_name: file.originalname,
                    matched_employee: `${employee.first_name} ${employee.last_name}`,
                    matched_via: match.confidence,
                    category: detectedCategory,
                    document
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

router.use((error, req, res, next) => {
    if (!(error instanceof multer.MulterError)) return next(error);
    res.status(400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? 'Each document must be no larger than 10 MB.' : 'Invalid upload. Select at most 25 files in the expected file field.' });
});
return router;
}
export default createEmployeeDocumentsRouter();
