import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';

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
        fetch(`http://localhost:5000/api/employees/${id}`)
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

    const printCard = () => {
        window.print();
    };

    const confirmDelete = async () => {
        if (deleteConfirmText !== employee.name) {
            toast.error("Name does not match.");
            return;
        }

        setIsDeleting(true);
        
        // Artificial delay for UX: lets the user see the "Deleting..." animation
        // since the local server processes the request too fast (0 ping)
        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const response = await fetch(`http://localhost:5000/api/employees/${employee.id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: user?.id })
            });
            const resData = await response.json();
            if (resData.success) {
                toast.success('Employee deleted permanently.');
                
                // Instantly wipe the employee from the cache so they don't 'pop' out later
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    return oldData ? oldData.filter(emp => emp.id !== employee.id) : [];
                });
                
                navigate('/admin/employees');
            } else {
                toast.error(resData.error || 'Failed to delete employee.');
                setIsDeleting(false);
            }
        } catch (error) {
            toast.error('Network error while deleting.');
            setIsDeleting(false);
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
            
            <div className="max-w-5xl mx-auto space-y-8 pb-16 font-sans relative">
                
                
                <div className="fixed top-[-10%] left-[-5%] w-[40vw] h-[40vw] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />
                <div className="fixed bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />

                {/* TOP NAVIGATION */}
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                    <Link to="/admin/employees" className="px-5 py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm border border-slate-100 flex items-center gap-2">
                        <i className="ti ti-arrow-left text-lg" /> Back to Directory
                    </Link>
                    
                    <div className="flex gap-3">
                        <button onClick={() => setIsPrintModalOpen(true)} className="px-5 py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm border border-slate-100 flex items-center gap-2 active:scale-95">
                            <i className="ti ti-qrcode text-lg" /> Print ID
                        </button>
                        
                        <Link to={`/admin/employees/${employee.id}/edit`} className="px-5 py-2.5 bg-indigo-50 text-indigo-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-indigo-100 transition-all shadow-sm border border-indigo-100 flex items-center gap-2 active:scale-95">
                            <i className="ti ti-pencil text-lg" /> Edit Profile
                        </Link>

                        <button onClick={() => setIsDeleteModalOpen(true)} className="px-5 py-2.5 bg-red-50 text-red-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-100 flex items-center gap-2 active:scale-95">
                            <i className="ti ti-trash text-lg" /> Delete
                        </button>
                    </div>
                </motion.div>

                {/* HERO PROFILE CARD */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-900 rounded-[3rem] shadow-2xl shadow-slate-900/20 p-8 sm:p-12 flex flex-col sm:flex-row items-center gap-10 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-[40rem] h-[40rem] bg-gradient-to-bl from-indigo-500/30 to-purple-600/30 rounded-full blur-3xl -mr-20 -mt-20 transition-transform duration-700 group-hover:scale-110 pointer-events-none" />

                    <div className="relative z-10 shrink-0">
                        <div className="relative h-40 w-40 sm:h-48 sm:w-48 group-hover:scale-105 transition-transform duration-500">
                            {!imageError ? (
                                <img 
                                    src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${employee.company_id}/${employee.id}.jpg`} 
                                    onError={() => setImageError(true)}
                                    alt={employee.name}
                                    className="absolute inset-0 w-full h-full object-cover rounded-[2.5rem] shadow-2xl border-4 border-white/10 bg-slate-800"
                                />
                            ) : (
                                <div className="absolute inset-0 w-full h-full rounded-[2.5rem] bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-6xl font-black shadow-2xl border-4 border-white/10">
                                    {employee.name ? employee.name.charAt(0) : ''}
                                </div>
                            )}
                            <div className="absolute -bottom-2 -right-2 h-12 w-12 bg-emerald-500 rounded-full border-4 border-slate-900 shadow-xl flex items-center justify-center" title="Active Account">
                                <i className="ti ti-check text-white text-xl font-bold" />
                            </div>
                        </div>
                    </div>

                    <div className="relative z-10 text-center sm:text-left flex-1">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 text-white font-bold text-[10px] rounded-xl border border-white/20 uppercase tracking-widest mb-4 backdrop-blur-md">
                            <i className="ti ti-id text-indigo-300" /> {employee.company_id || 'Employee'}
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight mb-4">{employee.name}</h1>
                        
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mb-6">
                            <span className="bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-md tracking-wider">
                                {employee.job_title || 'Staff'}
                            </span>
                            <span className="bg-white/10 backdrop-blur-md text-white px-4 py-1.5 rounded-xl text-xs font-bold border border-white/10 flex items-center gap-2">
                                <i className="ti ti-building text-indigo-300" /> {employee.department || 'General'} Dept.
                            </span>
                        </div>

                        <p className="text-indigo-200 font-medium text-sm flex items-center justify-center sm:justify-start gap-2">
                            <i className="ti ti-mail text-indigo-400" /> {employee.email}
                        </p>
                    </div>
                </motion.div>

                {/* DETAILS GRID */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Employment Details */}
                    <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 p-8 relative overflow-hidden group hover:shadow-xl transition-shadow">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="h-12 w-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100">
                                <i className="ti ti-briefcase text-2xl" />
                            </div>
                            <h3 className="text-xl font-black text-slate-800 tracking-tight">Employment</h3>
                        </div>
                        
                        <div className="space-y-6">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Date Joined</p>
                                <p className="text-slate-700 font-bold flex items-center gap-2 text-base">
                                    <i className="ti ti-calendar-star text-indigo-400 text-xl" />
                                    {employee.created_at ? formatDate(employee.created_at) : ''} 
                                    {employee.created_at_human && <span className="text-xs text-slate-400 font-medium ml-1">({employee.created_at_human})</span>}
                                </p>
                            </div>
                            
                            <div className="pt-4 border-t border-slate-50">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Base Salary</p>
                                <p className="text-3xl font-black text-slate-800 tracking-tight flex items-end gap-1">
                                    <span className="text-emerald-500 text-2xl mb-0.5">₱</span>
                                    {Number(employee.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <span className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1.5 ml-1">/ mo</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* System Access */}
                    <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 p-8 relative overflow-hidden group hover:shadow-xl transition-shadow">
                        <div className="flex items-center gap-4 mb-8">
                            <div className="h-12 w-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center border border-purple-100">
                                <i className="ti ti-shield-lock text-2xl" />
                            </div>
                            <h3 className="text-xl font-black text-slate-800 tracking-tight">System Access</h3>
                        </div>
                        
                        <div className="space-y-6">
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Account Role</p>
                                <span className="inline-flex px-4 py-2 bg-slate-50 text-slate-700 font-black text-xs rounded-xl border border-slate-200 uppercase tracking-widest">
                                    {employee.role ?? 'Employee'}
                                </span>
                            </div>

                            <div className="pt-4 border-t border-slate-50">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Last Profile Update</p>
                                <p className="text-slate-600 font-bold flex items-center gap-2 text-sm">
                                    <i className="ti ti-clock text-purple-400 text-lg" />
                                    {employee.updated_at ? formatDateTime(employee.updated_at) : ''}
                                </p>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* DESTRUCTIVE DELETE MODAL */}
            <AnimatePresence>
                {isDeleteModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
                            onClick={() => setIsDeleteModalOpen(false)}
                        />
                        <motion.div 
                            initial={{ scale: 0.9, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 20, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-[3rem] w-full max-w-md overflow-hidden shadow-2xl p-8 text-center"
                        >
                            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 border-8 border-white shadow-lg relative z-10">
                                <i className="ti ti-alert-triangle text-4xl text-red-500 animate-pulse" />
                            </div>
                            
                            <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Delete Employee?</h2>
                            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                                You are about to permanently delete <strong className="text-slate-800">{employee.name}</strong>. This will wipe their entire history and cannot be undone.
                            </p>

                            <div className="bg-slate-50 rounded-2xl p-4 mb-6 border border-slate-100 text-left">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                                    Type <span className="text-red-500 select-all">{employee.name}</span> to confirm
                                </label>
                                <input 
                                    type="text" 
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    placeholder="Type name here..."
                                    disabled={isDeleting}
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-slate-700 transition-all text-center disabled:opacity-50"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setIsDeleteModalOpen(false)} 
                                    disabled={isDeleting}
                                    className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-2xl transition-colors active:scale-95 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={confirmDelete} 
                                    disabled={deleteConfirmText !== employee.name || isDeleting}
                                    className="flex-1 py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl shadow-xl shadow-red-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    {isDeleting ? (
                                        <><i className="ti ti-loader animate-spin text-xl" /> Deleting...</>
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
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity no-print"
                            onClick={() => setIsPrintModalOpen(false)}
                        />
                        <motion.div 
                            initial={{ scale: 0.9, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 20, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            id="qr-print-card"
                            className="relative bg-white rounded-[3rem] p-10 text-center shadow-2xl w-full max-w-sm border border-slate-100 z-10"
                        >
                            <div className="mb-8">
                                <h1 className="text-2xl font-black text-slate-800 uppercase tracking-widest">Company ID</h1>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Official Identification</p>
                            </div>

                            <div className="flex justify-center mb-8">
                                <div className="p-4 border-4 border-slate-900 rounded-[2rem] bg-white flex items-center justify-center shadow-inner">
                                    <QRCodeSVG value={employee.company_id || String(employee.id)} size={200} />
                                </div>
                            </div>

                            <div className="mb-8">
                                <h2 className="text-3xl font-black text-slate-800 tracking-tight leading-tight">{employee.name}</h2>
                                <p className="text-indigo-600 font-black uppercase text-sm tracking-widest mt-2">{employee.job_title ?? 'STAFF'}</p>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">{employee.department ? employee.department + ' Dept.' : ''}</p>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-8">
                                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Company ID</p>
                                <p className="font-mono text-2xl font-black text-slate-700">{employee.company_id || `#${String(employee.id).substring(0,8)}`}</p>
                            </div>

                            <div className="no-print flex gap-3">
                                <button type="button" onClick={() => setIsPrintModalOpen(false)} className="flex-1 py-4 bg-slate-100 text-slate-500 font-bold rounded-2xl hover:bg-slate-200 transition active:scale-95">
                                    Cancel
                                </button>
                                <button type="button" onClick={printCard} className="flex-1 flex items-center justify-center gap-2 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-600/30 transition active:scale-95">
                                    <i className="ti ti-printer text-lg" /> Print
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}
