import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import ActionMenu from '../../../components/ui/ActionMenu';
import OtpVerificationModal from "../../../components/OtpVerificationModal";
import { getShoeRoleDetails, parseProductionGroup } from '../../../utils/factoryRoles';

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Terminated employees stay visible in the directory under "Pending Termination" for this
// many days (counted from when the termination was recorded) before moving to the Archive.
const PENDING_TERMINATION_DAYS = 14;

function getTerminationTimestamp(emp) {
    return emp?.archived_at || emp?.separation_date || emp?.updated_at || null;
}

function getDaysUntilArchive(emp) {
    const ts = getTerminationTimestamp(emp);
    if (!ts) return null;
    const elapsedDays = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.ceil(PENDING_TERMINATION_DAYS - elapsedDays));
}

export default function EmployeesIndex() {
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    
    // UI State
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState('All');
    const [filterStatus, setFilterStatus] = useState('Active');
    const [viewMode, setViewMode] = useState('grid');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = viewMode === 'grid' ? 9 : 12;
    const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);

    // Retrieve the active logged-in user session
    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem('user') || localStorage.getItem('authUser') || '{}');
        } catch {
            return {};
        }
    }, []);

    // Temporary password modal state
    const [tempCreds, setTempCreds] = useState(null);
    const [copiedField, setCopiedField] = useState(null);
    const [copiedAll, setCopiedAll] = useState(false);
    const [showPassword, setShowPassword] = useState(true);



    const handleArchiveAccessClick = (e) => {
        if (e) e.preventDefault();
        const unlockKey = `cpoint_employee_module_unlocked_${currentUser?.id || currentUser?.email || 'admin'}`;
        try {
            if (sessionStorage.getItem(unlockKey) === 'true') {
                navigate('/admin/archive');
                return;
            }
        } catch {}
        setIsSecurityModalOpen(true); 
    };

    useEffect(() => {
        if (location.state?.temp_password) {
            setTempCreds({
                company_id: location.state.company_id,
                temp_password: location.state.temp_password,
                email: location.state.email,
                name: location.state.name
            });
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location.state, location.pathname, navigate]);

    const copyToClipboard = useCallback((text, fieldName) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedField(fieldName);
        toast.success(`${fieldName} copied!`);
        setTimeout(() => setCopiedField(null), 2000);
    }, []);

    const copyAllCredentials = useCallback(() => {
        if (!tempCreds) return;
        const text = `C-POINT HRIS Account Credentials\nCompany ID: ${tempCreds.company_id || ''}\nEmail: ${tempCreds.email || ''}\nTemporary Password: ${tempCreds.temp_password || ''}\nLogin Portal: ${window.location.origin}/login`;
        navigator.clipboard.writeText(text);
        setCopiedAll(true);
        toast.success('All credentials copied to clipboard!');
        setTimeout(() => setCopiedAll(false), 2000);
    }, [tempCreds]);

    const fetchEmployees = async () => {
        const res = await fetchWithAuth('/api/employees');
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch employee records');
        const data = Array.isArray(result) ? result : (result.data || []);
        
        return data.filter(emp => {
            const isTerm = emp.operational_status === 'Terminated' || emp.is_terminated || emp.status === 'terminated' || Boolean(emp.archived_at);
            if (isTerm) {
                // Keep terminated / separated personnel in directory during the 14-day clearance cooldown window
                const daysLeft = getDaysUntilArchive(emp);
                return daysLeft === null || daysLeft > 0;
            }
            // Active and suspended personnel are always retained in directory
            return true;
        });
    };

    const { data: employees = [], isLoading } = useQuery({
        queryKey: ['adminEmployees'],
        queryFn: fetchEmployees,
        staleTime: 15_000,
        gcTime: 300_000,
        refetchOnWindowFocus: false,
    });

    // Realtime subscriptions for directory updates
    useEffect(() => {
        const handleSync = (payload) => {
            // Instant in-memory cache update for sub-millisecond perceived latency
            if (payload?.eventType && payload?.table === 'employees') {
                if (payload.eventType === 'UPDATE' && payload.new) {
                    queryClient.setQueryData(['adminEmployees'], (oldData) => {
                        if (!Array.isArray(oldData)) return oldData;
                        return oldData.map(emp => emp.id === payload.new.id ? { ...emp, ...payload.new } : emp);
                    });
                } else if (payload.eventType === 'INSERT' && payload.new) {
                    queryClient.setQueryData(['adminEmployees'], (oldData) => {
                        if (!Array.isArray(oldData)) return [payload.new];
                        if (oldData.some(emp => emp.id === payload.new.id)) return oldData;
                        return [payload.new, ...oldData];
                    });
                } else if (payload.eventType === 'DELETE' && payload.old) {
                    queryClient.setQueryData(['adminEmployees'], (oldData) => {
                        if (!Array.isArray(oldData)) return oldData;
                        return oldData.filter(emp => emp.id !== payload.old.id);
                    });
                }
            } else if (payload?.payload?.employee_id || payload?.payload?.employeeId) {
                const targetEmpId = payload.payload.employee_id || payload.payload.employeeId;
                const evt = payload.event;
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    if (!Array.isArray(oldData)) return oldData;
                    return oldData.map(emp => {
                        if (emp.id !== targetEmpId) return emp;
                        if (evt === 'EMPLOYEE_TERMINATED') {
                            return {
                                ...emp,
                                is_terminated: true,
                                is_suspended: false,
                                operational_status: 'Terminated',
                                status: 'inactive',
                                is_active: false,
                                separation_reason: payload.payload.reason || emp.separation_reason,
                                termination_record: {
                                    type: 'Termination',
                                    reason: payload.payload.reason || 'Contract Concluded / Terminated',
                                    date: payload.payload.date || new Date().toISOString()
                                }
                            };
                        }
                        if (evt === 'EMPLOYEE_SUSPENDED') {
                            return {
                                ...emp,
                                is_terminated: false,
                                is_suspended: true,
                                operational_status: 'Suspended',
                                status: 'suspended',
                                is_active: false,
                                active_suspension: {
                                    type: 'Suspension',
                                    reason: payload.payload.reason || 'Serving disciplinary suspension',
                                    status: 'Active'
                                }
                            };
                        }
                        if (evt === 'EMPLOYEE_RESTORED' || evt === 'DISCIPLINARY_RESOLVED' || evt === 'DISCIPLINARY_OVERTURNED') {
                            return {
                                ...emp,
                                is_terminated: false,
                                is_suspended: false,
                                operational_status: 'Active',
                                status: 'active',
                                is_active: true,
                                active_suspension: null,
                                termination_record: null
                            };
                        }
                        return emp;
                    });
                });
            }
            queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
        };

        window.addEventListener('hris_disciplinary_sync', handleSync);

        const channel = supabase
            .channel('admin-live-employees-directory')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs' }, handleSync)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'production_groups' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_SUSPENDED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_STATUS_UPDATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_DELETED' }, handleSync)
            .subscribe();

        const syncChannel = supabase
            .channel('disciplinary_realtime_sync')
            .on('broadcast', { event: 'EMPLOYEE_SUSPENDED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_STATUS_UPDATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_DELETED' }, handleSync)
            .subscribe();

        const updatesChannel = supabase
            .channel('disciplinary-updates')
            .on('broadcast', { event: 'EMPLOYEE_SUSPENDED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, handleSync)
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_STATUS_UPDATED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, handleSync)
            .on('broadcast', { event: 'DISCIPLINARY_DELETED' }, handleSync)
            .subscribe();

        return () => {
            window.removeEventListener('hris_disciplinary_sync', handleSync);
            supabase.removeChannel(channel);
            supabase.removeChannel(syncChannel);
            supabase.removeChannel(updatesChannel);
        };
    }, [queryClient]);

    // Extract unique department list for filtering
    const departments = useMemo(() => {
        const depts = new Set();
        employees.forEach(e => {
            if (e.department) depts.add(e.department);
        });
        return ['All', ...Array.from(depts)];
    }, [employees]);

    // Filter employees by status, department, and search query, sorted alphabetically
    const filteredEmployees = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();

        return employees
            .filter(emp => {
                const roleStr = (emp.role || emp.job_title || '').toLowerCase();
                const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim().toLowerCase();
                const email = (emp.email || '').toLowerCase();

                // Exclude system service accounts
                if (
                    fullName.includes('terminal guard') ||
                    fullName.includes('system admin') ||
                    email === 'guard@c-point.com' ||
                    email === 'admin@c-point.com' ||
                    roleStr.includes('admin') ||
                    roleStr.includes('security')
                ) {
                    return false;
                }

                const isFactory = (emp.department || '').toLowerCase().includes('factory');
                const isSuspended = Boolean(
                    emp.operational_status === 'Suspended' || 
                    emp.is_suspended ||
                    emp.status === 'suspended'
                );
                const isTerminated = !isSuspended && Boolean(
                    emp.operational_status === 'Terminated' || 
                    emp.is_terminated ||
                    emp.status === 'terminated' ||
                    (Boolean(emp.archived_at) && emp.status !== 'active')
                );
                const isActive = !isTerminated && !isSuspended;

                if (filterStatus === 'Active' && !isActive) return false;
                if (filterStatus === 'Suspended' && !isSuspended) return false;
                if ((filterStatus === 'Terminated' || filterStatus === 'Pending Termination' || filterStatus === 'Separated') && !isTerminated) return false;
                if (filterStatus === 'Salaried' && isFactory) return false;
                if (filterStatus === 'Piece-Rate' && !isFactory) return false;

                if (selectedDepartment !== 'All' && emp.department !== selectedDepartment) return false;

                if (q) {
                    const companyId = (emp.company_id || '').toLowerCase();
                    const jobTitle = (emp.job_title || '').toLowerCase();

                    if (!fullName.includes(q) && !companyId.includes(q) && !email.includes(q) && !jobTitle.includes(q)) {
                        return false;
                    }
                }

                return true;
            })
            .sort((a, b) => {
                // Tiered hierarchy: Active and suspended personnel (operational workforce) first,
                // followed by separated personnel pending final archive review.
                const aTerm = (a.operational_status === 'Terminated' || a.is_terminated || a.status === 'terminated' || Boolean(a.archived_at)) ? 1 : 0;
                const bTerm = (b.operational_status === 'Terminated' || b.is_terminated || b.status === 'terminated' || Boolean(b.archived_at)) ? 1 : 0;
                if (aTerm !== bTerm) return aTerm - bTerm;

                // Alphabetical sort within tier: Last Name ascending, then First Name ascending
                const lastNameA = (a.last_name || '').trim();
                const lastNameB = (b.last_name || '').trim();
                const comp = lastNameA.localeCompare(lastNameB, undefined, { sensitivity: 'base' });
                if (comp !== 0) return comp;

                const firstNameA = (a.first_name || '').trim();
                const firstNameB = (b.first_name || '').trim();
                return firstNameA.localeCompare(firstNameB, undefined, { sensitivity: 'base' });
            });
    }, [employees, filterStatus, selectedDepartment, searchQuery]);

    // Calculate directory metrics in single pass
    const counts = useMemo(() => {
        let all = 0;
        let active = 0;
        let suspended = 0;
        let pendingTermination = 0;
        let salaried = 0;
        let pieceRate = 0;

        for (let i = 0; i < employees.length; i++) {
            const e = employees[i];
            const r = (e.role || '').toLowerCase();
            const em = (e.email || '').toLowerCase();
            const fn = `${e.first_name || ''} ${e.last_name || ''}`.trim().toLowerCase();
            if (r.includes('admin') || r.includes('security') || em === 'admin@c-point.com' || em === 'guard@c-point.com' || fn.includes('terminal guard') || fn.includes('system admin')) {
                continue;
            }

            all++;
            const isSusp = Boolean(
                e.operational_status === 'Suspended' || 
                e.is_suspended ||
                e.status === 'suspended'
            );
            const isTerminated = !isSusp && Boolean(
                e.operational_status === 'Terminated' || 
                e.is_terminated ||
                e.status === 'terminated' ||
                (Boolean(e.archived_at) && e.status !== 'active')
            );

            if (isTerminated) {
                pendingTermination++;
            } else if (isSusp) {
                suspended++;
            } else {
                active++;
            }

            const isFactory = (e.department || '').toLowerCase().includes('factory');
            if (isFactory) {
                pieceRate++;
            } else {
                salaried++;
            }
        }

        return { all, active, suspended, pendingTermination, salaried, pieceRate };
    }, [employees]);

    const isFiltered = Boolean(searchQuery.trim() || selectedDepartment !== 'All' || filterStatus !== 'Active');
    const totalItems = filteredEmployees.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedEmployees = filteredEmployees.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const handleClearFilters = useCallback(() => {
        setSearchQuery('');
        setSelectedDepartment('All');
        setFilterStatus('Active');
        setCurrentPage(1);
    }, []);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3 font-sans">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-accent rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-wider uppercase text-xs">Loading Personnel Directory...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-28 lg:pb-8 px-3 sm:px-6 lg:px-8 font-sans">
            
            {/* Header */}
            <PageHeader
                breadcrumbs={['Admin', 'Employees', 'Directory']}
                actions={
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={handleArchiveAccessClick}
                            className="h-9 flex-1 sm:flex-initial px-3.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 hover:text-slate-900 rounded-md font-medium text-sm transition-colors duration-100 flex items-center justify-center gap-1.5 border border-slate-200 shadow-2xs cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950"
                        >
                            <i className="ti ti-folders text-slate-500 text-sm shrink-0" />
                            <span className="whitespace-nowrap">Archive</span>
                        </button>

                        <Link
                            to="/admin/employees/create"
                            className="h-9 flex-1 sm:flex-initial px-4 bg-accent hover:bg-accent-hover active:bg-accent-hover text-white rounded-md font-medium text-sm transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        >
                            <i className="ti ti-user-plus text-sm shrink-0" />
                            <span className="whitespace-nowrap">Add Employee</span>
                        </Link>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-5">

                {/* Filter and search toolbar */}
                <div className="bg-white p-3 rounded-lg shadow-2xs border border-slate-200 space-y-2.5">
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5">
                        
                        {/* Search input: rigid h-9 (36px) */}
                        <div className="relative flex-1 min-w-0">
                            <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search by name, company ID, email, role, or craft..."
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="h-9 w-full pl-9 pr-8 bg-slate-50 border border-slate-200 rounded-md text-sm font-medium text-slate-900 placeholder-slate-400 outline-none hover:border-slate-300 focus:bg-white focus:border-slate-950 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 transition-colors duration-100"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950"
                                    title="Clear search"
                                >
                                    <i className="ti ti-x text-xs" />
                                </button>
                            )}
                        </div>

                        {/* Status filter tabs & View switcher: rigid h-9 */}
                        <div className="flex items-center gap-2 justify-between lg:justify-end overflow-x-auto">
                            <div className="h-9 flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200/60 shrink-0">
                                {[
                                    { id: 'Active', label: 'Active', count: counts.active },
                                    { id: 'All', label: 'All', count: counts.all },
                                    { id: 'Suspended', label: 'Suspended', count: counts.suspended, alert: counts.suspended > 0 },
                                    ...(counts.pendingTermination > 0 ? [
                                        { id: 'Pending Termination', label: 'Separated', count: counts.pendingTermination, alert: true }
                                    ] : []),
                                    { id: 'Salaried', label: 'Salaried', count: counts.salaried },
                                    { id: 'Piece-Rate', label: 'Piece-Rate', count: counts.pieceRate }
                                ].map(tab => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => { setFilterStatus(tab.id); setCurrentPage(1); }}
                                        className={`h-7 px-2.5 rounded text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 ${
                                            filterStatus === tab.id
                                                ? 'bg-white text-slate-950 shadow-2xs font-semibold'
                                                : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/60'
                                        }`}
                                    >
                                        <span>{tab.label}</span>
                                        <span className={`text-[10px] font-mono px-1 py-0.2 rounded-xs border ${
                                            filterStatus === tab.id 
                                                ? 'bg-slate-100 text-slate-900 border-slate-200' 
                                                : tab.alert 
                                                    ? 'bg-warning-subtle text-warning-ink border-warning/20 font-semibold'
                                                    : 'bg-slate-200/60 text-slate-500 border-transparent'
                                        }`}>
                                            {tab.count}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* View Switcher: Icon-only h-9 w-9 square pair */}
                            <div className="h-9 flex items-center gap-0.5 bg-slate-100 p-1 rounded-md border border-slate-200/60 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('grid')}
                                    className={`h-7 w-7 p-0 flex items-center justify-center rounded transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 ${
                                        viewMode === 'grid' ? 'bg-white text-slate-950 shadow-2xs' : 'text-slate-500 hover:text-slate-950'
                                    }`}
                                    title="Card Grid View"
                                >
                                    <i className="ti ti-layout-grid text-sm" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('table')}
                                    className={`h-7 w-7 p-0 flex items-center justify-center rounded transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 ${
                                        viewMode === 'table' ? 'bg-white text-slate-950 shadow-2xs' : 'text-slate-500 hover:text-slate-950'
                                    }`}
                                    title="Stacked List View"
                                >
                                    <i className="ti ti-list text-sm" />
                                </button>
                            </div>
                        </div>

                    </div>

                    {/* Department dropdown and results count */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <label htmlFor="dept-filter" className="text-[11px] font-medium text-slate-500 shrink-0">Department:</label>
                            <div className="relative">
                                <select
                                    id="dept-filter"
                                    value={selectedDepartment}
                                    onChange={(e) => { setSelectedDepartment(e.target.value); setCurrentPage(1); }}
                                    className="h-8 pl-2.5 pr-7 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-800 appearance-none outline-none hover:border-slate-300 focus:border-slate-950 focus-visible:ring-1 focus-visible:ring-slate-950 transition-colors duration-100 cursor-pointer"
                                >
                                    <option value="All">All Departments</option>
                                    {departments.filter(d => d !== 'All').map(d => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                                <i className="ti ti-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-xs" />
                            </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                            <span className="text-[11px] font-medium text-slate-500">
                                Showing <strong className="font-mono font-semibold text-slate-950">{totalItems}</strong> matching personnel
                            </span>

                            {isFiltered && (
                                <button
                                    type="button"
                                    onClick={handleClearFilters}
                                    className="h-7 px-2 bg-danger-subtle hover:bg-danger-subtle active:bg-danger-subtle text-danger-ink border border-danger/20 rounded-md text-[11px] font-medium transition-colors duration-100 flex items-center gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger"
                                    title="Reset all filters"
                                >
                                    <i className="ti ti-filter-off text-xs" /> Reset Filters
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Pending Archive Review Notice Banner */}
                {counts.pendingTermination > 0 && filterStatus !== 'Pending Termination' && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-2xs">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-md bg-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                                <i className="ti ti-archive text-base" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900 text-sm">
                                    {counts.pendingTermination} separated {counts.pendingTermination === 1 ? 'account is' : 'accounts are'} awaiting archive review
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setFilterStatus('Pending Termination'); setCurrentPage(1); }}
                            className="h-8 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium rounded-md transition-colors duration-100 flex items-center gap-1.5 shadow-2xs shrink-0 cursor-pointer touch-manipulation"
                        >
                            <span>Review Separated Staff</span>
                            <i className="ti ti-arrow-right text-xs" />
                        </button>
                    </div>
                )}

                {/* Directory Content */}
                {paginatedEmployees.length > 0 ? (
                    viewMode === 'grid' ? (
                        /* ── CARD GRID UI ── */
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-4.5 items-stretch">
                            {paginatedEmployees.map((employee) => {
                                const isFactory = (employee.department || '').toLowerCase().includes('factory');
                                const shoeRole = isFactory ? getShoeRoleDetails(employee.job_title) : null;
                                const prodGroupName = employee.production_groups?.name || parseProductionGroup(employee.shift) || 'Line A';
                                const daily = Number(employee.daily_rate ?? (employee.monthly_salary ? Number(employee.monthly_salary) / 26 : 0));
                                const hourly = Number(employee.hourly_rate ?? (daily ? daily / 8 : 0));
                                const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');
                                const isSuspended = Boolean(
                                    employee.operational_status === 'Suspended' || 
                                    employee.is_suspended ||
                                    employee.status === 'suspended'
                                );
                                const isTerminated = !isSuspended && Boolean(
                                    employee.operational_status === 'Terminated' || 
                                    employee.is_terminated ||
                                    employee.status === 'terminated' ||
                                    (Boolean(employee.archived_at) && employee.status !== 'active')
                                );
                                const isBiometricEnrolled = Boolean(employee.has_registered_biometrics || employee.biometric_baseline_path);

                                return (
                                    <div
                                        key={employee.id}
                                        className={`rounded-lg p-4 border shadow-2xs transition-colors duration-100 flex flex-col justify-between group ${
                                            isTerminated
                                                ? 'bg-slate-50/90 border-slate-300 opacity-75 hover:opacity-100 hover:border-slate-400'
                                                : isSuspended
                                                ? 'bg-warning-subtle/15 border-warning/20 hover:border-warning'
                                                : 'bg-white border-slate-200 hover:border-slate-300'
                                        }`}
                                    >
                                        <div className="space-y-3.5">
                                            
                                            {/* Top Row: Avatar & Identification */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="relative shrink-0">
                                                        <EmployeeAvatar employee={employee} size="h-12 w-12" />
                                                        {isTerminated ? (
                                                            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-danger ring-2 ring-white flex items-center justify-center text-[8px] text-white" title="DOLE Separated">
                                                                <i className="ti ti-x" />
                                                            </span>
                                                        ) : isSuspended ? (
                                                            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-warning ring-2 ring-white flex items-center justify-center text-[8px] text-white" title="Disciplinary Suspension">
                                                                <i className="ti ti-clock-pause" />
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className={`font-semibold text-sm sm:text-base leading-tight truncate transition-colors ${
                                                            isTerminated ? 'text-slate-600' : 'text-slate-900 group-hover:text-accent'
                                                        }`}>
                                                            {employee.first_name} {employee.last_name}
                                                        </h4>
                                                        <div className="flex items-center gap-1.5 mt-0.5 text-xs font-medium text-slate-500 truncate">
                                                            {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-ink-subtle shrink-0`} />}
                                                            <span className="truncate">{employee.job_title || 'General Staff'}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Status indicator badge */}
                                                <div className="shrink-0">
                                                    {isTerminated ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                                                            {getDaysUntilArchive(employee) !== null ? `Pending Archive (${getDaysUntilArchive(employee)}d)` : 'Separated'}
                                                        </span>
                                                    ) : isSuspended ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                                            Suspended
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-surface-muted text-ink border border-line">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Separation Notice */}
                                            {isTerminated && (
                                                <div className="p-2.5 bg-danger-subtle border border-danger/20 rounded-md text-danger-ink space-y-0.5">
                                                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-danger-ink">
                                                        <span className="flex items-center gap-1"><i className="ti ti-ban" /> DOLE Separated</span>
                                                        <span className="font-mono text-danger-ink">Access Revoked</span>
                                                    </div>
                                                    <p className="text-xs text-danger-ink font-medium line-clamp-1">
                                                        {employee.termination_record?.reason || employee.separation_reason || 'Contract Concluded / Terminated'}
                                                    </p>
                                                </div>
                                            )}

                                            {isSuspended && (
                                                <div className="p-2.5 bg-warning-subtle border border-warning/20 rounded-md text-warning-ink space-y-0.5">
                                                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-warning-ink">
                                                        <span className="flex items-center gap-1"><i className="ti ti-clock-pause" /> Disciplinary Hold</span>
                                                        <span className="font-mono text-warning-ink">QR Suspended</span>
                                                    </div>
                                                    <p className="text-xs text-warning-ink font-medium line-clamp-1">
                                                        {employee.active_suspension?.reason || employee.suspension_reason || 'Serving operational suspension'}
                                                    </p>
                                                </div>
                                            )}

                                            {/* Employee Details Summary */}
                                            <div className={`rounded-md p-3 border space-y-2.5 ${
                                                isTerminated
                                                    ? 'bg-slate-100/70 border-slate-200/80 text-slate-500'
                                                    : 'bg-slate-50 border-slate-100'
                                            }`}>
                                                
                                                {/* Line 1: ID & Department Tag */}
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">ID:</span>
                                                        <span className="font-mono text-xs font-semibold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200/80">
                                                            {companyId}
                                                        </span>
                                                    </div>

                                                    <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-md border flex items-center gap-1 shrink-0 ${
                                                        isTerminated
                                                            ? 'bg-slate-200 text-slate-700 border-slate-300'
                                                            : isFactory
                                                            ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                                            : 'bg-accent-subtle text-accent-strong border-accent/20'
                                                    }`}>
                                                        {isFactory ? <i className="ti ti-building-factory text-xs" /> : <i className="ti ti-briefcase text-xs" />}
                                                        {isFactory ? `${prodGroupName} · Factory` : (employee.department || 'Retail')}
                                                    </span>
                                                </div>

                                                {/* Line 2: Compensation & Schedule */}
                                                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2">
                                                    <div>
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                                                            {isFactory ? 'Wage Structure' : 'Daily / Hourly Rate'}
                                                        </span>
                                                        {isFactory ? (
                                                            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1 mt-0.5">
                                                                <i className="ti ti-box-multiple text-slate-500 text-xs" /> Group Piece-Rate
                                                            </span>
                                                        ) : (
                                                            <span className="font-mono text-xs sm:text-sm font-semibold text-slate-700 block mt-0.5">
                                                                ₱{daily.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/day <span className="text-[10px] font-medium text-slate-400">· ₱{hourly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr</span>
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="text-right">
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                                                            Standard Schedule
                                                        </span>
                                                        <span className="text-[11px] font-medium text-slate-600 block mt-0.5">
                                                            {isFactory ? '08:00 AM - 05:00 PM' : '08:00 AM - 08:00 PM'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Line 3: Email & Biometrics */}
                                                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between gap-2 text-xs">
                                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                        <i className="ti ti-mail text-slate-400 text-xs shrink-0" />
                                                        <span className="text-slate-600 font-medium truncate" title={employee.email}>
                                                            {employee.email || 'N/A'}
                                                        </span>
                                                    </div>

                                                    <div className="shrink-0">
                                                        {isBiometricEnrolled ? (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-200/70 px-2 py-0.5 rounded border border-slate-300">
                                                                <i className="ti ti-face-id text-xs text-slate-500" /> Biometrics
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning-ink bg-warning-subtle px-2 py-0.5 rounded border border-warning/20">
                                                                <i className="ti ti-alert-circle text-xs text-warning-ink" /> Pending Face
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                            </div>

                                        </div>

                                        {/* Card Actions */}
                                        <div className="pt-3.5 mt-3 border-t border-slate-200/80 flex items-center justify-between gap-2">
                                            <Link
                                                to={`/admin/employees/${employee.id}`}
                                                className={`flex-1 h-8 px-3 font-medium text-xs rounded-md transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer ${
                                                    isTerminated
                                                        ? 'bg-slate-700 hover:bg-slate-800 text-white'
                                                        : 'bg-slate-900 hover:bg-accent text-white'
                                                }`}
                                            >
                                                <span>{isTerminated ? 'Review Record' : 'View Profile'}</span>
                                                <i className="ti ti-arrow-right text-xs shrink-0" />
                                            </Link>

                                            <ActionMenu
                                                align="right"
                                                title={`Actions for ${employee.first_name}`}
                                                items={[
                                                    {
                                                        label: 'Documents',
                                                        icon: 'ti-folders',
                                                        to: `/admin/documents?employee_id=${employee.id}`,
                                                    },
                                                    ...(!isTerminated ? [
                                                        {
                                                            label: 'Edit Employee',
                                                            icon: 'ti-pencil',
                                                            to: `/admin/employees/${employee.id}/edit`,
                                                        },
                                                        {
                                                            label: 'Print Badge',
                                                            icon: 'ti-qrcode',
                                                            to: `/admin/employees/${employee.id}`,
                                                        }
                                                    ] : []),
                                                    { divider: true },
                                                    {
                                                        label: 'Copy Company ID',
                                                        icon: 'ti-copy',
                                                        onClick: () => copyToClipboard(companyId, 'Company ID'),
                                                    }
                                                ]}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        /* ── STACKED LIST / TABLE UI ── */
                        <div className="bg-white rounded-lg shadow-2xs border border-slate-200 overflow-hidden">
                            
                            {/* Mobile Stacked List (Phones) */}
                            <div className="block md:hidden divide-y divide-slate-100">
                                {paginatedEmployees.map((employee) => {
                                    const isFactory = (employee.department || '').toLowerCase().includes('factory');
                                    const shoeRole = isFactory ? getShoeRoleDetails(employee.job_title) : null;
                                    const prodGroupName = employee.production_groups?.name || parseProductionGroup(employee.shift) || 'Line A';
                                    const daily = Number(employee.daily_rate ?? (employee.monthly_salary ? Number(employee.monthly_salary) / 26 : 0));
                                    const hourly = Number(employee.hourly_rate ?? (daily ? daily / 8 : 0));
                                    const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');
                                    const isSuspended = Boolean(
                                        employee.operational_status === 'Suspended' || 
                                        employee.is_suspended ||
                                        employee.status === 'suspended'
                                    );
                                    const isTerminated = !isSuspended && Boolean(
                                        employee.operational_status === 'Terminated' || 
                                        employee.is_terminated ||
                                        employee.status === 'terminated' ||
                                        (Boolean(employee.archived_at) && employee.status !== 'active')
                                    );
                                    const isBiometricEnrolled = Boolean(employee.has_registered_biometrics || employee.biometric_baseline_path);

                                    return (
                                        <div key={`mobile-stack-${employee.id}`} className={`p-4 space-y-3 transition-colors ${
                                            isTerminated ? 'bg-slate-50/90 border-b border-slate-200 opacity-80' : 'hover:bg-slate-50/60'
                                        }`}>
                                            {/* Header */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <EmployeeAvatar employee={employee} size="h-10 w-10" />
                                                    <div className="min-w-0">
                                                        <p className={`font-semibold text-sm truncate ${isTerminated ? 'text-slate-600' : 'text-slate-900'}`}>
                                                            {employee.first_name} {employee.last_name}
                                                        </p>
                                                        <p className="text-xs font-medium text-slate-500 truncate flex items-center gap-1 mt-0.5">
                                                            {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-ink-subtle`} />}
                                                            {employee.job_title || 'Staff'}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="shrink-0">
                                                    {isTerminated ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-danger-subtle text-danger-ink border border-danger/20">
                                                            {getDaysUntilArchive(employee) !== null ? `Pending Archive (${getDaysUntilArchive(employee)}d)` : 'Separated'}
                                                        </span>
                                                    ) : isSuspended ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-warning-subtle text-warning-ink border border-warning/20">
                                                            Suspended
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-surface-muted text-ink border border-line">
                                                            Active
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Stack Details Box */}
                                            <div className="bg-slate-50 rounded-md p-3 border border-slate-100 grid grid-cols-2 gap-2 text-xs">
                                                <div>
                                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">ID & Dept</span>
                                                    <span className="font-mono font-semibold text-slate-700 block">{companyId}</span>
                                                    <span className="text-[11px] font-medium text-slate-600 block truncate">
                                                        {isFactory ? `${prodGroupName} · Factory` : (employee.department || 'Retail')}
                                                    </span>
                                                </div>

                                                <div className="text-right">
                                                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Wage Basis</span>
                                                    {isFactory ? (
                                                        <span className="text-xs font-semibold text-warning-ink block">Group Piece-Rate</span>
                                                    ) : (
                                                        <span className="font-mono font-semibold text-ink block">
                                                            ₱{daily.toFixed(2)}/day <span className="text-[10px] font-medium text-slate-400">· ₱{hourly.toFixed(2)}/hr</span>
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] font-semibold text-slate-400 block">
                                                        {isBiometricEnrolled ? 'Biometrics Registered' : 'Face Pending'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Action links */}
                                            <div className="flex items-center gap-2 pt-1">
                                                <Link
                                                    to={`/admin/employees/${employee.id}`}
                                                    className={`flex-1 h-8 text-center font-medium text-xs rounded-md transition-colors duration-100 shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer ${
                                                        isTerminated
                                                            ? 'bg-slate-700 hover:bg-slate-800 text-white'
                                                            : 'bg-slate-900 hover:bg-accent text-white'
                                                    }`}
                                                >
                                                    <span>{isTerminated ? 'Review Record' : 'View Profile'}</span>
                                                    <i className="ti ti-arrow-right text-xs" />
                                                </Link>

                                                <ActionMenu
                                                    align="right"
                                                    title={`Actions for ${employee.first_name}`}
                                                    items={[
                                                        {
                                                            label: 'Documents',
                                                            icon: 'ti-folders',
                                                            to: `/admin/documents?employee_id=${employee.id}`,
                                                        },
                                                        ...(!isTerminated ? [
                                                            {
                                                                label: 'Edit Employee',
                                                                icon: 'ti-pencil',
                                                                to: `/admin/employees/${employee.id}/edit`,
                                                            },
                                                            {
                                                                label: 'Print Badge',
                                                                icon: 'ti-qrcode',
                                                                to: `/admin/employees/${employee.id}`,
                                                            }
                                                        ] : []),
                                                        { divider: true },
                                                        {
                                                            label: 'Copy Company ID',
                                                            icon: 'ti-copy',
                                                            onClick: () => copyToClipboard(companyId, 'Company ID'),
                                                        }
                                                    ]}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Desktop Stacked Table View (Tablet & Desktop) */}
                            <div className="hidden md:block overflow-x-auto no-scrollbar touch-pan-x">
                                <table className="w-full text-left border-collapse min-w-[800px]">
                                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                                        <tr>
                                            <th className="px-5 py-3">Employee</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3">Department & Role</th>
                                            <th className="px-4 py-3">Pay Rate</th>
                                            <th className="px-4 py-3">Face Scan</th>
                                            <th className="px-4 py-3">Joined</th>
                                            <th className="px-5 py-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-xs">
                                        {paginatedEmployees.map((employee) => {
                                            const isFactory = (employee.department || '').toLowerCase().includes('factory');
                                            const shoeRole = getShoeRoleDetails(employee.job_title);
                                            const prodGroupName = employee.production_groups?.name || parseProductionGroup(employee.shift) || 'Line A';
                                            const daily = Number(employee.daily_rate ?? (employee.monthly_salary ? Number(employee.monthly_salary) / 26 : 0));
                                            const hourly = Number(employee.hourly_rate ?? (daily ? daily / 8 : 0));
                                            const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');
                                            const isSuspended = Boolean(
                                                employee.operational_status === 'Suspended' || 
                                                employee.is_suspended ||
                                                employee.status === 'suspended'
                                            );
                                            const isTerminated = !isSuspended && Boolean(
                                                employee.operational_status === 'Terminated' || 
                                                employee.is_terminated ||
                                                employee.status === 'terminated' ||
                                                (Boolean(employee.archived_at) && employee.status !== 'active')
                                            );
                                            const isBiometricEnrolled = Boolean(employee.has_registered_biometrics || employee.biometric_baseline_path);

                                            return (
                                                <tr 
                                                    key={employee.id} 
                                                    className={`transition-colors duration-100 ${
                                                        isTerminated
                                                            ? 'bg-slate-100/50 hover:bg-slate-100/80 text-slate-500 opacity-80 hover:opacity-100'
                                                            : isSuspended
                                                            ? 'bg-warning-subtle/20 hover:bg-warning-subtle/50'
                                                            : 'hover:bg-slate-50/80'
                                                    }`}
                                                >
                                                    {/* Personnel */}
                                                    <td className="px-5 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="relative shrink-0">
                                                                <EmployeeAvatar employee={employee} size="h-9 w-9" />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className={`font-semibold text-sm truncate ${isTerminated ? 'text-slate-600' : 'text-slate-900'}`}>
                                                                    {employee.first_name} {employee.last_name}
                                                                </p>
                                                                <p className="text-slate-400 font-mono text-[11px] truncate">
                                                                    {companyId} &bull; {employee.email}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* Standing */}
                                                    <td className="px-4 py-3">
                                                        {isTerminated ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-danger-subtle text-danger-ink text-[11px] font-semibold rounded-md border border-danger/20">
                                                                <i className="ti ti-circle-x text-xs text-danger-ink" /> {getDaysUntilArchive(employee) !== null ? `Pending Archive (${getDaysUntilArchive(employee)}d)` : 'Terminated'}
                                                            </span>
                                                        ) : isSuspended ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-warning-subtle text-warning-ink text-[11px] font-semibold rounded-md border border-warning/20">
                                                                <i className="ti ti-clock-pause text-xs text-warning-ink" /> Suspended
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-muted text-ink text-[11px] font-semibold rounded-md border border-line">
                                                                Active
                                                            </span>
                                                        )}
                                                    </td>

                                                    {/* Department & Craft */}
                                                    <td className="px-4 py-3">
                                                        <div>
                                                            <p className={`font-semibold flex items-center gap-1.5 ${isTerminated ? 'text-slate-600' : 'text-slate-800'}`}>
                                                                {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-ink-subtle`} />}
                                                                {employee.job_title || 'Staff'}
                                                            </p>
                                                            <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                                                                isTerminated
                                                                    ? 'bg-slate-200 text-slate-700 border-slate-300'
                                                                    : isFactory
                                                                    ? 'bg-warning-subtle text-warning-ink border-warning/20'
                                                                    : 'bg-accent-subtle text-accent-strong border-accent/20'
                                                            }`}>
                                                                {isFactory ? `${prodGroupName} · Factory` : (employee.department || 'Operations')}
                                                            </span>
                                                        </div>
                                                    </td>

                                                    {/* Wage Structure */}
                                                    <td className="px-4 py-3">
                                                        {isFactory ? (
                                                            <div>
                                                                <p className="font-mono font-semibold text-xs text-slate-700 flex items-center gap-1">
                                                                    <i className="ti ti-box-multiple text-slate-500" /> Batch Pool
                                                                </p>
                                                                <p className="text-slate-400 text-[10px] uppercase font-semibold">
                                                                    Group Piece-Rate
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <div>
                                                                <p className="font-mono font-semibold text-sm text-slate-700">
                                                                    ₱{daily.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-[10px] text-slate-400">/day</span>
                                                                </p>
                                                                <p className="text-slate-500 text-[10px] font-medium">
                                                                    ₱{hourly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr
                                                                </p>
                                                            </div>
                                                        )}
                                                    </td>

                                                    {/* Biometrics */}
                                                    <td className="px-4 py-3">
                                                        {isBiometricEnrolled ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-200/70 text-slate-700 rounded text-[11px] font-semibold border border-slate-300">
                                                                <i className="ti ti-face-id text-slate-500" /> Registered
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-warning-subtle text-warning-ink rounded text-[11px] font-semibold border border-warning/20">
                                                                <i className="ti ti-alert-circle text-warning-ink" /> Pending
                                                            </span>
                                                        )}
                                                    </td>

                                                    {/* Joined */}
                                                    <td className="px-4 py-3 font-medium text-slate-600 tabular-nums">
                                                        {formatDate(employee.created_at)}
                                                    </td>

                                                    {/* Actions */}
                                                    <td className="px-5 py-3 text-right whitespace-nowrap">
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <Link
                                                                to={`/admin/employees/${employee.id}`}
                                                                className={`h-8 px-3 font-medium text-xs rounded-md transition-colors duration-100 flex items-center gap-1 cursor-pointer ${
                                                                    isTerminated
                                                                        ? 'bg-slate-700 hover:bg-slate-800 text-white'
                                                                        : 'bg-slate-900 hover:bg-accent text-white'
                                                                }`}
                                                            >
                                                                <span>{isTerminated ? 'Review' : 'Profile'}</span>
                                                                <i className="ti ti-arrow-right text-xs shrink-0" />
                                                            </Link>

                                                            <ActionMenu
                                                                align="right"
                                                                title={`Actions for ${employee.first_name}`}
                                                                items={[
                                                                    {
                                                                        label: 'Documents',
                                                                        icon: 'ti-folders',
                                                                        to: `/admin/documents?employee_id=${employee.id}`,
                                                                    },
                                                                    ...(!isTerminated ? [
                                                                        {
                                                                            label: 'Edit Employee',
                                                                            icon: 'ti-pencil',
                                                                            to: `/admin/employees/${employee.id}/edit`,
                                                                        },
                                                                        {
                                                                            label: 'Print Badge',
                                                                            icon: 'ti-qrcode',
                                                                            to: `/admin/employees/${employee.id}`,
                                                                        }
                                                                    ] : []),
                                                                    { divider: true },
                                                                    {
                                                                        label: 'Copy Company ID',
                                                                        icon: 'ti-copy',
                                                                        onClick: () => copyToClipboard(companyId, 'Company ID'),
                                                                    }
                                                                ]}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                ) : (
                    /* Empty state */
                    <div className="bg-white rounded-lg p-8 sm:p-12 text-center border border-slate-200 shadow-2xs space-y-3">
                        {filterStatus === 'Pending Termination' && !searchQuery.trim() && selectedDepartment === 'All' ? (
                            <>
                                <div className="w-10 h-10 bg-surface-muted text-ink rounded-md flex items-center justify-center mx-auto border border-line">
                                    <i className="ti ti-circle-check text-2xl" />
                                </div>
                                <h3 className="text-base font-semibold text-slate-900">No records pending archive review</h3>
                                <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                                    All separated accounts have been processed or moved to the permanent archive.
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="w-10 h-10 bg-slate-50 text-slate-400 rounded-md flex items-center justify-center mx-auto border border-slate-200">
                                    <i className="ti ti-users text-2xl" />
                                </div>
                                <h3 className="text-base font-semibold text-slate-900">No personnel records match your search</h3>
                                <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                                    Try adjusting your search keywords, clear active status filters, or pick another department.
                                </p>
                                {isFiltered && (
                                    <button
                                        onClick={handleClearFilters}
                                        className="mt-2 h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-md text-xs transition-colors duration-100 cursor-pointer touch-manipulation"
                                    >
                                        Reset All Filters
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Pagination */}
                <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-medium">
                    <div className="text-center sm:text-left text-[11px] sm:text-xs">
                        {totalItems > 0 ? (
                            <span>Showing <span className="text-slate-900 font-semibold">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-900 font-semibold">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-900 font-semibold">{totalItems}</span> personnel</span>
                        ) : (
                            <span>Showing <span className="text-slate-900 font-semibold">0</span> of <span className="text-slate-900 font-semibold">0</span></span>
                        )}
                    </div>

                    <div className="flex items-center justify-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="flex-1 sm:flex-initial justify-center h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors duration-100 flex items-center gap-1.5 cursor-pointer touch-manipulation"
                        >
                            <i className="ti ti-chevron-left text-sm" /> Prev
                        </button>

                        <span className="h-8 px-3 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium text-xs shrink-0 font-mono flex items-center justify-center">
                            {currentPage} / {totalPages}
                        </span>

                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage >= totalPages}
                            className="flex-1 sm:flex-initial justify-center h-8 px-3 rounded-md bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none transition-colors duration-100 flex items-center gap-1.5 cursor-pointer touch-manipulation"
                        >
                            Next <i className="ti ti-chevron-right text-sm" />
                        </button>
                    </div>
                </div>

            </div>

            {/* Temporary password credentials modal */}
            {tempCreds && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-3.5 sm:p-6 bg-slate-950/70 overflow-y-auto">
                    <div className="bg-white rounded-lg p-5 max-w-md w-full my-auto shadow-xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
                        
                        <div className="text-center space-y-1.5">
                            <div className="h-10 w-10 bg-surface-muted text-ink rounded-md mx-auto flex items-center justify-center border border-line shadow-2xs">
                                <i className="ti ti-check text-xl font-bold" />
                            </div>
                            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
                                Account Created Successfully
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">
                                Provide these temporary login credentials to the employee.
                            </p>
                        </div>

                        {/* Credentials */}
                        <div className="bg-slate-50 rounded-md p-3 border border-slate-200 space-y-2.5">
                            {tempCreds.name && (
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Employee</span>
                                    <span className="text-xs font-semibold text-slate-800 truncate text-right">{tempCreds.name}</span>
                                </div>
                            )}

                            {tempCreds.company_id && (
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Company ID</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(tempCreds.company_id, 'Company ID')}
                                        className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700 hover:text-accent cursor-pointer touch-manipulation"
                                    >
                                        <span>{tempCreds.company_id}</span>
                                        <i className={`ti ${copiedField === 'Company ID' ? 'ti-check text-ink' : 'ti-copy text-slate-400'} text-xs`} />
                                    </button>
                                </div>
                            )}

                            {tempCreds.email && (
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Login Email</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(tempCreds.email, 'Email')}
                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-accent cursor-pointer min-w-0 max-w-[200px] truncate touch-manipulation"
                                    >
                                        <span className="truncate">{tempCreds.email}</span>
                                        <i className={`ti ${copiedField === 'Email' ? 'ti-check text-ink' : 'ti-copy text-slate-400'} text-xs shrink-0`} />
                                    </button>
                                </div>
                            )}

                            {/* Temporary password */}
                            <div className="p-3 bg-slate-900 rounded-md text-white space-y-1.5 border border-slate-800">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-warning flex items-center gap-1">
                                        <i className="ti ti-key text-xs" /> Temporary Password
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="text-slate-400 hover:text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                                    >
                                        <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-xs`} />
                                        {showPassword ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-base font-semibold tracking-wider text-white select-all">
                                        {showPassword ? (tempCreds.temp_password || 'Emp-1234') : '••••••••'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(tempCreds.temp_password, 'Password')}
                                        className="h-7 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded font-medium text-xs flex items-center gap-1 transition-colors duration-100 cursor-pointer touch-manipulation"
                                    >
                                        <i className={`ti ${copiedField === 'Password' ? 'ti-check text-ink' : 'ti-copy text-slate-300'} text-xs`} />
                                        {copiedField === 'Password' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Copy all button */}
                        <button
                            type="button"
                            onClick={copyAllCredentials}
                            className="h-9 w-full px-3 bg-accent-subtle hover:bg-accent-subtle text-accent rounded-md font-medium text-xs flex items-center justify-center gap-1.5 transition-colors duration-100 border border-accent/20 cursor-pointer touch-manipulation"
                        >
                            <i className={`ti ${copiedAll ? 'ti-check text-ink' : 'ti-clipboard-check'} text-sm`} />
                            {copiedAll ? 'Copied to Clipboard' : 'Copy All Login Credentials'}
                        </button>

                        <p className="text-[11px] text-slate-400 text-center font-medium leading-relaxed">
                            <i className="ti ti-info-circle mr-1" />
                            The employee will be required to change this password upon their first sign-in.
                        </p>

                        {/* Dismiss */}
                        <div className="pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setTempCreds(null)}
                                className="h-9 w-full px-3 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-md transition-colors duration-100 cursor-pointer"
                            >
                                Dismiss & View Directory
                            </button>
                        </div>
                    </div>
                </div>
            )}



            {/* Security Modal Component */}
            <OtpVerificationModal
                isOpen={isSecurityModalOpen}
                onClose={() => setIsSecurityModalOpen(false)}
                onSuccess={() => {
                    setIsSecurityModalOpen(false);
                    const unlockKey = `cpoint_employee_module_unlocked_${currentUser?.id || currentUser?.email || 'admin'}`;
                    try {
                        sessionStorage.setItem(unlockKey, 'true');
                    } catch {}
                    navigate('/admin/archive');
                }}
                email={currentUser?.email}
                title="Archive Access Verification"
                subtitle="Confirm your identity to access archived employee records."
                description="Select a verification method to authenticate access to employee records."
            />
        </div>
    );
}