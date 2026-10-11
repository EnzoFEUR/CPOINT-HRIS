import { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import { getUser } from '../../../routes/guards';
import useEmployeeLeaveCredits, { readLeaveCreditResponse } from '../../../utils/useEmployeeLeaveCredits';
import { CASH_OUT_LABELS, isCreditLeaveType, getDefaultLeaveCreditPool, getLeaveApprovalBlock, isPendingLeave } from '../../../../../shared/leavePolicy.js';
import { Link, useSearchParams } from 'react-router-dom';
import SilSettings from '../payroll/components/SilSettings';

function RequestedPayBadge({ leave }) {
    const paid = leave.requested_pay_type === 'with_pay';
    const unpaid = leave.requested_pay_type === 'without_pay';
    const label = paid ? 'Paid' : unpaid ? 'Unpaid' : 'Not recorded';
    const description = paid ? 'Employee requested paid leave' : unpaid ? 'Employee requested unpaid leave' : 'Employee payment choice not recorded';
    return <span aria-label={description} title={description} className={`inline-flex whitespace-nowrap rounded-md border px-2.5 py-1 text-[10px] font-bold ${paid
        ? 'border-accent/20 bg-accent-subtle text-accent'
        : unpaid ? 'border-slate-200 bg-slate-100 text-slate-700' : 'border-slate-200 bg-white text-slate-500'}`}>
        {label}
    </span>;
}

export default function LeavesIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab') || 'requests';
    const activeTab = (rawTab === 'cashout' || rawTab === 'cashouts') ? 'cashouts' : rawTab;
    const setActiveTab = (tab) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (tab === 'requests') next.delete('tab');
            else next.set('tab', tab);
            return next;
        }, { replace: true });
    };

    const queryClient = useQueryClient();
    const actorId = getUser()?.id;
    const leavesKey = ['adminLeaves', actorId];
    const [filterStatus, setFilterStatus] = useState('All');
    const [search, setSearch] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    const [cashPage, setCashPage] = useState(1);
    const [cashFilters, setCashFilters] = useState({ name: '', status: 'open', from: '', to: '' });
    const [cashDraft, setCashDraft] = useState(cashFilters);
    const cashQueue = useQuery({
        queryKey: ['silCashOutQueue', actorId, cashPage, cashFilters],
        enabled: Boolean(actorId),
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth(`/api/leave-credits/cash-out-requests?${new URLSearchParams({ ...cashFilters, page: String(cashPage) })}`, { signal });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load cash-out requests.');
            return body;
        },
        staleTime: 15000, refetchInterval: 60000, refetchIntervalInBackground: false, retry: false,
    });

    const handleFilterChange = (status) => {
        setFilterStatus(status);
        setCurrentPage(1);
    };

    const fetchLeaves = async ({ signal }) => {
        const res = await fetchWithAuth('/api/leaves', { signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch leaves');
        signal.throwIfAborted();
        const rows = Array.isArray(data) ? data : data?.data;
        if (!Array.isArray(rows)) throw new Error('Leave requests could not be verified. Retry before reviewing.');
        return rows;
    };

    const { data: leaves = [], isLoading, isFetching: refreshingLeaves, error: leavesError } = useQuery({
        queryKey: leavesKey,
        queryFn: fetchLeaves,
        enabled: Boolean(actorId),
        staleTime: 15000,
        refetchOnMount: 'always',
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchInterval: 60000,
        refetchIntervalInBackground: false
    });

    useEffect(() => {
        if (!actorId) return;
        let timer;
        let stopped = false;
        const handleRefresh = () => {
            if (stopped) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (stopped) return;
                queryClient.invalidateQueries({ queryKey: ['adminLeaves', actorId] });
                queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', actorId] });
                queryClient.invalidateQueries({ queryKey: ['silCashOutQueue', actorId] });
            }, 150);
        };
        const channel = supabase.channel('admin-leaves-sync')
            .on('broadcast', { event: 'LEAVE_REQUEST_CREATED' }, handleRefresh)
            .on('broadcast', { event: 'LEAVE_STATUS_UPDATED' }, handleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, handleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_cash_out_requests' }, handleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, handleRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, handleRefresh)
            .subscribe(status => {
                if (stopped) return;
                if (status === 'SUBSCRIBED') handleRefresh();
            });
        window.addEventListener('refresh_leaves', handleRefresh);
        return () => {
            stopped = true;
            clearTimeout(timer);
            supabase.removeChannel(channel);
            window.removeEventListener('refresh_leaves', handleRefresh);
        };
    }, [actorId, queryClient]);

    const [approvalLeaveId, setApprovalLeaveId] = useState(null);
    const approvalModalLeave = leaves.find(leave => String(leave.id) === String(approvalLeaveId)) || null;
    const setApprovalModalLeave = leave => setApprovalLeaveId(leave?.id ?? null);
    const [legacyPayType, setLegacyPayType] = useState('with_pay');
    const [reviewAction, setReviewAction] = useState('Approved');
    const [decisionError, setDecisionError] = useState('');
    const reviewDialog = useRef(null);
    const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
    const approvalPayType = approvalModalLeave?.requested_pay_type || legacyPayType;
    const approvalCreditPool = approvalModalLeave && reviewAction === 'Approved' && approvalPayType === 'with_pay' ? getDefaultLeaveCreditPool(approvalModalLeave) : '';
    const submitting = useRef(false);
    const approvalRequest = useRef(null);
    const credits = useEmployeeLeaveCredits(approvalCreditPool ? approvalModalLeave?.employee_id : undefined);
    const preview = useQuery({
        queryKey: ['leaveCreditPreview', actorId, approvalModalLeave?.employee_id, approvalModalLeave?.start_date, approvalModalLeave?.end_date],
        enabled: Boolean(approvalModalLeave && approvalCreditPool && approvalPayType === 'with_pay'),
        queryFn: async ({ signal }) => readLeaveCreditResponse(await fetchWithAuth(`/api/leave-credits/preview?employee_id=${encodeURIComponent(approvalModalLeave.employee_id)}&start_date=${approvalModalLeave.start_date}&end_date=${approvalModalLeave.end_date}`, { signal })),
        staleTime: 15000, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchOnReconnect: true, refetchInterval: 60000, refetchIntervalInBackground: false, retry: false,
    });
    const usesCredits = reviewAction === 'Approved' && approvalPayType === 'with_pay' && Boolean(approvalCreditPool);
    const approvalBlock = leavesError?.message || (refreshingLeaves ? 'Refreshing requests. Wait for the current decision before continuing.' : '') || (reviewAction === 'Rejected'
        ? (!approvalModalLeave || !isPendingLeave(approvalModalLeave.status) ? 'This request is no longer pending. Refresh before reviewing it.' : '')
        : approvalModalLeave?.schedule_error || getLeaveApprovalBlock({
        leave: approvalModalLeave, payType: approvalPayType, creditPool: approvalCreditPool,
        snapshot: credits.data, preview: preview.data,
        checking: credits.isFetching || credits.isLoading || preview.isFetching || preview.isLoading,
        error: credits.error?.message || preview.error?.message || '',
    }));
    const creditBlocked = Boolean(approvalBlock);
    const reviewDays = usesCredits ? preview.data?.days : approvalModalLeave?.scheduled_workdays;



    const isLeavePending = isPendingLeave;

    const handleOpenApproveModal = (leave, action = 'Approved') => {
        if (submitting.current || leavesError || refreshingLeaves || !isPendingLeave(leave.status)) return;
        setReviewAction(action);
        setDecisionError('');
        approvalRequest.current = null;
        setApprovalModalLeave(leave);
        const isUnpaid = leave.requested_pay_type ? leave.requested_pay_type === 'without_pay' : leave.pay_type === 'without_pay' || leave.is_paid === false;
        setLegacyPayType(isUnpaid ? 'without_pay' : 'with_pay');
    };

    const handleConfirmApproval = async () => {
        if (!approvalModalLeave || submitting.current || creditBlocked || reviewAction !== 'Approved') return;
        setDecisionError('');
        const leave = approvalModalLeave;
        const isPaid = approvalPayType === 'with_pay';

        submitting.current = true;
        setIsSubmittingApproval(true);
        try {
            const payload = { status: 'Approved', pay_type: approvalPayType, is_paid: isPaid, credit_pool: usesCredits ? approvalCreditPool : null, expected_status: leave.status };
            const fingerprint = JSON.stringify({ id: leave.id, ...payload });
            if (approvalRequest.current?.fingerprint !== fingerprint) approvalRequest.current = { fingerprint, id: crypto.randomUUID() };
            const res = await fetchWithAuth(`/api/leaves/${leave.id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ ...payload, request_id: approvalRequest.current.id })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(`Leave request approved (${isPaid ? 'Paid' : 'Unpaid'})`, {
                    icon: <i className="ti ti-check text-xl text-ink" />
                });
                queryClient.setQueryData(leavesKey, old => {
                    if (!Array.isArray(old)) return old;
                    return old.map(l => String(l.id) === String(leave.id) ? { 
                        ...l, 
                        status: 'Approved', 
                        is_paid: isPaid, 
                        pay_type: approvalPayType,
                        ...(data.leave || {})
                    } : l);
                });
                await refreshDecision(leave.employee_id);
                approvalRequest.current = null;
                setApprovalModalLeave(null);
            } else {
                setDecisionError(data.error || 'Failed to update status');
                toast.error(data.error || 'Failed to update status');
                await refreshDecision(leave.employee_id);
            }
        } catch (err) {
            console.error(err);
            setDecisionError('Unable to confirm the decision. Refresh before retrying; the same request ID will be reused.');
            toast.error('Unable to confirm the decision.');
            await refreshDecision(leave.employee_id);
        } finally {
            submitting.current = false;
            setIsSubmittingApproval(false);
        }
    };

    const handleStatusChange = async (id, status) => {
        if (submitting.current || leavesError || refreshingLeaves || creditBlocked) return;
        setDecisionError('');
        const leave = leaves.find(item => String(item.id) === String(id));
        if (!leave || !isLeavePending(leave.status)) { toast.error('This request is no longer pending. Refresh before reviewing.'); return; }
        const payload = { status, expected_status: leave.status };
        const fingerprint = JSON.stringify({ id, ...payload });
        if (approvalRequest.current?.fingerprint !== fingerprint) approvalRequest.current = { fingerprint, id: crypto.randomUUID() };
        submitting.current = true;
        setIsSubmittingApproval(true);
        try {
            const res = await fetchWithAuth(`/api/leaves/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ ...payload, request_id: approvalRequest.current.id })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(status === 'Approved' ? 'Leave Approved!' : 'Leave Rejected', {
                    icon: status === 'Approved' ? <i className="ti ti-check text-xl text-accent" /> : <i className="ti ti-x text-xl text-accent" />
                });
                queryClient.setQueryData(leavesKey, old => {
                    if (!Array.isArray(old)) return old;
                    return old.map(l => String(l.id) === String(id) ? { 
                        ...l, 
                        status,
                        ...(data.leave || {})
                    } : l);
                });
                await refreshDecision(leave.employee_id);
                approvalRequest.current = null;
                setApprovalModalLeave(null);
            } else {
                setDecisionError(data.error || 'Failed to update status');
                toast.error(data.error || 'Failed to update status');
                await refreshDecision(leave.employee_id);
            }
        } catch (err) {
            console.error(err);
            setDecisionError('Unable to confirm the decision. Refresh before retrying; the same request ID will be reused.');
            toast.error('Unable to confirm the decision.');
            await refreshDecision(leave.employee_id);
        } finally { submitting.current = false; setIsSubmittingApproval(false); }
    };

    const refreshDecision = async employeeId => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['adminLeaves', actorId] }),
            queryClient.invalidateQueries({ queryKey: ['adminAttendance'] }),
            queryClient.invalidateQueries({ queryKey: ['leaveCreditPreview', actorId, employeeId] }),
            queryClient.invalidateQueries({ queryKey: ['employeeLeaveCredits', actorId, employeeId] }),
            queryClient.invalidateQueries({ queryKey: ['employeeMonthlyAttendance', employeeId] }),
            queryClient.invalidateQueries({ queryKey: ['employeeDashboard', employeeId] }),
        ]);
    };

    const { counts, departments } = useMemo(() => {
        const counts = { All: leaves.length, Pending: 0, Approved: 0, Rejected: 0 };
        const departments = new Set();
        for (const leave of leaves) {
            if (isPendingLeave(leave.status)) counts.Pending++;
            else if (leave.status === 'Approved' || leave.status === 'Rejected') counts[leave.status]++;
            if (leave.employees?.department) departments.add(leave.employees.department);
        }
        return { counts, departments: [...departments].sort() };
    }, [leaves]);
    const filteredLeaves = useMemo(() => {
        const term = search.trim().toLowerCase();
        return leaves.filter(leave => {
            const matchesStatus = filterStatus === 'All' || (filterStatus === 'Pending' ? isPendingLeave(leave.status) : String(leave.status || '').toLowerCase() === filterStatus.toLowerCase());
            const matchesDepartment = departmentFilter === 'All' || leave.employees?.department === departmentFilter;
            const employee = leave.employees;
            const text = [employee?.first_name, employee?.last_name, employee?.company_id, leave.type].filter(Boolean).join(' ').toLowerCase();
            return matchesStatus && matchesDepartment && (!term || text.includes(term));
        });
    }, [leaves, filterStatus, departmentFilter, search]);
    const emptyMessage = leavesError ? 'Leave requests could not be loaded.' : search.trim() || departmentFilter !== 'All' || filterStatus !== 'All' ? 'No leave requests match your filters.' : 'No leave requests yet.';
    const reviewOpen = Boolean(approvalModalLeave);
    useEffect(() => {
        if (!reviewOpen) return;
        const opener = document.activeElement;
        reviewDialog.current?.querySelector('button')?.focus();
        const keydown = event => {
            if (event.key === 'Escape') { event.preventDefault(); if (!submitting.current) setApprovalLeaveId(null); }
            if (event.key !== 'Tab') return;
            const controls = [...(reviewDialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], summary') || [])].filter(control => control.getClientRects().length > 0);
            const first = controls[0], last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); reviewDialog.current?.focus(); }
            else if (event.shiftKey && (document.activeElement === first || !reviewDialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !reviewDialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.removeEventListener('keydown', keydown); if (opener?.isConnected) opener.focus(); };
    }, [reviewOpen, approvalLeaveId]);

    const totalItems = filteredLeaves.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const visiblePage = Math.min(currentPage, totalPages);
    const paginatedLeaves = filteredLeaves.slice((visiblePage - 1) * itemsPerPage, visiblePage * itemsPerPage);

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
                breadcrumbs={['Admin', 'Time Off', activeTab === 'sil-policy' ? 'Statutory SIL Policy' : activeTab === 'cashouts' ? 'SIL Cash-Outs' : 'Leave Approvals']}
                actions={
                    activeTab === 'requests' ? (
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Requires review:</span>
                            <span className="font-mono text-sm font-bold text-warning-ink tabular-nums">{counts.Pending}</span>
                        </div>
                    ) : activeTab === 'cashouts' ? (
                        <div className="flex items-center gap-3">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Queue:</span>
                            <span className="font-mono text-sm font-bold text-slate-800 tabular-nums">{cashQueue.data?.count || 0}</span>
                        </div>
                    ) : null
                }
            />

            <div className="space-y-5 sm:space-y-6">


                {/* Tab Content: Statutory SIL Policy */}
                {activeTab === 'sil-policy' && (
                    <SilSettings />
                )}

                {/* Tab Content: SIL Cash-Out Queue */}
                {activeTab === 'cashouts' && (
                    <div className="space-y-4">
                        {cashQueue.isError && <p role="alert" className="text-xs text-danger-ink bg-danger-subtle p-3 rounded-md border border-danger/20">{cashQueue.error.message}</p>}
                        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800">SIL Cash-Out Queue</h3>
                                </div>
                            </div>

                            <form
                                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-100 text-xs items-end"
                                onSubmit={event => { event.preventDefault(); setCashFilters(cashDraft); setCashPage(1); }}
                            >
                                <div>
                                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Last Name</label>
                                    <input
                                        type="search"
                                        maxLength="80"
                                        placeholder="Search by last name..."
                                        className="w-full h-8 bg-white border border-slate-200 rounded-md px-2.5 text-xs text-slate-800 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                                        value={cashDraft.name}
                                        onChange={event => setCashDraft(previous => ({ ...previous, name: event.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Status</label>
                                    <select
                                        className="w-full h-8 bg-white border border-slate-200 rounded-md px-2.5 text-xs text-slate-800 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                                        value={cashDraft.status}
                                        onChange={event => setCashDraft(previous => ({ ...previous, status: event.target.value }))}
                                    >
                                        <option value="open">Open requests</option>
                                        <option value="all">All requests</option>
                                        {Object.entries(CASH_OUT_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-medium text-slate-700 mb-1">From</label>
                                    <input
                                        type="date"
                                        className="w-full h-8 bg-white border border-slate-200 rounded-md px-2.5 text-xs text-slate-800 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                                        value={cashDraft.from}
                                        onChange={event => setCashDraft(previous => ({ ...previous, from: event.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-medium text-slate-700 mb-1">To</label>
                                    <input
                                        type="date"
                                        className="w-full h-8 bg-white border border-slate-200 rounded-md px-2.5 text-xs text-slate-800 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                                        value={cashDraft.to}
                                        onChange={event => setCashDraft(previous => ({ ...previous, to: event.target.value }))}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="submit"
                                        className="h-8 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-2xs transition-colors flex-1"
                                    >
                                        Filter
                                    </button>
                                    {(cashDraft.name || cashDraft.status !== 'open' || cashDraft.from || cashDraft.to) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const reset = { name: '', status: 'open', from: '', to: '' };
                                                setCashDraft(reset);
                                                setCashFilters(reset);
                                                setCashPage(1);
                                            }}
                                            className="h-8 px-2.5 text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md transition-colors"
                                            title="Reset filters"
                                        >
                                            <i className="ti ti-rotate text-sm" />
                                        </button>
                                    )}
                                </div>
                            </form>
                        </div>

                        {/* Requests Table */}
                        <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                            {cashQueue.isPending ? (
                                <div className="py-12 text-center text-xs text-slate-400 font-medium">Loading cash-out queue...</div>
                            ) : (!cashQueue.data?.data || cashQueue.data.data.length === 0) ? (
                                <div className="py-12 text-center text-slate-400">
                                    <i className="ti ti-inbox text-3xl text-slate-300 mb-2 inline-block" />
                                    <p className="text-sm font-bold text-slate-700">No cash-out requests found</p>
                                    <p className="text-xs text-slate-500 mt-0.5">There are no requests matching the current status and date filters.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-100 bg-slate-50/60 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                                <th className="py-3 px-4">Employee</th>
                                                <th className="py-3 px-4">Requested Days</th>
                                                <th className="py-3 px-4">Status</th>
                                                <th className="py-3 px-4">Filed Date</th>
                                                <th className="py-3 px-4 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {cashQueue.data.data.map(item => (
                                                <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                                                    <td className="py-3 px-4 font-semibold text-slate-800">
                                                        {item.employees?.first_name} {item.employees?.last_name}
                                                        <span className="block text-[10px] font-normal text-slate-400">
                                                            {item.employees?.department || 'General'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 font-semibold text-slate-700">
                                                        {Number(item.days)} days
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                            item.status === 'requested'
                                                                ? 'bg-warning-subtle text-warning-ink border border-warning/20'
                                                                : item.status === 'approved' || item.status === 'queued_for_payroll'
                                                                ? 'bg-success-subtle text-success-ink border border-success/20'
                                                                : item.status === 'rejected' || item.status === 'cancelled'
                                                                ? 'bg-danger-subtle text-danger-ink border border-danger/20'
                                                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                                                        }`}>
                                                            {CASH_OUT_LABELS[item.status] || item.status}
                                                        </span>
                                                        {item.status === 'rejected' && item.review_reason && (
                                                            <div className="mt-1 max-w-[220px]">
                                                                <span className="block text-[11px] text-danger-ink font-medium truncate" title={item.review_reason}>
                                                                    Reason: {item.review_reason}
                                                                </span>
                                                                {item.decided_at && (
                                                                    <span className="block text-[10px] text-slate-400">
                                                                        Rejected {new Date(item.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                                                        {item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <Link
                                                            to={`/admin/employees/${item.employee_id}`}
                                                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover transition-colors"
                                                        >
                                                            <span>{item.status === 'requested' ? 'Review & Decide' : 'View History'}</span>
                                                            <i className="ti ti-chevron-right text-xs" />
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {(cashQueue.data?.count > 10 || cashPage > 1) && (
                                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-xs text-slate-500 font-semibold">
                                    <span>Showing page {cashPage} of {Math.ceil((cashQueue.data?.count || 1) / 10)}</span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            disabled={cashPage === 1 || cashQueue.isFetching}
                                            onClick={() => setCashPage(page => page - 1)}
                                            className="h-8 px-3 rounded-md bg-white border border-slate-200 font-semibold hover:bg-slate-50 disabled:opacity-40 transition-colors shadow-2xs"
                                        >
                                            Previous
                                        </button>
                                        <button
                                            type="button"
                                            disabled={cashPage * 10 >= (cashQueue.data?.count || 0) || cashQueue.isFetching}
                                            onClick={() => setCashPage(page => page + 1)}
                                            className="h-8 px-3 rounded-md bg-white border border-slate-200 font-semibold hover:bg-slate-50 disabled:opacity-40 transition-colors shadow-2xs"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Tab Content: Leave Approvals */}
                {activeTab === 'requests' && (
                    <div className="space-y-4 sm:space-y-5">
                        {leavesError && <p role="alert" className="rounded-md border border-danger/20 bg-danger-subtle p-3 text-sm text-danger-ink">{leavesError.message}</p>}
                        {/* Filter tabs */}
                        <div className="flex bg-white p-1 sm:p-1.5 rounded-lg shadow-2xs border border-slate-200 overflow-x-auto touch-scroll no-scrollbar w-full sm:w-max">
                            <div className="flex gap-1 min-w-max">
                                {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
                                    <button
                                        key={status}
                                        type="button"
                                        aria-pressed={filterStatus === status}
                                        onClick={() => handleFilterChange(status)}
                                        className={`h-8 px-3.5 sm:px-4 rounded-md text-xs font-semibold transition-colors duration-100 whitespace-nowrap flex items-center ${
                                            filterStatus === status 
                                            ? 'bg-accent text-white shadow-2xs' 
                                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                        }`}
                                    >
                                        {status}<span className="ml-2 tabular-nums opacity-75">{counts[status]}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <label className="relative flex-1"><span className="sr-only">Search leave requests</span><i className="ti ti-search pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" /><input type="search" aria-label="Search leave requests" placeholder="Employee, company ID, or leave type" value={search} onChange={event => { setSearch(event.target.value); setCurrentPage(1); }} className="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent" /></label>
                            <label><span className="sr-only">Filter by department</span><select aria-label="Filter by department" value={departmentFilter} onChange={event => { setDepartmentFilter(event.target.value); setCurrentPage(1); }} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm sm:w-48 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"><option value="All">All departments</option>{departments.map(department => <option key={department}>{department}</option>)}</select></label>
                            {(search || departmentFilter !== 'All' || filterStatus !== 'All') && <button type="button" onClick={() => { setSearch(''); setDepartmentFilter('All'); handleFilterChange('All'); }} className="text-xs font-semibold text-accent underline">Clear filters</button>}
                        </div>
                {/* Table container */}
                <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                
                {/* Mobile view */}
                <div className="block md:hidden divide-y divide-slate-100">
                    {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                        const daysCount = leave.scheduled_workdays;

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

                                    {isLeavePending(leave.status) && (
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
                                            {new Date(leave.start_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
                                            <span className="text-slate-300 mx-1">&rarr;</span> 
                                            {new Date(leave.end_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
                                            <span className="ml-1 text-[10px] text-slate-400 font-bold">({daysCount === null || daysCount === undefined ? 'Review required' : `${daysCount} workday(s)`})</span>
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <span className="font-medium text-slate-500">Requested pay</span>
                                        <RequestedPayBadge leave={leave} />
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
                                            disabled={isSubmittingApproval || Boolean(leavesError) || refreshingLeaves}
                                            className="flex-1 h-9 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs flex items-center justify-center gap-1.5 transition-colors duration-100"
                                        >
                                            <i className="ti ti-check text-sm font-bold" /> Review
                                        </button>
                                        <button 
                                            onClick={() => handleOpenApproveModal(leave, 'Rejected')}
                                            disabled={isSubmittingApproval || Boolean(leavesError) || refreshingLeaves}
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

                                    </div>
                                )}
                            </div>
                        );
                    }) : (
                        <div className="p-8 text-center text-slate-400">
                            <p className="text-xs font-bold">{emptyMessage}</p>
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
                                <th scope="col" className="px-6 lg:px-8 py-4 text-center">Requested pay</th>
                                <th className="px-6 lg:px-8 py-4 text-center">Status</th>
                                <th className="px-6 lg:px-8 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {paginatedLeaves.length > 0 ? paginatedLeaves.map((leave) => {
                                const daysCount = leave.scheduled_workdays;
                                
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
                                                    {new Date(leave.start_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}
                                                    <span className="text-slate-300 mx-1">&rarr;</span> 
                                                    {new Date(leave.end_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}
                                                </span>
                                                <span className="px-2 py-0.5 mt-1 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest w-max border border-slate-200">
                                                    {daysCount === null || daysCount === undefined ? 'Review required' : `${daysCount} workday(s)`}
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
                                            <RequestedPayBadge leave={leave} />
                                        </td>
                                        <td className="px-6 lg:px-8 py-4 text-center">
                                            {isLeavePending(leave.status) && (
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
                                            disabled={isSubmittingApproval || Boolean(leavesError) || refreshingLeaves}
                                                        className="h-8 w-8 flex items-center justify-center bg-accent-subtle border border-accent/20 text-accent rounded-md hover:bg-accent hover:text-white transition-colors duration-100 shadow-2xs" 
                                                        aria-label={`Review leave request for ${leave.employees?.first_name || 'employee'}`}
                                                        title="Review request and SIL eligibility"
                                                    >
                                                        <i className="ti ti-check text-sm font-bold" />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleOpenApproveModal(leave, 'Rejected')}
                                            disabled={isSubmittingApproval || Boolean(leavesError) || refreshingLeaves}
                                                        className="h-8 w-8 flex items-center justify-center bg-danger-subtle border border-danger/20 text-danger-ink rounded-md hover:bg-danger hover:text-white transition-colors duration-100 shadow-2xs" 
                                                        aria-label={`Review rejection for ${leave.employees?.first_name || 'employee'}`}
                                                        title="Review rejection"
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
                                    <td colSpan="6" className="px-8 py-20 text-center">
                                        <div className="flex flex-col items-center justify-center text-slate-400">
                                            <div className="w-16 h-16 bg-slate-50 rounded-lg flex items-center justify-center mb-3 border border-slate-200">
                                                <i className="ti ti-inbox text-3xl text-slate-400" />
                                            </div>
                                            <p className="text-base font-bold text-slate-800 tracking-tight">{emptyMessage}</p>
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
                            <span>Showing <span className="text-slate-800 font-semibold">{(visiblePage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-semibold">{Math.min(visiblePage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-semibold">{totalItems}</span></span>
                        ) : (
                            <span>Showing <span className="text-slate-800 font-semibold">0</span> of <span className="text-slate-800 font-semibold">0</span></span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setCurrentPage(Math.max(visiblePage - 1, 1))}
                            disabled={visiblePage === 1}
                            className="h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                        >
                            <i className="ti ti-chevron-left text-sm" /> Prev
                        </button>
                        
                        <span className="h-8 px-3 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-800 font-semibold text-xs">
                            {visiblePage} / {totalPages}
                        </span>

                        <button 
                            onClick={() => setCurrentPage(Math.min(visiblePage + 1, totalPages))}
                            disabled={visiblePage >= totalPages}
                            className="h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                        >
                            Next <i className="ti ti-chevron-right text-sm" />
                        </button>
                    </div>
                </div>
            </div>
            </div>
        )}
        </div>

            {/* Leave Approval Modal */}
            {approvalModalLeave && (
                <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4">
                    <div ref={reviewDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="leave-approval-title" className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg max-h-[90dvh] overflow-y-auto">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-md bg-accent-subtle text-accent flex items-center justify-center border border-accent/20 shrink-0">
                                    <i className="ti ti-calendar-check text-lg" />
                                </div>
                                <div>
                                    <h3 id="leave-approval-title" className="text-base font-bold text-slate-800">{reviewAction === 'Approved' ? 'Approve Leave Request' : 'Reject Leave Request'}</h3>
                                </div>
                            </div>
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
                                        {reviewDays ?? '--'} workday(s)
                                    </span>
                                </div>

                                <div className="text-xs text-slate-600 flex items-center justify-between border-t border-slate-200/60 pt-2 font-medium">
                                    <span>Duration:</span>
                                    <span className="font-bold text-slate-800">
                                        {new Date(approvalModalLeave.start_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })} &rarr; {new Date(approvalModalLeave.end_date).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                </div>
                                {approvalModalLeave.notes && (
                                    <p className="text-xs text-slate-500 italic bg-white p-2.5 rounded-md border border-slate-200">
                                        "{approvalModalLeave.notes}"
                                    </p>
                                )}
                            </div>

                            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm"><p className="mb-1 text-xs font-semibold text-slate-500">Reason for request</p><p className="whitespace-pre-wrap break-words text-slate-700">{approvalModalLeave.notes || 'No reason provided.'}</p></div>
                            {reviewAction === 'Rejected' && <p className="rounded-md bg-danger-subtle p-3 text-sm text-danger-ink">Rejecting closes this request. The employee can submit revised dates or payment terms. Rejection does not deduct leave credits.</p>}
                            {approvalModalLeave.requested_pay_type && <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-700">Employee requested {approvalModalLeave.requested_pay_type === 'with_pay' ? `paid SIL leave (${approvalModalLeave.requested_credit_days} workdays at filing)` : 'unpaid leave'}. Approve these terms after review, or reject for revision. Current work dates and credits are rechecked on approval.</p>}
                            {/* Compensation Choices */}
                            {reviewAction === 'Approved' && !approvalModalLeave.requested_pay_type && <div className="space-y-2.5">
                                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                                    {isCreditLeaveType(approvalModalLeave.type) ? 'Confirm payment' : "Review this benefit's payment entitlement"}
                                </label>

                                {/* With Pay */}
                                <label 
                                    onClick={() => { if (!isSubmittingApproval && !approvalModalLeave.requested_pay_type) setLegacyPayType('with_pay'); }}
                                    className={`p-3.5 rounded-md border flex items-start gap-3.5 cursor-pointer transition-colors duration-100 ${
                                        approvalPayType === 'with_pay' 
                                            ? 'border-accent/20 bg-accent-subtle shadow-2xs' 
                                             : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <input 
                                        type="radio" 
                                        name="pay_type"
                                        disabled={isSubmittingApproval || Boolean(approvalModalLeave.requested_pay_type)}
                                        checked={approvalPayType === 'with_pay'} 
                                        onChange={() => setLegacyPayType('with_pay')}
                                        className="mt-1 text-accent focus:ring-accent/20" 
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-800">Paid leave</span>
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-success-subtle text-success-ink">
                                                Full pay
                                            </span>
                                        </div>
                                    </div>
                                </label>

                                {/* Without Pay */}
                                <label 
                                    onClick={() => { if (!isSubmittingApproval && !approvalModalLeave.requested_pay_type) setLegacyPayType('without_pay'); }}
                                    className={`p-3.5 rounded-md border flex items-start gap-3.5 cursor-pointer transition-colors duration-100 ${
                                        approvalPayType === 'without_pay' 
                                            ? 'border-warning bg-warning-subtle/50 shadow-2xs' 
                                            : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <input 
                                        type="radio" 
                                        name="pay_type"
                                        disabled={isSubmittingApproval || Boolean(approvalModalLeave.requested_pay_type)}
                                        checked={approvalPayType === 'without_pay'} 
                                        onChange={() => setLegacyPayType('without_pay')}
                                        className="mt-1 text-warning-ink focus:ring-warning" 
                                    />
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-800">Unpaid leave</span>
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-warning-subtle text-warning-ink">
                                                Unpaid
                                            </span>
                                        </div>
                                    </div>
                                </label>
                            </div>}
                        </div>

                        {reviewAction === 'Approved' && approvalPayType === 'with_pay' && <div className="px-5 pb-5 space-y-3">
                            {usesCredits && <div className="space-y-2 text-xs">
                                {!creditBlocked && <p className="font-medium text-slate-700">{preview.data.days} full workday(s) deducted from SIL; balance after approval: {Number(credits.data.sil_balance) - preview.data.days} days.</p>}
                                {creditBlocked && <p role="alert" className="text-danger-ink">{approvalBlock}</p>}
                                {!credits.data?.account && !credits.isLoading && <Link className="font-semibold text-accent underline" to={`/admin/employees/${approvalModalLeave.employee_id}`}>Review employee eligibility and opening balances</Link>}
                            </div>}
                            {!usesCredits && <p className="text-xs text-slate-500">{approvalPayType === 'with_pay' ? 'Use this source only for a separate HR-confirmed existing benefit. Its existing pay calculation is preserved; no SIL credits are deducted.' : 'Unpaid leave does not deduct SIL credits.'}</p>}
                            {!isCreditLeaveType(approvalModalLeave.type) && <p className="text-xs text-slate-500">This leave type has its own benefit rules and is not charged to SIL credits.</p>}
                            {credits.isError && <p className="text-xs text-slate-500">{credits.error.message}</p>}
                        </div>}

                        {decisionError && <p role="alert" className="px-5 pb-3 text-sm text-danger-ink">{decisionError}</p>}
                        {!usesCredits && approvalBlock && <p role="alert" className="px-5 pb-3 text-xs text-danger-ink">{approvalBlock}</p>}
                        {/* Footer */}
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
                            <button
                                type="button"
                                onClick={() => { if (!submitting.current) setApprovalModalLeave(null); }}
                                disabled={isSubmittingApproval}
                                className="h-9 px-4 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors duration-100 border border-slate-200 bg-white cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={reviewAction === 'Approved' ? handleConfirmApproval : () => handleStatusChange(approvalModalLeave.id, 'Rejected')}
                                disabled={isSubmittingApproval || creditBlocked}
                                className={`h-9 px-4 rounded-md text-xs font-semibold text-white shadow-2xs transition-colors duration-100 flex items-center gap-2 cursor-pointer ${
                                    reviewAction === 'Rejected' ? 'bg-danger text-white hover:opacity-90' : approvalPayType === 'with_pay'
                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
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
                                        {reviewAction === 'Rejected' ? 'Confirm rejection' : `Confirm Approval (${approvalPayType === 'with_pay' ? 'With Pay' : 'Without Pay'})`}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            

        </div>
    );
}
