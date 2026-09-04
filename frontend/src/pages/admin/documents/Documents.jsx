import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient'; // Make sure this import path matches your project structure

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
const EXPIRY_WARNING_DAYS = 30;

export default function Documents() {
    const [searchParams] = useSearchParams();
    const employeeId = searchParams.get('employee_id');
    const fileInputRef = useRef(null);

    // Document & Loading states
    const [documents, setDocuments] = useState([]);
    const [employee, setEmployee] = useState(null);
    const [isTerminated, setIsTerminated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Filter, search & sort states
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('newest');

    // Upload Modal states
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [documentTitle, setDocumentTitle] = useState('');
    const [category, setCategory] = useState('Contract');
    const [expiryDate, setExpiryDate] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isDraggingPage, setIsDraggingPage] = useState(false);
    const dragCounter = useRef(0);

    // 1. FETCH DOCUMENTS & EMPLOYEE DETAILS ON COMPONENT MOUNT
    useEffect(() => {
        if (employeeId) {
            fetchDocuments();
        } else {
            setIsLoading(false);
        }
    }, [employeeId]);

    // Real-time synchronization for instant status changes
    useEffect(() => {
        if (!employeeId) return;
        const channel = supabase
            .channel(`admin-docs-${employeeId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `id=eq.${employeeId}` }, () => {
                fetchDocuments();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs', filter: `employee_id=eq.${employeeId}` }, () => {
                fetchDocuments();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_documents', filter: `employee_id=eq.${employeeId}` }, () => {
                fetchDocuments();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [employeeId]);

    const fetchDocuments = async () => {
        try {
            setIsLoading(true);

            const [
                { data: docData, error: docError },
                { data: empData, error: empError },
                { data: termLogs }
            ] = await Promise.all([
                supabase
                    .from('employee_documents')
                    .select('*')
                    .eq('employee_id', employeeId)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('employees')
                    .select('id, first_name, last_name, company_id, department, job_title, status, is_active')
                    .eq('id', employeeId)
                    .maybeSingle(),
                supabase
                    .from('disciplinary_logs')
                    .select('id, type, reason, created_at')
                    .eq('employee_id', employeeId)
                    .eq('type', 'Termination')
                    .limit(1)
            ]);

            if (docError) throw docError;
            setDocuments(docData || []);

            if (empData) {
                setEmployee(empData);
                const terminated = 
                    empData.status === 'inactive' || 
                    empData.status === 'terminated' || 
                    empData.is_active === false || 
                    Boolean(termLogs && termLogs.length > 0);
                setIsTerminated(terminated);
            }
        } catch (error) {
            console.error('Error fetching documents:', error);
            toast.error('Failed to load documents from database.');
        } finally {
            setIsLoading(false);
        }
    };

    // Generate Public URL for stored files in 'documents' bucket
    const getPublicUrl = (filePath) => {
        if (!filePath) return '#';
        const { data } = supabase.storage
            .from('documents')
            .getPublicUrl(filePath);
        return data.publicUrl;
    };

    // Format file size
    const formatFileSize = (bytes) => {
        if (!bytes) return '0 KB';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Get icon based on file extension
    const getFileIcon = (fileName = '') => {
        const ext = fileName.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext)) return 'ti-photo text-sky-500 bg-sky-50';
        if (['pdf'].includes(ext)) return 'ti-file-type-pdf text-rose-500 bg-rose-50';
        if (['doc', 'docx'].includes(ext)) return 'ti-file-description text-blue-500 bg-blue-50';
        return 'ti-file-text text-indigo-500 bg-indigo-50';
    };

    const isImageFile = (fileName = '') => {
        const ext = fileName.split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext);
    };

    // ---- Expiry helpers ----
    const getExpiryStatus = (doc) => {
        if (!doc.expiry_date) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(doc.expiry_date);
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

        if (daysLeft < 0) return { level: 'expired', label: 'Expired', daysLeft };
        if (daysLeft <= EXPIRY_WARNING_DAYS) return { level: 'warning', label: `Expires in ${daysLeft}d`, daysLeft };
        return { level: 'valid', label: 'Valid', daysLeft };
    };

    const expiryBadgeStyles = {
        expired: 'bg-rose-50 text-rose-600 border-rose-200',
        warning: 'bg-amber-50 text-amber-600 border-amber-200',
        valid: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    };

    const alerts = useMemo(() => {
        return documents
            .map((doc) => ({ doc, status: getExpiryStatus(doc) }))
            .filter(({ status }) => status && (status.level === 'expired' || status.level === 'warning'))
            .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    }, [documents]);

    const resetUploadForm = () => {
        setDocumentTitle('');
        setSelectedFile(null);
        setCategory('Contract');
        setExpiryDate('');
    };

    const openModalWithFile = (file) => {
        if (isTerminated) {
            toast.error('Cannot upload documents: Employee account is separated/terminated.');
            return;
        }
        setSelectedFile(file);
        setIsUploadModalOpen(true);
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
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
            const fileExt = selectedFile.name.split('.').pop();
            const filePath = `${employeeId}/${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;

            // Step A: Upload File to Storage Bucket 'documents'
            const { error: storageError } = await supabase.storage
                .from('documents')
                .upload(filePath, selectedFile, {
                    cacheControl: '3600',
                    upsert: false
                });

            if (storageError) throw storageError;

            // Step B: Insert Record into Database
            const { data: insertedData, error: dbError } = await supabase
                .from('employee_documents')
                .insert([
                    {
                        employee_id: employeeId,
                        title: documentTitle.trim() || selectedFile.name,
                        category: category,
                        file_name: selectedFile.name,
                        file_path: filePath,
                        file_size: formatFileSize(selectedFile.size),
                        expiry_date: expiryDate || null
                    }
                ])
                .select()
                .single();

            if (dbError) throw dbError;

            setDocuments((prev) => [insertedData, ...prev]);
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
            // Step A: Remove from Storage Bucket 'documents'
            const { error: storageError } = await supabase.storage
                .from('documents')
                .remove([doc.file_path]);

            if (storageError) console.error('Storage deletion warning:', storageError);

            // Step B: Delete row from DB Table
            const { error: dbError } = await supabase
                .from('employee_documents')
                .delete()
                .eq('id', doc.id);

            if (dbError) throw dbError;

            setDocuments((prev) => prev.filter((item) => item.id !== doc.id));
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
            const matchesSearch = doc.title.toLowerCase().includes(q) || doc.file_name.toLowerCase().includes(q);
            return matchesCategory && matchesSearch;
        });

        switch (sortBy) {
            case 'oldest':
                result = [...result].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                break;
            case 'name':
                result = [...result].sort((a, b) => a.title.localeCompare(b.title));
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
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-indigo-600/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none"
                    >
                        <div className="bg-white rounded-3xl shadow-2xl border-2 border-dashed border-indigo-400 px-12 py-10 flex flex-col items-center">
                            <i className="ti ti-cloud-upload text-5xl text-indigo-600 mb-2" />
                            <p className="font-black text-slate-800 text-sm uppercase tracking-widest">Drop to Upload</p>
                            <p className="text-xs text-slate-400 font-medium mt-1">We'll take it from here</p>
                        </div>
                    </div>
                )}
            

            {/* TOP NAVIGATION */}
            <div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                <Link
                    to={employeeId ? `/admin/employees/${employeeId}` : '/admin/employees'}
                    className="px-4 py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm border border-slate-100 flex items-center gap-2 tap-active"
                >
                    <i className="ti ti-arrow-left text-lg" /> Back to Profile
                </Link>

                {isTerminated ? (
                    <button
                        type="button"
                        disabled
                        title="Uploads disabled: Employee account is separated/terminated."
                        className="px-4 py-2.5 bg-slate-100 text-slate-400 border border-slate-200 font-bold text-xs uppercase tracking-widest rounded-xl shadow-xs flex items-center gap-2 cursor-not-allowed select-none"
                    >
                        <i className="ti ti-lock text-base" /> Uploads Disabled
                    </button>
                ) : (
                    <button
                        onClick={() => setIsUploadModalOpen(true)}
                        className="px-4 py-2.5 bg-indigo-600 text-white font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-sm flex items-center gap-2 tap-active cursor-pointer"
                    >
                        <i className="ti ti-upload text-lg" /> Upload Document
                    </button>
                )}
            </div>

            {/* Header */}
            <div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={`bg-white rounded-2xl shadow-sm border ${isTerminated ? 'border-rose-200' : 'border-slate-100'} p-6 sm:p-8`}>
                <div className="flex items-center gap-4">
                    <div className={`h-12 w-12 ${isTerminated ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-sky-50 text-sky-600 border-sky-100'} rounded-2xl flex items-center justify-center border`}>
                        <i className={`ti ${isTerminated ? 'ti-file-off' : 'ti-folders'} text-2xl`} />
                    </div>
                    <div>
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h1 className="text-2xl font-black text-slate-800 tracking-tight">201 Documents</h1>
                            {isTerminated && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200">
                                    <i className="ti ti-lock text-xs" /> Separated · Read-Only Audit
                                </span>
                            )}
                        </div>
                        <p className="text-slate-500 text-sm font-medium mt-0.5">
                            {employee 
                                ? `${employee.first_name} ${employee.last_name} (${employee.company_id || 'No ID'}) · ${employee.department || 'Staff'}` 
                                : employeeId 
                                ? `Managing files for Employee ID: ${employeeId}` 
                                : 'Managing company files'}
                        </p>
                    </div>
                </div>
            </div>

            {/* TERMINATED AUDIT BANNER */}
            {isTerminated && (
                <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 sm:p-5 shadow-xs">
                    <div className="flex items-start gap-3.5">
                        <div className="h-10 w-10 shrink-0 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center border border-rose-200">
                            <i className="ti ti-lock text-xl font-bold" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h4 className="text-sm font-black text-rose-950 uppercase tracking-wide">
                                    Document Uploads Disabled (Separated Account)
                                </h4>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-800">
                                    Read-Only Audit Mode
                                </span>
                            </div>
                            <p className="text-xs text-rose-800/90 leading-relaxed font-medium">
                                This employee account is officially separated / terminated. In compliance with Philippine DOLE labor standards and audit governance, new document uploads and file edits are locked. All historical 201 records remain accessible below for review and compliance export.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* COMPLIANCE ALERTS */}
            
                {alerts.length > 0 && (
                    <div
                        initial={{ opacity: 0, y: -8, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5"
                    >
                        <div className="flex items-start gap-3">
                            <div className="h-9 w-9 shrink-0 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
                                <i className="ti ti-alert-triangle text-lg" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-black text-amber-800">
                                    {alerts.length} document{alerts.length > 1 ? 's need' : ' needs'} attention
                                </p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {alerts.map(({ doc, status }) => (
                                        <span
                                            key={doc.id}
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${expiryBadgeStyles[status.level]}`}
                                        >
                                            <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : 'ti-clock'} text-sm`} />
                                            {doc.title} · {status.level === 'expired' ? `Expired ${Math.abs(status.daysLeft)}d ago` : status.label}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            

            {/* CONTROLS */}
            <div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                    <div className="relative w-full sm:w-80">
                        <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
                        <input
                            type="text"
                            placeholder="Search documents..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 font-medium text-xs text-slate-700 transition-all shadow-sm"
                        />
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="relative">
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="appearance-none pl-3 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 font-bold text-xs text-slate-600 transition-all shadow-sm cursor-pointer"
                            >
                                {SORT_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
                        </div>

                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                            {filteredDocuments.length} File{filteredDocuments.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {CATEGORIES.map((cat) => {
                        const count = cat === 'All' ? documents.length : documents.filter((d) => d.category === cat).length;
                        return (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-3.5 py-1.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all flex items-center gap-1.5 ${
                                    selectedCategory === cat
                                        ? 'bg-slate-800 text-white shadow-sm'
                                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                }`}
                            >
                                {cat}
                                {count > 0 && (
                                    <span className={`text-[10px] px-1.5 rounded-full ${selectedCategory === cat ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
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
                    <i className="ti ti-loader animate-spin text-4xl text-indigo-600 mb-2" />
                    <p className="text-xs font-bold uppercase tracking-widest">Loading Documents...</p>
                </div>
            ) : filteredDocuments.length === 0 ? (
                <div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    onClick={() => !isTerminated && documents.length === 0 && setIsUploadModalOpen(true)}
                    className={`border-2 border-dashed border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center text-slate-400 bg-white shadow-sm ${!isTerminated && documents.length === 0 ? 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors' : ''}`}
                >
                    <i className="ti ti-file-x text-5xl mb-3 text-slate-300" />
                    <p className="text-sm font-bold uppercase tracking-widest text-slate-500">
                        {documents.length === 0 ? (isTerminated ? 'No Archived Documents on Record' : 'No Documents Yet') : 'No Matching Documents Found'}
                    </p>
                    <p className="text-xs text-slate-400 font-medium mt-1 text-center">
                        {documents.length === 0 
                            ? (isTerminated ? 'This separated account has no archived 201 documents. File uploads are locked.' : 'Click here, or drag & drop a file anywhere on this page.') 
                            : 'Try adjusting your search query or selected category filter.'}
                    </p>
                </div>
            ) : (
                <div layout className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    
                        {filteredDocuments.map((doc) => {
                            const iconClasses = getFileIcon(doc.file_name);
                            const status = getExpiryStatus(doc);
                            const publicUrl = getPublicUrl(doc.file_path);

                            return (
                                <div
                                    key={doc.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
                                >
                                    <div>
                                        <div className="flex items-start justify-between gap-3 mb-3">
                                            {isImageFile(doc.file_name) ? (
                                                <div className="h-11 w-11 rounded-xl overflow-hidden border border-slate-100 shrink-0">
                                                    <img src={publicUrl} alt="" className="h-full w-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${iconClasses}`}>
                                                    <i className={`ti ${iconClasses.split(' ')[0]} text-2xl`} />
                                                </div>
                                            )}
                                            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-bold text-[10px] uppercase tracking-wider rounded-lg">
                                                {doc.category}
                                            </span>
                                        </div>

                                        <h3 className="font-bold text-slate-800 text-sm tracking-tight line-clamp-1 group-hover:text-indigo-600 transition-colors" title={doc.title}>
                                            {doc.title}
                                        </h3>
                                        <p className="text-slate-400 text-xs font-medium truncate mt-0.5" title={doc.file_name}>
                                            {doc.file_name}
                                        </p>

                                        {status && (
                                            <span className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-md border text-[10px] font-bold ${expiryBadgeStyles[status.level]}`}>
                                                <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : status.level === 'warning' ? 'ti-clock' : 'ti-circle-check'} text-xs`} />
                                                {status.level === 'expired' ? `Expired ${Math.abs(status.daysLeft)}d ago` : status.level === 'warning' ? status.label : `Valid · exp. ${doc.expiry_date}`}
                                            </span>
                                        )}
                                    </div>

                                    <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 font-medium">
                                        <div>
                                            <p className="text-[11px] text-slate-500 font-bold">
                                                {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </p>
                                            <p className="text-[10px]">{doc.file_size}</p>
                                        </div>

                                        <div className="flex items-center gap-1">
                                            <a
                                                href={publicUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition"
                                                title="View / Download"
                                            >
                                                <i className="ti ti-download text-lg" />
                                            </a>
                                            <button
                                                onClick={() => handleDeleteDocument(doc)}
                                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                                title="Delete"
                                            >
                                                <i className="ti ti-trash text-lg" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    
                </div>
            )}

            {/* UPLOAD DOCUMENT MODAL */}
            
                {isUploadModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                            onClick={() => !isUploading && setIsUploadModalOpen(false)}
                        />

                        <div
                            initial={{ scale: 0.95, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 20, opacity: 0 }}
                            className="relative bg-white rounded-3xl p-6 sm:p-8 shadow-2xl w-full max-w-lg border border-slate-100 z-10 max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                                        <i className="ti ti-file-upload text-xl" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-black text-slate-800">Upload 201 Document</h2>
                                        <p className="text-xs text-slate-400 font-medium">Attach PDF, images, or documents</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsUploadModalOpen(false)}
                                    className="text-slate-400 hover:text-slate-600 p-2 rounded-xl"
                                    disabled={isUploading}
                                >
                                    <i className="ti ti-x text-xl" />
                                </button>
                            </div>

                            <form onSubmit={handleUploadSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        Document Title
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Employment Contract, NBI Clearance"
                                        value={documentTitle}
                                        onChange={(e) => setDocumentTitle(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 font-medium text-sm text-slate-700 transition-all"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Category
                                        </label>
                                        <select
                                            value={category}
                                            onChange={(e) => setCategory(e.target.value)}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 font-medium text-sm text-slate-700 transition-all"
                                        >
                                            {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Expiry Date {!showExpiryField && <span className="normal-case font-medium text-slate-300">(optional)</span>}
                                        </label>
                                        <input
                                            type="date"
                                            value={expiryDate}
                                            onChange={(e) => setExpiryDate(e.target.value)}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 font-medium text-sm text-slate-700 transition-all"
                                        />
                                    </div>
                                </div>

                                {showExpiryField && (
                                    <p className="-mt-2 text-[11px] text-indigo-500 font-medium flex items-center gap-1">
                                        <i className="ti ti-info-circle text-sm" /> We'll flag this document automatically as it nears expiry.
                                    </p>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        File
                                    </label>
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="relative border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center hover:bg-slate-50/50 hover:border-indigo-300 transition cursor-pointer"
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            onChange={handleFileChange}
                                            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        {selectedFile && isImageFile(selectedFile.name) ? (
                                            <div className="flex items-center gap-3 justify-center">
                                                <img
                                                    src={URL.createObjectURL(selectedFile)}
                                                    alt=""
                                                    className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                                                />
                                                <div className="text-left">
                                                    <p className="text-xs font-bold text-slate-600">{selectedFile.name}</p>
                                                    <p className="text-[10px] text-slate-400 font-medium">{formatFileSize(selectedFile.size)}</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <i className="ti ti-cloud-upload text-3xl text-indigo-500 mb-1 block" />
                                                <p className="text-xs font-bold text-slate-600">
                                                    {selectedFile ? selectedFile.name : 'Click or drag file here'}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                                                    {selectedFile ? formatFileSize(selectedFile.size) : 'PDF, PNG, JPG, or DOC up to 10MB'}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-4 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsUploadModalOpen(false)}
                                        disabled={isUploading}
                                        className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition text-xs uppercase tracking-widest"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isUploading || !selectedFile}
                                        className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                                    >
                                        {isUploading ? (
                                            <><i className="ti ti-loader animate-spin text-lg" /> Uploading...</>
                                        ) : (
                                            'Save File'
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