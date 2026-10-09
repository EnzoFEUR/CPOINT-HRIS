import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import QRCode from '../components/QRCode';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { fetchWithAuth } from '../utils/api';
import { supabase } from '../supabaseClient';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { getDisciplinaryCache, setDisciplinaryCache, clearDisciplinaryCache } from '../utils/disciplinaryCache';
import { getShoeRoleDetails, parseProductionGroup } from '../utils/factoryRoles';
import { computeDisciplinaryStanding, isExoneratedOrCleared } from '../utils/disciplinaryStanding';
import { HOLIDAY_LABELS, parsePayrollFinancials, formatCurrency } from '../utils/payslipUtils';
import { getUser, isSecurity, isAdmin } from '../routes/guards';
import useEmployeeDashboard from '../utils/useEmployeeDashboard';
import { acknowledgeDashboardNotices, createDashboardRefresh, getDashboardPayrolls, targetsDashboardEmployee } from '../utils/employeeDashboardData';

const EmployeeDashboard = () => {
    const queryClient = useQueryClient();
    const [storedUser] = useState(() => getUser() || { name: 'Loading...', id: '', department: 'Team Member' });
    const enabled = Boolean(storedUser.id) && !isSecurity(storedUser) && !isAdmin(storedUser);
    const { dashboard, history, refresh } = useEmployeeDashboard(storedUser.id, enabled);
    const data = dashboard.data;
    const payHistoryData = history.data;
    const isPayHistoryLoading = history.isLoading;
    const liveEmployee = data?.employee || data?.shiftData?.[0] || null;
    const user = useMemo(() => liveEmployee ? {
        ...storedUser, ...liveEmployee,
        name: [liveEmployee.first_name, liveEmployee.last_name].filter(Boolean).join(' ') || storedUser.name,
    } : storedUser, [storedUser, liveEmployee]);
    const [disciplinaryState, setDisciplinaryState] = useState(() => getDisciplinaryCache(storedUser.id));
    const [now, setNow] = useState(() => Date.now());
    const [showQrModal, setShowQrModal] = useState(false);
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [showPayslipModal, setShowPayslipModal] = useState(false);
    const [showInfractionsModal, setShowInfractionsModal] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get('view') === 'disciplinary' || params.get('tab') === 'disciplinary';
    });
    const [showLatestPayMasked, setShowLatestPayMasked] = useState(false);
    const [leaveForm, setLeaveForm] = useState({ leave_type: 'Sick Leave', start_date: '', end_date: '', reason: '' });
    const [isSubmittingLeave, setIsSubmittingLeave] = useState(false);

    useEffect(() => {
        if (isSecurity(storedUser)) window.location.replace('/scanner');
        else if (isAdmin(storedUser)) window.location.replace('/');
    }, [storedUser]);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!liveEmployee) return;
        try {
            const saved = getUser();
            if (saved?.id === user.id) {
                const updated = { ...saved, ...liveEmployee, name: user.name };
                const serialized = JSON.stringify(updated);
                if (serialized !== JSON.stringify(saved)) localStorage.setItem('user', serialized);
            }
        } catch { /* The server profile still renders when browser storage is unavailable. */ }
    }, [liveEmployee, user.id, user.name]);

    useEffect(() => {
        if (!enabled) return;
        let disposed = false;
        const scheduled = createDashboardRefresh(refresh);
        const onPayroll = event => ({ payload }) => {
            if (disposed || !targetsDashboardEmployee(payload, storedUser.id)) return;
            scheduled.refresh(true);
            if (['PAYROLL_CREATED', 'PAYROLL_BATCH_DISTRIBUTED'].includes(event) &&
                (payload?.employee_id || Array.isArray(payload?.employee_ids))) {
                toast.success('Your latest payslip has been distributed!', { id: 'emp-payslip-alert' });
            }
        };
        const alerts = {
            EMPLOYEE_SUSPENDED: ['error', 'Operational Hold: Your account has been placed on temporary disciplinary suspension.', 'susp-live-alert'],
            EMPLOYEE_TERMINATED: ['error', 'Account Separated: Your status has been updated to Separated / Pending Archive.', 'term-live-alert'],
            DISCIPLINARY_OVERTURNED: ['success', 'Disciplinary decision overturned. Good standing restored.', 'disc-ot-alert'],
            DISCIPLINARY_RESOLVED: ['success', 'Disciplinary action resolved. Access restored.', 'disc-res-alert'],
            EMPLOYEE_RESTORED: ['success', 'Account fully restored to active status.', 'emp-rest-alert'],
            BIOMETRIC_EXEMPTION_UPDATED: ['success', 'Medical Grace protocol status updated', 'medical-dash-toast'],
            BIOMETRICS_REGISTERED: ['success', 'Face Biometrics Registered! Turnstile QR pass activated.', 'bio-dash-toast'],
            BIOMETRICS_RESET: ['error', 'Face Biometrics Reset: Please re-enroll in Biometric Setup.', 'bio-dash-toast'],
        };
        const onEmployeeEvent = event => ({ payload }) => {
            if (disposed || !targetsDashboardEmployee(payload, storedUser.id)) return;
            // Broadcasts announce changes; authenticated reads determine account/QR permissions.
            scheduled.refresh();
            if (event === 'EMPLOYEE_SUSPENDED' || (event === 'DISCIPLINARY_CREATED' && ['Suspension', 'Warning'].includes(payload?.type))) setShowInfractionsModal(true);
            const alert = alerts[event];
            if (alert) toast[alert[0]](alert[1], { id: alert[2], duration: 8000 });
        };
        const onSubscribe = status => { if (status === 'SUBSCRIBED') scheduled.refresh(true); };
        const channel = supabase.channel(`employee-live-dashboard-${storedUser.id}`);
        for (const table of ['attendances', 'leave_requests', 'payrolls', 'disciplinary_logs', 'employees']) {
            const column = table === 'employees' ? 'id' : 'employee_id';
            channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `${column}=eq.${storedUser.id}` }, payload => {
                if (targetsDashboardEmployee(payload, storedUser.id, column)) scheduled.refresh(table === 'payrolls');
            });
        }
        // shortcut: unscoped payroll deletions reconcile by polling; target employee topics for immediate updates.
        for (const event of ['PAYROLL_CREATED', 'PAYROLL_BATCH_DISTRIBUTED', 'PAYROLL_UPDATED', 'PAYROLL_DELETED', 'PAYROLL_BULK_DELETED']) {
            channel.on('broadcast', { event }, onPayroll(event));
        }
        const disciplinaryBus = supabase.channel(`dashboard-disciplinary-sync-${storedUser.id}`);
        for (const event of ['DISCIPLINARY_CREATED', 'DISCIPLINARY_STATUS_UPDATED', 'DISCIPLINARY_DELETED', ...Object.keys(alerts)]) {
            channel.on('broadcast', { event }, onEmployeeEvent(event));
            disciplinaryBus.on('broadcast', { event }, onEmployeeEvent(event));
        }
        channel.subscribe(onSubscribe);
        disciplinaryBus.subscribe(onSubscribe);
        const openDisciplinary = () => setShowInfractionsModal(true);
        const refreshAll = () => scheduled.refresh(true);
        const syncDisciplinary = event => {
            if (event.detail?.userId === storedUser.id) setDisciplinaryState(getDisciplinaryCache(storedUser.id));
        };
        window.addEventListener('refresh_dashboard', refreshAll);
        window.addEventListener('open_disciplinary_modal', openDisciplinary);
        window.addEventListener('hris_disciplinary_sync', syncDisciplinary);
        return () => {
            disposed = true;
            scheduled.cancel();
            for (const subscription of [channel, disciplinaryBus]) supabase.removeChannel(subscription);
            window.removeEventListener('refresh_dashboard', refreshAll);
            window.removeEventListener('open_disciplinary_modal', openDisciplinary);
            window.removeEventListener('hris_disciplinary_sync', syncDisciplinary);
        };
    }, [enabled, storedUser.id, refresh]);

    const rawAttendance = data?.attendanceData?.data || data?.attendanceData || [];
    const recentLogs = Array.isArray(rawAttendance) ? rawAttendance.slice(0, 5) : [];

    // Global keyboard listener for accessible ESC dismissal of all modals
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setShowPayslipModal(false);
                setShowQrModal(false);
                setShowLeaveModal(false);
                setShowInfractionsModal(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const allPayrolls = useMemo(() => getDashboardPayrolls(data?.payrollData, payHistoryData), [data?.payrollData, payHistoryData]);
    const latestPayroll = allPayrolls.length > 0 ? allPayrolls[0] : null;
    const [payslipView, setPayslipView] = useState('history'); // 'history' | 'detail'
    const [selectedPayslipId, setSelectedPayslipId] = useState(null);
    const currentPayslip = useMemo(() => {
        if (!selectedPayslipId) return latestPayroll;
        return allPayrolls.find((p) => p.id === selectedPayslipId) || latestPayroll;
    }, [allPayrolls, selectedPayslipId, latestPayroll]);
    const currentPayslipIndex = useMemo(() => {
        if (!currentPayslip) return -1;
        return allPayrolls.findIndex((p) => p.id === currentPayslip.id);
    }, [allPayrolls, currentPayslip]);

    // Pay history filter (year / month / search query). 
    const [filterYear, setFilterYear] = useState('all');
    const [filterMonth, setFilterMonth] = useState('all');
    const [paySearchQuery, setPaySearchQuery] = useState('');
    const PAY_FILTER_MIN = 8;
    const payDateOf = (p) => dayjs(p.period_end || p.period_start || p.created_at);
    const payYears = useMemo(
        () => Array.from(new Set(allPayrolls.map((p) => payDateOf(p).year()).filter((y) => !Number.isNaN(y)))).sort((a, b) => b - a),
        [allPayrolls]
    );
    const payMonths = useMemo(
        () => Array.from(new Set(
            allPayrolls
                .filter((p) => filterYear === 'all' || payDateOf(p).year() === Number(filterYear))
                .map((p) => payDateOf(p).month())
                .filter((m) => !Number.isNaN(m))
        )).sort((a, b) => b - a),
        [allPayrolls, filterYear]
    );
    const filteredPayrolls = useMemo(
        () => allPayrolls.filter((p) => {
            const d = payDateOf(p);
            if (filterYear !== 'all' && d.year() !== Number(filterYear)) return false;
            if (filterMonth !== 'all' && d.month() !== Number(filterMonth)) return false;
            if (paySearchQuery.trim()) {
                const q = paySearchQuery.trim().toLowerCase();
                const vId = p.id ? String(p.id).toLowerCase() : '';
                const pStart = p.period_start ? dayjs(p.period_start).format('MMMM DD YYYY MMM').toLowerCase() : '';
                const pEnd = p.period_end ? dayjs(p.period_end).format('MMMM DD YYYY MMM').toLowerCase() : '';
                const status = (p.status || '').toLowerCase();
                const net = String(p.net_pay || '');
                if (!vId.includes(q) && !pStart.includes(q) && !pEnd.includes(q) && !status.includes(q) && !net.includes(q)) {
                    return false;
                }
            }
            return true;
        }),
        [allPayrolls, filterYear, filterMonth, paySearchQuery]
    );
    const isPayFiltered = filterYear !== 'all' || filterMonth !== 'all' || Boolean(paySearchQuery.trim());

    // High-performance memoized financial summary for Pay History
    const payHistorySummary = useMemo(() => {
        let totalNet = 0;
        let totalGross = 0;
        let totalDeductions = 0;

        filteredPayrolls.forEach(p => {
            const fin = parsePayrollFinancials(p);
            totalNet += fin.netPay;
            totalGross += fin.grossEarnings;
            totalDeductions += fin.totalDeductions;
        });

        const count = filteredPayrolls.length;
        const avgNet = count > 0 ? totalNet / count : 0;

        return {
            count,
            totalNet,
            totalGross,
            totalDeductions,
            avgNet
        };
    }, [filteredPayrolls]);

    const isFactoryWorker = (user?.department || '').toLowerCase().includes('factory') ||
        (user?.shift || '').toLowerCase().includes('factory');
    const shoeRole = isFactoryWorker ? getShoeRoleDetails(user?.job_title) : null;
    const prodGroup = isFactoryWorker ? parseProductionGroup(user?.shift) : null;
    const workerClassification = isFactoryWorker ? (shoeRole ? shoeRole.label : (user?.job_title || 'Shoe Craft')) : 'Regular Worker';
    const workerSchedule = isFactoryWorker ? '08:00 AM - 05:00 PM' : '08:00 AM - 08:00 PM';
    const overtimePolicy = isFactoryWorker ? 'Strict Shift · No Overtime' : 'Extended Shift · OT Eligible';

    const currentStatus = String(user.status || 'active').toLowerCase();

    // Medical grace protocol state
    const medicalExemption = useMemo(() => {
        const rawUrl = liveEmployee?.medical_record_url || user?.medical_record_url;
        if (!rawUrl) return null;
        try {
            const parsed = typeof rawUrl === 'string' ? JSON.parse(rawUrl) : rawUrl;
            if (parsed && typeof parsed === 'object' && parsed.type === 'MEDICAL_GRACE_EXEMPTION') {
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    }, [liveEmployee?.medical_record_url, user?.medical_record_url]);

    const isMedicalExempt = useMemo(() => {
        if (!medicalExemption?.expires_at) return false;
        return new Date(medicalExemption.expires_at).getTime() > now;
    }, [medicalExemption, now]);

    const daysRemaining = useMemo(() => {
        if (!isMedicalExempt || !medicalExemption?.expires_at) return 0;
        return Math.max(0, Math.ceil((new Date(medicalExemption.expires_at).getTime() - now) / (1000 * 60 * 60 * 24)));
    }, [isMedicalExempt, medicalExemption, now]);

    const rawDisc = data?.discData?.data || data?.discData;
    const queryHasLoaded = Array.isArray(rawDisc);
    const employeeDisciplinary = useMemo(() => {
        const logs = data?.discData?.data || data?.discData || [];
        return Array.isArray(logs) ? logs.filter(log => String(log.employee_id) === String(user.id)) : [];
    }, [data?.discData, user.id]);
    const infractions = employeeDisciplinary.filter(log => log.status === 'Active');
    const unresolvedInfractions = employeeDisciplinary.filter(log => log.status !== 'Resolved');
    const isActiveSanction = log => !isExoneratedOrCleared(log) && !['resolved', 'overturned', 'dismissed', 'cleared', 'cancelled', 'closed'].includes(String(log.status || '').toLowerCase());
    const terminationRecord = employeeDisciplinary.find(log => log.type === 'Termination' && isActiveSanction(log));
    const activeTermination = queryHasLoaded ? terminationRecord : (disciplinaryState.isTerminated ? disciplinaryState.record : null);
    const activeSuspension = queryHasLoaded
        ? employeeDisciplinary.find(log => log.type === 'Suspension' && isActiveSanction(log))
        : (disciplinaryState.isSuspended ? disciplinaryState.record : null);
    const isTerminated = Boolean(activeTermination || user.is_terminated || user.archived_at ||
        user.operational_status === 'Terminated' || ['terminated', 'separated', 'archived'].includes(currentStatus) ||
        (currentStatus === 'inactive' && user.separation_type) || (!queryHasLoaded && disciplinaryState.isTerminated));
    const isSuspended = !isTerminated && Boolean(activeSuspension || user.is_suspended ||
        currentStatus === 'suspended' || user.operational_status === 'Suspended' || (!queryHasLoaded && disciplinaryState.isSuspended));

    // Biometric Enrollment Requirement: QR code ONLY appears when face biometrics are enrolled
    const hasFaceBiometrics = Boolean(
        liveEmployee?.has_registered_biometrics ||
        user?.has_registered_biometrics ||
        liveEmployee?.biometric_baseline_path ||
        user?.biometric_baseline_path ||
        isMedicalExempt
    );

    const suspensionRecords = employeeDisciplinary.filter(log => log.type === 'Suspension');
    const pastSuspensionsCount = suspensionRecords.length;

    const standing = useMemo(() => computeDisciplinaryStanding({
        isTerminated,
        isSuspended,
        status: currentStatus || user?.status,
        operational_status: liveEmployee?.operational_status || user?.operational_status,
        disciplinaryLogs: employeeDisciplinary
    }), [isTerminated, isSuspended, currentStatus, user?.status, liveEmployee?.operational_status, user?.operational_status, employeeDisciplinary]);

    useEffect(() => {
        if (!user.id || !queryHasLoaded) return;
        const type = isTerminated ? 'Termination' : isSuspended ? 'Suspension' : 'Clean';
        const record = isTerminated ? activeTermination || terminationRecord || null : isSuspended ? activeSuspension || null : null;
        const cached = getDisciplinaryCache(user.id);
        if (cached.type === type && JSON.stringify(cached.record) === JSON.stringify(record)) return;
        if (type === 'Clean') clearDisciplinaryCache(user.id);
        else setDisciplinaryCache(user.id, { type, record });
    }, [user.id, queryHasLoaded, isTerminated, isSuspended, activeTermination, activeSuspension, terminationRecord]);

    const suspensionEndDate = (() => {
        if (activeSuspension?.end_date) return activeSuspension.end_date;
        if (!activeSuspension?.reason) return null;
        const match = activeSuspension.reason.match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        return match ? match[1] : null;
    })();

    const suspensionDays = (() => {
        if (activeSuspension?.duration_days) return activeSuspension.duration_days;
        if (!activeSuspension?.reason) return null;
        const match = activeSuspension.reason.match(/SUSPENDED:?\s*([0-9]+)\s*DAYS/i);
        return match ? match[1] : null;
    })();

    const rawLeaves = data?.leaveData?.data || data?.leaveData || [];
    const myLeaves = Array.isArray(rawLeaves) ? rawLeaves.slice(0, 5) : [];

    const handleLeaveSubmit = async (e) => {
        e.preventDefault();
        if (isTerminated) {
            toast.error('Leave requests are disabled for separated accounts.');
            return;
        }
        if (isSuspended) {
            toast.error('Leave requests cannot be filed while account is on disciplinary suspension.');
            return;
        }
        if (isSubmittingLeave || dashboard.isError || !data) {
            toast.error('Refresh your employee status before submitting a leave request.');
            return;
        }
        setIsSubmittingLeave(true);
        try {
            const res = await fetchWithAuth('/api/leaves', {
                method: 'POST',
                body: JSON.stringify({ employee_id: user.id, ...leaveForm })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success('Leave request submitted to HR!');
                setShowLeaveModal(false);
                setLeaveForm({ leave_type: 'Sick Leave', start_date: '', end_date: '', reason: '' });
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });

            } else {
                toast.error(data.error || 'Failed to submit leave.');
            }
        } catch {
            toast.error('Network Error');
        } finally {
            setIsSubmittingLeave(false);
        }
    };

    const [acknowledgingId, setAcknowledgingId] = useState(null);

    const handleAcknowledgeSingle = async infId => {
        if (acknowledgingId) return;
        setAcknowledgingId(infId);
        try {
            const result = await acknowledgeDashboardNotices(fetchWithAuth, [infId]);
            if (result.failed) toast.error('Failed to acknowledge notice.');
            else toast.success('Disciplinary notice acknowledged.');
            await queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id], exact: true });
        } catch { toast.error('Network error acknowledging notice.'); }
        finally { setAcknowledgingId(null); }
    };

    const handleAcknowledgeAll = async () => {
        if (acknowledgingId || !infractions.length) return;
        setAcknowledgingId('all');
        try {
            const result = await acknowledgeDashboardNotices(fetchWithAuth, infractions.map(infraction => infraction.id));
            if (result.failed) toast.error(`${result.acknowledged} acknowledged; ${result.failed} failed. Retry the remaining notices.`);
            else toast.success('All notices acknowledged.');
            await queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id], exact: true });
        } catch { toast.error('Failed to acknowledge notices.'); }
        finally { setAcknowledgingId(null); }
    };

    const getInitial = (name) => name ? name.charAt(0).toUpperCase() : '?';
    const getFirstName = (name) => name ? name.split(' ')[0] : '';
    const formattedToday = new Date(now).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric' });

    const photoUrl = user?.avatar_url
        ? user.avatar_url
        : user?.biometric_baseline_path
            ? (user.biometric_baseline_path.startsWith('http')
                ? user.biometric_baseline_path
                : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${user.biometric_baseline_path.replace(/^\/+/, '')}`)
            : null;



    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 px-4 sm:px-6 font-sans">

            {(dashboard.isPending || dashboard.isFetching || dashboard.isError || history.isError) && (
                <div role={dashboard.isError || history.isError ? 'alert' : 'status'} aria-live="polite" className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span>{dashboard.isError || history.isError ? 'Some employee records could not refresh. Previously loaded records may be out of date.' : dashboard.isPending ? 'Loading employee records…' : 'Updating employee records…'}</span>
                    {(dashboard.isError || history.isError) && <button type="button" disabled={dashboard.isFetching || history.isFetching} onClick={refresh} className="font-semibold text-blue-700 disabled:opacity-50">Retry</button>}
                </div>
            )}
            {/* Disciplinary & Separation Alert Banners */}
            {isTerminated ? (
                <div className="bg-slate-900 border border-danger/30 rounded-lg p-4 sm:p-5 text-white shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5">
                        <div className="w-10 h-10 rounded-md bg-danger/10 border border-danger/30 flex items-center justify-center shrink-0 text-danger">
                            <i className="ti ti-user-off text-xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-danger text-white">Account Separated</span>
                                <span className="text-xs text-slate-400 font-mono">DOLE &amp; BIR 2316 Retention Mode</span>
                            </div>
                            <h3 className="font-bold text-sm sm:text-base tracking-tight text-white mt-1">Employment Records &amp; Clearance Archive</h3>
                            <p className="text-slate-300 text-xs mt-0.5 leading-relaxed max-w-xl">
                                Operational credentials have been deactivated. All statutory 201 records, government contributions, and historical payslips remain permanently accessible for tax clearance and DOLE audit verification.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowInfractionsModal(true)}
                        className="w-full md:w-auto h-9 px-4 bg-danger hover:bg-danger text-white font-medium rounded-md shadow-2xs transition-colors duration-100 text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                        <i className="ti ti-file-certificate text-sm" />
                        <span>Review Separation File</span>
                    </button>
                </div>
            ) : isSuspended ? (
                <div className="bg-slate-900 border border-warning/30 rounded-lg p-4 sm:p-5 text-white shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5">
                        <div className="w-10 h-10 rounded-md bg-warning/10 border border-warning/30 flex items-center justify-center shrink-0 text-warning">
                            <i className="ti ti-lock-exclamation text-xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-warning text-slate-950">Suspension Active</span>
                                {suspensionDays && (
                                    <span className="px-2 py-0.5 rounded-sm text-[10px] font-semibold bg-warning/10 text-warning border border-warning/20">
                                        {suspensionDays} Days Duration
                                    </span>
                                )}
                                {suspensionEndDate && (
                                    <span className="text-xs text-warning font-mono">Until {suspensionEndDate}</span>
                                )}
                            </div>
                            <h3 className="font-bold text-sm sm:text-base tracking-tight text-white mt-1">Operational Access Temporarily Suspended</h3>
                            <p className="text-slate-300 text-xs mt-0.5 leading-relaxed max-w-xl">
                                Under DOLE policy ("No Work, No Pay"), attendance clock-in, QR credentials, and leave filings are paused. You retain full access to review your compensation records and acknowledge official memos.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
                        <button
                            onClick={() => setShowInfractionsModal(true)}
                            className="w-full sm:w-auto h-9 px-4 bg-warning hover:bg-warning text-slate-950 font-medium rounded-md shadow-2xs transition-colors duration-100 text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                        >
                            <i className="ti ti-file-text text-sm" />
                            <span>{infractions.length > 0 ? 'Acknowledge Notice' : 'Review Suspension Memo'}</span>
                        </button>
                    </div>
                </div>
            ) : infractions.length > 0 ? (
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 sm:p-5 text-white shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-slate-300">
                            <i className="ti ti-shield-alert text-xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-danger text-white">Action Required</span>
                                <h3 className="font-bold text-sm sm:text-base tracking-tight text-white">Disciplinary Notice Issued</h3>
                            </div>
                            <p className="text-slate-400 text-xs mt-0.5">
                                You have <strong className="text-white font-semibold">{infractions.length} active notice{infractions.length > 1 ? 's' : ''}</strong> pending review and acknowledgment.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowInfractionsModal(true)}
                        className="w-full sm:w-auto h-9 px-4 bg-danger hover:bg-danger text-white font-medium rounded-md shadow-2xs transition-colors duration-100 text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                        <i className="ti ti-file-text text-sm" />
                        <span>Review &amp; Acknowledge</span>
                    </button>
                </div>
            ) : null}

            {/* Biometrics Incomplete Callout Banner */}
            {!hasFaceBiometrics && !isTerminated && !isSuspended && (
                <div className="bg-warning-subtle border border-warning/90 rounded-lg p-4 sm:p-5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-md bg-warning/10 border border-warning/20 flex items-center justify-center shrink-0 text-warning-ink">
                            <i className="ti ti-scan-eye text-xl animate-pulse" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-warning text-slate-950">Action required</span>
                                <h3 className="font-bold text-sm sm:text-base tracking-tight text-slate-900">Face scan not registered</h3>
                            </div>
                            <p className="text-slate-600 text-xs mt-0.5 leading-relaxed font-medium">
                                Your attendance QR pass is locked until you complete your face scan registration.
                            </p>
                        </div>
                    </div>
                    <Link
                        to="/biometric-setup"
                        className="w-full sm:w-auto h-9 px-4 bg-warning hover:bg-warning text-slate-950 font-medium rounded-md shadow-2xs transition-colors duration-100 text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                        <i className="ti ti-camera text-sm" />
                        <span>Register face scan</span>
                    </Link>
                </div>
            )}

            <div className="space-y-5 sm:space-y-8">

                {/* Welcome header with Profile & Logout */}
                <div className="flex items-start justify-between gap-4 pt-2 sm:pt-4">
                    <div>
                        <p className="text-accent font-bold tracking-widest uppercase text-xs sm:text-sm mb-1">{formattedToday}</p>
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                            Good day,<br /><span className="text-accent">{getFirstName(user.name)}!</span>
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 text-xs sm:text-sm flex flex-wrap items-center gap-1.5">
                            {isFactoryWorker ? (
                                <>
                                    <span className="font-bold text-slate-700">{user.job_title || 'Shoe Craft'}</span>
                                    {prodGroup && (
                                        <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-accent-subtle text-accent border border-accent/20">
                                            {prodGroup}
                                        </span>
                                    )}
                                    <span>• Factory Division</span>
                                </>
                            ) : (
                                <>
                                    <span>{user.job_title || 'Staff'}</span>
                                    <span>•</span>
                                    <span>{user.department}</span>
                                </>
                            )}
                            {isTerminated && <span className="ml-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-danger-subtle text-danger-ink border border-danger/20">Separated</span>}
                            {isSuspended && <span className="ml-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-warning-subtle text-warning-ink border border-warning/20">Suspended</span>}
                            {isMedicalExempt && (
                                <span className="ml-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-warning-subtle text-warning-ink border border-warning/20 inline-flex items-center gap-1">
                                    <i className="ti ti-bandage" /> Medical Grace ({daysRemaining}d)
                                </span>
                            )}
                        </p>
                    </div>

                    {/* User Avatar & Profile Navigation */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Link to="/employee/profile" title="View My Profile" className="group">
                            <EmployeeAvatar
                                employee={user}
                                photoUrl={photoUrl}
                                size="w-14 h-14 sm:w-16 sm:h-16"
                                rounded="rounded-md"
                                border={isTerminated ? "border-2 border-danger/20" : isSuspended ? "border-2 border-warning/20" : "border-2 border-slate-200"}
                                shadow="shadow-xs"
                                theme="dark"
                                textSize="text-xl sm:text-2xl"
                            />
                        </Link>
                        <Link
                            to="/employee/profile"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-accent transition-colors"
                            title="Manage profile & statutory documents"
                        >
                            <span>My Profile</span>
                            <i className="ti ti-chevron-right text-[10px]" />
                        </Link>
                    </div>
                </div>

                {/* Primary actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">

                    {/* Payroll - Always Available */}
                    <div
                        onClick={() => {
                            if (allPayrolls.length > 0 || latestPayroll) {
                                setPayslipView('history');
                                setSelectedPayslipId(null);
                                setFilterYear('all');
                                setFilterMonth('all');
                                setPaySearchQuery('');
                                setShowPayslipModal(true);
                            } else if (isFactoryWorker) {
                                toast('Factory piece-rate pool payouts are distributed per completed production batch.', { id: 'factory-pay-notice' });
                            } else {
                                toast.error('No payslips on record.', { id: 'no-payslips-notice' });
                            }
                        }}
                        className="relative overflow-hidden bg-accent rounded-lg p-5 sm:p-6 md:p-8 cursor-pointer shadow-2xs select-none"
                    >
                        <div className="relative z-10 flex flex-col justify-between h-full text-white">
                            <div className="flex justify-between items-start">
                                <div className="w-11 h-11 sm:w-14 sm:h-14 bg-white/15 border border-white/20 rounded-md flex items-center justify-center text-white mb-4 sm:mb-6">
                                    <i className="ti ti-wallet text-2xl sm:text-3xl" />
                                </div>
                                <div className="flex items-center gap-2">
                                    {isTerminated && (
                                        <span className="px-2.5 py-1 rounded-md bg-black/30 border border-white/10 text-[10px] font-mono tracking-wider font-bold">
                                            Archived Records
                                        </span>
                                    )}
                                    {isSuspended && (
                                        <span className="px-2.5 py-1 rounded-md bg-black/30 border border-white/10 text-[10px] font-mono tracking-wider font-bold">
                                            Compensation
                                        </span>
                                    )}
                                    {isFactoryWorker && !isTerminated && !isSuspended && (
                                        <span className="px-2.5 py-1 rounded-md bg-black/30 border border-white/10 text-[10px] font-mono tracking-wider font-bold">
                                            Pakyawan Pool
                                        </span>
                                    )}
                                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-md bg-white/15 border border-white/20 flex items-center justify-center text-white shrink-0">
                                        <i className="ti ti-arrow-right text-lg sm:text-xl" />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-white/80 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-1">
                                    {isTerminated ? 'Most Recent Net Pay' : isSuspended ? 'Latest Pay Record' : isFactoryWorker && !latestPayroll ? 'Compensation Model' : 'Latest Net Pay'}
                                </p>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight font-mono">
                                        {latestPayroll
                                            ? (showLatestPayMasked ? '₱••••••' : `₱${parseFloat(latestPayroll.net_pay).toFixed(2)}`)
                                            : (isFactoryWorker ? 'Batch Pool' : (isPayHistoryLoading ? '...' : '₱0.00'))}
                                    </h2>
                                    {latestPayroll && (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setShowLatestPayMasked((masked) => !masked);
                                            }}
                                            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-white/90 hover:text-white hover:bg-white/10 transition-colors"
                                            aria-label={showLatestPayMasked ? 'Show latest pay' : 'Mask latest pay'}
                                            title={showLatestPayMasked ? 'Show latest pay' : 'Mask latest pay'}
                                        >
                                            <i className={`ti ${showLatestPayMasked ? 'ti-eye' : 'ti-eye-off'} text-lg`} />
                                        </button>
                                    )}
                                    {latestPayroll && (
                                        <span className="text-[11px] font-mono font-medium text-white/90 bg-black/25 px-2 py-0.5 rounded border border-white/10">
                                            {latestPayroll.period_start ? dayjs(latestPayroll.period_start).format('MMM DD') : ''} – {latestPayroll.period_end ? dayjs(latestPayroll.period_end).format('MMM DD') : ''}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 pt-3 border-t border-white/20 flex items-center justify-between gap-2 text-xs font-semibold text-white/90">
                                    <span className="flex items-center gap-1.5 truncate">
                                        <i className="ti ti-history text-sm shrink-0" />
                                        <span>
                                            {allPayrolls.length > 0
                                                ? `${allPayrolls.length} statement${allPayrolls.length === 1 ? '' : 's'} on record`
                                                : (isPayHistoryLoading ? 'Checking ledger...' : 'No statements yet')}
                                        </span>
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-[11px] bg-white/20 px-2 py-0.5 rounded shrink-0">
                                        <span>Pay History</span>
                                        <i className="ti ti-chevron-right text-[10px]" />
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Today's shift */}
                    <div className={`relative overflow-hidden ${isTerminated
                        ? 'bg-slate-900 border border-danger/30'
                        : isSuspended
                            ? 'bg-slate-900 border border-warning/30'
                            : 'bg-slate-900 border border-slate-800'
                        } rounded-lg p-5 sm:p-6 md:p-8 shadow-2xs text-white flex flex-col justify-between select-none`}>
                        <div className="relative z-10 flex justify-between items-start">
                            <div className={`w-11 h-11 sm:w-14 sm:h-14 bg-slate-800 border border-slate-700 rounded-md flex items-center justify-center ${isTerminated ? 'text-danger' : isSuspended ? 'text-warning' : 'text-accent-on-dark'
                                } mb-4 sm:mb-6`}>
                                <i className={`ti ${isTerminated ? 'ti-calendar-off' : isSuspended ? 'ti-clock-pause' : (shoeRole ? shoeRole.icon : 'ti-calendar-time')} text-2xl sm:text-3xl`} />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className={`px-2.5 py-1 rounded-md font-semibold text-xs border ${isTerminated
                                    ? 'bg-danger-ink/60 border-danger text-danger'
                                    : isSuspended
                                        ? 'bg-warning-ink/60 border-warning text-warning'
                                        : 'bg-slate-900/60 border-accent text-accent-on-dark'
                                    }`}>
                                    {isTerminated ? 'Separated' : isSuspended ? 'Suspended' : (isFactoryWorker ? (prodGroup || "Factory Line") : "Today's Schedule")}
                                </span>
                            </div>
                        </div>
                        <div className="relative z-10">
                            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-1">
                                {isTerminated ? 'Separation Status' : isSuspended ? 'Work Schedule' : (isFactoryWorker ? `Craft Station · Stage ${shoeRole?.stage || '1-6'}` : 'Official Work Schedule')}
                            </p>
                            <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight leading-tight">
                                {isTerminated ? 'Inactive' : isSuspended ? 'On Hold' : workerClassification}
                            </h2>
                            <p className={`${isTerminated ? 'text-danger/80' : isSuspended ? 'text-warning/80' : 'text-accent-on-dark'
                                } text-xs sm:text-sm mt-1 font-medium flex items-center gap-1.5`}>
                                <i className={`ti ${isTerminated ? 'ti-circle-x' : isSuspended ? 'ti-alert-circle' : 'ti-clock'} text-sm`} />
                                <span>
                                    {isTerminated
                                        ? 'Operational shifts concluded upon separation.'
                                        : isSuspended
                                            ? 'No work schedule during disciplinary suspension.'
                                            : `${workerSchedule} (${overtimePolicy})`}
                                </span>
                            </p>
                        </div>
                    </div>

                </div>

                {/* Secondary actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">

                    {/* Leave request */}
                    <div
                        onClick={() => {
                            if (isTerminated) {
                                toast.error('Leave requests are disabled for separated accounts.');
                                return;
                            }
                            if (isSuspended) {
                                toast.error('Leave requests are disabled while account is on suspension.');
                                return;
                            }
                            setShowLeaveModal(true);
                        }}
                        className={`bg-white rounded-lg p-4 sm:p-6 shadow-2xs border ${isTerminated || isSuspended
                            ? 'opacity-65 cursor-not-allowed border-slate-200 bg-slate-50/50'
                            : 'border-slate-200 cursor-pointer'
                            } flex items-center justify-between select-none`}
                    >
                        <div className="flex items-center gap-4 sm:gap-5">
                            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-md ${isTerminated ? 'bg-danger-subtle text-danger-ink' : isSuspended ? 'bg-warning-subtle text-warning-ink' : 'bg-accent-subtle text-accent'
                                } flex items-center justify-center text-2xl sm:text-3xl shrink-0`}>
                                <i className={`ti ${isTerminated ? 'ti-plane-off' : isSuspended ? 'ti-lock' : 'ti-plane-departure'}`} />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800">
                                    {isTerminated ? 'Leaves Locked' : isSuspended ? 'Leaves Suspended' : 'Request Leave'}
                                </h3>
                                <p className="text-slate-500 text-xs font-medium mt-0.5">
                                    {isTerminated ? 'Separated personnel' : isSuspended ? 'Locked during suspension' : 'Vacation or Sick days'}
                                </p>
                            </div>
                        </div>
                        <div className="w-8 h-8 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                            <i className={`ti ${isTerminated || isSuspended ? 'ti-lock text-sm' : 'ti-plus text-base'}`} />
                        </div>
                    </div>

                    {/* Leave overview */}
                    <div className="bg-white rounded-lg p-4 sm:p-6 shadow-2xs border border-slate-200 flex items-center justify-between select-none">
                        <div className="flex items-center gap-4 sm:gap-5">
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 text-2xl sm:text-3xl shrink-0">
                                <i className="ti ti-clipboard-check" />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800">My Requests</h3>
                                <p className="text-slate-500 text-xs font-medium mt-0.5">
                                    {myLeaves.length} recent application(s)
                                </p>
                            </div>
                        </div>
                        <span className="text-xs font-bold font-mono px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-600">
                            {myLeaves.filter(l => l.status === 'Pending').length} Pending
                        </span>
                    </div>
                </div>

                {/* Medical Grace Protocol Status Card */}
                {isMedicalExempt && !isTerminated && (
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-warning/20">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-warning/20">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-10 h-10 rounded-md bg-warning-subtle border border-warning/20 text-warning-ink flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                    <i className="ti ti-bandage" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            Biometric Medical Grace Protocol Active
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                            <i className="ti ti-shield-check" />
                                            <span>QR Pass Authorized ({daysRemaining} Day{daysRemaining === 1 ? '' : 's'} Left)</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        Facial biometric matching is temporarily bypassed due to medical dressings or injury. Present your QR pass at turnstiles.
                                    </p>
                                </div>
                            </div>

                            <Link
                                to="/employee/qr"
                                className="w-full sm:w-auto h-9 px-4 bg-warning hover:bg-warning-ink text-white text-xs font-medium rounded-md transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-2xs"
                            >
                                <i className="ti ti-qrcode text-sm" />
                                <span>Open Gate Pass QR</span>
                            </Link>
                        </div>

                        {/* Protocol details */}
                        <div className="my-4 p-4 rounded-md bg-warning-subtle/50 border border-warning/20 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-bold text-warning-ink">
                                    <i className="ti ti-first-aid-kit text-warning-ink text-sm" />
                                    <span>Authorized Medical Reason: {medicalExemption.reason || 'Medical Condition / Facial Trauma'}</span>
                                </div>
                                <span className="font-mono text-slate-600 font-semibold">
                                    Valid Through: {new Date(medicalExemption.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </span>
                            </div>
                            {medicalExemption.notes && (
                                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                                    HR Advisory: {medicalExemption.notes}
                                </p>
                            )}
                            {medicalExemption.granted_by && (
                                <p className="text-slate-500 text-[11px] font-medium flex items-center gap-1.5">
                                    <i className="ti ti-user-check text-slate-400" />
                                    <span>Authorized by: <strong className="text-slate-700">{/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(medicalExemption.granted_by) ? 'System Administrator (HR)' : (medicalExemption.granted_by_role ? `${medicalExemption.granted_by} (${medicalExemption.granted_by_role})` : medicalExemption.granted_by)}</strong></span>
                                </p>
                            )}
                            <p className="text-[11px] text-warning-ink font-semibold pt-1 flex items-center gap-1.5">
                                <i className="ti ti-info-circle text-warning-ink shrink-0" />
                                <span>Gate Scanner Note: The turnstile will authenticate your QR code and capture an evidentiary entry snapshot automatically. No facial matching required.</span>
                            </p>
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-surface-muted text-ink flex items-center justify-center shrink-0">
                                    <i className="ti ti-qrcode text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gate QR Pass</p>
                                    <p className="font-bold text-ink truncate">Authorized (QR Only)</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-warning-subtle text-warning-ink flex items-center justify-center shrink-0">
                                    <i className="ti ti-camera text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Turnstile Camera</p>
                                    <p className="font-bold text-slate-800 truncate">Evidentiary Audit Snapshot</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-calendar-time text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Remaining Grace</p>
                                    <p className="font-bold text-slate-800 truncate">{daysRemaining} Day{daysRemaining === 1 ? '' : 's'} Remaining</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Disciplinary record card */}
                {isTerminated ? (
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-danger/20">
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-danger/20">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-10 h-10 rounded-md bg-danger-subtle border border-danger/20 text-danger-ink flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                    <i className="ti ti-user-x" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            Personnel Standing: Separated Account
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                                            <i className="ti ti-circle-x" />
                                            <span>Employment Terminated</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        Official employment has concluded under DOLE Labor Code guidelines. Portal access is restricted to historical records and payslips.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowInfractionsModal(true)}
                                className="w-full sm:w-auto h-9 px-4 bg-slate-900 hover:bg-black text-white text-xs font-medium rounded-md transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-2xs"
                            >
                                <i className="ti ti-file-certificate text-sm" />
                                <span>View Separation Records ({employeeDisciplinary.length})</span>
                            </button>
                        </div>

                        {/* Separation details */}
                        <div className="my-4 p-4 rounded-md bg-danger-subtle/50 border border-danger/20 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-bold text-danger-ink">
                                    <i className="ti ti-info-circle text-danger-ink text-sm" />
                                    <span>Official HR Notice of Separation</span>
                                </div>
                                {terminationRecord?.date && (
                                    <span className="font-mono text-slate-500">
                                        Effective Date: {new Date(terminationRecord.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                                {terminationRecord?.reason || 'Employment contract separated by HR Administration.'}
                            </p>
                            {pastSuspensionsCount > 0 && (
                                <div className="pt-2 border-t border-danger/60 flex items-center gap-2 text-xs text-danger-ink font-semibold">
                                    <i className="ti ti-history text-danger-ink" />
                                    <span>Prior Record: {pastSuspensionsCount} disciplinary suspension memo{pastSuspensionsCount > 1 ? 's' : ''} on official personnel file.</span>
                                </div>
                            )}
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-danger-subtle text-danger-ink flex items-center justify-center shrink-0">
                                    <i className="ti ti-ban text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gate QR Access</p>
                                    <p className="font-bold text-danger-ink truncate">Permanently Disabled</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                                    <i className="ti ti-history text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Disciplinary Audit</p>
                                    <p className="font-bold text-slate-800 truncate">{employeeDisciplinary.length} Recorded Action(s)</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-receipt-2 text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Clearance &amp; Pay</p>
                                    <p className="font-bold text-slate-800 truncate">Contact HR for COE</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : isSuspended ? (
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-warning/20">
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-warning/20">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-10 h-10 rounded-md bg-warning-subtle border border-warning/20 text-warning-ink flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                    <i className="ti ti-clock-pause" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            Disciplinary Suspension Active
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                            <i className="ti ti-clock-pause" />
                                            <span>Suspended · Operational Hold</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        Account is on temporary disciplinary suspension. Premise clock-in and shift assignments are disabled {suspensionEndDate ? `until ${suspensionEndDate}` : ''}.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowInfractionsModal(true)}
                                className="w-full sm:w-auto h-9 px-4 bg-warning hover:bg-warning-ink text-white text-xs font-medium rounded-md transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-2xs"
                            >
                                <i className="ti ti-file-text text-sm" />
                                <span>Review Suspension Memo</span>
                            </button>
                        </div>

                        {/* Suspension Details */}
                        <div className="my-4 p-4 rounded-md bg-warning-subtle/50 border border-warning/20 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-bold text-warning-ink">
                                    <i className="ti ti-alert-triangle text-warning-ink text-sm" />
                                    <span>Official HR Suspension Order</span>
                                </div>
                                <span className="font-bold text-warning-ink">
                                    {suspensionDays ? `${suspensionDays} Days Duration` : 'Temporary Hold'} {suspensionEndDate ? `(Reinstates on ${suspensionEndDate})` : ''}
                                </span>
                            </div>
                            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                                {activeSuspension?.reason || 'Account access is temporarily restricted under disciplinary suspension.'}
                            </p>
                            {pastSuspensionsCount > 1 && (
                                <div className="pt-2 border-t border-warning/60 flex items-center gap-2 text-xs text-warning-ink font-semibold">
                                    <i className="ti ti-history text-warning-ink" />
                                    <span>Prior Record: {pastSuspensionsCount - 1} earlier suspension notice(s) on file.</span>
                                </div>
                            )}
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-warning-subtle text-warning-ink flex items-center justify-center shrink-0">
                                    <i className="ti ti-qrcode-off text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Attendance QR</p>
                                    <p className="font-bold text-warning-ink truncate">Locked (Suspended)</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                                    <i className="ti ti-calendar-pause text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Work Schedule</p>
                                    <p className="font-bold text-slate-800 truncate">No Active Shifts</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-calendar-due text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Reinstatement</p>
                                    <p className="font-bold text-slate-800 truncate">{suspensionEndDate ? `Auto-lift ${suspensionEndDate}` : 'Pending HR Review'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : unresolvedInfractions.length > 0 ? (
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-danger/20">
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-danger/20">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-10 h-10 rounded-md bg-danger-subtle border border-danger/20 text-danger-ink flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                    <i className="ti ti-bell-ringing" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            HR Notice Awaiting Review
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                                            <i className="ti ti-alert-triangle" />
                                            <span>{unresolvedInfractions.length} Action Required</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        Under DOLE due process rules, please review and acknowledge receipt of this official notice.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowInfractionsModal(true)}
                                className="w-full sm:w-auto h-9 px-4 bg-danger hover:bg-danger-ink text-white text-xs font-medium rounded-md transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-2xs"
                            >
                                <i className="ti ti-file-text text-sm" />
                                <span>Review &amp; Acknowledge ({unresolvedInfractions.length})</span>
                            </button>
                        </div>

                        {/* Notice Items */}
                        <div className="space-y-3 pt-4 sm:pt-5">
                            {unresolvedInfractions.map((infraction) => (
                                <div
                                    key={infraction.id}
                                    onClick={() => setShowInfractionsModal(true)}
                                    className="p-4 sm:p-5 rounded-md border border-danger/20 bg-danger-subtle/30 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                                >
                                    <div className="flex items-start gap-3.5 min-w-0">
                                        <div className="w-10 h-10 rounded-md bg-white border border-danger/20 text-danger-ink flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                            <i className="ti ti-file-alert" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h4 className="text-sm sm:text-base font-bold text-slate-900">
                                                    {infraction.type}
                                                </h4>
                                                {infraction.severity && (
                                                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${infraction.severity === 'Critical' ? 'bg-danger-subtle text-danger-ink border-danger/20' :
                                                        infraction.severity === 'High' ? 'bg-warning-subtle text-warning-ink border-warning/20' :
                                                            infraction.severity === 'Medium' ? 'bg-warning-subtle text-warning-ink border-warning/20' :
                                                                'bg-accent-subtle text-accent border-accent/20'
                                                        }`}>
                                                        {infraction.severity}
                                                    </span>
                                                )}
                                                <span className="text-[11px] font-mono text-slate-400">
                                                    REF: DISC-{(infraction.id || '').slice(0, 6).toUpperCase()}
                                                </span>
                                            </div>
                                            <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 leading-relaxed">
                                                {infraction.reason}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-danger/60">
                                        <div className="text-left sm:text-right">
                                            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Issued Date</p>
                                            <p className="text-xs font-bold text-slate-700">
                                                {new Date(infraction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </p>
                                        </div>
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-danger/20 text-danger-ink text-xs font-medium shadow-2xs">
                                            <span>Open Notice</span>
                                            <i className="ti ti-arrow-right text-xs" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Reassurance footer note */}
                        <div className="mt-4 pt-3 border-t border-danger/20 flex items-center gap-2 text-[11px] text-slate-500">
                            <i className="ti ti-info-circle text-danger text-sm shrink-0" />
                            <span>
                                Acknowledgment confirms receipt of memo. Under Philippine labor law, you retain the right to consult HR and submit a written explanation within 5 business days.
                            </span>
                        </div>
                    </div>
                ) : employeeDisciplinary.length > 0 ? (
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                                <div className="w-10 h-10 rounded-md bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                    <i className="ti ti-history" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            HR Standing &amp; Notice History
                                        </h3>
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold ${standing.badgeClass}`}>
                                            <i className={`ti ${standing.icon} text-xs`} />
                                            <span>{standing.badgeLabel}</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        {standing.employeeDescription}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                <button
                                    onClick={() => setShowInfractionsModal(true)}
                                    className="w-full sm:w-auto h-9 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium rounded-md transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                                >
                                    <i className="ti ti-history text-sm text-slate-500" />
                                    <span>Notice History ({employeeDisciplinary.length})</span>
                                </button>
                            </div>
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4 pt-4 border-t border-slate-100 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-surface-muted text-ink flex items-center justify-center shrink-0">
                                    <i className="ti ti-check text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Holds</p>
                                    <p className="font-bold text-slate-800 truncate">0 Pending Holds</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-accent-subtle/60 text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-user-check text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Account Standing</p>
                                    <p className={`font-bold truncate ${standing.tier >= 3 ? 'text-danger-ink' : standing.tier >= 2 ? 'text-warning-ink' : 'text-slate-800'}`}>
                                        {standing.shortLabel || standing.badgeLabel}
                                    </p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                                    <i className="ti ti-folders text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">201 Audit Trail</p>
                                    <p className="font-bold text-slate-800 truncate">{employeeDisciplinary.length} Recorded Action(s)</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                                <div className="w-10 h-10 rounded-md bg-surface-muted border border-line text-ink flex items-center justify-center shrink-0 text-xl shadow-2xs">
                                    <i className="ti ti-shield-check" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            HR Standing &amp; Compliance
                                        </h3>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-surface-muted text-ink border border-line">
                                            <i className="ti ti-circle-check text-xs" />
                                            <span>Good Standing · Clean File</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        Your employment file is completely clear with zero policy infractions or active memos.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                <button
                                    onClick={() => setShowInfractionsModal(true)}
                                    className="w-full sm:w-auto h-9 px-4 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium rounded-md transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                                >
                                    <i className="ti ti-certificate text-sm text-success-ink" />
                                    <span>Compliance File</span>
                                </button>
                            </div>
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4 pt-4 border-t border-slate-100 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-surface-muted text-ink flex items-center justify-center shrink-0">
                                    <i className="ti ti-check text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Notices</p>
                                    <p className="font-bold text-slate-800 truncate">0 Pending</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-accent-subtle/60 text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-scale text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Labor Code / DOLE</p>
                                    <p className="font-bold text-slate-800 truncate">Fully Compliant</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-slate-50 border border-slate-200">
                                <div className="w-7 h-7 rounded-sm bg-accent-subtle/60 text-accent flex items-center justify-center shrink-0">
                                    <i className="ti ti-user-check text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Personnel File</p>
                                    <p className="font-bold text-slate-800 truncate">Clean Record</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}


                {/* Activity timelines */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 pt-2 sm:pt-4">

                    {/* Recent attendance */}
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200">
                        <div className="flex items-center gap-3 mb-5 sm:mb-8">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
                                <i className="ti ti-clock-hour-4 text-lg sm:text-xl" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">Recent Clock-ins</h3>
                        </div>

                        <div className="space-y-4 sm:space-y-6">
                            {recentLogs.length > 0 ? recentLogs.map((log) => {
                                const logDate = new Date(log.date || log.created_at);
                                const statusStr = String(log.status || '').toLowerCase();
                                const isAbsent = statusStr === 'absent';
                                return (
                                    <div key={log.id || log.created_at} className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-sm flex items-center justify-center text-xs font-bold ${isAbsent ? 'bg-danger-subtle text-danger-ink border border-danger/20' : 'bg-slate-900 text-white'
                                                }`}>
                                                <i className={`ti ${isAbsent ? 'ti-x' : 'ti-check'}`} />
                                            </div>
                                            <div>
                                                <p className="text-xs sm:text-sm font-bold text-slate-800">
                                                    {logDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                </p>
                                                <p className="text-[10px] sm:text-xs text-slate-400 font-mono">
                                                    {log.time_in ? new Date(`1970-01-01T${log.time_in}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'} - {log.time_out ? new Date(`1970-01-01T${log.time_out}`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {(log.verification_method === 'TIME_IN_MEDICAL_GRACE' || log.verification_type === 'MEDICAL_GRACE') && (
                                                <span className="px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider bg-warning-subtle text-warning-ink border border-warning/20 flex items-center gap-1">
                                                    <i className="ti ti-bandage text-xs" />
                                                    Medical Grace
                                                </span>
                                            )}
                                            <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider ${isAbsent ? 'bg-danger-subtle text-danger-ink border border-danger/20' : 'bg-slate-900 text-white border border-slate-800'
                                                }`}>
                                                {log.status || 'Present'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <p className="text-xs text-slate-400">No recent logs</p>
                            )}
                        </div>
                    </div>

                    {/* Leave requests */}
                    <div className="bg-white rounded-lg p-5 sm:p-6 shadow-2xs border border-slate-200">
                        <div className="flex items-center gap-3 mb-5 sm:mb-8">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
                                <i className="ti ti-plane-departure text-lg sm:text-xl" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">Recent Leave Requests</h3>
                        </div>

                        <div className="space-y-4">
                            {myLeaves.length > 0 ? myLeaves.slice(0, 4).map((leave) => {
                                const statusColors = {
                                    'Pending': 'bg-warning-subtle text-warning-ink',
                                    'Approved': 'bg-surface-muted text-ink',
                                    'Rejected': 'bg-danger-subtle text-danger-ink'
                                };
                                return (
                                    <div key={leave.id} className="p-3 sm:p-4 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-slate-800 text-sm sm:text-base">{leave.type}</h4>
                                            <p className="text-slate-500 text-xs sm:text-sm mt-0.5 truncate">
                                                {new Date(leave.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(leave.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </p>
                                        </div>
                                        <span className={`px-2.5 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wider shrink-0 ${statusColors[leave.status] || 'bg-slate-200 text-slate-700'}`}>
                                            {leave.status}
                                        </span>
                                    </div>
                                );
                            }) : (
                                <p className="text-xs text-slate-400">No leave requests</p>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* QR modal */}
            {showQrModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={() => setShowQrModal(false)}
                    />
                    <div
                        className="relative bg-white rounded-lg p-6 sm:p-8 w-full max-w-sm text-center shadow-xl border border-slate-200"
                    >
                        {isTerminated ? (
                            <div>
                                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-danger-subtle flex items-center justify-center text-danger-ink text-2xl sm:text-3xl mb-3 sm:mb-4 border border-danger/20">
                                    <i className="ti ti-user-x" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900 tracking-tight">QR Credential Revoked</h2>
                                <p className="text-slate-500 font-medium mt-1 text-xs">Employment account has been separated</p>
                                <div className="my-6 p-4 bg-danger-subtle rounded-md border border-danger/20 text-xs text-danger-ink leading-relaxed font-medium">
                                    Attendance credentials and premise QR codes are permanently invalidated. You may access your past payslips on this portal.
                                </div>
                            </div>
                        ) : isSuspended ? (
                            <div>
                                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-warning-subtle flex items-center justify-center text-warning-ink text-2xl sm:text-3xl mb-3 sm:mb-4 border border-warning/20">
                                    <i className="ti ti-lock" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Attendance QR Suspended</h2>
                                <p className="text-slate-500 font-medium mt-1 text-xs">Credential disabled during disciplinary suspension</p>
                                <div className="my-6 p-4 bg-warning-subtle rounded-md border border-warning/20 text-xs text-warning-ink leading-relaxed font-medium">
                                    Clock-in access is prohibited during your suspension {suspensionEndDate ? `until ${suspensionEndDate}` : ''}. Please acknowledge your notice.
                                </div>
                            </div>
                        ) : !hasFaceBiometrics ? (
                            <div className="py-2 text-center">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-center text-warning-ink mb-3 sm:mb-4 relative">
                                    <i className="ti ti-scan-eye text-3xl sm:text-4xl animate-pulse" />
                                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-warning text-slate-950 flex items-center justify-center text-xs font-black shadow-xs">
                                        <i className="ti ti-lock" />
                                    </div>
                                </div>
                                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                    Biometrics Required
                                </span>
                                <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight mt-2">Turnstile Pass Locked</h2>
                                <p className="text-slate-500 font-medium mt-1 text-xs max-w-sm mx-auto leading-relaxed">
                                    Your dynamic QR turnstile credential will appear automatically once your face biometrics baseline has been registered.
                                </p>

                                <div className="my-4 p-3.5 bg-warning-subtle rounded-md border border-warning/80 text-xs text-warning-ink leading-relaxed font-medium">
                                    Under company attendance policy, employee QR passes must be linked to a verified face scan.
                                </div>

                                <Link
                                    to="/biometric-setup"
                                    className="w-full h-10 bg-accent hover:bg-accent-hover text-white font-medium rounded-md text-xs sm:text-sm flex items-center justify-center gap-2 mb-3 shadow-2xs transition-colors duration-100"
                                >
                                    <i className="ti ti-camera text-base" />
                                    <span>Register face scan</span>
                                </Link>
                            </div>
                        ) : (
                            <div>
                                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-accent flex items-center justify-center text-white font-bold text-2xl sm:text-3xl mb-3 sm:mb-4 border border-accent/20">
                                    {getInitial(user.name)}
                                </div>
                                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{user.name}</h2>
                                <p className="text-slate-500 font-medium mt-0.5 text-sm">{user.department}</p>

                                {isMedicalExempt && (
                                    <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                        <i className="ti ti-bandage text-sm" />
                                        <span>Medical exemption on file ({daysRemaining}d left)</span>
                                    </div>
                                )}

                                <div className="my-5 sm:my-6 bg-slate-50 p-5 sm:p-6 rounded-md border border-slate-200 inline-block">
                                    <QRCode value={user.id || '0'} size={180} fgColor="#1e293b" />
                                </div>

                                {isMedicalExempt ? (
                                    <p className="text-warning-ink font-semibold text-xs mb-4">
                                        Scan QR at gate · Camera will record audit snapshot
                                    </p>
                                ) : (
                                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-4 sm:mb-6">Hold near the scanner</p>
                                )}
                            </div>
                        )}

                        <button onClick={() => setShowQrModal(false)} className="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium rounded-md text-sm transition-colors duration-100 cursor-pointer">
                            Close
                        </button>
                    </div>
                </div>
            )}


            {/* Historical / Official Payslip Modal */}
            {showPayslipModal && payslipView === 'history' && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70 transition-opacity"
                        onClick={() => setShowPayslipModal(false)}
                    />
                    <div className="relative bg-white rounded-t-2xl sm:rounded-lg w-full max-w-2xl overflow-hidden shadow-xl h-[92dvh] sm:h-auto sm:max-h-[92vh] flex flex-col border border-slate-200 text-left">
                        {/* Modal Header */}
                        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between gap-3 bg-white">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-md bg-accent text-white flex items-center justify-center shrink-0 shadow-2xs">
                                    <i className="ti ti-wallet text-xl" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-none">
                                            Pay History &amp; Remuneration
                                        </h2>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPayslipModal(false)}
                                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition cursor-pointer"
                                title="Close Modal"
                            >
                                <i className="ti ti-x text-lg" />
                            </button>
                        </div>

                        {/* Financial Ledger Summary Ribbon */}
                        {allPayrolls.length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 sm:px-5 sm:py-3.5 bg-slate-50 border-b border-slate-200 text-left">
                                <div className="p-2.5 bg-white rounded-md border border-slate-200/80 shadow-2xs">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                                        {isPayFiltered ? 'Filtered Net' : 'Total Net Disbursed'}
                                    </span>
                                    <div className="text-sm sm:text-base font-black font-mono text-slate-900 tabular-nums">
                                        {formatCurrency(payHistorySummary.totalNet)}
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-medium block">
                                        {payHistorySummary.count} statement{payHistorySummary.count === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <div className="p-2.5 bg-white rounded-md border border-slate-200/80 shadow-2xs">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                                        Average Take-Home
                                    </span>
                                    <div className="text-sm sm:text-base font-black font-mono text-slate-900 tabular-nums">
                                        {formatCurrency(payHistorySummary.avgNet)}
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-medium block">
                                        Per cycle
                                    </span>
                                </div>
                                <div className="col-span-2 sm:col-span-1 p-2.5 bg-white rounded-md border border-slate-200/80 shadow-2xs">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                                        Latest Disbursement
                                    </span>
                                    <div className="text-sm sm:text-base font-black font-mono text-accent tabular-nums">
                                        {latestPayroll ? formatCurrency(parsePayrollFinancials(latestPayroll).netPay) : '₱0.00'}
                                    </div>
                                    <span className="text-[10px] text-slate-500 font-medium block truncate">
                                        {latestPayroll?.period_end ? dayjs(latestPayroll.period_end).format('MMM DD, YYYY') : 'Most recent'}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Search & Filter Bar */}
                        {(allPayrolls.length > PAY_FILTER_MIN || isPayFiltered) && (
                            <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-white flex items-center justify-between gap-2.5 flex-wrap">
                                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[240px]">
                                    <div className="relative min-w-[130px] flex-1 sm:flex-initial">
                                        <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
                                        <input
                                            type="text"
                                            value={paySearchQuery}
                                            onChange={(e) => setPaySearchQuery(e.target.value)}
                                            placeholder="Search cycle, date..."
                                            className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:ring-1 focus:ring-slate-400 transition"
                                        />
                                    </div>
                                    {allPayrolls.length > PAY_FILTER_MIN && (
                                        <>
                                            <div className="relative">
                                                <select
                                                    value={filterYear}
                                                    onChange={(e) => { setFilterYear(e.target.value); setFilterMonth('all'); }}
                                                    className="appearance-none pl-2.5 pr-7 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-xs font-mono font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer transition"
                                                >
                                                    <option value="all">All Years</option>
                                                    {payYears.map((y) => (
                                                        <option key={y} value={y}>{y}</option>
                                                    ))}
                                                </select>
                                                <i className="ti ti-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none" />
                                            </div>
                                            <div className="relative">
                                                <select
                                                    value={filterMonth}
                                                    onChange={(e) => setFilterMonth(e.target.value)}
                                                    className="appearance-none pl-2.5 pr-7 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-xs font-mono font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer transition"
                                                >
                                                    <option value="all">All Months</option>
                                                    {payMonths.map((m) => (
                                                        <option key={m} value={m}>{dayjs().month(m).format('MMMM')}</option>
                                                    ))}
                                                </select>
                                                <i className="ti ti-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none" />
                                            </div>
                                        </>
                                    )}
                                </div>
                                {isPayFiltered && (
                                    <button
                                        type="button"
                                        onClick={() => { setFilterYear('all'); setFilterMonth('all'); setPaySearchQuery(''); }}
                                        className="h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors duration-100 cursor-pointer flex items-center gap-1"
                                    >
                                        <i className="ti ti-rotate-clockwise text-xs" />
                                        <span>Reset</span>
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Statement List */}
                        <div className="overflow-y-auto p-3 sm:p-5 space-y-2.5 flex-1 min-h-[220px]">
                            {/* Loading State */}
                            {history.isError && <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                                <span>Pay history could not refresh. Previously loaded statements may be out of date.</span>
                                <button type="button" disabled={history.isFetching} onClick={() => history.refetch()} className="font-semibold text-blue-700 disabled:opacity-50">Retry</button>
                            </div>}
                            {isPayHistoryLoading && allPayrolls.length === 0 && (
                                <div className="space-y-2.5 animate-pulse py-4">
                                    {[1, 2, 3].map((n) => (
                                        <div key={n} className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-md bg-slate-200" />
                                                <div className="space-y-2">
                                                    <div className="h-4 w-40 bg-slate-200 rounded" />
                                                    <div className="h-3 w-48 bg-slate-100 rounded" />
                                                </div>
                                            </div>
                                            <div className="h-5 w-24 bg-slate-200 rounded" />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Empty State */}
                            {!isPayHistoryLoading && !history.isError && filteredPayrolls.length === 0 && (
                                <div className="py-12 px-4 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                                    <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 mx-auto flex items-center justify-center text-lg mb-2">
                                        <i className="ti ti-file-search" />
                                    </div>
                                    <h4 className="text-xs sm:text-sm font-bold text-slate-800">No pay records match your criteria</h4>
                                    <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                                        {isPayFiltered ? 'Try clearing your year, month, or search keywords to view all payslips.' : 'No compensation statements have been issued to this profile yet.'}
                                    </p>
                                    {isPayFiltered && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFilterYear('all');
                                                setFilterMonth('all');
                                                setPaySearchQuery('');
                                            }}
                                            className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md shadow-2xs cursor-pointer transition-colors"
                                        >
                                            <i className="ti ti-rotate-clockwise text-xs" />
                                            <span>Reset Filters</span>
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Rendered Statements */}
                            {filteredPayrolls.map((p, idx) => {
                                const financials = parsePayrollFinancials(p);
                                const isLatest = p === latestPayroll;
                                const periodStartText = p.period_start ? dayjs(p.period_start).format('MMM DD') : 'N/A';
                                const periodEndText = p.period_end ? dayjs(p.period_end).format('MMM DD, YYYY') : 'N/A';
                                const paymentDateText = p.created_at ? dayjs(p.created_at).format('MMM DD, YYYY') : 'N/A';
                                const frequencyTag = p.pay_frequency ? String(p.pay_frequency).toUpperCase() : (isFactoryWorker ? 'PIECE-RATE' : 'SEMI-MONTHLY');
                                const voucherId = p.id ? `PAY-${String(p.id).slice(0, 8).toUpperCase()}` : 'RECORD';

                                return (
                                    <div
                                        key={p.id || idx}
                                        onClick={() => {
                                            setSelectedPayslipId(p.id);
                                            setPayslipView('detail');
                                        }}
                                        className={`relative p-3.5 sm:p-4 rounded-lg border cursor-pointer select-none ${
                                            isLatest
                                                ? 'border-accent/40 bg-accent-subtle/15 shadow-2xs'
                                                : 'border-slate-200 bg-white shadow-2xs'
                                        }`}
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <div className="flex items-start gap-3">
                                                <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 text-base ${
                                                    isLatest ? 'bg-accent text-white shadow-2xs' : 'bg-slate-100 text-slate-700 border border-slate-200'
                                                }`}>
                                                    <i className="ti ti-file-certificate" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight">
                                                            {periodStartText} – {periodEndText}
                                                        </span>
                                                        {isLatest && (
                                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-900 text-white tracking-wider">
                                                                Latest
                                                            </span>
                                                        )}
                                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                                            {frequencyTag}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 font-medium mt-1 flex items-center gap-2 flex-wrap">
                                                        <span className="flex items-center gap-1">
                                                            <i className="ti ti-calendar text-xs" />
                                                            <span>Disbursed: {paymentDateText}</span>
                                                        </span>
                                                        <span>•</span>
                                                        <span className="font-mono text-slate-600 font-semibold">
                                                            #{voucherId}
                                                        </span>
                                                        <span>•</span>
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-surface-muted text-ink border border-line">
                                                            {p.status || 'Released'}
                                                        </span>
                                                        {financials.grossEarnings > 0 && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="font-mono text-slate-600">
                                                                    Gross: {formatCurrency(financials.grossEarnings)}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                                <div className="text-left sm:text-right">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block sm:hidden">
                                                        Net Take-Home
                                                    </span>
                                                    <span className="font-mono font-black text-sm sm:text-base text-slate-900 tabular-nums">
                                                        {formatCurrency(financials.netPay)}
                                                    </span>
                                                </div>
                                                <div className="w-8 h-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                                                    <i className="ti ti-chevron-right text-sm" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-3.5 sm:px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))]">
                            <span className="text-[11px] text-slate-500 font-medium">
                                Showing {filteredPayrolls.length} of {allPayrolls.length} statement{allPayrolls.length === 1 ? '' : 's'}
                            </span>
                            <button
                                onClick={() => setShowPayslipModal(false)}
                                className="h-8.5 px-5 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer shadow-2xs"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showPayslipModal && currentPayslip && payslipView === 'detail' && (() => {
                const activePayroll = currentPayslip;
                const financials = parsePayrollFinancials(activePayroll);
                const emp = activePayroll.employees || liveEmployee || user;
                const fullName = emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.name || 'Employee' : 'Employee';
                const voucherId = activePayroll.id ? `PAY-${String(activePayroll.id).slice(0, 8).toUpperCase()}` : 'RECORD';
                const periodStart = activePayroll.period_start ? dayjs(activePayroll.period_start).format('MMM DD, YYYY') : 'N/A';
                const periodEnd = activePayroll.period_end ? dayjs(activePayroll.period_end).format('MMM DD, YYYY') : 'N/A';
                const paymentDate = activePayroll.created_at ? dayjs(activePayroll.created_at).format('MMM DD, YYYY') : dayjs().format('MMM DD, YYYY');

                return (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        {/* Print styles for payslip isolation */}
                        <style>{`
                            @media print {
                                body * { visibility: hidden !important; }
                                #employee-payslip-modal, #employee-payslip-modal * { visibility: visible !important; }
                                #employee-payslip-modal {
                                    position: fixed !important;
                                    left: 0 !important;
                                    top: 0 !important;
                                    width: 100% !important;
                                    height: auto !important;
                                    margin: 0 !important;
                                    padding: 0 !important;
                                    box-shadow: none !important;
                                    border: none !important;
                                }
                                .no-print { display: none !important; }
                            }
                        `}</style>

                        <div
                            className="absolute inset-0 bg-slate-950/70 transition-opacity"
                            onClick={() => setShowPayslipModal(false)}
                        />

                        <div
                            id="employee-payslip-modal"
                            className="relative bg-white rounded-t-2xl sm:rounded-lg w-full max-w-2xl overflow-hidden shadow-xl h-[100dvh] sm:h-auto sm:max-h-[92vh] flex flex-col border-t sm:border border-slate-200 text-left print:border-none print:shadow-none print:h-auto print:max-h-none print:rounded-none"
                        >
                            {/* Top Navigation & Action Strip */}
                            <div className="no-print px-3 sm:px-6 py-2 sm:py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-1.5 sm:gap-2 text-xs shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setPayslipView('history')}
                                    className="inline-flex items-center gap-1 sm:gap-1.5 font-semibold text-slate-700 hover:text-slate-900 transition-colors py-1 px-1.5 sm:px-2.5 -ml-1 sm:-ml-2 rounded-md hover:bg-slate-200/70 cursor-pointer text-xs"
                                >
                                    <i className="ti ti-arrow-left text-sm" />
                                    <span className="hidden xs:inline sm:inline">Back to </span>
                                    <span>History</span>
                                </button>
                                <div className="flex items-center gap-1 sm:gap-2">
                                    {allPayrolls.length > 1 && currentPayslipIndex !== -1 && (
                                        <div className="flex items-center gap-0.5 sm:gap-1 bg-white border border-slate-200 rounded-md p-0.5 shadow-2xs">
                                            <button
                                                type="button"
                                                disabled={currentPayslipIndex >= allPayrolls.length - 1}
                                                onClick={() => {
                                                    const olderP = allPayrolls[currentPayslipIndex + 1];
                                                    if (olderP) setSelectedPayslipId(olderP.id);
                                                }}
                                                title="Older statement"
                                                className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-slate-100 transition cursor-pointer"
                                            >
                                                <i className="ti ti-chevron-left text-xs" />
                                            </button>
                                            <span className="px-1.5 sm:px-2 text-[10px] sm:text-[11px] font-mono font-medium text-slate-600 select-none">
                                                {currentPayslipIndex + 1}/{allPayrolls.length}
                                            </span>
                                            <button
                                                type="button"
                                                disabled={currentPayslipIndex <= 0}
                                                onClick={() => {
                                                    const newerP = allPayrolls[currentPayslipIndex - 1];
                                                    if (newerP) setSelectedPayslipId(newerP.id);
                                                }}
                                                title="Newer statement"
                                                className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-slate-100 transition cursor-pointer"
                                            >
                                                <i className="ti ti-chevron-right text-xs" />
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setShowPayslipModal(false)}
                                        className="p-1 sm:p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition cursor-pointer"
                                        title="Close"
                                    >
                                        <i className="ti ti-x text-base" />
                                    </button>
                                </div>
                            </div>

                            {/* 1. Header: Corporate Letterhead */}
                            <div className="p-3.5 sm:p-6 bg-white border-b border-slate-200 print:bg-transparent shrink-0">
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2.5 sm:gap-3">
                                            <picture className="shrink-0">
                                                <source srcSet="/logo-icon-dark.webp" type="image/webp" />
                                                <img
                                                    src="/logo-icon-dark.png"
                                                    alt="C-Point"
                                                    width="36"
                                                    height="36"
                                                    loading="eager"
                                                    decoding="sync"
                                                    className="w-8 h-8 sm:w-9 sm:h-9 object-contain shrink-0"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null;
                                                        e.currentTarget.src = '/logo-icon.png';
                                                    }}
                                                />
                                            </picture>
                                            <div className="min-w-0">
                                                <h1 className="text-sm sm:text-base font-black text-slate-900 tracking-tight leading-none uppercase truncate">C-POINT HRIS</h1>
                                                <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium tracking-wide mt-0.5 truncate">Manufacturing &amp; Human Capital Operations</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                                        <div className="sm:text-right">
                                            <span className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest block">Confidential Document</span>
                                            <h2 className="text-xs sm:text-base font-black text-slate-900 tracking-tight leading-tight">
                                                {isTerminated ? 'SEPARATION PAYSLIP' : 'EMPLOYEE PAYSLIP'}
                                            </h2>
                                        </div>
                                        <div className="flex items-center gap-1.5 sm:mt-1 sm:justify-end">
                                            <span className="font-mono text-[10px] sm:text-[11px] font-semibold text-slate-700 bg-slate-100 px-1.5 sm:px-2 py-0.5 rounded border border-slate-200">
                                                #{voucherId}
                                            </span>
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase bg-surface-muted text-ink border border-line">
                                                {activePayroll.status || 'Released'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 2. Telemetry Strip */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 border-b border-slate-200 bg-slate-50/75 text-xs divide-y-0 sm:divide-y-0 sm:divide-x divide-slate-200 shrink-0">
                                <div className="col-span-2 sm:col-span-1 p-2.5 sm:p-3 sm:px-4 border-b sm:border-b-0 border-slate-200">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Pay Period</span>
                                    <span className="font-semibold text-slate-800 block text-xs">
                                        {periodStart} – {periodEnd}
                                    </span>
                                </div>
                                <div className="col-span-1 p-2.5 sm:p-3 sm:px-4 border-r sm:border-r-0 border-slate-200">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Payment Date</span>
                                    <span className="font-semibold text-slate-800 block text-xs">
                                        {paymentDate}
                                    </span>
                                </div>
                                <div className="col-span-1 p-2.5 sm:p-3 sm:px-4">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Currency</span>
                                    <span className="font-semibold text-slate-800 block text-xs font-mono">
                                        PHP (₱)
                                    </span>
                                </div>
                            </div>


                            {/* 3. Employee Profile & Statutory Identifiers */}
                            <div className="p-3 sm:p-5 border-b border-slate-200 bg-white shrink-0">
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-center">
                                    <div className="sm:col-span-6 flex items-center gap-2.5 sm:gap-3 min-w-0">
                                        <EmployeeAvatar
                                            employee={emp}
                                            size="h-9 w-9 sm:h-10 sm:w-10"
                                            rounded="rounded-md"
                                            border="border border-slate-200"
                                            shadow="shadow-2xs"
                                            theme="emerald"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Employee Details</span>
                                            <h3 className="text-xs sm:text-base font-bold text-slate-900 leading-snug truncate">
                                                {fullName}
                                            </h3>
                                            <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                                                <span className="font-mono font-semibold text-slate-700">{emp?.company_id || 'ID N/A'}</span>
                                                {' • '}
                                                <span>{emp?.job_title || emp?.role || 'Staff'}</span>
                                                {' • '}
                                                <span className="text-slate-600">{emp?.department || 'Operations'}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="sm:col-span-6 border-t sm:border-t-0 sm:border-l border-slate-200 pt-2 sm:pt-0 sm:pl-4">
                                        <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Mandatory Statutory Identifiers</span>
                                        <div className="grid grid-cols-2 gap-x-2 sm:gap-x-3 gap-y-1 text-xs">
                                            <div className="truncate">
                                                <span className="text-slate-400 text-[9px] sm:text-[10px]">TIN:</span>{' '}
                                                <span className="font-mono font-semibold text-slate-700 text-[10px] sm:text-[11px]">{emp?.tin || 'Not Provided'}</span>
                                            </div>
                                            <div className="truncate">
                                                <span className="text-slate-400 text-[9px] sm:text-[10px]">SSS:</span>{' '}
                                                <span className="font-mono font-semibold text-slate-700 text-[10px] sm:text-[11px]">{emp?.sss_no || 'Recorded'}</span>
                                            </div>
                                            <div className="truncate">
                                                <span className="text-slate-400 text-[9px] sm:text-[10px]">PhilHealth:</span>{' '}
                                                <span className="font-mono font-semibold text-slate-700 text-[10px] sm:text-[11px]">{emp?.philhealth_no || 'Recorded'}</span>
                                            </div>
                                            <div className="truncate">
                                                <span className="text-slate-400 text-[9px] sm:text-[10px]">Pag-IBIG:</span>{' '}
                                                <span className="font-mono font-semibold text-slate-700 text-[10px] sm:text-[11px]">{emp?.pagibig_no || 'Recorded'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 4. Scrollable Ledger Body */}
                            <div className="flex-1 overflow-y-auto overscroll-contain p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 text-left">
                                {/* Holiday Pay Callout if present */}
                                {financials.hasHolidayPay && (
                                    <div className="border border-warning/20 bg-warning-subtle/50 rounded-md p-3">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-1.5">
                                                <i className="ti ti-calendar-event text-ink text-xs" />
                                                <h4 className="text-[11px] font-bold text-ink uppercase tracking-wider">DOLE Holiday Premium Compensation</h4>
                                            </div>
                                            <span className="font-mono font-bold text-ink text-xs">
                                                +{formatCurrency(financials.holidayPay)}
                                            </span>
                                        </div>
                                        <div className="divide-y divide-warning/20 border-t border-warning/60 pt-1 text-xs">
                                            {financials.paidHolidayItems.map((item, idx) => (
                                                <div key={item.date || idx} className="py-1 flex items-center justify-between text-slate-700 text-[11px]">
                                                    <span>
                                                        <span className="font-semibold">{dayjs(item.date).format('MMM DD, YYYY')}</span> – {item.holidayName || HOLIDAY_LABELS[item.holidayType] || 'Holiday'}
                                                        <span className="text-slate-400 ml-1">({item.worked ? `Worked • ${(Number(item.multiplier || 1) * 100).toFixed(0)}%` : 'Unworked • Paid'})</span>
                                                    </span>
                                                    <span className="font-mono font-semibold text-success-ink">
                                                        +{formatCurrency(item.pay)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Dual-Ledger Corporate Table */}
                                <div className="border border-slate-200 rounded-md overflow-hidden">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">

                                        {/* LEFT: EARNINGS */}
                                        <div className="flex flex-col justify-between">
                                            <div>
                                                <div className="bg-slate-100/75 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                                                    <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                                        <i className="ti ti-cash text-slate-500 text-xs" />
                                                        <span>Earnings (Gross)</span>
                                                    </h4>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Amount</span>
                                                </div>

                                                <div className="p-3.5 space-y-2 text-xs">
                                                    <div className="flex justify-between items-center py-1 border-b border-slate-100">
                                                        <div>
                                                            <span className="font-semibold text-slate-800 block">Basic Pay</span>
                                                            <span className="text-[10px] text-slate-400">Regular Salary Cutoff</span>
                                                        </div>
                                                        <span className="font-mono font-semibold text-slate-800 text-xs sm:text-sm">
                                                            {formatCurrency(financials.basicPay)}
                                                        </span>
                                                    </div>

                                                    <div className="flex justify-between items-center py-1 border-b border-slate-100">
                                                        <div>
                                                            <span className="font-semibold text-slate-800 block">Overtime Pay</span>
                                                            <span className="text-[10px] text-slate-400">Approved Premium Hours</span>
                                                        </div>
                                                        <span className={`font-mono font-semibold text-xs sm:text-sm ${financials.overtimePay > 0 ? 'text-ink' : 'text-slate-400'}`}>
                                                            {financials.overtimePay > 0 ? '+' : ''}{formatCurrency(financials.overtimePay)}
                                                        </span>
                                                    </div>

                                                    {financials.hasHolidayPay && (
                                                        <div className="flex justify-between items-center py-1 border-b border-slate-100">
                                                            <div>
                                                                <span className="font-semibold text-slate-800 block">Holiday Premium</span>
                                                                <span className="text-[10px] text-slate-400">DOLE Statutory Premium</span>
                                                            </div>
                                                            <span className="font-mono font-semibold text-ink text-xs sm:text-sm">
                                                                +{formatCurrency(financials.holidayPay)}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="bg-slate-50 px-3.5 py-2.5 border-t border-slate-200 flex justify-between items-center">
                                                <span className="text-[11px] font-bold uppercase text-slate-700 tracking-wide">Gross Earnings</span>
                                                <span className="font-mono font-bold text-slate-900 text-sm">
                                                    {formatCurrency(financials.grossEarnings)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* RIGHT: DEDUCTIONS */}
                                        <div className="flex flex-col justify-between">
                                            <div>
                                                <div className="bg-slate-100/75 px-3.5 py-2 border-b border-slate-200 flex items-center justify-between">
                                                    <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                                        <i className="ti ti-receipt-tax text-slate-500 text-xs" />
                                                        <span>Deductions &amp; Withholdings</span>
                                                    </h4>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Amount</span>
                                                </div>

                                                <div className="p-3.5 space-y-2 text-xs">
                                                    {financials.deductionsList.length > 0 ? (
                                                        financials.deductionsList.map((ded, index) => {
                                                            let percentageDisplay = null;
                                                            if (financials.grossEarnings > 0 && ded.amount > 0) {
                                                                const percentage = ((ded.amount / financials.grossEarnings) * 100).toFixed(1);
                                                                percentageDisplay = (
                                                                    <span className="text-[9px] font-mono text-danger-ink bg-danger-subtle px-1 py-0.2 rounded border border-danger/20 ml-1.5">
                                                                        {percentage}%
                                                                    </span>
                                                                );
                                                            }

                                                            return (
                                                                <div key={index} className="flex justify-between items-center py-1 border-b border-slate-100">
                                                                    <div className="flex items-center">
                                                                        <span className="font-semibold text-slate-800">{ded.name}</span>
                                                                        {percentageDisplay}
                                                                    </div>
                                                                    <span className="font-mono font-semibold text-danger-ink text-xs sm:text-sm">
                                                                        -{formatCurrency(ded.amount)}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <div className="py-4 text-center text-slate-400 text-xs">
                                                            No deductions recorded for this cutoff.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="bg-slate-50 px-3.5 py-2.5 border-t border-slate-200 flex justify-between items-center">
                                                <span className="text-[11px] font-bold uppercase text-ink tracking-wide">Total Deductions</span>
                                                <span className="font-mono font-bold text-danger-ink text-sm">
                                                    -{formatCurrency(financials.totalDeductions)}
                                                </span>
                                            </div>
                                        </div>

                                    </div>
                                </div>

                                {/* 5. Executive Net Take-Home Pay Settlement Strip */}
                                <div className="border border-slate-900 bg-slate-900 text-white rounded-md p-3.5 sm:p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-xs print:bg-transparent print:text-slate-900 print:border-2 print:border-slate-900">
                                    <div className="min-w-0">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block print:text-slate-600">Net Take-Home Pay</span>
                                        <div className="flex items-baseline gap-2 mt-0.5">
                                            <span className="text-xl sm:text-3xl font-black font-mono tracking-tight text-white print:text-slate-900 break-words">
                                                {formatCurrency(financials.netPay)}
                                            </span>
                                        </div>
                                        <span className="text-[10px] sm:text-[11px] text-slate-400 mt-1 block font-mono print:text-slate-600 break-words leading-relaxed">
                                            Net Calculation: {formatCurrency(financials.grossEarnings)} (Gross) – {formatCurrency(financials.totalDeductions)} (Deductions)
                                        </span>
                                    </div>

                                    <div className="text-left sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800 w-full sm:w-auto">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block print:text-slate-700">Account Settlement</span>
                                        <span className="text-xs text-slate-300 print:text-slate-700 font-medium mt-0.5 block">Official Remuneration Voucher</span>
                                    </div>
                                </div>


                                <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-200/80 pt-3">
                                    <strong>DOLE Compliance Note:</strong> This statement is an official certificate of compensation prepared under Philippine Labor Standards (DOLE DO 147-15). All statutory withholdings for SSS, PhilHealth, Pag-IBIG, and Bureau of Internal Revenue (BIR) taxes are computed and remitted on behalf of the employee.
                                </p>
                            </div>

                            {/* 6. Footer Actions */}
                            <div className="no-print p-3 sm:px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shrink-0">
                                <button
                                    type="button"
                                    onClick={() => window.print()}
                                    className="h-9 px-3.5 sm:px-4 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium rounded-md text-xs flex items-center justify-center gap-1.5 transition-colors duration-100 cursor-pointer shadow-2xs"
                                >
                                    <i className="ti ti-printer text-sm" />
                                    <span>Print / Export PDF</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowPayslipModal(false)}
                                    className="h-9 px-5 sm:px-6 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer shadow-2xs"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}


            {/* Leave request modal */}
            {showLeaveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={() => setShowLeaveModal(false)}
                    />
                    <div
                        className="relative bg-white rounded-lg w-full max-w-md overflow-hidden shadow-xl border border-slate-200 p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex justify-between items-center mb-5 sm:mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-md bg-accent-subtle border border-accent/20 text-accent flex items-center justify-center text-xl">
                                    <i className="ti ti-plane-departure" />
                                </div>
                                <h2 className="text-lg sm:text-xl font-bold text-slate-800">Time Off Request</h2>
                            </div>
                            <button
                                onClick={() => setShowLeaveModal(false)}
                                className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer transition-colors duration-100"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        <form onSubmit={handleLeaveSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1.5">Leave Type</label>
                                <select
                                    value={leaveForm.leave_type}
                                    onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}
                                    className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 font-medium text-slate-700 text-xs sm:text-sm transition-colors duration-100 appearance-none"
                                >
                                    <option>Sick Leave</option>
                                    <option>Vacation / PTO</option>
                                    <option>Maternity/Paternity</option>
                                    <option>Emergency Leave</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1.5">First Day</label>
                                    <input
                                        type="date" required
                                        value={leaveForm.start_date}
                                        onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                                        className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 font-medium text-slate-700 text-xs sm:text-sm transition-colors duration-100"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Last Day</label>
                                    <input
                                        type="date" required
                                        value={leaveForm.end_date}
                                        onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                                        className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 font-medium text-slate-700 text-xs sm:text-sm transition-colors duration-100"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1.5">Reason for Absence</label>
                                <textarea
                                    required rows="3"
                                    value={leaveForm.reason}
                                    onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 font-medium text-slate-700 text-xs sm:text-sm transition-colors duration-100 resize-none"
                                    placeholder="State purpose of leave request..."
                                />
                            </div>

                            <div className="pt-2">
                                <button
                                    disabled={isSubmittingLeave}
                                    type="submit"
                                    className="w-full h-10 bg-accent hover:bg-accent-hover text-white font-medium rounded-md shadow-2xs text-xs sm:text-sm disabled:opacity-50 flex justify-center items-center gap-2 transition-colors duration-100 cursor-pointer"
                                >
                                    {isSubmittingLeave ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Submit Request'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Disciplinary Notices Modal */}
            {showInfractionsModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70 transition-opacity"
                        onClick={() => setShowInfractionsModal(false)}
                    />
                    <div className="relative bg-white rounded-lg w-full max-w-xl overflow-hidden shadow-xl border border-slate-200 z-10 max-h-[90vh] flex flex-col">
                        {/* Header */}
                        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 border ${isTerminated
                                    ? 'bg-danger-subtle border-danger/20 text-danger-ink'
                                    : isSuspended
                                        ? 'bg-warning-subtle border-warning/20 text-warning-ink'
                                        : unresolvedInfractions.length > 0
                                            ? 'bg-danger-subtle border-danger/20 text-danger-ink'
                                            : 'bg-success-subtle border-success/20 text-success-ink'
                                    }`}>
                                    <i className={`ti ${isTerminated
                                        ? 'ti-user-x'
                                        : isSuspended
                                            ? 'ti-clock-pause'
                                            : unresolvedInfractions.length > 0
                                                ? 'ti-shield-alert'
                                                : 'ti-shield-check'
                                        } text-xl`} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                                        {isTerminated
                                            ? 'Separation & Disciplinary File'
                                            : isSuspended
                                                ? 'Suspension & Disciplinary Order'
                                                : unresolvedInfractions.length > 0
                                                    ? 'Disciplinary & Policy Notices'
                                                    : 'Compliance & Personnel Standing'}
                                    </h2>
                                    <p className="text-xs text-slate-500 font-medium">
                                        {isTerminated
                                            ? `Official Separation Record (${employeeDisciplinary.length} memos on file)`
                                            : isSuspended
                                                ? 'Active Suspension Order & History'
                                                : unresolvedInfractions.length > 0
                                                    ? 'Action Required · Official HR Records'
                                                    : `Official Personnel File · ${standing.badgeLabel}`}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowInfractionsModal(false)}
                                className="w-8 h-8 rounded-md bg-white border border-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors duration-100 cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        {/* Content Body */}
                        <div className="overflow-y-auto p-5 sm:p-6 space-y-4">
                            {employeeDisciplinary.length > 0 ? (
                                employeeDisciplinary.map((record) => {
                                    const isPending = record.status === 'Active';
                                    const isAcknowledged = record.status === 'Acknowledged';
                                    const isResolved = record.status === 'Resolved';

                                    const sevColors = {
                                        Critical: 'bg-danger-subtle text-danger-ink border-danger/20',
                                        High: 'bg-warning-subtle text-warning-ink border-warning/20',
                                        Medium: 'bg-warning-subtle text-warning-ink border-warning/20',
                                        Low: 'bg-accent-subtle text-accent border-accent/20'
                                    }[record.severity] || 'bg-slate-100 text-slate-700 border-slate-200';

                                    const statColors = {
                                        Active: 'bg-danger-subtle text-danger-ink border-danger/20',
                                        Acknowledged: 'bg-surface-muted text-ink border-line',
                                        Resolved: 'bg-slate-100 text-slate-600 border-slate-200',
                                        'Under Review': 'bg-accent-subtle text-accent border-accent/20'
                                    }[record.status] || 'bg-slate-100 text-slate-700 border-slate-200';

                                    return (
                                        <div
                                            key={record.id}
                                            className={`p-4 sm:p-5 rounded-md border transition-colors duration-100 ${isPending
                                                ? 'bg-danger-subtle/40 border-danger/20 shadow-2xs'
                                                : 'bg-white border-slate-200'
                                                }`}
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md border ${sevColors}`}>
                                                        {record.severity} Severity
                                                    </span>
                                                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${statColors}`}>
                                                        {record.status === 'Active' ? 'Action Required' : record.status}
                                                    </span>
                                                </div>
                                                <span className="text-[11px] font-mono text-slate-400">
                                                    {new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                </span>
                                            </div>

                                            <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-1.5 flex items-center gap-2">
                                                <span>{record.type}</span>
                                                <span className="text-[11px] font-mono text-slate-400 font-normal">REF: DISC-{(record.id || '').slice(0, 6).toUpperCase()}</span>
                                            </h3>

                                            <div className="bg-white/80 p-3 rounded-sm border border-slate-200/80 mb-3">
                                                <p className="text-xs text-slate-700 leading-relaxed font-medium">{record.reason}</p>
                                            </div>

                                            {isPending && (
                                                <div className="pt-1">
                                                    <button
                                                        disabled={acknowledgingId !== null}
                                                        onClick={() => handleAcknowledgeSingle(record.id)}
                                                        className="w-full h-9 bg-slate-900 hover:bg-black text-white font-medium text-xs rounded-md transition-colors duration-100 flex items-center justify-center gap-2 shadow-2xs disabled:opacity-50 cursor-pointer"
                                                    >
                                                        {acknowledgingId === record.id || acknowledgingId === 'all' ? (
                                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                        ) : (
                                                            <>
                                                                <i className="ti ti-check text-sm" />
                                                                <span>Acknowledge Receipt of Notice</span>
                                                            </>
                                                        )}
                                                    </button>
                                                    <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
                                                        * Confirms receipt under DOLE due process rules. You may consult HR and submit a written explanation within 5 working days.
                                                    </p>
                                                </div>
                                            )}

                                            {isAcknowledged && (
                                                <div className="flex items-center gap-2 text-xs font-medium text-ink bg-surface-muted px-3 py-2 rounded-md border border-line">
                                                    <i className="ti ti-check-double text-base" />
                                                    <span>Receipt acknowledged by you. Recorded on official HR file.</span>
                                                </div>
                                            )}

                                            {isResolved && (
                                                <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-2 rounded-md border border-slate-200">
                                                    <i className="ti ti-circle-check text-base text-slate-500" />
                                                    <span>Case closed and officially resolved by HR Compliance.</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="py-12 text-center">
                                    <div className="w-12 h-12 rounded-md bg-surface-muted text-ink flex items-center justify-center mx-auto mb-3 text-2xl border border-line">
                                        <i className="ti ti-shield-check" />
                                    </div>
                                    <h3 className="text-base font-bold text-slate-800">Clean Personnel Record</h3>
                                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                                        You have zero disciplinary infractions or policy warnings. Your compliance standing is in good standing.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-5 sm:px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
                            {infractions.length > 1 ? (
                                <button
                                    onClick={handleAcknowledgeAll}
                                    disabled={acknowledgingId !== null}
                                    className="h-9 px-4 bg-slate-900 hover:bg-black text-white text-xs font-medium rounded-md shadow-2xs transition-colors duration-100 cursor-pointer flex items-center gap-1.5"
                                >
                                    <i className="ti ti-checks text-sm" />
                                    <span>Acknowledge All ({infractions.length})</span>
                                </button>
                            ) : <div />}

                            <button
                                onClick={() => setShowInfractionsModal(false)}
                                className="h-9 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md transition-colors duration-100 cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
};

export default EmployeeDashboard;
