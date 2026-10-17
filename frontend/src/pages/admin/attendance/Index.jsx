import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

const SESSION_CACHE_KEY = 'cpoint_admin_daily_attendance_logs_v2';

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const Index = () => {
    const queryClient = useQueryClient();

    // Clear old deprecated cache key if present
    useEffect(() => {
        try {
            sessionStorage.removeItem('cpoint_admin_daily_attendance_logs');
        } catch (_) {}
    }, []);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 12;

    // Proof photo modal state
    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedImageType, setSelectedImageType] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const { data: employeeList = [] } = useQuery({
        queryKey: ['adminEmployeesListForAttendance'],
        queryFn: async () => {
            const { data } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name, role, department, job_title, status, date_hired, timekeeping_effective_date, created_at');
            return data || [];
        },
        staleTime: 120000,
        refetchOnWindowFocus: false,
    });

    const isExemptOperator = useCallback((emp) => {
        if (!emp) return false;
        const r = (emp.role || '').toLowerCase().replace(/[\s_-]/g, '');
        const dept = (emp.department || '').toLowerCase();
        const title = (emp.job_title || emp.position || '').toLowerCase();
        const status = (emp.status || 'active').toLowerCase();

        if (status !== 'active') return true;

        return (
            ['admin', 'security', 'guard', 'securityguard', 'hr', 'hrmanager'].includes(r) ||
            dept === 'security' || dept === 'administration' || dept === 'human resources' || dept === 'it' ||
            title.includes('guard') || title.includes('security') || title.includes('administrator') || title.includes('admin')
        );
    }, []);

    // Active operational workforce employees strictly separated from system operators
    const activeWorkforceEmployees = useMemo(() => {
        return (employeeList || []).filter(emp => !isExemptOperator(emp));
    }, [employeeList, isExemptOperator]);

    const employeeMap = useMemo(() => {
        const map = new Map();
        for (const emp of employeeList) {
            if (emp.id) map.set(emp.id, emp);
        }
        return map;
    }, [employeeList]);

    const resolveEmployee = useCallback((log) => {
        if (log.employees && (log.employees.first_name || log.employees.company_id)) {
            return log.employees;
        }
        return employeeMap.get(log.employee_id) || null;
    }, [employeeMap]);

    const getEmployeeCpId = useCallback((log) => {
        const emp = resolveEmployee(log);
        return emp?.company_id || log.company_id || (log.employee_id ? `CP-${String(log.employee_id).substring(0, 8).toUpperCase()}` : 'N/A');
    }, [resolveEmployee]);

    const getEmployeeFullName = useCallback((log) => {
        const emp = resolveEmployee(log);
        if (emp && (emp.first_name || emp.last_name)) {
            return `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
        }
        return 'Unknown Worker';
    }, [resolveEmployee]);

    // Query attendance data from backend
    const fetchAttendance = async () => {
        const params = new URLSearchParams();
        params.append('date', getTodayDateString());
        params.append('limit', '250');
        params.append('refresh', 'true');

        const res = await fetchWithAuth(`/api/attendance?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch attendance');
        const logsData = data.data || data || [];
        return logsData;
    };

    const {
        data: rawLogs = [],
        isLoading
    } = useQuery({
        queryKey: ['adminAttendance', 'date', getTodayDateString(), 'all'],
        queryFn: fetchAttendance,
        staleTime: 15000,
        refetchOnWindowFocus: false,
    });

    // Real-time WebSocket subscriptions on attendance, leaves, and employee changes
    useEffect(() => {
        const liveChannel = supabase
            .channel('realtime_admin_attendance_feed')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminAttendance'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminAttendance'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminAttendance'] });
                queryClient.invalidateQueries({ queryKey: ['adminEmployeesListForAttendance'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(liveChannel);
        };
    }, [queryClient]);

    // Resilient client-side reconciliation: guarantees full workforce representation
    const unifiedLogs = useMemo(() => {
        // Filter out exempt technical staff and security guards
        const validLogs = (rawLogs || []).filter(log => {
            const emp = resolveEmployee(log);
            return !isExemptOperator(emp);
        });

        // In historical mode ('all'), return straight chronological logs
        // Ensure every active workforce member has a record.
        const targetDate = getTodayDateString();
        const deptWorkforce = activeWorkforceEmployees;

        const logByEmpId = new Map();
        validLogs.forEach(log => {
            if (log.employee_id) {
                logByEmpId.set(log.employee_id, log);
            }
        });

        const isToday = targetDate === getTodayDateString();

        return deptWorkforce.map(emp => {
            const existing = logByEmpId.get(emp.id);
            if (existing) {
                return {
                    ...existing,
                    employees: existing.employees || emp
                };
            }

            const hireDate = String(emp.date_hired || emp.created_at || '').slice(0, 10);
            const isPreHire = Boolean(hireDate && targetDate < hireDate);
            if (isPreHire) {
                return {
                    id: `roster-${emp.id}-${targetDate}`,
                    employee_id: emp.id,
                    date: targetDate,
                    time_in: null,
                    time_out: null,
                    status: 'Pre-Hire',
                    is_absent: false,
                    is_pre_hire: true,
                    is_awaiting: false,
                    employees: emp
                };
            }

            const timekeepingStart = String(emp.timekeeping_effective_date || emp.created_at || emp.date_hired || '').slice(0, 10);
            const isUntracked = Boolean(timekeepingStart && targetDate < timekeepingStart);
            if (isUntracked) {
                return {
                    id: `roster-${emp.id}-${targetDate}`,
                    employee_id: emp.id,
                    date: targetDate,
                    time_in: null,
                    time_out: null,
                    status: 'Legacy Tenure',
                    is_absent: false,
                    is_not_tracked: true,
                    is_awaiting: false,
                    employees: emp
                };
            }

            return {
                id: `roster-${emp.id}-${targetDate}`,
                employee_id: emp.id,
                date: targetDate,
                time_in: null,
                time_out: null,
                status: isToday ? 'Awaiting Clock-in' : 'Absent',
                is_absent: !isToday,
                is_awaiting: isToday,
                employees: emp
            };
        });
    }, [rawLogs, activeWorkforceEmployees, resolveEmployee, isExemptOperator]);

    const filteredLogs = unifiedLogs;

    // Pagination calculations
    const totalItems = filteredLogs.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const safeCurrentPage = Math.min(currentPage, totalPages);
    const paginatedLogs = filteredLogs.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);

    const isLogOnLeave = (log) => Boolean(log.is_on_leave || String(log.status || '').toLowerCase().includes('leave'));
    const isLogPaidLeave = (log) => isLogOnLeave(log) && log.is_paid !== false && !String(log.status || '').toLowerCase().includes('unpaid');

    const getLogStatusVariant = (log) => {
        if (isLogOnLeave(log)) return isLogPaidLeave(log) ? 'paid_leave' : 'leave';
        const s = String(log.status || '').toLowerCase();
        if (s.includes('legacy') || s.includes('untracked') || s.includes('pre-hire')) return 'neutral';
        if (s.includes('absent')) return 'absent';
        if (s.includes('late')) return 'late';
        if (s.includes('awaiting')) return 'neutral';
        return 'present';
    };

    const getLogStatusLabel = (log) => {
        if (isLogOnLeave(log)) {
            if (log.leave_type) {
                return `${log.leave_type} (${isLogPaidLeave(log) ? 'Paid' : 'Unpaid'})`;
            }
            return isLogPaidLeave(log) ? 'Paid Leave' : 'On Leave';
        }
        return log.status || 'Present';
    };

    const copyCpId = useCallback((e, id) => {
        e.stopPropagation();
        if (!id || id === 'N/A') return;
        navigator.clipboard.writeText(id);
        toast.success(`Copied CP ID: ${id}`, { id: 'copy-cpid' });
    }, []);

    const openImageModal = (imageUrl, type) => {
        if (!imageUrl) return;
        setSelectedImage(imageUrl);
        setSelectedImageType(type);
        setIsModalOpen(true);
        document.body.style.overflow = 'hidden';
    };

    const closeImageModal = () => {
        setIsModalOpen(false);
        document.body.style.overflow = '';
        setTimeout(() => setSelectedImage(null), 300);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isModalOpen) closeImageModal();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen]);

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader breadcrumbs={['Admin', 'Attendance', 'Daily Logs']} />

            <div className="space-y-4 sm:space-y-6">
                {/* Main Attendance List */}
                <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                    {/* Mobile Card List View */}
                    <div className="block md:hidden divide-y divide-slate-100">
                        {paginatedLogs.length > 0 ? paginatedLogs.map((log) => {
                            const resolvedEmp = resolveEmployee(log);
                            const fullName = getEmployeeFullName(log);
                            const cpId = getEmployeeCpId(log);

                            return (
                                <div key={`mobile-${log.id}`} className="p-4 space-y-3 hover:bg-slate-50/70 transition-colors">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <EmployeeAvatar employee={resolvedEmp} companyId={cpId} employeeId={log.employee_id} size="h-10 w-10" />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <p className="text-sm font-bold text-slate-800 truncate">{fullName}</p>
                                                    <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border bg-slate-900 text-white border-slate-800">
                                                        {resolvedEmp?.department || 'Staff'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">CP ID:</span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => copyCpId(e, cpId)}
                                                        title="Click to copy CP ID"
                                                        className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded border border-slate-200/80 cursor-pointer select-none"
                                                    >
                                                        <span>{cpId}</span>
                                                        <i className="ti ti-copy text-[10px] text-slate-400" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="text-right shrink-0">
                                            <span className="text-[11px] font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                                {new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Timing Grid */}
                                    <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-md border border-slate-200">
                                        <div>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Time In</p>
                                            {isLogOnLeave(log) ? (
                                                <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                                    Excused
                                                </span>
                                            ) : log.time_in ? (
                                                <span className="font-mono text-xs font-bold text-slate-900">
                                                    {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            ) : (
                                                <span className="font-mono text-xs text-slate-400">--:--</span>
                                            )}
                                        </div>

                                        <div className="border-l border-slate-200 pl-2">
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Time Out</p>
                                            {isLogOnLeave(log) ? (
                                                <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                                    Leave
                                                </span>
                                            ) : log.time_out ? (
                                                <span className="font-mono text-xs font-bold text-slate-900">
                                                    {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            ) : log.date === getTodayDateString() ? (
                                                <span className="text-[10px] font-bold text-warning-ink uppercase tracking-wider">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                                    --:--
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-1">
                                        <Badge variant={getLogStatusVariant(log)}>
                                            {getLogStatusLabel(log)}
                                        </Badge>
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="p-8 text-center text-slate-400">
                                <p className="text-xs font-bold">No workforce attendance records found</p>
                            </div>
                        )}
                    </div>

                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto no-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-3.5">Employee</th>
                                    <th className="px-6 py-3.5">Department</th>
                                    <th className="px-6 py-3.5">Date</th>
                                    <th className="px-6 py-3.5 text-center">Time In</th>
                                    <th className="px-6 py-3.5 text-center">Time Out</th>
                                    <th className="px-6 py-3.5 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {paginatedLogs.length > 0 ? paginatedLogs.map((log) => {
                                    const resolvedEmp = resolveEmployee(log);
                                    const fullName = getEmployeeFullName(log);
                                    const cpId = getEmployeeCpId(log);
                                    const dept = resolvedEmp?.department || 'Staff';

                                    return (
                                        <tr key={log.id} className="hover:bg-slate-50/70 transition-colors duration-100">
                                            {/* Worker Column */}
                                            <td className="px-6 py-3.5">
                                                <div className="flex items-center gap-3">
                                                    <EmployeeAvatar employee={resolvedEmp} companyId={cpId} employeeId={log.employee_id} size="h-10 w-10" />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-slate-900 truncate">
                                                            {fullName}
                                                        </p>
                                                        <div className="flex items-center gap-1.5 mt-0.5">
                                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">CP ID:</span>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => copyCpId(e, cpId)}
                                                                title="Click to copy CP ID"
                                                                className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded border border-slate-200/80 cursor-pointer select-none"
                                                            >
                                                                <span>{cpId}</span>
                                                                <i className="ti ti-copy text-[11px] text-slate-400" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Department Column */}
                                            <td className="px-6 py-3.5">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-900 text-white border border-slate-800">
                                                    {dept}
                                                </span>
                                            </td>

                                            {/* Date Column */}
                                            <td className="px-6 py-3.5">
                                                <p className="text-sm font-medium text-slate-600 font-mono tabular-nums">
                                                    {new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                </p>
                                            </td>

                                            {/* Time In Column */}
                                            <td className="px-6 py-3.5 text-center">
                                                <div className="flex flex-col items-center gap-1.5">
                                                    {isLogOnLeave(log) ? (
                                                        <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200 tabular-nums">
                                                            Excused
                                                        </span>
                                                    ) : log.time_in ? (
                                                        <span className="font-mono text-xs font-semibold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200 tabular-nums">
                                                            {new Date(log.time_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 font-mono">--:--</span>
                                                    )}
                                                    {log.time_in_photo && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`, 'Time In'); }}
                                                            onContextMenu={(e) => e.preventDefault()}
                                                            className="relative w-8 h-8 rounded-md overflow-hidden border border-slate-200 shadow-2xs hover:border-accent transition-colors duration-100 cursor-zoom-in select-none"
                                                            title="Inspect punch verification proof"
                                                        >
                                                            <img
                                                                src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_in_photo}`}
                                                                onContextMenu={(e) => e.preventDefault()}
                                                                draggable={false}
                                                                className="w-full h-full object-cover pointer-events-none select-none"
                                                                alt="Proof"
                                                            />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Time Out Column */}
                                            <td className="px-6 py-3.5 text-center">
                                                <div className="flex flex-col items-center gap-1.5">
                                                    {isLogOnLeave(log) ? (
                                                        <span className="bg-slate-100 text-slate-800 border border-slate-200 px-2.5 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider">
                                                            Approved Leave
                                                        </span>
                                                    ) : log.time_out ? (
                                                        <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200 tabular-nums">
                                                            {new Date(log.time_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    ) : log.date === getTodayDateString() ? (
                                                        <span className="bg-warning-subtle text-warning-ink border border-warning/20 px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider">
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-slate-400 font-mono">--:--</span>
                                                    )}
                                                    {log.time_out_photo && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); openImageModal(`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`, 'Time Out'); }}
                                                            onContextMenu={(e) => e.preventDefault()}
                                                            className="relative w-8 h-8 rounded-md overflow-hidden border border-slate-200 shadow-2xs hover:border-accent transition-colors duration-100 cursor-zoom-in select-none"
                                                            title="Inspect punch verification proof"
                                                        >
                                                            <img
                                                                src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${log.time_out_photo}`}
                                                                onContextMenu={(e) => e.preventDefault()}
                                                                draggable={false}
                                                                className="w-full h-full object-cover pointer-events-none select-none"
                                                                alt="Proof"
                                                            />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Status Column */}
                                            <td className="px-6 py-3.5 text-center">
                                                <Badge variant={getLogStatusVariant(log)}>
                                                    {getLogStatusLabel(log)}
                                                </Badge>
                                            </td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan="6" className="px-6 py-16 text-center">
                                            <div className="flex flex-col items-center justify-center text-slate-400">
                                                <div className="w-12 h-12 bg-slate-50 rounded-lg flex items-center justify-center mb-3 border border-slate-200">
                                                    <i className="ti ti-clipboard-list text-2xl text-slate-400" />
                                                </div>
                                                <p className="text-sm font-bold text-slate-800">No attendance records found</p>
                                                <p className="text-xs text-slate-500 mt-1">Try adjusting the department filter or date range.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Bar */}
                    <div className="px-4 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-semibold">
                        <div>
                            {totalItems > 0 ? (
                                <span>Showing <span className="text-slate-800 font-semibold">{(safeCurrentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-semibold">{Math.min(safeCurrentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-semibold">{totalItems}</span></span>
                            ) : (
                                <span>Showing 0 of 0</span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={safeCurrentPage <= 1}
                                className="h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                            >
                                <i className="ti ti-chevron-left text-sm" /> Prev
                            </button>

                            <span className="h-8 px-3 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-800 font-semibold text-xs font-mono">
                                {safeCurrentPage} / {totalPages}
                            </span>

                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={safeCurrentPage >= totalPages}
                                className="h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 shadow-2xs flex items-center gap-1.5"
                            >
                                Next <i className="ti ti-chevron-right text-sm" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Verification Proof Image Modal */}
            {isModalOpen && selectedImage && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={closeImageModal}
                    />
                    <div className="relative bg-white rounded-lg p-5 w-full max-w-lg shadow-xl border border-slate-200">
                        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 tracking-wide flex items-center gap-1.5">
                                    <i className="ti ti-camera text-accent text-base" />
                                    <span>{selectedImageType} Verification Capture</span>
                                </h3>
                                <p className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[340px]">
                                    {selectedImage.split('/').pop()}
                                </p>
                            </div>
                            <button
                                onClick={closeImageModal}
                                title="Close Preview (Esc)"
                                className="w-8 h-8 rounded-md bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors duration-100 border border-slate-200 cursor-pointer"
                            >
                                <i className="ti ti-x text-base font-semibold" />
                            </button>
                        </div>

                        <div
                            onContextMenu={(e) => e.preventDefault()}
                            className="bg-slate-900/5 rounded-md overflow-hidden flex justify-center min-h-[200px] border border-slate-200 select-none"
                        >
                            <img
                                key={selectedImage}
                                src={selectedImage}
                                onContextMenu={(e) => e.preventDefault()}
                                draggable={false}
                                alt="Verification Proof"
                                className="w-full h-auto object-contain max-h-[65vh] rounded-md pointer-events-none select-none"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Index;
