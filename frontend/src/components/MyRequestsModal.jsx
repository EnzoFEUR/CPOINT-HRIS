import { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { CASH_OUT_LABELS } from '../../../shared/leavePolicy.js';
import Badge from './ui/Badge';
import { useCurrentTime } from '../utils/useCurrentTime';

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
    const now = useCurrentTime();
    const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'leave' | 'cashout'
    const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'approved' | 'rejected'
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!open) return;
        const onKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    useEffect(() => {
        if (open) dialogRef.current?.focus();
    }, [open]);

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
            const matchingEvent = (Array.isArray(cashEvents) ? cashEvents : []).find(
                e => e.request_id === c.id && e.action === 'rejected'
            );
            const decidedDate = c.decided_at || matchingEvent?.created_at || null;
            const cooldownExpiry =
                c.status === 'rejected' && decidedDate
                    ? new Date(new Date(decidedDate).getTime() + 24 * 60 * 60 * 1000)
                    : null;
            const cooldownActive = Boolean(cooldownExpiry && cooldownExpiry.getTime() > now);

            return {
                id: `cash-${c.id}`,
                rawId: c.id,
                category: 'cashout',
                type: 'Service Incentive Leave Cash-Out',
                date: c.created_at,
                status: CASH_OUT_LABELS[c.status] || c.status,
                normalizedStatus:
                    c.status === 'rejected'
                        ? 'rejected'
                        : ['approved', 'queued_for_payroll'].includes(c.status)
                        ? 'approved'
                        : 'pending',
                days: c.days,
                reason: c.review_reason || matchingEvent?.payload?.reason || '',
                rejectionReason:
                    c.status === 'rejected'
                        ? c.review_reason || matchingEvent?.payload?.reason || 'No specific reason recorded.'
                        : null,
                decidedAt: decidedDate,
                cooldownActive,
                cooldownExpiry,
                raw: c,
            };
        });

        return [...leaveRecords, ...cashRecords].sort(
            (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
        );
    }, [leaves, cashRequests, cashEvents, now]);

    const counts = useMemo(() => {
        const total = unifiedRequests.length;
        const pending = unifiedRequests.filter(r => r.normalizedStatus === 'pending').length;
        const approved = unifiedRequests.filter(r => r.normalizedStatus === 'approved').length;
        const rejected = unifiedRequests.filter(r => r.normalizedStatus === 'rejected').length;
        const leavesCount = unifiedRequests.filter(r => r.category === 'leave').length;
        const cashCount = unifiedRequests.filter(r => r.category === 'cashout').length;
        return { total, pending, approved, rejected, leavesCount, cashCount };
    }, [unifiedRequests]);

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

    useEffect(() => {
        if (!open) return;
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [open]);

    const getRequestBadgeVariant = (normalizedStatus, rawStatus) => {
        const s = String(rawStatus || '').toLowerCase();
        if (s.includes('cancel')) return 'cancelled';
        if (normalizedStatus === 'approved') return 'approved';
        if (normalizedStatus === 'rejected') return 'rejected';
        return 'pending';
    };

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
            <div
                className="fixed inset-0 w-screen h-screen min-h-[100dvh] bg-slate-900/50 backdrop-blur-xs transition-opacity"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="my-requests-title"
                tabIndex={-1}
                className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden focus:outline-none my-auto"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-white">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                            <i className="ti ti-clipboard-list text-lg" />
                        </div>
                        <div>
                            <h2 id="my-requests-title" className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                                My Applications &amp; Requests
                            </h2>
                            <p className="text-xs text-slate-500">Track and review submitted leaves and cash-out requests</p>
                        </div>
                    </div>
                </div>

                <Link to="/employee/employment-exit" onClick={onClose} className="px-5 py-3 text-sm font-semibold text-accent underline border-b border-slate-100">Retirement inquiries, resignation notices and exit receipts</Link>
                {/* Filter Controls & Interactive Metrics */}
                <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3.5 bg-slate-50/50">
                    {/* Clickable Status Metric Tabs */}
                    <div className="grid grid-cols-4 gap-2 text-center select-none">
                        {[
                            { key: 'all', label: 'Total', count: counts.total },
                            { key: 'pending', label: 'Pending', count: counts.pending },
                            { key: 'approved', label: 'Approved', count: counts.approved },
                            { key: 'rejected', label: 'Rejected', count: counts.rejected },
                        ].map(stat => {
                            const active = statusFilter === stat.key;
                            return (
                                <button
                                    key={stat.key}
                                    type="button"
                                    onClick={() => setStatusFilter(stat.key)}
                                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                                        active
                                            ? 'bg-white border-slate-300 shadow-xs ring-1 ring-slate-300'
                                            : 'bg-white/70 border-slate-200 hover:bg-white text-slate-600'
                                    }`}
                                >
                                    <span
                                        className={`block text-base sm:text-lg font-bold tabular-nums ${
                                            active ? 'text-slate-900' : 'text-slate-700'
                                        }`}
                                    >
                                        {stat.count}
                                    </span>
                                    <span className="block text-[11px] font-semibold text-slate-500">
                                        {stat.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Category Filter & Search Input */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-xs font-semibold">
                            {[
                                { key: 'all', label: `All (${counts.total})` },
                                { key: 'leave', label: `Leaves (${counts.leavesCount})` },
                                { key: 'cashout', label: `Encashments (${counts.cashCount})` },
                            ].map(tab => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => setCategoryFilter(tab.key)}
                                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                                        categoryFilter === tab.key
                                            ? 'bg-white text-slate-900 shadow-2xs font-bold'
                                            : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="relative flex-1 sm:max-w-xs">
                            <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                            <input maxLength={200}
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search requests..."
                                className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-200 rounded-md text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition-colors"
                            />
                        </div>
                    </div>
                </div>

                {/* Scrollable Records List */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-white">
                    {filteredRequests.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 space-y-2">
                            <i className="ti ti-inbox text-3xl block text-slate-300" />
                            <p className="text-sm font-semibold text-slate-600">No requests match your filters</p>
                            <p className="text-xs text-slate-400">
                                {unifiedRequests.length === 0
                                    ? 'You have not submitted any leave requests or encashments yet.'
                                    : 'Try selecting a different filter or clearing your search.'}
                            </p>
                        </div>
                    ) : (
                        filteredRequests.map(item => {
                            const isLeave = item.category === 'leave';
                            const isRejected = item.normalizedStatus === 'rejected';
                            const isApproved = item.normalizedStatus === 'approved';

                            return (
                                <div
                                    key={item.id}
                                    className="min-w-0 p-4 rounded-lg border border-slate-200 bg-white space-y-2.5 hover:border-slate-300 transition-colors"
                                >
                                    {/* Card Header */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-semibold text-slate-900 text-sm">
                                                    {item.type}
                                                </h3>
                                            </div>

                                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                                <span>Filed {formatDate(item.date)}</span>
                                                <span className="text-slate-300">/</span>
                                                <span className="font-medium text-slate-700">
                                                    {isLeave
                                                        ? `${item.workdays} ${Number(item.workdays) === 1 ? 'workday' : 'workdays'}`
                                                        : `${item.days} ${Number(item.days) === 1 ? 'SIL day' : 'SIL days'}`}
                                                </span>
                                                {isLeave && item.payType && (
                                                    <>
                                                        <span className="text-slate-300">/</span>
                                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                                            item.payType === 'with_pay'
                                                                ? 'bg-surface-muted text-ink border-line'
                                                                : 'bg-slate-100 text-slate-700 border-slate-200'
                                                        }`}>
                                                            {item.payType === 'with_pay' ? 'With Pay' : 'Without Pay'}
                                                        </span>
                                                    </>
                                                )}
                                                {isLeave && item.startDate && (
                                                    <>
                                                        <span className="text-slate-300">/</span>
                                                        <span>
                                                            {formatDate(item.startDate)} &ndash; {formatDate(item.endDate)}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Design System Status Badge (Clean, No Dots) */}
                                        <Badge
                                            variant={getRequestBadgeVariant(item.normalizedStatus, item.status)}
                                            size="sm"
                                            className="shrink-0"
                                        >
                                            {item.status}
                                        </Badge>
                                    </div>

                                    {/* Employee Application Reason */}
                                    {isLeave && item.reason && (
                                        <div className="min-w-0 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100">
                                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-0.5">
                                                Reason for Application
                                            </span>
                                            <p className="min-w-0 break-words [overflow-wrap:anywhere] text-slate-800 whitespace-pre-wrap">{item.reason}</p>
                                        </div>
                                    )}

                                    {/* Clean Rejection Notice (System Danger Tokens) */}
                                    {isRejected && (
                                        <div className="p-3 rounded-md bg-danger-subtle border border-danger/20 text-xs space-y-1.5">
                                            <div className="flex items-center justify-between gap-2 text-danger-ink font-semibold text-[11px]">
                                                <span className="flex items-center gap-1.5">
                                                    <i className="ti ti-alert-circle text-danger text-xs" />
                                                    <span>Reason for Rejection</span>
                                                </span>
                                                {item.decidedAt && (
                                                    <span className="font-normal text-[11px] text-danger-ink/80">
                                                        Decided on {formatDateTime(item.decidedAt)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-danger-ink font-medium whitespace-pre-wrap break-words leading-relaxed pl-4">
                                                {item.rejectionReason || 'No specific remarks recorded.'}
                                            </p>
                                            {!isLeave && (
                                                <div className="text-[11px] text-danger-ink pl-4 pt-0.5">
                                                    {item.days} requested {Number(item.days) === 1 ? 'day has' : 'days have'} been restored to your leave balance.
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Approved Details (System Success Tokens) */}
                                    {isApproved && (
                                        <div className="p-2.5 rounded-md bg-success-subtle/30 border border-success/20 text-xs text-slate-700 flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-1.5 text-slate-800">
                                                <i className="ti ti-check text-success font-bold" />
                                                <span>
                                                    {isLeave
                                                        ? `Approved (${item.payType === 'with_pay' ? 'With Pay' : 'Without Pay'}). Credited to attendance.`
                                                        : 'Approved and scheduled for payroll disbursement.'}
                                                </span>
                                            </span>
                                            {item.decidedAt && (
                                                <span className="text-[11px] text-slate-400 shrink-0">
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

                {/* Footer */}
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
                                className="h-8 px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
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
        </div>,
        document.body
    );
}
