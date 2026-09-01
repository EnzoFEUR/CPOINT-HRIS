import { useState, useEffect, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../utils/api';
import EmployeeAvatar from '../../components/EmployeeAvatar';

const CATEGORIES = ['General', 'Government ID', 'Educational', 'Medical', 'Clearance', 'Contract / Agreement'];
const EXPIRABLE_CATEGORIES = ['Government ID', 'Clearance'];
const EXPIRY_WARNING_DAYS = 30;

export default function MyProfile() {
    const initialUser = (() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw && raw !== 'undefined') {
                const u = JSON.parse(raw);
                return {
                    id: u.id || u.user_id,
                    company_id: u.company_id || u.employee_id || u.emp_id || 'CP-MAIN',
                    first_name: u.first_name || (u.name ? u.name.split(' ')[0] : ''),
                    last_name: u.last_name || (u.name ? u.name.split(' ').slice(1).join(' ') : ''),
                    email: u.email || 'N/A',
                    phone: u.phone || u.contact_no || '',
                    gender: u.gender || 'N/A',
                    birth_date: u.birth_date || null,
                    address: u.address || '',
                    department: u.department || 'Operations',
                    job_title: u.job_title || u.position || 'Staff Member',
                    created_at: u.created_at || null,
                    avatar_url: u.avatar_url || u.photo_url || null,
                    photo_url: u.photo_url || u.avatar_url || null,
                    has_registered_biometrics: u.has_registered_biometrics ?? true,
                };
            }
        } catch { }
        return null;
    })();

    const [profile, setProfile] = useState(initialUser);
    const [documents, setDocuments] = useState([]);
    const [isLoading, setIsLoading] = useState(!initialUser);
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
                    company_id: raw.company_id || raw.employee_id || raw.emp_id || raw.id || 'CP-MAIN',
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
                    avatar_url: raw.avatar_url || raw.photo_url || raw.photo || raw.profile_picture || raw.image_url || null,
                    photo_url: raw.photo_url || raw.avatar_url || raw.photo || raw.profile_picture || raw.image_url || null,
                    has_registered_biometrics: raw.has_registered_biometrics ?? true,
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

    if (isLoading && !profile) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-400 font-bold tracking-widest uppercase text-xs">Loading Profile...</p>
            </div>
        );
    }

    return (
        <div
            className="max-w-5xl mx-auto space-y-5 pb-20 px-4 sm:px-6 font-sans relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            
                {isDraggingFile && (
                    <div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-blue-600/10 backdrop-blur-xs flex items-center justify-center pointer-events-none"
                    >
                        <div className="bg-white rounded-xl shadow-xl border-2 border-dashed border-blue-500 px-10 py-8 flex flex-col items-center">
                            <i className="ti ti-cloud-upload text-4xl text-blue-600 mb-2" />
                            <p className="font-bold text-slate-800 text-sm uppercase tracking-wider">Drop to Upload</p>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">Attach to your 201 Document Vault</p>
                        </div>
                    </div>
                )}
            

            {/* Enterprise Profile Header Card (Consistent with Admin Show.jsx) */}
            <div className="bg-slate-900 rounded-xl p-5 sm:p-7 border border-slate-800 text-white shadow-xs relative">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
                    <div className="relative h-24 w-24 sm:h-28 sm:w-28 shrink-0">
                        <EmployeeAvatar
                            employee={profile}
                            size="h-24 w-24 sm:h-28 sm:w-28"
                            rounded="rounded-xl"
                            border="border-2 border-slate-700"
                            shadow="shadow-xs"
                            theme="dark"
                            textSize="text-3xl sm:text-4xl"
                        />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-800 text-slate-200 text-xs font-mono font-bold rounded border border-slate-700">
                                <i className="ti ti-id text-slate-400" /> {profile?.company_id || 'EMPLOYEE'}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded border border-blue-500/30">
                                {profile?.department || 'Operations'}
                            </span>
                            {(profile?.department || '').toLowerCase().includes('factory') ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-purple-500/20 text-purple-300 text-xs font-semibold rounded border border-purple-500/30">
                                    Piece-Rate Production
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs font-semibold rounded border border-emerald-500/30">
                                    Salaried Monthly
                                </span>
                            )}
                        </div>

                        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
                            {profile?.first_name} {profile?.last_name}
                        </h1>
                        <p className="text-slate-300 font-medium text-xs sm:text-sm mt-0.5">
                            {profile?.job_title || 'Staff Member'}
                        </p>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-xs font-medium text-slate-400">
                            <span className="flex items-center gap-1.5">
                                <i className="ti ti-mail text-slate-400 text-sm" /> {profile?.email || 'N/A'}
                            </span>
                            {profile?.phone && (
                                <span className="flex items-center gap-1.5 font-mono">
                                    <i className="ti ti-phone text-slate-400 text-sm" /> {profile.phone}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
                        {alerts.length > 0 && (
                            <div className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold">
                                <i className="ti ti-alert-triangle text-amber-400 text-sm" /> {alerts.length} Doc{alerts.length > 1 ? 's' : ''} Need Attention
                            </div>
                        )}
                        <button
                            onClick={() => openUploadModal()}
                            className="w-full sm:w-auto px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            <i className="ti ti-upload text-sm" /> Upload Document
                        </button>
                    </div>
                </div>
            </div>

            {/* Personal and Employment Details Grid (Aligned with Admin Show.jsx) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                
                {/* Personal Information */}
                <div className="bg-white rounded-xl p-5 sm:p-6 shadow-xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                            <i className="ti ti-user text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Personal Details</h3>
                            <p className="text-[11px] text-slate-500">Government identity and contact details</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5 text-xs">
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">First Name</p>
                            <p className="font-semibold text-slate-900">{profile?.first_name || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Last Name</p>
                            <p className="font-semibold text-slate-900">{profile?.last_name || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Gender</p>
                            <p className="font-semibold text-slate-900 capitalize">{profile?.gender || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Birth Date</p>
                            <p className="font-mono font-semibold text-slate-900">{formatDate(profile?.birth_date)}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Email Address</p>
                            <p className="font-semibold text-slate-900 truncate">{profile?.email || 'N/A'}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Home Address</p>
                            <p className="font-semibold text-slate-900">{profile?.address || 'No address registered'}</p>
                        </div>
                    </div>
                </div>

                {/* Employment & Payroll Details */}
                <div className="bg-white rounded-xl p-5 sm:p-6 shadow-xs border border-slate-200 space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                        <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                            <i className="ti ti-briefcase text-lg" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 text-sm">Employment & Payroll</h3>
                            <p className="text-[11px] text-slate-500">Organizational role and compensation scheme</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5 text-xs">
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Company ID</p>
                            <p className="font-mono font-semibold text-slate-900">{profile?.company_id || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Department</p>
                            <p className="font-semibold text-slate-900">{profile?.department || 'N/A'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Role / Title</p>
                            <p className="font-semibold text-slate-900">{profile?.job_title || profile?.role || 'Staff'}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Date Joined</p>
                            <p className="font-mono font-semibold text-slate-900">{formatDate(profile?.created_at)}</p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-slate-500 font-semibold uppercase text-[10px] mb-0.5">Employment Status</p>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 font-semibold text-[11px] rounded border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active Full-Time
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 201 Personnel Document Vault Section (Directly Aligned Below) */}
            <div className="space-y-4">
                
                    {alerts.length > 0 && (
                        <div
                            initial={{ opacity: 0, y: -8, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5"
                        >
                            <div className="flex items-start gap-3">
                                <div className="h-8 w-8 shrink-0 bg-amber-100 text-amber-700 rounded-lg flex items-center justify-center">
                                    <i className="ti ti-alert-triangle text-base" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs sm:text-sm font-bold text-amber-900">
                                        {alerts.length} document{alerts.length > 1 ? 's need' : ' needs'} renewal
                                    </p>
                                    <p className="text-xs text-amber-700 font-medium mt-0.5">Please update or submit renewals before the expiry date.</p>
                                    <div className="flex flex-wrap gap-2 mt-2.5">
                                        {alerts.map(({ doc, status }) => (
                                            <span
                                                key={doc.id}
                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}
                                            >
                                                <i className={`ti ${status.level === 'expired' ? 'ti-circle-x' : 'ti-clock'} text-xs`} />
                                                {doc.title || doc.file_name} · {status.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                

                <div className="bg-white rounded-xl p-5 sm:p-6 shadow-xs border border-slate-200">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100">
                                <i className="ti ti-folders text-lg" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-900 text-sm sm:text-base">201 Personnel Document Vault</h3>
                                <p className="text-xs text-slate-500">Government credentials, contracts, and company clearances</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {documents.length > 0 && (
                                <div className="relative">
                                    <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                                    <input
                                        type="text"
                                        placeholder="Search files..."
                                        value={docSearch}
                                        onChange={(e) => setDocSearch(e.target.value)}
                                        className="pl-7 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:border-blue-500 font-medium text-xs text-slate-800 transition-all w-36 sm:w-48"
                                    />
                                </div>
                            )}
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-md font-mono text-xs font-semibold whitespace-nowrap">
                                {filteredDocuments.length} File{filteredDocuments.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>

                        {documents.length === 0 ? (
                            <div
                                onClick={() => openUploadModal()}
                                className="text-center py-10 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 space-y-2.5 cursor-pointer hover:border-blue-300 hover:bg-blue-50/20 transition-colors"
                            >
                                <i className="ti ti-folder-plus text-3xl text-slate-400 block" />
                                <div>
                                    <p className="font-semibold text-slate-700 text-xs sm:text-sm">No 201 documents uploaded yet</p>
                                    <p className="text-[11px] text-slate-500">Click here or drag files to upload government IDs and certificates.</p>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openUploadModal(); }}
                                    className="px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-upload" /> Upload First Document
                                </button>
                            </div>
                        ) : filteredDocuments.length === 0 ? (
                            <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                <i className="ti ti-file-search text-3xl text-slate-400 block mb-1" />
                                <p className="font-semibold text-slate-600 text-xs">No files match "{docSearch}"</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                {filteredDocuments.map((doc) => {
                                    const meta = getFileMeta(doc.file_name || doc.title);
                                    const status = getExpiryStatus(doc);
                                    const fileUrl = doc.file_path?.startsWith('http')
                                        ? doc.file_path
                                        : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/documents/${doc.file_path}`;

                                    return (
                                        <div key={doc.id} className="p-3.5 rounded-lg border border-slate-200 hover:border-blue-200 hover:shadow-xs transition-all flex items-start gap-3 bg-white">
                                            {isImageFile(doc.file_name) ? (
                                                <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden border border-slate-200">
                                                    <img src={fileUrl} alt="" className="h-full w-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center border ${meta.bg} ${meta.color} ${meta.border}`}>
                                                    <i className={`ti ${meta.icon} text-lg`} />
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-slate-800 truncate" title={doc.title || doc.file_name}>{doc.title || doc.file_name}</p>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    {doc.category && (
                                                        <span className="inline-block px-1.5 py-0.2 bg-slate-100 text-slate-600 font-semibold text-[10px] rounded">
                                                            {doc.category}
                                                        </span>
                                                    )}
                                                    {status && (
                                                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border text-[10px] font-semibold ${expiryBadgeStyles[status.level]}`}>
                                                            {status.level === 'valid' ? 'Valid' : status.label}
                                                        </span>
                                                    )}
                                                </div>
                                                <a
                                                    href={fileUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="mt-2 text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1"
                                                >
                                                    <i className="ti ti-external-link text-xs" /> View File
                                                </a>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

            
                {showUploadModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
                        <div
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            className="bg-white rounded-xl p-5 sm:p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-5 max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-8 w-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center shrink-0">
                                        <i className="ti ti-file-upload text-base" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900 text-sm sm:text-base">Upload 201 Document</h3>
                                        <p className="text-[11px] text-slate-500">Attach file to your permanent HR record</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => { if (!isUploading) { setShowUploadModal(false); resetUploadForm(); } }}
                                    disabled={isUploading}
                                    className="h-7 w-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all shrink-0 cursor-pointer"
                                >
                                    <i className="ti ti-x text-xs" />
                                </button>
                            </div>

                            <form onSubmit={handleUploadSubmit} className="space-y-3.5">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">Document Title</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. SSS E-1 Form, Pag-IBIG MID, Valid ID"
                                        value={uploadForm.title}
                                        onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                                        <select
                                            value={uploadForm.category}
                                            onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                                        >
                                            {CATEGORIES.map((cat) => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                                            Expiry Date {!showExpiryField && <span className="font-normal text-slate-400">(opt)</span>}
                                        </label>
                                        <input
                                            type="date"
                                            value={uploadForm.expiryDate}
                                            onChange={(e) => setUploadForm({ ...uploadForm, expiryDate: e.target.value })}
                                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">Select File</label>
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="relative border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:bg-slate-50 hover:border-blue-400 transition cursor-pointer"
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
                                            <div className="flex items-center gap-2.5 justify-center">
                                                <img
                                                    src={URL.createObjectURL(uploadForm.file)}
                                                    alt=""
                                                    className="h-10 w-10 rounded object-cover border border-slate-200"
                                                />
                                                <div className="text-left">
                                                    <p className="text-xs font-semibold text-slate-800 truncate max-w-[180px]">{uploadForm.file.name}</p>
                                                    <p className="text-[10px] text-slate-500">{formatFileSize(uploadForm.file.size)}</p>
                                                </div>
                                            </div>
                                        ) : uploadForm.file ? (
                                            <>
                                                <i className={`ti ${getFileMeta(uploadForm.file.name).icon} text-2xl ${getFileMeta(uploadForm.file.name).color} mb-1 block`} />
                                                <p className="text-xs font-semibold text-slate-800">{uploadForm.file.name}</p>
                                                <p className="text-[10px] text-slate-500 mt-0.5">{formatFileSize(uploadForm.file.size)}</p>
                                            </>
                                        ) : (
                                            <>
                                                <i className="ti ti-cloud-upload text-2xl text-blue-600 mb-1 block" />
                                                <p className="text-xs font-semibold text-slate-700">Click or drag file here</p>
                                                <p className="text-[10px] text-slate-400 mt-0.5">PDF, PNG, JPG up to 10MB</p>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => { setShowUploadModal(false); resetUploadForm(); }}
                                        disabled={isUploading}
                                        className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isUploading || !uploadForm.file}
                                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                                    >
                                        {isUploading ? (
                                            <>
                                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
                        </div>
                    </div>
                )}
            
        </div>
    );
}