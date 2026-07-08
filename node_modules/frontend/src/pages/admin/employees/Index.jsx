import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function Index() {
    const location = useLocation();
    const [employees, setEmployees] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [isLoading, setIsLoading] = useState(true);
    const [session, setSession] = useState(location.state || {});
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const response = await fetch('http://localhost:5000/api/employees');
                const result = await response.json();
                if (result.success) {
                    setEmployees(result.data);
                }
            } catch (error) {
                console.error("Failed to fetch employees:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchEmployees();
    }, []);

    const copyPassword = (password) => {
        window.navigator.clipboard.writeText(password);
        toast.success('Password copied to clipboard!', { icon: '🔐' });
    };

    const filteredEmployees = employees.filter(emp => 
        `${emp.first_name} ${emp.last_name} ${emp.department} ${emp.role}`.toLowerCase().includes(searchQuery.toLowerCase())
    );

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
        <div className="max-w-7xl mx-auto pb-16 font-sans">
            
            {/* AMBIENT BACKGROUND */}
            
            

            <div className="space-y-8">
                
                {/* 1. PREMIUM HEADER */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-md p-8 md:p-12 shadow-sm group">
                    
                    
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-lg flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-users-group text-2xl text-blue-400" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-blue-500/20 text-blue-300 rounded-md border border-blue-500/30">Personnel Database</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Employee Directory</h1>
                            <p className="text-blue-100/70 font-medium mt-2 text-lg max-w-xl">Manage your staff roster, access ID cards, and update organizational records.</p>
                        </div>
                        
                        {/* Huge CTA */}
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link to="/admin/employees/create" className="relative flex items-center gap-3 px-8 py-5 bg-blue-600 rounded-lg shadow-sm overflow-hidden group/btn">
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                                <div className="w-10 h-10 bg-white/20 rounded-md flex items-center justify-center backdrop-blur-md">
                                    <i className="ti ti-user-plus text-xl text-white font-bold" />
                                </div>
                                <span className="text-white font-black text-lg tracking-wide relative z-10">Add Employee</span>
                            </Link>
                        </motion.div>
                    </div>
                </motion.div>

                {/* ALERTS */}
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
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
                            <div className="flex gap-4">
                                <div className="w-12 h-12 bg-slate-50 text-slate-800 rounded-lg flex items-center justify-center shrink-0 border border-slate-100">
                                    <i className="ti ti-key text-xl" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-900 tracking-tight">{session.success ?? 'Account Created'}</h3>
                                    <p className="text-sm text-slate-500 font-medium mt-0.5">Securely distribute this temporary password to the employee.</p>
                                    <p className="text-[10px] font-bold text-slate-400 mt-2 flex items-center gap-1.5 uppercase tracking-widest">
                                        <i className="ti ti-shield-check" /> Forced change on first login
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <div className="flex-1 md:w-48 px-4 py-3 bg-slate-50 rounded-md border border-slate-100 flex items-center justify-center">
                                    <span className="font-mono text-lg font-black text-slate-900 tracking-widest" dangerouslySetInnerHTML={{ __html: session.temp_password_html || session.temp_password }} />
                                </div>
                                <button onClick={() => copyPassword(session.temp_password)} className="h-[52px] px-6 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-md transition-colors active:scale-95 text-sm">
                                    Copy
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* SEARCH BAR */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-3 rounded-lg shadow-sm border border-slate-100">
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-xl" />
                        <input 
                            type="text" 
                            placeholder="Search by name, role, or department..." 
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCurrentPage(1); // Reset pagination on search
                            }}
                            className="w-full pl-14 pr-6 py-4 bg-slate-50 border-none rounded-lg outline-none focus:ring-4 focus:ring-indigo-500/10 font-bold text-slate-700 transition-all placeholder:text-slate-400 placeholder:font-medium"
                        />
                    </div>
                </motion.div>

                {/* DATA TABLE */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-8 py-6">Employee</th>
                                    <th className="px-8 py-6">Role & Dept</th>
                                    <th className="px-8 py-6">Base Salary</th>
                                    <th className="px-8 py-6">Joined Date</th>
                                    <th className="px-8 py-6 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                <AnimatePresence>
                                    {paginatedEmployees.length > 0 ? paginatedEmployees.map((employee) => (
                                        <motion.tr variants={rowVariants} key={employee.id} className="hover:bg-indigo-50/30 transition-colors group">
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="relative h-14 w-14 shrink-0 group-hover:scale-105 transition-transform">
                                                        <img 
                                                            src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${employee.id}.jpg`}
                                                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                            alt={employee.first_name}
                                                            className="absolute inset-0 w-full h-full object-cover rounded-lg shadow-sm border border-slate-100"
                                                        />
                                                        <div className="absolute inset-0 w-full h-full rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-black text-xl shadow-inner border border-indigo-100" style={{ display: 'none' }}>
                                                            {employee.first_name ? employee.first_name.charAt(0) : '?'}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-base font-black text-slate-800 group-hover:text-indigo-600 transition-colors">
                                                            {employee.first_name} {employee.last_name}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{employee.email}</p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-8 py-5">
                                                <div>
                                                    <p className="text-sm font-black text-slate-700">{employee.job_title}</p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase tracking-widest border border-slate-200">
                                                            {employee.department}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">&bull; {employee.role}</span>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-8 py-5">
                                                <span className="px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                    ₱{Number(employee.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </td>

                                            <td className="px-8 py-5 text-sm text-slate-500 font-bold">
                                                {new Date(employee.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </td>

                                            <td className="px-8 py-5 text-right">
                                                <Link to={`/admin/employees/${employee.id}`} 
                                                   className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 font-bold text-xs uppercase tracking-widest rounded-md hover:bg-blue-600 hover:text-white transition-all border border-slate-200 hover:border-indigo-600 shadow-sm opacity-100 lg:opacity-50 group-hover:opacity-100 focus:opacity-100">
                                                    <i className="ti ti-id text-lg" /> Profile
                                                </Link>
                                            </td>
                                        </motion.tr>
                                    )) : (
                                        <motion.tr variants={rowVariants}>
                                            <td colSpan="5" className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                        <i className="ti ti-users-minus text-4xl text-slate-300" />
                                                    </div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">No Employees Found</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">Try adjusting your search query or add a new employee to the database.</p>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    )}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>

                    {/* PAGINATION */}
                    {Math.ceil(filteredEmployees.length / itemsPerPage) > 1 && (
                        <div className="px-8 py-6 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Showing <span className="text-slate-800">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800">{Math.min(currentPage * itemsPerPage, filteredEmployees.length)}</span> of <span className="text-slate-800">{filteredEmployees.length}</span>
                            </span>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="px-5 py-2.5 rounded-md bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm flex items-center gap-2"
                                >
                                    <i className="ti ti-chevron-left text-lg" /> Prev
                                </button>
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredEmployees.length / itemsPerPage)))}
                                    disabled={currentPage === Math.ceil(filteredEmployees.length / itemsPerPage)}
                                    className="px-5 py-2.5 rounded-md bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm flex items-center gap-2"
                                >
                                    Next <i className="ti ti-chevron-right text-lg" />
                                </button>
                            </div>
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}
