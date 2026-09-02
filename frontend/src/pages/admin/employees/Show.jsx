import React, { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import QRCode from '../../../components/QRCode';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';

export default function Show() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Modals State
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    // Pre-populate employee data from staff directory on Frame 0 (0ms)
    const cachedEmp = useMemo(() => {
        const cachedList = queryClient.getQueryData(['adminEmployees']);
        if (Array.isArray(cachedList)) {
            const found = cachedList.find(e => String(e.id) === String(id));
            if (found) {
                return {
                    ...found,
                    name: found.name || `${found.first_name || ''} ${found.last_name || ''}`.trim()
                };
            }
        }
        return null;
    }, [queryClient, id]);

    // Single unified query for employee profile and 201 documents
    const { data: employeeData, isLoading: isEmpLoading } = useQuery({
        queryKey: ['employeeDetails', id],
        queryFn: async () => {
            const res = await fetchWithAuth(`/api/employees/${id}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load employee');
            const emp = data.data;
            emp.name = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
            return {
                ...data,
                data: emp
            };
        },
        initialData: cachedEmp ? { success: true, data: cachedEmp, documents: [] } : undefined,
        staleTime: 60000,
        enabled: !!id && id !== 'undefined',
    });

    const employee = employeeData?.data || cachedEmp || null;
    const documents = employeeData?.documents || [];
    const isLoading = isEmpLoading && !employee;
    const isDocsLoading = isEmpLoading && documents.length === 0;

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
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    if (isLoading || !employee) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Profile...</p>
            </div>
        );
    }

    const isFactory = employee.department?.toLowerCase().includes('factory');
    const rateAmount = Number(
        isFactory
            ? (employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? employee.monthly_salary ?? 0)
            : (employee.monthly_salary ?? employee.salary ?? 0)
    );

    return (
        <>
            <style>{`
                @media print {
                    body * { visibility: hidden; }
                    #qr-print-card, #qr-print-card * { visibility: visible; }
                    #qr-print-card {
                        position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px;
                        box-shadow: none !important; border: none !important;
                    }
                    .no-print, header, nav, aside { display: none !important; }
                }
            `}</style>
            
            <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
                
                {/* Top navigation */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link to="/admin/employees" className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5">
                        <i className="ti ti-arrow-left text-sm" /> Back to Directory
                    </Link>
                    
                    <div className="flex flex-wrap gap-2 sm:gap-2.5">
                        {/* 201 Documents link */}
                        <Link to={`/admin/documents?employee_id=${employee.id}`} className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5">
                            <i className="ti ti-folders text-slate-500 text-base" /> 201 Documents
                        </Link>

                        <button onClick={() => setIsPrintModalOpen(true)} className="px-3.5 py-2 bg-white text-slate-700 font-semibold text-xs rounded-lg hover:bg-slate-50 transition-colors shadow-xs border border-slate-200 flex items-center gap-1.5 cursor-pointer">
                            <i className="ti ti-qrcode text-slate-500 text-base" /> Print Badge
                        </button>

                        <Link to={`/admin/employees/${employee.id}/edit`} className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-xs flex items-center gap-1.5">
                            <i className="ti ti-pencil text-base" /> Edit Profile
                        </Link>

                        <button onClick={() => setIsDeleteModalOpen(true)} className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs rounded-lg transition-colors border border-rose-200 flex items-center gap-1.5 cursor-pointer">
                            <i className="ti ti-trash text-base" /> Delete
                        </button>
                    </div>
                </div>

                {/* Unified Enterprise Employee Profile Banner */}
                <div className="bg-slate-900 rounded-xl p-5 sm:p-7 border border-slate-800 text-white shadow-xs relative">
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
                        <div className="relative h-24 w-24 sm:h-28 sm:w-28 shrink-0">
                            <EmployeeAvatar
                                employee={employee}
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
                                    <i className="ti ti-id text-slate-400" /> {employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-EMPLOYEE')}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-500/20 text-blue-300 text-xs font-semibold rounded border border-blue-500/30">
                                    {employee.department || 'General'}
                                </span>
                                {isFactory ? (
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
                                {employee.first_name} {employee.last_name}
                            </h1>
                            <p className="text-slate-300 font-medium text-xs sm:text-sm mt-0.5">
                                {employee.job_title || 'Staff Member'}
                            </p>

                            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-xs font-medium text-slate-400">
                                <span className="flex items-center gap-1.5">
                                    <i className="ti ti-mail text-slate-400 text-sm" /> {employee.email}
                                </span>
                                {employee.phone && (
                                    <span className="flex items-center gap-1.5 font-mono">
                                        <i className="ti ti-phone text-slate-400 text-sm" /> {employee.phone}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Personal and payroll details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">

                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="h-10 w-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                                <i className="ti ti-user text-xl" />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-slate-800">Personal Details</h3>
                                <p className="text-xs text-slate-400 font-medium">Core identity & access role</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">First Name</p>
                                <p className="font-extrabold text-slate-800 text-sm">{employee.first_name || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Last Name</p>
                                <p className="font-extrabold text-slate-800 text-sm">{employee.last_name || 'N/A'}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Email Address</p>
                                <p className="font-extrabold text-slate-800 text-sm">{employee.email}</p>
                            </div>
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Role Privilege</p>
                                <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-700 font-black text-[11px] rounded-md uppercase border border-slate-200">
                                    {employee.role || 'employee'}
                                </span>
                            </div>
                            <div>
                                <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Company ID</p>
                                <p className="font-mono font-extrabold text-slate-800 text-sm">{employee.company_id || employee.id}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center border ${isFactory ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                }`}>
                                <i className={`ti ${isFactory ? 'ti-building-factory-2' : 'ti-cash-banknote'} text-xl`} />
                            </div>
                            <div>
                                <h3 className="text-base font-black text-slate-800">Payroll & Job Specs</h3>
                                <p className="text-xs text-slate-400 font-medium">Departmental salary scheme</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Department</p>
                                    <span className={`inline-flex items-center gap-1 font-extrabold text-sm ${isFactory ? 'text-amber-700' : 'text-slate-800'}`}>
                                        {employee.department || 'General'}
                                    </span>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-1">Job Title</p>
                                    <p className="font-extrabold text-slate-800 text-sm">{employee.job_title || 'N/A'}</p>
                                </div>
                            </div>

                            <div className={`p-4 rounded-xl border ${isFactory ? 'bg-amber-50/80 border-amber-200' : 'bg-emerald-50/80 border-emerald-200'}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-[11px] font-black uppercase tracking-wider ${isFactory ? 'text-amber-900' : 'text-slate-500'}`}>
                                        {isFactory ? 'Factory Piece-Rate' : 'Monthly Base Salary'}
                                    </span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider border ${isFactory ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                        }`}>
                                        {isFactory ? 'Piece Rate' : 'Fixed Monthly'}
                                    </span>
                                </div>

                                <div className="text-3xl font-black text-slate-900 tracking-tight flex items-baseline gap-1">
                                    <span className={isFactory ? 'text-amber-600 text-2xl' : 'text-emerald-600 text-2xl'}>₱</span>
                                    {rateAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="text-xs font-bold text-slate-400 uppercase">
                                        {isFactory ? '/ piece completed' : '/ month'}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-[11px] pt-1">
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-0.5">Date Joined</p>
                                    <p className="font-bold text-slate-700">{formatDate(employee.created_at)}</p>
                                </div>
                                <div>
                                    <p className="font-bold text-slate-400 uppercase tracking-wider mb-0.5">Last Updated</p>
                                    <p className="font-bold text-slate-700">{formatDateTime(employee.updated_at)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 201 Documents */}
                <div className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 p-5 sm:p-8 relative overflow-hidden">
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
                </div>
            </div>

            {/* Delete confirmation modal */}
            
                {isDeleteModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                        <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl">
                            <div className="w-14 h-14 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border-4 border-red-100">
                                <i className="ti ti-alert-triangle text-2xl" />
                            </div>
                            <h2 className="text-xl font-black text-slate-800">Delete Employee Profile?</h2>
                            <p className="text-xs text-slate-500">
                                Type <strong className="text-slate-800">{employee.name}</strong> to confirm deletion.
                            </p>
                            <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="Type full name..."
                                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center font-bold text-xs"
                            />
                            <div className="flex gap-2">
                                <button onClick={() => setIsDeleteModalOpen(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs">
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={deleteConfirmText !== employee.name || isDeleting}
                                    className="flex-1 py-2.5 bg-red-600 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs"
                                >
                                    {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            

            {/* Print QR badge modal */}
            
                {isPrintModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity no-print"
                            onClick={() => setIsPrintModalOpen(false)}
                        />
                        <div 
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
                        </div>
                    </div>      
                )}
            
        </>
    );
}
