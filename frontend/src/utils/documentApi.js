import { fetchWithAuth } from './api';
import { formatCleanDocumentFileName } from './documentUtils';

export async function documentRequest(endpoint, options) {
    const response = await fetchWithAuth(endpoint, options);
    let data;
    try { data = await response.json(); }
    catch (error) {
        if (error?.name === 'AbortError' || (options?.signal?.aborted && error === options.signal.reason)) {
            throw error;
        }
        throw new Error(`Document service returned an invalid response (${response.status}).`, { cause: error });
    }
    if (!response.ok || !data.success) {
        const error = new Error(data.message || data.error || 'Document request failed.');
        error.status = response.status;
        error.code = data.code;
        throw error;
    }
    return data;
}

export async function uploadEmployeeDocument({
    employeeId,
    file,
    title,
    category,
    documentType,
    requestId,
    expiryDate,
    bulkReview
}) {
    if (!file || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a nonempty file no larger than 10 MB.');
    
    // Auto-rename the image or file based on document title
    const resolvedTitle = title?.trim() || file.name.replace(/\.[^/.]+$/, '');
    const cleanFileName = formatCleanDocumentFileName(resolvedTitle, file.name);
    const renamedFile = file.name === cleanFileName ? file : new File([file], cleanFileName, { type: file.type });

    const body = new FormData();
    body.append('employee_id', employeeId);
    body.append('file', renamedFile);
    body.append('title', resolvedTitle);
    body.append('file_name', cleanFileName);
    body.append('category', category || 'Other');
    if (documentType) body.append('document_type', documentType);
    if (requestId) body.append('request_id', requestId);
    if (expiryDate) body.append('expiry_date', expiryDate);
    if (bulkReview) {
        body.append('import_source', 'bulk_import');
        body.append('review_confirmed', String(bulkReview.confirmed === true));
        body.append('document_type', bulkReview.documentType);
        body.append('import_id', bulkReview.importId);
        if (bulkReview.idNumber) body.append('extracted_id_number', bulkReview.idNumber);
    }
    return (await documentRequest('/api/employee-documents', { method: 'POST', body })).document;
}

export async function classifyEmployeeDocument({ employeeId, file, signal }) {
    const body = new FormData();
    body.append('employee_id', employeeId);
    body.append('file', file);
    body.append('analysis_consent', 'true');
    return (await documentRequest('/api/employee-documents/classify', { method: 'POST', body, signal })).classification;
}

export async function openEmployeeDocument(documentId) {
    // Open during the user gesture so async signing does not trigger popup blockers.
    const popup = window.open('about:blank', '_blank');
    if (!popup) throw new Error('Allow popups for this site to open the document.');
    popup.opener = null;
    try {
        const { url } = await documentRequest(`/api/employee-documents/${encodeURIComponent(documentId)}/url`);
        if (!url) throw new Error('Document link is unavailable.');
        popup.location.replace(url);
    } catch (error) { popup.close(); throw error; }
}

export async function fetchDocumentRequests({ employeeId, status = 'all', signal } = {}) {
    const params = new URLSearchParams();
    if (employeeId) params.set('employee_id', employeeId);
    if (status && status !== 'all') params.set('status', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await documentRequest(`/api/documents/requests${query}`, { signal });
    return res.requests || [];
}

export async function createDocumentRequest({ employeeId, documentType, category, priority, dueDate, notes }) {
    return (await documentRequest('/api/documents/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            employee_id: employeeId,
            document_type: documentType,
            category,
            priority,
            due_date: dueDate,
            notes
        })
    })).request;
}

export async function cancelDocumentRequest(requestId) {
    return (await documentRequest(`/api/documents/requests/${encodeURIComponent(requestId)}/cancel`, {
        method: 'PATCH'
    })).request;
}

export async function remindDocumentRequest(requestId) {
    return await documentRequest(`/api/documents/requests/${encodeURIComponent(requestId)}/remind`, {
        method: 'POST'
    });
}

export async function fetchEmployeeCompliance(employeeId, { signal } = {}) {
    const res = await documentRequest(`/api/documents/compliance/${encodeURIComponent(employeeId)}`, { signal });
    return res.compliance || null;
}

export async function fetchPendingDocumentCounts({ signal } = {}) {
    const res = await documentRequest('/api/documents/pending-counts', { signal });
    return res.counts || {};
}

export async function reviewDocumentStatus({ documentId, status, rejectionReason }) {
    return await documentRequest(`/api/documents/${encodeURIComponent(documentId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status,
            rejection_reason: rejectionReason
        })
    });
}
