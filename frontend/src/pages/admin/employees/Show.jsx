import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { IconFolder, IconFileOff, IconFile, IconExternalLink } from '@tabler/icons-react';
import QRCode from '../../../components/QRCode';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function Show() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Employee State
    const [employee, setEmployee] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [imageError, setImageError] = useState(false);

    // Modals State
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    // 201 Documents State
    const [documents, setDocuments] = useState([]);
    const [isDocsLoading, setIsDocsLoading] = useState(true);

    // Fetch Employee Details
    useEffect(() => {
        if (!id || id === 'undefined') return;
        
        let isMounted = true;
        fetchWithAuth(`/api/employees/${id}`)
            .then(res => res.json())
            .then(data => {
                if (!isMounted) return;
                if (data.success) {
                    const emp = data.data;
                    emp.name = emp.name || `${emp.first_name} ${emp.last_name}`;
                    setEmployee(emp);
                } else {
                    toast.error('Employee not found');
                    navigate('/admin/employees');
                }
            })
            .catch(() => {
                if (isMounted) toast.error('Failed to load employee');
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });
            
        return () => { isMounted = false; };
    }, [id, navigate]);

    // Fetch 201 Documents
    useEffect(() => {
        if (!id || id === 'undefined') return;

        let isMounted = true;
        setIsDocsLoading(true);

        const safeParseJson = async (res) => {
            if (!res.ok) return null;
            const text = await res.text();
            if (!text) return null;
            try {
                return JSON.parse(text);
            } catch {
                return null;
            }
        };

        const loadDocuments = async () => {
            try {
                let res = await fetchWithAuth(`/api/employee-documents?employee_id=${id}`);
                let data = await safeParseJson(res);

                // Fallback route check
                if (!data || res.status === 404) {
                    res = await fetchWithAuth(`/api/documents?employee_id=${id}`);
                    data = await safeParseJson(res);
                }

                if (!isMounted) return;

                if (data && data.success) {
                    const docsList = data.documents || data.data || [];
                    setDocuments(Array.isArray(docsList) ? docsList : []);
                } else {
                    setDocuments([]);
                }
            } catch (err) {
                if (isMounted) setDocuments([]);
            } finally {
                if (isMounted) setIsDocsLoading(false);
            }
        };

        loadDocuments();

        return () => { isMounted = false; };
    }, [id]);

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
            case 'csv':
                return { icon: 'ti-file-type-xls', color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-100' };
            case 'ppt':
            case 'pptx':
                return { icon: 'ti-file-type-ppt', color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-100' };
            case 'png':
            case 'jpg':
            case 'jpeg':
            case 'gif':
            case 'webp':
                return { icon: 'ti-photo', color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-100' };
            case 'zip':
            case 'rar':
            case '7z':
                return { icon: 'ti-file-zip', color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100' };
            default:
                return { icon: 'ti-file', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-100' };
        }
    };

    const getDocumentUrl = (filePath) => {
        if (!filePath) return '#';
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            return filePath;
        }
        return `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/documents/${filePath}`;
    };

    const printCard = () => {
        window.print();
    };

    const handleDelete = async () => {
        if (!employee) return;
        setIsDeleting(true);

        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const response = await fetchWithAuth(`/api/employees/${employee.id}`, {
                method: 'DELETE',
                body: JSON.stringify({ admin_id: user?.id })
            });
            const resData = await response.json();
            if (resData.success) {
                toast.success('Employee deleted permanently.');
                
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    return oldData ? oldData.filter(emp => emp.id !== employee.id) : [];
                });
                
                navigate('/admin/employees');
            } else {
                toast.error('Failed: ' + resData.error);
            }
        } catch (err) {
            toast.error('Network Error. Failed to delete employee.');
        } finally {
            setIsDeleting(false);
            setIsDeleteModalOpen(false);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return '';
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    };

    if (isLoading || !employee) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Profile...</p>
            </div>
        );
    }

    return (
        <>
            <style>{`
                @media print {
                    body * { visibility: hidden; }
                    #qr-print-card, #qr-print-card * { visibility: visible; }
                    #qr-print-card {
                        position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px;
                        box-shadow: none !important; border: none !important; transform: none !important;
                    }
                    .no-print, header, nav, aside { display: none !important; }
                }
            `}</style>
            
            <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
                
                <div className="fixed top-[-10%] left-[-5%] w-[40vw] h-[40vw] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />
                <div className="fixed bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />

                {/* TOP NAVIGATION */}
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
                    <Link to="/admin/employees" className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-xs sm:shadow-sm border border-slate-100 flex items-center gap-1.5 sm:gap-2 tap-active">
                        <i className="ti ti-arrow-left text-base sm:text-lg" /> Back to Directory
                    </Link>
                    
                    <div className="flex flex-wrap gap-2 sm:gap-3">
                        {/* 201 DOCUMENTS DIRECTORY LINK */}
                        <Link to={`/admin/documents?employee_id=${employee.id}`} className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-sky-50 text-sky-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-sky-100 transition-all shadow-xs sm:shadow-sm border border-sky-100 flex items-center gap-1.5 sm:gap-2 tap-active">
                            <i className="ti ti-folders text-base sm:text-lg" /> 201 Documents
                        </Link>

                        <button onClick={() => setIsPrintModalOpen(true)} className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-xs sm:shadow-sm border border-slate-100 flex items-center gap-1.5 sm:gap-2 tap-active">
                            <i className="ti ti-qrcode text-base sm:text-lg" /> Print ID
                        </button>
                        
                        <Link to={`/admin/employees/${employee.id}/edit`} className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-indigo-50 text-indigo-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-indigo-100 transition-all shadow-xs sm:shadow-sm border border-indigo-100 flex items-center gap-1.5 sm:gap-2 tap-active">
                            <i className="ti ti-pencil text-base sm:text-lg" /> Edit
                        </Link>

                        <button onClick={() => setIsDeleteModalOpen(true)} className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-red-50 text-red-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-xs sm:shadow-sm border border-red-100 flex items-center gap-1.5 sm:gap-2 tap-active">
                            <i className="ti ti-trash text-base sm:text-lg" /> Delete
                        </button>
                    </div>
                </motion.div>

                {/* HERO PROFILE CARD */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-900 rounded-2xl shadow-xs sm:shadow-sm p-5 sm:p-8 lg:p-10 flex flex-col sm:flex-row items-center gap-5 sm:gap-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-[40rem] h-[40rem] bg-gradient-to-bl from-indigo-500/30 to-purple-600/30 rounded-full blur-3xl -mr-20 -mt-20 transition-transform duration-700 group-hover:scale-110 pointer-events-none" />

                    <div className="relative z-10 shrink-0">
                        <div className="relative h-28 w-28 sm:h-40 sm:w-40 group-hover:scale-105 transition-transform duration-500">
                            {!imageError ? (
                                <img 
                                    src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${employee.company_id}/${employee.id}.jpg`} 
                                    onError={() => setImageError(true)}
                                    alt={employee.name}
                                    className="absolute inset-0 w-full h-full object-cover rounded-2xl shadow-2xl border-4 border-white/10 bg-slate-800"
                                />
                            ) : (
                                <div className="absolute inset-0 w-full h-full rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-4xl sm:text-6xl font-black shadow-2xl border-4 border-white/10">
                                    {employee.name ? employee.name.charAt(0) : ''}
                                </div>
                            )}
                            <div className="absolute -bottom-1 -right-1 sm:-bottom-2 sm:-right-2 h-8 w-8 sm:h-10 sm:w-10 bg-emerald-500 rounded-full border-2 sm:border-4 border-slate-900 shadow-xl flex items-center justify-center" title="Active Account">
                                <i className="ti ti-check text-white text-base sm:text-lg font-bold" />
                            </div>
                        </div>
                    </div>

                    <div className="relative z-10 text-center sm:text-left flex-1 min-w-0">
                        <div className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1 sm:py-1.5 bg-white/10 text-white font-bold text-[10px] sm:text-xs rounded-xl border border-white/20 uppercase tracking-widest mb-2 sm:mb-3 backdrop-blur-md">
                            <i className="ti ti-id text-indigo-300" /> {employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')}
                        </div>
                        <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight mb-2 sm:mb-3 truncate">{employee.name}</h1>
                        
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 sm:gap-3 mb-3 sm:mb-4">
                            <span className="bg-indigo-500 text-white px-3 sm:px-4 py-1 rounded-xl text-xs font-bold shadow-md tracking-wider">
                                {employee.job_title || 'Staff'}
                            </span>
                            <span className="bg-white/10 backdrop-blur-md text-white px-3 sm:px-4 py-1 rounded-xl text-xs font-bold border border-white/10 flex items-center gap-1.5">
                                <i className="ti ti-building text-indigo-300" /> {employee.department || 'General'} Dept.
                            </span>
                        </div>

                        <p className="text-indigo-200 font-medium text-xs sm:text-sm flex items-center justify-center sm:justify-start gap-1.5 truncate">
                            <i className="ti ti-mail text-indigo-400" /> {employee.email}
                        </p>
                    </div>
                </motion.div>

                {/* DETAILS GRID */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    
                    {/* Employment Details */}
                    <div className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 p-5 sm:p-8 relative overflow-hidden group hover:shadow-lg transition-shadow">
                        <div className="flex items-center gap-3 sm:gap-4 mb-5 sm:mb-8">
                            <div className="h-10 w-10 sm:h-12 sm:w-12 bg-indigo-50 text-indigo-600 rounded-xl sm:rounded-2xl flex items-center justify-center border border-indigo-100">
                                <i className="ti ti-briefcase text-xl sm:text-2xl" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">Employment</h3>
                        </div>
                        
                        <div className="space-y-4 sm:space-y-6">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Date Joined</p>
                                <p className="text-slate-700 font-bold flex items-center gap-2 text-sm sm:text-base">
                                    <i className="ti ti-calendar-star text-indigo-400 text-lg" />
                                    {employee.created_at ? formatDate(employee.created_at) : ''} 
                                    {employee.created_at_human && <span className="text-xs text-slate-400 font-medium ml-1">({employee.created_at_human})</span>}
                                </p>
                            </div>
                            
                            <div className="pt-3 sm:pt-4 border-t border-slate-50">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Base Salary</p>
                                <p className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight flex items-end gap-1">
                                    <span className="text-emerald-500 text-xl sm:text-2xl mb-0.5">₱</span>
                                    {Number(employee.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="text-[10px] sm:text-xs text-slate-400 font-bold uppercase tracking-widest mb-1 ml-1">/ mo</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* System Access */}
                    <div className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 p-5 sm:p-8 relative overflow-hidden group hover:shadow-lg transition-shadow">
                        <div className="flex items-center gap-3 sm:gap-4 mb-5 sm:mb-8">
                            <div className="h-10 w-10 sm:h-12 sm:w-12 bg-purple-50 text-purple-600 rounded-xl sm:rounded-2xl flex items-center justify-center border border-purple-100">
                                <i className="ti ti-shield-lock text-xl sm:text-2xl" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">System Access</h3>
                        </div>
                        
                        <div className="space-y-4 sm:space-y-6">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Account Role</p>
                                <span className="inline-flex px-3.5 py-1.5 bg-slate-50 text-slate-700 font-black text-xs rounded-xl border border-slate-200 uppercase tracking-widest">
                                    {employee.role ?? 'Employee'}
                                </span>
                            </div>

                            <div className="pt-3 sm:pt-4 border-t border-slate-50">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Last Profile Update</p>
                                <p className="text-slate-600 font-bold flex items-center gap-2 text-xs sm:text-sm">
                                    <i className="ti ti-clock text-purple-400 text-base sm:text-lg" />
                                    {employee.updated_at ? formatDateTime(employee.updated_at) : ''}
                                </p>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* 201 DOCUMENTS DISPLAY CARD */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 p-5 sm:p-8 relative overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 sm:mb-8">
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div className="h-10 w-10 sm:h-12 sm:w-12 bg-sky-50 text-sky-600 rounded-xl sm:rounded-2xl flex items-center justify-center border border-sky-100">
                                <i className="ti ti-folders text-xl sm:text-2xl" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">201 Documents</h3>
                        </div>
                        <span className="inline-flex px-3.5 py-1.5 bg-slate-50 text-slate-500 font-black text-[10px] sm:text-xs rounded-xl border border-slate-200 uppercase tracking-widest">
                            {documents.length} {documents.length === 1 ? 'File' : 'Files'} Uploaded
                        </span>
                    </div>

                    {isDocsLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 sm:py-16 space-y-3 sm:space-y-4">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                            <p className="text-slate-400 font-bold tracking-widest uppercase text-[11px] sm:text-xs">Loading Documents...</p>
                        </div>
                    ) : documents.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-12 sm:py-16 px-4 bg-slate-50/60 rounded-xl sm:rounded-2xl border border-dashed border-slate-200">
                            <div className="h-14 w-14 sm:h-16 sm:w-16 bg-white text-slate-300 rounded-2xl flex items-center justify-center border border-slate-100 shadow-xs mb-4">
                                <i className="ti ti-folder-x text-2xl sm:text-3xl" />
                            </div>
                            <h4 className="text-sm sm:text-base font-black text-slate-600 mb-1.5">No 201 documents uploaded yet</h4>
                            <p className="text-xs sm:text-sm text-slate-400 font-medium max-w-sm">
                                There are currently no files attached to this employee record.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                            {documents.map((doc) => {
                                const meta = getFileMeta(doc.file_name || doc.title || '');
                                const displayTitle = doc.title || doc.file_name || 'Untitled Document';
                                const fileUrl = getDocumentUrl(doc.file_path);

                                return (
                                    <div
                                        key={doc.id}
                                        className="flex items-start gap-3 p-4 bg-white rounded-xl sm:rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all group"
                                    >
                                        <div className={`h-11 w-11 sm:h-12 sm:w-12 shrink-0 rounded-xl flex items-center justify-center border ${meta.bg} ${meta.border} ${meta.color}`}>
                                            <i className={`ti ${meta.icon} text-xl sm:text-2xl`} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-slate-700 truncate" title={displayTitle}>
                                                {displayTitle}
                                            </p>
                                            {doc.category && (
                                                <span className="inline-flex mt-1.5 px-2.5 py-0.5 bg-slate-50 text-slate-500 font-bold text-[10px] rounded-lg border border-slate-200 uppercase tracking-widest">
                                                    {doc.category}
                                                </span>
                                            )}
                                            <div className="mt-2.5 flex items-center gap-1.5">
                                                {doc.file_path ? (
                                                    <a
                                                        href={fileUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
                                                    >
                                                        <i className="ti ti-external-link text-sm" /> View File
                                                    </a>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-bold text-slate-300 uppercase tracking-widest">
                                                        <i className="ti ti-link-off text-sm" /> No File
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </motion.div>
            </div>

            {/* DESTRUCTIVE DELETE MODAL */}
            <AnimatePresence>
                {isDeleteModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
                            onClick={() => setIsDeleteModalOpen(false)}
                        />
                        <motion.div 
                            initial={{ scale: 0.95, y: 40, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 40, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-5 sm:p-8 text-center"
                        >
                            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6 border-4 sm:border-8 border-white shadow-lg relative z-10">
                                <i className="ti ti-alert-triangle text-3xl sm:text-4xl text-red-500 animate-pulse" />
                            </div>
                            
                            <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight mb-2">Delete Employee?</h2>
                            <p className="text-xs sm:text-sm text-slate-500 mb-4 sm:mb-6 leading-relaxed">
                                You are about to permanently delete <strong className="text-slate-800">{employee.name}</strong>. This will wipe their entire history and cannot be undone.
                            </p>

                            <div className="bg-slate-50 rounded-xl sm:rounded-2xl p-3.5 sm:p-4 mb-4 sm:mb-6 border border-slate-100 text-left">
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    Type <span className="text-red-500 select-all">{employee.name}</span> to confirm
                                </label>
                                <input 
                                    type="text" 
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    placeholder="Type name here..."
                                    disabled={isDeleting}
                                    className="w-full px-3.5 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-xs sm:text-sm text-slate-700 transition-all text-center disabled:opacity-50"
                                />
                            </div>

                            <div className="flex gap-2.5 sm:gap-3">
                                <button 
                                    onClick={() => setIsDeleteModalOpen(false)} 
                                    disabled={isDeleting}
                                    className="flex-1 py-3 sm:py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-colors tap-active disabled:opacity-50 text-xs sm:text-sm"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleDelete} 
                                    disabled={deleteConfirmText !== employee.name || isDeleting}
                                    className="flex-1 py-3 sm:py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-xl shadow-red-600/30 transition-all tap-active flex items-center justify-center gap-2 text-xs sm:text-sm"
                                >
                                    {isDeleting ? (
                                        <><i className="ti ti-loader animate-spin text-lg" /> Deleting...</>
                                    ) : 'Delete Forever'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* PRINT ID MODAL */}
            <AnimatePresence>
                {isPrintModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity no-print"
                            onClick={() => setIsPrintModalOpen(false)}
                        />
                        <motion.div 
                            initial={{ scale: 0.95, y: 40, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 40, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            id="qr-print-card"
                            className="relative bg-white rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 text-center shadow-2xl w-full max-w-md border border-slate-200 z-10"
                        >
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                                <div className="text-left">
                                    <h1 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-wider">C-Point Official ID</h1>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Biometric Gate Pass</p>
                                </div>
                                <span className="px-3 py-1 bg-slate-900 text-white font-mono text-xs font-black rounded-lg">
                                    {employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS')}
                                </span>
                            </div>

                            <div className="flex justify-center mb-6">
                                <div className="p-4 bg-white border-2 border-slate-200/80 rounded-2xl flex items-center justify-center shadow-sm">
                                    <QRCode 
                                        value={employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')} 
                                        size={240}
                                        fgColor="#0f172a"
                                        bgColor="#ffffff"
                                        level="H"
                                        margin={2}
                                        className="rounded-lg"
                                    />
                                </div>
                            </div>

                            <div className="mb-6">
                                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight truncate">{employee.name}</h2>
                                <p className="text-indigo-600 font-black uppercase text-xs sm:text-sm tracking-widest mt-1.5">{employee.job_title ?? 'STAFF'}</p>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">{employee.department ? employee.department + ' Department' : 'Operations'}</p>
                            </div>

                            <div className="no-print flex gap-2.5 sm:gap-3">
                                <button type="button" onClick={() => setIsPrintModalOpen(false)} className="flex-1 py-3 sm:py-3.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition tap-active text-xs sm:text-sm">
                                    Close
                                </button>
                                <button type="button" onClick={printCard} className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-3.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-indigo-600 shadow-xl shadow-slate-900/20 transition tap-active text-xs sm:text-sm">
                                    <i className="ti ti-printer text-base sm:text-lg" /> Print Badge
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}