import { createHash } from 'node:crypto';
import { DOCUMENT_TYPE_IDS } from '../../shared/documentTypes.mjs';
import { assertUuid, DocumentError, requireDocumentAdmin, uploadDocument } from './documentService.js';

export function validateBulkReview(body) {
    if (body.import_source !== 'bulk_import') return null;
    if (body.review_confirmed !== 'true') throw new DocumentError(400, 'Confirm the document type and intended employee before importing each file.');
    if (!DOCUMENT_TYPE_IDS.includes(body.document_type)) throw new DocumentError(400, 'Select a valid document type.');
    return { document_type: body.document_type, review_confirmed: true, import_id: assertUuid(body.import_id, 'Import ID') };
}

export function requireBulkAdmin(req, res, next) {
    if (req.body?.import_source === 'bulk_import') return requireDocumentAdmin(req, res, next);
    next();
}

// Process-local retry protection, including concurrent requests and lost responses.
// Durable, cross-instance idempotency would need a unique database key/migration.
export function createBulkDocumentImporter({ save = uploadDocument, now = Date.now, ttlMs = 30 * 60 * 1000, maxEntries = 1000 } = {}) {
    const completed = new Map();
    const pending = new Map();
    return async (client, user, body, file) => {
        const review = validateBulkReview(body);
        if (!review) return save(client, user, body, file);
        if (!file) throw new DocumentError(400, 'No file uploaded.');
        const key = `${user.id}:${review.import_id}`;
        const fingerprint = createHash('sha256').update(JSON.stringify([body.employee_id, body.title, body.category, body.expiry_date || null, review.document_type, file.originalname, file.mimetype])).update(file.buffer).digest('hex');
        for (const [id, entry] of completed) if (entry.expires <= now()) completed.delete(id);
        const existing = completed.get(key) || pending.get(key);
        if (existing) {
            if (existing.fingerprint !== fingerprint) throw new DocumentError(409, 'This import attempt has different contents. Check the document vault before starting another import.');
            return existing.document || existing.promise;
        }
        if (completed.size + pending.size >= maxEntries) throw new DocumentError(503, 'Bulk import is busy. Retry shortly.');
        const promise = save(client, user, body, file).then(document => {
            completed.set(key, { fingerprint, document, expires: now() + ttlMs });
            return document;
        }).finally(() => pending.delete(key));
        pending.set(key, { fingerprint, promise });
        return promise;
    };
}

export const importEmployeeDocument = createBulkDocumentImporter();
