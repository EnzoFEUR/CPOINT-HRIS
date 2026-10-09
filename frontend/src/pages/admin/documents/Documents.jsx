import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import useEmployeeDocuments from '../../../utils/useEmployeeDocuments';
import { documentRequest, openEmployeeDocument, uploadEmployeeDocument } from '../../../utils/documentApi';
import { DOCUMENT_STATUSES, getDocumentStatus, getDocumentExpiry, formatDocumentSize } from '../../../utils/documentUtils';
import BulkImportModal from './BulkImportModal';

const CATEGORIES = [
    'All',
    'Contract',
    'Government ID',
    'Clearance',
    'Certificate',
    'Performance',
    'Other'
];

const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'name', label: 'Name (A-Z)' },
    { value: 'expiry', label: 'Expiry Date' },
];

const EXPIRABLE_CATEGORIES = ['Government ID', 'Clearance', 'Certificate'];

export default function Documents() {
    const [searchParams] = useSearchParams();
    const employeeId = searchParams.get('employee_id');
    const fileInputRef = useRef(null);

    // Document & Loading states
    const [actorId] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || '{}').id; } catch { return null; } });

    // Filter, search & sort states
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('newest');
    const [reviewStatus, setReviewStatus] = useState('all');
    const [openingDocument, setOpeningDocument] = useState(null);
    const [reviewingDocument, setReviewingDocument] = useState(null);
    const documentQuery = useEmployeeDocuments({ employeeId, actorId, status: reviewStatus, category: selectedCategory, sort: sortBy, search: searchQuery });
    const documents = documentQuery.documents;
    const employee = documentQuery.employee;
    const isTerminated = Boolean(documentQuery.uploadLocked);
    const isLoading = documentQuery.isPending;
    const fetchDocuments = documentQuery.refresh;
    const hasDocumentFilters = Boolean(searchQuery.trim() || reviewStatus !== 'all' || selectedCategory !== 'All');

    // Upload Modal states
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [documentTitle, setDocumentTitle] = useState('');
    const [category, setCategory] = useState('Contract');
    const [expiryDate, setExpiryDate] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const previewRef = useRef(null);
    const updateSelectedFile = (file) => {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        const url = file?.type?.startsWith('image/') ? URL.createObjectURL(file) : null;
        previewRef.current = url;
        setPreviewUrl(url);
        setSelectedFile(file);
    };
    useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
    const [isUploading, setIsUploading] = useState(false);
    const [isDraggingPage, setIsDraggingPage] = useState(false);
    const dragCounter = useRef(0);

    const formatFileSize = formatDocumentSize;
    const handleOpenDocument = async (id) => {
        setOpeningDocument(id);
        try { await openEmployeeDocument(id); }
        catch (error) { toast.error(error.message); }
        finally { setOpeningDocument(null); }
    };
    const handleReviewDocument = async (doc, status) => {
        const reason = status === 'rejected' ? window.prompt('Why is this document rejected?') : '';
        if (reason === null) return;
        if (status === 'rejected' && !reason.trim()) { toast.error('Please provide a rejection reason.'); return; }
        setReviewingDocument(doc.id);
        try {
            await documentRequest(`/api/documents/${doc.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, rejection_reason: reason }) });
            documentQuery.refresh();
            toast.success(status === 'approved' ? 'Document approved.' : 'Document rejected.');
        } catch (error) { toast.error(error.message); }
        finally { setReviewingDocument(null); }
    };

    // Get icon based on file extension
    const getFileIcon = (fileName = '') => {
        const ext = fileName.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext)) return 'ti-photo text-accent bg-accent-subtle';
        if (['pdf'].includes(ext)) return 'ti-file-type-pdf text-danger-ink bg-danger-subtle';
        if (['doc', 'docx'].includes(ext)) return 'ti-file-description text-accent bg-accent-subtle';
        return 'ti-file-text text-accent bg-accent-subtle';
    };

    const isImageFile = (fileName = '') => {
        const ext = fileName.split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext);
    };

    // ---- Expiry helpers ----
    const getExpiryStatus = getDocumentExpiry;

    const expiryBadgeStyles = {
        expired: 'bg-danger-subtle text-danger-ink border-danger/20',
        warning: 'bg-warning-subtle text-warning-ink border-warning/20',
        valid: 'bg-surface-muted text-ink border-line',
    };

    const alerts = useMemo(() => {
        return documents
            .map((doc) => ({ doc, status: getDocumentExpiry(doc) }))
            .filter(({ status }) => status && (status.level === 'expired' || status.level === 'warning'))
            .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    }, [documents]);

    const resetUploadForm = () => {
        setDocumentTitle('');
        updateSelectedFile(null);
        setCategory('Contract');
        setExpiryDate('');
    };

    const openModalWithFile = (file) => {
        if (isTerminated) {
            toast.error('Cannot upload documents: Employee account is separated/terminated.');
            return;
        }
        updateSelectedFile(file);
        setIsUploadModalOpen(true);
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            updateSelectedFile(e.target.files[0]);
        }
    };

    // Page-wide drag & drop handlers
    const handleDragEnter = (e) => {
        e.preventDefault();
        if (isTerminated) return;
        if (e.dataTransfer.types?.includes('Files')) {
            dragCounter.current += 1;
            setIsDraggingPage(true);
        }
    };
    const handleDragLeave = (e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setIsDraggingPage(false);
        }
    };
    const handleDragOver = (e) => e.preventDefault();
    const handleDrop = (e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDraggingPage(false);
        if (isTerminated) {
            toast.error('Cannot upload documents: Employee account is separated/terminated.');
            return;
        }
        const file = e.dataTransfer.files?.[0];
        if (file) openModalWithFile(file);
    };

    // 2. UPLOAD TO SUPABASE STORAGE 'documents' BUCKET & DATABASE
    const handleUploadSubmit = async (e) => {
        e.preventDefault();

        if (isTerminated) {
            toast.error('Document uploads are disabled for separated/terminated employee accounts.');
            return;
        }

        if (!selectedFile) {
            toast.error('Please select a file to upload.');
            return;
        }

        if (!employeeId) {
            toast.error('Employee ID is missing in the URL.');
            return;
        }

        setIsUploading(true);

        try {
            await uploadEmployeeDocument({ employeeId, file: selectedFile, title: documentTitle || selectedFile.name, category, expiryDate });
            documentQuery.refresh();
            toast.success('Document uploaded successfully!');

            setIsUploadModalOpen(false);
            resetUploadForm();
        } catch (error) {
            console.error('Upload error:', error);
            toast.error(error.message || 'Failed to upload document.');
        } finally {
            setIsUploading(false);
        }
    };

    // 3. DELETE FROM SUPABASE STORAGE 'documents' BUCKET & DATABASE
    const handleDeleteDocument = async (doc) => {
        if (!confirm('Are you sure you want to delete this document?')) return;

        try {
            await documentRequest(`/api/documents/${doc.id}`, { method: 'DELETE' });
            documentQuery.refresh();
            toast.success('Document deleted successfully.');
        } catch (error) {
            console.error('Delete error:', error);
            toast.error('Failed to delete document.');
        }
    };

    // Filtered + sorted documents calculation
    const filteredDocuments = useMemo(() => {
        let result = documents.filter((doc) => {
            const matchesCategory = selectedCategory === 'All' || doc.category === selectedCategory;
            const q = searchQuery.toLowerCase();
            const matchesSearch = (doc.title || '').toLowerCase().includes(q) || (doc.file_name || '').toLowerCase().includes(q);
            return matchesCategory && matchesSearch;
        });

        switch (sortBy) {
            case 'oldest':
                result = [...result].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                break;
            case 'name':
                result = [...result].sort((a, b) => (a.title || a.file_name || '').localeCompare(b.title || b.file_name || ''));
                break;
            case 'expiry':
                result = [...result].sort((a, b) => {
                    if (!a.expiry_date) return 1;
                    if (!b.expiry_date) return -1;
                    return new Date(a.expiry_date) - new Date(b.expiry_date);
                });
                break;
            default: // newest
                result = [...result].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return result;
    }, [documents, selectedCategory, searchQuery, sortBy]);

    const showExpiryField = EXPIRABLE_CATEGORIES.includes(category);


    return (
        <div
            className="relative max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* PAGE-WIDE DRAG OVERLAY */}
            {isDraggingPage && (
                <div
                    className="fixed inset-0 z-[60] bg-slate-950/20 flex items-center justify-center pointer-events-none"
                >
                    <div className="bg-white rounded-lg shadow-xl border-2 border-dashed border-slate-400 px-10 py-8 flex flex-col items-center">
                        <i className="ti ti-cloud-upload text-4xl text-slate-700 mb-2" />
                        <p className="font-bold text-slate-900 text-xs uppercase tracking-wider">Drop to Upload</p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">Files will be attached to this profile</p>
                    </div>
                </div>
            )}

            {/* TOP NAVIGATION */}
            <div className="flex items-center justify-between">
                <Link
                    to={employeeId ? `/admin/employees/${employeeId}` : '/admin/employees'}
                    className="h-8 px-3 bg-white text-slate-600 hover:text-slate-900 font-medium text-xs rounded-md hover:bg-slate-50 transition-colors duration-100 shadow-2xs border border-slate-200 flex items-center gap-2"
                >
                    <i className="ti ti-arrow-left text-base" /> Back to Profile
                </Link>

                {isTerminated ? (
                    <button
                        type="button"
                        disabled
                        title="Uploads disabled: Employee account is separated."
                        className="h-8 px-3 bg-slate-100 text-slate-400 border border-slate-200 font-medium text-xs rounded-md shadow-2xs flex items-center gap-1.5 cursor-not-allowed select-none"
                    >
                        <i className="ti ti-lock text-sm" /> Uploads disabled
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        {employeeId && (
                            <button
                                type="button"
                                onClick={() => setIsBulkImportOpen(true)}
                                className="h-8 px-3 bg-white text-slate-700 border border-slate-200 font-medium text-xs rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors duration-100 shadow-2xs flex items-center gap-1.5 cursor-pointer"
                            >
                                <i className="ti ti-file-zip text-base" /> Bulk import
                            </button>
                        )}
                        <button
                            onClick={() => setIsUploadModalOpen(true)}
                            className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md shadow-2xs transition-colors duration-100 flex items-center gap-1.5 cursor-pointer"
                        >
                            <i className="ti ti-upload text-base" /> Upload document
                        </button>
                    </div>
                )}
            </div>

            {/* Header */}
            <div className={`bg-white rounded-lg shadow-2xs border ${isTerminated ? 'border-danger/20' : 'border-slate-200'} p-5 sm:p-6`}>
                <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 ${isTerminated ? 'bg-danger-subtle text-danger-ink border-danger/20' : 'bg-slate-100 text-slate-700 border-slate-200'} rounded-md flex items-center justify-center border shrink-0`}>
                        <i className={`ti ${isTerminated ? 'ti-file-off' : 'ti-folders'} text-xl`} />
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Documents</h1>
                            {isTerminated && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                                    <i className="ti ti-lock text-xs" /> Separated · Read-only audit
                                </span>
                            )}
                        </div>
                        <p className="text-slate-500 text-xs font-medium mt-0.5">
                            {employee 
                                ? `${employee.first_name} ${employee.last_name} (${employee.company_id || 'No ID'}) · ${employee.department || 'Staff'}` 
                                : employeeId 
                                ? `Managing files for Employee ID: ${employeeId}` 
                                : 'Company employee documents and records'}
                        </p>
                    </div>
                </div>
            </div>

            {/* TERMINATED AUDIT BANNER */}
            {isTerminated && (
                <div className="bg-danger-subtle border border-danger/20 rounded-lg p-4 shadow-2xs">
                    <div className="flex items-start gap-3">
                        <div className="h-8 w-8 shrink-0 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center border border-danger/20">
                            <i className="ti ti-lock text-lg" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h4 className="text-xs font-bold text-danger-ink uppercase tracking-wide">
                                    Document uploads disabled (separated account)
                                </h4>
                                <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-danger-subtle text-danger-ink">
                                    Read-only audit mode
                                </span>
                            </div>
                            <p className="text-xs text-danger-ink/90 leading-relaxed font-medium">
                                This employee is separated from the company. Under Philippine labor rules, document uploads and edits are locked. Historical 201 records remain available below for review and export.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* COMPLIANCE ALERTS */}
            {alerts.length > 0 && (
                <div className="bg-warning-subtle border border-warning/20 rounded-lg p-4 shadow-2xs">
                    <div className="flex items-start gap-3">
                        <div className="h-8 w-8 shrink-0 bg-warning-subtle text-warning-ink rounded-md flex items-center justify-center">
                            <i className="ti ti-alert-triangle text-base" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-warning-ink">
                                {alerts.length} document{alerts.length > 1 ? 's need' : ' needs'} attention
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {alerts.map(({ doc, status }) => (
                                    <span
                                        key={doc.id}
                                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border text-[11px] font-medium ${expiryBadgeStyles[status.level]}`}
                                    >
                                        <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : 'ti-clock'} text-xs`} />
                                        {doc.title} · {status.level === 'expired' ? `Expired ${Math.abs(status.daysLeft)}d ago` : status.label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {documentQuery.error && <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{documentQuery.error.message} <button type="button" onClick={() => documentQuery.refetch()} className="ml-2 font-semibold underline">Retry</button></div>}
            {/* CONTROLS */}
            <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                    <div className="relative w-full sm:w-80">
                        <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base" />
                        <input
                            type="text"
                            placeholder="Search documents..."
                            maxLength={200}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-9 pl-9 pr-3 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-700 transition-colors duration-100 shadow-2xs"
                        />
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        <select aria-label="Document review status" value={reviewStatus} onChange={event => setReviewStatus(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs">
                            {DOCUMENT_STATUSES.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
                        </select>
                        <div className="relative">
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="appearance-none h-9 pl-3 pr-8 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-700 transition-colors duration-100 shadow-2xs cursor-pointer"
                            >
                                {SORT_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
                        </div>

                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                            {filteredDocuments.length} file{filteredDocuments.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    {CATEGORIES.map((cat) => {
                        const count = cat === 'All' ? documents.length : documents.filter((d) => d.category === cat).length;
                        return (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`h-7 px-2.5 rounded-md font-medium text-xs whitespace-nowrap transition-colors duration-100 flex items-center gap-1.5 ${
                                    selectedCategory === cat
                                        ? 'bg-slate-900 text-white shadow-2xs'
                                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                }`}
                            >
                                {cat}
                                {count > 0 && (
                                    <span className={`text-[10px] font-mono px-1 rounded-sm border ${selectedCategory === cat ? 'bg-slate-800 text-slate-200 border-slate-700' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* FILE GRID / LOADING / EMPTY STATE */}
            {isLoading ? (
                <div className="py-20 flex flex-col items-center justify-center text-slate-400">
                    <i className="ti ti-loader animate-spin text-4xl text-accent mb-2" />
                    <p className="text-xs font-semibold text-slate-500">Loading documents...</p>
                </div>
            ) : filteredDocuments.length === 0 ? (
                <div
                    onClick={() => !isTerminated && !hasDocumentFilters && documents.length === 0 && setIsUploadModalOpen(true)}
                    className={`border border-dashed border-slate-200 rounded-lg p-10 flex flex-col items-center justify-center text-slate-400 bg-white shadow-2xs ${!isTerminated && documents.length === 0 ? 'cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors duration-100' : ''}`}
                >
                    <i className="ti ti-file-x text-4xl mb-2 text-slate-300" />
                    <p className="text-xs font-semibold text-slate-700">
                        {documents.length === 0 && !hasDocumentFilters ? (isTerminated ? 'No archived documents on file' : 'No documents uploaded yet') : 'No matching documents found'}
                    </p>
                    <p className="text-xs text-slate-500 font-medium mt-0.5 text-center">
                        {documents.length === 0 && !hasDocumentFilters
                            ? (isTerminated ? 'This separated employee has no archived documents on record.' : 'Click here or drag and drop a file anywhere on this page.') 
                            : 'Try adjusting your search query or selected category filter.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                    {filteredDocuments.map((doc) => {
                        const iconClasses = getFileIcon(doc.file_name);
                        const status = getExpiryStatus(doc);
                        const review = getDocumentStatus(doc);

                        return (
                            <div
                                key={doc.id}
                                className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:shadow-xs transition-colors duration-100 flex flex-col justify-between group"
                            >
                                <div>
                                    <div className="flex items-start justify-between gap-3 mb-2.5">
                                        <div className={`h-9 w-9 rounded-md flex items-center justify-center shrink-0 border border-slate-200/60 ${iconClasses}`}>
                                            <i className={`ti ${iconClasses.split(' ')[0]} text-lg`} />
                                        </div>
                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-medium text-[10px] uppercase tracking-wider rounded-sm border border-slate-200/60">
                                            {doc.category}
                                        </span>
                                    </div>

                                    <h3 className="font-semibold text-slate-900 text-sm tracking-tight line-clamp-1 group-hover:text-slate-700 transition-colors duration-100" title={doc.title}>
                                        {doc.title}
                                    </h3>
                                    {doc.employees && (
                                        <p className="text-[11px] font-medium text-slate-600 mt-0.5 truncate">
                                            <i className="ti ti-user text-xs mr-1 text-slate-400" />
                                            {doc.employees.first_name} {doc.employees.last_name} ({doc.employees.company_id || 'N/A'})
                                        </p>
                                    )}
                                    <p className="text-slate-400 text-xs font-mono truncate mt-0.5" title={doc.file_name}>
                                        {doc.file_name}
                                    </p>

                                    <span className={`inline-flex mt-2 rounded border px-2 py-0.5 text-[10px] font-medium ${review.className}`}>{review.label}</span>
                                    {review.key === 'rejected' && doc.rejection_reason && <p className="mt-1 text-xs text-rose-700">{doc.rejection_reason}</p>}
                                    {status && (
                                        <span className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-sm border text-[10px] font-medium ${expiryBadgeStyles[status.level]}`}>
                                            <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : status.level === 'warning' ? 'ti-clock' : 'ti-circle-check'} text-xs`} />
                                            {status.level === 'expired' ? `Expired ${Math.abs(status.daysLeft)}d ago` : status.level === 'warning' ? status.label : `Valid · exp. ${doc.expiry_date}`}
                                        </span>
                                    )}
                                </div>

                                <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 font-medium">
                                    <div>
                                        <p className="text-[11px] text-slate-600 font-medium">
                                            {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </p>
                                        <p className="text-[10px] text-slate-400 font-mono">{formatFileSize(doc.file_size)}</p>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button type="button" onClick={() => handleOpenDocument(doc.id)} disabled={openingDocument === doc.id} aria-label={`Open ${doc.title || doc.file_name}`} className="w-7 h-7 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-md" title="View / Download">
                                            <i className={`ti ${openingDocument === doc.id ? 'ti-loader animate-spin' : 'ti-download'} text-base`} />
                                        </button>
                                        {review.key !== 'approved' && <button type="button" disabled={reviewingDocument === doc.id} onClick={() => handleReviewDocument(doc, 'approved')} className="text-xs text-emerald-700 font-semibold px-1" title="Approve document">Approve</button>}
                                        {review.key !== 'rejected' && <button type="button" disabled={reviewingDocument === doc.id} onClick={() => handleReviewDocument(doc, 'rejected')} className="text-xs text-rose-700 font-semibold px-1" title="Reject document">Reject</button>}
                                        <button
                                            onClick={() => handleDeleteDocument(doc)}
                                            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-danger-ink hover:bg-danger-subtle rounded-md transition-colors duration-100 cursor-pointer"
                                            title="Delete"
                                        >
                                            <i className="ti ti-trash text-base" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {documentQuery.hasNextPage && <button type="button" disabled={documentQuery.isFetchingNextPage} onClick={() => documentQuery.fetchNextPage()} className="rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold">{documentQuery.isFetchingNextPage ? 'Loading…' : 'Load more documents'}</button>}
            {/* BULK IMPORT MODAL */}
            <BulkImportModal
                isOpen={isBulkImportOpen}
                onClose={() => setIsBulkImportOpen(false)}
                employeeId={employeeId}
                employeeName={employee ? `${employee.first_name} ${employee.last_name} (${employee.company_id || 'No ID'})` : employeeId}
                isTerminated={isTerminated}
                categories={CATEGORIES.filter((c) => c !== 'All')}
                onImported={fetchDocuments}
            />

            {/* UPLOAD DOCUMENT MODAL */}
            {isUploadModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={() => !isUploading && setIsUploadModalOpen(false)}
                    />

                    <div
                        className="relative bg-white rounded-lg p-5 sm:p-6 shadow-xl w-full max-w-lg border border-slate-200 z-10 max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-4">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 bg-slate-100 text-slate-700 rounded-md flex items-center justify-center border border-slate-200">
                                    <i className="ti ti-file-upload text-base" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-bold text-slate-900">Upload Document</h2>
                                    <p className="text-xs text-slate-500 font-medium">Attach PDF, images, or documents</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsUploadModalOpen(false)}
                                className="w-8 h-8 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md flex items-center justify-center transition-colors duration-100"
                                disabled={isUploading}
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        <form onSubmit={handleUploadSubmit} className="space-y-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                    Document title
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g. Employment Contract, NBI Clearance"
                                    value={documentTitle}
                                    onChange={(e) => setDocumentTitle(e.target.value)}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 shadow-2xs"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                        Category
                                    </label>
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 shadow-2xs cursor-pointer"
                                    >
                                        {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                        Expiry date {!showExpiryField && <span className="normal-case font-normal text-slate-400">(optional)</span>}
                                    </label>
                                    <input
                                        type="date"
                                        value={expiryDate}
                                        onChange={(e) => setExpiryDate(e.target.value)}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 shadow-2xs"
                                    />
                                </div>
                            </div>

                            {showExpiryField && (
                                <p className="-mt-1 text-[11px] text-slate-500 font-medium flex items-center gap-1">
                                    <i className="ti ti-info-circle text-xs text-slate-400" /> System will notify you before this document expires.
                                </p>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                    File
                                </label>
                                <div className="relative border border-dashed border-slate-200 rounded-md p-4 text-center hover:bg-slate-50 hover:border-slate-300 transition-colors duration-100">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        onChange={handleFileChange}
                                        accept="image/*,application/pdf,.doc,.docx"
                                        className="absolute inset-0 w-full h-full opacity-0 z-10 cursor-pointer"
                                    />

                                    {selectedFile ? (
                                        <div className="flex items-center justify-between gap-3 bg-white p-2 rounded-md border border-slate-200 shadow-2xs relative z-20">
                                            <div className="flex items-center gap-2.5 overflow-hidden">
                                                {isImageFile(selectedFile.name) ? (
                                                    <img
                                                        src={previewUrl || undefined}
                                                        alt="Preview"
                                                        className="h-8 w-8 rounded-md object-cover border border-slate-200 shrink-0"
                                                    />
                                                ) : (
                                                    <div className="h-8 w-8 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200">
                                                        <i className="ti ti-file-text text-base" />
                                                    </div>
                                                )}
                                                <div className="text-left overflow-hidden">
                                                    <p className="text-xs font-medium text-slate-800 truncate">
                                                        {selectedFile.name}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 font-mono">
                                                        {formatFileSize(selectedFile.size)}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    updateSelectedFile(null);
                                                    if (fileInputRef.current) fileInputRef.current.value = '';
                                                }}
                                                className="w-7 h-7 text-slate-400 hover:text-danger-ink hover:bg-danger-subtle rounded-md flex items-center justify-center transition-colors duration-100 shrink-0 cursor-pointer"
                                            >
                                                <i className="ti ti-trash text-sm" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="pointer-events-none space-y-0.5">
                                            <i className="ti ti-cloud-upload text-2xl text-slate-400 block" />
                                            <p className="text-xs font-medium text-slate-700">
                                                Choose file or drag here
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-medium">
                                                PDF, PNG, JPG, or DOC up to 10MB
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="pt-2 flex gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => setIsUploadModalOpen(false)}
                                    disabled={isUploading}
                                    className="flex-1 h-9 bg-white border border-slate-200 text-slate-700 font-medium rounded-md hover:bg-slate-50 transition-colors duration-100 text-xs shadow-2xs cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUploading || !selectedFile}
                                    className="flex-1 h-9 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded-md shadow-2xs transition-colors duration-100 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                    {isUploading ? (
                                        <><i className="ti ti-loader animate-spin text-base" /> Uploading...</>
                                    ) : (
                                        'Save document'
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            

        </div>
    );
}
