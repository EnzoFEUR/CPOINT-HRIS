import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from '../../../components/QRCode';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function Show() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [employee, setEmployee] = useState(null);
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [imageError, setImageError] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (!id || id === 'undefined') return;

        let isMounted = true;
        fetchWithAuth(`/api/employees/${id}?t=${Date.now()}`)
            .then(res => res.json())
            .then(data => {
                if (!isMounted) return;
                if (data.success) {
                    const emp = data.data;
                    emp.name = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
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

    const printCard = () => window.print();

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

            <div className="max-w-5xl mx-auto space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">

                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
                    <Link to="/admin/employees" className="px-4 py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all shadow-xs border border-slate-200 flex items-center gap-2">
                        <i className="ti ti-arrow-left text-lg" /> Back to Directory
                    </Link>

                    <div className="flex flex-wrap gap-2.5">
                        <button onClick={() => setIsPrintModalOpen(true)} className="px-4 py-2.5 bg-white text-slate-700 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all shadow-xs border border-slate-200 flex items-center gap-2">
                            <i className="ti ti-qrcode text-lg" /> Print Badge
                        </button>

                        <Link to={`/admin/employees/${employee.id}/edit`} className="px-4 py-2.5 bg-indigo-50 text-indigo-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-indigo-100 transition-all shadow-xs border border-indigo-100 flex items-center gap-2">
                            <i className="ti ti-pencil text-lg" /> Edit Profile
                        </Link>

                        <button onClick={() => setIsDeleteModalOpen(true)} className="px-4 py-2.5 bg-red-50 text-red-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-xs border border-red-100 flex items-center gap-2">
                            <i className="ti ti-trash text-lg" /> Delete
                        </button>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-900 rounded-2xl shadow-md p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6 relative overflow-hidden">
                    <div className="relative shrink-0">
                        <div className="h-28 w-28 sm:h-36 sm:w-36">
                            {!imageError ? (
                                <img
                                    src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${employee.company_id || employee.id}/${employee.id}.jpg`}
                                    onError={() => setImageError(true)}
                                    alt={employee.name}
                                    className="w-full h-full object-cover rounded-2xl shadow-xl border-4 border-white/10 bg-slate-800"
                                />
                            ) : (
                                <div className="w-full h-full rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-4xl sm:text-5xl font-black shadow-xl border-4 border-white/10">
                                    {employee.first_name?.[0] || employee.name?.charAt(0) || 'E'}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="relative z-10 text-center sm:text-left flex-1 min-w-0">
                        <div className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1 sm:py-1.5 bg-white/10 text-white font-bold text-[10px] sm:text-xs rounded-xl border border-white/20 uppercase tracking-widest mb-2 sm:mb-3 backdrop-blur-md">
                            <i className="ti ti-id text-indigo-300" /> {employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-2 truncate">
                            {employee.first_name} {employee.last_name}
                        </h1>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-3">
                            <span className="bg-indigo-600 text-white px-3 py-1 rounded-lg text-xs font-bold tracking-wider">
                                {employee.job_title || 'Staff Member'}
                            </span>

                            <span className={`px-3 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${isFactory
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-white/10 text-white border-white/10'
                                }`}>
                                <i className={`ti ${isFactory ? 'ti-building-factory-2' : 'ti-building'} ${isFactory ? 'text-amber-400' : 'text-indigo-300'}`} />
                                {employee.department || 'General'}
                            </span>
                        </div>

                        <p className="text-indigo-200 font-medium text-xs sm:text-sm flex items-center justify-center sm:justify-start gap-1.5 truncate">
                            <i className="ti ti-mail text-indigo-400" /> {employee.email}
                        </p>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 gap-6">

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
                </motion.div>
            </div>

            <AnimatePresence>
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
            </AnimatePresence>

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
                                <span className="font-mono text-xs font-bold px-2 py-0.5 bg-slate-100 rounded">
                                    {employee.company_id || employee.id}
                                </span>
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