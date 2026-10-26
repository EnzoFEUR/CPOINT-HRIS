import { useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getStoredUser } from '../../utils/storedUser.mjs';
import { isAdmin } from '../../utils/userAccess.mjs';
import PageHeader from '../../components/ui/PageHeader';
import useEmployeeDocuments from '../../utils/useEmployeeDocuments';
import useDocumentRequests from '../../utils/useDocumentRequests';
import { uploadEmployeeDocument } from '../../utils/documentApi';
import {
    DOCUMENT_STATUSES,
    formatDocumentSize,
    getDocumentStatus,
    getDocumentExpiry,
    formatCleanDocumentFileName,
} from '../../utils/documentUtils';
import {
    DOCUMENT_CATEGORIES,
    DOCUMENT_TYPES,
    getDocumentType,
} from '../../../../shared/documentTypes.mjs';
import { HUMAN_TEXT_LIMITS } from '../../../../shared/inputLimits.mjs';
import DocumentThumbnail from '../../components/DocumentThumbnail';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';

const CATEGORIES = [
    'General',
    'Government ID',
    'Educational',
    'Medical',
    'Clearance',
    'Contract / Agreement',
];

export default function PersonnelDocuments() {
    const queryClient = useQueryClient();
    const storedUser = getStoredUser() || {};
    const currentUserId = storedUser.id;
    const isAdminAccount = isAdmin(storedUser);
    const [docSearch, setDocSearch] = useState('');
    const [docStatus, setDocStatus] = useState('all');
    const [docCategory, setDocCategory] = useState('All');
    const [docSort, setDocSort] = useState('newest');
    const documentQuery = useEmployeeDocuments({
        employeeId: currentUserId,
        actorId: currentUserId,
        enabled: Boolean(currentUserId) && !isAdminAccount,
        status: docStatus,
        category: docCategory,
        sort: docSort,
        search: docSearch,
    });
    const profile = { ...storedUser, ...(documentQuery.employee || {}) };
    const isTerminated = Boolean(
        documentQuery.uploadLocked ||
            profile.archived_at ||
            profile.is_active === false ||
            ['inactive', 'terminated', 'separated', 'archived'].includes(
                String(profile.status || '').toLowerCase()
            )
    );
    const documents = useMemo(
        () => (isAdminAccount ? [] : documentQuery.documents),
        [isAdminAccount, documentQuery.documents]
    );
    const requestQuery = useDocumentRequests({
        employeeId: currentUserId,
        actorId: currentUserId,
        enabled: Boolean(currentUserId) && !isAdminAccount,
    });
    const activeRequests = isAdminAccount
        ? []
        : (requestQuery.requests || []).filter((r) =>
              ['pending', 'submitted'].includes(r.status)
          );
    const [activePreviewDoc, setActivePreviewDoc] = useState(null);
    const handleOpenDocument = (docOrId) => {
        if (typeof docOrId === 'object' && docOrId !== null) {
            setActivePreviewDoc(docOrId);
            return;
        }
        const found = documents.find((d) => d.id === docOrId);
        if (found) {
            setActivePreviewDoc(found);
        } else {
            setActivePreviewDoc({ id: docOrId });
        }
    };
    const fileInputRef = useRef(null);
    const dragCounter = useRef(0);
    const [isDraggingFile, setIsDraggingFile] = useState(false);

    // Modal & Upload States
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [selectedDocTypeId, setSelectedDocTypeId] = useState('tin');
    const [uploadForm, setUploadForm] = useState({
        title: '',
        category: 'Government ID',
        documentType: 'BIR Form 1902 / 2316 (TIN Document)',
        requestId: null,
        expiryDate: '',
        file: null,
    });

    const resetUploadForm = () => {
        setSelectedDocTypeId('tin');
        setUploadForm({
            title: '',
            category: 'Government ID',
            documentType: 'BIR Form 1902 / 2316 (TIN Document)',
            requestId: null,
            expiryDate: '',
            file: null,
        });
    };

    const openUploadModal = (file = null) => {
        if (isAdminAccount) {
            toast.error(
                'Document uploads are disabled for administrator governance accounts.'
            );
            return;
        }
        if (isTerminated) {
            toast.error(
                'Document uploads are disabled for separated/terminated accounts.'
            );
            return;
        }
        const defaultType = DOCUMENT_TYPES[0];
        setSelectedDocTypeId(defaultType.id);
        const suggestedTitle = file
            ? file.name.replace(/\.[^/.]+$/, '')
            : `${defaultType.label} - ${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
        setUploadForm({
            title: suggestedTitle.slice(0, HUMAN_TEXT_LIMITS.title),
            category: defaultType.category,
            documentType: defaultType.label,
            requestId: null,
            expiryDate: '',
            file: file || null,
        });
        setShowUploadModal(true);
    };

    const openUploadForRequest = (req) => {
        if (isTerminated) {
            toast.error(
                'Document uploads are disabled for separated/terminated accounts.'
            );
            return;
        }
        const matched = getDocumentType(req.document_type);
        setSelectedDocTypeId(matched.id !== 'unknown' ? matched.id : 'unknown');
        setUploadForm({
            title: `${req.document_type} - ${profile?.first_name || ''} ${profile?.last_name || ''}`
                .trim()
                .slice(0, HUMAN_TEXT_LIMITS.title),
            category:
                req.category ||
                (matched.id !== 'unknown' ? matched.category : 'Other'),
            documentType: req.document_type,
            requestId: req.id,
            expiryDate: '',
            file: null,
        });
        setShowUploadModal(true);
    };

    const handleUploadDocTypeChange = (typeId) => {
        setSelectedDocTypeId(typeId);
        const meta = getDocumentType(typeId);
        if (meta) {
            setUploadForm((prev) => ({
                ...prev,
                category: meta.category,
                documentType: meta.label,
                title: (prev.requestId
                    ? prev.title
                    : `${meta.label} - ${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()
                ).slice(0, HUMAN_TEXT_LIMITS.title),
            }));
        }
    };

    const handleUploadSubmit = async (e) => {
        e.preventDefault();

        if (isAdminAccount) {
            toast.error(
                'Document uploads are disabled for administrator governance accounts.'
            );
            return;
        }

        if (isTerminated) {
            toast.error(
                'Document uploads are disabled for separated/terminated accounts.'
            );
            return;
        }

        if (!profile?.id) {
            toast.error('User profile not loaded properly. Please refresh.');
            return;
        }

        if (!uploadForm.file || !uploadForm.title.trim()) {
            toast.error('Please fill in the title and select a file');
            return;
        }

        if (uploadForm.title.length > HUMAN_TEXT_LIMITS.title) {
            toast.error(
                `Document title must be at most ${HUMAN_TEXT_LIMITS.title} characters.`,
                { id: 'document-title-limit' }
            );
            return;
        }

        setIsUploading(true);
        try {
            const resolvedTitle = uploadForm.title.trim();
            const cleanFileName = formatCleanDocumentFileName(
                resolvedTitle,
                uploadForm.file.name
            );
            const renamedFile =
                uploadForm.file.name === cleanFileName
                    ? uploadForm.file
                    : new File([uploadForm.file], cleanFileName, {
                          type: uploadForm.file.type,
                      });

            await uploadEmployeeDocument({
                employeeId: profile.id,
                file: renamedFile,
                title: resolvedTitle,
                category: uploadForm.category,
                documentType: uploadForm.documentType,
                requestId: uploadForm.requestId,
                expiryDate: uploadForm.expiryDate || null,
            });
            toast.success(
                uploadForm.requestId
                    ? 'Requested document submitted to HR for review!'
                    : 'Document submitted for review.'
            );
            setShowUploadModal(false);
            resetUploadForm();
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['myProfile'] });
        } catch (err) {
            console.error('Document upload error:', err);
            toast.error(err.message || 'Error uploading document');
        } finally {
            setIsUploading(false);
        }
    };

    const formatFileSize = formatDocumentSize;

    const getFileMeta = (fileName = '') => {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        switch (ext) {
            case 'pdf':
                return {
                    icon: 'ti-file-type-pdf',
                    color: 'text-danger-ink',
                    bg: 'bg-danger-subtle',
                    border: 'border-danger/20',
                };
            case 'doc':
            case 'docx':
                return {
                    icon: 'ti-file-type-docx',
                    color: 'text-accent',
                    bg: 'bg-accent-subtle',
                    border: 'border-accent/20',
                };
            case 'xls':
            case 'xlsx':
                return {
                    icon: 'ti-file-type-xls',
                    color: 'text-ink',
                    bg: 'bg-surface-muted',
                    border: 'border-line',
                };
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'heic':
                return {
                    icon: 'ti-photo',
                    color: 'text-accent',
                    bg: 'bg-accent-subtle',
                    border: 'border-accent/20',
                };
            default:
                return {
                    icon: 'ti-file',
                    color: 'text-slate-500',
                    bg: 'bg-slate-50',
                    border: 'border-slate-100',
                };
        }
    };

    const isImageFile = (fileName = '') =>
        ['png', 'jpg', 'jpeg', 'heic', 'webp'].includes(
            (fileName.split('.').pop() || '').toLowerCase()
        );

    const getExpiryStatus = getDocumentExpiry;

    const expiryBadgeStyles = {
        expired: 'bg-danger-subtle text-danger-ink border-danger/20',
        warning: 'bg-warning-subtle text-warning-ink border-warning/20',
        valid: 'bg-surface-muted text-ink border-line',
    };

    const alerts = useMemo(() => {
        if (isAdminAccount) return [];
        return documents
            .map((doc) => ({ doc, status: getDocumentExpiry(doc) }))
            .filter(({ status }) => status && status.level !== 'valid')
            .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    }, [documents, isAdminAccount]);

    const filteredDocuments = useMemo(() => {
        if (isAdminAccount) return [];
        const q = docSearch.toLowerCase().trim();
        return documents
            .filter(
                (doc) =>
                    (doc.title || '').toLowerCase().includes(q) ||
                    (doc.file_name || '').toLowerCase().includes(q)
            )
            .sort((a, b) =>
                docSort === 'oldest'
                    ? new Date(a.created_at) - new Date(b.created_at)
                    : new Date(b.created_at) - new Date(a.created_at)
            );
    }, [documents, docSearch, docSort, isAdminAccount]);

    const handleDragEnter = (e) => {
        e.preventDefault();
        if (isTerminated || isAdminAccount) return;
        if (e.dataTransfer.types?.includes('Files')) {
            dragCounter.current += 1;
            setIsDraggingFile(true);
        }
    };
    const handleDragLeave = (e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setIsDraggingFile(false);
        }
    };
    const handleDragOver = (e) => e.preventDefault();
    const handleDrop = (e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDraggingFile(false);
        if (isAdminAccount) return;
        if (isTerminated) {
            toast.error(
                'Document uploads are disabled for separated/terminated accounts.'
            );
            return;
        }
        const file = e.dataTransfer.files?.[0];
        if (file) openUploadModal(file);
    };

    if (isAdminAccount)
        return (
            <div className="max-w-5xl mx-auto space-y-5 pb-20 px-4 sm:px-6">
                <PageHeader
                    title="Personnel Documents"
                    breadcrumbs={['Employee', 'Personnel Documents']}
                />
                <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
                    Personnel documents are not applicable to administrator
                    governance accounts.
                </p>
            </div>
        );

    return (
        <div
            className="max-w-5xl mx-auto space-y-5 pb-20 px-4 sm:px-6"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <PageHeader
                title="Personnel Documents"
                breadcrumbs={['Employee', 'Personnel Documents']}
                description="Manage your personnel files and respond to HR document requests."
                actions={
                    <>
                        <button
                            type="button"
                            disabled={
                                isTerminated ||
                                documentQuery.isPending ||
                                documentQuery.isError
                            }
                            onClick={() => openUploadModal()}
                            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            Upload Document
                        </button>
                        <Link
                            to="/employee/profile"
                            className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold"
                        >
                            My Profile
                        </Link>
                    </>
                }
            />
            {isDraggingFile && (
                <div className="fixed inset-0 z-[60] bg-slate-900/20 flex items-center justify-center pointer-events-none">
                    <div className="bg-white rounded-lg shadow-xl border-2 border-dashed border-accent px-10 py-8 flex flex-col items-center">
                        <i className="ti ti-cloud-upload text-4xl text-accent mb-2" />

                        <p className="font-bold text-slate-800 text-sm uppercase tracking-wider">
                            Drop to Upload
                        </p>

                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Attach to your documents
                        </p>
                    </div>
                </div>
            )}
            {requestQuery.isError && (
                <div
                    role="alert"
                    className="rounded-md border border-danger/20 bg-danger-subtle p-3 text-sm text-danger-ink"
                >
                    {requestQuery.error.message}{' '}
                    <button
                        type="button"
                        className="underline"
                        onClick={() => requestQuery.refetch()}
                    >
                        Retry requests
                    </button>
                </div>
            )}
            <div id="documents" className="space-y-4 scroll-mt-20">
                {documentQuery.error && (
                    <div
                        role="alert"
                        className="rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger-ink"
                    >
                        {documentQuery.error.message}{' '}
                        <button
                            type="button"
                            onClick={() => documentQuery.refetch()}
                            className="ml-2 font-semibold underline"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Active Document Requests from HR */}

                {activeRequests.length > 0 && !isTerminated && (
                    <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-4 sm:p-5 shadow-2xs space-y-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <div className="h-8 w-8 shrink-0 bg-amber-100 text-amber-700 rounded-md flex items-center justify-center border border-amber-200">
                                    <i className="ti ti-mail-forward text-base" />
                                </div>

                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-xs sm:text-sm font-bold text-amber-900">
                                            Action Required:{' '}
                                            {activeRequests.length} Document
                                            {activeRequests.length > 1
                                                ? 's'
                                                : ''}{' '}
                                            Requested by HR
                                        </h4>

                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-200/80 text-amber-800">
                                            Compliance Hold
                                        </span>
                                    </div>

                                    <p className="text-xs text-amber-800 font-medium mt-0.5">
                                        Please upload the missing personnel
                                        documents below to fulfill your
                                        statutory document requirements.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                            {activeRequests.map((req) => (
                                <div
                                    key={req.id}
                                    className="p-3 bg-white rounded-lg border border-amber-200/80 flex items-start justify-between gap-3 shadow-2xs"
                                >
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-bold text-xs text-slate-900">
                                                {req.document_type}
                                            </span>

                                            <span
                                                className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${
                                                    req.priority === 'urgent'
                                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                        : req.priority ===
                                                            'high'
                                                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                          : 'bg-slate-50 text-slate-600 border-slate-200'
                                                }`}
                                            >
                                                {req.priority}
                                            </span>
                                        </div>

                                        {req.due_date && (
                                            <p className="text-[11px] text-amber-800 font-medium">
                                                Due:{' '}
                                                <strong>{req.due_date}</strong>
                                            </p>
                                        )}

                                        {req.notes && (
                                            <p className="text-[11px] text-slate-600 italic">
                                                &quot;{req.notes}&quot;
                                            </p>
                                        )}

                                        {req.status === 'submitted' && (
                                            <span className="inline-flex text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                                                Submitted · Under HR Review
                                            </span>
                                        )}
                                    </div>

                                    {req.status === 'pending' && (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                openUploadForRequest(req)
                                            }
                                            className="h-7 px-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded transition-colors shadow-2xs flex items-center gap-1 shrink-0 cursor-pointer"
                                        >
                                            <i className="ti ti-upload text-xs" />

                                            <span>Upload</span>
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {alerts.length > 0 && (
                    <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4 sm:p-5 shadow-2xs">
                        <div className="flex items-start gap-3">
                            <div className="h-8 w-8 shrink-0 bg-warning-subtle text-warning-ink rounded-md flex items-center justify-center">
                                <i className="ti ti-alert-triangle text-base" />
                            </div>

                            <div className="flex-1 min-w-0">
                                <p className="text-xs sm:text-sm font-bold text-warning-ink">
                                    {alerts.length} document
                                    {alerts.length > 1 ? 's need' : ' needs'}{' '}
                                    renewal
                                </p>

                                <p className="text-xs text-warning-ink font-medium mt-0.5">
                                    Please update or submit renewals before the
                                    expiry date.
                                </p>

                                <div className="flex flex-wrap gap-2 mt-2.5">
                                    {alerts.map(({ doc, status }) => (
                                        <span
                                            key={doc.id}
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}
                                        >
                                            <i
                                                className={`ti ${status.level === 'expired' ? 'ti-circle-x' : 'ti-clock'} text-xs`}
                                            />
                                            {doc.title || doc.file_name} ·{' '}
                                            {status.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200">
                    {/* Separation notice */}

                    {isTerminated && (
                        <div className="mb-5 p-4 rounded-md bg-danger-subtle border border-danger/20 flex items-start gap-3.5">
                            <div className="w-8 h-8 rounded-md bg-danger-subtle text-danger-ink flex items-center justify-center shrink-0 border border-danger/20">
                                <i className="ti ti-lock text-base font-bold" />
                            </div>

                            <div className="text-xs">
                                <p className="font-bold text-danger-ink uppercase tracking-wide">
                                    Personnel Vault Locked · Read-Only Access
                                </p>

                                <p className="text-danger-ink/90 mt-0.5 leading-relaxed font-medium">
                                    Official employment contract has concluded.
                                    Document uploads and file modifications are
                                    disabled. Historical records remain
                                    preserved below for your personal reference
                                    and clearance requirements.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                <i className="ti ti-folders text-lg" />
                            </div>

                            <div>
                                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                                    Personnel Documents
                                </h3>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                aria-label="Document review status"
                                value={docStatus}
                                onChange={(e) => setDocStatus(e.target.value)}
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                            >
                                {DOCUMENT_STATUSES.map((status) => (
                                    <option key={status.key} value={status.key}>
                                        {status.label}
                                    </option>
                                ))}
                            </select>

                            <select
                                aria-label="Document category"
                                value={docCategory}
                                onChange={(e) => setDocCategory(e.target.value)}
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                            >
                                {[
                                    'All',
                                    ...new Set([
                                        ...CATEGORIES,
                                        'Contract',
                                        'Certificate',
                                        'Performance',
                                        'Other',
                                    ]),
                                ].map((category) => (
                                    <option key={category}>{category}</option>
                                ))}
                            </select>

                            <select
                                aria-label="Document sort order"
                                value={docSort}
                                onChange={(e) => setDocSort(e.target.value)}
                                className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                            >
                                <option value="newest">Newest first</option>
                                <option value="oldest">Oldest first</option>
                            </select>

                            {(documents.length > 0 || docSearch) && (
                                <div className="relative">
                                    <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />

                                    <input
                                        type="text"
                                        maxLength={200}
                                        placeholder="Search files..."
                                        value={docSearch}
                                        onChange={(e) =>
                                            setDocSearch(e.target.value)
                                        }
                                        className="h-8 pl-7 pr-3 bg-slate-50 border border-slate-200 rounded-md outline-none focus:bg-white focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 w-36 sm:w-48"
                                    />
                                </div>
                            )}

                            <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md font-mono text-xs font-semibold whitespace-nowrap">
                                {filteredDocuments.length} File
                                {filteredDocuments.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>

                    {documentQuery.isPending ? (
                        <p className="py-8 text-center text-xs text-slate-500">
                            Loading documents…
                        </p>
                    ) : documents.length === 0 &&
                      (docStatus !== 'all' ||
                          docCategory !== 'All' ||
                          docSearch.trim()) ? (
                        <p className="py-8 text-center text-xs text-slate-500">
                            No documents match these filters.
                        </p>
                    ) : documents.length === 0 ? (
                        isTerminated ? (
                            <div className="text-center py-10 bg-slate-50 rounded-md border border-dashed border-slate-200 space-y-2">
                                <i className="ti ti-folder-off text-3xl text-slate-400 block" />

                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">
                                        No documents on file
                                    </p>

                                    <p className="text-[11px] text-slate-500">
                                        Document uploads are locked for
                                        separated employee accounts.
                                    </p>
                                </div>
                            </div>
                        ) : isAdminAccount ? (
                            <div className="text-center py-10 bg-slate-50 rounded-md border border-slate-200 space-y-2">
                                <i className="ti ti-shield-lock text-3xl text-slate-400 block" />

                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">
                                        Administrative Governance Account
                                    </p>

                                    <p className="text-[11px] text-slate-500">
                                        Personnel 201 compliance documents are
                                        not applicable to administrator
                                        profiles.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div
                                onClick={() => openUploadModal()}
                                className="text-center py-10 bg-slate-50 rounded-md border-2 border-dashed border-slate-200 space-y-2.5 cursor-pointer hover:border-slate-300 hover:bg-slate-100/50 transition-colors duration-100"
                            >
                                <i className="ti ti-folder-plus text-3xl text-slate-400 block" />

                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">
                                        No documents uploaded yet
                                    </p>

                                    <p className="text-[11px] text-slate-500">
                                        Click here or drag files to upload
                                        government IDs and certificates.
                                    </p>
                                </div>
                            </div>
                        )
                    ) : filteredDocuments.length === 0 ? (
                        <div className="text-center py-10 bg-slate-50 rounded-md border border-dashed border-slate-200">
                            <i className="ti ti-file-search text-3xl text-slate-400 block mb-1" />

                            <p className="font-semibold text-slate-600 text-xs">
                                No files match "{docSearch}"
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                            {filteredDocuments.map((doc) => {
                                const status = getExpiryStatus(doc);

                                const review = getDocumentStatus(doc);

                                return (
                                    <div
                                        key={doc.id}
                                        className="p-3.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-all duration-100 flex items-start gap-3 bg-white hover:shadow-2xs"
                                    >
                                        <DocumentThumbnail
                                            document={doc}
                                            size="md"
                                            onPreview={() =>
                                                handleOpenDocument(doc)
                                            }
                                        />

                                        <div className="min-w-0 flex-1">
                                            <p
                                                className="text-xs font-semibold text-slate-800 truncate cursor-pointer hover:text-accent transition-colors"
                                                title={
                                                    doc.title || doc.file_name
                                                }
                                                onClick={() =>
                                                    handleOpenDocument(doc)
                                                }
                                            >
                                                {doc.title || doc.file_name}
                                            </p>

                                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                <span
                                                    className={`rounded-md border px-1.5 text-[10px] font-semibold ${review.className}`}
                                                >
                                                    {review.label}
                                                </span>

                                                {doc.category && (
                                                    <span className="inline-block px-1.5 py-0.2 bg-surface-muted text-ink-muted font-semibold text-[10px] rounded-md border border-line">
                                                        {doc.category}
                                                    </span>
                                                )}

                                                {status && (
                                                    <span
                                                        className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}
                                                    >
                                                        {status.level ===
                                                        'valid'
                                                            ? 'Valid'
                                                            : status.label}
                                                    </span>
                                                )}
                                            </div>

                                            {review.key === 'rejected' &&
                                                doc.rejection_reason && (
                                                    <p className="mt-1 text-xs text-danger-ink">
                                                        {doc.rejection_reason}
                                                    </p>
                                                )}

                                            <p
                                                className="mt-1 text-[10px] text-slate-400 font-mono truncate"
                                                title={doc.file_name}
                                            >
                                                {doc.file_name} ·{' '}
                                                {formatFileSize(doc.file_size)}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {documentQuery.hasNextPage && (
                        <button
                            type="button"
                            disabled={documentQuery.isFetchingNextPage}
                            onClick={() => documentQuery.fetchNextPage()}
                            className="mt-4 rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold"
                        >
                            {documentQuery.isFetchingNextPage
                                ? 'Loading…'
                                : 'Load more documents'}
                        </button>
                    )}
                </div>
            </div>
            {showUploadModal && !isTerminated && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 overflow-y-auto">
                    <div className="bg-white rounded-lg p-5 sm:p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-5 my-auto max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 bg-accent-subtle text-accent rounded-md flex items-center justify-center shrink-0 border border-accent/20">
                                    <i className="ti ti-file-upload text-base" />
                                </div>

                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                                        Upload Document
                                    </h3>

                                    <p className="text-[11px] text-slate-500">
                                        Attach file to your permanent HR record
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    if (!isUploading) {
                                        setShowUploadModal(false);
                                        resetUploadForm();
                                    }
                                }}
                                disabled={isUploading}
                                className="h-7 w-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors duration-100 shrink-0 cursor-pointer"
                            >
                                <i className="ti ti-x text-xs" />
                            </button>
                        </div>

                        <form
                            onSubmit={handleUploadSubmit}
                            className="space-y-3.5"
                        >
                            {uploadForm.requestId && (
                                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-950 flex items-start gap-2.5">
                                    <i className="ti ti-alert-circle text-amber-600 text-sm mt-0.5 shrink-0" />

                                    <div className="text-xs">
                                        <div className="font-bold">
                                            Fulfilling HR Document Request
                                        </div>

                                        <div className="text-[11px] text-amber-800 mt-0.5">
                                            Submitting file for{' '}
                                            <span className="font-semibold underline">
                                                {uploadForm.documentType}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Document Type
                                </label>

                                <select
                                    value={selectedDocTypeId}
                                    onChange={(e) =>
                                        handleUploadDocTypeChange(
                                            e.target.value
                                        )
                                    }
                                    className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none cursor-pointer bg-white"
                                >
                                    {DOCUMENT_CATEGORIES.map((cat) => {
                                        const types = DOCUMENT_TYPES.filter(
                                            (t) => t.category === cat
                                        );

                                        if (types.length === 0) return null;

                                        return (
                                            <optgroup key={cat} label={cat}>
                                                {types.map((type) => (
                                                    <option
                                                        key={type.id}
                                                        value={type.id}
                                                    >
                                                        {type.label}{' '}
                                                        {type.is201Required
                                                            ? '(Required Document)'
                                                            : ''}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        );
                                    })}
                                </select>

                                {(() => {
                                    const currentMeta =
                                        getDocumentType(selectedDocTypeId);

                                    if (!currentMeta?.description) return null;

                                    return (
                                        <p className="text-[11px] text-slate-500 mt-1">
                                            {currentMeta.description}
                                        </p>
                                    );
                                })()}
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label
                                        htmlFor="upload-document-title"
                                        className="block text-xs font-semibold text-slate-700"
                                    >
                                        Document Title
                                    </label>

                                    <span
                                        id="upload-document-title-count"
                                        className="text-[10px] text-ink-muted"
                                    >
                                        {uploadForm.title.length}/
                                        {HUMAN_TEXT_LIMITS.title}
                                    </span>
                                </div>

                                <input
                                    maxLength={HUMAN_TEXT_LIMITS.title}
                                    id="upload-document-title"
                                    aria-describedby="upload-document-title-count"
                                    type="text"
                                    placeholder="e.g. SSS E-1 Form, Pag-IBIG MID, Valid ID"
                                    value={uploadForm.title}
                                    onChange={(e) =>
                                        setUploadForm({
                                            ...uploadForm,
                                            title: e.target.value.slice(
                                                0,
                                                HUMAN_TEXT_LIMITS.title
                                            ),
                                        })
                                    }
                                    className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Category
                                    </label>

                                    <input
                                        type="text"
                                        value={uploadForm.category}
                                        readOnly
                                        className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-500 bg-slate-50 cursor-not-allowed"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Expiry Date{' '}
                                        {(() => {
                                            const currentMeta =
                                                getDocumentType(
                                                    selectedDocTypeId
                                                );

                                            return currentMeta?.requiresExpiry ? (
                                                <span className="font-semibold text-amber-600">
                                                    (Recommended)
                                                </span>
                                            ) : (
                                                <span className="font-normal text-slate-400">
                                                    (Optional)
                                                </span>
                                            );
                                        })()}
                                    </label>

                                    <input
                                        type="date"
                                        value={uploadForm.expiryDate}
                                        onChange={(e) =>
                                            setUploadForm({
                                                ...uploadForm,
                                                expiryDate: e.target.value,
                                            })
                                        }
                                        className="w-full h-9 px-3 rounded-md border border-slate-200 text-xs font-medium text-slate-800 focus:border-slate-400 focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">
                                    Select File
                                </label>

                                <div className="relative border-2 border-dashed border-slate-200 rounded-md p-4 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors duration-100 cursor-pointer overflow-hidden min-h-[110px] flex items-center justify-center">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];

                                            if (file) {
                                                setUploadForm((prev) => ({
                                                    ...prev,

                                                    file,

                                                    title: (
                                                        prev.title ||
                                                        file.name.replace(
                                                            /\.[^/.]+$/,
                                                            ''
                                                        )
                                                    ).slice(
                                                        0,
                                                        HUMAN_TEXT_LIMITS.title
                                                    ),
                                                }));
                                            }
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();

                                            e.target.value = null;
                                        }}
                                        className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                                    />

                                    {(() => {
                                        if (!uploadForm.file) {
                                            return (
                                                <div className="z-0 py-1">
                                                    <i className="ti ti-cloud-upload text-2xl text-accent mb-1 block" />

                                                    <p className="text-xs font-semibold text-slate-700">
                                                        Tap here to choose file
                                                        / take photo
                                                    </p>

                                                    <p className="text-[10px] text-slate-400 mt-0.5">
                                                        PDF, Images (JPG, PNG,
                                                        WebP) up to 10MB
                                                    </p>
                                                </div>
                                            );
                                        }

                                        const cleanPreviewName =
                                            formatCleanDocumentFileName(
                                                uploadForm.title ||
                                                    uploadForm.documentType ||
                                                    'document',

                                                uploadForm.file.name
                                            );

                                        const isImage = isImageFile(
                                            uploadForm.file.name
                                        );

                                        const isPdf =
                                            uploadForm.file.type ===
                                                'application/pdf' ||
                                            uploadForm.file.name
                                                .toLowerCase()
                                                .endsWith('.pdf');

                                        return (
                                            <div className="w-full flex items-center gap-3 text-left z-0 p-1">
                                                <div className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center shadow-2xs">
                                                    {isImage ? (
                                                        <img
                                                            src={URL.createObjectURL(
                                                                uploadForm.file
                                                            )}
                                                            alt="Preview"
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : isPdf ? (
                                                        <div className="flex flex-col items-center justify-center text-rose-600">
                                                            <i className="ti ti-file-type-pdf text-2xl leading-none" />

                                                            <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                                                                PDF
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center text-slate-500">
                                                            <i
                                                                className={`ti ${getFileMeta(uploadForm.file.name).icon} text-2xl leading-none ${getFileMeta(uploadForm.file.name).color}`}
                                                            />

                                                            <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                                                                FILE
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                                                            <i className="ti ti-wand text-[10px]" />
                                                            Auto-renamed to
                                                        </span>

                                                        <span className="text-[10px] text-slate-400 font-medium">
                                                            (
                                                            {formatFileSize(
                                                                uploadForm.file
                                                                    .size
                                                            )}
                                                            )
                                                        </span>
                                                    </div>

                                                    <p
                                                        className="text-xs font-bold text-slate-800 font-mono truncate"
                                                        title={cleanPreviewName}
                                                    >
                                                        {cleanPreviewName}
                                                    </p>

                                                    <p
                                                        className="text-[10px] text-slate-400 truncate mt-0.5"
                                                        title={
                                                            uploadForm.file.name
                                                        }
                                                    >
                                                        Original:{' '}
                                                        {uploadForm.file.name}
                                                    </p>

                                                    <p className="text-[10px] text-accent font-semibold mt-1">
                                                        Tap to change file
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowUploadModal(false);
                                        resetUploadForm();
                                    }}
                                    disabled={isUploading}
                                    className="h-9 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors duration-100 disabled:opacity-50 cursor-pointer"
                                >
                                    Cancel
                                </button>

                                <button
                                    type="submit"
                                    disabled={isUploading || !uploadForm.file}
                                    className="h-9 px-4 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <i className="ti ti-upload" />{' '}
                                            Submit Document
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            <DocumentPreviewModal
                isOpen={Boolean(activePreviewDoc)}
                onClose={() => setActivePreviewDoc(null)}
                document={activePreviewDoc}
                isAdmin={false}
            />
        </div>
    );
}
