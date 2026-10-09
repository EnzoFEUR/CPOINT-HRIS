export const DOCUMENT_STATUSES = [
    { key: 'all', label: 'All statuses' },
    { key: 'to_review', label: 'To Review' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
];
const STATUS_STYLES = {
    to_review: 'bg-slate-100 text-slate-600 border-slate-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};
const FILE_MIME_TYPES = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', csv: 'text/csv', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff' };
export const getDocumentMimeType = filename => FILE_MIME_TYPES[String(filename || '').split('.').pop().toLowerCase()] || 'application/octet-stream';
export function getDocumentStatus(document) {
    const raw = String(document?.status || '').trim().toLowerCase();
    const key = ['pending', 'approved', 'rejected'].includes(raw) ? raw : 'to_review';
    return { key, label: DOCUMENT_STATUSES.find(status => status.key === key).label, className: STATUS_STYLES[key] };
}
export function formatDocumentSize(value) {
    if (typeof value === 'string' && value.trim() && !Number.isFinite(Number(value))) return value;
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}
export function getDocumentExpiry(document, now = new Date()) {
    if (!document?.expiry_date) return null;
    const date = String(document.expiry_date).slice(0, 10);
    const expiry = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(expiry) || new Date(expiry).toISOString().slice(0, 10) !== date) return null;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const daysLeft = Math.round((expiry - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (daysLeft < 0) return { level: 'expired', daysLeft, label: `Expired ${Math.abs(daysLeft)}d ago` };
    if (daysLeft === 0) return { level: 'warning', daysLeft, label: 'Expires today' };
    if (daysLeft <= 30) return { level: 'warning', daysLeft, label: `Expires in ${daysLeft}d` };
    return { level: 'valid', daysLeft, label: `Valid until ${date}` };
}
