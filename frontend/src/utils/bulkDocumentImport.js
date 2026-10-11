import { getDocumentType } from '../../../shared/documentTypes.mjs';

export const BULK_LIMITS = Object.freeze({ archiveBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, fileBytes: 10 * 1024 * 1024, files: 100, entries: 300 });
export const BULK_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff']);

// Check the central directory before JSZip allocates entries or inflates content.
export function validateZipDirectory(buffer) {
    if (!buffer.byteLength || buffer.byteLength > BULK_LIMITS.archiveBytes) throw new Error('Choose a nonempty ZIP no larger than 25 MB.');
    const view = new DataView(buffer);
    let end = -1;
    for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset--) {
        if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === buffer.byteLength) { end = offset; break; }
    }
    if (end < 0) throw new Error('The ZIP directory is invalid or incomplete.');
    const count = view.getUint16(end + 10, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count === 0xffff || count > BULK_LIMITS.entries) throw new Error('Use a standard single-part ZIP with at most 300 entries. ZIP64 is not supported.');
    const directorySize = view.getUint32(end + 12, true);
    let offset = view.getUint32(end + 16, true);
    const directoryEnd = offset + directorySize;
    if (directoryEnd > end) throw new Error('Invalid ZIP directory bounds.');
    let total = 0;
    for (let index = 0; index < count; index++) {
        if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('The ZIP directory is corrupt.');
        const size = view.getUint32(offset + 24, true);
        const compressedSize = view.getUint32(offset + 20, true);
        total += size;
        if (size > BULK_LIMITS.fileBytes || compressedSize > BULK_LIMITS.archiveBytes || total > BULK_LIMITS.totalBytes) throw new Error('ZIP contents exceed the limits: 10 MB per file and 100 MB total.');
        if (view.getUint16(offset + 8, true) & 1) throw new Error('Password-protected ZIP files are not supported.');
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const extraEnd = offset + 46 + nameLength + extraLength;
        if (extraEnd > directoryEnd) throw new Error('Invalid ZIP entry bounds.');
        for (let extra = offset + 46 + nameLength; extra + 4 <= extraEnd;) {
            if (view.getUint16(extra, true) === 1) throw new Error('ZIP64 is not supported.');
            extra += 4 + view.getUint16(extra + 2, true);
            if (extra > extraEnd) throw new Error('Invalid ZIP entry metadata.');
        }
        offset = extraEnd + view.getUint16(offset + 32, true);
    }
    if (offset !== directoryEnd) throw new Error('The ZIP directory length is invalid.');
}

export function extractZipEntry(entry, { signal } = {}) {
    return new Promise((resolve, reject) => {
        const stream = entry.internalStream('uint8array');
        const chunks = [];
        let size = 0, settled = false;
        const abort = () => finish(signal.reason || new DOMException('Cancelled', 'AbortError'));
        function finish(error, bytes) {
            if (settled) return;
            settled = true; stream.pause(); chunks.length = 0;
            signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(bytes);
        }
        stream.on('data', chunk => {
            if (settled) return;
            size += chunk.length;
            if (size > BULK_LIMITS.fileBytes) return finish(new Error('Expanded file exceeds 10 MB.'));
            chunks.push(chunk);
        });
        stream.on('error', error => finish(error));
        stream.on('end', () => {
            if (settled) return;
            if (!size) return finish(new Error('Empty files cannot be imported.'));
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            finish(null, bytes);
        });
        if (signal?.aborted) abort();
        else { signal?.addEventListener('abort', abort, { once: true }); stream.resume(); }
    });
}

export function buildImportRows(entries, categories) {
    const rows = [];
    const names = new Set();
    const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const entry of entries) {
        if (entry.dir) continue;
        const parts = entry.name.split('/').filter(Boolean);
        const fileName = parts.at(-1);
        if (!fileName || parts.some(part => part === '__MACOSX' || part.startsWith('.')) || ['thumbs.db', 'desktop.ini'].includes(fileName.toLowerCase())) continue;
        const extension = fileName.split('.').pop().toLowerCase();
        const blocked = !BULK_EXTENSIONS.has(extension) ? 'Unsupported upload format.' : null;
        const duplicate = names.has(fileName.toLowerCase());
        names.add(fileName.toLowerCase());
        const category = parts.slice(0, -1).map(segment => categories.find(value => normalize(value) === normalize(segment))).find(Boolean) || 'Other';
        rows.push({ id: crypto.randomUUID(), importId: crypto.randomUUID(), zipPath: entry.name, fileName, entry, category, title: fileName.slice(0, 200), documentType: 'unknown', expiryDate: '', include: !blocked && !duplicate, confirmed: false, revision: 0, attempted: false, status: 'idle', analysisStatus: 'idle', classification: null, blocked, duplicate, error: null });
    }
    if (!rows.length) throw new Error('No personnel files were found in the ZIP.');
    if (rows.length > BULK_LIMITS.files) throw new Error('Import at most 100 files per ZIP.');
    return rows;
}

export function applyContentSuggestion(row, classification, revision) {
    // A late AI response must never overwrite a reviewer edit or confirmation.
    const result = { ...row, classification, analysisStatus: 'done' };
    if (row.revision !== revision || row.confirmed || row.status === 'success' || classification.source !== 'content') return result;
    const type = getDocumentType(classification.document_type);
    return { ...result, documentType: type.id, category: type.category, title: classification.suggested_title || row.title };
}

export const canImportRow = row => row.include && !row.blocked && row.confirmed && Boolean(row.title.trim()) && row.title.trim().length <= 200 && row.status !== 'success';
