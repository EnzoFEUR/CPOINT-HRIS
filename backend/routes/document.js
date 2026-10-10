import express from 'express';
import { supabase } from '../supabaseClient.js';
import { assertDocumentId, assertDocumentOwner, documentChanged, documentRoute, ensureWritableEmployee, findDocument, listDocuments, normalizeDocumentPath, requireDocumentAdmin, validateDocumentInput } from '../services/documentService.js';

// Authentication is applied at the /api/documents mount in index.js.
export function createDocumentRouter(client = supabase) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
        next();
    });
    router.get('/', documentRoute(async (req, res) => {
        const result = await listDocuments(client, req.user, req.query);
        res.json({ success: true, ...result, data: result.documents });
    }));
    const recordMetadata = documentRoute(async (req, res) => {
        const body = req.body || {};
        const metadata = validateDocumentInput({ ...body, title: body.title || body.file_name });
        assertDocumentOwner(req.user, metadata.employee_id);
        await ensureWritableEmployee(client, metadata.employee_id);
        const filePath = normalizeDocumentPath(body.file_path, metadata.employee_id, client.supabaseUrl);
        const { data, error } = await client.from('employee_documents').insert({ ...metadata, file_name: body.file_name || metadata.title, file_path: filePath, file_size: body.file_size || null, status: 'pending' }).select().single();
        if (error) throw error;
        documentChanged(client, data.employee_id, data.id, 'uploaded', req.user);
        res.status(req.path === '/record' ? 201 : 200).json({ success: true, data, document: data });
    });
    router.post('/', recordMetadata);
    router.post('/record', recordMetadata);
    router.patch('/:id/status', requireDocumentAdmin, documentRoute(async (req, res) => {
        assertDocumentId(req.params.id);
        const { status, rejection_reason } = req.body || {};
        if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid document status.' });
        if (rejection_reason && (typeof rejection_reason !== 'string' || rejection_reason.length > 1000)) return res.status(400).json({ success: false, message: 'Rejection reason must be at most 1000 characters.' });
        const document = await findDocument(client, req.params.id);
        const { data, error } = await client.from('employee_documents').update({ status, rejection_reason: status === 'rejected' ? rejection_reason?.trim() || 'Document does not meet requirements.' : null, reviewed_at: new Date().toISOString(), reviewed_by: req.user.id }).eq('id', document.id).select().single();
        if (error) throw error;
        documentChanged(client, data.employee_id, data.id, 'reviewed', req.user);
        res.json({ success: true, data });
    }));
    router.delete('/:id', requireDocumentAdmin, documentRoute(async (req, res) => {
        const document = await findDocument(client, req.params.id);
        const path = normalizeDocumentPath(document.file_path, document.employee_id, client.supabaseUrl);
        const { error: storageError } = await client.storage.from('documents').remove([path]);
        if (storageError) throw storageError;
        const { error } = await client.from('employee_documents').delete().eq('id', document.id);
        if (error) throw error;
        documentChanged(client, document.employee_id, document.id, 'deleted', req.user);
        res.json({ success: true });
    }));
    return router;
}
export default createDocumentRouter();
