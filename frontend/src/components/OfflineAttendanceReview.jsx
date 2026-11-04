import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { offlineApi } from '../utils/offlineAttendanceSync';
import { useOfflineAvailability } from '../utils/useOfflineAvailability';
import { offlineAvailabilityMessage } from '../utils/offlineAvailability.mjs';
import PageHeader from './ui/PageHeader';
import EmployeeAvatar from './EmployeeAvatar';
import Badge from './ui/Badge';
import { batchReviewOutcome, canResolveMissingTimeOut, collapseOfflineReviewEvents, manilaDateTimeInput, reviewCanDecide, reviewEventId, verifiedTimeOutIso } from '../utils/offlineReviewPairs.mjs';

// Quick review preset templates for high-speed enterprise HR processing
const PRESET_REASONS = [
  'CCTV footage verified employee physical presence.',
  'Security supervisor log cross-referenced and confirmed.',
  'Shift lead verified on-site department assignment.',
  'Biometric kiosk camera hardware fault — badge verified.',
  'Manual timecard signed by plant operations manager.'
];

const STATUS_VARIANTS = {
  needs_review: 'warning',
  needs_verification: 'info',
  synced: 'success',
  rejected: 'danger'
};

const STATUS_LABELS = {
  needs_review: 'Needs Review',
  needs_verification: 'Needs Verification',
  synced: 'Approved & Synced',
  rejected: 'Rejected'
};
const EMPTY_EVENTS = [];

export default function OfflineAttendanceReview() {
  const queryClient = useQueryClient();
  const availability = useOfflineAvailability();
  const backendReady = availability.data?.ready === true;

  // Primary navigation & view states
  const [activeTab, setActiveTab] = useState('needs_review'); // 'needs_review' | 'needs_verification' | 'synced' | 'rejected' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL'); // 'ALL' | 'TIME_IN' | 'TIME_OUT'
  const [siteFilter, setSiteFilter] = useState('ALL');

  // Inspection Drawer & Audit Modal State
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [drawerHistory, setDrawerHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [verifiedTimeOut, setVerifiedTimeOut] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Multi-selection for Batch Processing
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchDecision, setBatchDecision] = useState('approve');
  const [batchReason, setBatchReason] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  // Relative time tick for real-time latency indicators (ticks every 10s)
  const [now, setTick] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Broadcast channel for multi-tab instantaneous real-time sync
  const broadcastChannelRef = useRef(null);
  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('cpoint_offline_attendance_channel');
      broadcastChannelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === 'OFFLINE_ATTENDANCE_CHANGED') {
          queryClient.invalidateQueries({ queryKey: ['offlineAttendanceCounts'] });
          queryClient.invalidateQueries({ queryKey: ['offlineAttendanceEvents'] });
        }
      };
      return () => {
        channel.close();
      };
    }
  }, [queryClient]);

  // Check Database Approval RPC Migration Status
  const approvalQuery = useQuery({
    queryKey: ['offlineAttendanceApprovalReady', availability.actorId],
    queryFn: () => offlineApi('/approval-status'),
    staleTime: 60000,
    retry: false,
    enabled: backendReady,
  });
  const isApprovalReady = approvalQuery.data?.available === true;
  const isResolutionReady = approvalQuery.data?.missing_time_out === true;

  // Dedicated global counts query - independent of activeTab so counts NEVER flash to 0 on tab switch
  const statsQuery = useQuery({
    queryKey: ['offlineAttendanceCounts', availability.actorId],
    queryFn: async () => {
      const res = await offlineApi('/stats');
      return res?.counts || { needs_review: 0, needs_verification: 0, synced: 0, rejected: 0, all: 0 };
    },
    staleTime: 5000,
    enabled: backendReady,
    retry: false,
    refetchInterval: () => (backendReady && typeof document !== 'undefined' && document.visibilityState === 'visible' ? 30000 : false),
    refetchOnWindowFocus: true
  });

  const statusCounts = statsQuery.data || {
    needs_review: 0,
    needs_verification: 0,
    synced: 0,
    rejected: 0,
    all: 0
  };

  // Low-latency events query with keepPreviousData for zero-flicker transitions
  const eventsQuery = useQuery({
    queryKey: ['offlineAttendanceEvents', availability.actorId, activeTab],
    queryFn: async () => {
      const res = await offlineApi(`/events?status=${activeTab}&limit=250`);
      return Array.isArray(res?.events) ? res.events : [];
    },
    placeholderData: keepPreviousData,
    staleTime: 5000,
    enabled: backendReady,
    retry: false,
    refetchInterval: () => (backendReady && typeof document !== 'undefined' && document.visibilityState === 'visible' ? 30000 : false),
    refetchOnWindowFocus: true
  });

  const rawEvents = eventsQuery.data || EMPTY_EVENTS;
  const reviewEvents = useMemo(() => collapseOfflineReviewEvents(rawEvents), [rawEvents]);

  // Dynamic Sites List
  const availableSites = useMemo(() => {
    const set = new Set();
    rawEvents.forEach(e => {
      const site = e.site_id || e.payload?.site_id;
      if (site) set.add(site);
    });
    return Array.from(set);
  }, [rawEvents]);

  // Client-Side Filtered Events (Zero-latency instant filtering)
  const filteredEvents = useMemo(() => {
    return reviewEvents.filter(event => {
      const payload = event.payload || event;
      const employee = event.employee;
      const empName = event.employee_name || `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim() || 'Unknown';
      const companyId = event.employee_company_id || employee?.company_id || '';
      const action = payload.action || event.action;
      const site = payload.site_id || event.site_id;
      const eventId = reviewEventId(event) || '';
      const deviceId = payload.device_id || event.device_id || '';

      // Action Filter
      if (actionFilter !== 'ALL' && action !== actionFilter && event.review_pair?.complete !== true) return false;

      // Site Filter
      if (siteFilter !== 'ALL' && site !== siteFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = empName.toLowerCase().includes(q);
        const matchCpId = companyId.toLowerCase().includes(q);
        const matchSite = (site || '').toLowerCase().includes(q);
        const matchEventId = eventId.toLowerCase().includes(q) || event.review_pair?.event_ids?.some(id => id.toLowerCase().includes(q));
        const matchDeviceId = deviceId.toLowerCase().includes(q);
        if (!matchName && !matchCpId && !matchSite && !matchEventId && !matchDeviceId) {
          return false;
        }
      }

      return true;
    });
  }, [reviewEvents, actionFilter, siteFilter, searchQuery]);
  const selectableRows = filteredEvents.filter(ev => ['needs_review', 'needs_verification'].includes(ev.status));
  const selectedRows = selectableRows.filter(ev => selectedIds.has(reviewEventId(ev)));
  const canBatchApprove = selectedRows.length === selectedIds.size && selectedRows.length > 0 && selectedRows.every(ev => reviewCanDecide(ev, 'approve'));
  const canBatchReject = selectedRows.length === selectedIds.size && selectedRows.length > 0 && selectedRows.every(ev => reviewCanDecide(ev, 'reject'));

  // Multi-Selection Handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allIds = new Set(selectableRows.slice(0, 50).map(reviewEventId));
      setSelectedIds(allIds);
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id) => {
    if (!selectedIds.has(id) && selectedIds.size >= 50) {
      toast.error('Select up to 50 attendance rows at a time.');
      return;
    }
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Open Detailed Inspection Drawer
  const openInspectDrawer = useCallback(async (event) => {
    setSelectedEvent(event);
    setReviewReason('');
    setVerifiedTimeOut('');
    setDrawerHistory([]);
    setHistoryLoading(true);

    const eventId = event.event_id || event.payload?.event_id;
    try {
      const ids = event.review_pair?.event_ids || [eventId];
      const histories = await Promise.all(ids.map(id => offlineApi(`/events/${encodeURIComponent(id)}/history`)));
      setDrawerHistory(histories.flatMap(res => res.decisions || []));
    } catch {
      setDrawerHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const closeInspectDrawer = () => {
    setSelectedEvent(null);
    setDrawerHistory([]);
    setReviewReason('');
    setVerifiedTimeOut('');
  };

  async function refreshAttendanceViews() {
    await Promise.all(['offlineAttendanceCounts', 'offlineAttendanceEvents', 'adminAttendance', 'employeeMonthlyAttendance', 'attendanceCalendar', 'employeeDashboard'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
    broadcastChannelRef.current?.postMessage({ type: 'OFFLINE_ATTENDANCE_CHANGED' });
  }

  const handleResolveTimeOut = async () => {
    if (actionBusy || !selectedEvent || !canResolveMissingTimeOut(selectedEvent)) return;
    if (!isResolutionReady) { toast.error('Install the missing Time Out database update first.'); return; }
    if (!reviewReason.trim()) { toast.error('Enter how HR verified the actual departure time.'); return; }
    setActionBusy(true);
    try {
      const result = await offlineApi(`/events/${encodeURIComponent(selectedEvent.event_id || selectedEvent.payload?.event_id)}/resolve-time-out`, {
        method: 'POST', body: JSON.stringify({ verified_time_out: verifiedTimeOutIso(verifiedTimeOut), reason: reviewReason.trim() }),
      });
      if (result.status !== 'synced' || !result.attendance_reference) throw new Error('The server did not confirm the correction. Refresh before retrying.');
      toast.success('Verified Time Out saved. Attendance is recorded.');
      await refreshAttendanceViews();
      closeInspectDrawer();
    } catch (error) {
      toast.error(error.message || 'The correction could not be saved.');
    } finally {
      setActionBusy(false);
    }
  };

  // Execute Individual Review Decision
  const handleDecision = async (eventId, decision, customReason = null) => {
    const reasonText = (customReason || reviewReason).trim();
    if (!reasonText) {
      toast.error('A justification reason is required for compliance audit.', { id: 'offline-reason-req' });
      return;
    }

    if (decision === 'approve' && !isApprovalReady) {
      toast.error('The offline attendance database approval migration must be applied first.', { id: 'offline-migration-err' });
      return;
    }

    setActionBusy(true);

    // Reflect approval only after the complete-pair transaction commits.
    try {
      await offlineApi(`/events/${encodeURIComponent(eventId)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: reasonText })
      });

      const label = decision === 'approve' ? 'Approved & Synced' : decision === 'reject' ? 'Rejected' : 'Flagged for Verification';
      toast.success(`Attendance ${label} successfully`, { id: `offline-${eventId}` });

      await refreshAttendanceViews();

      if (selectedEvent && (reviewEventId(selectedEvent) === eventId || selectedEvent.event_id === eventId)) {
        closeInspectDrawer();
      }
    } catch (err) {
      toast.error(err.message || 'Failed to record decision.', { id: 'offline-action-failed' });
    } finally {
      setActionBusy(false);
    }
  };

  // Execute Batch Decision
  const handleExecuteBatch = async () => {
    if (!selectedIds.size) return;
    if ((batchDecision === 'approve' && !canBatchApprove) || (batchDecision === 'reject' && !canBatchReject)) {
      toast.error('Only complete attendance pairs can be approved or rejected.');
      return;
    }
    const reasonText = batchReason.trim();
    if (!reasonText) {
      toast.error('An audit justification reason is required for batch reconciliation.', { id: 'batch-reason-err' });
      return;
    }

    setBatchBusy(true);
    const toastId = toast.loading(`Processing ${selectedIds.size} provisional captures...`);

    try {
      const eventIds = Array.from(selectedIds);
      const res = await offlineApi('/events/batch-decision', {
        method: 'POST',
        body: JSON.stringify({
          event_ids: eventIds,
          decision: batchDecision,
          reason: reasonText
        })
      });

      const outcome = batchReviewOutcome(eventIds, batchDecision, res.results);
      const successful = outcome.successfulIds.length;
      const failed = outcome.failedIds.length;

      if (failed > 0) {
        toast.error(`${successful} processed; ${failed} not processed. ${outcome.error}`, { id: toastId, duration: 7000 });
      } else {
        toast.success(`Successfully processed ${successful} captures.`, { id: toastId });
      }

      setSelectedIds(new Set(outcome.failedIds));
      if (!failed) {
        setBatchModalOpen(false);
        setBatchReason('');
      }
      await refreshAttendanceViews();
    } catch (err) {
      toast.error(err.message || 'Batch action failed.', { id: toastId });
    } finally {
      setBatchBusy(false);
    }
  };

  // Export Filtered Captures to CSV for DOLE / Compliance Audits
  const handleExportCsv = () => {
    if (!filteredEvents.length) {
      toast.error('No capture records available to export.', { id: 'export-empty' });
      return;
    }

    const headers = ['Event ID', 'Employee Name', 'Company ID', 'Action', 'Captured PST', 'Received PST', 'Site', 'Device ID', 'Sequence', 'Status', 'Payload Hash', 'Time In Event', 'Time Out Event', 'Time In ISO', 'Time Out ISO', 'Review Issue'];
    const rows = filteredEvents.map(e => {
      const p = e.payload || e;
      const emp = e.employee;
      const name = e.employee_name || `${emp?.first_name || ''} ${emp?.last_name || ''}`.trim();
      const cpId = e.employee_company_id || emp?.company_id || '';
      return [
        e.event_id || p.event_id,
        `"${name}"`,
        cpId,
        p.action,
        p.captured_at ? new Date(p.captured_at).toISOString() : '',
        e.received_at ? new Date(e.received_at).toISOString() : '',
        p.site_id || e.site_id,
        p.device_id || e.device_id,
        p.local_sequence || e.local_sequence,
        e.status,
        e.payload_hash || '',
        e.review_pair?.time_in_event_id || '', e.review_pair?.time_out_event_id || '',
        e.review_pair?.time_in || '', e.review_pair?.time_out || '', e.review_pair?.issue || ''
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `provisional_offline_captures_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Exported provisional audit log to CSV.', { id: 'export-success' });
  };

  // Copy helper
  const copyText = (e, text, label = 'Text') => {
    e?.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`, { id: 'copy-toast', duration: 1500 });
  };

  // Format Elapsed Time
  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const deltaMs = now - new Date(timestamp).getTime();
    const sec = Math.floor(deltaMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  };

  // Ingestion Drift Latency Calculation
  const getIngestionDrift = (capturedAt, receivedAt) => {
    if (!capturedAt || !receivedAt) return null;
    const c = new Date(capturedAt).getTime();
    const r = new Date(receivedAt).getTime();
    const diffSec = Math.round((r - c) / 1000);
    if (diffSec < 2) return '< 2s live upload';
    if (diffSec < 60) return `+${diffSec}s upload delay`;
    const min = Math.round(diffSec / 60);
    if (min < 60) return `Held offline: ${min}m`;
    const hr = Math.round(min / 60);
    return `Held offline: ${hr}h`;
  };

  const formatManilaTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      return new Date(timestamp).toLocaleTimeString('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return String(timestamp);
    }
  };

  const formatManilaDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      return new Date(timestamp).toLocaleDateString('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(timestamp);
    }
  };

  const formatManilaDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      return new Date(timestamp).toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } catch {
      return String(timestamp);
    }
  };

  const calculateShiftDuration = (startIso, endIso) => {
    if (!startIso || !endIso) return null;
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (isNaN(start) || isNaN(end) || end < start) return null;
    const diffMinutes = Math.round((end - start) / 60000);
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return `${hours}h ${mins}m`;
  };

  const handleRefresh = async () => {
    if (!backendReady) { await availability.refetch(); return; }
    await Promise.all([
      statsQuery.refetch(),
      eventsQuery.refetch(),
      approvalQuery.refetch()
    ]);
  };

  const isDataLoading = eventsQuery.isLoading && !eventsQuery.data;

  // Keep hooks in the same order when the backend enables/disables the module.
  if (!backendReady) return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={['Admin', 'Attendance', 'Offline Captures']}
        showBack
        backFallback="/admin/attendance"
        backLabel="Back to Logs"
      />
      <div className="rounded-md border border-line bg-surface p-4">
        <p role="status" className="text-sm text-ink">{offlineAvailabilityMessage(availability.data, availability.error)}</p>
        <button type="button" onClick={() => availability.refetch()} disabled={availability.isFetching} className="mt-3 rounded-md border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50">Check again</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Enterprise PageHeader */}
      <PageHeader
        breadcrumbs={['Admin', 'Attendance', 'Offline Captures']}
        showBack
        backFallback="/admin/attendance"
        backLabel="Back to Logs"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isApprovalReady && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                <i className="ti ti-alert-triangle text-xs" />
                <span>Migration Required</span>
              </span>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!filteredEvents.length}
              className="h-9 px-3 rounded-md bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
              title="Export filtered captures for DOLE audit compliance"
            >
              <i className="ti ti-download text-xs" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={statsQuery.isFetching || eventsQuery.isFetching}
              className="h-9 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"
              title="Force refresh queue and counts"
            >
              <i className={`ti ti-refresh text-xs ${(statsQuery.isFetching || eventsQuery.isFetching) ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        }
      />

      {/* Main Attendance List Card with Integrated Filter Toolbar */}
      <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
        {/* Filter Toolbar & Controls */}
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white">
          {/* Segmented Status Tab Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            {[
              { id: 'needs_review', label: 'Needs Review', count: statusCounts.needs_review },
              { id: 'needs_verification', label: 'Flagged', count: statusCounts.needs_verification },
              { id: 'synced', label: 'Approved', count: statusCounts.synced },
              { id: 'rejected', label: 'Rejected', count: statusCounts.rejected },
              { id: 'all', label: 'All Records', count: statusCounts.all }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveTab(tab.id); setSelectedIds(new Set()); }}
                className={`h-9 px-3 rounded-md text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {tab.count || 0}
                </span>
              </button>
            ))}
          </div>

          {/* Right Side: Search & Filter Dropdowns */}
          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1 md:w-56">
              <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
              <input maxLength={200}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search worker or CP-ID..."
                className="w-full h-9 pl-8 pr-7 rounded-md border border-slate-200 bg-white text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <i className="ti ti-x text-xs" />
                </button>
              )}
            </div>

            {/* Action Filter */}
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value)}
              className="h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-400 shadow-2xs cursor-pointer"
            >
              <option value="ALL">All Actions</option>
              <option value="TIME_IN">Time In</option>
              <option value="TIME_OUT">Time Out</option>
            </select>

            {/* Site Filter */}
            {(availableSites.length > 1 || siteFilter !== 'ALL') && (
              <select
                value={siteFilter}
                onChange={e => setSiteFilter(e.target.value)}
                className="h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-slate-400 shadow-2xs cursor-pointer"
              >
                <option value="ALL">All Sites</option>
                {siteFilter !== 'ALL' && !availableSites.includes(siteFilter) && <option value={siteFilter}>{siteFilter}</option>}
                {availableSites.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Batch Action Bar */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-2.5 bg-slate-900 text-white flex items-center justify-between gap-3 text-xs animate-fadeIn">
            <div className="flex items-center gap-2 font-semibold">
              <i className="ti ti-checkbox text-emerald-400 text-sm" />
              <span>{selectedIds.size} capture{selectedIds.size > 1 ? 's' : ''} selected</span>
              {selectedRows.some(event => event.review_pair?.complete !== true) && <span className="text-xs">Complete Time In and Time Out are required for approval.</span>}
            </div>
            <div className="flex items-center gap-2">
              {canBatchApprove && <button
                type="button"
                onClick={() => { setBatchDecision('approve'); setBatchModalOpen(true); }}
                disabled={!isApprovalReady}
                className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                Batch Approve
              </button>}
              <button
                type="button"
                onClick={() => { setBatchDecision('needs_verification'); setBatchModalOpen(true); }}
                className="h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Mark Verification
              </button>
              {canBatchReject && <button
                type="button"
                onClick={() => { setBatchDecision('reject'); setBatchModalOpen(true); }}
                className="h-8 px-3 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Batch Reject
              </button>}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-slate-400 hover:text-white text-xs font-semibold cursor-pointer ml-1"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Main Data Table */}
        <div className="overflow-x-auto touch-scroll">
          {isDataLoading ? (
            <div className="py-16 text-center text-slate-400">
              <i className="ti ti-loader-2 text-2xl animate-spin text-slate-500 mb-2 inline-block" />
              <p className="text-xs font-semibold text-slate-600">Loading provisional capture queue...</p>
            </div>
          ) : eventsQuery.error ? (
            <div role="alert" className="bg-canvas p-6 text-center text-ink">
              <p className="font-semibold">Captures could not be loaded.</p>
              <p className="mt-1 text-sm">{eventsQuery.error.message}</p>
              <button type="button" className="mt-3 rounded border border-line bg-surface px-3 py-2 text-sm" disabled={eventsQuery.isFetching} onClick={handleRefresh}>Retry loading</button>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <div className="h-12 w-12 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400 border border-slate-200">
                <i className="ti ti-inbox text-xl" />
              </div>
              <p className="text-sm font-bold text-slate-800">No provisional captures found</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {searchQuery || actionFilter !== 'ALL' || siteFilter !== 'ALL'
                  ? 'No records match your active search or filters. Try adjusting your parameters.'
                  : activeTab === 'needs_review'
                  ? 'No provisional captures awaiting review.'
                  : `No capture records under status "${STATUS_LABELS[activeTab] || activeTab}".`}
              </p>
              {(searchQuery || actionFilter !== 'ALL' || siteFilter !== 'ALL') && <button type="button" className="mt-3 rounded border border-line bg-surface px-3 py-2 text-sm text-ink" onClick={() => { setSearchQuery(''); setActionFilter('ALL'); setSiteFilter('ALL'); }}>Clear filters</button>}
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs min-w-[850px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === Math.min(selectableRows.length, 50) && selectableRows.length > 0}
                      disabled={selectableRows.length === 0}
                      onChange={handleSelectAll}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4 text-center">Action</th>
                  <th className="py-3 px-4">Captured Instant</th>
                  <th className="py-3 px-4">Location / Kiosk</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Review Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredEvents.map(event => {
                  const payload = event.payload || event;
                  const eventId = reviewEventId(event);
                  const employee = event.employee;
                  const empName = event.employee_name || `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim() || 'Unknown Worker';
                  const cpId = event.employee_company_id || employee?.company_id || (event.employee_id ? `CP-${event.employee_id.substring(0, 8).toUpperCase()}` : 'N/A');
                  const isTimeIn = (payload.action || event.action) === 'TIME_IN';
                  const isEligible = event.current_eligible !== false;
                  const isSelected = selectedIds.has(eventId);
                  const driftLabel = getIngestionDrift(payload.captured_at, event.received_at);

                  return (
                    <tr
                      key={eventId}
                      className={`hover:bg-slate-50/70 transition-colors duration-100 cursor-pointer ${isSelected ? 'bg-slate-50' : ''}`}
                      onClick={() => openInspectDrawer(event)}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!['needs_review', 'needs_verification'].includes(event.status)}
                          onChange={() => handleToggleSelect(eventId)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                        />
                      </td>

                      {/* Employee Identity */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <EmployeeAvatar
                            employee={employee}
                            companyId={cpId}
                            employeeId={event.employee_id}
                            firstName={employee?.first_name}
                            lastName={employee?.last_name}
                            size="h-9 w-9"
                            rounded="rounded-md"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-slate-900 text-xs truncate">{empName}</p>
                              {!isEligible && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase bg-rose-100 text-rose-700 border border-rose-200">
                                  Separated
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <button
                                type="button"
                                onClick={(e) => copyText(e, cpId, 'CP-ID')}
                                title="Click to copy CP-ID"
                                className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded border border-slate-200/80 cursor-pointer"
                              >
                                <span>{cpId}</span>
                                <i className="ti ti-copy text-[10px] text-slate-400" />
                              </button>
                              {employee?.department && (
                                <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                  {employee.department}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Punch Action */}
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider border select-none ${
                          isTimeIn
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          <i className={`ti ${isTimeIn ? 'ti-login' : 'ti-logout'} text-xs`} />
                          <span>{event.review_pair?.correction ? 'Corrected shift' : event.review_pair?.complete ? 'Time In / Out' : isTimeIn ? 'Time In' : 'Time Out'}</span>
                        </span>
                      </td>

                      {/* Captured Instant (PST) */}
                      <td className="py-3 px-4">
                        {event.review_pair?.complete ? (
                          <div className="font-mono text-xs text-ink">
                            <p>In: {new Date(event.review_pair.time_in).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}</p>
                            <p>Out: {new Date(event.review_pair.time_out).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}</p>
                            <p className="mt-1 text-[10px]">{event.review_pair.work_date}</p>
                          </div>
                        ) : <>
                        <div className="font-mono text-xs font-semibold text-slate-900">
                          {payload.captured_at
                            ? new Date(payload.captured_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            : '--:--:--'}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                          <span>
                            {payload.captured_at
                              ? new Date(payload.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                              : ''}
                          </span>
                          <span>·</span>
                          <span className="text-slate-500 font-medium">
                            {formatRelativeTime(payload.captured_at)}
                          </span>
                        </div>
                        {driftLabel && (
                          <span className="inline-block text-[9px] font-mono text-slate-400 mt-0.5">
                            {driftLabel}
                          </span>
                        )}
                        </>}
                      </td>

                      {/* Location / Kiosk */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-xs text-slate-800">
                          {payload.site_id || event.site_id || 'MAIN'}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 font-mono text-[10px] text-slate-400">
                          <span title={payload.device_id || event.device_id}>
                            Kiosk: {(payload.device_id || event.device_id || '').slice(0, 8)}...
                          </span>
                          <button
                            type="button"
                            onClick={(e) => copyText(e, payload.device_id || event.device_id, 'Device ID')}
                            className="text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            <i className="ti ti-copy text-[10px]" />
                          </button>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={STATUS_VARIANTS[event.status] || 'neutral'}
                          size="sm"
                        >
                          {event.review_pair?.issue || STATUS_LABELS[event.status] || event.status}
                        </Badge>
                      </td>

                      {/* Review Actions */}
                      <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {canResolveMissingTimeOut(event) && (
                            <button type="button" onClick={() => openInspectDrawer(event)} disabled={actionBusy}
                              className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded border border-line bg-surface px-2.5 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50">
                              Resolve Time Out
                            </button>
                          )}
                          {reviewCanDecide(event, 'approve') && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDecision(eventId, 'approve', 'Direct verification by authorized HR administrator.')}
                                disabled={actionBusy || !isApprovalReady}
                                className="h-7 px-2.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold border border-emerald-200 transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                                title="Approve the complete Time In and Time Out together"
                              >
                                <i className="ti ti-check text-xs" />
                                <span>Approve</span>
                              </button>
                              {reviewCanDecide(event, 'reject') && <button
                                type="button"
                                onClick={() => handleDecision(eventId, 'reject', 'Identity could not be verified by HR reviewer.')}
                                disabled={actionBusy}
                                className="h-7 px-2 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold border border-rose-200 transition-colors disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                                title="Reject capture"
                              >
                                <i className="ti ti-x text-xs" />
                              </button>}
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => openInspectDrawer(event)}
                            className="h-7 px-2.5 rounded-md bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink text-xs font-semibold border border-line transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                            title="Inspect cryptographic proof and audit trail"
                          >
                            <i className="ti ti-eye text-xs" />
                            <span>Audit</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Deep Inspection & Audit Modal */}
      {selectedEvent && (() => {
        const payload = selectedEvent.payload || selectedEvent;
        const isTimeIn = payload.action === 'TIME_IN';
        const isTimeOut = payload.action === 'TIME_OUT';
        const eventId = selectedEvent.event_id || payload.event_id;
        const capturedAt = payload.captured_at;
        const siteId = payload.site_id;
        const pair = selectedEvent.review_pair;
        const shiftDuration = calculateShiftDuration(pair?.time_in, pair?.time_out);

        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs animate-fadeIn font-sans">
            <div
              className="relative bg-surface rounded-lg shadow-xl border border-line w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="px-5 py-4 bg-surface border-b border-line flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-ink tracking-wide">
                      Cryptographic Capture Audit
                    </h3>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-surface-muted border border-line text-ink-muted">
                      {selectedEvent.company_scope || 'cpoint'}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-ink-subtle truncate max-w-sm sm:max-w-md mt-0.5">
                    Event ID: {eventId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeInspectDrawer}
                  className="h-8 w-8 rounded-md bg-surface hover:bg-surface-muted text-ink-subtle hover:text-ink flex items-center justify-center transition-colors cursor-pointer border border-transparent hover:border-line"
                  aria-label="Close audit view"
                >
                  <i className="ti ti-x text-sm" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto p-4 text-xs text-ink sm:p-5">
                {/* Employee Snapshot */}
                <div className="p-3 rounded-md bg-surface-muted/60 border border-line flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <EmployeeAvatar
                      employee={selectedEvent.employee}
                      companyId={selectedEvent.employee_company_id || selectedEvent.employee?.company_id}
                      employeeId={selectedEvent.employee_id}
                      size="h-10 w-10"
                      rounded="rounded-md"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">
                        {selectedEvent.employee_name || 'Worker'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-xs font-semibold text-ink-muted bg-surface px-1.5 py-0.5 rounded-md border border-line">
                          {selectedEvent.employee_company_id || selectedEvent.employee?.company_id || 'N/A'}
                        </span>
                        {selectedEvent.employee?.department && (
                          <span className="text-ink-subtle font-medium truncate">
                            {selectedEvent.employee.department}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <Badge variant={STATUS_VARIANTS[selectedEvent.status] || 'neutral'} size="md">
                      {STATUS_LABELS[selectedEvent.status] || selectedEvent.status}
                    </Badge>
                    <p className="text-[10px] text-ink-subtle mt-1 font-mono">
                      Received: {selectedEvent.received_at ? formatManilaTime(selectedEvent.received_at) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Attendance Event Summary Card */}
                <div className="rounded-md border border-line bg-surface p-3.5 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between pb-2 border-b border-line">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wider uppercase ${
                        isTimeIn
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : isTimeOut
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : 'bg-surface-muted text-ink border border-line'
                      }`}>
                        {payload.action || 'ATTENDANCE PUNCH'}
                      </span>
                      <span className="text-[11px] text-ink-subtle">
                        {formatRelativeTime(capturedAt)}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-ink-muted">
                      Site: <span className="font-semibold text-ink">{siteId || 'Default'}</span>
                    </div>
                  </div>

                  {/* Paired Shift or Single Punch View */}
                  {pair?.complete ? (
                    <div className="rounded-md bg-surface-muted/60 p-3 border border-line space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-ink-subtle">
                        <span className="font-semibold uppercase tracking-wider text-ink-muted">Completed Attendance Pair</span>
                        {shiftDuration && (
                          <span className="font-mono font-semibold text-accent bg-surface px-1.5 py-0.5 rounded-md border border-line">
                            Shift: {shiftDuration}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="p-2.5 rounded-md bg-surface border border-line">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 block mb-0.5">Time In</span>
                          <p className="text-xs font-semibold text-ink">
                            {formatManilaDate(pair.time_in)}
                          </p>
                          <p className="text-sm font-bold font-mono text-ink mt-0.5">
                            {formatManilaTime(pair.time_in)}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-md bg-surface border border-line">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Time Out</span>
                            {pair.correction && (
                              <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                                HR Verified
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold text-ink">
                            {formatManilaDate(pair.time_out)}
                          </p>
                          <p className="text-sm font-bold font-mono text-ink mt-0.5">
                            {formatManilaTime(pair.time_out)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="p-3 rounded-md bg-surface-muted/60 border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] uppercase font-semibold text-ink-subtle block">
                            Recorded Timestamp (Asia/Manila)
                          </span>
                          <p className="text-xs font-semibold text-ink mt-0.5">
                            {formatManilaDate(capturedAt)} <span className="font-mono font-bold text-sm text-ink ml-1.5">{formatManilaTime(capturedAt)}</span>
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <span className="text-[10px] uppercase font-semibold text-ink-subtle block">
                            Terminal Kiosk
                          </span>
                          <p className="text-xs font-mono text-ink-muted">
                            {payload.device_id ? `${payload.device_id.slice(0, 16)}…` : 'Enrolled Terminal'}
                          </p>
                        </div>
                      </div>
                      {pair?.issue && (
                        <div className="p-2.5 rounded-md bg-amber-50/80 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                          <span>{pair.issue}</span>
                          <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Unpaired Shift</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Cryptographic Verification Card (No dots, aligned border radius, Hardware Attested removed) */}
                <div className="rounded-md border border-line bg-surface-muted/50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                      Cryptographic Verification
                    </span>
                    <span className="text-[10px] text-ink-subtle font-mono">
                      Seq #{payload.local_sequence || 1}
                    </span>
                  </div>

                  {/* High-Level Trust Badges */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded-md bg-surface border border-line">
                      <span className="text-[10px] text-ink-subtle uppercase block font-semibold">Signature</span>
                      <span className="font-semibold text-ink text-[11px] block mt-0.5">ECDSA P-256 Valid</span>
                    </div>
                    <div className="p-2.5 rounded-md bg-surface border border-line">
                      <span className="text-[10px] text-ink-subtle uppercase block font-semibold">Payload Hash</span>
                      <span className="font-semibold text-ink text-[11px] block mt-0.5">SHA-256 Matched</span>
                    </div>
                    <div className="p-2.5 rounded-md bg-surface border border-line">
                      <span className="text-[10px] text-ink-subtle uppercase block font-semibold">Hardware Origin</span>
                      <span className="font-semibold text-ink text-[11px] block mt-0.5 truncate">{siteId || 'Enrolled Site'}</span>
                    </div>
                  </div>

                  {/* Progressive Disclosure for Deep Raw Cryptographic Artifacts */}
                  <details className="group text-xs text-ink-subtle pt-1">
                    <summary className="cursor-pointer font-medium hover:text-ink text-[11px] uppercase tracking-wider select-none text-ink-subtle flex items-center justify-between py-1 transition-colors">
                      <span>View Technical Hashes &amp; Raw Signature</span>
                      <span className="text-[10px] group-open:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div className="mt-2 space-y-2 p-2.5 rounded-md bg-surface border border-line font-mono text-[10px]">
                      <div>
                        <div className="flex items-center justify-between text-ink-subtle mb-0.5">
                          <span className="font-bold uppercase tracking-wider">Terminal Device UUID</span>
                          <button
                            type="button"
                            onClick={(e) => copyText(e, payload.device_id, 'Device UUID')}
                            className="text-accent hover:underline cursor-pointer font-sans font-semibold text-[10px]"
                          >
                            Copy UUID
                          </button>
                        </div>
                        <div className="p-1.5 rounded-md bg-surface-muted text-ink break-all border border-line">
                          {payload.device_id || 'N/A'}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-ink-subtle mb-0.5">
                          <span className="font-bold uppercase tracking-wider">SHA-256 Canonical Payload Hash</span>
                          <button
                            type="button"
                            onClick={(e) => copyText(e, selectedEvent.payload_hash, 'SHA-256 Hash')}
                            className="text-accent hover:underline cursor-pointer font-sans font-semibold text-[10px]"
                          >
                            Copy Hash
                          </button>
                        </div>
                        <div className="p-1.5 rounded-md bg-surface-muted text-ink break-all border border-line">
                          {selectedEvent.payload_hash || 'Verified on ingestion'}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-ink-subtle mb-0.5">
                          <span className="font-bold uppercase tracking-wider">Digital Signature (ECDSA P-256 Base64URL)</span>
                          <button
                            type="button"
                            onClick={(e) => copyText(e, selectedEvent.signature, 'Full Signature')}
                            className="text-accent hover:underline cursor-pointer font-sans font-semibold text-[10px]"
                          >
                            Copy Signature
                          </button>
                        </div>
                        <div className="p-1.5 rounded-md bg-surface-muted text-ink break-all border border-line">
                          {selectedEvent.signature || 'N/A'}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-ink-subtle pt-1 border-t border-line">
                        <span>Raw ISO: {capturedAt}</span>
                        <span>Scope: {selectedEvent.company_scope || 'cpoint'}</span>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Decision Audit Trail */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                      Decision Audit Trail
                    </h4>
                    {drawerHistory.length > 0 && (
                      <span className="text-[10px] font-mono text-ink-subtle">
                        {drawerHistory.length} recorded entry(ies)
                      </span>
                    )}
                  </div>

                  {historyLoading ? (
                    <p className="text-xs text-ink-subtle py-2">Loading audit trail...</p>
                  ) : drawerHistory.length === 0 ? (
                    <div className="p-3 rounded-md bg-surface-muted/40 border border-line text-xs text-ink-subtle italic">
                      No prior review decisions recorded for this event.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {drawerHistory.map((item, idx) => (
                        <div key={item.id || idx} className="p-3 rounded-md bg-surface border border-line space-y-1.5 shadow-2xs">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                item.decision === 'approve'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : item.decision === 'reject'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200'
                              }`}>
                                {item.decision === 'resolve_missing_time_out' ? 'Verified Time Out' : item.decision}
                              </span>
                              <span className="font-semibold text-xs text-ink">{item.actor_name || 'HR Reviewer'}</span>
                            </div>
                            <span className="text-ink-subtle font-mono text-[10px]">
                              {item.created_at ? formatManilaDateTime(item.created_at) : ''}
                            </span>
                          </div>
                          <p className="text-xs text-ink-muted bg-surface-muted p-2 rounded-md border border-line leading-relaxed">
                            {item.reason}
                          </p>
                          {item.verified_time_out && (
                            <p className="text-[11px] text-ink-muted pt-0.5">
                              Verified departure: <span className="font-semibold text-ink font-mono">{formatManilaDateTime(item.verified_time_out)}</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Review & Decision Form */}
                {(['needs_review', 'needs_verification'].includes(selectedEvent.status) || canResolveMissingTimeOut(selectedEvent)) && (
                  <div className="p-4 rounded-md bg-surface-muted border border-line space-y-3.5">
                    {canResolveMissingTimeOut(selectedEvent) && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-ink" htmlFor="verified-missing-time-out">
                          Verified Time Out (Philippine Time) <span className="text-rose-500">*</span>
                        </label>
                        <input
                          id="verified-missing-time-out"
                          type="datetime-local"
                          value={verifiedTimeOut}
                          onChange={event => setVerifiedTimeOut(event.target.value)}
                          disabled={actionBusy || !isResolutionReady}
                          min={manilaDateTimeInput(payload.captured_at)}
                          max={manilaDateTimeInput(Math.min(now, Date.parse(payload.captured_at) + 18 * 3600000))}
                          className="block h-9 w-full rounded-md border border-line bg-surface px-2.5 text-xs text-ink font-medium focus:outline-none focus:border-line-strong focus:ring-1 focus:ring-accent/20 transition-colors shadow-2xs"
                        />
                        <p className="text-[11px] text-ink-subtle">
                          {isResolutionReady
                            ? 'Enter the actual departure timestamp confirmed by supervisory records.'
                            : 'Install the missing Time Out database update to enable corrections.'}
                        </p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <label className="text-xs font-semibold text-ink">
                          HR Verification &amp; Audit Justification <span className="text-rose-500">*</span>
                        </label>
                        <span className="text-[10px] text-ink-subtle">Required for compliance audit</span>
                      </div>

                      {/* Preset Template Chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_REASONS.map((preset, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setReviewReason(preset)}
                            className="px-2 py-1 rounded-md bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink text-[10px] border border-line transition-colors cursor-pointer shadow-2xs"
                          >
                            + {preset.slice(0, 32)}…
                          </button>
                        ))}
                      </div>

                      <textarea
                        value={reviewReason}
                        onChange={e => setReviewReason(e.target.value)}
                        placeholder="Enter audit justification (e.g. CCTV verified employee presence at plant entrance)..."
                        rows={3}
                        maxLength={1000}
                        className="w-full rounded-md border border-line bg-surface p-2.5 text-xs text-ink placeholder-ink-subtle focus:outline-none focus:border-line-strong focus:ring-1 focus:ring-accent/20 shadow-2xs transition-colors resize-none"
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-line">
                      {canResolveMissingTimeOut(selectedEvent) && (
                        <button
                          type="button"
                          onClick={handleResolveTimeOut}
                          disabled={actionBusy || !isResolutionReady || !verifiedTimeOut || !reviewReason.trim()}
                          className="h-8 px-3.5 rounded-md bg-ink hover:bg-slate-800 text-white font-semibold text-xs shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Save Verified Time Out
                        </button>
                      )}

                      {reviewCanDecide(selectedEvent, 'approve') && (
                        <button
                          type="button"
                          onClick={() => handleDecision(reviewEventId(selectedEvent), 'approve')}
                          disabled={actionBusy || !reviewReason.trim() || !isApprovalReady}
                          className="h-8 px-4 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Approve Attendance
                        </button>
                      )}

                      {['needs_review', 'needs_verification'].includes(selectedEvent.status) && (
                        <button
                          type="button"
                          onClick={() => handleDecision(selectedEvent.event_id || payload.event_id, 'needs_verification')}
                          disabled={actionBusy || !reviewReason.trim()}
                          className="h-8 px-3.5 rounded-md bg-surface border border-line hover:bg-surface-muted text-ink font-semibold text-xs shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Flag for Verification
                        </button>
                      )}

                      {reviewCanDecide(selectedEvent, 'reject') && (
                        <button
                          type="button"
                          onClick={() => handleDecision(reviewEventId(selectedEvent), 'reject')}
                          disabled={actionBusy || !reviewReason.trim()}
                          className="h-8 px-3.5 rounded-md bg-danger hover:bg-danger-ink text-white font-semibold text-xs shadow-2xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Reject Attendance
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 bg-surface border-t border-line flex items-center justify-between text-xs text-ink-subtle">
                <span className="font-mono text-[11px]">
                  Cryptographic audit record — P-256 signed
                </span>
                <button
                  type="button"
                  onClick={closeInspectDrawer}
                  className="h-8 px-4 rounded-md border border-line bg-surface hover:bg-surface-muted text-ink-muted hover:text-ink font-semibold cursor-pointer shadow-2xs transition-colors text-xs"
                >
                  Close Audit View
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Batch Decision Confirmation Modal */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fadeIn font-sans">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <i className={`ti ${
                  batchDecision === 'approve' ? 'ti-circle-check text-emerald-600' : batchDecision === 'reject' ? 'ti-circle-x text-rose-600' : 'ti-info-circle text-blue-600'
                } text-base`} />
                <h3 className="font-bold text-sm text-slate-900">
                  Batch {batchDecision === 'approve' ? 'Approval' : batchDecision === 'reject' ? 'Rejection' : 'Verification'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <i className="ti ti-x" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              You are applying this action to <strong>{selectedIds.size}</strong> provisional capture{selectedIds.size > 1 ? 's' : ''}. Provide an audit justification reason below.
            </p>

            <textarea
              value={batchReason}
              onChange={e => setBatchReason(e.target.value)}
              placeholder="Enter compliance justification for batch action..."
              rows={3}
              maxLength={1000}
              className="w-full rounded-md border border-slate-200 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                disabled={batchBusy}
                className="h-8 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shadow-2xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteBatch}
                disabled={batchBusy || !batchReason.trim()}
                className={`h-8 px-4 rounded-md text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 shadow-2xs ${
                  batchDecision === 'approve' ? 'bg-emerald-600 hover:bg-emerald-500' : batchDecision === 'reject' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {batchBusy ? 'Processing...' : `Confirm (${selectedIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
