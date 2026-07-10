import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function LeavesIndex() {
    const queryClient = useQueryClient();
    const [filterStatus, setFilterStatus] = useState('All');

    const fetchLeaves = async () => {
        const res = await fetch('http://localhost:5000/api/leaves');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch leaves');
        return data || [];
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
            const res = await fetch(`http://localhost:5000/api/leaves/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
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
            
            
            
            

            <div className="space-y-8">
                
                {/* Page header */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-md p-8 md:p-12 shadow-sm group">
                    
                    
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-lg flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-plane-departure text-2xl text-purple-400" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-purple-500/20 text-purple-300 rounded-md border border-purple-500/30">Time Off Management</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Leave Engine</h1>
                            <p className="text-purple-100/70 font-medium mt-2 text-lg max-w-xl">Review, approve, and manage paid time off and sick leave requests for the entire staff.</p>
                        </div>
                        
                        {/* Summary Widget */}
                        <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-lg">
                            <div className="text-right">
                                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Pending Action</p>
                                <p className="text-3xl font-black text-white">{pendingCount}</p>
                            </div>
                            <div className="h-14 w-14 rounded-full bg-purple-500/30 flex items-center justify-center text-purple-300 border border-purple-500/50">
                                <i className={`ti ti-bell text-2xl ${pendingCount > 0 ? 'animate-[ringing_2s_ease-in-out_infinite]' : ''}`} />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* 2. FILTER BAR */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-2 rounded-lg shadow-sm border border-slate-100 w-max">
                    <div className="flex gap-1">
                        {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-6 py-3 rounded-md text-sm font-bold transition-all ${
                                    filterStatus === status 
                                    ? 'bg-slate-900 text-white shadow-md' 
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* 3. DATA TABLE */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto overflow-y-hidden">
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
                                                        <div className="h-12 w-12 rounded-lg bg-purple-50 flex items-center justify-center font-black text-purple-600 text-lg shadow-inner border border-purple-100 shrink-0">
                                                            {leave.employees?.first_name ? leave.employees.first_name.charAt(0) : '?'}
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
