import { randomUUID } from 'node:crypto';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { createNotification } from '../routes/notifications.js';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_URL_TTL = 300;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const FILE_TYPES = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff']);
const broadcasts = new WeakMap();

export class DocumentError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
export const isDocumentAdmin = user => ['admin', 'hr', 'superadmin'].includes(String(user?.role || '').toLowerCase());
export function requireDocumentAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
    if (!isDocumentAdmin(req.user)) return res.status(403).json({ success: false, message: 'Only HR administrators can perform this action.' });
    next();
}
export function assertUuid(value, label = 'ID') {
    if (typeof value !== 'string' || !UUID.test(value)) throw new DocumentError(400, `${label} must be a valid UUID.`);
    return value.toLowerCase();
}
export function assertDocumentId(value) {
    if (typeof value !== 'string' || (!UUID.test(value) && !/^[1-9]\d{0,19}$/.test(value))) throw new DocumentError(400, 'Document ID must be a UUID or positive integer.');
    return value;
}
export function assertDocumentOwner(user, employeeId) {
    if (!user) throw new DocumentError(401, 'Authentication required.');
    if (isDocumentAdmin(user)) return;
    if (![user.id, user.employee_id].some(id => id && String(id).toLowerCase() === String(employeeId).toLowerCase())) throw new DocumentError(403, 'You can only access your own documents.');
}
export function getDocumentScope(user, requestedId) {
    if (!user) throw new DocumentError(401, 'Authentication required.');
    const employeeId = requestedId ? assertUuid(requestedId, 'Employee ID') : (isDocumentAdmin(user) ? null : assertUuid(user.id, 'Employee ID'));
    if (employeeId) assertDocumentOwner(user, employeeId);
    return employeeId;
}
export function normalizeDocumentPath(value, employeeId, projectUrl) {
    if (typeof value !== 'string' || !value.trim()) throw new DocumentError(400, 'Document has no storage path.');
    let path = value.trim();
    if (/^https?:\/\//i.test(path)) {
        const url = new URL(path);
        if (!projectUrl || url.origin !== new URL(projectUrl).origin) throw new DocumentError(400, 'Document URL does not belong to this storage project.');
        const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated|sign)\/documents\/(.+)$/);
        if (!match) throw new DocumentError(400, 'Invalid document storage URL.');
        path = decodeURIComponent(match[1]);
    }
    if (path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || !path.startsWith(`${employeeId}/`)) throw new DocumentError(400, 'Invalid document storage path.');
    return path;
}
export function formatCleanDocumentFileName(title = '', originalName = '') {
    const rawExt = String(originalName || '').split('.').pop() || '';
    const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '');
    const safeExt = ext ? `.${ext}` : '';

    let cleanTitle = String(title || '').trim();
    if (ext && cleanTitle.toLowerCase().endsWith(`.${ext}`)) {
        cleanTitle = cleanTitle.slice(0, -(ext.length + 1));
    }

    const cleanBase = cleanTitle
        .replace(/[^a-zA-Z0-9_\-\s]/g, ' ')
        .replace(/[\s\-_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100);

    if (cleanBase) {
        return `${cleanBase}${safeExt}`;
    }

    const origBase = String(originalName || '')
        .replace(/\.[^/.]+$/, '')
        .trim()
        .replace(/[^a-zA-Z0-9_\-\s]/g, ' ')
        .replace(/[\s\-_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100);

    return `${origBase || 'document'}${safeExt}`;
}

export function validateDocumentInput(body = {}, file) {
    const employeeId = assertUuid(body.employee_id, 'Employee ID');
    if (typeof body.title !== 'string') throw new DocumentError(400, 'Document title is required.');
    if (body.category !== undefined && typeof body.category !== 'string') throw new DocumentError(400, 'Invalid document category.');
    const title = body.title.trim();
    const category = (body.category || 'Other').trim();
    if (!title || title.length > 200) throw new DocumentError(400, 'Document title is required and must be at most 200 characters.');
    if (!category || category.length > 80) throw new DocumentError(400, 'Invalid document category.');
    const expiryDate = body.expiry_date || null;
    if (expiryDate && (typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || !Number.isFinite(Date.parse(expiryDate)) || new Date(expiryDate).toISOString().slice(0, 10) !== expiryDate)) throw new DocumentError(400, 'Expiry date must be a valid calendar date (YYYY-MM-DD).');
    if (file) {
        const extension = file.originalname.split('.').pop()?.toLowerCase();
        if (!FILE_TYPES.has(extension)) throw new DocumentError(400, 'Unsupported document type. Use PDF, Office documents, text, or images.');
        if (!file.size || file.size > DOCUMENT_MAX_BYTES) throw new DocumentError(400, 'Files must be nonempty and no larger than 10 MB.');
        if (['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript'].includes(file.mimetype)) throw new DocumentError(400, 'Active web content is not accepted as a personnel document.');
    }
    const documentType = body.document_type ? String(body.document_type).trim() : null;
    const requestId = body.request_id ? assertUuid(body.request_id, 'Request ID') : null;
    return { employee_id: employeeId, title, category, expiry_date: expiryDate, document_type: documentType, request_id: requestId };
}
export const isEmployeeUploadLocked = employee => Boolean(employee?.archived_at) || employee?.is_active === false || ['inactive', 'terminated', 'separated', 'archived'].includes(String(employee?.status || '').toLowerCase());
export async function ensureWritableEmployee(client, employeeId) {
    const { data, error } = await client.from('employees').select('id, first_name, last_name, company_id, department, status, is_active, archived_at').eq('id', employeeId).maybeSingle();
    if (error) throw error;
    if (!data) throw new DocumentError(404, 'Employee record not found.');
    if (isEmployeeUploadLocked(data)) throw new DocumentError(403, 'Document uploads are disabled for separated or inactive employee accounts.');
    return data;
}
export function documentChanged(client, employeeId, documentId, action, actor, review = {}) {
    invalidateCache(['/api/profile', '/api/employees', '/api/documents', '/api/employee-documents']);
    // Audit and broadcast failures are reported without turning a committed write into a retry.
    Promise.resolve().then(() => client.from('activity_log').insert({
        log_name: 'documents', description: `Document ${action}.`,
        subject_type: 'App\\Models\\EmployeeDocument', subject_id: documentId,
        causer_type: 'App\\Models\\User', causer_id: actor?.id || null,
        event: action === 'uploaded' ? 'created' : action === 'deleted' ? 'deleted' : 'updated',
        properties: { employee_id: employeeId, document_id: documentId, action, ...review }
    })).then(({ error }) => { if (error) console.error('[DOCUMENT_AUDIT]', error.message); })
        .catch(error => console.error('[DOCUMENT_AUDIT]', error.message));
    try {
        let channel = broadcasts.get(client);
        if (!channel) { channel = client.channel('document-updates'); broadcasts.set(client, channel); }
        const payload = { employee_id: employeeId, document_id: documentId, action, ...review };
        if (typeof channel.send === 'function') {
            channel.send({ type: 'broadcast', event: 'DOCUMENT_CHANGED', payload }).catch(() => {});
        }
        if (typeof channel.httpSend === 'function') {
            channel.httpSend('DOCUMENT_CHANGED', payload, { timeout: 2000 }).catch(() => {});
        }
        if (employeeId) {
            client.channel(`myprofile-realtime-${employeeId}`).send({
                type: 'broadcast',
                event: 'DOCUMENT_CHANGED',
                payload
            }).catch(() => {});
        }
    } catch (error) { console.warn('[DOCUMENT_REALTIME]', error.message); }
}
export async function uploadDocument(client, user, body, file) {
    if (!file) throw new DocumentError(400, 'No file uploaded.');
    const metadata = validateDocumentInput(body, file);
    assertDocumentOwner(user, metadata.employee_id);
    const emp = await ensureWritableEmployee(client, metadata.employee_id);
    const filePath = `${metadata.employee_id}/${randomUUID()}.${file.originalname.split('.').pop().toLowerCase()}`;
    const bucket = client.storage.from('documents');
    const { error: storageError } = await bucket.upload(filePath, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
    if (storageError) throw storageError;
    const cleanFileName = formatCleanDocumentFileName(metadata.title, file.originalname);
    const { data, error } = await client.from('employee_documents').insert({ ...metadata, file_name: cleanFileName, file_path: filePath, file_size: file.size, status: 'pending' }).select().single();
    if (error || !data) {
        const { error: cleanupError } = await bucket.remove([filePath]);
        if (cleanupError) console.error('[DOCUMENT_ORPHAN]', filePath, cleanupError.message);
        throw error || new Error('Document record was not saved.');
    }
    try {
        const { data: signed } = await bucket.createSignedUrl(filePath, 3600);
        if (signed?.signedUrl) data.preview_url = signed.signedUrl;
    } catch (_) {}
    let docRequest = null;
    if (metadata.request_id) {
        try {
            const { data: reqData } = await client.from('document_requests').select('*').eq('id', metadata.request_id).maybeSingle();
            docRequest = reqData;
            await client.from('document_requests').update({
                status: 'submitted',
                fulfilled_document_id: data.id,
                fulfilled_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).eq('id', metadata.request_id);
        } catch (reqErr) {
            console.warn('[DOCUMENT_REQUEST_LINK_WARN]', reqErr.message);
        }
    }

    // Enterprise Real-Time Document Submission Notifications
    try {
        const isEmployeeSelfSubmit = !isDocumentAdmin(user) || String(user.id).toLowerCase() === String(metadata.employee_id).toLowerCase();
        const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
        const docTitle = metadata.title || cleanFileName || 'Document';
        const requestSuffix = docRequest?.document_type ? ` (Fulfilling request: ${docRequest.document_type})` : '';

        // 1. Notify Admin/HR of incoming submission for review
        createNotification({
            target: 'admin',
            title: `Document Submitted: ${empName}`,
            text: `${empName} (${emp.company_id || 'ID Pending'}) submitted "${docTitle}"${requestSuffix}. Ready for HR review.`,
            type: 'document_submission',
            sender_id: metadata.employee_id,
            sender_name: empName,
            company_id: emp.company_id
        }).catch(err => console.warn('[NOTIF_SUBMISSION_WARN]', err.message));

        // If a specific admin requested it, also notify them directly
        if (docRequest?.requested_by && docRequest.requested_by !== 'admin') {
            createNotification({
                target: docRequest.requested_by,
                title: `Requested Document Submitted: ${empName}`,
                text: `${empName} has uploaded "${docTitle}" for your request (${docRequest.document_type}).`,
                type: 'document_submission',
                sender_id: metadata.employee_id,
                sender_name: empName,
                company_id: emp.company_id
            }).catch(err => console.warn('[NOTIF_SPECIFIC_ADMIN_WARN]', err.message));
        }

        // 2. Immediate submission confirmation receipt for the employee
        if (isEmployeeSelfSubmit) {
            createNotification({
                target: metadata.employee_id,
                title: `Document Submitted: ${docTitle}`,
                text: `Your ${docTitle} has been submitted successfully and is now pending HR review.`,
                type: 'document_submission_receipt',
                sender_id: metadata.employee_id,
                sender_name: 'Document Vault'
            }).catch(err => console.warn('[NOTIF_RECEIPT_WARN]', err.message));
        }
    } catch (notifErr) {
        console.warn('[DOCUMENT_NOTIF_DISPATCH_WARN]', notifErr.message);
    }

    // The reviewed type is a human selection, not proof of authenticity or AI accuracy.
    const review = body.import_source === 'bulk_import' ? { import_source: 'bulk_import', document_type: body.document_type, review_confirmed: true, import_id: body.import_id } : {};
    documentChanged(client, data.employee_id, data.id, 'uploaded', user, review);
    return data;
}
export async function findDocument(client, id) {
    assertDocumentId(id);
    const { data, error } = await client.from('employee_documents').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new DocumentError(404, 'Document not found.');
    return data;
}
export async function listDocuments(client, user, filters = {}) {
    const employeeId = getDocumentScope(user, filters.employee_id);
    const paginated = filters.page !== undefined;
    const page = Number(filters.page || 1), limit = Number(filters.limit || 100);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new DocumentError(400, 'Invalid document pagination.');
    const sort = filters.sort || 'newest';
    if (!['newest', 'oldest', 'name', 'expiry'].includes(sort)) throw new DocumentError(400, 'Invalid document sort order.');
    let query = client.from('employee_documents').select('*', { count: 'exact' });
    if (sort === 'name') query = query.order('title', { ascending: true });
    else if (sort === 'expiry') query = query.order('expiry_date', { ascending: true, nullsFirst: false });
    else query = query.order('created_at', { ascending: sort === 'oldest' });
    query = query.order('id', { ascending: sort === 'oldest' });
    if (employeeId) query = query.eq('employee_id', employeeId);
    if (filters.status) {
        if (filters.status === 'to_review') query = query.is('status', null);
        else if (filters.status === 'pending') query = query.or('status.eq.pending,status.is.null');
        else if (['approved', 'rejected'].includes(filters.status)) query = query.eq('status', filters.status);
        else throw new DocumentError(400, 'Invalid document status filter.');
    }
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.search) {
        if (typeof filters.search !== 'string' || filters.search.length > 200) throw new DocumentError(400, 'Search must be at most 200 characters.');
        // Quoted PostgREST values prevent commas/parentheses from changing the filter grammar.
        const escaped = filters.search.trim().replace(/[\\%_]/g, character => `\\${character}`);
        const pattern = JSON.stringify(`%${escaped}%`);
        query = query.or(`title.ilike.${pattern},file_name.ilike.${pattern}`);
    }
    if (paginated) query = query.range((page - 1) * limit, page * limit - 1);
    const employeeQuery = employeeId ? client.from('employees').select('id, first_name, last_name, company_id, department, status, is_active, archived_at').eq('id', employeeId).maybeSingle() : Promise.resolve({ data: null });
    const [result, employeeResult] = await Promise.all([query, employeeQuery]);
    if (result.error) throw result.error;
    if (employeeResult.error) throw employeeResult.error;
    const documents = result.data || [];
    let employees = employeeResult.data ? [employeeResult.data] : [];
    if (!employeeId && documents.length) {
        const lookup = await client.from('employees').select('id, first_name, last_name, company_id').in('id', [...new Set(documents.map(doc => doc.employee_id))]);
        if (lookup.error) throw lookup.error;
        employees = lookup.data || [];
    }
    const byId = new Map(employees.map(employee => [employee.id, employee]));

    if (documents.length > 0) {
        try {
            const pathEntries = [];
            for (const doc of documents) {
                if (doc.file_path) {
                    try {
                        const norm = normalizeDocumentPath(doc.file_path, doc.employee_id, client.supabaseUrl);
                        pathEntries.push(norm);
                    } catch (_) {}
                }
            }
            if (pathEntries.length > 0) {
                const uniquePaths = [...new Set(pathEntries)];
                const { data: signedList } = await client.storage.from('documents').createSignedUrls(uniquePaths, 3600);
                if (Array.isArray(signedList)) {
                    const signedMap = new Map();
                    for (const item of signedList) {
                        if (item?.path && item?.signedUrl) {
                            signedMap.set(item.path, item.signedUrl);
                        }
                    }
                    for (const doc of documents) {
                        try {
                            const norm = normalizeDocumentPath(doc.file_path, doc.employee_id, client.supabaseUrl);
                            doc.preview_url = signedMap.get(norm) || null;
                        } catch {
                            doc.preview_url = null;
                        }
                    }
                }
            }
        } catch (signErr) {
            console.warn('[DOC_BATCH_SIGN_WARN]', signErr.message);
        }
    }

    return { documents: documents.map(doc => ({ ...doc, employees: byId.get(doc.employee_id) || null })), employee: employeeResult.data, upload_locked: employeeResult.data ? isEmployeeUploadLocked(employeeResult.data) : false, meta: { page, limit, total: result.count ?? documents.length, has_more: paginated && page * limit < (result.count ?? 0) } };
}
export function documentRoute(handler) {
    return async (req, res, next) => {
        try { await handler(req, res, next); }
        catch (error) {
            if (!(error instanceof DocumentError)) console.error('[DOCUMENT_API]', error.message);
            res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Document request failed. Please try again.', error: error.status ? error.message : 'Document service unavailable.' });
        }
    };
}
