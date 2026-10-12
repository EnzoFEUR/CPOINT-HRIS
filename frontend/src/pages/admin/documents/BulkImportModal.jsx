import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { classifyEmployeeDocument, uploadEmployeeDocument } from '../../../utils/documentApi';
import { getDocumentMimeType, isImageDocument, isPdfDocument, formatDocumentSize } from '../../../utils/documentUtils';
import { applyContentSuggestion, buildImportRows, BULK_LIMITS, canImportRow, extractZipEntry, validateZipDirectory } from '../../../utils/bulkDocumentImport';
import { DOCUMENT_TYPES, getDocumentType } from '../../../../../shared/documentTypes.mjs';

const EVIDENCE_LABELS = { agency_name: 'Agency wording', document_heading: 'Document heading', form_code: 'Form code', logo: 'Logo', layout: 'Layout' };

export default function BulkImportModal({ isOpen, onClose, employeeId, employeeName, isTerminated, categories, onImported }) {
    const [rows, setRows] = useState([]);
    const [isParsing, setIsParsing] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [filterTab, setFilterTab] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [thumbnails, setThumbnails] = useState({});

    // Lightbox preview state
    const [preview, setPreview] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);

    const rowsRef = useRef([]);
    const jobRef = useRef({ epoch: 0, controller: null, busy: false });
    const previewRef = useRef({ epoch: 0, controller: null, url: null });
    const thumbnailsRef = useRef({});
    const pdfUrlsRef = useRef({});
    const dialogRef = useRef(null);

    // Cleanup all blob object URLs on unmount
    useEffect(() => () => {
        jobRef.current.epoch++;
        jobRef.current.controller?.abort();
        previewRef.current.epoch++;
        previewRef.current.controller?.abort();
        if (previewRef.current.url) URL.revokeObjectURL(previewRef.current.url);
        Object.values(thumbnailsRef.current).forEach(url => URL.revokeObjectURL(url));
        thumbnailsRef.current = {};
        Object.values(pdfUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
        pdfUrlsRef.current = {};
    }, []);

    const replaceRows = nextRows => {
        rowsRef.current = nextRows;
        setRows(nextRows);
    };

    const updateRow = (id, patch) => {
        replaceRows(rowsRef.current.map(row => (
            row.id === id ? (typeof patch === 'function' ? patch(row) : { ...row, ...patch }) : row
        )));
    };

    const closePreview = () => {
        previewRef.current.epoch++;
        previewRef.current.controller?.abort();
        if (previewRef.current.url && !Object.values(thumbnailsRef.current).includes(previewRef.current.url) && !Object.values(pdfUrlsRef.current).includes(previewRef.current.url)) {
            URL.revokeObjectURL(previewRef.current.url);
        }
        previewRef.current.url = null;
        setPreview(null);
        setZoom(1);
        setRotation(0);
    };

    const resetAll = () => {
        jobRef.current.epoch++;
        jobRef.current.controller?.abort();
        jobRef.current.busy = false;
        closePreview();
        Object.values(thumbnailsRef.current).forEach(url => URL.revokeObjectURL(url));
        thumbnailsRef.current = {};
        Object.values(pdfUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
        pdfUrlsRef.current = {};
        setThumbnails({});
        replaceRows([]);
        setIsParsing(false);
        setIsAnalyzing(false);
        setSearchQuery('');
        setFilterTab('all');
    };

    const handleClose = () => {
        if (isCommitting) return;
        resetAll();
        onClose();
    };

    // Keyboard navigation
    const handleDialogKey = useEffectEvent(event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (preview) closePreview();
            else handleClose();
            return;
        }

        if (preview) {
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                navigatePreview(-1);
                return;
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                navigatePreview(1);
                return;
            }
        }

        if (event.key !== 'Tab') return;
        const scope = dialogRef.current?.querySelector('[data-preview]') || dialogRef.current;
        const focusable = scope?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], iframe');
        if (!focusable?.length) { event.preventDefault(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
            event.preventDefault();
            first.focus();
        }
    });

    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement;
        dialogRef.current?.focus();
        const listener = event => handleDialogKey(event);
        document.addEventListener('keydown', listener);
        return () => {
            document.removeEventListener('keydown', listener);
            previous?.focus();
        };
    }, [isOpen]);

    const editRow = (id, patch) => updateRow(id, row => ({
        ...row,
        ...patch,
        confirmed: row.attempted ? row.confirmed : false,
        revision: row.revision + 1,
    }));

    const makeFile = async (row, signal) => {
        const bytes = await extractZipEntry(row.entry, { signal });
        return new File([bytes], row.fileName, { type: getDocumentMimeType(row.fileName) });
    };

    // Asynchronous thumbnail generator for instant visual previews
    const generateImageThumbnails = async (newRows) => {
        const imageRows = newRows.filter(r => isImageDocument(r.fileName) && !thumbnailsRef.current[r.id]);
        const BATCH_SIZE = 4;
        for (let i = 0; i < imageRows.length; i += BATCH_SIZE) {
            const batch = imageRows.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (row) => {
                try {
                    const bytes = await extractZipEntry(row.entry);
                    const mime = getDocumentMimeType(row.fileName);
                    const blob = new Blob([bytes], { type: mime });
                    const url = URL.createObjectURL(blob);
                    thumbnailsRef.current[row.id] = url;
                    setThumbnails(prev => ({ ...prev, [row.id]: url }));
                } catch (e) {
                    console.warn('Failed to load thumbnail for', row.fileName, e);
                }
            }));
        }
    };

    const handleFileSelected = async file => {
        if (!file || jobRef.current.busy) return;
        if (file.size > BULK_LIMITS.archiveBytes) return toast.error('Choose a ZIP no larger than 25 MB.');
        resetAll();
        const epoch = jobRef.current.epoch;
        jobRef.current.busy = true;
        setIsParsing(true);
        try {
            const bytes = await file.arrayBuffer();
            if (epoch !== jobRef.current.epoch) return;
            validateZipDirectory(bytes);
            const zip = await JSZip.loadAsync(bytes);
            if (epoch !== jobRef.current.epoch) return;
            const newRows = buildImportRows(Object.values(zip.files), categories);
            replaceRows(newRows);
            generateImageThumbnails(newRows);
        } catch (error) {
            if (epoch === jobRef.current.epoch) toast.error(error.message || 'Could not read the ZIP archive.');
        } finally {
            if (epoch === jobRef.current.epoch) {
                setIsParsing(false);
                jobRef.current.busy = false;
            }
        }
    };

    const analyzeContents = async () => {
        if (jobRef.current.busy || isTerminated) return;
        const selected = rowsRef.current.filter(row => row.include && !row.blocked && !row.confirmed && !row.attempted && row.status !== 'success');
        if (!selected.length) return;
        const epoch = ++jobRef.current.epoch;
        const controller = new AbortController();
        jobRef.current.controller = controller;
        jobRef.current.busy = true;
        setIsAnalyzing(true);
        replaceRows(rowsRef.current.map(row => selected.some(item => item.id === row.id) ? { ...row, analysisStatus: 'queued', error: null } : row));
        let index = 0;
        const worker = async () => {
            while (index < selected.length && !controller.signal.aborted && epoch === jobRef.current.epoch) {
                const row = selected[index++];
                if (!rowsRef.current.find(item => item.id === row.id)?.include) {
                    updateRow(row.id, { analysisStatus: 'idle' });
                    continue;
                }
                updateRow(row.id, { analysisStatus: 'analyzing' });
                try {
                    const file = await makeFile(row, controller.signal);
                    const classification = await classifyEmployeeDocument({ employeeId, file, signal: controller.signal });
                    if (epoch === jobRef.current.epoch && !controller.signal.aborted) {
                        updateRow(row.id, current => applyContentSuggestion(current, classification, row.revision));
                    }
                } catch (error) {
                    if (epoch === jobRef.current.epoch && !controller.signal.aborted) {
                        updateRow(row.id, { analysisStatus: 'error', error: error.message || 'Analysis failed. Classify manually.' });
                    }
                }
            }
        };
        try {
            await Promise.all([worker(), worker()]);
        } finally {
            if (epoch === jobRef.current.epoch) {
                replaceRows(rowsRef.current.map(row => ['queued', 'analyzing'].includes(row.analysisStatus) ? { ...row, analysisStatus: 'idle' } : row));
                setIsAnalyzing(false);
                jobRef.current.busy = false;
                jobRef.current.controller = null;
            }
        }
    };

    const openPreview = async row => {
        closePreview();
        const epoch = previewRef.current.epoch;
        const controller = new AbortController();
        previewRef.current.controller = controller;

        // Fast path: cached image thumbnail
        if (thumbnailsRef.current[row.id]) {
            setPreview({ row, name: row.fileName, url: thumbnailsRef.current[row.id], mime: getDocumentMimeType(row.fileName), loading: false });
            return;
        }

        // Fast path: cached PDF url
        if (pdfUrlsRef.current[row.id]) {
            setPreview({ row, name: row.fileName, url: pdfUrlsRef.current[row.id], mime: 'application/pdf', loading: false });
            return;
        }

        setPreview({ row, name: row.fileName, loading: true });
        try {
            const file = await makeFile(row, controller.signal);
            if (epoch !== previewRef.current.epoch || controller.signal.aborted) return;
            const url = URL.createObjectURL(file);
            if (isPdfDocument(row.fileName)) {
                pdfUrlsRef.current[row.id] = url;
            } else if (isImageDocument(row.fileName)) {
                thumbnailsRef.current[row.id] = url;
                setThumbnails(prev => ({ ...prev, [row.id]: url }));
            } else {
                previewRef.current.url = url;
            }
            setPreview({ row, name: row.fileName, url, mime: file.type, loading: false });
        } catch (error) {
            if (epoch === previewRef.current.epoch && !controller.signal.aborted) {
                setPreview({ row, name: row.fileName, error: error.message, loading: false });
            }
        }
    };

    const navigatePreview = (direction) => {
        if (!preview?.row) return;
        const list = displayedRows.length > 0 ? displayedRows : rows;
        const currentIndex = list.findIndex(r => r.id === preview.row.id);
        const nextIndex = currentIndex + direction;
        if (nextIndex >= 0 && nextIndex < list.length) {
            openPreview(list[nextIndex]);
        }
    };

    const handleConfirmAndNext = (row) => {
        if (!row) return;
        updateRow(row.id, current => ({ ...current, confirmed: true, revision: current.revision + 1 }));
        toast.success(`Confirmed "${row.title}"`);
        navigatePreview(1);
    };

    const commit = async () => {
        if (jobRef.current.busy || isTerminated || !employeeId) return;
        const selected = rowsRef.current.filter(row => row.include && !row.blocked && row.status !== 'success');
        if (!selected.length || selected.some(row => !canImportRow(row))) {
            return toast.error('Confirm all selected files before importing.');
        }
        const epoch = ++jobRef.current.epoch;
        jobRef.current.busy = true;
        setIsCommitting(true);
        closePreview();
        let saved = 0;
        try {
            for (const row of selected) {
                if (epoch !== jobRef.current.epoch) break;
                updateRow(row.id, { status: 'uploading', attempted: true, error: null });
                try {
                    const file = await makeFile(row);
                    await uploadEmployeeDocument({
                        employeeId,
                        file,
                        title: row.title,
                        category: row.category,
                        expiryDate: row.expiryDate,
                        bulkReview: { confirmed: row.confirmed, documentType: row.documentType, importId: row.importId },
                    });
                    saved++;
                    if (epoch === jobRef.current.epoch) updateRow(row.id, { status: 'success' });
                } catch (error) {
                    if (epoch === jobRef.current.epoch) {
                        updateRow(row.id, {
                            status: 'error',
                            attempted: ![400, 403, 404].includes(error.status),
                            error: error.message || 'Import failed.',
                        });
                    }
                }
            }
            if (epoch === jobRef.current.epoch) {
                if (saved) toast.success(`${saved} document${saved === 1 ? '' : 's'} imported for review.`);
                else toast.error('No documents were imported. Review errors before retrying.');
            }
        } finally {
            if (epoch === jobRef.current.epoch) {
                setIsCommitting(false);
                jobRef.current.busy = false;
            }
            if (saved) {
                try { await onImported?.(); }
                catch { toast.error('Documents saved, but vault view could not refresh.'); }
            }
        }
    };

    // Quick batch actions
    const handleConfirmAllValid = () => {
        const eligible = rows.filter(r => r.include && !r.blocked && !r.confirmed && Boolean(r.title?.trim()) && r.status !== 'success');
        if (!eligible.length) {
            return toast('All eligible files are already confirmed.');
        }
        replaceRows(rows.map(r => {
            if (r.include && !r.blocked && !r.confirmed && Boolean(r.title?.trim()) && r.status !== 'success') {
                return { ...r, confirmed: true, revision: r.revision + 1 };
            }
            return r;
        }));
        toast.success(`Confirmed all ${eligible.length} valid documents.`);
    };

    const isAllSelected = useMemo(() => {
        const selectable = rows.filter(r => !r.blocked && r.status !== 'success');
        return selectable.length > 0 && selectable.every(r => r.include);
    }, [rows]);

    const handleToggleSelectAll = () => {
        const nextVal = !isAllSelected;
        replaceRows(rows.map(r => {
            if (!r.blocked && r.status !== 'success') {
                return { ...r, include: nextVal, confirmed: nextVal ? r.confirmed : false, revision: r.revision + 1 };
            }
            return r;
        }));
    };

    const counts = useMemo(() => {
        const selected = rows.filter(row => row.include && !row.blocked && row.status !== 'success');
        return {
            total: rows.length,
            selected: selected.length,
            ready: selected.filter(canImportRow).length,
            unconfirmed: selected.filter(r => !r.confirmed).length,
            uploaded: rows.filter(row => row.status === 'success').length,
            failed: rows.filter(row => row.status === 'error').length,
            analyzed: rows.filter(row => ['done', 'error'].includes(row.analysisStatus)).length,
            analyzable: selected.filter(row => !row.confirmed && !row.attempted).length,
        };
    }, [rows]);

    // Filtered rows for the table
    const displayedRows = useMemo(() => {
        return rows.filter(row => {
            if (filterTab === 'needs_review' && (row.confirmed || !row.include || row.blocked || row.status === 'success')) return false;
            if (filterTab === 'ready' && !canImportRow(row)) return false;
            if (filterTab === 'errors' && row.status !== 'error' && !row.error && !row.blocked) return false;
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchName = row.fileName.toLowerCase().includes(q);
                const matchTitle = (row.title || '').toLowerCase().includes(q);
                const matchType = (row.documentType || '').toLowerCase().includes(q);
                if (!matchName && !matchTitle && !matchType) return false;
            }
            return true;
        });
    }, [rows, filterTab, searchQuery]);

    if (!isOpen) return null;

    const importDisabled = isAnalyzing || isCommitting || isTerminated || !employeeId || !counts.selected || counts.ready !== counts.selected;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity" onClick={handleClose} />

            {/* Modal Dialog */}
            <section
                ref={dialogRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="bulk-import-title"
                className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl text-ink"
            >
                {/* Header */}
                <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 bg-surface shrink-0">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <h2 id="bulk-import-title" className="text-sm sm:text-base font-semibold text-ink truncate">
                                Review and Import Documents
                            </h2>
                            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-surface-muted text-ink-muted border border-line">
                                Target: {employeeName || employeeId || 'Employee Vault'}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {rows.length > 0 && (
                            <button
                                type="button"
                                disabled={isCommitting || isAnalyzing}
                                onClick={resetAll}
                                className="h-8 px-2.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted rounded-md border border-line transition-colors cursor-pointer"
                                title="Clear archive and start over"
                            >
                                <i className="ti ti-rotate-2 text-xs mr-1" />
                                <span>Reset</span>
                            </button>
                        )}
                        <button
                            type="button"
                            aria-label="Close bulk import"
                            disabled={isCommitting}
                            onClick={handleClose}
                            className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted rounded-md border border-transparent hover:border-line transition-colors cursor-pointer"
                        >
                            <i className="ti ti-x text-sm" />
                        </button>
                    </div>
                </header>

                {/* Real-time Progress Bar */}
                {(isAnalyzing || isCommitting) && (
                    <div className="px-5 py-2.5 bg-surface-muted/60 border-b border-line shrink-0">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="font-medium text-ink flex items-center gap-2">
                                <i className={`ti ${isAnalyzing ? 'ti-sparkles text-accent' : 'ti-cloud-upload text-accent'} animate-pulse`} />
                                {isAnalyzing ? 'Analyzing documents with Gemini AI...' : 'Uploading verified documents...'}
                            </span>
                            <span className="font-mono text-ink-muted text-[11px]">
                                {isAnalyzing ? `${counts.analyzed} of ${rows.length} analyzed` : `${counts.uploaded} of ${counts.selected} imported`}
                            </span>
                        </div>
                        <div className="w-full bg-line rounded-full h-1.5 overflow-hidden">
                            <div
                                className="bg-accent h-1.5 rounded-full transition-all duration-300"
                                style={{
                                    width: `${isAnalyzing ? Math.round((counts.analyzed / Math.max(rows.length, 1)) * 100) : Math.round((counts.uploaded / Math.max(counts.selected, 1)) * 100)}%`
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0 bg-canvas/30">
                    {isTerminated && (
                        <div role="alert" className="mb-4 rounded-lg border border-warning/30 bg-warning-subtle p-3 text-xs text-warning-ink flex items-center gap-2">
                            <i className="ti ti-alert-triangle text-base shrink-0" />
                            <span>This employee is marked as terminated. Document imports and additions are locked.</span>
                        </div>
                    )}

                    {!rows.length ? (
                        /* Empty State & Upload Dropzone */
                        <div
                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={e => {
                                e.preventDefault();
                                setIsDragging(false);
                                const file = e.dataTransfer?.files?.[0];
                                if (file) handleFileSelected(file);
                            }}
                            className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors duration-150 flex flex-col items-center justify-center min-h-[340px] ${
                                isDragging ? 'border-accent bg-accent-subtle/30' : 'border-line hover:border-line-strong bg-surface'
                            }`}
                        >
                            <div className="w-14 h-14 rounded-full bg-accent-subtle text-accent flex items-center justify-center mb-3.5 shadow-2xs">
                                <i className="ti ti-file-zip text-2xl" />
                            </div>
                            <h3 className="text-sm font-semibold text-ink">
                                Choose or drop a ZIP archive of personnel documents
                            </h3>
                            <p className="mt-1 text-xs text-ink-muted max-w-md">
                                Files are automatically extracted and unpacked locally in your browser. Nothing is uploaded until you inspect and confirm.
                            </p>

                            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px] text-ink-subtle">
                                <span className="px-2 py-0.5 rounded bg-surface-muted border border-line">Max 25 MB archive</span>
                                <span className="px-2 py-0.5 rounded bg-surface-muted border border-line">Up to 100 documents</span>
                                <span className="px-2 py-0.5 rounded bg-surface-muted border border-line">PDF, JPG, PNG, WebP, DOCX</span>
                            </div>

                            <label className="mt-6 inline-flex items-center gap-2 cursor-pointer rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover transition-colors shadow-2xs">
                                <i className={`ti ${isParsing ? 'ti-loader animate-spin' : 'ti-upload'} text-sm`} />
                                <span>{isParsing ? 'Unpacking archive…' : 'Select ZIP Archive'}</span>
                                <input
                                    type="file"
                                    accept=".zip,application/zip"
                                    disabled={isParsing || isTerminated || !employeeId}
                                    className="sr-only"
                                    onChange={event => {
                                        handleFileSelected(event.target.files?.[0]);
                                        event.target.value = '';
                                    }}
                                />
                            </label>
                        </div>
                    ) : (
                        /* Active Batch Management View */
                        <div className="space-y-3.5">
                            {/* Command & Filter Bar */}
                            <div className="flex flex-wrap items-center justify-between gap-2.5 bg-surface p-2.5 rounded-lg border border-line shadow-2xs">
                                {/* Filter Tabs */}
                                <div className="flex items-center gap-1 overflow-x-auto">
                                    <button
                                        type="button"
                                        onClick={() => setFilterTab('all')}
                                        className={`h-7 px-2.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                            filterTab === 'all' ? 'bg-surface-muted text-ink font-semibold border border-line' : 'text-ink-muted hover:text-ink'
                                        }`}
                                    >
                                        <span>All</span>
                                        <span className="text-[10px] px-1 rounded-full bg-canvas text-ink-subtle">{rows.length}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFilterTab('needs_review')}
                                        className={`h-7 px-2.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                            filterTab === 'needs_review' ? 'bg-warning-subtle text-warning-ink font-semibold border border-warning/30' : 'text-ink-muted hover:text-ink'
                                        }`}
                                    >
                                        <span>Needs Review</span>
                                        <span className="text-[10px] px-1 rounded-full bg-surface text-warning-ink font-semibold">{counts.unconfirmed}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFilterTab('ready')}
                                        className={`h-7 px-2.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                            filterTab === 'ready' ? 'bg-success-subtle text-success-ink font-semibold border border-success/30' : 'text-ink-muted hover:text-ink'
                                        }`}
                                    >
                                        <span>Ready</span>
                                        <span className="text-[10px] px-1 rounded-full bg-surface text-success-ink font-semibold">{counts.ready}</span>
                                    </button>
                                    {counts.failed > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setFilterTab('errors')}
                                            className={`h-7 px-2.5 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                                                filterTab === 'errors' ? 'bg-danger-subtle text-danger-ink font-semibold border border-danger/30' : 'text-ink-muted hover:text-ink'
                                            }`}
                                        >
                                            <span>Errors</span>
                                            <span className="text-[10px] px-1 rounded-full bg-surface text-danger-ink font-semibold">{counts.failed}</span>
                                        </button>
                                    )}
                                </div>

                                {/* Right Actions: Search & AI Trigger & Batch Confirm */}
                                <div className="flex items-center gap-2 ml-auto">
                                    <div className="relative">
                                        <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-subtle pointer-events-none" />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            placeholder="Filter files…"
                                            className="h-7 pl-7 pr-2 text-xs bg-surface-muted/50 border border-line rounded-md text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-accent outline-none w-36 sm:w-44"
                                        />
                                    </div>

                                    <button
                                        type="button"
                                        disabled={isCommitting || isAnalyzing || isTerminated || !counts.analyzable}
                                        onClick={analyzeContents}
                                        className="h-7 px-2.5 rounded-md text-xs font-medium bg-accent-subtle text-accent hover:bg-accent/15 border border-accent/20 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Send document pages to AI classifier to suggest document type and title"
                                    >
                                        <i className={`ti ${isAnalyzing ? 'ti-loader animate-spin' : 'ti-sparkles'} text-xs`} />
                                        <span>{isAnalyzing ? 'Analyzing…' : 'Analyze'}</span>
                                    </button>
                                    {isAnalyzing && (
                                        <button
                                            type="button"
                                            onClick={() => jobRef.current.controller?.abort()}
                                            className="h-7 px-2 rounded-md text-xs text-danger-ink bg-danger-subtle hover:bg-danger/20 border border-danger/30 transition-colors cursor-pointer"
                                        >
                                            Stop
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        disabled={isCommitting || isAnalyzing || counts.unconfirmed === 0}
                                        onClick={handleConfirmAllValid}
                                        className="h-7 px-2.5 rounded-md text-xs font-medium bg-surface text-ink hover:bg-surface-muted border border-line transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Confirm all files with valid titles at once"
                                    >
                                        <i className="ti ti-check-double text-xs text-success-ink" />
                                        <span className="hidden sm:inline">Confirm All</span>
                                    </button>
                                </div>
                            </div>

                            {/* Data Table */}
                            <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-2xs">
                                <table className="w-full min-w-[900px] text-left text-xs">
                                    <thead className="bg-surface-muted text-ink-muted border-b border-line">
                                        <tr>
                                            <th className="w-10 p-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    aria-label="Select or deselect all documents"
                                                    checked={isAllSelected}
                                                    disabled={isCommitting || !rows.length}
                                                    onChange={handleToggleSelectAll}
                                                    className="rounded border-line text-accent cursor-pointer"
                                                />
                                            </th>
                                            <th className="w-64 p-3 font-semibold">Document & Preview</th>
                                            <th className="p-3 font-semibold">Classification & Details</th>
                                            <th className="w-56 p-3 font-semibold">AI Detection</th>
                                            <th className="w-40 p-3 text-right font-semibold">Verification</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {displayedRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="p-8 text-center text-ink-muted">
                                                    No documents match the current filter or search criteria.
                                                </td>
                                            </tr>
                                        ) : displayedRows.map(row => {
                                            const frozen = isCommitting || row.attempted || row.status === 'success';
                                            const classification = row.classification;
                                            const analyzing = ['queued', 'analyzing'].includes(row.analysisStatus);
                                            const isImage = isImageDocument(row.fileName);
                                            const isPdf = isPdfDocument(row.fileName);
                                            const thumbUrl = thumbnails[row.id];
                                            const uncompressedSize = row.entry?._data?.uncompressedSize;

                                            return (
                                                <tr
                                                    key={row.id}
                                                    className={`transition-colors duration-100 ${
                                                        !row.include ? 'bg-surface-muted/30 opacity-70' : row.status === 'success' ? 'bg-success-subtle/20' : 'hover:bg-surface-muted/20'
                                                    }`}
                                                >
                                                    {/* Checkbox */}
                                                    <td className="p-3 text-center align-top pt-3.5">
                                                        <input
                                                            type="checkbox"
                                                            aria-label={`Include ${row.fileName}`}
                                                            checked={row.include}
                                                            disabled={isCommitting || !!row.blocked || row.status === 'success'}
                                                            onChange={event => editRow(row.id, { include: event.target.checked })}
                                                            className="rounded border-line text-accent cursor-pointer"
                                                        />
                                                    </td>

                                                    {/* Document Preview & File Info */}
                                                    <td className="p-3 align-top">
                                                        <div className="flex items-start gap-3">
                                                            {/* Thumbnail Box */}
                                                            <div
                                                                onClick={() => !isCommitting && !row.blocked && openPreview(row)}
                                                                title="Click to view full preview"
                                                                className={`w-14 h-14 rounded-md border border-line bg-surface-muted overflow-hidden shrink-0 flex items-center justify-center relative group cursor-pointer transition-transform duration-100 active:scale-95 shadow-2xs ${
                                                                    row.blocked ? 'cursor-not-allowed opacity-50' : ''
                                                                }`}
                                                            >
                                                                {isImage && thumbUrl ? (
                                                                    <img
                                                                        src={thumbUrl}
                                                                        alt={row.fileName}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                ) : isPdf ? (
                                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-rose-50 text-rose-600">
                                                                        <i className="ti ti-file-text text-xl" />
                                                                        <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">PDF</span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-sky-50 text-sky-600">
                                                                        <i className="ti ti-file-description text-xl" />
                                                                        <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                                                                            {row.fileName.split('.').pop()?.slice(0, 4) || 'DOC'}
                                                                        </span>
                                                                    </div>
                                                                )}

                                                                {/* Hover Zoom Overlay */}
                                                                <div className="absolute inset-0 bg-slate-950/40 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                                    <i className="ti ti-zoom-in text-sm" />
                                                                </div>
                                                            </div>

                                                            {/* File Metadata */}
                                                            <div className="min-w-0 flex-1">
                                                                <p
                                                                    className="font-medium text-ink truncate cursor-pointer hover:text-accent"
                                                                    title={row.fileName}
                                                                    onClick={() => !isCommitting && !row.blocked && openPreview(row)}
                                                                >
                                                                    {row.fileName}
                                                                </p>
                                                                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-subtle">
                                                                    <span className="uppercase font-mono font-medium">
                                                                        {row.fileName.split('.').pop()}
                                                                    </span>
                                                                    {uncompressedSize && (
                                                                        <>
                                                                            <span>·</span>
                                                                            <span>{formatDocumentSize(uncompressedSize)}</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    disabled={isCommitting || !!row.blocked}
                                                                    onClick={() => openPreview(row)}
                                                                    className="mt-1 text-[11px] font-medium text-accent hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                                                >
                                                                    <i className="ti ti-eye text-xs" />
                                                                    <span>Preview file</span>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {row.duplicate && (
                                                            <p className="mt-1.5 text-[11px] text-warning-ink bg-warning-subtle px-2 py-0.5 rounded border border-warning/20">
                                                                Repeated filename; excluded by default.
                                                            </p>
                                                        )}
                                                        {row.blocked && (
                                                            <p className="mt-1.5 text-[11px] text-danger-ink bg-danger-subtle px-2 py-0.5 rounded border border-danger/20">
                                                                {row.blocked}
                                                            </p>
                                                        )}
                                                    </td>

                                                    {/* Document Form Fields (2x2 Grid) */}
                                                    <td className="p-3 align-top">
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                            {/* Document Type */}
                                                            <div>
                                                                <label className="block text-[10px] font-medium text-ink-subtle uppercase mb-0.5">
                                                                    Doc Type
                                                                </label>
                                                                <select
                                                                    aria-label={`Document type for ${row.fileName}`}
                                                                    disabled={frozen || !!row.blocked}
                                                                    value={row.documentType}
                                                                    onChange={event => {
                                                                        const type = getDocumentType(event.target.value);
                                                                        editRow(row.id, {
                                                                            documentType: type.id,
                                                                            category: type.category,
                                                                            title: type.id === 'unknown' ? row.fileName.slice(0, 200) : type.label
                                                                        });
                                                                    }}
                                                                    className="w-full h-8 px-2 py-1 text-xs bg-surface border border-line rounded-md text-ink focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none disabled:bg-surface-muted disabled:text-ink-subtle"
                                                                >
                                                                    {DOCUMENT_TYPES.map(type => (
                                                                        <option key={type.id} value={type.id}>{type.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Category */}
                                                            <div>
                                                                <label className="block text-[10px] font-medium text-ink-subtle uppercase mb-0.5">
                                                                    Category
                                                                </label>
                                                                <select
                                                                    aria-label={`Category for ${row.fileName}`}
                                                                    disabled={frozen || !!row.blocked}
                                                                    value={row.category}
                                                                    onChange={event => editRow(row.id, { category: event.target.value })}
                                                                    className="w-full h-8 px-2 py-1 text-xs bg-surface border border-line rounded-md text-ink focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none disabled:bg-surface-muted disabled:text-ink-subtle"
                                                                >
                                                                    {categories.map(category => (
                                                                        <option key={category} value={category}>{category}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Title */}
                                                            <div>
                                                                <label className="block text-[10px] font-medium text-ink-subtle uppercase mb-0.5">
                                                                    Title
                                                                </label>
                                                                <input
                                                                    aria-label={`Title for ${row.fileName}`}
                                                                    maxLength={200}
                                                                    disabled={frozen || !!row.blocked}
                                                                    value={row.title}
                                                                    onChange={event => editRow(row.id, { title: event.target.value })}
                                                                    className="w-full h-8 px-2 py-1 text-xs bg-surface border border-line rounded-md text-ink focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none disabled:bg-surface-muted disabled:text-ink-subtle"
                                                                />
                                                            </div>

                                                            {/* Expiry Date */}
                                                            <div>
                                                                <label className="block text-[10px] font-medium text-ink-subtle uppercase mb-0.5">
                                                                    Expiry Date
                                                                </label>
                                                                <input
                                                                    aria-label={`Expiry date for ${row.fileName}`}
                                                                    type="date"
                                                                    disabled={frozen || !!row.blocked}
                                                                    value={row.expiryDate}
                                                                    onChange={event => editRow(row.id, { expiryDate: event.target.value })}
                                                                    className="w-full h-8 px-2 py-1 text-xs bg-surface border border-line rounded-md text-ink focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none disabled:bg-surface-muted disabled:text-ink-subtle"
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* AI Detection & Evidence */}
                                                    <td className="p-3 align-top">
                                                        {analyzing ? (
                                                            <div className="flex items-center gap-2 text-accent font-medium text-xs">
                                                                <i className="ti ti-loader animate-spin text-sm" />
                                                                <span>{row.analysisStatus === 'queued' ? 'Queued' : 'Analyzing…'}</span>
                                                            </div>
                                                        ) : classification ? (
                                                            <div className="space-y-1">
                                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                                                    classification.confidence === 'high'
                                                                        ? 'bg-success-subtle text-success-ink border-success/30'
                                                                        : 'bg-warning-subtle text-warning-ink border-warning/30'
                                                                }`}>
                                                                    <i className={`ti ${classification.confidence === 'high' ? 'ti-sparkles' : 'ti-bulb'} text-xs`} />
                                                                    <span>{classification.confidence === 'high' ? 'Strong Match' : 'Suggested'}</span>
                                                                </span>

                                                                {classification.evidence?.length > 0 && (
                                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                                        {classification.evidence.map(item => (
                                                                            <span key={item} className="text-[10px] px-1.5 py-0.2 rounded bg-surface-muted text-ink-subtle border border-line">
                                                                                {EVIDENCE_LABELS[item] || item}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[11px] text-ink-subtle flex items-center gap-1">
                                                                <i className="ti ti-help text-xs" />
                                                                <span>Manual review</span>
                                                            </span>
                                                        )}
                                                    </td>

                                                    {/* Verification & Status */}
                                                    <td className="p-3 align-top text-right">
                                                        {row.status === 'success' ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-success-subtle text-success-ink border border-success/30">
                                                                <i className="ti ti-circle-check text-xs" />
                                                                <span>Imported</span>
                                                            </span>
                                                        ) : row.status === 'uploading' ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-accent bg-accent-subtle border border-accent/20">
                                                                <i className="ti ti-loader animate-spin text-xs" />
                                                                <span>Saving…</span>
                                                            </span>
                                                        ) : (
                                                            <div className="flex flex-col items-end gap-1">
                                                                <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs select-none">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={row.confirmed}
                                                                        disabled={isCommitting || !row.include || !!row.blocked || analyzing || !row.title.trim() || row.attempted}
                                                                        onChange={event => updateRow(row.id, current => ({ ...current, confirmed: event.target.checked, revision: current.revision + 1 }))}
                                                                        className="rounded border-line text-accent cursor-pointer"
                                                                    />
                                                                    <span className={row.confirmed ? 'font-semibold text-success-ink' : 'text-ink-muted'}>
                                                                        Verified
                                                                    </span>
                                                                </label>
                                                                {row.confirmed ? (
                                                                    <span className="text-[10px] text-success-ink font-medium">Ready to import</span>
                                                                ) : (
                                                                    <span className="text-[10px] text-ink-subtle">Requires check</span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {row.error && (
                                                            <p role="alert" className="mt-1.5 text-[11px] text-danger-ink break-words text-right">
                                                                {row.error}
                                                            </p>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Controls */}
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 bg-surface shrink-0">
                    <div>
                        {rows.length > 0 && (
                            <button
                                type="button"
                                disabled={isCommitting || isAnalyzing || counts.uploaded > 0 || rows.some(row => row.attempted)}
                                onClick={resetAll}
                                className="h-8 px-3 rounded-md text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-muted border border-line transition-colors cursor-pointer disabled:opacity-50"
                            >
                                Choose another ZIP
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {counts.selected > 0 && counts.ready !== counts.selected && (
                            <span className="text-xs text-warning-ink font-medium">
                                {counts.selected - counts.ready} file{counts.selected - counts.ready === 1 ? '' : 's'} require verification
                            </span>
                        )}
                        {counts.selected > 0 && counts.ready === counts.selected && (
                            <span className="text-xs text-success-ink font-medium flex items-center gap-1">
                                <i className="ti ti-check text-xs" />
                                <span>All selected files verified</span>
                            </span>
                        )}

                        {rows.length > 0 && (
                            <button
                                type="button"
                                disabled={importDisabled}
                                onClick={commit}
                                className="h-8 px-4 rounded-md bg-accent text-white hover:bg-accent-hover text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:bg-line disabled:text-ink-subtle disabled:cursor-not-allowed"
                            >
                                <i className={`ti ${isCommitting ? 'ti-loader animate-spin' : 'ti-cloud-upload'} text-xs`} />
                                <span>
                                    {isCommitting
                                        ? 'Importing…'
                                        : `${counts.failed ? 'Retry / Import' : 'Import'} ${counts.selected} File${counts.selected === 1 ? '' : 's'}`}
                                </span>
                            </button>
                        )}
                    </div>
                </footer>

                {/* High-Resolution Interactive Preview Lightbox */}
                {preview && (
                    <div
                        data-preview
                        className="absolute inset-0 z-20 flex flex-col bg-surface text-ink animate-in fade-in duration-150"
                    >
                        {/* Lightbox Toolbar */}
                        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 bg-surface shrink-0 shadow-2xs">
                            <div className="flex items-center gap-2 min-w-0">
                                <button
                                    type="button"
                                    onClick={closePreview}
                                    className="h-8 px-2.5 rounded-md border border-line text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                    <i className="ti ti-arrow-left text-xs" />
                                    <span>Back to List</span>
                                </button>
                                <div className="min-w-0">
                                    <h3 className="text-sm font-semibold text-ink truncate max-w-sm sm:max-w-md">
                                        {preview.name}
                                    </h3>
                                    {preview.row && (
                                        <p className="text-[11px] text-ink-muted truncate">
                                            {getDocumentType(preview.row.documentType)?.label || 'Unclassified'} · {preview.row.category}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Center Viewer Navigation & Zoom Controls */}
                            <div className="flex items-center gap-1.5">
                                {/* Prev / Next Buttons */}
                                <div className="flex items-center rounded-md border border-line p-0.5 bg-surface-muted/40">
                                    <button
                                        type="button"
                                        onClick={() => navigatePreview(-1)}
                                        aria-label="Previous document"
                                        title="Previous file (Left Arrow)"
                                        className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface transition-colors cursor-pointer"
                                    >
                                        <i className="ti ti-chevron-left text-xs" />
                                    </button>
                                    <span className="text-[11px] font-mono px-2 text-ink-muted">
                                        {(() => {
                                            const list = displayedRows.length > 0 ? displayedRows : rows;
                                            const idx = list.findIndex(r => r.id === preview.row?.id);
                                            return `${idx >= 0 ? idx + 1 : 1} / ${list.length}`;
                                        })()}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => navigatePreview(1)}
                                        aria-label="Next document"
                                        title="Next file (Right Arrow)"
                                        className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface transition-colors cursor-pointer"
                                    >
                                        <i className="ti ti-chevron-right text-xs" />
                                    </button>
                                </div>

                                {/* Zoom & Rotation for Images */}
                                {preview.mime?.startsWith('image/') && (
                                    <div className="hidden sm:flex items-center rounded-md border border-line p-0.5 bg-surface-muted/40">
                                        <button
                                            type="button"
                                            onClick={() => setZoom(prev => Math.max(prev - 0.25, 0.5))}
                                            title="Zoom out"
                                            className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface transition-colors cursor-pointer"
                                        >
                                            <i className="ti ti-zoom-out text-xs" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setZoom(1); setRotation(0); }}
                                            title="Reset zoom"
                                            className="px-2 h-7 text-[11px] font-mono text-ink-muted hover:text-ink hover:bg-surface rounded transition-colors cursor-pointer"
                                        >
                                            {Math.round(zoom * 100)}%
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setZoom(prev => Math.min(prev + 0.25, 3))}
                                            title="Zoom in"
                                            className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface transition-colors cursor-pointer"
                                        >
                                            <i className="ti ti-zoom-in text-xs" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRotation(prev => (prev + 90) % 360)}
                                            title="Rotate 90 degrees"
                                            className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface transition-colors cursor-pointer border-l border-line ml-0.5"
                                        >
                                            <i className="ti ti-rotate-clockwise text-xs" />
                                        </button>
                                    </div>
                                )}

                                {/* Confirm & Next Button in Lightbox */}
                                {preview.row && !preview.row.confirmed && (
                                    <button
                                        type="button"
                                        onClick={() => handleConfirmAndNext(preview.row)}
                                        className="h-8 px-3 rounded-md bg-success-subtle hover:bg-success/20 text-success-ink border border-success/30 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ml-1"
                                    >
                                        <i className="ti ti-check text-xs" />
                                        <span>Verify & Next</span>
                                    </button>
                                )}
                            </div>
                        </header>

                        {/* Lightbox Viewer Canvas */}
                        <div className="flex-1 flex flex-col items-center justify-center overflow-auto p-4 bg-canvas/60 relative">
                            {preview.loading && (
                                <div className="flex flex-col items-center gap-2 text-ink-muted">
                                    <i className="ti ti-loader animate-spin text-2xl text-accent" />
                                    <p className="text-xs">Preparing document preview…</p>
                                </div>
                            )}

                            {preview.error && (
                                <div className="text-center p-6 bg-surface border border-danger/30 rounded-lg max-w-md">
                                    <i className="ti ti-alert-triangle text-2xl text-danger-ink mb-2 block" />
                                    <p className="text-xs text-danger-ink font-medium">{preview.error}</p>
                                </div>
                            )}

                            {preview.url && !preview.loading && (
                                <div className="w-full h-full flex flex-col items-center justify-center overflow-auto">
                                    {preview.mime?.startsWith('image/') ? (
                                        <div className="flex-1 flex items-center justify-center p-2 overflow-auto w-full">
                                            <img
                                                src={preview.url}
                                                alt={`Document preview: ${preview.name}`}
                                                style={{
                                                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                                                    transition: 'transform 0.15s ease-out',
                                                }}
                                                className="max-h-[72vh] max-w-full object-contain shadow-md rounded border border-line bg-surface"
                                            />
                                        </div>
                                    ) : preview.mime === 'application/pdf' ? (
                                        <iframe
                                            title={`PDF preview: ${preview.name}`}
                                            src={preview.url}
                                            sandbox="allow-scripts allow-same-origin"
                                            className="w-full h-[75vh] rounded-md border border-line bg-surface shadow-md"
                                        />
                                    ) : (
                                        <div className="text-center p-8 bg-surface border border-line rounded-lg shadow-2xs max-w-md">
                                            <i className="ti ti-file-description text-3xl text-ink-muted mb-2 block" />
                                            <p className="text-xs text-ink font-medium">
                                                Direct in-browser preview is not supported for this file format.
                                            </p>
                                            <p className="text-[11px] text-ink-subtle mt-1 mb-4">
                                                Download the file to inspect its contents in your local desktop viewer.
                                            </p>
                                            <a
                                                href={preview.url}
                                                download={preview.name}
                                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition-colors"
                                            >
                                                <i className="ti ti-download text-xs" />
                                                <span>Download file</span>
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
