import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function Index() {
    const location = useLocation();
    const fetchEmployees = async () => {
        const response = await fetchWithAuth('/api/employees');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to fetch');
        return result.data || [];
    };

    const { data: employees = [], isLoading } = useQuery({
        queryKey: ['adminEmployees'],
        queryFn: fetchEmployees
    });

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [session, setSession] = useState(location.state || {});
    const [searchQuery, setSearchQuery] = useState('');

    const copyPassword = (password) => {
        window.navigator.clipboard.writeText(password);
        toast.success('Password copied to clipboard!');
    };

    const filteredEmployees = employees.filter(emp => {
        const roleStr = (emp.role || '').toLowerCase();
        if (roleStr === 'admin' || roleStr === 'security') return false;
        
        return `${emp.first_name} ${emp.last_name} ${emp.department} ${emp.role}`.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const paginatedEmployees = filteredEmployees.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
    };
    
    const rowVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Directory...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans">
            
            
            
            

            <div className="space-y-4 sm:space-y-6">
                
                {/* Page header */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 sm:p-8 lg:p-10 shadow-xs sm:shadow-sm group">
                    
                    
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 sm:gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-3 sm:p-4 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-users-group text-2xl text-blue-400" />
                                </div>
                                <span className="px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-300 rounded-md border border-blue-500/30">Personnel Database</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">Employee Directory</h1>
                            <p className="text-sm sm:text-base text-white/70 mt-1 max-w-xl">Manage your staff roster, access ID cards, and update organizational records.</p>
                        </div>
                        
                        {/* Action button */}
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link to="/admin/employees/create" className="relative flex items-center gap-2 sm:gap-3 px-4 py-2.5 sm:px-5 sm:py-3 bg-blue-600 rounded-xl shadow-xs sm:shadow-sm overflow-hidden group/btn tap-active transition-all">
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                                <div className="h-9 w-9 sm:h-10 sm:w-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md">
                                    <i className="ti ti-user-plus text-lg sm:text-xl text-white font-bold" />
                                </div>
                                <span className="text-white font-bold text-sm sm:text-base tracking-wide relative z-10">Add Employee</span>
                            </Link>
                        </motion.div>
                    </div>
                </motion.div>

                {/* Alerts */}
                <AnimatePresence>
                    {session.success && !session.temp_password && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                            <div className="h-8 w-8 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center shrink-0">
                                <i className="ti ti-check text-lg" />
                            </div>
                            <p className="text-sm font-bold text-slate-800">{session.success}</p>
                        </motion.div>
                    )}

                    {session.temp_password && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 sm:p-6 bg-white border border-slate-200 rounded-2xl shadow-xs sm:shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sm:gap-6 relative overflow-hidden">
                            <div className="flex gap-3 sm:gap-4">
                                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 text-slate-800 rounded-xl flex items-center justify-center shrink-0 border border-slate-100">
                                    <i className="ti ti-key text-lg sm:text-xl" />
                                </div>
                                <div>
                                    <h3 className="text-sm sm:text-base font-bold text-slate-800">{session.success ?? 'Account Created'}</h3>
                                    <p className="text-xs text-slate-500 font-medium mt-0.5 line-clamp-2">Securely distribute this ID and temporary password to the employee.</p>
                                    <p className="text-[10px] font-bold text-slate-400 mt-2 flex items-center gap-1.5 uppercase tracking-widest">
                                        <i className="ti ti-shield-check" /> Forced change on first login
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 w-full md:w-auto">
                                {session.company_id && (
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] sm:text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-1">Company ID</span>
                                        <div className="px-4 py-2.5 sm:py-3 bg-blue-50 text-blue-700 rounded-xl border border-blue-100 flex items-center justify-center w-full">
                                            <span className="font-mono text-sm sm:text-lg font-black tracking-widest">{session.company_id}</span>
                                        </div>
                                    </div>
                                )}
                                <div className="flex flex-col items-center flex-1">
                                    <span className="text-[10px] sm:text-[11px] uppercase font-bold text-slate-400 tracking-widest mb-1">Temp Password</span>
                                    <div className="flex items-center gap-2 w-full">
                                        <div className="px-4 py-2.5 sm:py-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center flex-1">
                                            <span className="font-mono text-sm sm:text-lg font-black text-slate-900 tracking-widest">{session.temp_password}</span>
                                        </div>
                                        <button onClick={() => copyPassword(session.temp_password)} className="h-[42px] sm:h-[52px] px-4 sm:px-6 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors tap-active text-xs sm:text-sm">
                                            Copy
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Search */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-2 sm:p-3 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100">
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
                        <input 
                            type="text" 
                            placeholder="Search by name, role, or department..." 
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1);
                            }}
                            className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-slate-50 border-none rounded-xl outline-none focus:ring-4 focus:ring-indigo-500/10 font-bold text-slate-700 text-sm transition-all placeholder:text-slate-400 placeholder:font-medium"
                        />
                    </div>
                </motion.div>

                {/* Data grid */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
                    <AnimatePresence>
                        {paginatedEmployees.length > 0 ? paginatedEmployees.map((employee) => (
                            <motion.div variants={rowVariants} key={employee.id} className="bg-white rounded-2xl p-4 sm:p-5 shadow-xs sm:shadow-sm border border-slate-100 tap-active relative group flex flex-col gap-3">
                                <Link to={`/admin/employees/${employee.id}`} className="absolute inset-0 z-10" />
                                {/* Top: Avatar + Name + Role */}
                                <div className="flex items-start gap-3">
                                    <div className="relative h-11 w-11 sm:h-12 sm:w-12 shrink-0 group-hover:scale-105 transition-transform z-0">
                                        <img 
                                            src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${employee.company_id}/${employee.id}.jpg`}
                                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                            alt={employee.first_name}
                                            className="absolute inset-0 w-full h-full object-cover rounded-xl shadow-xs sm:shadow-sm border border-slate-100"
                                        />
                                        <div className="absolute inset-0 w-full h-full rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black text-lg shadow-inner border border-indigo-100" style={{ display: 'none' }}>
                                            {employee.first_name ? employee.first_name.charAt(0) : '?'}
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0 z-0">
                                        <p className="text-sm sm:text-base font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate">
                                            {employee.first_name} {employee.last_name}
                                        </p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5 truncate">{employee.job_title}</p>
                                    </div>
                                    <div className="shrink-0 h-8 w-8 bg-slate-50 text-slate-400 rounded-lg flex items-center justify-center group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors z-0">
                                        <i className="ti ti-chevron-right text-lg" />
                                    </div>
                                </div>
                                {/* Details: Dept & Salary */}
                                <div className="flex items-center justify-between mt-1 z-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[10px] sm:text-[11px] font-bold uppercase tracking-widest border border-slate-200">
                                            {employee.department}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">&bull; {employee.role}</span>
                                    </div>
                                    <span className="px-2 py-0.5 text-[10px] sm:text-[11px] font-black uppercase tracking-widest rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0">
                                        ₱{Number(employee.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </motion.div>
                        )) : (
                            <motion.div variants={rowVariants} className="col-span-full">
                                <div className="px-8 py-20 text-center bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100">
                                    <div className="flex flex-col items-center justify-center text-slate-400">
                                        <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-4">
                                            <i className="ti ti-users-minus text-4xl text-slate-300" />
                                        </div>
                                        <p className="text-lg sm:text-xl font-bold text-slate-800 tracking-tight">No Employees Found</p>
                                        <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm">Try adjusting your search query or add a new employee to the database.</p>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Pagination */}
                {Math.ceil(filteredEmployees.length / itemsPerPage) > 1 && (
                    <div className="px-4 sm:px-8 py-4 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <span className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">
                            Showing <span className="text-slate-800">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800">{Math.min(currentPage * itemsPerPage, filteredEmployees.length)}</span> of <span className="text-slate-800">{filteredEmployees.length}</span>
                        </span>
                        <div className="flex gap-2 w-full sm:w-auto">
                            <button 
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="flex-1 sm:flex-none justify-center px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 tap-active transition-all shadow-xs sm:shadow-sm flex items-center gap-2"
                            >
                                <i className="ti ti-chevron-left text-lg" /> Prev
                            </button>
                            <button 
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredEmployees.length / itemsPerPage)))}
                                disabled={currentPage === Math.ceil(filteredEmployees.length / itemsPerPage)}
                                className="flex-1 sm:flex-none justify-center px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 tap-active transition-all shadow-xs sm:shadow-sm flex items-center gap-2"
                            >
                                Next <i className="ti ti-chevron-right text-lg" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
