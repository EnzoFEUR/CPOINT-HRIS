import express from 'express';
import { readDocumentPendingCounts } from '../utils/documentPendingCounts.js';
import { validateRecordId, validateUuidParam } from '../middleware/requestValidation.js';
import { supabase } from '../supabaseClient.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import {
    assertDocumentId,
    assertDocumentOwner,
    assertUuid,
    documentChanged,
    DOCUMENT_URL_TTL,
    documentRoute,
    ensureWritableEmployee,
    findDocument,
    formatCleanDocumentFileName,
    isDocumentAdmin,
    listDocuments,
    normalizeDocumentPath,
    requireDocumentAdmin,
    validateDocumentInput,
    DocumentError
} from '../services/documentService.js';
import { createNotification } from './notifications.js';
import { getStandard201Requirements, getDocumentType } from '../../shared/documentTypes.mjs';

// Authentication is applied at the /api/documents mount in index.js.
export function createDocumentRouter(client = supabase) {
    const router = express.Router();
    router.param('id', validateRecordId);
    router.param('employee_id', validateUuidParam);
    router.use((req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required.' });
        next();
    });

    // 1. List employee documents
    router.get('/', documentRoute(async (req, res) => {
        const result = await listDocuments(client, req.user, req.query);
        res.json({ success: true, ...result, data: result.documents });
    }));

    // 2. Document Requests endpoints
    router.get('/requests', documentRoute(async (req, res) => {
        const isAdmin = isDocumentAdmin(req.user);
        let query = client.from('document_requests').select('*').order('created_at', { ascending: false });

        if (!isAdmin) {
            query = query.eq('employee_id', req.user.id);
        } else if (req.query.employee_id) {
            query = query.eq('employee_id', assertUuid(req.query.employee_id, 'Employee ID'));
        }

        if (req.query.status && req.query.status !== 'all') {
            query = query.eq('status', req.query.status);
        }

        const { data: requests, error } = await query;
        if (error) throw error;

        // Enrich with employee names and details
        const employeeIds = [...new Set((requests || []).map(r => r.employee_id).filter(Boolean))];
        const requestedByIds = [...new Set((requests || []).map(r => r.requested_by).filter(Boolean))];
        const fulfilledDocIds = [...new Set((requests || []).map(r => r.fulfilled_document_id).filter(Boolean))];

        const [empRes, adminRes, docRes] = await Promise.all([
            employeeIds.length
                ? client.from('employees').select('id, first_name, last_name, company_id, department, status').in('id', employeeIds)
                : Promise.resolve({ data: [] }),
            requestedByIds.length
                ? client.from('employees').select('id, first_name, last_name').in('id', requestedByIds)
                : Promise.resolve({ data: [] }),
            fulfilledDocIds.length
                ? client.from('employee_documents').select('id, employee_id, title, file_name, file_path, status, created_at').in('id', fulfilledDocIds)
                : Promise.resolve({ data: [] })
        ]);

        const fulfilledDocs = docRes.data || [];
        if (fulfilledDocs.length > 0) {
            try {
                const paths = fulfilledDocs
                    .filter(d => d.file_path)
                    .map(d => {
                        try { return normalizeDocumentPath(d.file_path, d.employee_id, client.supabaseUrl); }
                        catch { return null; }
                    })
                    .filter(Boolean);
                if (paths.length > 0) {
                    const { data: signedList } = await client.storage.from('documents').createSignedUrls([...new Set(paths)], DOCUMENT_URL_TTL);
                    if (Array.isArray(signedList)) {
                        const signedMap = new Map(signedList.filter(s => s?.path && s?.signedUrl).map(s => [s.path, s.signedUrl]));
                        for (const doc of fulfilledDocs) {
                            try {
                                const norm = normalizeDocumentPath(doc.file_path, doc.employee_id, client.supabaseUrl);
                                doc.preview_url = signedMap.get(norm) || null;
                            } catch {
                                doc.preview_url = null;
                            }
                        }
                    }
                }
            } catch (_) {}
        }

        const empMap = new Map((empRes.data || []).map(e => [e.id, e]));
        const adminMap = new Map((adminRes.data || []).map(a => [a.id, a]));
        const docMap = new Map(fulfilledDocs.map(d => [d.id, d]));

        const enrichedRequests = (requests || []).map(r => ({
            ...r,
            employee: empMap.get(r.employee_id) || null,
            requested_by_user: adminMap.get(r.requested_by) || null,
            fulfilled_document: docMap.get(r.fulfilled_document_id) || null
        }));

        res.json({ success: true, requests: enrichedRequests });
    }));

    // Create a new document request (Admin only)
    router.post('/requests', requireDocumentAdmin, documentRoute(async (req, res) => {
        const { employee_id, document_type, category, priority = 'normal', due_date, notes } = req.body || {};
        if (!employee_id) throw new DocumentError(400, 'Employee ID is required.');
        if (!document_type || !document_type.trim()) throw new DocumentError(400, 'Document type is required.');

        assertUuid(employee_id, 'Employee ID');
        const emp = await ensureWritableEmployee(client, employee_id);

        const docTypeMeta = getDocumentType(document_type);
        const isStandard = docTypeMeta && docTypeMeta.id !== 'unknown';
        const resolvedLabel = isStandard ? docTypeMeta.label : document_type.trim();
        const resolvedCategory = (category?.trim() && category !== 'Other')
            ? category.trim()
            : (isStandard ? docTypeMeta.category : (category?.trim() || 'Other'));

        const payload = {
            employee_id,
            document_type: resolvedLabel,
            category: resolvedCategory,
            priority: ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
            due_date: due_date || null,
            notes: notes?.trim() || null,
            status: 'pending',
            requested_by: req.user.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await client.from('document_requests').insert(payload).select().single();
        if (error) throw error;
        invalidateCache(['/api/employees', '/api/documents']);

        // Real-time dispatch and notification to employee
        const requesterName = `${req.user.first_name || 'HR'} ${req.user.last_name || 'Admin'}`.trim();
        await createNotification({
            target: employee_id,
            title: `Document Requested: ${resolvedLabel}`,
            text: `HR has requested your ${resolvedLabel}${due_date ? ` (Due: ${due_date})` : ''}. ${notes ? `Instructions: ${notes}` : 'Please upload this document to complete your employee records.'}`,
            type: 'document_request',
            sender_id: req.user.id,
            sender_name: requesterName
        }).catch(err => console.warn('[NOTIF_WARN]', err.message));

        try {
            const realtimePayload = {
                employee_id,
                action: 'request_created',
                request_id: data.id,
                document_type: resolvedLabel,
                category: resolvedCategory
            };
            const channel = client.channel('document-updates');
            if (typeof channel.send === 'function') {
                channel.send({ type: 'broadcast', event: 'DOCUMENT_CHANGED', payload: realtimePayload }).catch(() => {});
            }
            if (typeof channel.httpSend === 'function') {
                channel.httpSend('DOCUMENT_CHANGED', realtimePayload, { timeout: 2000 }).catch(() => {});
            }
            client.channel(`myprofile-realtime-${employee_id}`).send({
                type: 'broadcast',
                event: 'DOCUMENT_CHANGED',
                payload: realtimePayload
            }).catch(() => {});
        } catch (_) {}

        res.status(201).json({ success: true, request: data });
    }));

    // Cancel a pending document request (Admin only)
    router.patch('/requests/:id/cancel', requireDocumentAdmin, documentRoute(async (req, res) => {
        const id = assertUuid(req.params.id, 'Request ID');
        const { data, error } = await client.from('document_requests')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;

        invalidateCache(['/api/employees', '/api/documents']);
        try {
            const channel = client.channel('document-updates');
            await channel.httpSend('DOCUMENT_CHANGED', {
                employee_id: data.employee_id,
                action: 'request_cancelled',
                request_id: data.id
            }, { timeout: 2000 });
        } catch (_) {}

        res.json({ success: true, request: data });
    }));

    // Re-send reminder notification for document request (Admin only)
    router.post('/requests/:id/remind', requireDocumentAdmin, documentRoute(async (req, res) => {
        const id = assertUuid(req.params.id, 'Request ID');
        const { data: request, error } = await client.from('document_requests').select('*').eq('id', id).maybeSingle();
        if (error || !request) throw new DocumentError(404, 'Document request not found.');
        if (request.status !== 'pending') throw new DocumentError(400, 'Reminders can only be sent for pending document requests.');

        const requesterName = `${req.user.first_name || 'HR'} ${req.user.last_name || 'Admin'}`.trim();
        await createNotification({
            target: request.employee_id,
            title: `Reminder: Document Required (${request.document_type})`,
            text: `Friendly reminder from HR: Please submit your ${request.document_type}${request.due_date ? ` before ${request.due_date}` : ''}. ${request.notes || ''}`,
            type: 'document_reminder',
            sender_id: req.user.id,
            sender_name: requesterName
        });

        res.json({ success: true, message: 'Reminder sent to employee.' });
    }));

    // 3. Employee Document Compliance Summary
    router.get('/compliance/:employee_id', documentRoute(async (req, res) => {
        const employeeId = assertUuid(req.params.employee_id, 'Employee ID');
        assertDocumentOwner(req.user, employeeId);

        const standardTypes = getStandard201Requirements();
        const { data: documents, error: docErr } = await client
            .from('employee_documents')
            .select('id, title, category, document_type, status, expiry_date, created_at')
            .eq('employee_id', employeeId);
        if (docErr) throw docErr;

        const { data: openRequests, error: reqErr } = await client
            .from('document_requests')
            .select('*')
            .eq('employee_id', employeeId)
            .in('status', ['pending', 'submitted']);
        if (reqErr) throw reqErr;

        const items = standardTypes.map(st => {
            const matchedDocs = (documents || []).filter(d =>
                (d.document_type && d.document_type.toLowerCase().includes(st.id.replace(/_/g, ' '))) ||
                (d.title && d.title.toLowerCase().includes(st.label.toLowerCase())) ||
                (st.id === 'tin' && (d.title.toLowerCase().includes('tin') || d.title.toLowerCase().includes('1902') || d.title.toLowerCase().includes('2316'))) ||
                (st.id === 'sss' && d.title.toLowerCase().includes('sss')) ||
                (st.id === 'philhealth' && d.title.toLowerCase().includes('philhealth')) ||
                (st.id === 'pagibig' && (d.title.toLowerCase().includes('pagibig') || d.title.toLowerCase().includes('pag-ibig'))) ||
                (st.id === 'nbi_clearance' && d.title.toLowerCase().includes('nbi')) ||
                (st.id === 'medical_certificate' && (d.title.toLowerCase().includes('medical') || d.title.toLowerCase().includes('fit to work') || d.title.toLowerCase().includes('fit-to-work'))) ||
                (st.id === 'employment_contract' && d.title.toLowerCase().includes('contract'))
            );

            const approvedDoc = matchedDocs.find(d => d.status === 'approved');
            const pendingDoc = matchedDocs.find(d => d.status === 'pending');
            const hasOpenReq = (openRequests || []).find(r => {
                if (!r.document_type) return false;
                const reqType = getDocumentType(r.document_type);
                return reqType.id === st.id ||
                    r.document_type.toLowerCase().includes(st.label.toLowerCase()) ||
                    r.document_type.toLowerCase().includes(st.id.replace(/_/g, ' '));
            });

            let complianceStatus = 'missing';
            let document = null;

            if (approvedDoc) {
                complianceStatus = 'approved';
                document = approvedDoc;
            } else if (pendingDoc) {
                complianceStatus = 'pending_review';
                document = pendingDoc;
            } else if (hasOpenReq) {
                complianceStatus = 'requested';
            }

            return {
                type_id: st.id,
                label: st.label,
                category: st.category,
                description: st.description,
                status: complianceStatus,
                document,
                request: hasOpenReq || null
            };
        });

        const completedCount = items.filter(i => i.status === 'approved').length;
        const totalCount = items.length;
        const scorePercentage = Math.round((completedCount / totalCount) * 100);

        res.json({
            success: true,
            compliance: {
                score: scorePercentage,
                completed: completedCount,
                total: totalCount,
                items
            }
        });
    }));

    // Record metadata
    const recordMetadata = documentRoute(async (req, res) => {
        const body = req.body || {};
        const metadata = validateDocumentInput({ ...body, title: body.title || body.file_name });
        assertDocumentOwner(req.user, metadata.employee_id);
        await ensureWritableEmployee(client, metadata.employee_id);
        const filePath = normalizeDocumentPath(body.file_path, metadata.employee_id, client.supabaseUrl);
        const cleanFileName = formatCleanDocumentFileName(metadata.title, body.file_name || metadata.title);
        const { data, error } = await client.from('employee_documents').insert({
            ...metadata,
            file_name: cleanFileName,
            file_path: filePath,
            file_size: body.file_size || 0,
            status: 'pending'
        }).select().single();
        if (error) throw error;
        try {
            const { data: signed } = await client.storage.from('documents').createSignedUrl(filePath, DOCUMENT_URL_TTL);
            if (signed?.signedUrl) data.preview_url = signed.signedUrl;
        } catch (_) {}

        if (metadata.request_id) {
            try {
                await client.from('document_requests').update({
                    status: 'submitted',
                    fulfilled_document_id: data.id,
                    fulfilled_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }).eq('id', metadata.request_id);
            } catch (_) {}
        }

        documentChanged(client, data.employee_id, data.id, 'uploaded', req.user);
        res.status(req.path === '/record' ? 201 : 200).json({ success: true, data, document: data });
    });

    router.post('/', recordMetadata);
    router.post('/record', recordMetadata);

    // Admin pending review and submission counts per employee
    router.get('/pending-counts', requireDocumentAdmin, documentRoute(async (req, res) => {
        const counts = await readDocumentPendingCounts(client);

        let grandTotal = 0;
        for (const id of Object.keys(counts)) {
            grandTotal += counts[id].total;
        }

        res.json({ success: true, counts, grand_total: grandTotal });
    }));

    // Review Document Status (Approve / Reject / Re-open Review)
    router.patch('/:id/status', requireDocumentAdmin, documentRoute(async (req, res) => {
        assertDocumentId(req.params.id);
        const { status, rejection_reason } = req.body || {};
        if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid document status.' });
        if (rejection_reason && (typeof rejection_reason !== 'string' || rejection_reason.length > 1000)) return res.status(400).json({ success: false, message: 'Rejection reason must be at most 1000 characters.' });
        const document = await findDocument(client, req.params.id);

        // Enterprise State Machine Protection: prevent direct flip between rejected and approved
        if (document.status === 'rejected' && status === 'approved') {
            return res.status(400).json({
                success: false,
                message: 'A rejected document cannot be directly approved. Re-open review first to reset the submission for re-evaluation.'
            });
        }
        if (document.status === 'approved' && status === 'rejected') {
            return res.status(400).json({
                success: false,
                message: 'An approved document cannot be directly rejected. Re-open review first to re-evaluate the record.'
            });
        }

        const { data, error } = await client.from('employee_documents').update({
            status,
            rejection_reason: status === 'rejected' ? rejection_reason?.trim() || 'Document does not meet requirements.' : null,
            reviewed_at: status === 'pending' ? null : new Date().toISOString(),
            reviewed_by: status === 'pending' ? null : req.user.id
        }).eq('id', document.id).select().single();
        if (error) throw error;

        // Update linked document requests
        try {
            if (status === 'approved') {
                if (document.request_id) {
                    await client.from('document_requests')
                        .update({ status: 'approved', updated_at: new Date().toISOString() })
                        .or(`fulfilled_document_id.eq.${document.id},id.eq.${document.request_id}`);
                } else {
                    await client.from('document_requests')
                        .update({ status: 'approved', updated_at: new Date().toISOString() })
                        .eq('fulfilled_document_id', document.id);
                }

                await createNotification({
                    target: document.employee_id,
                    title: `Document Approved: ${document.title}`,
                    text: `Your ${document.title} has been approved and securely filed in your official records.`,
                    type: 'document_approved',
                    sender_id: req.user.id
                });
            } else if (status === 'rejected') {
                const rejectReasonText = rejection_reason?.trim() || 'Document does not meet requirements.';
                if (document.request_id) {
                    await client.from('document_requests')
                        .update({
                            status: 'pending',
                            notes: `Rejected by HR: ${rejectReasonText}`,
                            updated_at: new Date().toISOString()
                        })
                        .or(`fulfilled_document_id.eq.${document.id},id.eq.${document.request_id}`);
                } else {
                    await client.from('document_requests')
                        .update({
                            status: 'pending',
                            notes: `Rejected by HR: ${rejectReasonText}`,
                            updated_at: new Date().toISOString()
                        })
                        .eq('fulfilled_document_id', document.id);
                }

                await createNotification({
                    target: document.employee_id,
                    title: `Document Rejected: ${document.title}`,
                    text: `Your ${document.title} was rejected. Note: ${rejectReasonText}. Please upload a replacement.`,
                    type: 'document_rejected',
                    sender_id: req.user.id
                });
            } else if (status === 'pending') {
                if (document.request_id) {
                    await client.from('document_requests')
                        .update({
                            status: 'submitted',
                            notes: 'Re-opened for HR review',
                            updated_at: new Date().toISOString()
                        })
                        .or(`fulfilled_document_id.eq.${document.id},id.eq.${document.request_id}`);
                } else {
                    await client.from('document_requests')
                        .update({
                            status: 'submitted',
                            notes: 'Re-opened for HR review',
                            updated_at: new Date().toISOString()
                        })
                        .eq('fulfilled_document_id', document.id);
                }
            }
        } catch (notifErr) {
            console.warn('[DOC_STATUS_SYNC_WARN]', notifErr.message);
        }

        documentChanged(client, data.employee_id, data.id, status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'reopened', req.user, { status });
        res.json({ success: true, data });
    }));

    // Delete Document (Admin only)
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
