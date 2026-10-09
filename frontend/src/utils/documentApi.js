import { fetchWithAuth } from './api';

export async function documentRequest(endpoint, options) {
    const response = await fetchWithAuth(endpoint, options);
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Document service returned an invalid response (${response.status}).`); }
    if (!response.ok || !data.success) {
        const error = new Error(data.message || data.error || 'Document request failed.');
        error.status = response.status;
        throw error;
    }
    return data;
}

export async function uploadEmployeeDocument({ employeeId, file, title, category, expiryDate, bulkReview }) {
    if (!file || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Choose a nonempty file no larger than 10 MB.');
    const body = new FormData();
    body.append('employee_id', employeeId);
    body.append('file', file);
    body.append('title', title?.trim() || file.name);
    body.append('category', category || 'Other');
    if (expiryDate) body.append('expiry_date', expiryDate);
    if (bulkReview) {
        body.append('import_source', 'bulk_import');
        body.append('review_confirmed', String(bulkReview.confirmed === true));
        body.append('document_type', bulkReview.documentType);
        body.append('import_id', bulkReview.importId);
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
