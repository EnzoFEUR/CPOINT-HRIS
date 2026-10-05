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
        const res = await fetchWithAuth(`/api/leaves?_t=${Date.now()}`);
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
                toast.success(`Leave request approved (${isPaid ? 'Paid' : 'Unpaid'})`, {
                    icon: <i className="ti ti-check text-xl text-ink" />
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
                    icon: status === 'Approved' ? <i className="ti ti-check text-xl text-accent" /> : <i className="ti ti-x text-xl text-accent" />
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
                <div className="w-10 h-10 border-3 border-slate-200 border-t-accent rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading leave requests...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Time Off', 'Leave Approvals']}
                actions={
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-md">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requires review:</span>
                        <span className="font-mono text-sm font-bold text-warning-ink tabular-nums">{pendingCount}</span>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">
                {/* Filter tabs */}
                <div className="flex bg-white p-1 sm:p-1.5 rounded-lg shadow-2xs border border-slate-200 overflow-x-auto touch-scroll no-scrollbar w-full sm:w-max">
                    <div className="flex gap-1 min-w-max">
                        {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                            <button
                                key={status}
                                onClick={() => handleFilterChange(status)}
                                className={`h-8 px-3.5 sm:px-4 rounded-md text-xs font-semibold transition-colors duration-100 whitespace-nowrap flex items-center ${
                                    filterStatus === status 
                                    ? 'bg-accent text-white shadow-2xs' 
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table container */}
                <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                
                {/* Mobile view */}
                <div className="block md:hidden divide-y divide-slate-100">
                    {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                        const daysCount = Math.ceil((new Date(leave.end_date) - new Date(leave.start_date)) / (1000 * 60 * 60 * 24)) + 1;

                        return (
                            <div 
                                key={`mobile-${leave.id}`} 
                                className="p-4 space-y-3 hover:bg-accent-subtle/20 transition-colors"
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
                                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-warning-subtle text-warning-ink border border-warning/20 flex items-center shrink-0">
                                            Pending
                                        </span>
                                    )}
                                    {leave.status === 'Approved' && (
                                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md border flex items-center shrink-0 ${
                                            leave.pay_type === 'without_pay' || leave.is_paid === false
                                                ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                                : 'bg-surface-muted text-ink border-line'
                                        }`}>
                                            {leave.pay_type === 'without_pay' || leave.is_paid === false ? 'Approved • Unpaid' : 'Approved • Paid'}
                                        </span>
                                    )}
                                    {leave.status === 'Rejected' && (
                                        <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-danger-subtle text-danger-ink border border-danger/20 flex items-center shrink-0">
                                            Rejected
                                        </span>
                                    )}
                                </div>

                                {/* Body details */}
                                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-black text-accent bg-accent-subtle px-2 py-0.5 rounded border border-accent/20">{leave.type}</span>
                                        <span className="font-bold text-slate-600">
                                            {new Date(leave.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} 
                                            <span className="text-slate-300 mx-1">&rarr;</span> 
                                            {new Date(leave.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            <span className="ml-1 text-[10px] text-slate-400 font-bold">({daysCount}d)</span>
                                        </span>
                                    </div>
                                    {leave.notes && (
                                        <p className="text-xs text-slate-500 italic bg-white p-2 rounded-md border border-slate-200">
                                            "{leave.notes}"
                                        </p>
                                    )}
                                </div>

                                {/* Action Buttons for Mobile */}
                                {isLeavePending(leave.status) ? (
                                    <div className="flex items-center gap-2 pt-1">
                                        <button 
                                            onClick={() => handleOpenApproveModal(leave)} 
                                            className="flex-1 h-9 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100"
                                        >
                                            <i className="ti ti-check text-sm font-bold" /> Approve
                                        </button>
                                        <button 
                                            onClick={() => handleStatusChange(leave.id, 'Rejected')} 
                                            className="flex-1 h-9 bg-white hover:bg-danger-subtle text-danger-ink border border-danger/20 font-semibold text-xs rounded-md shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100"
                                        >
                                            <i className="ti ti-x text-sm font-bold" /> Reject
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between pt-1">
                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                                            <i className="ti ti-lock" /> Decision Locked ({leave.status})
                                        </span>
                                        <button
                                            onClick={() => handleStatusChange(leave.id, 'New')}
                                            className="text-[10px] font-bold text-accent hover:text-accent underline px-2 py-1"
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
                            <p className="text-xs font-bold">No pending leave requests</p>
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
                                    <tr key={leave.id} className="hover:bg-accent-subtle/30 transition-colors group">
                                        
                                        <td className="px-6 lg:px-8 py-4">
                                            <div className="flex items-center gap-3">
                                                <EmployeeAvatar employee={leave.employees} size="h-12 w-12" />
                                                <div>
                                                    <p className="text-sm font-black text-slate-800 group-hover:text-accent transition-colors">
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
                                                <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-warning-subtle text-warning-ink border border-warning/20 shadow-2xs flex w-max items-center mx-auto">
                                                    Pending
                                                </span>
                                            )}
                                            {leave.status === 'Approved' && (
                                                <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border flex w-max items-center mx-auto ${
                                                    leave.pay_type === 'without_pay' || leave.is_paid === false
                                                        ? 'bg-warning-subtle text-warning-ink border-warning/20 shadow-2xs'
                                                        : 'bg-surface-muted text-ink border-line shadow-2xs'
                                                }`}>
                                                    {leave.pay_type === 'without_pay' || leave.is_paid === false ? 'Approved • Unpaid' : 'Approved • With Pay'}
                                                </span>
                                            )}
                                            {leave.status === 'Rejected' && (
                                                <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-danger-subtle text-danger-ink border border-danger/20 flex w-max items-center mx-auto">
                                                    Rejected
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-6 lg:px-8 py-4 text-right">
                                            {isLeavePending(leave.status) ? (
                                                <div className="flex items-center justify-end gap-2">
                                                    <button 
                                                        onClick={() => handleOpenApproveModal(leave)} 
                                                        className="h-8 w-8 flex items-center justify-center bg-accent-subtle border border-accent/20 text-accent rounded-md hover:bg-accent hover:text-white transition-colors duration-100 shadow-2xs" 
                                                        title="Approve Request (With Pay / Without Pay)"
                                                    >
                                                        <i className="ti ti-check text-sm font-bold" />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleStatusChange(leave.id, 'Rejected')} 
                                                        className="h-8 w-8 flex items-center justify-center bg-danger-subtle border border-danger/20 text-danger-ink rounded-md hover:bg-danger hover:text-white transition-colors duration-100 shadow-2xs" 
                                                        title="Reject Request"
                                                    >
                                                        <i className="ti ti-x text-sm font-bold" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-end text-right">
                                                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                                                        <i className="ti ti-lock" /> Locked
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan="5" className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-400">
                                            <div className="w-16 h-16 bg-slate-50 rounded-lg flex items-center justify-center mb-3 border border-slate-200">
                                                <i className="ti ti-inbox text-3xl text-slate-400" />
                                            </div>
                                            <p className="text-base font-bold text-slate-800 tracking-tight">No pending leave requests</p>
                                            <p className="text-xs text-slate-500 font-medium mt-0.5 max-w-sm">No leave requests found for the selected filter.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="px-4 sm:px-8 py-3.5 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-semibold">
                    <div>
                        {totalItems > 0 ? (
                            <span>Showing <span className="text-slate-800 font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-semibold">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-semibold">{totalItems}</span></span>
                        ) : (
                            <span>Showing <span className="text-slate-800 font-semibold">0</span> of <span className="text-slate-800 font-semibold">0</span></span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                        >
                            <i className="ti ti-chevron-left text-sm" /> Prev
                        </button>
                        
                        <span className="h-8 px-3 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-800 font-semibold text-xs">
                            {currentPage} / {totalPages}
                        </span>

                        <button 
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage >= totalPages}
                            className="h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                        >
                            Next <i className="ti ti-chevron-right text-sm" />
                        </button>
                    </div>
                </div>
            </div>
            </div>

            {/* Leave Approval Modal */}
            {approvalModalLeave && (
                <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20 shrink-0">
                                    <i className="ti ti-calendar-check text-lg" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">Approve Leave Request</h3>
                                    <p className="text-xs text-slate-500 font-medium">Choose whether this time off is paid or unpaid.</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setApprovalModalLeave(null)}
                                disabled={isSubmittingApproval}
                                className="w-8 h-8 rounded-md bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors duration-100 border border-slate-200 cursor-pointer"
                            >
                                <i className="ti ti-x text-base font-semibold" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-5">
                            {/* Employee Info Box */}
                            <div className="bg-slate-50 rounded-md p-4 border border-slate-200 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                        <EmployeeAvatar employee={approvalModalLeave.employees} size="h-9 w-9" />
                                        <div>
                                            <p className="text-xs font-bold text-slate-800">
                                                {approvalModalLeave.employees ? `${approvalModalLeave.employees.first_name} ${approvalModalLeave.employees.last_name}` : 'Employee'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                                {approvalModalLeave.employees?.department} &bull; {approvalModalLeave.type}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="px-2.5 py-1 rounded-md bg-accent-subtle text-accent font-bold text-xs border border-accent/20">
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
                                    <p className="text-xs text-slate-500 italic bg-white p-2.5 rounded-md border border-slate-200">
                                        "{approvalModalLeave.notes}"
                                    </p>
                                )}
                            </div>

                            {/* Compensation Choices */}
                            <div className="space-y-2.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                                    Pay Type
                                </label>

                                {/* With Pay */}
                                <label 
                                    onClick={() => setApprovalPayType('with_pay')}
                                    className={`p-3.5 rounded-md border flex items-start gap-3.5 cursor-pointer transition-colors duration-100 ${
                                        approvalPayType === 'with_pay' 
                                            ? 'border-accent/20 bg-accent-subtle shadow-2xs' 
                                             : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <input 
                                        type="radio" 
                                        name="pay_type" 
                                        checked={approvalPayType === 'with_pay'} 
                                        onChange={() => setApprovalPayType('with_pay')}
                                        className="mt-1 text-accent focus:ring-accent/20" 
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-800">Paid leave</span>
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-success-subtle text-success-ink">
                                                Full pay
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-snug">
                                            Credited as paid time off. Employee receives full basic pay.
                                        </p>
                                    </div>
                                </label>

                                {/* Without Pay */}
                                <label 
                                    onClick={() => setApprovalPayType('without_pay')}
                                    className={`p-3.5 rounded-md border flex items-start gap-3.5 cursor-pointer transition-colors duration-100 ${
                                        approvalPayType === 'without_pay' 
                                            ? 'border-warning bg-warning-subtle/50 shadow-2xs' 
                                            : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <input 
                                        type="radio" 
                                        name="pay_type" 
                                        checked={approvalPayType === 'without_pay'} 
                                        onChange={() => setApprovalPayType('without_pay')}
                                        className="mt-1 text-warning-ink focus:ring-warning" 
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-800">Unpaid leave</span>
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-warning-subtle text-warning-ink">
                                                Unpaid
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-snug">
                                            Salary is deducted for days not worked under DOLE rules.
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
                                className="h-9 px-4 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors duration-100 border border-slate-200 bg-white cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmApproval}
                                disabled={isSubmittingApproval}
                                className={`h-9 px-4 rounded-md text-xs font-semibold text-white shadow-2xs transition-colors duration-100 flex items-center gap-2 cursor-pointer ${
                                    approvalPayType === 'with_pay' 
                                        ? 'bg-ink-subtle hover:bg-ink-subtle' 
                                        : 'bg-warning hover:bg-warning-ink'
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
