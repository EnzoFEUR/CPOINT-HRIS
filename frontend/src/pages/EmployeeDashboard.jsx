import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import QRCode from '../components/QRCode';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../utils/api';
import { supabase } from '../supabaseClient';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { getDisciplinaryCache, setDisciplinaryCache, clearDisciplinaryCache } from '../utils/disciplinaryCache';
import { getShoeRoleDetails, parseProductionGroup } from '../utils/factoryRoles';

const EmployeeDashboard = () => {
    const queryClient = useQueryClient();
    const storedUser = (() => {
        try {
            const raw = localStorage.getItem('user');
            return (raw && raw !== 'undefined') ? JSON.parse(raw) : { name: 'Loading...', id: '', department: 'Team Member' };
        } catch {
            return { name: 'Loading...', id: '', department: 'Team Member' };
        }
    })();
    const [user, setUser] = useState(storedUser);
    
    // Initial disciplinary state from cache
    const [disciplinaryState, setDisciplinaryState] = useState(() => getDisciplinaryCache(storedUser?.id));
    
    // Modals
    const [showQrModal, setShowQrModal] = useState(false);
    const [showLeaveModal, setShowLeaveModal] = useState(false);
    const [showPayslipModal, setShowPayslipModal] = useState(false);
    const [showInfractionsModal, setShowInfractionsModal] = useState(false);

    // Leave Form State
    const [leaveForm, setLeaveForm] = useState({
        leave_type: 'Sick Leave',
        start_date: '',
        end_date: '',
        reason: ''
    });
    const [isSubmittingLeave, setIsSubmittingLeave] = useState(false);

    useEffect(() => {
        const role = (storedUser?.role || '').toLowerCase();
        if (role === 'security' || role === 'guard' || role === 'security_guard') {
            window.location.href = '/scanner';
        }
    }, [storedUser]);

    const fetchDashboardData = async (userId) => {
        try {
            const res = await fetchWithAuth(`/api/dashboard/employee/${userId}`);
            if (res.ok) {
                const json = await res.json();
                if (json && (json.attendanceData !== undefined || json.leaveData !== undefined)) {
                    return json;
                }
            }
        } catch (err) {
            console.warn('[DASHBOARD] BFF endpoint unavailable, falling back to direct parallel fetch:', err);
        }

        // Fallback fetch
        const [attRes, payRes, discRes, leaveRes] = await Promise.allSettled([
            fetchWithAuth(`/api/attendance?employee_id=${userId}`),
            fetchWithAuth(`/api/payroll?employee_id=${userId}&limit=12`),
            fetchWithAuth(`/api/disciplinary?employee_id=${userId}`),
            fetchWithAuth(`/api/leaves?employee_id=${userId}`)
        ]);

        const attendanceData = attRes.status === 'fulfilled' && attRes.value.ok ? await attRes.value.json() : [];
        const payrollData = payRes.status === 'fulfilled' && payRes.value.ok ? await payRes.value.json() : [];
        const discData = discRes.status === 'fulfilled' && discRes.value.ok ? await discRes.value.json() : [];
        const leaveData = leaveRes.status === 'fulfilled' && leaveRes.value.ok ? await leaveRes.value.json() : [];

        return { attendanceData, payrollData, discData, leaveData };
    };

    const { data, isLoading } = useQuery({
        queryKey: ['employeeDashboard', user.id],
        queryFn: () => fetchDashboardData(user.id),
        enabled: !!user.id && user.role !== 'security',
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    });

    // Real-time synchronization
    useEffect(() => {
        if (!user?.id) return;

        const channel = supabase
            .channel(`employee-live-dashboard-${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls' }, () => {
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs' }, () => {
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
            })
            .subscribe();

        const handleRefresh = () => {
            queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
        };
        const handleOpenDisciplinary = () => {
            setShowInfractionsModal(true);
        };

        window.addEventListener('refresh_dashboard', handleRefresh);
        window.addEventListener('open_disciplinary_modal', handleOpenDisciplinary);

        const handleDisciplinarySync = (e) => {
            if (!user?.id || e.detail?.userId === user.id) {
                setDisciplinaryState(getDisciplinaryCache(user?.id));
            }
        };
        window.addEventListener('hris_disciplinary_sync', handleDisciplinarySync);

        const params = new URLSearchParams(window.location.search);
        if (params.get('view') === 'disciplinary' || params.get('tab') === 'disciplinary') {
            setShowInfractionsModal(true);
        }

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener('refresh_dashboard', handleRefresh);
            window.removeEventListener('open_disciplinary_modal', handleOpenDisciplinary);
            window.removeEventListener('hris_disciplinary_sync', handleDisciplinarySync);
        };
    }, [user?.id, queryClient]);

    // Derived state
    const rawAttendance = data?.attendanceData?.data || data?.attendanceData || [];
    const recentLogs = Array.isArray(rawAttendance) ? rawAttendance.slice(0, 5) : [];

    const rawPayroll = data?.payrollData?.data || data?.payrollData || [];
    const allPayrolls = Array.isArray(rawPayroll) ? rawPayroll : (rawPayroll?.id ? [rawPayroll] : []);
    const latestPayroll = allPayrolls.length > 0 ? allPayrolls[0] : null;
    const [selectedPayslipIndex, setSelectedPayslipIndex] = useState(0);
    const currentPayslip = allPayrolls[selectedPayslipIndex] || latestPayroll;
    
    const isFactoryWorker = (user?.department || '').toLowerCase().includes('factory') || 
                            (user?.shift || '').toLowerCase().includes('factory');
    const shoeRole = isFactoryWorker ? getShoeRoleDetails(user?.job_title) : null;
    const prodGroup = isFactoryWorker ? parseProductionGroup(user?.shift) : null;
    const workerClassification = isFactoryWorker ? (shoeRole ? shoeRole.label : (user?.job_title || 'Shoe Craft')) : 'Regular Worker';
    const workerSchedule = isFactoryWorker ? '08:00 AM - 05:00 PM' : '08:00 AM - 08:00 PM';
    const overtimePolicy = isFactoryWorker ? 'Strict Shift · No Overtime' : 'Extended Shift · OT Eligible';

    // Live employee data
    const liveEmployee = data?.employee || (data?.shiftData && data?.shiftData[0]) || null;
    const currentStatus = (liveEmployee?.status || user?.status || 'active').toLowerCase();
    const currentIsActive = liveEmployee?.is_active !== undefined ? liveEmployee.is_active : (user?.is_active !== undefined ? user.is_active : true);

    // Sync live employee status to user state and localStorage
    useEffect(() => {
        if (liveEmployee && liveEmployee.status && (liveEmployee.status !== user?.status || liveEmployee.is_active !== user?.is_active)) {
            setUser(prev => ({ ...prev, status: liveEmployee.status, is_active: liveEmployee.is_active }));
            try {
                const stored = JSON.parse(localStorage.getItem('user') || '{}');
                localStorage.setItem('user', JSON.stringify({ ...stored, status: liveEmployee.status, is_active: liveEmployee.is_active }));
            } catch (e) {}
        }
    }, [liveEmployee]);

    const rawDisc = data?.discData?.data || data?.discData;
    const queryHasLoaded = data !== undefined && rawDisc !== undefined;
    const discData = Array.isArray(rawDisc) ? rawDisc : [];
    const employeeDisciplinary = discData.filter(log => String(log.employee_id) === String(user?.id));
    const infractions = employeeDisciplinary.filter(log => log.status === 'Active');
    const unresolvedInfractions = employeeDisciplinary.filter(log => log.status !== 'Resolved');

    // Check for termination record
    const terminationRecord = employeeDisciplinary.find(log => log.type === 'Termination');
    const activeTermination = queryHasLoaded
        ? terminationRecord
        : (disciplinaryState.isTerminated ? (disciplinaryState.record || { type: 'Termination', reason: 'Account separated' }) : null);

    const activeSuspension = queryHasLoaded
        ? employeeDisciplinary.find(log => log.type === 'Suspension' && log.status !== 'Resolved')
        : (disciplinaryState.isSuspended ? (disciplinaryState.record || { type: 'Suspension', reason: 'Operational access temporarily suspended' }) : null);

    const isTerminated = Boolean(activeTermination) || currentStatus === 'inactive' || currentStatus === 'terminated' || Boolean(disciplinaryState.isTerminated);
    const isSuspended = !isTerminated && (Boolean(activeSuspension) || currentStatus === 'suspended' || Boolean(disciplinaryState.isSuspended));

    const suspensionRecords = employeeDisciplinary.filter(log => log.type === 'Suspension');
    const pastSuspensionsCount = suspensionRecords.length;

    // Sync disciplinary status to shared cache
    useEffect(() => {
        if (!user?.id || !queryHasLoaded) return;
        if (isTerminated) {
            setDisciplinaryCache(user.id, { type: 'Termination', record: activeTermination || terminationRecord });
            setDisciplinaryState(getDisciplinaryCache(user.id));
        } else if (isSuspended) {
            setDisciplinaryCache(user.id, { type: 'Suspension', record: activeSuspension });
            setDisciplinaryState(getDisciplinaryCache(user.id));
        } else {
            clearDisciplinaryCache(user.id);
            setDisciplinaryState(getDisciplinaryCache(user.id));
        }
    }, [user?.id, queryHasLoaded, isTerminated, isSuspended, activeTermination, activeSuspension]);

    const suspensionEndDate = (() => {
        if (!activeSuspension?.reason) return null;
        const match = activeSuspension.reason.match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
        return match ? match[1] : null;
    })();

    const suspensionDays = (() => {
        if (!activeSuspension?.reason) return null;
        const match = activeSuspension.reason.match(/SUSPENDED:\s*([0-9]+)\s*DAYS/i);
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
        setIsSubmittingLeave(true);
        try {
            const res = await fetchWithAuth('/api/leaves', {
                method: 'POST',
                body: JSON.stringify({ employee_id: user.id, ...leaveForm })
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Leave request submitted to HR!');
                setShowLeaveModal(false);
                setLeaveForm({ leave_type: 'Sick Leave', start_date: '', end_date: '', reason: '' });
                queryClient.invalidateQueries({ queryKey: ['employeeDashboard', user.id] });
                queryClient.refetchQueries({ queryKey: ['employeeDashboard', user.id] });
            } else {
                toast.error(data.error || 'Failed to submit leave.');
            }
        } catch (error) {
            toast.error('Network Error');
        } finally {
            setIsSubmittingLeave(false);
        }
    };

    const [acknowledgingId, setAcknowledgingId] = useState(null);

    const handleAcknowledgeSingle = async (infId) => {
        setAcknowledgingId(infId);
        try {
            const res = await fetchWithAuth(`/api/disciplinary/${infId}/acknowledge`, { method: 'PUT' });
            if (res.ok) {
                toast.success('Disciplinary notice acknowledged.');
                queryClient.invalidateQueries(['employeeDashboard', user.id]);
                queryClient.refetchQueries(['employeeDashboard', user.id]);
            } else {
                toast.error('Failed to acknowledge notice.');
            }
        } catch (err) {
            toast.error('Network error acknowledging notice.');
        } finally {
            setAcknowledgingId(null);
        }
    };

    const handleAcknowledgeAll = async () => {
        try {
            await Promise.all(infractions.map(inf => 
                fetchWithAuth(`/api/disciplinary/${inf.id}/acknowledge`, { method: 'PUT' })
            ));
            toast.success('All notices acknowledged.');
            queryClient.invalidateQueries(['employeeDashboard', user.id]);
            queryClient.refetchQueries(['employeeDashboard', user.id]);
        } catch (err) {
            toast.error('Failed to acknowledge notices.');
        }
    };

    const getInitial = (name) => name ? name.charAt(0).toUpperCase() : '?';
    const getFirstName = (name) => name ? name.split(' ')[0] : '';
    const formattedToday = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const photoUrl = user?.avatar_url
        ? user.avatar_url
        : user?.biometric_baseline_path
            ? (user.biometric_baseline_path.startsWith('http')
                ? user.biometric_baseline_path
                : `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${user.biometric_baseline_path.replace(/^\/+/, '')}`)
            : null;



    const handleLogout = () => {
        localStorage.removeItem('user');
        window.location.href = '/login';
    };

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 px-4 sm:px-6 font-sans">
            
            {/* Disciplinary & Separation Alert Banners */}
            {isTerminated ? (
                <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-4 sm:p-5 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5">
                        <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-400">
                            <i className="ti ti-user-off text-2xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-600 text-white">Account Separated</span>
                                <span className="text-xs text-slate-400 font-mono">DOLE & BIR 2316 Retention Mode</span>
                            </div>
                            <h3 className="font-bold text-sm sm:text-base tracking-tight text-white mt-1">Employment Records & Clearance Archive</h3>
                            <p className="text-slate-300 text-xs mt-0.5 leading-relaxed max-w-xl">
                                Operational credentials have been deactivated. All statutory 201 records, government contributions, and historical payslips remain permanently accessible for tax clearance and DOLE audit verification.
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={() => { if(latestPayroll) setShowPayslipModal(true); else toast.error('No payslip records on file.'); }}
                        className="w-full md:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold rounded-xl shadow-xs transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                        <i className="ti ti-receipt-2 text-sm" />
                        <span>View Historical Payslips</span>
                    </button>
                </div>
            ) : isSuspended ? (
                <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 sm:p-5 text-white shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3.5">
                        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400">
                            <i className="ti ti-lock-exclamation text-2xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-slate-950">Suspension Active</span>
                                {suspensionDays && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                        {suspensionDays} Days Duration
                                    </span>
                                )}
                                {suspensionEndDate && (
                                    <span className="text-xs text-amber-300 font-mono">Until {suspensionEndDate}</span>
                                )}
                            </div>
                            <h3 className="font-bold text-sm sm:text-base tracking-tight text-white mt-1">Operational Access Temporarily Suspended</h3>
                            <p className="text-slate-300 text-xs mt-0.5 leading-relaxed max-w-xl">
                                Under DOLE policy ("No Work, No Pay"), attendance clock-in, QR credentials, and leave filings are paused. You retain full access to review your compensation records and acknowledge official memos.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto shrink-0">
                        {infractions.length > 0 && (
                            <button 
                                onClick={() => setShowInfractionsModal(true)} 
                                className="w-full sm:w-auto px-4 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-bold rounded-xl shadow-xs transition-all text-xs flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <i className="ti ti-file-text text-sm" />
                                <span>Acknowledge Notice</span>
                            </button>
                        )}
                        <button 
                            onClick={() => { if(latestPayroll) setShowPayslipModal(true); else toast.error('No payslips available.'); }}
                            className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-semibold rounded-xl transition-all text-xs flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
                        >
                            <i className="ti ti-receipt text-sm" />
                            <span>View Payslip</span>
                        </button>
                    </div>
                </div>
            ) : infractions.length > 0 ? (
                <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 sm:p-5 text-white shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-slate-300">
                            <i className="ti ti-shield-alert text-2xl" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-500 text-white">Action Required</span>
                                <h3 className="font-bold text-sm sm:text-base tracking-tight text-white">Disciplinary Notice Issued</h3>
                            </div>
                            <p className="text-slate-400 text-xs mt-0.5">
                                You have <strong className="text-white font-semibold">{infractions.length} active notice{infractions.length > 1 ? 's' : ''}</strong> pending review and acknowledgment.
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setShowInfractionsModal(true)} 
                        className="w-full sm:w-auto px-4 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold rounded-xl shadow-xs transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                        <i className="ti ti-file-text text-sm" />
                        <span>Review & Acknowledge</span>
                    </button>
                </div>
            ) : null}

            <div className="space-y-5 sm:space-y-8">
                
                {/* Welcome header with Profile & Logout */}
                <div className="flex items-start justify-between gap-4 pt-2 sm:pt-4">
                    <div>
                        <p className="text-blue-600 font-bold tracking-widest uppercase text-xs sm:text-sm mb-1">{formattedToday}</p>
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                            Good day,<br/><span className="text-blue-600">{getFirstName(user.name)}!</span>
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 text-xs sm:text-sm flex flex-wrap items-center gap-1.5">
                            {isFactoryWorker ? (
                                <>
                                    <span className="font-bold text-slate-700">{user.job_title || 'Shoe Craft'}</span>
                                    {prodGroup && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
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
                            {isTerminated && <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">Separated</span>}
                            {isSuspended && <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">Suspended</span>}
                        </p>
                    </div>
                    
                    {/* User Avatar & Logout Action */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        <Link to="/employee/profile" title="View Profile" className="tap-active group">
                            <EmployeeAvatar
                                employee={user}
                                photoUrl={photoUrl}
                                size="w-14 h-14 sm:w-16 sm:h-16"
                                rounded="rounded-xl"
                                border={isTerminated ? "border-2 border-rose-300" : isSuspended ? "border-2 border-orange-300" : "border-2 border-slate-200"}
                                shadow="shadow-xs"
                                theme="dark"
                                textSize="text-xl sm:text-2xl"
                            />
                        </Link>
                        <button
                            onClick={handleLogout}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                            title="Sign out of HRIS"
                        >
                            <i className="ti ti-power text-xs" />
                            <span>Logout</span>
                        </button>
                    </div>
                </div>

                {/* Primary actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">
                    
                    {/* Payroll - Always Available */}
                    <div 
                        onClick={() => { 
                            if (latestPayroll) {
                                setShowPayslipModal(true); 
                            } else if (isFactoryWorker) {
                                toast('Factory piece-rate pool payouts are distributed per completed production batch.', { icon: 'ℹ️' });
                            } else {
                                toast.error('No payslips on record.'); 
                            }
                        }}
                        className="relative overflow-hidden bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all rounded-2xl p-5 sm:p-6 md:p-8 cursor-pointer shadow-xl shadow-emerald-600/20 group tap-active select-none"
                    >
                        <div className="relative z-10 flex flex-col justify-between h-full text-white">
                            <div className="flex justify-between items-start">
                                <div className="w-11 h-11 sm:w-14 sm:h-14 bg-white/20 backdrop-blur-md rounded-xl sm:rounded-2xl flex items-center justify-center text-white mb-4 sm:mb-6 group-hover:bg-white/30 transition-colors">
                                    <i className="ti ti-wallet text-2xl sm:text-3xl" />
                                </div>
                                <div className="flex items-center gap-2">
                                    {isTerminated && (
                                        <span className="px-2.5 py-1 rounded-lg bg-black/25 text-[10px] font-mono tracking-wider font-bold">
                                            Archived Records
                                        </span>
                                    )}
                                    {isSuspended && (
                                        <span className="px-2.5 py-1 rounded-lg bg-black/25 text-[10px] font-mono tracking-wider font-bold">
                                            Compensation
                                        </span>
                                    )}
                                    {isFactoryWorker && !isTerminated && !isSuspended && (
                                        <span className="px-2.5 py-1 rounded-lg bg-black/25 text-[10px] font-mono tracking-wider font-bold">
                                            Pakyawan Pool
                                        </span>
                                    )}
                                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-sm group-hover:bg-white group-hover:text-emerald-700 transition-all shrink-0">
                                        <i className="ti ti-arrow-right text-lg sm:text-xl" />
                                    </div>
                                </div>
                            </div>
                            <div>
                                <p className="text-emerald-100 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-1">
                                    {isTerminated ? 'Most Recent Net Pay' : isSuspended ? 'Latest Pay Record' : isFactoryWorker && !latestPayroll ? 'Compensation Model' : 'Latest Net Pay'}
                                </p>
                                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">
                                    {latestPayroll ? `₱${parseFloat(latestPayroll.net_pay).toFixed(2)}` : (isFactoryWorker ? 'Batch Pool' : '₱0.00')}
                                </h2>
                                <p className="text-emerald-50 text-xs sm:text-sm mt-1 font-medium flex items-center gap-1.5">
                                    <i className="ti ti-file-text" />
                                    <span>
                                        {latestPayroll 
                                            ? `Tap to view full payslip (${allPayrolls.length} available)` 
                                            : (isFactoryWorker 
                                                ? 'Earnings calculated per completed shoe batch in your production line.' 
                                                : 'No payslip records generated yet.')}
                                    </span>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Today's shift */}
                    <div className={`relative overflow-hidden ${
                        isTerminated 
                            ? 'bg-slate-900 border border-rose-500/20' 
                            : isSuspended 
                            ? 'bg-slate-900 border border-orange-500/30' 
                            : 'bg-slate-900'
                    } rounded-2xl p-5 sm:p-6 md:p-8 shadow-xl shadow-slate-900/20 text-white flex flex-col justify-between group select-none`}>
                        <div className="relative z-10 flex justify-between items-start">
                            <div className={`w-11 h-11 sm:w-14 sm:h-14 bg-white/10 backdrop-blur-md rounded-xl sm:rounded-2xl flex items-center justify-center ${
                                isTerminated ? 'text-rose-400' : isSuspended ? 'text-orange-400' : 'text-blue-400'
                            } mb-4 sm:mb-6 group-hover:bg-white/20 transition-colors`}>
                                <i className={`ti ${isTerminated ? 'ti-calendar-off' : isSuspended ? 'ti-clock-pause' : (shoeRole ? shoeRole.icon : 'ti-calendar-time')} text-2xl sm:text-3xl`} />
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className={`px-3 py-1 rounded-full font-bold text-[10px] sm:text-xs uppercase tracking-wider ${
                                    isTerminated 
                                        ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300' 
                                        : isSuspended 
                                        ? 'bg-orange-500/20 border border-orange-500/40 text-orange-300' 
                                        : 'bg-blue-500/20 border border-blue-500/30 text-blue-300'
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
                            <p className={`${
                                isTerminated ? 'text-rose-300/80' : isSuspended ? 'text-orange-300/80' : 'text-blue-300'
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
                        className={`bg-white rounded-2xl p-4 sm:p-6 shadow-xs sm:shadow-sm border ${
                            isTerminated || isSuspended 
                                ? 'opacity-65 cursor-not-allowed border-slate-200 bg-slate-50/50' 
                                : 'border-slate-100 cursor-pointer group hover:border-blue-200 active:scale-[0.98]'
                        } flex items-center justify-between transition-all tap-active select-none`}
                    >
                        <div className="flex items-center gap-4 sm:gap-5">
                            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl ${
                                isTerminated ? 'bg-rose-50 text-rose-500' : isSuspended ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-600'
                            } flex items-center justify-center text-2xl sm:text-3xl shrink-0 ${!isTerminated && !isSuspended ? 'group-hover:bg-blue-600 group-hover:text-white' : ''} transition-colors`}>
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
                        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                            <i className={`ti ${isTerminated || isSuspended ? 'ti-lock text-sm' : 'ti-plus text-base group-hover:text-blue-600 group-hover:bg-blue-50'} transition-colors`} />
                        </div>
                    </div>

                    {/* Leave overview */}
                    <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-xs sm:shadow-sm border border-slate-100 flex items-center justify-between select-none">
                        <div className="flex items-center gap-4 sm:gap-5">
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700 text-2xl sm:text-3xl shrink-0">
                                <i className="ti ti-clipboard-check" />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800">My Requests</h3>
                                <p className="text-slate-500 text-xs font-medium mt-0.5">
                                    {myLeaves.length} recent application(s)
                                </p>
                            </div>
                        </div>
                        <span className="text-xs font-bold font-mono px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
                            {myLeaves.filter(l => l.status === 'Pending').length} Pending
                        </span>
                    </div>
                </div>

                {/* Disciplinary record card */}
                {isTerminated ? (
                    <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs sm:shadow-sm border-2 border-rose-300 transition-all">
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-rose-100">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0 text-2xl shadow-xs">
                                    <i className="ti ti-user-x" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            Personnel Standing: Separated Account
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300">
                                            <span className="w-2 h-2 rounded-full bg-rose-600" />
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
                                className="w-full sm:w-auto px-5 py-2.5 bg-slate-900 hover:bg-black active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-xs"
                            >
                                <i className="ti ti-file-certificate text-sm" />
                                <span>View Separation Records ({employeeDisciplinary.length})</span>
                            </button>
                        </div>

                        {/* Separation details */}
                        <div className="my-4 p-4 rounded-2xl bg-rose-50/50 border border-rose-100 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-bold text-rose-900">
                                    <i className="ti ti-info-circle text-rose-600 text-sm" />
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
                                <div className="pt-2 border-t border-rose-200/60 flex items-center gap-2 text-xs text-rose-800 font-semibold">
                                    <i className="ti ti-history text-rose-600" />
                                    <span>Prior Record: {pastSuspensionsCount} disciplinary suspension memo{pastSuspensionsCount > 1 ? 's' : ''} on official personnel file.</span>
                                </div>
                            )}
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-ban text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Gate QR Access</p>
                                    <p className="font-bold text-rose-700 truncate">Permanently Disabled</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                                    <i className="ti ti-history text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Disciplinary Audit</p>
                                    <p className="font-bold text-slate-800 truncate">{employeeDisciplinary.length} Recorded Action(s)</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                                    <i className="ti ti-receipt-2 text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Clearance & Pay</p>
                                    <p className="font-bold text-slate-800 truncate">Contact HR for COE</p>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : isSuspended ? (
                    <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs sm:shadow-sm border-2 border-orange-300 transition-all">
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-orange-100">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center shrink-0 text-2xl shadow-xs">
                                    <i className="ti ti-clock-pause" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            Disciplinary Suspension Active
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-orange-100 text-orange-800 border border-orange-300">
                                            <span className="w-2 h-2 rounded-full bg-orange-600 animate-pulse" />
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
                                className="w-full sm:w-auto px-5 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-sm shadow-orange-900/10"
                            >
                                <i className="ti ti-file-text text-sm" />
                                <span>Review Suspension Memo</span>
                            </button>
                        </div>

                        {/* Suspension Details */}
                        <div className="my-4 p-4 rounded-2xl bg-orange-50/50 border border-orange-100 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2 font-bold text-orange-900">
                                    <i className="ti ti-alert-triangle text-orange-600 text-sm" />
                                    <span>Official HR Suspension Order</span>
                                </div>
                                <span className="font-bold text-orange-800">
                                    {suspensionDays ? `${suspensionDays} Days Duration` : 'Temporary Hold'} {suspensionEndDate ? `(Reinstates on ${suspensionEndDate})` : ''}
                                </span>
                            </div>
                            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                                {activeSuspension?.reason || 'Account access is temporarily restricted under disciplinary suspension.'}
                            </p>
                            {pastSuspensionsCount > 1 && (
                                <div className="pt-2 border-t border-orange-200/60 flex items-center gap-2 text-xs text-orange-800 font-semibold">
                                    <i className="ti ti-history text-orange-600" />
                                    <span>Prior Record: {pastSuspensionsCount - 1} earlier suspension notice(s) on file.</span>
                                </div>
                            )}
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-qrcode-off text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Attendance QR</p>
                                    <p className="font-bold text-orange-700 truncate">Locked (Suspended)</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
                                    <i className="ti ti-calendar-pause text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Work Schedule</p>
                                    <p className="font-bold text-slate-800 truncate">No Active Shifts</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
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
                    <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs sm:shadow-sm border-2 border-rose-200 transition-all">
                        {/* Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 sm:pb-5 border-b border-rose-100">
                            <div className="flex items-start sm:items-center gap-3.5">
                                <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0 text-2xl shadow-xs">
                                    <i className="ti ti-bell-ringing" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            HR Notice Awaiting Review
                                        </h3>
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200">
                                            <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
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
                                className="w-full sm:w-auto px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-sm shadow-rose-900/10"
                            >
                                <i className="ti ti-file-text text-sm" />
                                <span>Review & Acknowledge ({unresolvedInfractions.length})</span>
                            </button>
                        </div>

                        {/* Notice Items */}
                        <div className="space-y-3 pt-4 sm:pt-5">
                            {unresolvedInfractions.map((infraction) => (
                                <div 
                                    key={infraction.id} 
                                    onClick={() => setShowInfractionsModal(true)}
                                    className="group p-4 sm:p-5 rounded-2xl border border-rose-100 bg-rose-50/30 hover:bg-rose-50/70 hover:border-rose-300 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                                >
                                    <div className="flex items-start gap-3.5 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-white border border-rose-200 text-rose-600 flex items-center justify-center shrink-0 text-xl group-hover:bg-rose-600 group-hover:text-white transition-colors shadow-2xs">
                                            <i className="ti ti-file-alert" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                                <h4 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-rose-700 transition-colors">
                                                    {infraction.type}
                                                </h4>
                                                {infraction.severity && (
                                                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                                                        infraction.severity === 'Critical' ? 'bg-rose-100 text-rose-700 border-rose-200' :
                                                        infraction.severity === 'High' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                                        infraction.severity === 'Medium' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                        'bg-blue-100 text-blue-700 border-blue-200'
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

                                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-rose-100/60">
                                        <div className="text-left sm:text-right">
                                            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Issued Date</p>
                                            <p className="text-xs font-bold text-slate-700">
                                                {new Date(infraction.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </p>
                                        </div>
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 text-xs font-bold shadow-2xs group-hover:bg-rose-600 group-hover:text-white group-hover:border-rose-600 transition-colors">
                                            <span>Open Notice</span>
                                            <i className="ti ti-arrow-right text-xs" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Reassurance footer note */}
                        <div className="mt-4 pt-3 border-t border-rose-100 flex items-center gap-2 text-[11px] text-slate-500">
                            <i className="ti ti-info-circle text-rose-400 text-sm shrink-0" />
                            <span>
                                Acknowledgment confirms receipt of memo. Under Philippine labor law, you retain the right to consult HR and submit a written explanation within 5 business days.
                            </span>
                        </div>
                    </div>
                ) : employeeDisciplinary.length > 0 ? (
                    <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs sm:shadow-sm border border-slate-200 transition-all hover:shadow-md">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 text-2xl shadow-xs">
                                    <i className="ti ti-history" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            HR Standing & Notice History
                                        </h3>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                            <i className="ti ti-check text-xs" />
                                            <span>Active · {employeeDisciplinary.length} Historical Notice(s)</span>
                                        </span>
                                    </div>
                                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
                                        All historical memos ({employeeDisciplinary.length}) have been reviewed and acknowledged. Account is currently active.
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                <button
                                    onClick={() => setShowInfractionsModal(true)}
                                    className="w-full sm:w-auto px-4 py-2.5 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-700 border border-slate-200 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                                >
                                    <i className="ti ti-history text-sm text-slate-500" />
                                    <span>Notice History ({employeeDisciplinary.length})</span>
                                </button>
                            </div>
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4 pt-4 border-t border-slate-100 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-emerald-100/60 text-emerald-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-check text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Holds</p>
                                    <p className="font-bold text-slate-800 truncate">0 Pending Holds</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-blue-100/60 text-blue-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-user-check text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Account Standing</p>
                                    <p className="font-bold text-slate-800 truncate">Active Employee</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center shrink-0">
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
                    <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xs sm:shadow-sm border border-slate-100 transition-all hover:shadow-md">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 text-2xl shadow-xs">
                                    <i className="ti ti-shield-check" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                                            HR Standing & Compliance
                                        </h3>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            <i className="ti ti-circle-check text-xs" />
                                            <span>Good Standing</span>
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
                                    className="w-full sm:w-auto px-4 py-2.5 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-700 border border-slate-200 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                                >
                                    <i className="ti ti-certificate text-sm text-emerald-600" />
                                    <span>Compliance File</span>
                                </button>
                            </div>
                        </div>

                        {/* Quick highlights bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-4 pt-4 border-t border-slate-100 text-xs">
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-emerald-100/60 text-emerald-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-check text-sm font-bold" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Notices</p>
                                    <p className="font-bold text-slate-800 truncate">0 Pending</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-blue-100/60 text-blue-600 flex items-center justify-center shrink-0">
                                    <i className="ti ti-scale text-sm" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Labor Code / DOLE</p>
                                    <p className="font-bold text-slate-800 truncate">Fully Compliant</p>
                                </div>
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                <div className="w-7 h-7 rounded-lg bg-purple-100/60 text-purple-600 flex items-center justify-center shrink-0">
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
                    <div className="bg-white rounded-2xl p-4 sm:p-6 md:p-8 shadow-xs sm:shadow-sm border border-slate-100">
                        <div className="flex items-center gap-3 mb-5 sm:mb-8">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
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
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                                                isAbsent ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
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
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                            isAbsent ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                                        }`}>
                                            {log.status || 'Present'}
                                        </span>
                                    </div>
                                );
                            }) : (
                                <p className="text-xs text-slate-400">No recent logs</p>
                            )}
                        </div>
                    </div>

                    {/* Leave requests */}
                    <div className="bg-white rounded-2xl p-4 sm:p-6 md:p-8 shadow-xs sm:shadow-sm border border-slate-100">
                        <div className="flex items-center gap-3 mb-5 sm:mb-8">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                                <i className="ti ti-plane-departure text-lg sm:text-xl" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight">Recent Leave Requests</h3>
                        </div>

                        <div className="space-y-4">
                            {myLeaves.length > 0 ? myLeaves.slice(0, 4).map((leave) => {
                                const statusColors = {
                                    'Pending': 'bg-amber-100 text-amber-700',
                                    'Approved': 'bg-emerald-100 text-emerald-700',
                                    'Rejected': 'bg-red-100 text-red-700'
                                };
                                return (
                                    <div key={leave.id} className="p-3 sm:p-4 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <h4 className="font-bold text-slate-800 text-sm sm:text-base">{leave.type}</h4>
                                            <p className="text-slate-500 text-xs sm:text-sm mt-0.5 truncate">
                                                {new Date(leave.start_date).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})} - {new Date(leave.end_date).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}
                                            </p>
                                        </div>
                                        <span className={`px-2.5 sm:px-3 py-1 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider shrink-0 ${statusColors[leave.status] || 'bg-slate-200 text-slate-700'}`}>
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
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div 
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
                            onClick={() => setShowQrModal(false)}
                        />
                        <div 
                            className="relative bg-white rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full max-w-sm text-center shadow-2xl"
                        >
                            <div className="w-12 sm:w-16 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 sm:mb-8" />
                            
                            {isTerminated ? (
                                <div>
                                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-2xl sm:text-3xl shadow-lg mb-3 sm:mb-4 border-4 border-white">
                                        <i className="ti ti-user-x" />
                                    </div>
                                    <h2 className="text-xl font-black text-slate-800 tracking-tight">QR Credential Revoked</h2>
                                    <p className="text-slate-500 font-medium mt-1 text-xs">Employment account has been separated</p>
                                    <div className="my-6 p-5 bg-rose-50 rounded-2xl border border-rose-200 text-xs text-rose-700 leading-relaxed font-medium">
                                        Attendance credentials and premise QR codes are permanently invalidated. You may access your past payslips on this portal.
                                    </div>
                                </div>
                            ) : isSuspended ? (
                                <div>
                                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-orange-100 flex items-center justify-center text-orange-600 text-2xl sm:text-3xl shadow-lg mb-3 sm:mb-4 border-4 border-white">
                                        <i className="ti ti-lock" />
                                    </div>
                                    <h2 className="text-xl font-black text-slate-800 tracking-tight">Attendance QR Suspended</h2>
                                    <p className="text-slate-500 font-medium mt-1 text-xs">Credential disabled during disciplinary suspension</p>
                                    <div className="my-6 p-5 bg-orange-50 rounded-2xl border border-orange-200 text-xs text-orange-800 leading-relaxed font-medium">
                                        Clock-in access is prohibited during your suspension {suspensionEndDate ? `until ${suspensionEndDate}` : ''}. Please acknowledge your notice.
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-2xl sm:text-3xl shadow-xl shadow-blue-500/30 mb-3 sm:mb-4 border-4 border-white">
                                        {getInitial(user.name)}
                                    </div>
                                    <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">{user.name}</h2>
                                    <p className="text-slate-500 font-medium mt-1 text-sm">{user.department}</p>

                                    <div className="my-6 sm:my-8 bg-slate-50 p-5 sm:p-6 rounded-2xl border border-slate-100 inline-block shadow-inner">
                                        <QRCode value={user.id || '0'} size={180} fgColor="#1e293b" />
                                    </div>

                                    <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-4 sm:mb-6">Hold near the scanner</p>
                                </div>
                            )}

                            <button onClick={() => setShowQrModal(false)} className="w-full py-3.5 sm:py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl tap-active text-base sm:text-lg cursor-pointer">
                                Close
                            </button>
                        </div>
                    </div>
                )}
            

            {/* Historical Payslip Modal */}
            {showPayslipModal && (currentPayslip || latestPayroll) && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div 
                        className="absolute inset-0 bg-slate-900/50 backdrop-blur-md"
                        onClick={() => setShowPayslipModal(false)}
                    />
                    <div 
                        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl max-h-[92vh] overflow-y-auto touch-scroll border border-slate-200"
                    >
                        <div className="bg-emerald-600 p-6 sm:p-7 text-white text-center relative">
                            <div className="w-12 sm:w-16 h-1.5 bg-white/20 rounded-full mx-auto mb-4 sm:mb-5" />
                            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white/20 backdrop-blur-md rounded-xl mx-auto flex items-center justify-center border border-white/20 mb-3 shadow-lg">
                                <i className="ti ti-receipt-2 text-2xl sm:text-3xl" />
                            </div>
                            <h3 className="text-xl sm:text-2xl font-black tracking-tight">
                                {isTerminated ? 'Separation Records / Payslip' : 'Official Payslip'}
                            </h3>
                            <p className="text-emerald-100 text-xs sm:text-sm font-bold mt-1 uppercase tracking-widest">
                                {new Date((currentPayslip || latestPayroll).period_start).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})} - {new Date((currentPayslip || latestPayroll).period_end).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}
                            </p>
                        </div>
                        
                        <div className="p-5 sm:p-7 space-y-4">
                            {/* Pay Period Selector if multiple payslips */}
                            {allPayrolls.length > 1 && (
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">
                                        Select Pay Period ({allPayrolls.length} on File)
                                    </label>
                                    <select 
                                        value={selectedPayslipIndex} 
                                        onChange={(e) => setSelectedPayslipIndex(parseInt(e.target.value, 10))}
                                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/30 cursor-pointer"
                                    >
                                        {allPayrolls.map((p, idx) => (
                                            <option key={p.id || idx} value={idx}>
                                                {new Date(p.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - {new Date(p.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} &bull; ₱{parseFloat(p.net_pay || 0).toFixed(2)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Earnings & Deductions */}
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center pb-2.5 border-b border-dashed border-slate-200">
                                    <span className="text-slate-500 font-bold">Basic Pay</span>
                                    <span className="font-mono text-slate-800 font-bold text-base">₱{parseFloat((currentPayslip || latestPayroll).basic_pay || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center pb-2.5 border-b border-dashed border-slate-200">
                                    <span className="text-slate-500 font-bold">Overtime Pay</span>
                                    <span className="font-mono text-emerald-600 font-bold text-base">+ ₱{parseFloat((currentPayslip || latestPayroll).overtime_pay || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center pb-2.5 border-b border-dashed border-slate-200">
                                    <span className="text-slate-500 font-bold">Total Deductions</span>
                                    <span className="font-mono text-rose-500 font-bold text-base">- ₱{parseFloat((currentPayslip || latestPayroll).deductions || 0).toFixed(2)}</span>
                                </div>
                            </div>
                            
                            {/* Total Net Pay */}
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex justify-between items-center">
                                <div>
                                    <span className="font-bold text-slate-500 uppercase tracking-widest text-[10px] block">Total Net Pay</span>
                                    <span className="text-[11px] text-slate-400 font-medium">Philippine Peso (PHP)</span>
                                </div>
                                <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">₱{parseFloat((currentPayslip || latestPayroll).net_pay || 0).toFixed(2)}</span>
                            </div>

                            {/* DOLE Statutory / Suspension Remarks */}
                            {(currentPayslip || latestPayroll).remarks && (
                                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-left">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Deductions & Compliance Breakdown</p>
                                    <p className="text-xs text-slate-600 font-medium leading-relaxed font-mono">{(currentPayslip || latestPayroll).remarks}</p>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="grid grid-cols-2 gap-2.5 pt-1">
                                <button 
                                    onClick={() => window.print()} 
                                    className="py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                >
                                    <i className="ti ti-printer text-sm" />
                                    <span>Print / PDF</span>
                                </button>
                                <button 
                                    onClick={() => setShowPayslipModal(false)} 
                                    className="py-3 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            

            {/* Leave request modal */}
            {showLeaveModal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div 
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
                        onClick={() => setShowLeaveModal(false)}
                    />
                    <div 
                        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-5 sm:p-8 max-h-[90vh] overflow-y-auto touch-scroll"
                    >
                            <div className="flex justify-between items-center mb-5 sm:mb-8">
                                <div className="flex items-center gap-3 sm:gap-4">
                                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl sm:text-2xl">
                                        <i className="ti ti-plane-departure" />
                                    </div>
                                    <h2 className="text-xl sm:text-2xl font-black text-slate-800">Time Off</h2>
                                </div>
                                <button onClick={() => setShowLeaveModal(false)} className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 tap-active">
                                    <i className="ti ti-x text-lg sm:text-xl" />
                                </button>
                            </div>

                            <form onSubmit={handleLeaveSubmit} className="space-y-4 sm:space-y-5">
                                <div>
                                    <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1.5 sm:mb-2">What kind of leave?</label>
                                    <select 
                                        value={leaveForm.leave_type} 
                                        onChange={(e) => setLeaveForm({...leaveForm, leave_type: e.target.value})}
                                        className="w-full px-4 sm:px-5 py-3 sm:py-4 bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-bold text-slate-700 text-sm transition-all appearance-none"
                                    >
                                        <option>Sick Leave</option>
                                        <option>Vacation / PTO</option>
                                        <option>Maternity/Paternity</option>
                                        <option>Emergency Leave</option>
                                    </select>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                    <div>
                                        <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1.5 sm:mb-2">First Day</label>
                                        <input 
                                            type="date" required 
                                            value={leaveForm.start_date}
                                            onChange={(e) => setLeaveForm({...leaveForm, start_date: e.target.value})}
                                            className="w-full px-3 sm:px-5 py-3 sm:py-4 bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-bold text-slate-700 text-sm transition-all" 
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1.5 sm:mb-2">Last Day</label>
                                        <input 
                                            type="date" required 
                                            value={leaveForm.end_date}
                                            onChange={(e) => setLeaveForm({...leaveForm, end_date: e.target.value})}
                                            className="w-full px-3 sm:px-5 py-3 sm:py-4 bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-bold text-slate-700 text-sm transition-all" 
                                        />
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1.5 sm:mb-2">Why are you taking off?</label>
                                    <textarea 
                                        required rows="3" 
                                        value={leaveForm.reason}
                                        onChange={(e) => setLeaveForm({...leaveForm, reason: e.target.value})}
                                        className="w-full px-4 sm:px-5 py-3 sm:py-4 bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 font-bold text-slate-700 text-sm transition-all resize-none" 
                                        placeholder="I feel sick today..."
                                    />
                                </div>
                                
                                <div className="pt-2 sm:pt-4">
                                    <button disabled={isSubmittingLeave} type="submit" className="w-full py-3.5 sm:py-4 bg-blue-600 text-white font-bold rounded-xl shadow-xl shadow-blue-600/30 tap-active text-base sm:text-lg disabled:opacity-50 flex justify-center items-center gap-2">
                                        {isSubmittingLeave ? <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Send Request'}
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
                        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
                        onClick={() => setShowInfractionsModal(false)}
                    />
                    <div className="relative bg-white rounded-2xl sm:rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl border border-slate-200 z-10 max-h-[90vh] flex flex-col">
                        {/* Header */}
                        <div className="px-5 sm:px-7 py-4 sm:py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 shrink-0">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                    isTerminated 
                                        ? 'bg-rose-50 border-rose-200 text-rose-600'
                                        : isSuspended
                                        ? 'bg-orange-50 border-orange-200 text-orange-600'
                                        : unresolvedInfractions.length > 0 
                                        ? 'bg-rose-50 border-rose-200 text-rose-600' 
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                }`}>
                                    <i className={`ti ${
                                        isTerminated 
                                            ? 'ti-user-x' 
                                            : isSuspended 
                                            ? 'ti-clock-pause' 
                                            : unresolvedInfractions.length > 0 
                                            ? 'ti-shield-alert' 
                                            : 'ti-shield-check'
                                    } text-xl`} />
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
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
                                            : 'Official Personnel File · In Good Standing'}
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setShowInfractionsModal(false)} 
                                className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        {/* Content Body */}
                        <div className="overflow-y-auto p-5 sm:p-7 space-y-4">
                            {employeeDisciplinary.length > 0 ? (
                                employeeDisciplinary.map((record) => {
                                    const isPending = record.status === 'Active';
                                    const isAcknowledged = record.status === 'Acknowledged';
                                    const isResolved = record.status === 'Resolved';
                                    
                                    const sevColors = {
                                        Critical: 'bg-rose-100 text-rose-700 border-rose-200',
                                        High: 'bg-orange-100 text-orange-700 border-orange-200',
                                        Medium: 'bg-amber-100 text-amber-700 border-amber-200',
                                        Low: 'bg-blue-100 text-blue-700 border-blue-200'
                                    }[record.severity] || 'bg-slate-100 text-slate-700 border-slate-200';

                                    const statColors = {
                                        Active: 'bg-rose-50 text-rose-700 border-rose-200',
                                        Acknowledged: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                                        Resolved: 'bg-slate-100 text-slate-600 border-slate-200',
                                        'Under Review': 'bg-purple-50 text-purple-700 border-purple-200'
                                    }[record.status] || 'bg-slate-100 text-slate-700 border-slate-200';

                                    return (
                                        <div 
                                            key={record.id} 
                                            className={`p-4 sm:p-5 rounded-xl border transition-all ${
                                                isPending 
                                                    ? 'bg-rose-50/40 border-rose-200 shadow-sm' 
                                                    : 'bg-white border-slate-200'
                                            }`}
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-md border ${sevColors}`}>
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

                                            <div className="bg-white/80 p-3 rounded-lg border border-slate-200/80 mb-3">
                                                <p className="text-xs text-slate-700 leading-relaxed font-medium">{record.reason}</p>
                                            </div>

                                            {isPending && (
                                                <div className="pt-1">
                                                    <button
                                                        disabled={acknowledgingId === record.id}
                                                        onClick={() => handleAcknowledgeSingle(record.id)}
                                                        className="w-full py-2.5 bg-slate-900 hover:bg-black text-white font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
                                                    >
                                                        {acknowledgingId === record.id ? (
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
                                                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                                                    <i className="ti ti-check-double text-base" />
                                                    <span>Receipt acknowledged by you. Recorded on official HR file.</span>
                                                </div>
                                            )}

                                            {isResolved && (
                                                <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-2 rounded-lg border border-slate-200">
                                                    <i className="ti ti-circle-check text-base text-slate-500" />
                                                    <span>Case closed and officially resolved by HR Compliance.</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="py-12 text-center">
                                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-2xl border border-emerald-100">
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
                        <div className="px-5 sm:px-7 py-3 sm:py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
                            {infractions.length > 1 ? (
                                <button 
                                    onClick={handleAcknowledgeAll}
                                    className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                                >
                                    <i className="ti ti-checks text-sm" />
                                    <span>Acknowledge All ({infractions.length})</span>
                                </button>
                            ) : <div />}

                            <button 
                                onClick={() => setShowInfractionsModal(false)}
                                className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
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
