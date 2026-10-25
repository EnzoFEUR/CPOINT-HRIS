import { readAllRows } from './listViews.js';

export async function readDocumentPendingCounts(client) {
    const [pendingDocs, submittedRequests] = await Promise.all([
        readAllRows(() => client.from('employee_documents').select('id, employee_id, document_type, title, status', { count: 'exact' }).or('status.eq.pending,status.is.null').order('id')),
        readAllRows(() => client.from('document_requests').select('id, employee_id, document_type, status', { count: 'exact' }).eq('status', 'submitted').order('id')),
    ]);
    const counts = {};
    for (const doc of [...pendingDocs, ...submittedRequests]) {
        if (!doc.employee_id) continue;
        counts[doc.employee_id] ||= { pending_documents: 0, submitted_requests: 0, total: 0, doc_titles: [] };
    }
    for (const doc of pendingDocs) {
        if (!doc.employee_id) continue;
        const count = counts[doc.employee_id];
        count.pending_documents++;
        count.total++;
        if (doc.title || doc.document_type) count.doc_titles.push(doc.document_type || doc.title);
    }
    for (const request of submittedRequests) {
        if (!request.employee_id) continue;
        const count = counts[request.employee_id];
        count.submitted_requests++;
        if (count.pending_documents === 0) {
            count.total++;
            if (request.document_type) count.doc_titles.push(request.document_type);
        }
    }
    return counts;
}
