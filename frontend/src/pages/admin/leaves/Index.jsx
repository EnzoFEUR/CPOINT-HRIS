import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function LeavesIndex() {
    const queryClient = useQueryClient();
    const [filterStatus, setFilterStatus] = useState('All');

    const fetchLeaves = async () => {
        const res = await fetchWithAuth('/api/leaves');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch leaves');
        return Array.isArray(data) ? data : (data?.data || []);
    };

    const { data: leaves = [], isLoading } = useQuery({
        queryKey: ['adminLeaves'],
        queryFn: fetchLeaves
    });

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
        <div className="max-w-7xl mx-auto pb-16 font-sans">
            
            
            
            

            <div className="space-y-6 sm:space-y-8">
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 rounded-2xl sm:rounded-md p-6 sm:p-10 overflow-hidden shadow-xl shadow-purple-950/10">
                    <div className="absolute top-0 right-0 -mt-10 -mr-10 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <span className="text-purple-400 font-bold uppercase tracking-widest text-xs">Time Off Management</span>
                            <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight mt-1">Leave Engine</h1>
                            <p className="text-purple-100/70 font-medium mt-1 sm:mt-2 text-sm sm:text-lg max-w-xl">Review, approve, and manage paid time off and sick leave requests for the entire staff.</p>
                        </div>
                        
                        <div className="flex items-center justify-between sm:justify-start gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-4 sm:p-5 rounded-xl sm:rounded-lg shrink-0">
                            <div className="text-left sm:text-right">
                                <p className="text-[10px] sm:text-xs font-bold text-white/60 uppercase tracking-widest">Pending Action</p>
                                <p className="text-2xl sm:text-3xl font-black text-white">{pendingCount}</p>
                            </div>
                            <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-purple-500/30 flex items-center justify-center text-purple-300 border border-purple-500/50">
                                <i className={`ti ti-bell text-xl sm:text-2xl ${pendingCount > 0 ? 'animate-[ringing_2s_ease-in-out_infinite]' : ''}`} />
                            </div>
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-1.5 sm:p-2 rounded-xl sm:rounded-lg shadow-xs border border-slate-100 overflow-x-auto touch-scroll no-scrollbar w-full sm:w-max">
                    <div className="flex gap-1 min-w-max">
                        {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-bold tap-active transition-all whitespace-nowrap ${
                                    filterStatus === status 
                                    ? 'bg-slate-900 text-white shadow-sm' 
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </motion.div>

                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-2xl sm:rounded-md shadow-xs sm:shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto overflow-y-hidden touch-scroll">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-8 py-6">Employee</th>
                                    <th className="px-8 py-6">Leave Period</th>
                                    <th className="px-8 py-6">Details</th>
                                    <th className="px-8 py-6 text-center">Status</th>
                                    <th className="px-8 py-6 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                <AnimatePresence>
                                    {filteredLeaves.length > 0 ? filteredLeaves.map((leave) => {
                                        const daysCount = Math.ceil((new Date(leave.end_date) - new Date(leave.start_date)) / (1000 * 60 * 60 * 24)) + 1;
                                        
                                        return (
                                            <motion.tr variants={rowVariants} layout key={leave.id} className="hover:bg-purple-50/30 transition-colors group">
                                                
                                                <td className="px-8 py-5">
                                                    <div className="flex items-center gap-4">
                                                        <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform border border-slate-200 shadow-sm bg-purple-50 flex items-center justify-center">
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
                                                            <p className="text-base font-black text-slate-800 group-hover:text-purple-600 transition-colors">
                                                                {leave.employees ? `${leave.employees.first_name} ${leave.employees.last_name}` : 'Unknown'}
                                                            </p>
                                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                                                {leave.employees?.department} &bull; {leave.employees?.job_title}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-8 py-5">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-bold text-slate-700">
                                                            {new Date(leave.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 
                                                            <span className="text-slate-300 mx-1">&rarr;</span> 
                                                            {new Date(leave.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                        </span>
                                                        <span className="px-2 py-1 mt-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-bold uppercase tracking-widest w-max border border-slate-200">
                                                            {daysCount} {daysCount > 1 ? 'Days' : 'Day'}
                                                        </span>
                                                    </div>
                                                </td>

                                                <td className="px-8 py-5">
                                                    <p className="text-sm font-black text-slate-800">{leave.type}</p>
                                                    <p className="text-xs text-slate-500 mt-0.5 max-w-[200px] truncate" title={leave.notes}>
                                                        {leave.notes || 'No reason provided.'}
                                                    </p>
                                                </td>

                                                <td className="px-8 py-5 text-center">
                                                    {leave.status === 'New' && (
                                                        <span className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md bg-amber-50 text-amber-600 border border-amber-200 shadow-sm flex w-max items-center gap-2 mx-auto">
                                                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Pending
                                                        </span>
                                                    )}
                                                    {leave.status === 'Approved' && (
                                                        <span className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 flex w-max items-center gap-2 mx-auto">
                                                            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Approved
                                                        </span>
                                                    )}
                                                    {leave.status === 'Rejected' && (
                                                        <span className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md bg-red-50 text-red-600 border border-red-200 flex w-max items-center gap-2 mx-auto">
                                                            <span className="w-2 h-2 rounded-full bg-red-500" /> Rejected
                                                        </span>
                                                    )}
                                                </td>

                                                <td className="px-8 py-5 text-right">
                                                    {leave.status === 'New' ? (
                                                        <div className="flex items-center justify-end gap-3 opacity-100 lg:opacity-50 group-hover:opacity-100 transition-opacity">
                                                            <button 
                                                                onClick={() => handleStatusChange(leave.id, 'Approved')} 
                                                                className="h-10 w-10 flex items-center justify-center bg-white border border-emerald-200 text-emerald-600 rounded-md hover:bg-emerald-500 hover:text-white transition-all shadow-sm active:scale-95" 
                                                                title="Approve"
                                                            >
                                                                <i className="ti ti-check text-xl font-bold" />
                                                            </button>
                                                            <button 
                                                                onClick={() => handleStatusChange(leave.id, 'Rejected')} 
                                                                className="h-10 w-10 flex items-center justify-center bg-white border border-red-200 text-red-600 rounded-md hover:bg-red-500 hover:text-white transition-all shadow-sm active:scale-95" 
                                                                title="Reject"
                                                            >
                                                                <i className="ti ti-x text-xl font-bold" />
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
                                                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                        <i className="ti ti-inbox text-4xl text-slate-300" />
                                                    </div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">Inbox Empty</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">No leave requests found for the selected filter.</p>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    )}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            </div>
            
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
