import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

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
        const res = await fetchWithAuth(`/api/leaves?_t=${Date.now()}`, {
            headers: { 'Cache-Control': 'no-cache, no-store' }
        });
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

    const [approvalModalLeave, setApprovalModalLeave] = useState(null);
    const [approvalPayType, setApprovalPayType] = useState('with_pay');
    const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

    const isLeavePending = (status) => {
        const s = String(status || '').toLowerCase().trim();
        return s === 'new' || s === 'pending';
    };

    const handleOpenApproveModal = (leave) => {
        setApprovalModalLeave(leave);
        const isUnpaid = leave.pay_type === 'without_pay' || leave.is_paid === false;
        setApprovalPayType(isUnpaid ? 'without_pay' : 'with_pay');
    };

    const handleConfirmApproval = async () => {
        if (!approvalModalLeave) return;
        const leave = approvalModalLeave;
        const isPaid = approvalPayType === 'with_pay';

        setIsSubmittingApproval(true);
        // Instant Optimistic Update
        queryClient.setQueryData(['adminLeaves'], old => {
            if (!Array.isArray(old)) return old;
            return old.map(l => String(l.id) === String(leave.id) ? { 
                ...l, 
                status: 'Approved', 
                is_paid: isPaid, 
                pay_type: approvalPayType 
            } : l);
        });

        try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const res = await fetchWithAuth(`/api/leaves/${leave.id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ 
                    status: 'Approved', 
                    pay_type: approvalPayType,
                    is_paid: isPaid,
                    admin_id: user?.id 
                })
            });
            const data = await res.json();
            if (data.success) {
                toast.success(`Leave Approved (${isPaid ? 'With Pay' : 'Without Pay / Unpaid'})!`, {
                    icon: <i className="ti ti-check text-xl text-emerald-500" />
                });
                queryClient.setQueryData(['adminLeaves'], old => {
                    if (!Array.isArray(old)) return old;
                    return old.map(l => String(l.id) === String(leave.id) ? { 
                        ...l, 
                        status: 'Approved', 
                        is_paid: isPaid, 
                        pay_type: approvalPayType,
                        ...(data.leave || {})
                    } : l);
                });
                await queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
                await queryClient.invalidateQueries({ queryKey: ['adminAttendance'] });
                setApprovalModalLeave(null);
            } else {
                toast.error(data.error || 'Failed to update status');
                await queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
            await queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
        } finally {
            setIsSubmittingApproval(false);
        }
    };

    const handleStatusChange = async (id, status) => {
        // Instant Optimistic Update
        queryClient.setQueryData(['adminLeaves'], old => {
            if (!Array.isArray(old)) return old;
            return old.map(l => String(l.id) === String(id) ? { ...l, status } : l);
        });

        try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const res = await fetchWithAuth(`/api/leaves/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status, admin_id: user?.id })
            });
            const data = await res.json();
            if (data.success) {
                toast.success(status === 'Approved' ? 'Leave Approved!' : (status === 'New' ? 'Leave Re-opened' : 'Leave Rejected'), {
                    icon: status === 'Approved' ? <i className="ti ti-check text-xl text-emerald-500" /> : <i className="ti ti-x text-xl text-rose-500" />
                });
                queryClient.setQueryData(['adminLeaves'], old => {
                    if (!Array.isArray(old)) return old;
                    return old.map(l => String(l.id) === String(id) ? { 
                        ...l, 
                        status,
                        ...(data.leave || {})
                    } : l);
                });
                await queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
                await queryClient.invalidateQueries({ queryKey: ['adminAttendance'] });
            } else {
                toast.error(data.error || 'Failed to update status');
                await queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
            await queryClient.invalidateQueries({ queryKey: ['adminLeaves'] });
        }
    };

    const pendingCount = leaves.filter(l => isLeavePending(l.status)).length;

    const filteredLeaves = leaves.filter(l => {
        if (filterStatus === 'All') return true;
        if (filterStatus === 'Pending') return isLeavePending(l.status);
        return (l.status || '').toLowerCase() === filterStatus.toLowerCase();
    });

    const totalItems = filteredLeaves.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedLeaves = filteredLeaves.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Leave Requests...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Time Off', 'Leave Approvals']}
                title="Leave Approvals"
                description="Review, audit, and authorize paid time off, medical leaves, and vacation requests across all departments."
                actions={
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Action:</span>
                        <span className="font-mono text-sm font-bold text-amber-600 tabular-nums">{pendingCount}</span>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">
                {/* Filter tabs */}
                <div className="flex bg-white p-1 sm:p-1.5 rounded-xl shadow-xs border border-slate-200 overflow-x-auto touch-scroll no-scrollbar w-full sm:w-max">
                    <div className="flex gap-1 min-w-max">
                        {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                            <button
                                key={status}
                                onClick={() => handleFilterChange(status)}
                                className={`px-3.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    filterStatus === status 
                                    ? 'bg-blue-600 text-white shadow-xs' 
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table container */}
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                
                {/* Mobile view */}
                <div className="block md:hidden divide-y divide-slate-100">
                    {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                        const daysCount = Math.ceil((new Date(leave.end_date) - new Date(leave.start_date)) / (1000 * 60 * 60 * 24)) + 1;

                        return (
                            <div 
                                key={`mobile-${leave.id}`} 
                                className="p-4 space-y-3 hover:bg-purple-50/20 transition-colors"
                            >
                                {/* Header: Employee + Status */}
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <EmployeeAvatar employee={leave.employees} size="h-10 w-10" />
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
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Pending
                                        </span>
                                    )}
                                    {leave.status === 'Approved' && (
                                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md border flex items-center gap-1 shrink-0 ${
                                            leave.pay_type === 'without_pay' || leave.is_paid === false
                                                ? 'bg-amber-50 text-amber-700 border-amber-300'
                                                : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                        }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                                leave.pay_type === 'without_pay' || leave.is_paid === false ? 'bg-amber-500' : 'bg-emerald-500'
                                            }`} />
                                            {leave.pay_type === 'without_pay' || leave.is_paid === false ? 'Approved • Unpaid' : 'Approved • Paid'}
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
                                {isLeavePending(leave.status) ? (
                                    <div className="flex items-center gap-2 pt-1">
                                        <button 
                                            onClick={() => handleOpenApproveModal(leave)} 
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
                                    <div className="flex items-center justify-between pt-1">
                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                            <i className="ti ti-lock" /> Decision Locked ({leave.status})
                                        </span>
                                        <button
                                            onClick={() => handleStatusChange(leave.id, 'New')}
                                            className="text-[10px] font-bold text-blue-600 hover:text-blue-700 underline px-2 py-1"
                                            title="Re-open this request"
                                        >
                                            Re-open
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }) : (
                        <div className="p-8 text-center text-slate-400">
                            <p className="text-xs font-bold">No leave requests found for the selected filter</p>
                        </div>
                    )}
                </div>

                {/* Desktop table view */}
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
                            {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                                const daysCount = Math.ceil((new Date(leave.end_date) - new Date(leave.start_date)) / (1000 * 60 * 60 * 24)) + 1;
                                
                                return (
                                    <tr key={leave.id} className="hover:bg-purple-50/30 transition-colors group">
                                        
                                        <td className="px-6 lg:px-8 py-4">
                                            <div className="flex items-center gap-3">
                                                <EmployeeAvatar employee={leave.employees} size="h-12 w-12" />
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
                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Pending
                                                </span>
                                            )}
                                            {leave.status === 'Approved' && (
                                                <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border flex w-max items-center gap-1.5 mx-auto ${
                                                    leave.pay_type === 'without_pay' || leave.is_paid === false
                                                        ? 'bg-amber-50 text-amber-700 border-amber-300 shadow-xs'
                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-xs'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${
                                                        leave.pay_type === 'without_pay' || leave.is_paid === false ? 'bg-amber-500' : 'bg-emerald-500'
                                                    }`} />
                                                    {leave.pay_type === 'without_pay' || leave.is_paid === false ? 'Approved • Unpaid' : 'Approved • With Pay'}
                                                </span>
                                            )}
                                            {leave.status === 'Rejected' && (
                                                <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-red-50 text-red-600 border border-red-200 flex w-max items-center gap-1.5 mx-auto">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Rejected
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-6 lg:px-8 py-4 text-right">
                                            {isLeavePending(leave.status) ? (
                                                <div className="flex items-center justify-end gap-2">
                                                    <button 
                                                        onClick={() => handleOpenApproveModal(leave)} 
                                                        className="h-9 w-9 flex items-center justify-center bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-xl hover:bg-emerald-600 hover:text-white active:scale-90 transition-all shadow-xs tap-active" 
                                                        title="Approve Request (With Pay / Without Pay)"
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
                                                <div className="flex items-center justify-end gap-2 text-right">
                                                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                                        <i className="ti ti-lock" /> Locked
                                                    </span>
                                                    <button
                                                        onClick={() => handleStatusChange(leave.id, 'New')}
                                                        className="text-[10px] font-bold text-slate-400 hover:text-blue-600 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                                                        title="Re-open request"
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan="5" className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-400">
                                            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-3">
                                                <i className="ti ti-inbox text-3xl text-slate-300" />
                                            </div>
                                            <p className="text-lg font-black text-slate-800 tracking-tight">Inbox Empty</p>
                                            <p className="text-xs text-slate-400 font-medium mt-0.5 max-w-sm">No leave requests found for the selected filter.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
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
            </div>
            </div>

            {/* Leave Approval Modal */}
            {approvalModalLeave && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-blue-50/30 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
                                    <i className="ti ti-calendar-check text-xl" />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-slate-800">Authorize Leave Approval</h3>
                                    <p className="text-xs text-slate-500 font-medium">Configure payroll compensation treatment for this request.</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setApprovalModalLeave(null)}
                                disabled={isSubmittingApproval}
                                className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors"
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-5">
                            {/* Employee Info Box */}
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <EmployeeAvatar employee={approvalModalLeave.employees} size="h-9 w-9" />
                                        <div>
                                            <p className="text-xs font-black text-slate-800">
                                                {approvalModalLeave.employees ? `${approvalModalLeave.employees.first_name} ${approvalModalLeave.employees.last_name}` : 'Employee'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                                {approvalModalLeave.employees?.department} &bull; {approvalModalLeave.type}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-black text-xs border border-blue-200">
                                        {Math.ceil((new Date(approvalModalLeave.end_date) - new Date(approvalModalLeave.start_date)) / (1000 * 60 * 60 * 24)) + 1} Day(s)
                                    </span>
                                </div>

                                <div className="text-xs text-slate-600 flex items-center justify-between border-t border-slate-200/60 pt-2 font-medium">
                                    <span>Duration:</span>
                                    <span className="font-bold text-slate-800">
                                        {new Date(approvalModalLeave.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} &rarr; {new Date(approvalModalLeave.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                </div>
                                {approvalModalLeave.notes && (
                                    <p className="text-xs text-slate-500 italic bg-white p-2.5 rounded-lg border border-slate-100">
                                        "{approvalModalLeave.notes}"
                                    </p>
                                )}
                            </div>

                            {/* Compensation Choices */}
                            <div className="space-y-2.5">
                                <label className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                                    Payroll Impact Treatment
                                </label>

                                {/* With Pay */}
                                <label 
                                    onClick={() => setApprovalPayType('with_pay')}
                                    className={`p-3.5 rounded-xl border-2 flex items-start gap-3.5 cursor-pointer transition-all ${
                                        approvalPayType === 'with_pay' 
                                            ? 'border-emerald-500 bg-emerald-50/40 shadow-xs ring-2 ring-emerald-500/10' 
                                            : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <input 
                                        type="radio" 
                                        name="pay_type" 
                                        checked={approvalPayType === 'with_pay'} 
                                        onChange={() => setApprovalPayType('with_pay')}
                                        className="mt-1 text-emerald-600 focus:ring-emerald-500" 
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-slate-800">Leave With Pay (LWP / Paid)</span>
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700">
                                                Zero Deduction
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-snug">
                                            Credited as paid time off. Automatically marks attendance as <span className="font-semibold text-slate-700">On Leave</span>. Employee retains full basic pay.
                                        </p>
                                    </div>
                                </label>

                                {/* Without Pay */}
                                <label 
                                    onClick={() => setApprovalPayType('without_pay')}
                                    className={`p-3.5 rounded-xl border-2 flex items-start gap-3.5 cursor-pointer transition-all ${
                                        approvalPayType === 'without_pay' 
                                            ? 'border-amber-500 bg-amber-50/40 shadow-xs ring-2 ring-amber-500/10' 
                                            : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <input 
                                        type="radio" 
                                        name="pay_type" 
                                        checked={approvalPayType === 'without_pay'} 
                                        onChange={() => setApprovalPayType('without_pay')}
                                        className="mt-1 text-amber-600 focus:ring-amber-500" 
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-slate-800">Leave Without Pay (LWOP / Unpaid)</span>
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-700">
                                                Deducted From Salary
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-snug">
                                            Treated under DOLE "No Work, No Pay" standard. Automatically marks attendance as <span className="font-semibold text-slate-700">Absent</span> and deducts <code className="font-bold text-amber-800">(daily_rate × days)</code> from payroll.
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={() => setApprovalModalLeave(null)}
                                disabled={isSubmittingApproval}
                                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 tap-active transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmApproval}
                                disabled={isSubmittingApproval}
                                className={`px-5 py-2.5 rounded-xl text-xs font-black text-white shadow-md tap-active transition-all flex items-center gap-2 ${
                                    approvalPayType === 'with_pay' 
                                        ? 'bg-emerald-600 hover:bg-emerald-500 active:scale-95' 
                                        : 'bg-amber-600 hover:bg-amber-500 active:scale-95'
                                }`}
                            >
                                {isSubmittingApproval ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <i className="ti ti-check font-bold" />
                                        Confirm Approval ({approvalPayType === 'with_pay' ? 'With Pay' : 'Without Pay'})
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
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
