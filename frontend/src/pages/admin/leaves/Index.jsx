import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';

export default function LeavesIndex() {
    const queryClient = useQueryClient();
    const [filterStatus, setFilterStatus] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const handleFilterChange = (status) => {
        setFilterStatus(status);
        setCurrentPage(1);
    };

    const fetchLeaves = async () => {
        const res = await fetchWithAuth('/api/leaves');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch leaves');
        return Array.isArray(data) ? data : (data?.data || []);
    };

    const { data: leaves = [], isLoading } = useQuery({
        queryKey: ['adminLeaves'],
        queryFn: fetchLeaves,
        staleTime: 0,
        refetchOnWindowFocus: true
    });

    // Real-time live sync for leave approvals table
    useEffect(() => {
        const channel = supabase
            .channel('admin-live-leaves')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
                queryClient.refetchQueries({ queryKey: ['adminLeaves'] });
            })
            .subscribe();

        const handleRefresh = () => {
            queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
            queryClient.refetchQueries({ queryKey: ['adminLeaves'] });
        };
        window.addEventListener('refresh_leaves', handleRefresh);

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener('refresh_leaves', handleRefresh);
        };
    }, [queryClient]);

    const handleStatusChange = async (id, status) => {
        // Optimistic UI Update
        const previousLeaves = queryClient.getQueryData(['adminLeaves']);
        queryClient.setQueryData(['adminLeaves'], old => old.map(l => l.id === id ? { ...l, status } : l));

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetchWithAuth(`/api/leaves/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status, admin_id: user?.id })
            });
            const data = await res.json();
            if (data.success) {
                toast.success(status === 'Approved' ? 'Leave Approved!' : 'Leave Rejected', {
                    icon: status === 'Approved' ? <i className="ti ti-check text-xl text-emerald-500" /> : <i className="ti ti-x text-xl text-rose-500" />
                });
                queryClient.invalidateQueries(['adminLeaves']);
            } else {
                toast.error(data.error || 'Failed to update status');
                queryClient.setQueryData(['adminLeaves'], previousLeaves); // rollback
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
            queryClient.setQueryData(['adminLeaves'], previousLeaves); // rollback
        }
    };

    const pendingCount = leaves.filter(l => l.status === 'New').length;

    const filteredLeaves = leaves.filter(l => {
        if (filterStatus === 'All') return true;
        if (filterStatus === 'Pending') return l.status === 'New';
        return l.status === filterStatus;
    });

    const totalItems = filteredLeaves.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedLeaves = filteredLeaves.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
                <div className="w-12 h-12 border-4 border-slate-200 border-t-purple-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Requests...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans">
            
            {/* HERO HEADER */}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative bg-slate-900 rounded-2xl p-5 sm:p-8 lg:p-10 shadow-xs sm:shadow-sm group">
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 sm:gap-8">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-3 sm:p-4 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
                                <i className="ti ti-plane-departure text-2xl text-purple-400" />
                            </div>
                            <span className="px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-black tracking-widest uppercase bg-purple-500/20 text-purple-300 rounded-md border border-purple-500/30">Time Off Management</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">Leave Engine</h1>
                        <p className="text-sm sm:text-base text-white/70 mt-1 max-w-xl">Review, approve, and manage paid time off and sick leave requests for the entire staff.</p>
                    </div>
                    
                    <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-3 sm:p-4 rounded-xl shrink-0">
                        <div className="text-left sm:text-right">
                            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Pending Action</p>
                            <p className="text-xl sm:text-3xl font-black text-white">{pendingCount}</p>
                        </div>
                        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-purple-500/30 flex items-center justify-center text-purple-300 border border-purple-500/50">
                            <i className={`ti ti-bell text-lg sm:text-xl ${pendingCount > 0 ? 'animate-[ringing_2s_ease-in-out_infinite]' : ''}`} />
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* FILTER TABS */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-1 sm:p-1.5 rounded-xl shadow-xs border border-slate-100 overflow-x-auto touch-scroll no-scrollbar w-full sm:w-max">
                <div className="flex gap-1 min-w-max">
                    {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                        <button
                            key={status}
                            onClick={() => handleFilterChange(status)}
                            className={`px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-bold tap-active transition-all whitespace-nowrap ${
                                filterStatus === status 
                                ? 'bg-slate-900 text-white shadow-xs' 
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                            }`}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            </motion.div>

            {/* TABLE CONTAINER */}
            <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 overflow-hidden">
                
                {/* MOBILE CARDS VIEW (Phones) */}
                <div className="block md:hidden divide-y divide-slate-100">
                    <AnimatePresence>
                        {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                            const daysCount = Math.ceil((new Date(leave.end_date) - new Date(leave.start_date)) / (1000 * 60 * 60 * 24)) + 1;

                            return (
                                <motion.div 
                                    variants={rowVariants} 
                                    layout 
                                    key={`mobile-${leave.id}`} 
                                    className="p-4 space-y-3 hover:bg-purple-50/20 transition-colors"
                                >
                                    {/* Header: Employee + Status */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="relative h-10 w-10 rounded-xl overflow-hidden shrink-0 border border-slate-200 shadow-xs bg-purple-50 flex items-center justify-center">
                                                {leave.employees?.company_id && leave.employees?.id ? (
                                                    <img 
                                                        src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${leave.employees.company_id}/${leave.employees.id}.jpg`}
                                                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : null}
                                                <div 
                                                    className="w-full h-full rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 font-black text-sm shadow-inner"
                                                    style={{ display: (leave.employees?.company_id && leave.employees?.id) ? 'none' : 'flex' }}
                                                >
                                                    {leave.employees?.first_name ? leave.employees.first_name.charAt(0) : '?'}
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-slate-800 truncate">
                                                    {leave.employees ? `${leave.employees.first_name} ${leave.employees.last_name}` : 'Unknown'}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">
                                                    {leave.employees?.department} &bull; {leave.employees?.job_title}
                                                </p>
                                            </div>
                                        </div>

                                        {leave.status === 'New' && (
                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1 shrink-0">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Pending
                                            </span>
                                        )}
                                        {leave.status === 'Approved' && (
                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center gap-1 shrink-0">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Approved
                                            </span>
                                        )}
                                        {leave.status === 'Rejected' && (
                                            <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-red-50 text-red-600 border border-red-200 flex items-center gap-1 shrink-0">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Rejected
                                            </span>
                                        )}
                                    </div>

                                    {/* Body details */}
                                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 space-y-2">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-black text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">{leave.type}</span>
                                            <span className="font-bold text-slate-600">
                                                {new Date(leave.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 
                                                <span className="text-slate-300 mx-1">&rarr;</span> 
                                                {new Date(leave.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                <span className="ml-1 text-[10px] text-slate-400 font-bold">({daysCount}d)</span>
                                            </span>
                                        </div>
                                        {leave.notes && (
                                            <p className="text-xs text-slate-500 italic bg-white p-2 rounded-lg border border-slate-100">
                                                "{leave.notes}"
                                            </p>
                                        )}
                                    </div>

                                    {/* Action Buttons for Mobile */}
                                    {leave.status === 'New' ? (
                                        <div className="flex items-center gap-2 pt-1">
                                            <button 
                                                onClick={() => handleStatusChange(leave.id, 'Approved')} 
                                                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5 tap-active transition-all"
                                            >
                                                <i className="ti ti-check text-base font-bold" /> Approve
                                            </button>
                                            <button 
                                                onClick={() => handleStatusChange(leave.id, 'Rejected')} 
                                                className="flex-1 py-3 bg-white hover:bg-rose-50 active:scale-95 text-rose-600 border border-rose-200 font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 tap-active transition-all"
                                            >
                                                <i className="ti ti-x text-base font-bold" /> Reject
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex justify-end pt-1">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                                <i className="ti ti-lock" /> Decision Locked
                                            </span>
                                        </div>
                                    )}
                                </motion.div>
                            );
                        }) : (
                            <div className="p-8 text-center text-slate-400">
                                <p className="text-xs font-bold">No leave requests found for the selected filter</p>
                            </div>
                        )}
                    </AnimatePresence>
                </div>

                {/* DESKTOP TABLE VIEW */}
                <div className="hidden md:block overflow-x-auto no-scrollbar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                            <tr>
                                <th className="px-6 lg:px-8 py-4">Applicant</th>
                                <th className="px-6 lg:px-8 py-4">Duration</th>
                                <th className="px-6 lg:px-8 py-4">Details</th>
                                <th className="px-6 lg:px-8 py-4 text-center">Status</th>
                                <th className="px-6 lg:px-8 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            <AnimatePresence>
                                {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                                    const daysCount = Math.ceil((new Date(leave.end_date) - new Date(leave.start_date)) / (1000 * 60 * 60 * 24)) + 1;
                                    
                                    return (
                                        <motion.tr variants={rowVariants} layout key={leave.id} className="hover:bg-purple-50/30 transition-colors group">
                                            
                                            <td className="px-6 lg:px-8 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform border border-slate-200 shadow-xs bg-purple-50 flex items-center justify-center">
                                                        {leave.employees?.company_id && leave.employees?.id ? (
                                                            <img 
                                                                src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${leave.employees.company_id}/${leave.employees.id}.jpg`}
                                                                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                                alt={leave.employees.first_name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : null}
                                                        <div 
                                                            className="w-full h-full rounded-xl bg-purple-50 flex items-center justify-center text-purple-600 font-black text-base shadow-inner"
                                                            style={{ display: (leave.employees?.company_id && leave.employees?.id) ? 'none' : 'flex' }}
                                                        >
                                                            {leave.employees?.first_name ? leave.employees.first_name.charAt(0) : '?'}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-black text-slate-800 group-hover:text-purple-600 transition-colors">
                                                            {leave.employees ? `${leave.employees.first_name} ${leave.employees.last_name}` : 'Unknown'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                                            {leave.employees?.department} &bull; {leave.employees?.job_title}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-6 lg:px-8 py-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-slate-700">
                                                        {new Date(leave.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 
                                                        <span className="text-slate-300 mx-1">&rarr;</span> 
                                                        {new Date(leave.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                    </span>
                                                    <span className="px-2 py-0.5 mt-1 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest w-max border border-slate-200">
                                                        {daysCount} {daysCount > 1 ? 'Days' : 'Day'}
                                                    </span>
                                                </div>
                                            </td>

                                            <td className="px-6 lg:px-8 py-4">
                                                <p className="text-sm font-black text-slate-800">{leave.type}</p>
                                                <p className="text-[11px] text-slate-500 mt-0.5 max-w-[220px] truncate" title={leave.notes}>
                                                    {leave.notes || 'No reason provided.'}
                                                </p>
                                            </td>

                                            <td className="px-6 lg:px-8 py-4 text-center">
                                                {leave.status === 'New' && (
                                                    <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-amber-50 text-amber-600 border border-amber-200 shadow-xs flex w-max items-center gap-1.5 mx-auto">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Pending
                                                    </span>
                                                )}
                                                {leave.status === 'Approved' && (
                                                    <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 flex w-max items-center gap-1.5 mx-auto">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Approved
                                                    </span>
                                                )}
                                                {leave.status === 'Rejected' && (
                                                    <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-red-50 text-red-600 border border-red-200 flex w-max items-center gap-1.5 mx-auto">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Rejected
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-6 lg:px-8 py-4 text-right">
                                                {leave.status === 'New' ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button 
                                                            onClick={() => handleStatusChange(leave.id, 'Approved')} 
                                                            className="h-9 w-9 flex items-center justify-center bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-xl hover:bg-emerald-600 hover:text-white active:scale-90 transition-all shadow-xs tap-active" 
                                                            title="Approve Request"
                                                        >
                                                            <i className="ti ti-check text-base font-bold" />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleStatusChange(leave.id, 'Rejected')} 
                                                            className="h-9 w-9 flex items-center justify-center bg-rose-50 border border-rose-300 text-rose-700 rounded-xl hover:bg-rose-600 hover:text-white active:scale-90 transition-all shadow-xs tap-active" 
                                                            title="Reject Request"
                                                        >
                                                            <i className="ti ti-x text-base font-bold" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="text-right">
                                                        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">
                                                            <i className="ti ti-lock" /> Locked
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                        </motion.tr>
                                    );
                                }) : (
                                    <motion.tr variants={rowVariants}>
                                        <td colSpan="5" className="px-8 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-slate-400">
                                                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-3">
                                                    <i className="ti ti-inbox text-3xl text-slate-300" />
                                                </div>
                                                <p className="text-lg font-black text-slate-800 tracking-tight">Inbox Empty</p>
                                                <p className="text-xs text-slate-400 font-medium mt-0.5 max-w-sm">No leave requests found for the selected filter.</p>
                                            </div>
                                        </td>
                                    </motion.tr>
                                )}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>

                {/* PAGINATION BAR */}
                <div className="px-4 sm:px-8 py-4 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-bold">
                    <div>
                        {totalItems > 0 ? (
                            <span>Showing <span className="text-slate-800 font-black">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-black">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-black">{totalItems}</span></span>
                        ) : (
                            <span>Showing <span className="text-slate-800 font-black">0</span> of <span className="text-slate-800 font-black">0</span></span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                        >
                            <i className="ti ti-chevron-left text-sm" /> Prev
                        </button>
                        
                        <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-slate-800 font-black text-xs">
                            {currentPage} / {totalPages}
                        </span>

                        <button 
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage >= totalPages}
                            className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                        >
                            Next <i className="ti ti-chevron-right text-sm" />
                        </button>
                    </div>
                </div>
            </motion.div>
            
            <style dangerouslySetInnerHTML={{__html: `
                @keyframes ringing {
                    0% { transform: rotate(0deg); }
                    10% { transform: rotate(15deg); }
                    20% { transform: rotate(-10deg); }
                    30% { transform: rotate(5deg); }
                    40% { transform: rotate(-5deg); }
                    50% { transform: rotate(0deg); }
                    100% { transform: rotate(0deg); }
                }
            `}} />
        </div>
    );
}
