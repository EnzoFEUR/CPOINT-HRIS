import { compressDocumentImage } from './documentImage.js';
import { getDocumentType } from '../../../shared/documentTypes.mjs';

export const BULK_LIMITS = Object.freeze({ archiveBytes: 50 * 1024 * 1024, totalBytes: 150 * 1024 * 1024, fileBytes: 15 * 1024 * 1024, files: 150, entries: 500 });
export const BULK_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff']);

export function filenameDocumentHint(filename) {
    const name = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[_-]/g, ' ');
    const patterns = [
        ['tin', /\b(?:1902|2316|tin)\b/], ['sss', /\b(?:sss|e\s?[14])\b/],
        ['philhealth', /\b(?:philhealth|mdr)\b/], ['pagibig', /\b(?:pag\s?ibig|mdf)\b/],
        ['philsys', /\b(?:philsys|ephilid|national id)\b/], ['umid', /\bumid\b/],
        ['drivers_license', /\b(?:lto|driver'?s? license|license)\b/], ['passport', /\bpassport\b/],
        ['nbi_clearance', /\bnbi\b/], ['police_clearance', /\bpolice\b/], ['barangay_clearance', /\bbarangay\b/],
        ['medical_certificate', /\b(?:med cert|medical|fit to work)\b/], ['birth_certificate', /\b(?:psa|birth certificate)\b/],
    ];
    const matches = patterns.filter(([, pattern]) => pattern.test(name));
    return matches.length === 1 ? getDocumentType(matches[0][0]) : null;
}

// Check the central directory before JSZip allocates entries or inflates content.
export function validateZipDirectory(buffer) {
    if (!buffer.byteLength || buffer.byteLength > BULK_LIMITS.archiveBytes) throw new Error('Choose a nonempty ZIP no larger than 50 MB.');
    const view = new DataView(buffer);
    let end = -1;
    for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset--) {
        if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === buffer.byteLength) { end = offset; break; }
    }
    if (end < 0) throw new Error('The ZIP directory is invalid or incomplete.');
    const count = view.getUint16(end + 10, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count === 0xffff || count > BULK_LIMITS.entries) throw new Error('Use a standard single-part ZIP with at most 500 entries. ZIP64 is not supported.');
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
        if (size > BULK_LIMITS.fileBytes || compressedSize > BULK_LIMITS.archiveBytes || total > BULK_LIMITS.totalBytes) throw new Error('ZIP contents exceed the limits: 15 MB per file and 150 MB total.');
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
            if (size > BULK_LIMITS.fileBytes) return finish(new Error('Expanded file exceeds 15 MB.'));
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

/**
 * High-performance parallel directory traversal for Drag-and-Drop folders.
 * Uses WebKit/Blink FileSystemEntry API with chunked reader polling (100 entries/chunk).
 */
export async function extractFilesFromDataTransfer(dataTransfer, { signal } = {}) {
    const items = dataTransfer?.items;
    const filesWithPaths = [];

    if (items && items.length > 0) {
        const queue = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind !== 'file') continue;

            const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
            if (entry) {
                queue.push(traverseFileSystemEntry(entry, '', signal));
            } else {
                const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
                if (file) filesWithPaths.push({ file, path: file.name });
            }
        }
        const results = await Promise.all(queue);
        for (const list of results) {
            filesWithPaths.push(...list);
        }
        return filesWithPaths;
    }

    const rawFiles = dataTransfer?.files ? Array.from(dataTransfer.files) : [];
    return rawFiles.map(file => ({
        file,
        path: file.webkitRelativePath || file.name
    }));
}

async function traverseFileSystemEntry(entry, parentPath = '', signal) {
    signal?.throwIfAborted();
    if (!entry) return [];

    if (entry.isFile) {
        return new Promise((resolve) => {
            entry.file(
                (file) => {
                    const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
                    resolve([{ file, path: relativePath }]);
                },
                (err) => {
                    console.warn('[FOLDER_SCAN] Skipped unreadable entry:', err);
                    resolve([]);
                }
            );
        });
    }

    if (entry.isDirectory) {
        const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        const dirReader = entry.createReader();
        const collectedEntries = [];

        // Poll dirReader.readEntries until it returns empty array (Blink/WebKit batch limit: 100)
        const readEntriesChunk = () => {
            return new Promise((resolve) => {
                dirReader.readEntries(
                    (entries) => {
                        if (!entries || entries.length === 0) {
                            resolve(collectedEntries);
                        } else {
                            collectedEntries.push(...entries);
                            readEntriesChunk().then(resolve);
                        }
                    },
                    (err) => {
                        console.warn('[FOLDER_SCAN] Error traversing directory:', err);
                        resolve(collectedEntries);
                    }
                );
            });
        };

        const allEntries = await readEntriesChunk();
        signal?.throwIfAborted();

        const subResults = await Promise.all(
            allEntries.map(child => traverseFileSystemEntry(child, currentPath, signal))
        );
        return subResults.flat();
    }

    return [];
}

/**
 * Builds table rows directly from native File handles (from folder upload or multi-file selection).
 * Ultra-low latency: zero decompression latency and direct memory pointer reuse.
 */
export function buildImportRowsFromFiles(filesWithPaths, categories) {
    const rows = [];
    const names = new Set();
    const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const item of filesWithPaths) {
        const file = item.file || item;
        const relativePath = item.path || file.webkitRelativePath || file.name;
        const parts = relativePath.split('/').filter(Boolean);
        const fileName = parts.at(-1) || file.name;

        // Skip OS artifacts & temporary metadata
        if (!fileName || parts.some(part => part === '__MACOSX' || part.startsWith('.')) || ['thumbs.db', 'desktop.ini', '.ds_store'].includes(fileName.toLowerCase())) {
            continue;
        }

        const extension = fileName.split('.').pop().toLowerCase();
        let blocked = null;
        if (!BULK_EXTENSIONS.has(extension)) {
            blocked = 'Unsupported upload format.';
        } else if (file.size > BULK_LIMITS.fileBytes) {
            blocked = `File exceeds ${(BULK_LIMITS.fileBytes / (1024 * 1024)).toFixed(0)} MB limit.`;
        }

        const duplicate = names.has(fileName.toLowerCase());
        names.add(fileName.toLowerCase());

        const hint = filenameDocumentHint(fileName);
        const folderCategory = parts.slice(0, -1).reverse().map(segment => categories.find(value => normalize(value) === normalize(segment))).find(Boolean);
        const category = hint?.category || folderCategory || 'Other';

        rows.push({
            id: crypto.randomUUID(),
            importId: crypto.randomUUID(),
            zipPath: relativePath,
            fileName,
            entry: null,
            file,
            size: file.size,
            category,
            title: hint?.label || fileName.replace(/\.[^/.]+$/, '').slice(0, 200),
            documentType: hint?.id || 'unknown',
            expiryDate: '',
            include: !blocked && !duplicate,
            confirmed: false,
            revision: 0,
            attempted: false,
            status: 'idle',
            analysisStatus: 'idle',
            classification: hint ? {
                source: 'filename',
                confidence: 'low',
                document_type: hint.id,
                evidence: [],
                message: 'Filename hint only. Analyze or preview the contents before confirming.'
            } : null,
            blocked,
            duplicate,
            error: null
        });
    }

    if (!rows.length) throw new Error('No valid personnel documents were found in the selected folder.');
    if (rows.length > BULK_LIMITS.files) throw new Error(`Import at most ${BULK_LIMITS.files} files at once.`);
    return rows;
}

export function buildImportRows(entries, categories) {
    const rows = [];
    const names = new Set();
    const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const entry of entries) {
        if (entry.dir) continue;
        const parts = entry.name.split('/').filter(Boolean);
        const fileName = parts.at(-1);
        if (!fileName || parts.some(part => part === '__MACOSX' || part.startsWith('.')) || ['thumbs.db', 'desktop.ini', '.ds_store'].includes(fileName.toLowerCase())) continue;
        const extension = fileName.split('.').pop().toLowerCase();
        const blocked = !BULK_EXTENSIONS.has(extension) ? 'Unsupported upload format.' : null;
        const duplicate = names.has(fileName.toLowerCase());
        names.add(fileName.toLowerCase());
        const hint = filenameDocumentHint(fileName);
        const category = hint?.category || parts.slice(0, -1).reverse().map(segment => categories.find(value => normalize(value) === normalize(segment))).find(Boolean) || 'Other';
        rows.push({
            id: crypto.randomUUID(),
            importId: crypto.randomUUID(),
            zipPath: entry.name,
            fileName,
            entry,
            file: null,
            size: entry._data?.uncompressedSize || 0,
            category,
            title: hint?.label || fileName.slice(0, 200),
            documentType: hint?.id || 'unknown',
            expiryDate: '',
            include: !blocked && !duplicate,
            confirmed: false,
            revision: 0,
            attempted: false,
            status: 'idle',
            analysisStatus: 'idle',
            classification: hint ? {
                source: 'filename',
                confidence: 'low',
                document_type: hint.id,
                evidence: [],
                message: 'Filename hint only. Analyze or preview the contents before confirming.'
            } : null,
            blocked,
            duplicate,
            error: null
        });
    }
    if (!rows.length) throw new Error('No personnel files were found in the ZIP.');
    if (rows.length > BULK_LIMITS.files) throw new Error(`Import at most ${BULK_LIMITS.files} files per ZIP.`);
    return rows;
}

export function applyContentSuggestion(row, classification, revision) {
    // A late AI response must never overwrite a reviewer edit or confirmation.
    const result = { ...row, classification, analysisStatus: classification.source === 'manual' ? 'error' : 'done', error: classification.source === 'manual' ? classification.message : null };
    if (row.revision !== revision || row.confirmed || row.status === 'success' || !['content', 'content_vision', 'digital_pdf_stream'].includes(classification.source)) return result;
    const type = getDocumentType(classification.document_type);
    return { ...result, documentType: type.id, category: type.category, title: classification.suggested_title || row.title, expiryDate: classification.expiry_date || row.expiryDate };
}

export const canImportRow = row => row.include && !row.blocked && row.confirmed && Boolean(row.title.trim()) && row.title.trim().length <= 200 && row.status !== 'success';

export async function optimizeDocumentImageForAI(file, maxDimension = 1600, quality = 0.82, { signal } = {}) {
    signal?.throwIfAborted();
    if (!/^image\/(?:jpeg|png|webp)$/.test(file.type)) return file;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return compressDocumentImage(file, maxDimension, quality);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./documentImage.worker.js', import.meta.url), { type: 'module' });
        let settled = false;
        const finish = (error, result = file) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            worker.terminate();
            if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(signal.reason);
        const timer = setTimeout(() => finish(null), 5000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = event => finish(null, event.data);
        worker.onerror = () => finish(null);
        worker.postMessage({ file, maxDimension, quality });
        if (signal?.aborted) abort();
    });
}
