import { getManilaWorkDate, isCreditUuid, isLeaveDate, isSilWageDocumentId } from '../../shared/leavePolicy.js';
import { SIL_WAGE_DOCUMENT_TYPE } from '../../shared/documentTypes.mjs';

export async function readSilWageSources(client, employeeId, asOf = getManilaWorkDate()) {
    if (!isCreditUuid(employeeId) || !isLeaveDate(asOf) || asOf > getManilaWorkDate()) {
        throw Object.assign(new Error('Choose a valid employee and conversion date.'), { status: 400 });
    }
    const { data, error } = await client.from('employee_documents')
        .select('id,employee_id,document_type,status,title,file_path,file_name,file_size,reviewed_by,reviewed_at,expiry_date')
        .eq('employee_id', employeeId).eq('document_type', SIL_WAGE_DOCUMENT_TYPE).eq('status', 'approved')
        .order('reviewed_at', { ascending: false }).order('id').limit(51);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Wage documents could not be read.');
    const documents = data.slice(0, 50).filter(document => document.employee_id === employeeId && document.status === 'approved'
        && document.document_type === SIL_WAGE_DOCUMENT_TYPE && isSilWageDocumentId(String(document.id))
        && isCreditUuid(document.reviewed_by) && Number.isFinite(Date.parse(document.reviewed_at))
        && (!document.expiry_date || (isLeaveDate(document.expiry_date) && document.expiry_date >= asOf))
        && document.file_path && /\.(pdf|png|jpe?g)$/i.test(document.file_name || '')
        && Number(document.file_size) > 0 && Number(document.file_size) <= 10 * 1024 * 1024)
        .map(document => ({ id: String(document.id), title: document.title, reviewed_at: document.reviewed_at, expiry_date: document.expiry_date }));
    return { employee_id: employeeId, as_of: asOf, documents, has_more: data.length > 50 };
}
