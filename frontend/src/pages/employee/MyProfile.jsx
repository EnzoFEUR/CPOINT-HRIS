import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../utils/api';

const CATEGORIES = ['General', 'Government ID', 'Educational', 'Medical', 'Clearance', 'Contract / Agreement'];
const EXPIRABLE_CATEGORIES = ['Government ID', 'Clearance'];
const EXPIRY_WARNING_DAYS = 30;

export default function MyProfile() {
    const [profile, setProfile] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [imageError, setImageError] = useState(false);
    const [docSearch, setDocSearch] = useState('');
    const fileInputRef = useRef(null);
    const dragCounter = useRef(0);
    const [isDraggingFile, setIsDraggingFile] = useState(false);

    // Modal & Upload States
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadForm, setUploadForm] = useState({
        title: '',
        category: 'General',
        expiryDate: '',
        file: null
    });

    const loadProfileData = async () => {
        try {
            const profileRes = await fetchWithAuth('/api/profile');
            const profileData = await profileRes.json();

            const raw = profileData.employee || profileData.user || profileData.data?.employee || profileData.data?.user || profileData.data || profileData;

            if (raw && typeof raw === 'object') {
                const mappedProfile = {
                    id: raw.id || raw.user_id,
                    company_id: raw.company_id || raw.employee_id || raw.emp_id || raw.id || 'N/A',
                    first_name: raw.first_name || raw.firstname || (raw.name ? raw.name.split(' ')[0] : ''),
                    last_name: raw.last_name || raw.lastname || (raw.name ? raw.name.split(' ').slice(1).join(' ') : ''),
                    email: raw.email || raw.user?.email || 'N/A',
                    phone: raw.phone || raw.contact_no || raw.phone_number || raw.mobile || '',
                    gender: raw.gender || raw.sex || 'N/A',
                    birth_date: raw.birth_date || raw.dob || raw.birthdate || null,
                    address: raw.address || raw.home_address || raw.present_address || '',
                    department: raw.department?.name || raw.department || raw.dept || 'Operations',
                    job_title: raw.job_title || raw.position || raw.designation || raw.role || 'Staff Member',
                    created_at: raw.created_at || raw.hire_date || raw.date_joined || null,
                };

                setProfile(mappedProfile);

                if (mappedProfile.id) {
                    await fetchDocuments(mappedProfile.id);
                }
            } else {
                toast.error('Failed to parse profile payload');
            }
        } catch (err) {
            toast.error('Error connecting to profile server');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchDocuments = async (employeeId) => {
        try {
            const docsRes = await fetchWithAuth(`/api/employee-documents?employee_id=${employeeId}`);
            const docsData = await docsRes.json();
            if (docsData.success || Array.isArray(docsData.documents)) {
                setDocuments(docsData.documents || docsData.data || []);
            }
        } catch (err) {
            console.warn('Could not fetch documents:', err);
        }
    };

    useEffect(() => {
        loadProfileData();
    }, []);

    const resetUploadForm = () => {
        setUploadForm({ title: '', category: 'General', expiryDate: '', file: null });
    };

    const openUploadModal = (file = null) => {
        if (file) setUploadForm((prev) => ({ ...prev, file, title: prev.title || file.name.replace(/\.[^/.]+$/, '') }));
        setShowUploadModal(true);
    };

    const handleUploadSubmit = async (e) => {
        e.preventDefault();

        if (!profile?.id) {
            toast.error('User profile not loaded properly. Please refresh.');
            return;
        }

        if (!uploadForm.file || !uploadForm.title.trim()) {
            toast.error('Please fill in the title and select a file');
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('employee_id', profile.id);
            formData.append('title', uploadForm.title);
            formData.append('category', uploadForm.category);
            if (uploadForm.expiryDate) formData.append('expiry_date', uploadForm.expiryDate);
            formData.append('file', uploadForm.file);

            const res = await fetchWithAuth('/api/employee-documents', {
                method: 'POST',
                body: formData
            });

            // Parse response body safely
            const rawText = await res.text();
            let data = {};
            try {
                data = JSON.parse(rawText);
            } catch {
                console.error('Server response non-JSON:', rawText);
            }

            if (res.ok && (data.success || data.document)) {
                toast.success('Document uploaded successfully!');
                setShowUploadModal(false);
                resetUploadForm();
                if (profile?.id) await fetchDocuments(profile.id);
            } else {
                toast.error(data.message || data.error || `Upload failed with status ${res.status}`);
            }
        } catch (err) {
            console.error('Document upload error:', err);
            toast.error(err.message || 'Error uploading document');
        } finally {
            setIsUploading(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return '';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const getFileMeta = (fileName = '') => {
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        switch (ext) {
            case 'pdf':
                return { icon: 'ti-file-type-pdf', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-100' };
            case 'doc':
            case 'docx':
                return { icon: 'ti-file-type-docx', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-100' };
            case 'xls':
            case 'xlsx':
                return { icon: 'ti-file-type-xls', color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-100' };
            case 'png':
            case 'jpg':
            case 'jpeg':
                return { icon: 'ti-photo', color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-100' };
            default:
                return { icon: 'ti-file', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-100' };
        }
    };

    const isImageFile = (fileName = '') => ['png', 'jpg', 'jpeg'].includes((fileName.split('.').pop() || '').toLowerCase());

    const getExpiryStatus = (doc) => {
        const expiryDate = doc.expiry_date || doc.expiryDate;
        if (!expiryDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(expiryDate);
        const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
        if (daysLeft < 0) return { level: 'expired', label: `Expired ${Math.abs(daysLeft)}d ago`, daysLeft };
        if (daysLeft <= EXPIRY_WARNING_DAYS) return { level: 'warning', label: `Expires in ${daysLeft}d`, daysLeft };
        return { level: 'valid', label: `Valid · exp. ${formatDate(expiryDate)}`, daysLeft };
    };

    const expiryBadgeStyles = {
        expired: 'bg-rose-50 text-rose-600 border-rose-200',
        warning: 'bg-amber-50 text-amber-600 border-amber-200',
        valid: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    };

    const alerts = useMemo(() => {
        return documents
            .map((doc) => ({ doc, status: getExpiryStatus(doc) }))
            .filter(({ status }) => status && status.level !== 'valid')
            .sort((a, b) => a.status.daysLeft - b.status.daysLeft);
    }, [documents]);

    const filteredDocuments = useMemo(() => {
        const q = docSearch.toLowerCase().trim();
        if (!q) return documents;
        return documents.filter((doc) =>
            (doc.title || '').toLowerCase().includes(q) || (doc.file_name || '').toLowerCase().includes(q)
        );
    }, [documents, docSearch]);

    const showExpiryField = EXPIRABLE_CATEGORIES.includes(uploadForm.category);

    const handleDragEnter = (e) => {
        e.preventDefault();
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
        const file = e.dataTransfer.files?.[0];
        if (file) openUploadModal(file);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-400 font-bold tracking-widest uppercase text-xs">Loading Profile...</p>
            </div>
        );
    }

    return (
        <div
            className="max-w-6xl mx-auto space-y-6 pb-20 px-4 sm:px-6 font-sans relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <AnimatePresence>
                {isDraggingFile && (
                    <motion.div
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
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl"
            >
                <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

                <div className="relative z-10 flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left">
                    <div className="relative h-28 w-28 sm:h-32 sm:w-32 shrink-0">
                        {!imageError && profile?.id ? (
                            <img
                                src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${profile.company_id}/${profile.id}.jpg`}
                                onError={() => setImageError(true)}
                                alt={profile?.first_name || 'User'}
                                className="w-full h-full object-cover rounded-2xl border-4 border-white/10 shadow-2xl bg-slate-800"
                            />
                        ) : (
                            <div className="w-full h-full rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-4xl font-black border-4 border-white/10 shadow-2xl">
                                {profile?.first_name ? profile.first_name.charAt(0) : 'U'}
                            </div>
                        )}
                        <span className="absolute -bottom-1 -right-1 h-6 w-6 bg-emerald-500 border-2 border-slate-900 rounded-full flex items-center justify-center" title="Active Account">
                            <i className="ti ti-check text-white text-xs font-bold" />
                        </span>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 text-xs font-bold rounded-xl border border-white/15 uppercase tracking-widest mb-2 backdrop-blur-md">
                            <i className="ti ti-id text-indigo-300" /> {profile?.company_id || 'EMPLOYEE'}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight truncate">
                            {profile?.first_name} {profile?.last_name}
                        </h1>
                        <p className="text-indigo-200 font-semibold text-sm mt-0.5">
                            {profile?.job_title || 'Staff Member'} • <span className="text-slate-300">{profile?.department || 'Operations'}</span>
                        </p>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-4 text-xs font-medium text-slate-300">
                            <span className="flex items-center gap-1">
                                <i className="ti ti-mail text-indigo-400 text-sm" /> {profile?.email || 'N/A'}
                            </span>
                            {profile?.phone && (
                                <span className="flex items-center gap-1">
                                    <i className="ti ti-phone text-indigo-400 text-sm" /> {profile.phone}
                                </span>
                            )}
                        </div>
                    </div>

                    {alerts.length > 0 && (
                        <button
                            onClick={() => setActiveTab('documents')}
                            className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all"
                        >
                            <i className="ti ti-alert-triangle text-sm" /> {alerts.length} Doc{alerts.length > 1 ? 's' : ''} Need Attention
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 mt-8 pt-6 border-t border-white/10 text-xs font-bold">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                                activeTab === 'overview'
                                    ? 'bg-white text-slate-900 shadow-md'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            <i className="ti ti-user text-base" /> Personal Info
                        </button>
                        <button
                            onClick={() => setActiveTab('documents')}
                            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                                activeTab === 'documents'
                                    ? 'bg-white text-slate-900 shadow-md'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                        >
                            <i className="ti ti-folders text-base" /> 201 Documents ({documents.length})
                        </button>
                    </div>

                    <button
                        onClick={() => openUploadModal()}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md hover:shadow-indigo-500/20 flex items-center gap-2"
                    >
                        <i className="ti ti-upload text-base" /> Upload Document
                    </button>
                </div>
            </motion.div>

            {activeTab === 'overview' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-100 space-y-5">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                                <i className="ti ti-id text-xl" />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800">Personal Information</h3>
                                <p className="text-xs text-slate-400 font-medium">Your identity and contact information</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">First Name</p>
                                <p className="font-bold text-slate-700 text-sm">{profile?.first_name || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Last Name</p>
                                <p className="font-bold text-slate-700 text-sm">{profile?.last_name || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Gender</p>
                                <p className="font-bold text-slate-700 capitalize">{profile?.gender || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Birth Date</p>
                                <p className="font-bold text-slate-700">{formatDate(profile?.birth_date)}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Home Address</p>
                                <p className="font-bold text-slate-700">{profile?.address || 'No address provided'}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-100 space-y-5">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="h-10 w-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                                <i className="ti ti-briefcase text-xl" />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800">Employment Details</h3>
                                <p className="text-xs text-slate-400 font-medium">Job position and organizational structure</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Company ID</p>
                                <p className="font-bold text-slate-700">{profile?.company_id || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Department</p>
                                <p className="font-bold text-slate-700">{profile?.department || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Role / Position</p>
                                <p className="font-bold text-slate-700">{profile?.job_title || profile?.role || 'Staff'}</p>
                            </div>
                            <div>
                                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-1">Date Joined</p>
                                <p className="font-bold text-slate-700">{formatDate(profile?.created_at)}</p>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}

            {activeTab === 'documents' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <AnimatePresence>
                        {alerts.length > 0 && (
                            <motion.div
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
                                            {alerts.length} document{alerts.length > 1 ? 's need' : ' needs'} your attention
                                        </p>
                                        <p className="text-xs text-amber-700/80 font-medium mt-0.5">Renew these before they lapse to stay compliant.</p>
                                        <div className="flex flex-wrap gap-2 mt-2.5">
                                            {alerts.map(({ doc, status }) => (
                                                <span
                                                    key={doc.id}
                                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold ${expiryBadgeStyles[status.level]}`}
                                                >
                                                    <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : 'ti-clock'} text-sm`} />
                                                    {doc.title || doc.file_name} · {status.label}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="bg-white rounded-3xl p-6 shadow-xs border border-slate-100">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-100">
                            <div>
                                <h3 className="font-black text-slate-800 text-lg">My 201 Documents</h3>
                                <p className="text-xs text-slate-400 font-medium">Official records and uploaded attachments</p>
                            </div>
                            <div className="flex items-center gap-2.5">
                                {documents.length > 0 && (
                                    <div className="relative">
                                        <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                                        <input
                                            type="text"
                                            placeholder="Search files..."
                                            value={docSearch}
                                            onChange={(e) => setDocSearch(e.target.value)}
                                            className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white font-medium text-xs text-slate-700 transition-all w-40 sm:w-48"
                                        />
                                    </div>
                                )}
                                <span className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs whitespace-nowrap">
                                    {filteredDocuments.length} File{filteredDocuments.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>

                        {documents.length === 0 ? (
                            <div
                                onClick={() => openUploadModal()}
                                className="text-center py-12 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 space-y-3 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
                            >
                                <i className="ti ti-folder-x text-4xl text-slate-300 block" />
                                <div>
                                    <p className="font-bold text-slate-600 text-sm">No documents found</p>
                                    <p className="text-xs text-slate-400">Click here, or drag & drop a file anywhere on this page.</p>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openUploadModal(); }}
                                    className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5"
                                >
                                    <i className="ti ti-plus" /> Add First Document
                                </button>
                            </div>
                        ) : filteredDocuments.length === 0 ? (
                            <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                                <i className="ti ti-file-search text-4xl text-slate-300 block mb-2" />
                                <p className="font-bold text-slate-600 text-sm">No files match "{docSearch}"</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredDocuments.map((doc) => {
                                    const meta = getFileMeta(doc.file_name || doc.title);
                                    const status = getExpiryStatus(doc);
                                    const fileUrl = doc.file_path?.startsWith('http')
                                        ? doc.file_path
                                        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/documents/${doc.file_path}`;

                                    return (
                                        <div key={doc.id} className="p-4 rounded-2xl border border-slate-100 hover:border-indigo-100 hover:shadow-md transition-all flex items-start gap-3 bg-white">
                                            {isImageFile(doc.file_name) ? (
                                                <div className="h-11 w-11 shrink-0 rounded-xl overflow-hidden border border-slate-100">
                                                    <img src={fileUrl} alt="" className="h-full w-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className={`h-11 w-11 shrink-0 rounded-xl flex items-center justify-center border ${meta.bg} ${meta.color} ${meta.border}`}>
                                                    <i className={`ti ${meta.icon} text-xl`} />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold text-slate-700 truncate" title={doc.title || doc.file_name}>{doc.title || doc.file_name}</p>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    {doc.category && (
                                                        <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-500 font-bold text-[10px] rounded-md uppercase tracking-wider">
                                                            {doc.category}
                                                        </span>
                                                    )}
                                                    {status && (
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${expiryBadgeStyles[status.level]}`}>
                                                            <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : status.level === 'warning' ? 'ti-clock' : 'ti-circle-check'} text-xs`} />
                                                            {status.level === 'valid' ? 'Valid' : status.label}
                                                        </span>
                                                    )}
                                                </div>
                                                <a
                                                    href={fileUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="mt-2 text-[11px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                                                >
                                                    <i className="ti ti-external-link" /> View Document
                                                </a>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </motion.div>
            )}

            <AnimatePresence>
                {showUploadModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100 space-y-6 max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                                        <i className="ti ti-file-upload text-xl" />
                                    </div>
                                    <div>
                                        <h3 className="font-black text-slate-800 text-lg">Upload 201 Document</h3>
                                        <p className="text-xs text-slate-400 font-medium">Add a new file to your personal folder</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { if (!isUploading) { setShowUploadModal(false); resetUploadForm(); } }}
                                    disabled={isUploading}
                                    className="h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-all shrink-0"
                                >
                                    <i className="ti ti-x text-sm" />
                                </button>
                            </div>

                            <form onSubmit={handleUploadSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Document Title</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. SSS Form, BIR 2316, Diploma"
                                        value={uploadForm.title}
                                        onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-1">Category</label>
                                        <select
                                            value={uploadForm.category}
                                            onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                                        >
                                            {CATEGORIES.map((cat) => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-1">
                                            Expiry {!showExpiryField && <span className="font-medium text-slate-300 normal-case">(optional)</span>}
                                        </label>
                                        <input
                                            type="date"
                                            value={uploadForm.expiryDate}
                                            onChange={(e) => setUploadForm({ ...uploadForm, expiryDate: e.target.value })}
                                            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                                        />
                                    </div>
                                </div>
                                {showExpiryField && (
                                    <p className="-mt-2 text-[11px] text-indigo-500 font-medium flex items-center gap-1">
                                        <i className="ti ti-info-circle text-sm" /> We'll remind you as this gets close to expiring.
                                    </p>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Select File</label>
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="relative border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center hover:bg-slate-50/60 hover:border-indigo-300 transition cursor-pointer"
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                                            onChange={(e) => e.target.files[0] && setUploadForm({ ...uploadForm, file: e.target.files[0] })}
                                            onClick={(e) => e.stopPropagation()}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />
                                        {uploadForm.file && isImageFile(uploadForm.file.name) ? (
                                            <div className="flex items-center gap-3 justify-center">
                                                <img
                                                    src={URL.createObjectURL(uploadForm.file)}
                                                    alt=""
                                                    className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                                                />
                                                <div className="text-left">
                                                    <p className="text-xs font-bold text-slate-600 truncate max-w-[180px]">{uploadForm.file.name}</p>
                                                    <p className="text-[10px] text-slate-400 font-medium">{formatFileSize(uploadForm.file.size)}</p>
                                                </div>
                                            </div>
                                        ) : uploadForm.file ? (
                                            <>
                                                <i className={`ti ${getFileMeta(uploadForm.file.name).icon} text-3xl ${getFileMeta(uploadForm.file.name).color} mb-1 block`} />
                                                <p className="text-xs font-bold text-slate-600">{uploadForm.file.name}</p>
                                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">{formatFileSize(uploadForm.file.size)}</p>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-cloud-upload text-3xl text-indigo-500 mb-1 block" />
                                                <p className="text-xs font-bold text-slate-600">Click or drag file here</p>
                                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">PDF, PNG, JPG, DOC, or XLS up to 10MB</p>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => { setShowUploadModal(false); resetUploadForm(); }}
                                        disabled={isUploading}
                                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isUploading || !uploadForm.file}
                                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
                                    >
                                        {isUploading ? (
                                            <>
                                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                Uploading...
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-upload" /> Submit Document
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}