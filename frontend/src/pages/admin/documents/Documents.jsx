import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../../utils/api';
import useEmployeeDocuments from '../../../utils/useEmployeeDocuments';
import useDocumentRequests from '../../../utils/useDocumentRequests';
import { documentRequest, uploadEmployeeDocument, cancelDocumentRequest, remindDocumentRequest, fetchEmployeeCompliance, reviewDocumentStatus } from '../../../utils/documentApi';
import {
    getDocumentExpiry,
    formatDocumentSize,
    formatCleanDocumentFileName
} from '../../../utils/documentUtils';
import {
    DOCUMENT_TYPES,
    DOCUMENT_CATEGORIES,
    getDocumentType
} from '../../../../../shared/documentTypes.mjs';
import BulkImportModal from './BulkImportModal';
import RequestDocumentModal from './RequestDocumentModal';
import RejectDocumentModal from './RejectDocumentModal';
import DocumentThumbnail from '../../../components/DocumentThumbnail';
import DocumentPreviewModal from '../../../components/DocumentPreviewModal';

const CATEGORIES = ['All', ...DOCUMENT_CATEGORIES];

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
    const queryClient = useQueryClient();

    // Document & Loading states
    const currentUser = useMemo(() => {
        try { return JSON.parse(localStorage.getItem('user') || '{}'); }
        catch { return null; }
    }, []);

    const [actorId] = useState(() => {
        try { return JSON.parse(localStorage.getItem('user') || '{}').id; }
        catch { return null; }
    });

    const [targetEmployeeId, setTargetEmployeeId] = useState(() => employeeId || '');

    const [previousEmployeeId, setPreviousEmployeeId] = useState(employeeId);
    if (previousEmployeeId !== employeeId) {
        setPreviousEmployeeId(employeeId);
        if (employeeId) setTargetEmployeeId(employeeId);
    }

    // Active personnel list for target selection (workforce employees only, strictly excluding admin governance accounts)
    const { data: employeeOptions = [] } = useQuery({
        queryKey: ['adminEmployeesListForDocs'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/employees?limit=250&status=active');
            const data = await res.json();
            return data?.data?.employees || data?.employees || [];
        },
        staleTime: 60000,
    });

    const workforceOptions = useMemo(() => {
        return (employeeOptions || []).filter(e => e.role !== 'admin');
    }, [employeeOptions]);

    // View tabs: 'vault' | 'requests'
    const [activeTab, setActiveTab] = useState('vault');

    // Filter, search & sort states
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('newest');
    const statusParam = searchParams.get('status');
    const [selectedStatusFilter, setSelectedStatusFilter] = useState(() => {
        return statusParam && ['pending', 'approved', 'rejected', 'expiring', 'all'].includes(statusParam)
            ? statusParam
            : 'all';
    });
    const [lastSyncedStatus, setLastSyncedStatus] = useState(statusParam);
    if (statusParam !== lastSyncedStatus) {
        setLastSyncedStatus(statusParam);
        if (statusParam && ['pending', 'approved', 'rejected', 'expiring', 'all'].includes(statusParam)) {
            setSelectedStatusFilter(statusParam);
        }
    }
    const statusPillFilter = selectedStatusFilter;
    const setStatusPillFilter = setSelectedStatusFilter;
    const [requestStatusFilter, setRequestStatusFilter] = useState('all');
    const [reviewingDocument, setReviewingDocument] = useState(null);
    const [vaultViewMode, setVaultViewMode] = useState('grid');
    const [rejectingDoc, setRejectingDoc] = useState(null);
    const [isSubmittingRejection, setIsSubmittingRejection] = useState(false);

    // Queries
    const documentQuery = useEmployeeDocuments({
        employeeId,
        actorId,
        status: 'all',
        category: 'All',
        sort: sortBy,
        search: ''
    });
    const documents = documentQuery.documents;
    const employee = documentQuery.employee;
    const isTerminated = Boolean(documentQuery.uploadLocked);
    const isLoading = documentQuery.isPending;
    const fetchDocuments = documentQuery.refresh;
    const hasDocumentFilters = Boolean(searchQuery.trim() || statusPillFilter !== 'all' || selectedCategory !== 'All');

    // Real-time Document Requests Query
    const requestQuery = useDocumentRequests({ employeeId, actorId, status: requestStatusFilter });
    const requests = requestQuery.requests;
    const pendingRequestsCount = requests.filter(r => ['pending', 'submitted'].includes(r.status)).length;

    // Statutory Compliance State
    const [complianceData, setComplianceData] = useState(null);
    const [isLoadingCompliance, setIsLoadingCompliance] = useState(Boolean(employeeId));
    const [actioningRequestId, setActioningRequestId] = useState(null);

    useEffect(() => {
        if (!employeeId) return;
        let isMounted = true;
        fetchEmployeeCompliance(employeeId)
            .then(data => { if (isMounted) setComplianceData(data); })
            .catch(err => console.warn('[COMPLIANCE_LOAD_ERR]', err.message))
            .finally(() => { if (isMounted) setIsLoadingCompliance(false); });
        return () => { isMounted = false; };
    }, [employeeId, documents.length, requests.length]);

    // Modal states
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
    const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
    const [preselectedDocType, setPreselectedDocType] = useState('tin');

    // Form states for manual single upload
    const [selectedDocTypeId, setSelectedDocTypeId] = useState('employment_contract');
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

    useEffect(() => () => {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    }, []);

    const [isUploading, setIsUploading] = useState(false);
    const [isDraggingPage, setIsDraggingPage] = useState(false);
    const dragCounter = useRef(0);

    const [activePreviewDoc, setActivePreviewDoc] = useState(null);
    const formatFileSize = formatDocumentSize;

    const handleOpenDocument = (docOrId) => {
        if (typeof docOrId === 'object' && docOrId !== null) {
            setActivePreviewDoc(docOrId);
            return;
        }
        const found = documents.find(d => d.id === docOrId);
        if (found) {
            setActivePreviewDoc(found);
        } else {
            setActivePreviewDoc({ id: docOrId });
        }
    };

    const handleApproveDocument = async (doc) => {
        if (!doc) return;
        setReviewingDocument(doc.id);
        const targetDocId = doc.id;
        const previousStatus = doc.status;
        const previousReviewedAt = doc.reviewed_at;

        // Optimistic cache update for 0ms perceived latency
        queryClient.setQueriesData({ queryKey: ['employeeDocuments'] }, (oldData) => {
            if (!oldData || !oldData.pages) return oldData;
            return {
                ...oldData,
                pages: oldData.pages.map(page => ({
                    ...page,
                    documents: (page.documents || []).map(d => d.id === targetDocId ? { ...d, status: 'approved', reviewed_at: new Date().toISOString() } : d)
                }))
            };
        });
        setActivePreviewDoc(prev => (prev && prev.id === targetDocId ? { ...prev, status: 'approved', reviewed_at: new Date().toISOString() } : prev));

        try {
            await reviewDocumentStatus({ documentId: targetDocId, status: 'approved' });
            toast.success(`Approved: ${doc.title || doc.file_name}`);
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['adminDocumentPendingCounts'] });
            if (employeeId) {
                fetchEmployeeCompliance(employeeId).then(setComplianceData).catch(() => {});
            }
        } catch (error) {
            // Rollback optimistic update
            queryClient.setQueriesData({ queryKey: ['employeeDocuments'] }, (oldData) => {
                if (!oldData || !oldData.pages) return oldData;
                return {
                    ...oldData,
                    pages: oldData.pages.map(page => ({
                        ...page,
                        documents: (page.documents || []).map(d => d.id === targetDocId ? { ...d, status: previousStatus, reviewed_at: previousReviewedAt } : d)
                    }))
                };
            });
            setActivePreviewDoc(prev => (prev && prev.id === targetDocId ? { ...prev, status: previousStatus, reviewed_at: previousReviewedAt } : prev));
            toast.error(error.message || 'Failed to approve document.');
        } finally {
            setReviewingDocument(null);
        }
    };

    const handleOpenRejectModal = (doc) => {
        const target = doc || activePreviewDoc;
        setActivePreviewDoc(null);
        setRejectingDoc(target);
    };

    const handleConfirmReject = async (rejectionReason) => {
        if (!rejectingDoc) return;
        setIsSubmittingRejection(true);
        const doc = rejectingDoc;
        const targetDocId = doc.id;
        const previousStatus = doc.status;
        const previousReason = doc.rejection_reason;
        const previousReviewedAt = doc.reviewed_at;

        // Optimistic cache update for 0ms perceived latency
        queryClient.setQueriesData({ queryKey: ['employeeDocuments'] }, (oldData) => {
            if (!oldData || !oldData.pages) return oldData;
            return {
                ...oldData,
                pages: oldData.pages.map(page => ({
                    ...page,
                    documents: (page.documents || []).map(d => d.id === targetDocId ? {
                        ...d,
                        status: 'rejected',
                        rejection_reason: rejectionReason,
                        reviewed_at: new Date().toISOString()
                    } : d)
                }))
            };
        });
        setActivePreviewDoc(null);

        try {
            await reviewDocumentStatus({
                documentId: targetDocId,
                status: 'rejected',
                rejectionReason
            });
            toast.success(`Document marked as rejected: ${doc.title || doc.file_name}`);
            setRejectingDoc(null);
            setActivePreviewDoc(null);
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['adminDocumentPendingCounts'] });
            if (employeeId) {
                fetchEmployeeCompliance(employeeId).then(setComplianceData).catch(() => {});
            }
        } catch (error) {
            // Rollback optimistic update
            queryClient.setQueriesData({ queryKey: ['employeeDocuments'] }, (oldData) => {
                if (!oldData || !oldData.pages) return oldData;
                return {
                    ...oldData,
                    pages: oldData.pages.map(page => ({
                        ...page,
                        documents: (page.documents || []).map(d => d.id === targetDocId ? {
                            ...d,
                            status: previousStatus,
                            rejection_reason: previousReason,
                            reviewed_at: previousReviewedAt
                        } : d)
                    }))
                };
            });
            setActivePreviewDoc(prev => (prev && prev.id === targetDocId ? {
                ...prev,
                status: previousStatus,
                rejection_reason: previousReason,
                reviewed_at: previousReviewedAt
            } : prev));
            toast.error(error.message || 'Failed to reject document.');
        } finally {
            setIsSubmittingRejection(false);
        }
    };

    const handleReopenDocument = async (doc) => {
        if (!doc) return;
        const confirmMsg = doc.status === 'rejected'
            ? `Reopen review for "${doc.title || doc.file_name}"? This will clear the rejection remarks and return the document to pending review.`
            : `Reopen review for "${doc.title || doc.file_name}"? This will return the approved record to pending review status.`;
        if (!window.confirm(confirmMsg)) return;

        setReviewingDocument(doc.id);
        const targetDocId = doc.id;
        const previousStatus = doc.status;
        const previousReason = doc.rejection_reason;
        const previousReviewedAt = doc.reviewed_at;

        // Optimistic cache update for 0ms perceived latency
        queryClient.setQueriesData({ queryKey: ['employeeDocuments'] }, (oldData) => {
            if (!oldData || !oldData.pages) return oldData;
            return {
                ...oldData,
                pages: oldData.pages.map(page => ({
                    ...page,
                    documents: (page.documents || []).map(d => d.id === targetDocId ? {
                        ...d,
                        status: 'pending',
                        rejection_reason: null,
                        reviewed_at: null
                    } : d)
                }))
            };
        });
        setActivePreviewDoc(prev => (prev && prev.id === targetDocId ? {
            ...prev,
            status: 'pending',
            rejection_reason: null,
            reviewed_at: null
        } : prev));

        try {
            await reviewDocumentStatus({ documentId: targetDocId, status: 'pending' });
            toast.success(`Review reopened for: ${doc.title || doc.file_name}`);
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['adminDocumentPendingCounts'] });
            if (employeeId) {
                fetchEmployeeCompliance(employeeId).then(setComplianceData).catch(() => {});
            }
        } catch (error) {
            // Rollback optimistic update
            queryClient.setQueriesData({ queryKey: ['employeeDocuments'] }, (oldData) => {
                if (!oldData || !oldData.pages) return oldData;
                return {
                    ...oldData,
                    pages: oldData.pages.map(page => ({
                        ...page,
                        documents: (page.documents || []).map(d => d.id === targetDocId ? {
                            ...d,
                            status: previousStatus,
                            rejection_reason: previousReason,
                            reviewed_at: previousReviewedAt
                        } : d)
                    }))
                };
            });
            setActivePreviewDoc(prev => (prev && prev.id === targetDocId ? {
                ...prev,
                status: previousStatus,
                rejection_reason: previousReason,
                reviewed_at: previousReviewedAt
            } : prev));
            toast.error(error.message || 'Failed to reopen document review.');
        } finally {
            setReviewingDocument(null);
        }
    };

    const handleCancelRequest = async (requestId) => {
        if (!window.confirm('Are you sure you want to cancel this document request?')) return;
        setActioningRequestId(requestId);
        try {
            await cancelDocumentRequest(requestId);
            toast.success('Document request cancelled.');
            requestQuery.refresh();
        } catch (err) {
            toast.error(err.message || 'Failed to cancel request');
        } finally {
            setActioningRequestId(null);
        }
    };

    const handleRemindRequest = async (requestId) => {
        setActioningRequestId(requestId);
        try {
            await remindDocumentRequest(requestId);
            toast.success('Reminder notification sent to employee.');
        } catch (err) {
            toast.error(err.message || 'Failed to send reminder');
        } finally {
            setActioningRequestId(null);
        }
    };



    const isImageFile = (fileName = '') => {
        const ext = fileName.split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext);
    };

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
        setSelectedDocTypeId('employment_contract');
        setCategory('Contract');
        setExpiryDate('');
        setTargetEmployeeId(employeeId || '');
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
        if (dragCounter.current === 0) setIsDraggingPage(false);
    };

    const handleDragOver = (e) => { e.preventDefault(); };

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

    const handleDocTypeSelectChange = (e) => {
        const typeId = e.target.value;
        setSelectedDocTypeId(typeId);
        const meta = getDocumentType(typeId);
        if (meta) {
            setCategory(meta.category);
            if (!documentTitle || DOCUMENT_TYPES.some(t => t.label === documentTitle)) {
                setDocumentTitle(meta.label);
            }
        }
    };

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
        const effectiveEmployeeId = employeeId || targetEmployeeId;
        if (!effectiveEmployeeId) {
            toast.error('Please select a workforce employee account for this document.');
            return;
        }
        if (currentUser?.id && effectiveEmployeeId === currentUser.id) {
            toast.error('Document uploads are disabled for administrator governance accounts.');
            return;
        }

        setIsUploading(true);
        try {
            const meta = getDocumentType(selectedDocTypeId);
            const resolvedTitle = documentTitle.trim() || meta?.label || selectedFile.name.replace(/\.[^/.]+$/, '');
            const cleanFileName = formatCleanDocumentFileName(resolvedTitle, selectedFile.name);
            const renamedFile = selectedFile.name === cleanFileName ? selectedFile : new File([selectedFile], cleanFileName, { type: selectedFile.type });

            await uploadEmployeeDocument({
                employeeId: effectiveEmployeeId,
                file: renamedFile,
                title: resolvedTitle,
                category,
                documentType: meta?.label || null,
                expiryDate: expiryDate || null
            });
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['adminDocumentPendingCounts'] });
            queryClient.invalidateQueries({ queryKey: ['employeeDocuments'] });
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

    const handleDeleteDocument = async (doc) => {
        if (!doc) return;
        const targetTitle = doc.title || doc.file_name || 'this document';
        if (!window.confirm(`Permanently delete "${targetTitle}"? This will remove the file from storage and cannot be undone.`)) return;
        try {
            await documentRequest(`/api/documents/${doc.id}`, { method: 'DELETE' });
            setActivePreviewDoc(null);
            documentQuery.refresh();
            requestQuery.refresh();
            queryClient.invalidateQueries({ queryKey: ['adminDocumentPendingCounts'] });
            toast.success('Document deleted successfully.');
        } catch (error) {
            console.error('Delete error:', error);
            toast.error('Failed to delete document.');
        }
    };

    const vaultMetrics = useMemo(() => {
        let pending = 0;
        let approved = 0;
        let rejected = 0;
        let expiring = 0;

        for (const doc of documents) {
            const st = String(doc.status || '').toLowerCase();
            if (st === 'approved') approved++;
            else if (st === 'rejected') rejected++;
            else pending++;

            const exp = getDocumentExpiry(doc);
            if (exp && (exp.level === 'warning' || exp.level === 'expired')) {
                expiring++;
            }
        }

        return {
            total: documents.length,
            pending,
            approved,
            rejected,
            expiring
        };
    }, [documents]);

    const filteredDocuments = useMemo(() => {
        let result = documents.filter((doc) => {
            const matchesCategory = selectedCategory === 'All' || doc.category === selectedCategory;
            const q = searchQuery.toLowerCase().trim();
            const empName = doc.employees ? `${doc.employees.first_name || ''} ${doc.employees.last_name || ''} ${doc.employees.company_id || ''}`.toLowerCase() : '';
            const matchesSearch = !q || 
                (doc.title || '').toLowerCase().includes(q) || 
                (doc.file_name || '').toLowerCase().includes(q) || 
                (doc.category || '').toLowerCase().includes(q) ||
                empName.includes(q);

            let matchesStatus = true;
            const st = String(doc.status || '').toLowerCase();
            if (statusPillFilter === 'pending') {
                matchesStatus = st === 'pending' || st === 'to_review' || !doc.status;
            } else if (statusPillFilter === 'approved') {
                matchesStatus = st === 'approved';
            } else if (statusPillFilter === 'rejected') {
                matchesStatus = st === 'rejected';
            } else if (statusPillFilter === 'expiring') {
                const exp = getDocumentExpiry(doc);
                matchesStatus = Boolean(exp && (exp.level === 'warning' || exp.level === 'expired'));
            }

            return matchesCategory && matchesSearch && matchesStatus;
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
            default:
                result = [...result].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return result;
    }, [documents, selectedCategory, searchQuery, sortBy, statusPillFilter]);

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
                <div className="fixed inset-0 z-[60] bg-slate-950/20 flex items-center justify-center pointer-events-none">
                    <div className="bg-white rounded-lg shadow-xl border-2 border-dashed border-slate-400 px-10 py-8 flex flex-col items-center">
                        <i className="ti ti-cloud-upload text-4xl text-slate-700 mb-2" />
                        <p className="font-bold text-slate-900 text-xs uppercase tracking-wider">Drop to Upload</p>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">Files will be attached to this profile</p>
                    </div>
                </div>
            )}

            {/* TOP BREADCRUMB */}
            <div className="flex items-center justify-between">
                <Link
                    to={employeeId ? `/admin/employees/${employeeId}` : '/admin/employees'}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
                >
                    <i className="ti ti-arrow-left text-sm" />
                    <span>{employee ? `Back to ${employee.first_name} ${employee.last_name}` : 'Back to Employees'}</span>
                </Link>
            </div>

            {/* UNIFIED HEADER CARD */}
            <div className={`bg-white rounded-lg shadow-2xs border ${isTerminated ? 'border-danger/20' : 'border-slate-200'} p-4 sm:p-5`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                    <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 ${isTerminated ? 'bg-danger-subtle text-danger-ink border-danger/20' : 'bg-slate-100 text-slate-700 border-slate-200'} rounded-lg flex items-center justify-center border shrink-0`}>
                            <i className={`ti ${isTerminated ? 'ti-lock' : 'ti-folders'} text-xl`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg font-bold text-slate-900 tracking-tight">Personnel Documents</h1>
                                {isTerminated && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                                        <i className="ti ti-lock text-[10px]" /> Read-Only
                                    </span>
                                )}
                            </div>
                            <p className="text-slate-500 text-xs mt-0.5">
                                {employee 
                                    ? `${employee.first_name} ${employee.last_name} (${employee.company_id || 'ID Pending'}) · ${employee.department || 'Staff'}` 
                                    : employeeId 
                                    ? `Employee ID: ${employeeId}` 
                                    : 'Master personnel repository and verification'}
                            </p>
                        </div>
                    </div>

                    {/* Unified Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {isTerminated ? (
                            <span className="h-8 px-3 rounded-md text-xs font-medium bg-slate-100 text-slate-400 border border-slate-200 flex items-center gap-1.5 select-none">
                                <i className="ti ti-lock text-xs" /> Uploads Disabled
                            </span>
                        ) : (
                            <>
                                {employeeId && (
                                    <button
                                        type="button"
                                        onClick={() => setIsBulkImportOpen(true)}
                                        className="h-8 px-3 bg-white text-slate-700 border border-slate-200 font-medium text-xs rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <i className="ti ti-file-zip text-sm" /> Bulk Import
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPreselectedDocType('tin');
                                        setIsRequestModalOpen(true);
                                    }}
                                    className="h-8 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-xs rounded-md shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-file-alert text-sm text-slate-600" />
                                    <span>Request</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsUploadModalOpen(true)}
                                    className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-upload text-sm" />
                                    <span>Upload</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="flex items-center gap-2 mt-4 pt-3.5 border-t border-slate-100">
                    <button
                        type="button"
                        onClick={() => setActiveTab('vault')}
                        className={`h-8 px-3.5 rounded-md text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                            activeTab === 'vault'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                        <i className="ti ti-folders text-sm" />
                        <span>Vault</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                            activeTab === 'vault' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-700'
                        }`}>
                            {documents.length}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('requests')}
                        className={`h-8 px-3.5 rounded-md text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                            activeTab === 'requests'
                                ? 'bg-slate-900 text-white shadow-2xs'
                                : 'bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                        <i className="ti ti-file-alert text-sm" />
                        <span>Requests &amp; Checklist</span>
                        {pendingRequestsCount > 0 ? (
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500 text-white">
                                {pendingRequestsCount} Pending
                            </span>
                        ) : (
                            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                                activeTab === 'requests' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-600'
                            }`}>
                                {requests.length}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* SEPARATED READ-ONLY NOTICE */}
            {isTerminated && (
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-danger-subtle border border-danger/20 text-xs text-danger-ink font-medium">
                    <i className="ti ti-lock text-sm shrink-0" />
                    <span>Separated account. Uploads and modifications locked under DOLE regulations; records preserved for audit.</span>
                </div>
            )}

            {/* TAB CONTENT: PERSONNEL VAULT */}
            {activeTab === 'vault' && (
                <>
                    {/* COMPLIANCE ALERTS */}
                    {alerts.length > 0 && (
                        <div className="bg-warning-subtle border border-warning/20 rounded-lg p-3 shadow-2xs">
                            <div className="flex items-start gap-2.5">
                                <div className="h-6 w-6 shrink-0 bg-warning-subtle text-warning-ink rounded flex items-center justify-center">
                                    <i className="ti ti-alert-triangle text-sm" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-warning-ink">
                                        {alerts.length} document{alerts.length > 1 ? 's require' : ' requires'} renewal
                                    </p>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {alerts.map(({ doc, status }) => (
                                            <span
                                                key={doc.id}
                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${expiryBadgeStyles[status.level]}`}
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

                    {documentQuery.error && (
                        <div role="alert" className="rounded-md border border-danger/20 bg-danger-subtle p-3 text-xs text-danger-ink">
                            {documentQuery.error.message}{' '}
                            <button type="button" onClick={() => documentQuery.refetch()} className="ml-2 font-semibold underline">
                                Retry
                            </button>
                        </div>
                    )}

                    {/* UNIFIED CONTROLS & STATUS FILTER TOOLBAR */}
                    <div className="bg-white rounded-lg p-3.5 border border-slate-200 shadow-2xs space-y-3">
                        <div className="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between">
                            {/* Search */}
                            <div className="relative flex-1 max-w-md">
                                <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                                <input
                                    type="text"
                                    placeholder="Search documents or files..."
                                    maxLength={200}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full h-8.5 pl-8.5 pr-8 bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-700 transition-colors shadow-2xs"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        title="Clear search"
                                    >
                                        <i className="ti ti-x text-xs" />
                                    </button>
                                )}
                            </div>

                            {/* Filters & View Switcher */}
                            <div className="flex items-center gap-2 flex-wrap justify-between md:justify-end">
                                {/* Category Dropdown */}
                                <div className="relative">
                                    <select
                                        value={selectedCategory}
                                        onChange={(e) => setSelectedCategory(e.target.value)}
                                        className="appearance-none h-8.5 pl-3 pr-7 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-700 transition-colors shadow-2xs cursor-pointer"
                                    >
                                        {CATEGORIES.map((cat) => (
                                            <option key={cat} value={cat}>
                                                {cat === 'All' ? 'All Categories' : cat}
                                            </option>
                                        ))}
                                    </select>
                                    <i className="ti ti-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                                </div>

                                {/* Sort Dropdown */}
                                <div className="relative">
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value)}
                                        className="appearance-none h-8.5 pl-3 pr-7 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-700 transition-colors shadow-2xs cursor-pointer"
                                    >
                                        {SORT_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    <i className="ti ti-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                                </div>

                                {/* Grid vs Table Toggle */}
                                <div className="flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setVaultViewMode('grid')}
                                        className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                                            vaultViewMode === 'grid'
                                                ? 'bg-white text-slate-900 shadow-2xs'
                                                : 'text-slate-500 hover:text-slate-900'
                                        }`}
                                        title="Grid View"
                                    >
                                        <i className="ti ti-layout-grid text-sm" />
                                        <span className="hidden sm:inline">Grid</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVaultViewMode('table')}
                                        className={`h-7 px-2.5 rounded text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                                            vaultViewMode === 'table'
                                                ? 'bg-white text-slate-900 shadow-2xs'
                                                : 'text-slate-500 hover:text-slate-900'
                                        }`}
                                        title="Table View"
                                    >
                                        <i className="ti ti-list-details text-sm" />
                                        <span className="hidden sm:inline">Table</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Status Pills */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-100 scrollbar-none">
                            {[
                                { key: 'all', label: 'All', count: vaultMetrics.total },
                                { key: 'pending', label: 'Pending Review', count: vaultMetrics.pending, alert: vaultMetrics.pending > 0 },
                                { key: 'approved', label: 'Approved', count: vaultMetrics.approved },
                                { key: 'rejected', label: 'Rejected', count: vaultMetrics.rejected },
                                { key: 'expiring', label: 'Expiring Soon', count: vaultMetrics.expiring, alert: vaultMetrics.expiring > 0 }
                            ].map((tab) => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => setStatusPillFilter(tab.key)}
                                    className={`h-7 px-3 rounded-md text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                                        statusPillFilter === tab.key
                                            ? 'bg-slate-900 text-white shadow-2xs'
                                            : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                                    }`}
                                >
                                    <span>{tab.label}</span>
                                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                                        statusPillFilter === tab.key
                                            ? 'bg-slate-800 text-slate-200'
                                            : tab.alert
                                            ? 'bg-amber-100 text-amber-700'
                                            : 'bg-slate-200 text-slate-700'
                                    }`}>
                                        {tab.count}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* MAIN DOCUMENT LISTING */}
                    {isLoading ? (
                        <div className="py-20 flex flex-col items-center justify-center text-slate-400 bg-white rounded-lg border border-slate-200">
                            <i className="ti ti-loader animate-spin text-4xl text-slate-700 mb-2" />
                            <p className="text-xs font-semibold text-slate-700">Loading records...</p>
                            <p className="text-[11px] text-slate-400 font-medium">Synchronizing live repository</p>
                        </div>
                    ) : filteredDocuments.length === 0 ? (
                        <div
                            onClick={() => !isTerminated && !hasDocumentFilters && documents.length === 0 && setIsUploadModalOpen(true)}
                            className={`border border-dashed border-slate-200 rounded-lg p-10 flex flex-col items-center justify-center text-slate-400 bg-white shadow-2xs ${
                                !isTerminated && !hasDocumentFilters && documents.length === 0 ? 'cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors duration-100' : ''
                            }`}
                        >
                            <i className="ti ti-file-x text-4xl mb-2 text-slate-300" />
                            <p className="text-xs font-semibold text-slate-700">
                                {documents.length === 0 && !hasDocumentFilters
                                    ? (isTerminated ? 'No archived documents on file' : 'No documents uploaded yet')
                                    : 'No matching documents found'}
                            </p>
                            <p className="text-xs text-slate-500 font-medium mt-0.5 text-center">
                                {documents.length === 0 && !hasDocumentFilters
                                    ? (isTerminated
                                        ? 'This separated employee has no archived documents on record.'
                                        : 'Click here or drag and drop a file anywhere on this page.') 
                                    : 'Try adjusting your search query, status pill filter, or selected category.'}
                            </p>
                        </div>
                    ) : vaultViewMode === 'table' ? (
                        /* TABLE VIEW MODE */
                        <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                            <th className="py-3 px-4">Document &amp; File</th>
                                            <th className="py-3 px-3">Category</th>
                                            {!employeeId && <th className="py-3 px-3">Employee</th>}
                                            <th className="py-3 px-3">Uploaded / Expiry</th>
                                            <th className="py-3 px-3">Review Status</th>
                                            <th className="py-3 px-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-xs">
                                        {filteredDocuments.map((doc) => {
                                            const exp = getExpiryStatus(doc);
                                            const st = String(doc.status || '').toLowerCase();
                                            const isApproved = st === 'approved';
                                            const isRejected = st === 'rejected';
                                            const isPending = !isApproved && !isRejected;

                                            return (
                                                <tr key={doc.id} className="hover:bg-slate-50/60 transition-colors">
                                                    {/* Document & File */}
                                                    <td className="py-3 px-4">
                                                        <div className="flex items-center gap-3">
                                                            <DocumentThumbnail
                                                                document={doc}
                                                                size="sm"
                                                                onPreview={() => handleOpenDocument(doc)}
                                                            />
                                                            <div className="min-w-0 max-w-xs">
                                                                <p
                                                                    className="font-semibold text-slate-900 text-xs truncate cursor-pointer hover:text-accent transition-colors"
                                                                    title={doc.title}
                                                                    onClick={() => handleOpenDocument(doc)}
                                                                >
                                                                    {doc.title}
                                                                </p>
                                                                <p className="text-[11px] text-slate-400 font-mono truncate" title={doc.file_name}>
                                                                    {doc.file_name} · {formatFileSize(doc.file_size)}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* Category */}
                                                    <td className="py-3 px-3 whitespace-nowrap">
                                                        <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-muted text-ink-muted border border-line">
                                                            {doc.category || 'General'}
                                                        </span>
                                                    </td>

                                                    {/* Employee (if multi-employee directory) */}
                                                    {!employeeId && (
                                                        <td className="py-3 px-3 whitespace-nowrap">
                                                            {doc.employees ? (
                                                                <div>
                                                                    <p className="font-medium text-slate-800 text-xs">
                                                                        {doc.employees.first_name} {doc.employees.last_name}
                                                                    </p>
                                                                    <p className="text-[10px] text-slate-400 font-mono">
                                                                        {doc.employees.company_id || 'No ID'}
                                                                    </p>
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-400 text-xs">System / Direct</span>
                                                            )}
                                                        </td>
                                                    )}

                                                    {/* Uploaded / Expiry */}
                                                    <td className="py-3 px-3 whitespace-nowrap">
                                                        <p className="text-slate-700 font-medium text-xs">
                                                            {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                        </p>
                                                        {exp ? (
                                                            <span className={`inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.2 rounded-md text-[10px] font-medium border ${expiryBadgeStyles[exp.level]}`}>
                                                                <i className={`ti ${exp.level === 'expired' ? 'ti-circle-x' : exp.level === 'warning' ? 'ti-clock' : 'ti-circle-check'} text-[10px]`} />
                                                                {exp.level === 'expired' ? `Expired ${Math.abs(exp.daysLeft)}d ago` : exp.label}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[10px] text-slate-400">No Expiry</span>
                                                        )}
                                                    </td>

                                                    {/* Review Status */}
                                                    <td className="py-3 px-3 whitespace-nowrap">
                                                        {isApproved ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-success-subtle text-success-ink border border-success/30">
                                                                <i className="ti ti-circle-check text-xs" /> Approved
                                                            </span>
                                                        ) : isRejected ? (
                                                            <div>
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-danger-subtle text-danger-ink border border-danger/30">
                                                                    <i className="ti ti-circle-x text-xs" /> Rejected
                                                                </span>
                                                                {doc.rejection_reason && (
                                                                    <p className="text-[10px] text-danger-ink max-w-[180px] truncate mt-0.5 font-medium" title={doc.rejection_reason}>
                                                                        {doc.rejection_reason}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-warning-subtle text-warning-ink border border-warning/30">
                                                                <i className="ti ti-clock text-xs" /> Pending Review
                                                            </span>
                                                        )}
                                                    </td>

                                                    {/* Actions */}
                                                    <td className="py-3 px-4 text-right whitespace-nowrap">
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            {isPending ? (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        disabled={reviewingDocument === doc.id}
                                                                        onClick={() => handleApproveDocument(doc)}
                                                                        className="w-7 h-7 flex items-center justify-center bg-success-subtle hover:bg-success/20 text-success-ink border border-success/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                                                        title="Approve document"
                                                                    >
                                                                        <i className={`ti ${reviewingDocument === doc.id ? 'ti-loader animate-spin' : 'ti-check'} text-xs`} />
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        disabled={reviewingDocument === doc.id}
                                                                        onClick={() => handleOpenRejectModal(doc)}
                                                                        className="w-7 h-7 flex items-center justify-center bg-danger-subtle hover:bg-danger/20 text-danger-ink border border-danger/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                                                        title="Reject document"
                                                                    >
                                                                        <i className="ti ti-x text-xs" />
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    disabled={reviewingDocument === doc.id}
                                                                    onClick={() => handleReopenDocument(doc)}
                                                                    className="w-7 h-7 flex items-center justify-center bg-surface-muted hover:bg-slate-200 text-ink-muted hover:text-ink border border-line rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                                                    title={isRejected ? "Re-open review (clears rejection, resets to pending)" : "Re-open review (resets to pending)"}
                                                                >
                                                                    <i className={`ti ${reviewingDocument === doc.id ? 'ti-loader animate-spin' : 'ti-rotate-2'} text-xs`} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        /* GRID VIEW MODE */
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                            {filteredDocuments.map((doc) => {
                                const status = getExpiryStatus(doc);
                                const st = String(doc.status || '').toLowerCase();
                                const isApproved = st === 'approved';
                                const isRejected = st === 'rejected';
                                const isPending = !isApproved && !isRejected;

                                return (
                                    <div
                                        key={doc.id}
                                        className="bg-white rounded-lg shadow-2xs border border-slate-200 hover:border-slate-300 transition-all duration-100 flex flex-col justify-between group overflow-hidden"
                                    >
                                        <DocumentThumbnail
                                            document={doc}
                                            variant="banner"
                                            onPreview={() => handleOpenDocument(doc)}
                                        />
                                        <div className="p-4 flex-1 flex flex-col justify-between">
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                                        {doc.category || 'General'}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-slate-400">
                                                        {formatFileSize(doc.file_size)}
                                                    </span>
                                                </div>

                                                <h3
                                                    className="font-semibold text-slate-900 text-sm tracking-tight line-clamp-1 cursor-pointer hover:text-accent transition-colors duration-100"
                                                    title={doc.title}
                                                    onClick={() => handleOpenDocument(doc)}
                                                >
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

                                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                                {isApproved ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-success-subtle text-success-ink border border-success/30">
                                                        <i className="ti ti-circle-check text-xs" /> Approved
                                                    </span>
                                                ) : isRejected ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-danger-subtle text-danger-ink border border-danger/30">
                                                        <i className="ti ti-circle-x text-xs" /> Rejected
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-warning-subtle text-warning-ink border border-warning/30">
                                                        <i className="ti ti-clock text-xs" /> Pending Review
                                                    </span>
                                                )}
                                                {status && (
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${expiryBadgeStyles[status.level]}`}>
                                                        <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : status.level === 'warning' ? 'ti-clock' : 'ti-circle-check'} text-xs`} />
                                                        {status.level === 'expired' ? `Expired ${Math.abs(status.daysLeft)}d ago` : status.label}
                                                    </span>
                                                )}
                                            </div>
                                            {isRejected && doc.rejection_reason && (
                                                <p className="mt-1.5 text-xs text-danger-ink bg-danger-subtle p-2 rounded-lg border border-danger/25">
                                                    {doc.rejection_reason}
                                                </p>
                                            )}
                                        </div>

                                        <div className="pt-2.5 mt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                                            <span className="text-[11px] text-slate-500 font-medium">
                                                {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>

                                            <div className="flex items-center gap-1">
                                                {isPending ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            disabled={reviewingDocument === doc.id}
                                                            onClick={() => handleApproveDocument(doc)}
                                                            className="w-7 h-7 flex items-center justify-center bg-success-subtle hover:bg-success/20 text-success-ink border border-success/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                                            title="Approve document"
                                                        >
                                                            <i className={`ti ${reviewingDocument === doc.id ? 'ti-loader animate-spin' : 'ti-check'} text-xs`} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={reviewingDocument === doc.id}
                                                            onClick={() => handleOpenRejectModal(doc)}
                                                            className="w-7 h-7 flex items-center justify-center bg-danger-subtle hover:bg-danger/20 text-danger-ink border border-danger/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                                            title="Reject document"
                                                        >
                                                            <i className="ti ti-x text-xs" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={reviewingDocument === doc.id}
                                                        onClick={() => handleReopenDocument(doc)}
                                                        className="w-7 h-7 flex items-center justify-center bg-surface-muted hover:bg-slate-200 text-ink-muted hover:text-ink border border-line rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
                                                        title={isRejected ? "Re-open review (clears rejection, resets to pending)" : "Re-open review (resets to pending)"}
                                                    >
                                                        <i className={`ti ${reviewingDocument === doc.id ? 'ti-loader animate-spin' : 'ti-rotate-2'} text-xs`} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
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
                            className="rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold cursor-pointer"
                        >
                            {documentQuery.isFetchingNextPage ? 'Loading…' : 'Load more documents'}
                        </button>
                    )}
                </>
            )}

            {/* TAB CONTENT: COMPLIANCE & ACTIVE REQUESTS */}
            {activeTab === 'requests' && (
                <div className="space-y-5">
                    {/* STATUTORY COMPLIANCE CHECKLIST (When viewing specific employee) */}
                    {employeeId && (
                        <div className="bg-white rounded-lg p-4 sm:p-5 shadow-2xs border border-slate-200 space-y-3.5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                    <i className="ti ti-checklist text-base text-slate-700" />
                                    <span>Statutory Personnel Checklist</span>
                                </h3>
                                {complianceData && (
                                    <div className="flex items-center gap-2 self-start sm:self-auto">
                                        <span className={`px-2.5 py-1 rounded text-xs font-bold font-mono border ${
                                            complianceData.score === 100
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : complianceData.score >= 70
                                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                : 'bg-amber-50 text-amber-700 border-amber-200'
                                        }`}>
                                            {complianceData.score}% Compliant ({complianceData.completed}/{complianceData.total})
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Checklist Items */}
                            {isLoadingCompliance ? (
                                <p className="text-xs text-slate-400 py-3">Auditing statutory records...</p>
                            ) : complianceData?.items ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                    {complianceData.items.map((item) => (
                                        <div
                                            key={item.type_id}
                                            className={`p-2.5 sm:p-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                                                item.status === 'approved'
                                                    ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950'
                                                    : item.status === 'pending_review'
                                                    ? 'bg-blue-50/50 border-blue-200 text-blue-950'
                                                    : item.status === 'requested'
                                                    ? 'bg-amber-50/50 border-amber-200 text-amber-950'
                                                    : 'bg-slate-50 border-slate-200 text-slate-800'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 min-w-0">
                                                <i className={`ti ${
                                                    item.status === 'approved'
                                                        ? 'ti-circle-check text-emerald-600'
                                                        : item.status === 'pending_review'
                                                        ? 'ti-clock text-blue-600'
                                                        : item.status === 'requested'
                                                        ? 'ti-mail-forward text-amber-600'
                                                        : 'ti-alert-circle text-slate-400'
                                                } text-base shrink-0`} />
                                                <span className="font-semibold truncate">{item.label}</span>
                                            </div>

                                            <div className="shrink-0 flex items-center gap-1.5">
                                                {item.status === 'approved' ? (
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded border border-emerald-300">
                                                        Verified
                                                    </span>
                                                ) : item.status === 'pending_review' ? (
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100/60 px-2 py-0.5 rounded border border-blue-300">
                                                        In Review
                                                    </span>
                                                ) : item.status === 'requested' ? (
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100/60 px-2 py-0.5 rounded border border-amber-300">
                                                        Requested
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPreselectedDocType(item.type_id);
                                                            setIsRequestModalOpen(true);
                                                        }}
                                                        className="h-7 px-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] rounded transition-colors shadow-2xs flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <i className="ti ti-send text-xs" />
                                                        <span>Request</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    )}

                    {/* ACTIVE REQUESTS TABLE & LIST */}
                    <div className="bg-white rounded-lg p-4 sm:p-5 shadow-2xs border border-slate-200 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                            <h3 className="font-bold text-slate-900 text-sm">Document Requests</h3>

                            <div className="flex items-center gap-2">
                                <select
                                    value={requestStatusFilter}
                                    onChange={e => setRequestStatusFilter(e.target.value)}
                                    className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="pending">Pending Submission</option>
                                    <option value="submitted">Submitted · In Review</option>
                                    <option value="approved">Approved &amp; Fulfilled</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </div>
                        </div>

                        {/* Requests Table */}
                        {requestQuery.isLoading ? (
                            <div className="py-12 text-center text-xs text-slate-400">Loading document requests...</div>
                        ) : requests.length === 0 ? (
                            <div className="py-12 text-center space-y-1.5">
                                <i className="ti ti-inbox text-3xl text-slate-300 block" />
                                <p className="text-xs font-semibold text-slate-700">No document requests found</p>
                                <p className="text-xs text-slate-400">No active or historical requests on record.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {requests.map(req => {
                                    const isPending = req.status === 'pending';
                                    const isSubmitted = req.status === 'submitted';
                                    const isApproved = req.status === 'approved';
                                    const isCancelled = req.status === 'cancelled';
                                    const isOverdue = req.due_date && new Date(req.due_date) < new Date() && isPending;

                                    return (
                                        <div
                                            key={req.id}
                                            className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 bg-white shadow-2xs transition-all space-y-2.5"
                                        >
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold font-mono text-xs text-slate-700 shrink-0">
                                                        {(req.employee?.first_name?.[0] || 'E')}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-xs font-bold text-slate-900">
                                                                {req.document_type}
                                                            </h4>
                                                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                                                {req.category}
                                                            </span>
                                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${
                                                                req.priority === 'urgent'
                                                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                                    : req.priority === 'high'
                                                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                                                            }`}>
                                                                {req.priority}
                                                            </span>
                                                        </div>
                                                        <p className="text-[11px] text-slate-500 font-medium">
                                                            Assigned to: <strong className="text-slate-700">{req.employee?.first_name} {req.employee?.last_name}</strong> ({req.employee?.company_id || 'ID Pending'})
                                                            {req.requested_by_user && (
                                                                <span> · By HR: {req.requested_by_user.first_name} {req.requested_by_user.last_name}</span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                                                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                                        isApproved
                                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                            : isSubmitted
                                                            ? 'bg-blue-50 text-blue-700 border-blue-200 font-bold'
                                                            : isCancelled
                                                            ? 'bg-slate-100 text-slate-500 border-slate-200'
                                                            : isOverdue
                                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                            : 'bg-amber-50 text-amber-700 border-amber-200'
                                                    }`}>
                                                        {isApproved
                                                            ? 'Approved · Verified'
                                                            : isSubmitted
                                                            ? 'Submitted · Awaiting Review'
                                                            : isCancelled
                                                            ? 'Cancelled'
                                                            : isOverdue
                                                            ? 'Overdue'
                                                            : 'Pending Submission'}
                                                    </span>

                                                    {/* Actions */}
                                                    {isPending && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                disabled={actioningRequestId === req.id}
                                                                onClick={() => handleRemindRequest(req.id)}
                                                                className="h-7 px-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-[11px] rounded shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                                                                title="Send reminder notice"
                                                            >
                                                                <i className="ti ti-bell text-xs" />
                                                                <span>Remind</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={actioningRequestId === req.id}
                                                                onClick={() => handleCancelRequest(req.id)}
                                                                className="h-7 px-2 bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-700 text-slate-500 text-[11px] rounded transition-colors cursor-pointer"
                                                                title="Cancel request"
                                                            >
                                                                <i className="ti ti-x text-xs" />
                                                            </button>
                                                        </>
                                                    )}

                                                    {isSubmitted && req.fulfilled_document_id && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenDocument(req.fulfilled_document_id)}
                                                            className="h-7 px-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] rounded shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                                                        >
                                                            <i className="ti ti-eye text-xs" />
                                                            <span>Review File</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Details & Notes */}
                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1 border-t border-slate-50">
                                                <span>Sent: {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                                {req.due_date && (
                                                    <span className={isOverdue ? 'text-rose-600 font-bold' : ''}>
                                                        Due: {req.due_date} {isOverdue && '(Overdue)'}
                                                    </span>
                                                )}
                                                {req.notes && (
                                                    <span className="text-slate-700 italic">
                                                        &quot;{req.notes}&quot;
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* REQUEST DOCUMENT MODAL */}
            <RequestDocumentModal
                isOpen={isRequestModalOpen}
                onClose={() => setIsRequestModalOpen(false)}
                onSuccess={() => {
                    requestQuery.refresh();
                    if (employeeId) {
                        fetchEmployeeCompliance(employeeId).then(setComplianceData).catch(() => {});
                    }
                }}
                initialEmployeeId={employeeId}
                initialEmployee={employee}
                initialDocTypeId={preselectedDocType}
            />

            {/* BULK IMPORT MODAL */}
            <BulkImportModal
                isOpen={isBulkImportOpen}
                onClose={() => setIsBulkImportOpen(false)}
                employeeId={employeeId}
                employeeName={employee ? `${employee.first_name} ${employee.last_name} (${employee.company_id || 'No ID'})` : employeeId}
                isTerminated={isTerminated}
                categories={CATEGORIES.filter((c) => c !== 'All')}
                onImported={() => {
                    fetchDocuments();
                    requestQuery.refresh();
                }}
            />

            {/* UPLOAD DOCUMENT MODAL */}
            {isUploadModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={() => !isUploading && setIsUploadModalOpen(false)}
                    />

                    <div className="relative bg-white rounded-lg p-5 sm:p-6 shadow-xl w-full max-w-lg border border-slate-200 z-10 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 mb-4">
                            <div className="flex items-center gap-2.5">
                                <div className="h-8 w-8 bg-slate-100 text-slate-700 rounded-md flex items-center justify-center border border-slate-200">
                                    <i className="ti ti-file-upload text-base" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-bold text-slate-900">Upload Personnel Document</h2>
                                    <p className="text-xs text-slate-500 font-medium">Attach verified statutory record or clearance</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsUploadModalOpen(false)}
                                className="w-8 h-8 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md flex items-center justify-center transition-colors duration-100 cursor-pointer"
                                disabled={isUploading}
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        <form onSubmit={handleUploadSubmit} className="space-y-3.5">
                            {/* Target Personnel Account Selector */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                    Target Personnel Account <span className="text-rose-500">*</span>
                                </label>
                                {employeeId ? (
                                    <div className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md font-medium text-xs text-slate-700 flex items-center justify-between">
                                        <span className="truncate">
                                            {employee?.first_name ? `${employee.first_name} ${employee.last_name} (${employee.company_id || 'ID Pending'})` : `Employee ID: ${employeeId}`}
                                        </span>
                                        <span className="text-[10px] font-bold text-accent uppercase tracking-widest px-1.5 py-0.5 bg-accent-subtle rounded border border-accent/20 shrink-0">
                                            Scoped
                                        </span>
                                    </div>
                                ) : (
                                    <select
                                        value={targetEmployeeId}
                                        onChange={(e) => setTargetEmployeeId(e.target.value)}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 shadow-2xs cursor-pointer"
                                    >
                                        <option value="">Select workforce employee...</option>
                                        {workforceOptions.map(e => (
                                            <option key={e.id} value={e.id}>
                                                {e.first_name} {e.last_name} ({e.company_id || 'CP-MAIN'}) — {e.job_title || e.department || 'Staff'}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* Aligned Document Type Dropdown */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                    Document Classification Type <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    value={selectedDocTypeId}
                                    onChange={handleDocTypeSelectChange}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md outline-none focus:border-slate-400 font-medium text-xs text-slate-800 transition-colors duration-100 shadow-2xs cursor-pointer"
                                >
                                    <optgroup label="Statutory & Government Identification">
                                        {DOCUMENT_TYPES.filter(t => t.category === 'Government ID').map(t => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Employment & Contracts">
                                        {DOCUMENT_TYPES.filter(t => t.category === 'Contract').map(t => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Clearances & Background">
                                        {DOCUMENT_TYPES.filter(t => t.category === 'Clearance').map(t => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Certificates & Credentials">
                                        {DOCUMENT_TYPES.filter(t => t.category === 'Certificate').map(t => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Performance & Other">
                                        {DOCUMENT_TYPES.filter(t => ['Performance', 'Other'].includes(t.category)).map(t => (
                                            <option key={t.id} value={t.id}>{t.label}</option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                    Custom Document Title (Optional)
                                </label>
                                <input maxLength={200}
                                    type="text"
                                    placeholder="e.g. SSS E-1 Verified Copy, 2026 NBI Clearance"
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
                                        Expiry Date {!showExpiryField && <span className="normal-case font-normal text-slate-400">(optional)</span>}
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
                                    <i className="ti ti-info-circle text-xs text-slate-400" /> Clearance and license validity tracking is active.
                                </p>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                    File Attachment <span className="text-rose-500">*</span>
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
                                        <div className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs relative z-20">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                {isImageFile(selectedFile.name) ? (
                                                    <img
                                                        src={previewUrl || undefined}
                                                        alt="Preview"
                                                        className="h-10 w-10 rounded-md object-cover border border-slate-200 shrink-0 shadow-2xs"
                                                    />
                                                ) : (
                                                    <div className="h-10 w-10 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 border border-slate-200">
                                                        <i className="ti ti-file-text text-lg" />
                                                    </div>
                                                )}
                                                <div className="text-left overflow-hidden">
                                                    <div className="flex items-center gap-1.5">
                                                        <p className="text-xs font-semibold text-slate-900 truncate max-w-[200px]" title={formatCleanDocumentFileName(documentTitle, selectedFile.name)}>
                                                            {formatCleanDocumentFileName(documentTitle, selectedFile.name)}
                                                        </p>
                                                        <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold uppercase rounded shrink-0">
                                                            Auto-renamed
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                                                        Original: {selectedFile.name} · {formatFileSize(selectedFile.size)}
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

            {/* REJECT DOCUMENT REMARKS MODAL */}
            <RejectDocumentModal
                isOpen={Boolean(rejectingDoc)}
                onClose={() => setRejectingDoc(null)}
                document={rejectingDoc}
                onConfirm={handleConfirmReject}
                isSubmitting={isSubmittingRejection}
            />

            {/* FULL DOCUMENT PREVIEW LIGHTBOX MODAL */}
            <DocumentPreviewModal
                isOpen={Boolean(activePreviewDoc)}
                onClose={() => setActivePreviewDoc(null)}
                document={activePreviewDoc}
                isAdmin={true}
                onApprove={handleApproveDocument}
                onReject={handleOpenRejectModal}
                onReopen={handleReopenDocument}
                onDelete={handleDeleteDocument}
                isReviewing={reviewingDocument === activePreviewDoc?.id}
            />
        </div>
    );
}
