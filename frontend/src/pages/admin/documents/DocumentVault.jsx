import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';

// NOTE: These are the categories actually visible on the live Document Vault
// page's filter tabs (Contract / Government ID / Clearance / Certificate /
// Performance / Other). If your team uses a different canonical list,
// update this array — it drives both the filter tabs and the upload form.
const CATEGORIES = ['Contract', 'Government ID', 'Clearance', 'Certificate', 'Performance', 'Other'];

const STATUS_FILTERS = [
    { key: 'pending', label: 'Pending Review', icon: 'ti-clock' },
    { key: 'approved', label: 'Approved', icon: 'ti-circle-check' },
    { key: 'rejected', label: 'Rejected', icon: 'ti-circle-x' },
    { key: 'all', label: 'All', icon: 'ti-folders' },
];

const EXPIRY_WARNING_DAYS = 7;

export default function DocumentVault() {
    const [searchParams] = useSearchParams();
    const employeeId = searchParams.get('employee_id') || null;
    const queryClient = useQueryClient();

    const [categoryFilter, setCategoryFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('pending');
    const [searchTerm, setSearchTerm] = useState('');
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [previewDoc, setPreviewDoc] = useState(null);
    const [reviewingDocId, setReviewingDocId] = useState(null);
    const [rejectModalDoc, setRejectModalDoc] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [deletingDocId, setDeletingDocId] = useState(null);

    const [uploadData, setUploadData] = useState({
        employee_id: employeeId || '',
        category: CATEGORIES[0],
        file: null,
    });

    // Keep the upload form's employee locked to whichever employee this page is scoped to.
    useEffect(() => {
    if (!employeeId) return;
    const channel = supabase
        .channel(`vault-employee-${employeeId}`)
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'employees', filter: `id=eq.${employeeId}` },
            () => queryClient.invalidateQueries({ queryKey: ['employeeDetails', employeeId] })
        )
        .subscribe();

    return () => supabase.removeChannel(channel);
}, [employeeId, queryClient]);

    // Employee context (only relevant when scoped to a single employee via ?employee_id=)
    const { data: employee } = useQuery({
    queryKey: ['employeeDetails', employeeId],
    queryFn: async () => {
        const res = await fetchWithAuth(`/api/employees/${employeeId}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load employee');
        const emp = data.data;
        emp.name = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
        return emp;
    },
    enabled: Boolean(employeeId),
    refetchOnMount: 'always',
    staleTime: 0,
});

    // For the global (non-scoped) vault view's upload employee picker.
    const { data: employeeList = [] } = useQuery({
        queryKey: ['vaultEmployeePicker'],
        queryFn: async () => {
            const { data } = await supabase
                .from('employees')
                .select('id, first_name, last_name, company_id, operational_status, is_terminated, is_suspended');
            return data || [];
        },
        enabled: !employeeId,
        staleTime: 60_000,
    });

    const isTerminated = employeeId
        ? Boolean(employee?.operational_status === 'Terminated' || employee?.is_terminated)
        : false;

    // Documents query — scoped to the employee when present, otherwise the whole vault.
    const { data: documents = [], isLoading: isDocsLoading } = useQuery({
        queryKey: ['vaultDocuments', employeeId],
        queryFn: async () => {
            const url = employeeId ? `/api/employee-documents?employee_id=${employeeId}` : '/api/employee-documents';
            const res = await fetchWithAuth(url);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load documents');
            return data.data || [];
        },
        staleTime: 15_000,
    });

    // Real-time: keep every open admin tab in sync as documents get uploaded/reviewed.
    useEffect(() => {
        const channel = supabase
            .channel(employeeId ? `vault-documents-${employeeId}` : 'vault-documents-global')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'employee_documents',
                    ...(employeeId ? { filter: `employee_id=eq.${employeeId}` } : {}),
                },
                () => {
                    queryClient.invalidateQueries({ queryKey: ['vaultDocuments', employeeId] });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [employeeId, queryClient]);

    const getDocStatus = (doc) => doc?.status || 'pending';

    const statusCounts = useMemo(() => {
        return documents.reduce(
            (acc, doc) => {
                const s = getDocStatus(doc);
                acc[s] = (acc[s] || 0) + 1;
                acc.all += 1;
                return acc;
            },
            { all: 0, pending: 0, approved: 0, rejected: 0 }
        );
    }, [documents]);

    const categoryCounts = useMemo(() => {
        const counts = { All: documents.length };
        CATEGORIES.forEach((c) => {
            counts[c] = documents.filter((d) => d.category === c).length;
        });
        return counts;
    }, [documents]);

    const expiringSoon = useMemo(() => {
        const now = Date.now();
        return documents.filter((doc) => {
            if (!doc.expires_at) return false;
            const diffDays = (new Date(doc.expires_at).getTime() - now) / (1000 * 60 * 60 * 24);
            return diffDays >= 0 && diffDays <= EXPIRY_WARNING_DAYS;
        });
    }, [documents]);

    const filteredDocuments = useMemo(() => {
        return documents.filter((doc) => {
            if (statusFilter !== 'all' && getDocStatus(doc) !== statusFilter) return false;
            if (categoryFilter !== 'All' && doc.category !== categoryFilter) return false;
            if (searchTerm.trim()) {
                const term = searchTerm.trim().toLowerCase();
                const haystack = `${doc.title || ''} ${doc.file_name || ''}`.toLowerCase();
                if (!haystack.includes(term)) return false;
            }
            return true;
        });
    }, [documents, statusFilter, categoryFilter, searchTerm]);

    const daysUntil = (dateString) => {
        const diff = Math.ceil((new Date(dateString).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return diff;
    };

    const getFileMeta = (fileName = '') => {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        switch (ext) {
            case 'pdf':
                return { icon: 'ti-file-type-pdf', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-100' };
            case 'doc':
            case 'docx':
                return { icon: 'ti-file-type-docx', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-100' };
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'webp':
                return { icon: 'ti-photo', color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-100' };
            default:
                return { icon: 'ti-file', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-100' };
        }
    };

    const getDocumentUrl = (filePath) => {
        if (!filePath) return '#';
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
        return `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/documents/${filePath}`;
    };

    // ---- Upload ----
    const handleUploadSubmit = async (e) => {
        e.preventDefault();
        if (!uploadData.file || !uploadData.employee_id) return;
        if (isTerminated) {
            toast.error('Uploads are disabled for separated/terminated employees.');
            return;
        }

        try {
            const file = uploadData.file;
            const fileExt = file.name.split('.').pop();
            const filePath = `201_vault/${uploadData.employee_id}/${Date.now()}.${fileExt}`;

            const { error: storageErr } = await supabase.storage.from('documents').upload(filePath, file);
            if (storageErr) throw storageErr;

            const res = await fetchWithAuth('/api/employee-documents', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: uploadData.employee_id,
                    category: uploadData.category,
                    title: file.name,
                    file_name: file.name,
                    file_path: filePath,
                    file_size: file.size,
                    file_type: file.type,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save document record');

            toast.success('Document uploaded.');
            setIsUploadOpen(false);
            setUploadData({ employee_id: employeeId || '', category: CATEGORIES[0], file: null });
            queryClient.invalidateQueries({ queryKey: ['vaultDocuments', employeeId] });
        } catch (err) {
            toast.error(`Upload failed: ${err.message}`);
        }
    };

    // ---- Approve / Reject ----
    const handleReview = async (doc, nextStatus, reason = '') => {
        if (!doc?.id) return;
        setReviewingDocId(doc.id);

        const previous = queryClient.getQueryData(['vaultDocuments', employeeId]);
        queryClient.setQueryData(['vaultDocuments', employeeId], (old = []) =>
            old.map((d) =>
                d.id === doc.id
                    ? { ...d, status: nextStatus, rejection_reason: nextStatus === 'rejected' ? reason : null }
                    : d
            )
        );

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetchWithAuth(`/api/employee-documents/${doc.id}/status`, {
                method: 'PATCH',
                body: JSON.stringify({
                    status: nextStatus,
                    reviewed_by: user?.id,
                    rejection_reason: nextStatus === 'rejected' ? reason : null,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update document status');

            toast.success(nextStatus === 'approved' ? 'Document approved.' : nextStatus === 'rejected' ? 'Document rejected.' : 'Status reset.');
            queryClient.setQueryData(['vaultDocuments', employeeId], (old = []) =>
                old.map((d) => (d.id === doc.id ? { ...d, ...data.data } : d))
            );
        } catch (err) {
            queryClient.setQueryData(['vaultDocuments', employeeId], previous);
            toast.error(err.message || 'Network error. Failed to update document status');
        } finally {
            setReviewingDocId(null);
            setRejectModalDoc(null);
            setRejectReason('');
        }
    };

    const confirmReject = () => {
        if (!rejectModalDoc) return;
        handleReview(rejectModalDoc, 'rejected', rejectReason.trim());
    };

    // ---- Delete ----
    const handleDelete = async (doc) => {
        if (!window.confirm(`Delete "${doc.title || doc.file_name}"? This cannot be undone.`)) return;
        setDeletingDocId(doc.id);
        try {
            const res = await fetchWithAuth(`/api/employee-documents/${doc.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete document');
            toast.success('Document deleted.');
            queryClient.invalidateQueries({ queryKey: ['vaultDocuments', employeeId] });
        } catch (err) {
            toast.error(err.message || 'Failed to delete document');
        } finally {
            setDeletingDocId(null);
        }
    };

    const statusBadgeFor = (status) =>
        ({
            approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: 'ti-circle-check' },
            rejected: { label: 'Rejected', cls: 'bg-rose-50 text-rose-700 border-rose-200', icon: 'ti-circle-x' },
            pending: { label: 'Pending Review', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'ti-clock' },
        }[status] || { label: status, cls: 'bg-slate-50 text-slate-500 border-slate-200', icon: 'ti-file' });

    return (
        <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans">
            {/* Top bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {employeeId ? (
                    <Link
                        to={`/admin/employees/${employeeId}`}
                        className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5"
                    >
                        <i className="ti ti-arrow-left text-sm" /> Back to Profile
                    </Link>
                ) : (
                    <h1 className="text-xl font-black text-slate-800">Document Vault</h1>
                )}

                <button
                    type="button"
                    onClick={() => !isTerminated && setIsUploadOpen(true)}
                    disabled={isTerminated}
                    title={isTerminated ? 'Uploads are disabled for separated/terminated employees' : ''}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                    <i className={`ti ${isTerminated ? 'ti-lock' : 'ti-upload'} text-base`} />
                    {isTerminated ? 'Uploads Disabled' : 'Upload Document'}
                </button>
            </div>

            {/* Employee-scoped header */}
            {employeeId && employee && (
                <div className="bg-white rounded-2xl shadow-xs border border-slate-100 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="h-11 w-11 bg-sky-50 text-sky-600 rounded-xl flex items-center justify-center border border-sky-100">
                                <i className="ti ti-folders text-xl" />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-slate-800">201 Documents</h2>
                                <p className="text-xs text-slate-500 font-medium">
                                    {employee.name} ({employee.company_id || 'No ID'}) · {employee.department || 'General'}
                                </p>
                            </div>
                        </div>
                        {isTerminated && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-700 text-[11px] font-black rounded-lg border border-rose-200 uppercase tracking-widest">
                                <i className="ti ti-lock text-sm" /> Separated · Read-Only Audit
                            </span>
                        )}
                    </div>

                    {isTerminated && (
                        <div className="mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-medium flex items-start gap-2">
                            <i className="ti ti-alert-triangle text-sm mt-0.5 shrink-0" />
                            <p>
                                This employee account is separated/terminated. New document uploads and edits are locked. All
                                historical 201 records remain accessible below for review and compliance export.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Expiring soon alert */}
            {expiringSoon.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center gap-2">
                    <i className="ti ti-alert-triangle text-amber-600 text-base shrink-0" />
                    <p className="text-xs font-black text-amber-900">
                        {expiringSoon.length} document{expiringSoon.length === 1 ? '' : 's'} need{expiringSoon.length === 1 ? 's' : ''} attention:
                    </p>
                    {expiringSoon.map((doc) => (
                        <span key={doc.id} className="px-2 py-0.5 bg-white border border-amber-200 rounded-md text-[11px] font-bold text-amber-800">
                            {doc.title || doc.file_name} · Expires in {daysUntil(doc.expires_at)}d
                        </span>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-100 p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    {STATUS_FILTERS.map((f) => {
                        const isActive = statusFilter === f.key;
                        const count = statusCounts[f.key] || 0;
                        return (
                            <button
                                key={f.key}
                                type="button"
                                onClick={() => setStatusFilter(f.key)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                                    isActive
                                        ? f.key === 'approved'
                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                            : f.key === 'rejected'
                                            ? 'bg-rose-600 text-white border-rose-600'
                                            : f.key === 'pending'
                                            ? 'bg-amber-500 text-white border-amber-500'
                                            : 'bg-slate-900 text-white border-slate-900'
                                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                }`}
                            >
                                <i className={`ti ${f.icon} text-sm`} />
                                {f.label}
                                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                    <div className="flex flex-wrap gap-1.5">
                        {['All', ...CATEGORIES].map((cat) => (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => setCategoryFilter(cat)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                                    categoryFilter === cat ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                }`}
                            >
                                {cat} <span className="opacity-60">{categoryCounts[cat] ?? 0}</span>
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search documents..."
                        className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium w-48"
                    />
                </div>
            </div>

            {/* Document list */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-100 p-5 sm:p-8">
                {isDocsLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 space-y-3">
                        <div className="w-9 h-9 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                        <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">Loading Documents...</p>
                    </div>
                ) : filteredDocuments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
                        <div className="h-14 w-14 bg-white text-slate-300 rounded-2xl flex items-center justify-center border border-slate-100 shadow-xs mb-4">
                            <i className="ti ti-folder-x text-2xl" />
                        </div>
                        <h4 className="text-sm font-black text-slate-600 mb-1.5">No documents in this view</h4>
                        <p className="text-xs text-slate-400 font-medium max-w-sm">Nothing matches the current filters.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                        {filteredDocuments.map((doc) => {
                            const meta = getFileMeta(doc.file_name || doc.title || '');
                            const displayTitle = doc.title || doc.file_name || 'Untitled Document';
                            const fileUrl = getDocumentUrl(doc.file_path);
                            const status = getDocStatus(doc);
                            const badge = statusBadgeFor(status);
                            const isBusy = reviewingDocId === doc.id;
                            const isDeleting = deletingDocId === doc.id;

                            return (
                                <div
                                    key={doc.id}
                                    className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all"
                                >
                                    <div className={`h-11 w-11 shrink-0 rounded-xl flex items-center justify-center border ${meta.bg} ${meta.border} ${meta.color}`}>
                                        <i className={`ti ${meta.icon} text-xl`} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold text-slate-700 truncate" title={displayTitle}>
                                            {displayTitle}
                                        </p>
                                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                            {doc.category && (
                                                <span className="inline-flex px-2.5 py-0.5 bg-slate-50 text-slate-500 font-bold text-[10px] rounded-lg border border-slate-200 uppercase tracking-widest">
                                                    {doc.category}
                                                </span>
                                            )}
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 font-bold text-[10px] rounded-lg border uppercase tracking-widest ${badge.cls}`}>
                                                <i className={`ti ${badge.icon} text-xs`} /> {badge.label}
                                            </span>
                                            {doc.expires_at && (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-orange-50 text-orange-700 font-bold text-[10px] rounded-lg border border-orange-200">
                                                    Expires in {daysUntil(doc.expires_at)}d
                                                </span>
                                            )}
                                        </div>
                                        {status === 'rejected' && doc.rejection_reason && (
                                            <p className="mt-1.5 text-[11px] text-rose-600 font-medium leading-snug">
                                                <i className="ti ti-message-2 text-xs" /> {doc.rejection_reason}
                                            </p>
                                        )}

                                        <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                                            <button
                                                type="button"
                                                onClick={() => setPreviewDoc(doc)}
                                                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest cursor-pointer"
                                            >
                                                <i className="ti ti-eye text-sm" /> Preview
                                            </button>
                                            {doc.file_path && (
                                                <a
                                                    href={fileUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-700 uppercase tracking-widest"
                                                >
                                                    <i className="ti ti-download text-sm" /> Download
                                                </a>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(doc)}
                                                disabled={isDeleting}
                                                className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-500 hover:text-rose-700 uppercase tracking-widest disabled:opacity-50 cursor-pointer"
                                            >
                                                <i className={`ti ${isDeleting ? 'ti-loader animate-spin' : 'ti-trash'} text-sm`} /> Delete
                                            </button>
                                        </div>

                                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                                            {status !== 'approved' && (
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleReview(doc, 'approved')}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg transition-colors cursor-pointer"
                                                >
                                                    <i className={`ti ${isBusy ? 'ti-loader animate-spin' : 'ti-check'} text-sm`} /> Approve
                                                </button>
                                            )}
                                            {status !== 'rejected' && (
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => { setRejectReason(''); setRejectModalDoc(doc); }}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-rose-50 disabled:opacity-50 text-rose-600 font-bold text-[11px] rounded-lg border border-rose-200 transition-colors cursor-pointer"
                                                >
                                                    <i className="ti ti-x text-sm" /> Reject
                                                </button>
                                            )}
                                            {status !== 'pending' && (
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleReview(doc, 'pending')}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 disabled:opacity-50 text-slate-500 font-bold text-[11px] rounded-lg border border-slate-200 transition-colors cursor-pointer"
                                                >
                                                    <i className="ti ti-arrow-back-up text-sm" /> Reset
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Upload modal */}
            {isUploadOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
                        <h2 className="text-lg font-black text-slate-800 mb-4">Upload 201 Document</h2>
                        <form onSubmit={handleUploadSubmit} className="space-y-4">
                            {!employeeId && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Select Employee</label>
                                    <select
                                        required
                                        value={uploadData.employee_id}
                                        onChange={(e) => setUploadData({ ...uploadData, employee_id: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm"
                                    >
                                        <option value="">-- Choose Employee --</option>
                                        {employeeList.map((emp) => {
                                            const isTerm = emp.operational_status === 'Terminated' || emp.is_terminated;
                                            return (
                                                <option key={emp.id} value={emp.id} disabled={isTerm}>
                                                    {emp.first_name} {emp.last_name} ({emp.company_id}){isTerm ? ' — Separated' : ''}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Category</label>
                                <select
                                    value={uploadData.category}
                                    onChange={(e) => setUploadData({ ...uploadData, category: e.target.value })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-sm"
                                >
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Document File</label>
                                <input
                                    type="file"
                                    required
                                    accept=".pdf,.png,.jpg,.jpeg"
                                    onChange={(e) => setUploadData({ ...uploadData, file: e.target.files[0] })}
                                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-600 file:font-bold hover:file:bg-slate-200"
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                                <button type="button" onClick={() => setIsUploadOpen(false)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer">
                                    Cancel
                                </button>
                                <button type="submit" className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl cursor-pointer">
                                    Upload File
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Preview modal */}
            {previewDoc && (
                <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-3xl w-full h-[80vh] flex flex-col p-4">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800">{previewDoc.title || previewDoc.file_name}</h3>
                            <button onClick={() => setPreviewDoc(null)} className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer">✕</button>
                        </div>
                        <iframe src={getDocumentUrl(previewDoc.file_path)} className="w-full flex-1 rounded bg-slate-50" title="Document Preview" />
                    </div>
                </div>
            )}

            {/* Reject reason modal */}
            {rejectModalDoc && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center shrink-0 border-4 border-rose-100">
                                <i className="ti ti-file-x text-xl" />
                            </div>
                            <div>
                                <h2 className="text-base font-black text-slate-800">Reject Document</h2>
                                <p className="text-xs text-slate-500 truncate max-w-[260px]">
                                    {rejectModalDoc.title || rejectModalDoc.file_name || 'Untitled Document'}
                                </p>
                            </div>
                        </div>
                        <div>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                                Reason (optional, visible to employee)
                            </label>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={3}
                                placeholder="e.g. Image is blurry, please re-upload a clearer scan."
                                className="mt-1.5 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium resize-none"
                            />
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { setRejectModalDoc(null); setRejectReason(''); }}
                                className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmReject}
                                disabled={reviewingDocId === rejectModalDoc.id}
                                className="flex-1 py-2.5 bg-rose-600 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs cursor-pointer disabled:cursor-not-allowed transition-colors"
                            >
                                {reviewingDocId === rejectModalDoc.id ? 'Rejecting...' : 'Confirm Reject'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}