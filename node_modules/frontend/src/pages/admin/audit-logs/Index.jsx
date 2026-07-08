import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

export default function AuditLogsIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [filterDate, setFilterDate] = useState(searchParams.get('date') || '');
    const [filterUserId, setFilterUserId] = useState(searchParams.get('user_id') || '');
    const [searchQuery, setSearchQuery] = useState('');
    
    const [logs, setLogs] = useState([]);
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                let url = 'http://localhost:5000/api/audit-logs';
                const queryParams = new URLSearchParams();
                if (filterDate) queryParams.append('date', filterDate);
                if (filterUserId) queryParams.append('user_id', filterUserId);
                
                if (queryParams.toString()) url += '?' + queryParams.toString();

                const res = await fetch(url);
                const result = await res.json();
                if (result.data) setLogs(result.data);
            } catch (err) {
                console.error('Failed to fetch audit logs:', err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchLogs();
    }, [filterDate, filterUserId]);

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const res = await fetch('http://localhost:5000/api/employees');
                const result = await res.json();
                if (result.success && result.data) setUsers(result.data);
            } catch (err) {}
        };
        fetchUsers();
    }, []);

    const handleApplyFilters = (e) => {
        e.preventDefault();
        const params = {};
        if (filterDate) params.date = filterDate;
        if (filterUserId) params.user_id = filterUserId;
        setSearchParams(params);
        setCurrentPage(1);
    };

    const handleClearFilters = () => {
        setFilterDate('');
        setFilterUserId('');
        setSearchQuery('');
        setSearchParams({});
        setCurrentPage(1);
    };

    const filteredLogs = logs.filter(log => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const actionStr = (log.event || log.action || '').toLowerCase();
        const targetTypeStr = (log.subject_type || log.log_name || log.target_type || '').toLowerCase();
        const detailsStr = (log.description || log.details || '').toLowerCase();
        
        return (actionStr.includes(q) || targetTypeStr.includes(q) || detailsStr.includes(q));
    });

    const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
                <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading System Logs...</p>
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
                                    <i className="ti ti-server text-2xl text-slate-300" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-slate-500/20 text-slate-300 rounded-md border border-slate-500/30">System Integrity</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Audit Trail</h1>
                            <p className="text-slate-300 font-medium mt-2 text-lg max-w-xl">Immutable ledger of all administrative actions and system modifications.</p>
                        </div>
                        
                        {/* Summary Widget */}
                        <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-lg">
                            <div className="text-right">
                                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Total Logs</p>
                                <p className="text-3xl font-black text-white">{logs.length}</p>
                            </div>
                            <div className="h-14 w-14 rounded-full bg-slate-500/30 flex items-center justify-center text-slate-300 border border-slate-500/50">
                                <i className="ti ti-database-export text-2xl" />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* 2. FILTER BAR */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 bg-white p-3 rounded-lg shadow-sm border border-slate-100 relative">
                        <i className="ti ti-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 text-xl" />
                        <input 
                            type="text" 
                            placeholder="Search actions or targets..." 
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-14 pr-6 py-4 bg-slate-50 border-none rounded-lg outline-none focus:ring-4 focus:ring-slate-500/10 font-bold text-slate-700 transition-all placeholder:text-slate-400 placeholder:font-medium"
                        />
                    </div>

                    <form onSubmit={handleApplyFilters} className="flex bg-white p-2 rounded-lg shadow-sm border border-slate-100 w-full md:w-auto">
                        <input 
                            type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                            className="px-4 py-3 bg-slate-50 border-none rounded-md font-bold text-slate-600 outline-none focus:ring-4 focus:ring-slate-500/10"
                        />
                        <select 
                            value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}
                            className="ml-2 px-4 py-3 bg-slate-50 border-none rounded-md font-bold text-slate-600 outline-none focus:ring-4 focus:ring-slate-500/10"
                        >
                            <option value="">All Admins / System</option>
                            {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                        </select>
                        <button type="submit" className="ml-2 px-6 py-3 bg-slate-900 text-white font-bold rounded-md active:scale-95 transition-all">Filter</button>
                        {(filterDate || filterUserId || searchQuery) && (
                            <button type="button" onClick={handleClearFilters} className="ml-1 w-12 flex items-center justify-center bg-slate-100 text-slate-500 rounded-md hover:bg-slate-200"><i className="ti ti-x" /></button>
                        )}
                    </form>
                </motion.div>

                {/* 3. DATA TABLE */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-8 py-6">Timestamp</th>
                                    <th className="px-8 py-6">Actor</th>
                                    <th className="px-8 py-6">Action Details</th>
                                    <th className="px-8 py-6 text-right">Target UUID</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 font-mono">
                                <AnimatePresence>
                                    {paginatedLogs.length > 0 ? paginatedLogs.map((log) => {
                                        const dateObj = new Date(log.created_at);
                                        const isSystem = !log.causer_id;
                                        
                                        const actionStr = (log.event || log.action || '').toUpperCase();
                                        const targetTypeStr = log.subject_type || log.log_name || log.target_type || '';
                                        const detailsStr = log.description || log.details || '';
                                        const targetIdStr = log.subject_id || log.target_id || '';
                                        const causerIdStr = log.causer_id || log.user_id || '';
                                        const userNameStr = log.causer?.name || log.users?.first_name || 'Admin';

                                        return (
                                            <motion.tr variants={rowVariants} layout key={log.id} className="hover:bg-slate-50/50 transition-colors">
                                                <td className="px-8 py-5">
                                                    <div className="flex flex-col">
                                                        <span className="text-xs font-bold text-slate-500">{dateObj.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                                                        <span className="text-sm font-black text-slate-800">{dateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                                    </div>
                                                </td>

                                                <td className="px-8 py-5">
                                                    {isSystem ? (
                                                        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold uppercase tracking-widest">
                                                            <i className="ti ti-cpu" /> System
                                                        </span>
                                                    ) : (
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold font-sans">
                                                                {userNameStr.charAt(0)}
                                                            </div>
                                                            <div className="flex flex-col font-sans">
                                                                <span className="text-sm font-bold text-slate-700">{userNameStr}</span>
                                                                <span className="text-[10px] text-slate-400 font-bold">ID: {String(causerIdStr).substring(0,8)}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>

                                                <td className="px-8 py-5 font-sans">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${
                                                        actionStr.includes('CREATED') ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                        actionStr.includes('UPDATED') || actionStr.includes('PROCESS') ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                        actionStr.includes('DELETED') ? 'bg-red-50 text-red-600 border-red-100' :
                                                        'bg-slate-100 text-slate-600 border-slate-200'
                                                    }`}>
                                                        {actionStr}
                                                    </span>
                                                    <span className="mx-2 text-xs font-bold text-slate-400">ON</span>
                                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest border border-slate-200">
                                                        {targetTypeStr}
                                                    </span>
                                                    <p className="text-xs text-slate-500 mt-2 truncate max-w-sm">{detailsStr}</p>
                                                </td>

                                                <td className="px-8 py-5 text-right">
                                                    <span className="text-xs text-slate-400 font-bold bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                        {targetIdStr || 'N/A'}
                                                    </span>
                                                </td>
                                            </motion.tr>
                                        );
                                    }) : (
                                        <motion.tr variants={rowVariants}>
                                            <td colSpan="4" className="px-8 py-20 text-center font-sans">
                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                        <i className="ti ti-terminal-2 text-4xl text-slate-300" />
                                                    </div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">No Logs Found</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">The system audit trail is empty for the specified parameters.</p>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    )}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>

                    {/* PAGINATION */}
                    {Math.ceil(filteredLogs.length / itemsPerPage) > 1 && (
                        <div className="px-8 py-6 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                                Showing <span className="text-slate-800">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800">{Math.min(currentPage * itemsPerPage, filteredLogs.length)}</span> of <span className="text-slate-800">{filteredLogs.length}</span>
                            </span>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="px-5 py-2.5 rounded-md bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm flex items-center gap-2"
                                >
                                    <i className="ti ti-chevron-left text-lg" /> Prev
                                </button>
                                <button 
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(filteredLogs.length / itemsPerPage)))}
                                    disabled={currentPage === Math.ceil(filteredLogs.length / itemsPerPage)}
                                    className="px-5 py-2.5 rounded-md bg-white border border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm flex items-center gap-2"
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
