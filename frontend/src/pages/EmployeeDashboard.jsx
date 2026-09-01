import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import QRCode from '../components/QRCode';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../utils/api';
import { supabase } from '../supabaseClient';
import EmployeeAvatar from '../components/EmployeeAvatar';

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
        const [attRes, payRes, shiftRes, discRes, leaveRes] = await Promise.allSettled([
            fetchWithAuth(`/api/attendance?employee_id=${userId}`),
            fetchWithAuth(`/api/payroll?employee_id=${userId}&limit=1`),
            fetchWithAuth(`/api/shifts?employee_id=${userId}`),
            fetchWithAuth(`/api/disciplinary?employee_id=${userId}`),
            fetchWithAuth(`/api/leaves?employee_id=${userId}`)
        ]);

        const attendanceData = attRes.status === 'fulfilled' && attRes.value.ok ? await attRes.value.json() : [];
        const payrollData = payRes.status === 'fulfilled' && payRes.value.ok ? await payRes.value.json() : [];
        const shiftData = shiftRes.status === 'fulfilled' && shiftRes.value.ok ? await shiftRes.value.json() : [];
        const discData = discRes.status === 'fulfilled' && discRes.value.ok ? await discRes.value.json() : [];
        const leaveData = leaveRes.status === 'fulfilled' && leaveRes.value.ok ? await leaveRes.value.json() : [];

        return { attendanceData, payrollData, shiftData, discData, leaveData };
    };

    const { data, isLoading } = useQuery({
        queryKey: ['employeeDashboard', user.id],
        queryFn: () => fetchDashboardData(user.id),
        enabled: !!user.id && user.role !== 'security',
        staleTime: 0,
        refetchOnWindowFocus: true,
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
        window.addEventListener('refresh_dashboard', handleRefresh);

        return () => {
            supabase.removeChannel(channel);
            window.removeEventListener('refresh_dashboard', handleRefresh);
        };
    }, [user?.id, queryClient]);

    // Derived state
    const rawAttendance = data?.attendanceData?.data || data?.attendanceData || [];
    const recentLogs = Array.isArray(rawAttendance) ? rawAttendance.slice(0, 5) : [];

    const rawPayroll = data?.payrollData?.data || data?.payrollData || [];
    const latestPayroll = Array.isArray(rawPayroll) && rawPayroll.length > 0 ? rawPayroll[0] : (rawPayroll?.id ? rawPayroll : null);
    
    const rawShifts = data?.shiftData?.data || data?.shiftData || [];
    const myData = Array.isArray(rawShifts) 
        ? rawShifts.find(emp => String(emp.id) === String(user.id)) 
        : (rawShifts?.id === user.id ? rawShifts : null);
    const shift = myData?.shift || user?.shift || 'Unassigned';

    const rawDisc = data?.discData?.data || data?.discData || [];
    const discData = Array.isArray(rawDisc) ? rawDisc : [];
    const infractions = discData.filter(log => String(log.employee_id) === String(user.id) && log.status === 'Active');
    const unresolvedInfractions = discData.filter(log => String(log.employee_id) === String(user.id) && log.status !== 'Resolved');
    
    const rawLeaves = data?.leaveData?.data || data?.leaveData || [];
    const myLeaves = Array.isArray(rawLeaves) ? rawLeaves.slice(0, 5) : [];

    const handleLeaveSubmit = async (e) => {
        e.preventDefault();
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

    const handleAcknowledgeAll = async () => {
        try {
            await Promise.all(infractions.map(inf => 
                fetchWithAuth(`/api/disciplinary/${inf.id}/acknowledge`, { method: 'PUT' })
            ));
            toast.success('All memos acknowledged.');
            setShowInfractionsModal(false);
            queryClient.invalidateQueries(['employeeDashboard', user.id]);
        } catch (err) {
            toast.error('Failed to acknowledge memos.');
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

    const shiftDetails = {
        'Morning': { time: '06:00 AM - 02:00 PM', color: 'text-amber-500', bg: 'bg-amber-500/10' },
        'Swing': { time: '02:00 PM - 10:00 PM', color: 'text-orange-500', bg: 'bg-orange-500/10' },
        'Night': { time: '10:00 PM - 06:00 AM', color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
        'Unassigned': { time: 'No Schedule', color: 'text-slate-400', bg: 'bg-slate-100' }
    };
    
    const sDetails = shiftDetails[shift] || shiftDetails['Unassigned'];

    // Animation variants
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { 
            opacity: 1, 
            transition: { 
                staggerChildren: 0.05 
            } 
        }
    };
    
    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: { 
            opacity: 1, 
            y: 0, 
            transition: { 
                type: 'spring', 
                stiffness: 400, 
                damping: 30 
            } 
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('user');
        window.location.href = '/login';
    };

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 px-4 sm:px-6 font-sans">
            
            {/* Infraction Alert Banner */}
            
                {infractions.length > 0 && (
                    <div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="bg-red-500 rounded-2xl p-4 sm:p-5 text-white shadow-lg shadow-red-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                                <i className="ti ti-alert-triangle text-2xl" />
                            </div>
                            <div>
                                <h3 className="font-black text-sm sm:text-base tracking-tight">Attention Required: Disciplinary Notice</h3>
                                <p className="text-red-100 text-xs sm:text-sm font-medium">You have {infractions.length} active disciplinary memo(s). Please see HR.</p>
                            </div>
                        </div>
                        <button onClick={() => setShowInfractionsModal(true)} className="px-5 py-2.5 sm:px-6 sm:py-3 bg-white text-red-600 font-bold rounded-xl shadow-sm tap-active shrink-0 text-sm">
                            View Details
                        </button>
                    </div>
                )}
            

            <div className="space-y-5 sm:space-y-8">
                
                {/* Welcome header with Profile & Logout */}
                <div className="flex items-start justify-between gap-4 pt-2 sm:pt-4">
                    <div>
                        <p className="text-blue-600 font-bold tracking-widest uppercase text-xs sm:text-sm mb-1">{formattedToday}</p>
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                            Good day,<br/><span className="text-blue-600">{getFirstName(user.name)}!</span>
                        </h1>
                        <p className="text-slate-500 font-medium mt-1 text-xs sm:text-sm">
                            {user.job_title || 'Staff'} • {user.department}
                        </p>
                    </div>
                    
                    {/* User Avatar & Logout Action */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                        <Link to="/employee/profile" title="View 201 Profile" className="tap-active group">
                            <EmployeeAvatar
                                employee={user}
                                photoUrl={photoUrl}
                                size="w-14 h-14 sm:w-16 sm:h-16"
                                rounded="rounded-xl"
                                border="border-2 border-slate-200"
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
                    
                    {/* Payroll */}
                    <div 
                        onClick={() => { if(latestPayroll) setShowPayslipModal(true); else toast.error('No payslip available yet.'); }}
                        className="relative overflow-hidden bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all rounded-2xl p-5 sm:p-6 md:p-8 cursor-pointer shadow-xl shadow-emerald-600/20 group tap-active select-none"
                    >
                        <div className="relative z-10 flex flex-col justify-between h-full text-white">
                            <div className="flex justify-between items-start">
                                <div className="w-11 h-11 sm:w-14 sm:h-14 bg-white/20 backdrop-blur-md rounded-xl sm:rounded-2xl flex items-center justify-center text-white mb-4 sm:mb-6 group-hover:bg-white/30 transition-colors">
                                    <i className="ti ti-wallet text-2xl sm:text-3xl" />
                                </div>
                                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-sm group-hover:bg-white group-hover:text-emerald-700 transition-all shrink-0">
                                    <i className="ti ti-arrow-right text-lg sm:text-xl" />
                                </div>
                            </div>
                            <div>
                                <p className="text-emerald-100 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-1">Latest Net Pay</p>
                                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">
                                    ₱{latestPayroll ? parseFloat(latestPayroll.net_pay).toFixed(2) : '0.00'}
                                </h2>
                                <p className="text-emerald-50 text-xs sm:text-sm mt-1 font-medium">Tap to view full payslip</p>
                            </div>
                        </div>
                    </div>

                    {/* Today's shift */}
                    <div className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 sm:p-6 md:p-8 shadow-xl shadow-slate-900/20 text-white flex flex-col justify-between group select-none">
                        <div className="relative z-10 flex justify-between items-start">
                            <div className="w-11 h-11 sm:w-14 sm:h-14 bg-white/10 backdrop-blur-md rounded-xl sm:rounded-2xl flex items-center justify-center text-blue-400 mb-4 sm:mb-6 group-hover:bg-white/20 transition-colors">
                                <i className="ti ti-calendar-time text-2xl sm:text-3xl" />
                            </div>
                            <span className="px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-300 font-bold text-[10px] sm:text-xs uppercase tracking-wider">
                                Today's Schedule
                            </span>
                        </div>
                        <div className="relative z-10">
                            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-1">Assigned Shift</p>
                            <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight leading-tight">
                                {shift}
                            </h2>
                            <p className="text-blue-300 text-xs sm:text-sm mt-1 font-medium flex items-center gap-1.5">
                                <i className="ti ti-clock text-blue-400" />
                                {sDetails.time}
                            </p>
                        </div>
                    </div>

                </div>

                {/* Secondary actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-5">
                    
                    {/* Leave request */}
                    <div 
                        onClick={() => setShowLeaveModal(true)}
                        className="bg-white rounded-2xl p-4 sm:p-6 shadow-xs sm:shadow-sm border border-slate-100 flex items-center justify-between cursor-pointer group hover:border-blue-200 active:scale-[0.98] transition-all tap-active select-none"
                    >
                        <div className="flex items-center gap-4 sm:gap-5">
                            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600 text-2xl sm:text-3xl shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                <i className="ti ti-plane-departure" />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-800">Request Leave</h3>
                                <p className="text-slate-500 text-xs font-medium mt-0.5">Vacation or Sick days</p>
                            </div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:bg-blue-50 transition-colors shrink-0">
                            <i className="ti ti-plus text-base" />
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

                {/* HR records */}
                {unresolvedInfractions.length > 0 && (
                    <div className="bg-white rounded-2xl p-5 sm:p-8 shadow-xs sm:shadow-sm border border-slate-100">
                        <div className="flex justify-between items-center mb-4 sm:mb-6">
                            <div>
                                <h3 className="text-lg sm:text-xl font-black text-slate-800">HR Records</h3>
                                <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5 sm:mt-1">
                                    You have <span className="text-red-500 font-bold">{unresolvedInfractions.length}</span> unresolved memo(s) on your record.
                                </p>
                            </div>
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center text-xl sm:text-2xl shrink-0">
                                <i className="ti ti-folder-exclamation" />
                            </div>
                        </div>

                        <div className="space-y-3 sm:space-y-4">
                            {unresolvedInfractions.map(infraction => (
                                <div key={infraction.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border border-slate-100 bg-slate-50 rounded-xl gap-3 sm:gap-4">
                                    <div className="flex items-start gap-3 sm:gap-4">
                                        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-red-500 shrink-0">
                                            <i className="ti ti-file-text text-lg sm:text-xl" />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-sm sm:text-base font-bold text-slate-800">{infraction.type}</h4>
                                            <p className="text-xs sm:text-sm text-slate-500 line-clamp-2 mt-0.5">{infraction.reason}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center sm:flex-col sm:items-end gap-2 sm:gap-1 shrink-0 ml-12 sm:ml-0">
                                        <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg border ${
                                            infraction.status === 'Active' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'
                                        }`}>
                                            {infraction.status}
                                        </span>
                                        <span className="text-[11px] sm:text-xs font-bold text-slate-400">
                                            {new Date(infraction.date).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))}
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
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
                            onClick={() => setShowQrModal(false)}
                        />
                        <div 
                            initial={{ scale: 0.95, y: 40, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 40, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full max-w-sm text-center shadow-2xl"
                        >
                            <div className="w-12 sm:w-16 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 sm:mb-8" />
                            
                            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-2xl sm:text-3xl shadow-xl shadow-blue-500/30 mb-3 sm:mb-4 border-4 border-white">
                                {getInitial(user.name)}
                            </div>
                            <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight">{user.name}</h2>
                            <p className="text-slate-500 font-medium mt-1 text-sm">{user.department}</p>

                            <div className="my-6 sm:my-8 bg-slate-50 p-5 sm:p-6 rounded-2xl border border-slate-100 inline-block shadow-inner">
                                <QRCode value={user.id || '0'} size={180} fgColor="#1e293b" />
                            </div>

                            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] sm:text-xs mb-4 sm:mb-6">Hold near the scanner</p>

                            <button onClick={() => setShowQrModal(false)} className="w-full py-3.5 sm:py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl tap-active text-base sm:text-lg">
                                Close ID
                            </button>
                        </div>
                    </div>
                )}
            

            {/* Payslip modal */}
            
                {showPayslipModal && latestPayroll && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
                            onClick={() => setShowPayslipModal(false)}
                        />
                        <div 
                            initial={{ scale: 0.95, y: 40, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 40, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto touch-scroll"
                        >
                            <div className="bg-emerald-600 p-6 sm:p-8 text-white text-center relative">
                                <div className="w-12 sm:w-16 h-1.5 bg-white/20 rounded-full mx-auto mb-4 sm:mb-6" />
                                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-white/20 backdrop-blur-md rounded-xl sm:rounded-2xl mx-auto flex items-center justify-center border border-white/20 mb-3 sm:mb-4 shadow-lg">
                                    <i className="ti ti-receipt-2 text-2xl sm:text-3xl" />
                                </div>
                                <h3 className="text-xl sm:text-2xl font-black tracking-tight">Your Payslip</h3>
                                <p className="text-emerald-100 text-xs sm:text-sm font-bold mt-1 sm:mt-2 uppercase tracking-widest">
                                    {new Date(latestPayroll.period_start).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})} - {new Date(latestPayroll.period_end).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}
                                </p>
                            </div>
                            
                            <div className="p-5 sm:p-8 space-y-4 sm:space-y-5">
                                <div className="flex justify-between items-center pb-3 sm:pb-4 border-b border-dashed border-slate-200">
                                    <span className="text-slate-500 font-bold text-sm">Basic Pay</span>
                                    <span className="font-mono text-slate-800 font-bold text-base sm:text-lg">₱{parseFloat(latestPayroll.basic_pay).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center pb-3 sm:pb-4 border-b border-dashed border-slate-200">
                                    <span className="text-slate-500 font-bold text-sm">Overtime Pay</span>
                                    <span className="font-mono text-emerald-600 font-bold text-base sm:text-lg">+ ₱{parseFloat(latestPayroll.overtime_pay).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center pb-3 sm:pb-4 border-b border-dashed border-slate-200">
                                    <span className="text-slate-500 font-bold text-sm">Deductions</span>
                                    <span className="font-mono text-red-500 font-bold text-base sm:text-lg">- ₱{parseFloat(latestPayroll.deductions).toFixed(2)}</span>
                                </div>
                                
                                <div className="mt-4 sm:mt-6 bg-slate-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-slate-100 flex justify-between items-center">
                                    <span className="font-bold text-slate-500 uppercase tracking-widest text-[10px] sm:text-xs">Total Net</span>
                                    <span className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">₱{parseFloat(latestPayroll.net_pay).toFixed(2)}</span>
                                </div>
                                
                                <button onClick={() => setShowPayslipModal(false)} className="w-full mt-3 sm:mt-4 py-3.5 sm:py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl tap-active text-base sm:text-lg">
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            

            {/* Leave request modal */}
            
                {showLeaveModal && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
                            onClick={() => setShowLeaveModal(false)}
                        />
                        <div 
                            initial={{ scale: 0.95, y: 40, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 40, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
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
            

            {/* Infractions modal */}
            
                {showInfractionsModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                            onClick={() => setShowInfractionsModal(false)}
                        />
                        <div 
                            initial={{ scale: 0.95, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.95, y: 20, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-[3rem] w-full max-w-lg overflow-hidden shadow-2xl p-8 max-h-[80vh] flex flex-col"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-2xl">
                                        <i className="ti ti-alert-triangle" />
                                    </div>
                                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Active Memos</h2>
                                </div>
                                <button onClick={() => setShowInfractionsModal(false)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors">
                                    <i className="ti ti-x text-xl" />
                                </button>
                            </div>

                            <div className="overflow-y-auto pr-2 space-y-4">
                                {infractions.map(infraction => (
                                    <div key={infraction.id} className="p-5 border border-red-100 bg-red-50/50 rounded-2xl">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-black uppercase tracking-widest rounded-lg">
                                                {infraction.type}
                                            </span>
                                            <span className="text-xs font-bold text-slate-400">
                                                {new Date(infraction.date).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-bold text-slate-800 mb-1">{infraction.type}</h3>
                                        <p className="text-slate-600 text-sm leading-relaxed">{infraction.reason}</p>
                                    </div>
                                ))}
                            </div>
                            
                            <div className="mt-6 pt-6 border-t border-slate-100">
                                <button onClick={handleAcknowledgeAll} className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl shadow-xl hover:bg-slate-800 active:scale-95 transition-all">
                                    I Understand & Acknowledge
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            

        </div>
    );
};

export default EmployeeDashboard;
