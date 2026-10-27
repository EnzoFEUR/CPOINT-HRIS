export const DOCUMENT_STATUSES = [
    { key: 'all', label: 'All statuses' },
    { key: 'to_review', label: 'To Review' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
];
const STATUS_STYLES = {
    to_review: 'bg-surface-muted text-ink-muted border-line',
    pending: 'bg-warning-subtle text-warning-ink border-warning/30',
    approved: 'bg-success-subtle text-success-ink border-success/30',
    rejected: 'bg-danger-subtle text-danger-ink border-danger/30',
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

export function isImageDocument(fileName = '') {
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'].includes(ext);
}

export function isPdfDocument(fileName = '') {
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    return ext === 'pdf';
}

export function isDocxDocument(fileName = '') {
    const ext = String(fileName || '').split('.').pop().toLowerCase();
    return ['docx', 'doc'].includes(ext);
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

