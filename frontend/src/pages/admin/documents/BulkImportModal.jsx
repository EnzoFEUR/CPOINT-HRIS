import React, { useMemo, useState } from 'react';
import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient';

// ---------------------------------------------------------------------------
// Classification config. Best-guess starting point based on the categories
// actually live on the Document Vault filter tabs — tune the keyword lists
// once this has run against a real batch of files. The reviewer can always
// override the category per file before committing, so a wrong guess here
// never silently mis-files anything.
// ---------------------------------------------------------------------------
const CATEGORY_KEYWORDS = {
    Contract: ['contract', 'agreement', 'offerletter', 'offer letter'],
    'Government ID': ['sss', 'tin', 'philhealth', 'pagibig', 'pag-ibig', 'umid', 'passport', 'license', 'govid', 'government id', 'national id'],
    Clearance: ['nbi', 'clearance', 'police'],
    Certificate: ['cert', 'certificate', 'diploma', 'coe', 'training'],
    Performance: ['performance', 'appraisal', 'pms', 'evaluation'],
};

const SKIP_FILENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

const normalize = (s = '') => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const matchCategoryFromFolder = (segment, categories) => {
    if (!segment) return null;
    const normSeg = normalize(segment);
    return categories.find((c) => normalize(c) === normSeg) || null;
};

const matchCategoryFromFilename = (fileName) => {
    const lower = fileName.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some((kw) => lower.includes(kw))) return category;
    }
    return null;
};

// Checks every leading folder segment (any depth) against the canonical
// category list first, then falls back to filename keywords, then 'Other'.
const classifyCategory = (folderSegments, fileName, categories) => {
    for (const seg of folderSegments) {
        const hit = matchCategoryFromFolder(seg, categories);
        if (hit) return { value: hit, confidence: 'folder' };
    }
    const kwHit = matchCategoryFromFilename(fileName);
    if (kwHit) return { value: kwHit, confidence: 'keyword' };
    return { value: 'Other', confidence: 'default' };
};

// Same formatting used by Documents.jsx's own handleUploadSubmit — file_size
// is stored as a formatted string ("684.33 KB"), not raw bytes.
const formatFileSize = (bytes) => {
    if (!bytes) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const CONFIDENCE_LABEL = {
    folder: 'Folder',
    keyword: 'Filename',
    default: 'Default',
    manual: 'Manual',
};

let rowSeq = 0;

export default function BulkImportModal({ isOpen, onClose, employeeId, isTerminated, categories, onImported }) {
    const [step, setStep] = useState('select'); // select | review
    const [isParsing, setIsParsing] = useState(false);
    const [rows, setRows] = useState([]);
    const [isCommitting, setIsCommitting] = useState(false);
    const [committed, setCommitted] = useState(false);

    const resetAll = () => {
        setStep('select');
        setRows([]);
        setIsParsing(false);
        setIsCommitting(false);
        setCommitted(false);
    };

    const handleClose = () => {
        resetAll();
        onClose();
    };

    // ---- Parse zip into review rows ----
    const handleFileSelected = async (file) => {
        if (!file) return;
        setIsParsing(true);
        try {
            const zip = await JSZip.loadAsync(file);
            const entries = Object.values(zip.files).filter((f) => !f.dir);
            const nextRows = [];

            for (const entry of entries) {
                const parts = entry.name.split('/').filter(Boolean);
                const fileName = parts[parts.length - 1];
                if (!fileName || fileName.startsWith('__MACOSX') || SKIP_FILENAMES.has(fileName.toLowerCase())) continue;
                if (fileName.startsWith('.')) continue;

                const folderSegments = parts.slice(0, -1);
                const category = classifyCategory(folderSegments, fileName, categories);

                nextRows.push({
                    id: `row-${rowSeq++}`,
                    zipPath: entry.name,
                    fileName,
                    entry,
                    category: category.value,
                    categoryConfidence: category.confidence,
                    include: true,
                    status: 'idle', // idle | uploading | success | error
                    error: null,
                });
            }

            if (nextRows.length === 0) {
                toast.error('No files found in that zip (after ignoring system files).');
                setIsParsing(false);
                return;
            }

            setRows(nextRows);
            setStep('review');
        } catch (err) {
            toast.error(`Could not read zip: ${err.message}`);
        } finally {
            setIsParsing(false);
        }
    };

    const updateRow = (id, patch) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };

    const counts = useMemo(() => {
        const included = rows.filter((r) => r.include).length;
        const uploaded = rows.filter((r) => r.status === 'success').length;
        const failed = rows.filter((r) => r.status === 'error').length;
        return { included, uploaded, failed, total: rows.length };
    }, [rows]);

    // ---- Commit: same storage path + insert shape as Documents.jsx's
    // handleUploadSubmit, just looped per file. ----
    const uploadRow = async (row) => {
        updateRow(row.id, { status: 'uploading', error: null });
        try {
            const blob = await row.entry.async('blob');
            const fileExt = row.fileName.includes('.') ? row.fileName.split('.').pop() : 'bin';
            const filePath = `${employeeId}/${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;

            const { error: storageError } = await supabase.storage
                .from('documents')
                .upload(filePath, blob, { cacheControl: '3600', upsert: false });
            if (storageError) throw storageError;

            const { error: dbError } = await supabase
                .from('employee_documents')
                .insert([
                    {
                        employee_id: employeeId,
                        title: row.fileName,
                        category: row.category,
                        file_name: row.fileName,
                        file_path: filePath,
                        file_size: formatFileSize(blob.size),
                        expiry_date: null,
                    },
                ])
                .select()
                .single();
            if (dbError) throw dbError;

            updateRow(row.id, { status: 'success' });
            return true;
        } catch (err) {
            updateRow(row.id, { status: 'error', error: err.message || 'Upload failed' });
            return false;
        }
    };

    const runCommit = async (targetRows) => {
        setIsCommitting(true);
        for (const row of targetRows) {
            await uploadRow(row);
        }
        setIsCommitting(false);
        setCommitted(true);
        onImported?.();
    };

    const handleCommit = () => {
        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated employee accounts.');
            return;
        }
        const toUpload = rows.filter((r) => r.include);
        if (toUpload.length === 0) {
            toast.error('No files selected to import.');
            return;
        }
        runCommit(toUpload);
    };

    const handleRetryFailed = () => {
        const failedRows = rows.filter((r) => r.status === 'error');
        if (failedRows.length === 0) return;
        runCommit(failedRows);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl">
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
                    <div>
                        <h2 className="text-lg font-black text-slate-800">Bulk Import (ZIP)</h2>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Every file in the zip is added to this employee's 201 file.
                        </p>
                    </div>
                    <button onClick={handleClose} className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {step === 'select' && (
                        <div className="space-y-4">
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-medium leading-relaxed">
                                Structure your zip with a folder per category — <span className="font-bold">Contract/</span>,{' '}
                                <span className="font-bold">Government ID/</span>, <span className="font-bold">Clearance/</span>,{' '}
                                <span className="font-bold">Certificate/</span>, <span className="font-bold">Performance/</span> — or
                                leave files flat and we'll guess the category from the filename. Anything unrecognized is filed under
                                "Other" so nothing is silently dropped.
                            </div>

                            <label className="flex flex-col items-center justify-center gap-2 py-12 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                                <i className="ti ti-file-zip text-3xl text-slate-300" />
                                <span className="text-sm font-bold text-slate-600">
                                    {isParsing ? 'Reading zip…' : 'Click to choose a .zip file'}
                                </span>
                                <span className="text-[11px] text-slate-400">or drag & drop</span>
                                <input
                                    type="file"
                                    accept=".zip"
                                    disabled={isParsing}
                                    className="hidden"
                                    onChange={(e) => handleFileSelected(e.target.files[0])}
                                />
                            </label>
                        </div>
                    )}

                    {step === 'review' && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[11px] font-black">
                                    {counts.total} file{counts.total === 1 ? '' : 's'} found
                                </span>
                                {committed && (
                                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-black">
                                        {counts.uploaded} uploaded · {counts.failed} failed
                                    </span>
                                )}
                            </div>

                            <div className="border border-slate-100 rounded-xl overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-500 font-black uppercase tracking-wider text-[10px]">
                                        <tr>
                                            <th className="text-left px-3 py-2 w-8"></th>
                                            <th className="text-left px-3 py-2">File</th>
                                            <th className="text-left px-3 py-2">Category</th>
                                            <th className="text-left px-3 py-2">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {rows.map((row) => (
                                            <tr key={row.id}>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={row.include}
                                                        disabled={isCommitting}
                                                        onChange={(e) => updateRow(row.id, { include: e.target.checked })}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 max-w-[260px]">
                                                    <p className="font-bold text-slate-700 truncate" title={row.zipPath}>
                                                        {row.fileName}
                                                    </p>
                                                    <p className="text-slate-400 truncate">{row.zipPath}</p>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <select
                                                        value={row.category}
                                                        disabled={isCommitting}
                                                        onChange={(e) =>
                                                            updateRow(row.id, { category: e.target.value, categoryConfidence: 'manual' })
                                                        }
                                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] mb-1"
                                                    >
                                                        {categories.map((c) => (
                                                            <option key={c} value={c}>
                                                                {c}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <span className="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold bg-slate-50 text-slate-400 border-slate-200">
                                                        {CONFIDENCE_LABEL[row.categoryConfidence]}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    {row.status === 'idle' && <span className="text-slate-300">—</span>}
                                                    {row.status === 'uploading' && (
                                                        <i className="ti ti-loader animate-spin text-slate-400 text-sm" />
                                                    )}
                                                    {row.status === 'success' && (
                                                        <i className="ti ti-circle-check text-emerald-600 text-sm" />
                                                    )}
                                                    {row.status === 'error' && (
                                                        <span className="text-rose-600 font-bold" title={row.error}>
                                                            <i className="ti ti-circle-x text-sm" /> Failed
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100">
                    {step === 'review' && !committed && (
                        <button
                            type="button"
                            onClick={resetAll}
                            disabled={isCommitting}
                            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer disabled:opacity-50"
                        >
                            <i className="ti ti-arrow-left text-sm" /> Choose a different file
                        </button>
                    )}
                    <div className="flex-1" />
                    {step === 'review' && !committed && (
                        <button
                            type="button"
                            onClick={handleCommit}
                            disabled={isCommitting || counts.included === 0}
                            className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl cursor-pointer transition-colors"
                        >
                            {isCommitting ? 'Importing…' : `Import ${counts.included} File${counts.included === 1 ? '' : 's'}`}
                        </button>
                    )}
                    {committed && counts.failed > 0 && (
                        <button
                            type="button"
                            onClick={handleRetryFailed}
                            className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl cursor-pointer"
                        >
                            Retry {counts.failed} Failed
                        </button>
                    )}
                    {committed && (
                        <button
                            type="button"
                            onClick={handleClose}
                            className="px-4 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white rounded-xl cursor-pointer"
                        >
                            Done
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}