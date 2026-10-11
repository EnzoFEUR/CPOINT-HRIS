import { useState, useMemo, useEffect, useRef } from 'react';
import { CASH_OUT_LABELS } from '../../../shared/leavePolicy.js';

const formatDate = value => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDateTime = value => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

export default function MyRequestsModal({
    open,
    onClose,
    leaves = [],
    cashRequests = [],
    cashEvents = [],
    onRequestNewLeave,
}) {
    const dialogRef = useRef(null);
    const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'leaves' | 'cashout'
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'approved' | 'rejected'
    const [searchQuery, setSearchQuery] = useState('');

    // Keyboard escape listener
    useEffect(() => {
        if (!open) return;
        const onKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    // Focus lock
    useEffect(() => {
        if (open) dialogRef.current?.focus();
    }, [open]);

    // Unified normalized records
    const unifiedRequests = useMemo(() => {
        const leaveRecords = (Array.isArray(leaves) ? leaves : []).map(l => ({
            id: `leave-${l.id}`,
            rawId: l.id,
            category: 'leave',
            type: l.type || 'Leave Application',
            date: l.created_at || l.start_date,
            status: l.status || 'Pending',
            normalizedStatus: String(l.status || '').toLowerCase().includes('reject')
                ? 'rejected'
                : String(l.status || '').toLowerCase().includes('approv')
                ? 'approved'
                : 'pending',
            startDate: l.start_date,
            endDate: l.end_date,
            workdays: l.scheduled_workdays || l.days || 1,
            payType: l.pay_type || l.requested_pay_type,
            reason: l.reason || '',
            rejectionReason: l.rejection_reason || l.review_notes || null,
            decidedAt: l.reviewed_at || l.decided_at || null,
            raw: l,
        }));

        const cashRecords = (Array.isArray(cashRequests) ? cashRequests : []).map(c => {
            const matchingEvent = (Array.isArray(cashEvents) ? cashEvents : []).find(e => e.request_id === c.id && e.action === 'rejected');
            const decidedDate = c.decided_at || matchingEvent?.created_at || null;
            const cooldownExpiry = (c.status === 'rejected' && decidedDate) ? new Date(new Date(decidedDate).getTime() + 24 * 60 * 60 * 1000) : null;
            const cooldownActive = Boolean(cooldownExpiry && cooldownExpiry.getTime() > Date.now());

            return {
                id: `cash-${c.id}`,
                rawId: c.id,
                category: 'cashout',
                type: 'Service Incentive Leave Cash-Out',
                date: c.created_at,
                status: CASH_OUT_LABELS[c.status] || c.status,
                normalizedStatus: c.status === 'rejected'
                    ? 'rejected'
                    : ['approved', 'queued_for_payroll'].includes(c.status)
                    ? 'approved'
                    : 'pending',
                days: c.days,
                reason: c.review_reason || matchingEvent?.payload?.reason || '',
                rejectionReason: c.status === 'rejected' ? (c.review_reason || matchingEvent?.payload?.reason || 'No specific reason recorded.') : null,
                decidedAt: decidedDate,
                cooldownActive,
                cooldownExpiry,
                raw: c,
            };
        });

        return [...leaveRecords, ...cashRecords].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    }, [leaves, cashRequests, cashEvents]);

    // Metric counts
    const counts = useMemo(() => {
        const total = unifiedRequests.length;
        const pending = unifiedRequests.filter(r => r.normalizedStatus === 'pending').length;
        const approved = unifiedRequests.filter(r => r.normalizedStatus === 'approved').length;
        const rejected = unifiedRequests.filter(r => r.normalizedStatus === 'rejected').length;
        const leavesCount = unifiedRequests.filter(r => r.category === 'leave').length;
        const cashCount = unifiedRequests.filter(r => r.category === 'cashout').length;
        return { total, pending, approved, rejected, leavesCount, cashCount };
    }, [unifiedRequests]);

    // Filtered results
    const filteredRequests = useMemo(() => {
        return unifiedRequests.filter(item => {
            if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
            if (statusFilter !== 'all' && item.normalizedStatus !== statusFilter) return false;
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchType = item.type.toLowerCase().includes(q);
                const matchReason = (item.reason || '').toLowerCase().includes(q);
                const matchRejection = (item.rejectionReason || '').toLowerCase().includes(q);
                const matchStatus = item.status.toLowerCase().includes(q);
                if (!matchType && !matchReason && !matchRejection && !matchStatus) return false;
            }
            return true;
        });
    }, [unifiedRequests, categoryFilter, statusFilter, searchQuery]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5">
            <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity" onClick={onClose} aria-hidden="true" />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="my-requests-title"
                tabIndex={-1}
                className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden focus:outline-none"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-2xs">
                            <i className="ti ti-clipboard-list text-lg" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 id="my-requests-title" className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                    My Applications &amp; Requests
                                </h2>

                            </div>
                        </div>
                    </div>
                </div>

                {/* Filter Controls & Counters */}
                <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3 bg-white">
                    {/* Metrics Bar */}
                    <div className="grid grid-cols-4 gap-2 text-center select-none">
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <span className="block text-base sm:text-lg font-black text-slate-900 font-mono tabular-nums">{counts.total}</span>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Total</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 text-white border border-slate-800 shadow-2xs">
                            <span className="block text-base sm:text-lg font-black text-white font-mono tabular-nums">{counts.pending}</span>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-300">Pending</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <span className="block text-base sm:text-lg font-black text-slate-900 font-mono tabular-nums">{counts.approved}</span>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Approved</span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                            <span className="block text-base sm:text-lg font-black text-slate-900 font-mono tabular-nums">{counts.rejected}</span>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Rejected</span>
                        </div>
                    </div>

                    {/* Filter Bar: Category Tabs & Search */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                        {/* Category Segmented Tabs */}
                        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
                            <button
                                type="button"
                                onClick={() => setCategoryFilter('all')}
                                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                    categoryFilter === 'all'
                                        ? 'bg-white text-slate-900 shadow-2xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                All ({counts.total})
                            </button>
                            <button
                                type="button"
                                onClick={() => setCategoryFilter('leave')}
                                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                    categoryFilter === 'leave'
                                        ? 'bg-white text-slate-900 shadow-2xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Leaves ({counts.leavesCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setCategoryFilter('cashout')}
                                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                    categoryFilter === 'cashout'
                                        ? 'bg-white text-slate-900 shadow-2xs'
                                        : 'text-slate-600 hover:text-slate-900'
                                }`}
                            >
                                Encashments ({counts.cashCount})
                            </button>
                        </div>

                        {/* Status Pills */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {[
                                { key: 'all', label: 'All' },
                                { key: 'pending', label: 'Pending' },
                                { key: 'approved', label: 'Approved' },
                                { key: 'rejected', label: 'Rejected' },
                            ].map(item => (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => setStatusFilter(item.key)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                                        statusFilter === item.key
                                            ? 'bg-slate-900 text-white shadow-2xs'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Search Input */}
                    <div className="relative">
                        <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search by reason, leave type, or status remarks..."
                            className="w-full h-8 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 placeholder-slate-400 focus:outline-none focus:border-accent focus:bg-white transition-colors"
                        />
                    </div>
                </div>

                {/* Scrollable Records List */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
                    {filteredRequests.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 space-y-2">
                            <i className="ti ti-inbox text-3xl block text-slate-300" />
                            <p className="text-sm font-semibold text-slate-600">No requests match your filters</p>
                            <p className="text-xs text-slate-400">
                                {unifiedRequests.length === 0
                                    ? 'You have not submitted any leave requests or encashments yet.'
                                    : 'Try selecting a different category or clearing search filters.'}
                            </p>
                        </div>
                    ) : (
                        filteredRequests.map(item => {
                            const isLeave = item.category === 'leave';
                            const isRejected = item.normalizedStatus === 'rejected';
                            const isApproved = item.normalizedStatus === 'approved';
                            const isPending = item.normalizedStatus === 'pending';

                            return (
                                <div
                                    key={item.id}
                                    className="p-3.5 sm:p-4 rounded-lg border border-slate-200 bg-white shadow-2xs space-y-2 hover:border-slate-300 transition-all"
                                >
                                    {/* Card Header */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
                                                    {isLeave ? 'Leave Application' : 'SIL Cash-Out'}
                                                </span>
                                                <h3 className="font-bold text-slate-900 text-sm">
                                                    {item.type}
                                                </h3>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-slate-500 pt-0.5">
                                                <span className="font-mono text-[11px]">{formatDate(item.date)}</span>
                                                <span>&bull;</span>
                                                <span className="font-semibold text-slate-700">
                                                    {isLeave
                                                        ? `${item.workdays} ${Number(item.workdays) === 1 ? 'workday' : 'workdays'}`
                                                        : `${item.days} ${Number(item.days) === 1 ? 'SIL day' : 'SIL days'}`}
                                                </span>
                                                {isLeave && item.startDate && (
                                                    <>
                                                        <span>&bull;</span>
                                                        <span>
                                                            {formatDate(item.startDate)} &ndash; {formatDate(item.endDate)}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Status Badge */}
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                                            isRejected
                                                ? 'bg-slate-800 text-slate-200 border border-slate-700'
                                                : isApproved
                                                ? 'bg-slate-900 text-white border border-slate-800'
                                                : isPending
                                                ? 'bg-slate-100 text-slate-800 border border-slate-300'
                                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                                        }`}>
                                            {item.status}
                                        </span>
                                    </div>

                                    {/* Application Reason (if provided by employee) */}
                                    {isLeave && item.reason && (
                                        <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                                                Application Reason
                                            </span>
                                            <p className="text-slate-800 font-medium whitespace-pre-wrap">{item.reason}</p>
                                        </div>
                                    )}

                                    {/* Rejection Details Callout Box */}
                                    {isRejected && (
                                        <div className="mt-2.5 p-3.5 rounded-lg bg-slate-900 text-white border border-slate-800 space-y-2 text-xs shadow-md">
                                            <div className="flex items-center justify-between gap-2 text-slate-300 font-semibold text-[11px]">
                                                <span className="flex items-center gap-1.5">
                                                    <i className="ti ti-alert-circle text-rose-400 text-xs" />
                                                    <span className="font-bold uppercase tracking-wider">Official Reason for Rejection</span>
                                                </span>
                                                {item.decidedAt && (
                                                    <span className="font-normal text-[10px] text-slate-400 font-mono">
                                                        Decided on {formatDateTime(item.decidedAt)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="p-2.5 bg-slate-800/90 rounded border border-slate-700 text-slate-100 font-medium whitespace-pre-wrap break-words leading-relaxed">
                                                {item.rejectionReason || 'No specific remarks recorded.'}
                                            </p>
                                            {!isLeave && (
                                                <div className="text-[11px] text-slate-300 pt-0.5 space-y-1">
                                                    <p className="flex items-center gap-1.5">
                                                        <i className="ti ti-check text-xs text-emerald-400 font-bold shrink-0" />
                                                        <span>All {item.days} requested days have been restored in full to your available leave balance.</span>
                                                    </p>

                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Approved Details Callout */}
                                    {isApproved && (
                                        <div className="mt-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-1.5 font-medium text-slate-800">
                                                <i className="ti ti-check text-slate-900 font-bold" />
                                                <span>
                                                    {isLeave
                                                        ? `Approved (${item.payType === 'with_pay' ? 'With Pay' : 'Without Pay'}). Credited to employment attendance ledger.`
                                                        : 'Approved by HR and queued for upcoming payroll disbursement.'}
                                                </span>
                                            </span>
                                            {item.decidedAt && (
                                                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                                    {formatDate(item.decidedAt)}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer Controls */}
                <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500 font-medium">
                        Showing {filteredRequests.length} of {unifiedRequests.length} record(s)
                    </span>
                    <div className="flex items-center gap-2">
                        {onRequestNewLeave && (
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    onRequestNewLeave();
                                }}
                                className="h-8 px-3.5 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-md shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                            >
                                <i className="ti ti-plus text-xs" />
                                <span>File Leave Request</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-8 px-3.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded-md shadow-2xs transition-colors cursor-pointer"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
