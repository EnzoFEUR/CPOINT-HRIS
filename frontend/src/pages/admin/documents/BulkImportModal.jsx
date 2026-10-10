import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { classifyEmployeeDocument, uploadEmployeeDocument } from '../../../utils/documentApi';
import { getDocumentMimeType } from '../../../utils/documentUtils';
import { applyContentSuggestion, buildImportRows, BULK_LIMITS, canImportRow, extractZipEntry, validateZipDirectory } from '../../../utils/bulkDocumentImport';
import { DOCUMENT_TYPES, getDocumentType } from '../../../../../shared/documentTypes.mjs';

const EVIDENCE_LABELS = { agency_name: 'Agency wording', document_heading: 'Document heading', form_code: 'Form code', logo: 'Logo', layout: 'Layout' };
const CONFIDENCE_LABELS = { high: 'Strong suggestion', medium: 'Tentative suggestion', low: 'Manual review' };
const fieldClass = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 disabled:bg-slate-50 disabled:text-slate-500';
const buttonClass = 'rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export default function BulkImportModal({ isOpen, onClose, employeeId, employeeName, isTerminated, categories, onImported }) {
    const [rows, setRows] = useState([]);
    const [isParsing, setIsParsing] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [preview, setPreview] = useState(null);
    const rowsRef = useRef([]);
    const jobRef = useRef({ epoch: 0, controller: null, busy: false });
    const previewRef = useRef({ epoch: 0, controller: null, url: null });
    const dialogRef = useRef(null);

    useEffect(() => () => {
        jobRef.current.epoch++;
        jobRef.current.controller?.abort();
        previewRef.current.epoch++;
        previewRef.current.controller?.abort();
        if (previewRef.current.url) URL.revokeObjectURL(previewRef.current.url);
    }, []);

    const replaceRows = nextRows => { rowsRef.current = nextRows; setRows(nextRows); };
    const updateRow = (id, patch) => replaceRows(rowsRef.current.map(row => row.id === id ? (typeof patch === 'function' ? patch(row) : { ...row, ...patch }) : row));
    const closePreview = () => {
        previewRef.current.epoch++;
        previewRef.current.controller?.abort();
        if (previewRef.current.url) URL.revokeObjectURL(previewRef.current.url);
        previewRef.current.url = null;
        setPreview(null);
    };
    const resetAll = () => {
        jobRef.current.epoch++;
        jobRef.current.controller?.abort();
        jobRef.current.busy = false;
        closePreview();
        replaceRows([]);
        setIsParsing(false); setIsAnalyzing(false);
    };
    const handleClose = () => {
        if (isCommitting) return;
        resetAll();
        onClose();
    };
    const handleDialogKey = useEffectEvent(event => {
        if (event.key === 'Escape') { event.preventDefault(); if (preview) closePreview(); else handleClose(); }
        if (event.key !== 'Tab') return;
        const scope = dialogRef.current?.querySelector('[data-preview]') || dialogRef.current;
        const focusable = scope?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], iframe');
        if (!focusable?.length) { event.preventDefault(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    });
    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement;
        dialogRef.current?.focus();
        const listener = event => handleDialogKey(event);
        document.addEventListener('keydown', listener);
        return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
    }, [isOpen]);
    const editRow = (id, patch) => updateRow(id, row => ({
        ...row, ...patch, confirmed: row.attempted ? row.confirmed : false, revision: row.revision + 1,
    }));

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
            replaceRows(buildImportRows(Object.values(zip.files), categories));
        } catch (error) {
            if (epoch === jobRef.current.epoch) toast.error(error.message || 'Could not read the ZIP.');
        } finally {
            if (epoch === jobRef.current.epoch) { setIsParsing(false); jobRef.current.busy = false; }
        }
    };

    const makeFile = async (row, signal) => {
        const bytes = await extractZipEntry(row.entry, { signal });
        return new File([bytes], row.fileName, { type: getDocumentMimeType(row.fileName) });
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
                if (!rowsRef.current.find(item => item.id === row.id)?.include) { updateRow(row.id, { analysisStatus: 'idle' }); continue; }
                updateRow(row.id, { analysisStatus: 'analyzing' });
                try {
                    const file = await makeFile(row, controller.signal);
                    const classification = await classifyEmployeeDocument({ employeeId, file, signal: controller.signal });
                    if (epoch === jobRef.current.epoch && !controller.signal.aborted) updateRow(row.id, current => applyContentSuggestion(current, classification, row.revision));
                } catch (error) {
                    if (epoch === jobRef.current.epoch && !controller.signal.aborted) updateRow(row.id, { analysisStatus: 'error', error: error.message || 'Analysis failed. Classify this file manually.' });
                }
            }
        };
        try { await Promise.all([worker(), worker()]); }
        finally {
            if (epoch === jobRef.current.epoch) {
                replaceRows(rowsRef.current.map(row => ['queued', 'analyzing'].includes(row.analysisStatus) ? { ...row, analysisStatus: 'idle' } : row));
                setIsAnalyzing(false); jobRef.current.busy = false;
                jobRef.current.controller = null;
            }
        }
    };

    const openPreview = async row => {
        closePreview();
        const epoch = previewRef.current.epoch;
        const controller = new AbortController();
        previewRef.current.controller = controller;
        setPreview({ name: row.fileName, loading: true });
        try {
            const file = await makeFile(row, controller.signal);
            if (epoch !== previewRef.current.epoch || controller.signal.aborted) return;
            const url = URL.createObjectURL(file);
            previewRef.current.url = url;
            setPreview({ name: row.fileName, url, mime: file.type });
        } catch (error) {
            if (epoch === previewRef.current.epoch && !controller.signal.aborted) setPreview({ name: row.fileName, error: error.message });
        }
    };

    const commit = async () => {
        if (jobRef.current.busy || isTerminated || !employeeId) return;
        const selected = rowsRef.current.filter(row => row.include && !row.blocked && row.status !== 'success');
        if (!selected.length || selected.some(row => !canImportRow(row))) return toast.error('Review and confirm every selected file before importing.');
        const epoch = ++jobRef.current.epoch;
        jobRef.current.busy = true;
        setIsCommitting(true);
        closePreview();
        let saved = 0;
        try {
            // Sequential writes keep per-file errors clear and avoid Storage bursts.
            for (const row of selected) {
                if (epoch !== jobRef.current.epoch) break;
                updateRow(row.id, { status: 'uploading', attempted: true, error: null });
                try {
                    const file = await makeFile(row);
                    await uploadEmployeeDocument({
                        employeeId, file, title: row.title, category: row.category, expiryDate: row.expiryDate,
                        bulkReview: { confirmed: row.confirmed, documentType: row.documentType, importId: row.importId },
                    });
                    saved++;
                    if (epoch === jobRef.current.epoch) updateRow(row.id, { status: 'success' });
                } catch (error) {
                    if (epoch === jobRef.current.epoch) updateRow(row.id, { status: 'error', attempted: ![400, 403, 404].includes(error.status), error: error.message || 'Import failed.' });
                }
            }
            if (epoch === jobRef.current.epoch) {
                if (saved) toast.success(`${saved} document${saved === 1 ? '' : 's'} imported for review.`);
                else toast.error('No documents were imported. Review the errors before retrying.');
            }
        } finally {
            if (epoch === jobRef.current.epoch) { setIsCommitting(false); jobRef.current.busy = false; }
            if (saved) {
                try { await onImported?.(); }
                catch { toast.error('Documents were saved, but the list could not refresh. Refresh the document vault.'); }
            }
        }
    };

    const counts = useMemo(() => {
        const selected = rows.filter(row => row.include && !row.blocked && row.status !== 'success');
        return {
            selected: selected.length,
            ready: selected.filter(canImportRow).length,
            uploaded: rows.filter(row => row.status === 'success').length,
            failed: rows.filter(row => row.status === 'error').length,
            analyzed: rows.filter(row => ['done', 'error'].includes(row.analysisStatus)).length,
            analyzable: selected.filter(row => !row.confirmed && !row.attempted).length,
        };
    }, [rows]);

    if (!isOpen) return null;
    const importDisabled = isAnalyzing || isCommitting || isTerminated || !employeeId || !counts.selected || counts.ready !== counts.selected;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
            <div className="absolute inset-0 bg-slate-950/70" onClick={handleClose} />
            <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bulk-import-title" className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                    <div>
                        <h2 id="bulk-import-title" className="text-base font-bold text-slate-900">Review and import documents</h2>
                        <p className="mt-1 text-xs text-slate-600">Importing into <strong>{employeeName || employeeId || 'an employee record'}</strong>. Verify that every file belongs to this employee.</p>
                    </div>
                    <button type="button" aria-label="Close bulk import" disabled={isCommitting} onClick={handleClose} className={buttonClass}>Close</button>
                </header>
                <div className="overflow-y-auto px-5 py-4">
                    {isTerminated && <p role="alert" className="mb-4 rounded-md bg-amber-50 p-3 text-xs text-amber-800">Uploads are locked for this employee.</p>}
                    {!rows.length ? (
                        <div className="rounded-lg border-2 border-dashed border-slate-200 p-8 text-center">
                            <i className="ti ti-file-zip text-3xl text-slate-400" />
                            <p className="mt-3 text-sm font-semibold text-slate-800">Select a ZIP of employee documents</p>
                            <p className="mt-2 text-xs text-slate-500">Up to 100 files, 25 MB ZIP, 10 MB per file, and 100 MB expanded.</p>
                            <p className="mt-2 text-xs text-slate-500">Preview and edit first. Nothing is saved until you confirm and import.</p>
                            <label className="mt-5 inline-block cursor-pointer rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white">
                                {isParsing ? 'Reading ZIP…' : 'Choose ZIP'}
                                <input type="file" accept=".zip,application/zip" disabled={isParsing || isTerminated || !employeeId} className="sr-only" onChange={event => { handleFileSelected(event.target.files?.[0]); event.target.value = ''; }} />
                            </label>
                        </div>
                    ) : (
                        <>
                            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
                                <p className="text-xs font-semibold text-blue-950">Recognize documents from their contents</p>
                                <p className="mt-1 text-xs leading-5 text-blue-900">Analyze contents sends selected PDFs, JPEG, PNG, WebP, or text files to the configured Gemini service. Filenames are not used for content detection. Other formats need manual review.</p>
                                <p className="mt-1 text-xs leading-5 text-blue-900">Suggestions can be wrong. Preview each file, edit its type, title, category, or expiry date, then confirm. This does not verify document authenticity or employee identity.</p>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <button type="button" className={buttonClass} disabled={isCommitting || isAnalyzing || isTerminated || !counts.analyzable} onClick={analyzeContents}>
                                        {isAnalyzing ? 'Analyzing contents…' : 'Analyze contents'}
                                    </button>
                                    {isAnalyzing && <button type="button" className={buttonClass} onClick={() => jobRef.current.controller?.abort()}>Stop analysis</button>}
                                    <span role="status" aria-live="polite" className="text-xs text-blue-900">{counts.analyzed} of {rows.length} analyzed · {counts.ready} of {counts.selected} ready · {counts.uploaded} imported</span>
                                </div>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="w-full min-w-[850px] text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-600">
                                        <tr><th className="p-3">Include</th><th className="p-3">File and detection</th><th className="w-72 p-3">Document details</th><th className="w-56 p-3">Confirm and import</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {rows.map(row => {
                                            const frozen = isCommitting || row.attempted || row.status === 'success';
                                            const classification = row.classification;
                                            const analyzing = ['queued', 'analyzing'].includes(row.analysisStatus);
                                            return (
                                                <tr key={row.id} className={!row.include ? 'bg-slate-50/60' : ''}>
                                                    <td className="p-3 align-top"><input type="checkbox" aria-label={`Include ${row.fileName}`} checked={row.include} disabled={isCommitting || !!row.blocked || row.status === 'success'} onChange={event => editRow(row.id, { include: event.target.checked })} /></td>
                                                    <td className="max-w-sm p-3 align-top">
                                                        <p className="break-all font-semibold text-slate-900">{row.fileName}</p>
                                                        <p className="mt-1 break-all text-[11px] text-slate-500">{row.zipPath}</p>
                                                        <button type="button" disabled={isCommitting || !!row.blocked} onClick={() => openPreview(row)} className="mt-2 font-semibold text-blue-700 hover:underline">Preview file</button>
                                                        {analyzing && <p role="status" className="mt-2 text-blue-700">{row.analysisStatus === 'queued' ? 'Queued for analysis' : 'Reading file contents…'}</p>}
                                                        {classification && !analyzing && <div className="mt-2 text-[11px] leading-5">
                                                            <p className={classification.confidence === 'high' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>{CONFIDENCE_LABELS[classification.confidence]}{classification.source === 'content' ? ` · ${getDocumentType(classification.document_type).label}` : ''}</p>
                                                            {classification.evidence?.length > 0 && <p className="text-slate-500">{classification.evidence.map(item => EVIDENCE_LABELS[item]).filter(Boolean).join(' · ')}</p>}
                                                            <p className="text-slate-500">{classification.message}</p>
                                                        </div>}
                                                        {!classification && !analyzing && <p className="mt-2 text-[11px] text-slate-500">Unverified. Analyze contents or classify manually.</p>}
                                                        {row.duplicate && <p className="mt-2 text-amber-700">Repeated filename; excluded initially. Check whether it is a separate document.</p>}
                                                        {row.blocked && <p className="mt-2 text-red-700">{row.blocked}</p>}
                                                    </td>
                                                    <td className="space-y-2 p-3 align-top">
                                                        <label className="block text-[11px] text-slate-500">Document type
                                                            <select aria-label={`Document type for ${row.fileName}`} className={fieldClass} disabled={frozen || !!row.blocked} value={row.documentType} onChange={event => {
                                                                const type = getDocumentType(event.target.value);
                                                                editRow(row.id, { documentType: type.id, category: type.category, title: type.id === 'unknown' ? row.fileName.slice(0, 200) : type.label });
                                                            }}>{DOCUMENT_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
                                                        </label>
                                                        <label className="block text-[11px] text-slate-500">Title
                                                            <input aria-label={`Title for ${row.fileName}`} className={fieldClass} maxLength={200} disabled={frozen || !!row.blocked} value={row.title} onChange={event => editRow(row.id, { title: event.target.value })} />
                                                        </label>
                                                        <label className="block text-[11px] text-slate-500">Category
                                                            <select aria-label={`Category for ${row.fileName}`} className={fieldClass} disabled={frozen || !!row.blocked} value={row.category} onChange={event => editRow(row.id, { category: event.target.value })}>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select>
                                                        </label>
                                                        <label className="block text-[11px] text-slate-500">Expiry date (optional)
                                                            <input aria-label={`Expiry date for ${row.fileName}`} type="date" className={fieldClass} disabled={frozen || !!row.blocked} value={row.expiryDate} onChange={event => editRow(row.id, { expiryDate: event.target.value })} />
                                                        </label>
                                                    </td>
                                                    <td className="p-3 align-top">
                                                        {row.status === 'success' ? <p className="font-semibold text-emerald-700">Imported · pending HR approval</p> : <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
                                                            <input type="checkbox" className="mt-1" checked={row.confirmed} disabled={isCommitting || !row.include || !!row.blocked || analyzing || !row.title.trim() || row.attempted} onChange={event => updateRow(row.id, current => ({ ...current, confirmed: event.target.checked, revision: current.revision + 1 }))} />
                                                            I reviewed this file and confirm its details and intended employee.
                                                        </label>}
                                                        {row.status === 'uploading' && <p role="status" className="mt-2 text-blue-700">Importing…</p>}
                                                        {row.error && <p role="alert" className="mt-2 break-words text-red-700">{row.error}</p>}
                                                        {row.status === 'error' && <p className="mt-2 text-[11px] leading-5 text-slate-500">Retry uses the same import ID and details. Check the vault if the connection failed; retry protection lasts 30 minutes on this server.</p>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <p className="mt-3 text-[11px] leading-5 text-slate-500">Confirmation is required even for a strong suggestion. Imported documents remain pending HR approval. Changing details clears confirmation.</p>
                        </>
                    )}
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                    <div>
                        {rows.length > 0 && <button type="button" className={buttonClass} disabled={isCommitting || isAnalyzing || counts.uploaded > 0 || rows.some(row => row.attempted)} onClick={resetAll}>Choose another ZIP</button>}
                    </div>
                    <div className="flex items-center gap-3">
                        {counts.selected > counts.ready && <span className="text-xs text-amber-700">Review {counts.selected - counts.ready} selected files</span>}
                        {rows.length > 0 && <button type="button" disabled={importDisabled} onClick={commit} className="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-slate-300">{isCommitting ? 'Importing…' : `${counts.failed ? 'Import / retry' : 'Import'} ${counts.selected} confirmed file${counts.selected === 1 ? '' : 's'}`}</button>}
                    </div>
                </footer>
                {preview && <div data-preview className="absolute inset-0 z-10 flex flex-col bg-white">
                    <header className="flex items-center justify-between gap-4 border-b border-slate-200 p-4">
                        <h3 className="break-all text-sm font-semibold text-slate-900">{preview.name}</h3>
                        <button type="button" onClick={closePreview} className={buttonClass}>Back to review</button>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto p-4">
                        {preview.loading && <p role="status" className="text-sm text-slate-500">Preparing local preview…</p>}
                        {preview.error && <p role="alert" className="text-sm text-red-700">{preview.error}</p>}
                        {preview.url && <>
                            {preview.mime?.startsWith('image/') ? <img src={preview.url} alt={`Document preview: ${preview.name}`} className="max-h-[65vh] max-w-full object-contain" /> : preview.mime === 'application/pdf' ? <iframe title={`PDF preview: ${preview.name}`} src={preview.url} sandbox="" className="min-h-[55vh] w-full flex-1 rounded-md border border-slate-200" /> : <p className="text-sm text-slate-600">Open this format locally to review its contents.</p>}
                            <a href={preview.url} download={preview.name} className="text-xs font-semibold text-blue-700 underline">Download original for local review</a>
                            <p className="text-[11px] text-slate-500">This preview stays in your browser.</p>
                        </>}
                    </div>
                </div>}
            </section>
        </div>
    );
}
