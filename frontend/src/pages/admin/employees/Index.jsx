import React, { useState, useMemo, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';
import { getShoeRoleDetails, parseProductionGroup } from '../../../utils/factoryRoles';

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function EmployeesIndex() {
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = viewMode === 'grid' ? 9 : 10;

    // Temporary password modal state
    const [tempCreds, setTempCreds] = useState(null);
    const [copiedField, setCopiedField] = useState(null);
    const [copiedAll, setCopiedAll] = useState(false);
    const [showPassword, setShowPassword] = useState(true);

    useEffect(() => {
        if (location.state?.temp_password) {
            setTempCreds({
                company_id: location.state.company_id,
                temp_password: location.state.temp_password,
                email: location.state.email,
                name: location.state.name
            });
            // Clear location state after reading
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location.state, location.pathname, navigate]);

    const copyToClipboard = (text, fieldName) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedField(fieldName);
        toast.success(`${fieldName} copied!`);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const copyAllCredentials = () => {
        if (!tempCreds) return;
        const text = `C-POINT HRIS Account Credentials\nCompany ID: ${tempCreds.company_id || ''}\nEmail: ${tempCreds.email || ''}\nTemporary Password: ${tempCreds.temp_password || ''}\nLogin Portal: ${window.location.origin}/login`;
        navigator.clipboard.writeText(text);
        setCopiedAll(true);
        toast.success('All credentials copied to clipboard!');
        setTimeout(() => setCopiedAll(false), 2000);
    };

    const fetchEmployees = async () => {
        const res = await fetchWithAuth('/api/employees');
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch employee records');
        return Array.isArray(result) ? result : (result.data || []);
    };

    const { data: employees = [], isLoading } = useQuery({
        queryKey: ['adminEmployees'],
        queryFn: fetchEmployees,
        staleTime: 15_000,
        gcTime: 300_000,
    });

    // Subscribe to live employee and disciplinary changes
    useEffect(() => {
        const channel = supabase
            .channel('admin-live-employees-directory')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [queryClient]);

    // Extract unique departments
    const departments = useMemo(() => {
        const depts = new Set();
        employees.forEach(e => {
            if (e.department) depts.add(e.department);
        });
        return ['All', ...Array.from(depts)];
    }, [employees]);

    // Filter employees by status, department, and search query
    const filteredEmployees = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();

        return employees.filter(emp => {
            const roleStr = (emp.role || emp.job_title || '').toLowerCase();
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim().toLowerCase();
            const email = (emp.email || '').toLowerCase();

            // Hide system accounts
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
            const isTerminated = emp.operational_status === 'Terminated' || emp.is_terminated;
            const isSuspended = !isTerminated && (emp.operational_status === 'Suspended' || emp.is_suspended);
            const isActive = !isTerminated && !isSuspended;

            if (filterStatus === 'Active' && !isActive) return false;
            if (filterStatus === 'Suspended' && !isSuspended) return false;
            if (filterStatus === 'Terminated' && !isTerminated) return false;
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
        });
    }, [employees, filterStatus, selectedDepartment, searchQuery]);

    // Tab counts in single O(N) pass
    const counts = useMemo(() => {
        let all = 0;
        let active = 0;
        let suspended = 0;
        let terminated = 0;
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
            const isTerminated = e.operational_status === 'Terminated' || e.is_terminated;
            const isSusp = !isTerminated && (e.operational_status === 'Suspended' || e.is_suspended);

            if (isTerminated) {
                terminated++;
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

        return { all, active, suspended, terminated, salaried, pieceRate };
    }, [employees]);

    const isFiltered = Boolean(searchQuery.trim() || selectedDepartment !== 'All' || filterStatus !== 'All');

    const totalItems = filteredEmployees.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedEmployees = filteredEmployees.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const handleClearFilters = () => {
        setSearchQuery('');
        setSelectedDepartment('All');
        setFilterStatus('All');
        setCurrentPage(1);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3 font-sans">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">Loading Personnel Directory...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-32 sm:pb-24 lg:pb-8 px-3 sm:px-6 lg:px-8 font-sans">
            
            {/* Header */}
            <PageHeader
                breadcrumbs={['Admin', 'Workforce', 'Personnel Directory']}
                title="Personnel Directory"
                description="Active workforce registry, biometric identification baselines, and statutory salary configurations."
                actions={
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Link
                            to="/admin/documents"
                            className="flex-1 sm:flex-initial justify-center px-3.5 py-2.5 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 rounded-xl font-semibold text-xs sm:text-sm transition-all flex items-center gap-1.5 border border-slate-200 shadow-xs touch-manipulation"
                        >
                            <i className="ti ti-folders text-slate-500 text-base shrink-0" />
                            <span className="whitespace-nowrap">201 Docs</span>
                        </Link>

                        <Link
                            to="/admin/employees/create"
                            className="flex-1 sm:flex-initial justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl font-semibold text-xs sm:text-sm transition-all shadow-xs flex items-center gap-1.5 touch-manipulation"
                        >
                            <i className="ti ti-user-plus text-base shrink-0" />
                            <span className="whitespace-nowrap">Add Employee</span>
                        </Link>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">

            {/* Filters */}
            <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-xs border border-slate-200 space-y-3">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 sm:gap-3">
                    
                    {/* Search */}
                    <div className="relative flex-1 min-w-0">
                        <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search name, ID, email, title..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg active:bg-slate-200 cursor-pointer"
                                title="Clear search"
                            >
                                <i className="ti ti-x text-sm" />
                            </button>
                        )}
                    </div>

                    {/* Status tabs */}
                    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x -mx-1 px-1 pb-1 lg:pb-0">
                        <div className="flex bg-slate-100 p-1 rounded-xl shrink-0 gap-1">
                            {[
                                { id: 'All', label: 'All', count: counts.all, dot: null },
                                { id: 'Active', label: 'Active', count: counts.active, dot: 'bg-emerald-500' },
                                { id: 'Suspended', label: 'Suspended', count: counts.suspended, dot: 'bg-amber-500', alert: counts.suspended > 0 },
                                { id: 'Terminated', label: 'Terminated', count: counts.terminated, dot: 'bg-rose-500', alert: counts.terminated > 0 },
                                { id: 'Salaried', label: 'Salaried', count: counts.salaried, dot: null },
                                { id: 'Piece-Rate', label: 'Piece-Rate', count: counts.pieceRate, dot: null }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => { setFilterStatus(tab.id); setCurrentPage(1); }}
                                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer active:scale-95 touch-manipulation ${
                                        filterStatus === tab.id
                                            ? 'bg-white text-slate-900 shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    {tab.dot && (
                                        <span className={`w-2 h-2 rounded-full ${tab.dot} ${tab.id === 'Active' ? 'animate-pulse' : ''} shrink-0`} />
                                    )}
                                    <span>{tab.label}</span>
                                    <span className={`px-1.5 py-0.2 text-[10px] rounded-md font-mono ${
                                        filterStatus === tab.id 
                                            ? 'bg-slate-100 text-slate-700' 
                                            : tab.alert 
                                                ? (tab.id === 'Terminated' ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-amber-100 text-amber-700 font-bold')
                                                : 'bg-slate-200/80 text-slate-500'
                                    }`}>
                                        {tab.count}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* View switcher */}
                        <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl shrink-0">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-1.5 rounded-lg text-sm transition-all cursor-pointer ${
                                    viewMode === 'grid' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-700'
                                }`}
                                title="Grid View"
                            >
                                <i className="ti ti-layout-grid" />
                            </button>
                            <button
                                onClick={() => setViewMode('table')}
                                className={`p-1.5 rounded-lg text-sm transition-all cursor-pointer ${
                                    viewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-700'
                                }`}
                                title="Table View"
                            >
                                <i className="ti ti-list" />
                            </button>
                        </div>
                    </div>

                </div>

                {/* Department filter and count */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-slate-400 font-semibold uppercase text-[11px] shrink-0">Dept:</span>
                        <div className="relative flex-1 sm:w-48">
                            <select
                                value={selectedDepartment}
                                onChange={(e) => { setSelectedDepartment(e.target.value); setCurrentPage(1); }}
                                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg pl-3 pr-8 py-2 sm:py-1.5 text-xs font-semibold text-slate-700 outline-none cursor-pointer focus:bg-white focus:border-indigo-500 transition-colors"
                            >
                                <option value="All">All Departments</option>
                                {departments.filter(d => d !== 'All').map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                            <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                        <span className="text-slate-500 font-medium text-[11px] sm:text-xs">
                            Showing <strong className="text-slate-800">{totalItems}</strong> matching personnel
                        </span>

                        {isFiltered && (
                            <button
                                onClick={handleClearFilters}
                                className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 active:scale-95 text-red-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer touch-manipulation"
                                title="Reset all filters"
                            >
                                <i className="ti ti-filter-off text-xs" /> Clear Filters
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Employee list */}
            {paginatedEmployees.length > 0 ? (
                viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                        {paginatedEmployees.map((employee) => {
                            const isFactory = (employee.department || '').toLowerCase().includes('factory');
                            const shoeRole = isFactory ? getShoeRoleDetails(employee.job_title) : null;
                            const prodGroup = isFactory ? parseProductionGroup(employee.shift) : null;
                            const rate = isFactory
                                ? Number(employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? 0)
                                : Number(employee.monthly_salary ?? employee.salary ?? 0);
                            const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');
                            const isTerminated = employee.operational_status === 'Terminated' || employee.is_terminated;
                            const isSuspended = !isTerminated && (employee.operational_status === 'Suspended' || employee.is_suspended);

                            return (
                                <div
                                    key={employee.id}
                                    className={`rounded-2xl p-4 sm:p-5 border shadow-xs transition-all duration-150 flex flex-col justify-between space-y-3.5 sm:space-y-4 group ${
                                        isTerminated
                                            ? 'bg-rose-50/20 border-rose-200 hover:border-rose-400 hover:shadow-md'
                                            : isSuspended
                                            ? 'bg-amber-50/20 border-amber-200 hover:border-amber-400 hover:shadow-md'
                                            : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
                                    }`}
                                >
                                        <div className="space-y-3">
                                            
                                            {/* Avatar and name */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="relative shrink-0">
                                                        <EmployeeAvatar employee={employee} size="h-11 w-11 sm:h-12 sm:w-12" />
                                                        {isTerminated ? (
                                                            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[9px] ring-2 ring-white" title="Account Terminated">
                                                                <i className="ti ti-x font-bold" />
                                                            </span>
                                                        ) : isSuspended ? (
                                                            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] ring-2 ring-white" title="Account Suspended">
                                                                <i className="ti ti-clock-pause font-bold" />
                                                            </span>
                                                        ) : (
                                                            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white" title="Active Personnel" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h3 className="font-bold text-slate-900 text-base leading-snug truncate group-hover:text-indigo-600 transition-colors">
                                                            {employee.first_name} {employee.last_name}
                                                        </h3>
                                                        <p className={`text-xs font-semibold truncate flex items-center gap-1 ${isFactory ? 'text-amber-700 font-bold' : 'text-slate-500'}`}>
                                                            {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-amber-600`} />}
                                                            {employee.job_title || 'General Staff'}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Status badge */}
                                                <div className="shrink-0">
                                                    {isTerminated ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs">
                                                            <i className="ti ti-circle-x text-xs text-rose-600" /> Terminated
                                                        </span>
                                                    ) : isSuspended ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs">
                                                            <i className="ti ti-clock-pause text-xs text-amber-600" /> Suspended
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Separation / suspension notice */}
                                            {isTerminated && (
                                                <div className="p-2.5 sm:p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 space-y-1">
                                                    <div className="flex items-center justify-between text-[11px] font-bold">
                                                        <span className="flex items-center gap-1 text-rose-700 uppercase tracking-wide text-[10px]">
                                                            <i className="ti ti-ban text-xs" /> DOLE Separated
                                                        </span>
                                                        <span className="text-[10px] text-rose-600 font-mono">Uploads Locked</span>
                                                    </div>
                                                    <p className="text-xs text-rose-800 line-clamp-1 font-medium">
                                                        {employee.termination_record?.reason || 'Contract Terminated / Inactive'}
                                                    </p>
                                                </div>
                                            )}

                                            {isSuspended && (
                                                <div className="p-2.5 sm:p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-1">
                                                    <div className="flex items-center justify-between text-[11px] font-bold">
                                                        <span className="flex items-center gap-1 text-amber-800 uppercase tracking-wide text-[10px]">
                                                            <i className="ti ti-clock-pause text-xs" /> Operational Hold
                                                        </span>
                                                        <span className="text-[10px] text-amber-700 font-mono">QR Suspended</span>
                                                    </div>
                                                    <p className="text-xs text-amber-800 line-clamp-1 font-medium">
                                                        {employee.active_suspension?.reason || 'Serving disciplinary suspension'}
                                                    </p>
                                                </div>
                                            )}

                                            {!isTerminated && !isSuspended && employee.past_suspensions_count > 0 && (
                                                <div className="flex items-center justify-between px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 font-medium">
                                                    <span className="flex items-center gap-1 text-slate-500">
                                                        <i className="ti ti-history text-xs" /> Disciplinary:
                                                    </span>
                                                    <span className="font-bold text-slate-700">
                                                        {employee.past_suspensions_count} past {employee.past_suspensions_count === 1 ? 'suspension' : 'suspensions'} (Resolved)
                                                    </span>
                                                </div>
                                            )}

                                            {/* Company ID and department */}
                                            <div className="flex items-center justify-between gap-2 pt-0.5">
                                                <span className="font-mono text-[11px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200">
                                                    {companyId}
                                                </span>

                                                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border flex items-center gap-1 shrink-0 ${
                                                    isFactory
                                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                                        : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                                }`}>
                                                    <i className={`ti ${isFactory ? 'ti-building-factory-2' : 'ti-building'} text-xs`} />
                                                    {isFactory ? prodGroup : (employee.department || 'Operations')}
                                                </span>
                                            </div>

                                            {/* Compensation */}
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                                                <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                                                    <span className="uppercase tracking-wide text-[10px]">Wage Structure</span>
                                                    <span className="font-semibold text-slate-700">
                                                        {isFactory ? 'Group Piece-Rate' : 'Fixed Monthly'}
                                                    </span>
                                                </div>
                                                {isFactory ? (
                                                    <div className="flex items-center justify-between pt-0.5">
                                                        <span className="text-sm font-black font-mono text-amber-700 flex items-center gap-1">
                                                            <i className="ti ti-box-multiple text-amber-600 text-sm" /> Batch Pool
                                                        </span>
                                                        <span className="text-[10px] font-bold text-slate-500">
                                                            Pakyawan Pool
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-baseline gap-1">
                                                        <span className="text-lg font-black font-mono tracking-tight text-emerald-700">
                                                            ₱{rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </span>
                                                        <span className="text-[11px] font-medium text-slate-400">
                                                            / month
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Details */}
                                            <div className="space-y-1.5 text-xs text-slate-600 pt-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-slate-400 font-medium shrink-0">Email:</span>
                                                    <span className="font-medium text-slate-700 truncate text-right flex-1 min-w-0" title={employee.email}>
                                                        {employee.email || 'N/A'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-slate-400 font-medium shrink-0">Joined:</span>
                                                    <span className="font-medium text-slate-700 shrink-0">
                                                        {formatDate(employee.created_at)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between gap-2 pt-0.5">
                                                    <span className="text-slate-400 font-medium shrink-0">System Role:</span>
                                                    <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-700 font-bold rounded uppercase text-[10px] shrink-0">
                                                        {employee.role || 'employee'}
                                                    </span>
                                                </div>
                                            </div>

                                        </div>

                                        {/* Actions */}
                                        <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                                            <Link
                                                to={`/admin/documents?employee_id=${employee.id}`}
                                                className="flex-1 justify-center py-2.5 px-3 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 hover:text-sky-900 font-bold text-xs rounded-xl border border-sky-200 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer group/docs touch-manipulation"
                                                title="Open 201 Document Vault"
                                            >
                                                <i className="ti ti-folders text-sky-600 text-sm group-hover/docs:scale-110 transition-transform shrink-0" />
                                                <span className="whitespace-nowrap">201 Docs</span>
                                                <i className="ti ti-arrow-up-right text-[10px] text-sky-500 opacity-60 group-hover/docs:opacity-100 group-hover/docs:translate-x-0.5 transition-all shrink-0" />
                                            </Link>

                                            <Link
                                                to={`/admin/employees/${employee.id}`}
                                                className="flex-1 justify-center py-2.5 px-3 bg-slate-900 hover:bg-indigo-600 active:scale-95 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer touch-manipulation"
                                            >
                                                <span className="whitespace-nowrap">View Profile</span>
                                                <i className="ti ti-arrow-right text-xs shrink-0" />
                                            </Link>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto no-scrollbar touch-pan-x">
                            <table className="w-full text-left border-collapse min-w-[760px]">
                                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 sm:px-6 py-3.5">Employee</th>
                                        <th className="px-3 sm:px-5 py-3.5">Status & Standing</th>
                                        <th className="px-4 sm:px-6 py-3.5">Department & Role</th>
                                        <th className="px-4 sm:px-6 py-3.5">Wage Structure</th>
                                        <th className="px-4 sm:px-6 py-3.5">Hire Date</th>
                                        <th className="px-4 sm:px-6 py-3.5 text-center">System Role</th>
                                        <th className="px-4 sm:px-6 py-3.5 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-xs">
                                    {paginatedEmployees.map((employee) => {
                                        const isFactory = (employee.department || '').toLowerCase().includes('factory');
                                        const shoeRole = isFactory ? getShoeRoleDetails(employee.job_title) : null;
                                        const prodGroup = isFactory ? parseProductionGroup(employee.shift) : null;
                                        const rate = isFactory
                                            ? Number(employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? 0)
                                            : Number(employee.monthly_salary ?? employee.salary ?? 0);
                                        const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');
                                        const isTerminated = employee.operational_status === 'Terminated' || employee.is_terminated;
                                        const isSuspended = !isTerminated && (employee.operational_status === 'Suspended' || employee.is_suspended);

                                        return (
                                            <tr 
                                                key={employee.id} 
                                                className={`transition-colors ${
                                                    isTerminated
                                                        ? 'bg-rose-50/30 hover:bg-rose-50/60'
                                                        : isSuspended
                                                        ? 'bg-amber-50/30 hover:bg-amber-50/60'
                                                        : 'hover:bg-slate-50/80'
                                                }`}
                                            >
                                                <td className="px-4 sm:px-6 py-3.5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="relative shrink-0">
                                                            <EmployeeAvatar employee={employee} size="h-9 w-9" />
                                                            {isTerminated ? (
                                                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-600 ring-1 ring-white" />
                                                            ) : isSuspended ? (
                                                                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-1 ring-white" />
                                                            ) : (
                                                                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-white" />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="font-bold text-slate-900 text-sm truncate">
                                                                {employee.first_name} {employee.last_name}
                                                            </p>
                                                            <p className="text-slate-400 font-mono text-[11px] truncate">
                                                                {companyId} &bull; {employee.email}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-3 sm:px-5 py-3.5">
                                                    {isTerminated ? (
                                                        <div className="space-y-0.5">
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-100 text-rose-800 text-[11px] font-bold rounded-md border border-rose-300 shadow-2xs">
                                                                <i className="ti ti-circle-x text-xs text-rose-600" /> Terminated
                                                            </span>
                                                            <p className="text-[10px] text-rose-700 font-semibold truncate max-w-[150px]" title={employee.termination_record?.reason}>
                                                                {employee.termination_record?.reason || 'Account Separated'}
                                                            </p>
                                                        </div>
                                                    ) : isSuspended ? (
                                                        <div className="space-y-0.5">
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-900 text-[11px] font-bold rounded-md border border-amber-300 shadow-2xs">
                                                                <i className="ti ti-clock-pause text-xs text-amber-600" /> Suspended
                                                            </span>
                                                            <p className="text-[10px] text-amber-800 font-semibold truncate max-w-[150px]" title={employee.active_suspension?.reason}>
                                                                {employee.active_suspension?.reason || 'Serving Suspension'}
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-0.5">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-bold rounded-md border border-emerald-200">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
                                                            </span>
                                                            {employee.past_suspensions_count > 0 && (
                                                                <p className="text-[10px] text-slate-400 font-medium">
                                                                    {employee.past_suspensions_count} past {employee.past_suspensions_count === 1 ? 'suspension' : 'suspensions'}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>

                                                <td className="px-4 sm:px-6 py-3.5">
                                                    <div>
                                                        <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                                                            {isFactory && <i className={`ti ${shoeRole?.icon || 'ti-shoe'} text-amber-600`} />}
                                                            {employee.job_title || 'Staff'}
                                                        </p>
                                                        <span className={`inline-block mt-0.5 px-2 py-0.2 rounded text-[10px] font-bold uppercase border ${
                                                            isFactory ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                                        }`}>
                                                            {isFactory ? prodGroup : (employee.department || 'General')}
                                                        </span>
                                                    </div>
                                                </td>

                                                <td className="px-4 sm:px-6 py-3.5">
                                                    {isFactory ? (
                                                        <div>
                                                            <p className="font-mono font-bold text-xs text-amber-800 flex items-center gap-1">
                                                                <i className="ti ti-box-multiple text-amber-600" /> Batch Pool
                                                            </p>
                                                            <p className="text-slate-400 text-[10px] uppercase font-semibold">
                                                                Group Piece-Rate
                                                            </p>
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <p className="font-mono font-bold text-sm text-emerald-700">
                                                                ₱{rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                            </p>
                                                            <p className="text-slate-400 text-[10px] uppercase font-semibold">
                                                                Fixed Monthly
                                                            </p>
                                                        </div>
                                                    )}
                                                </td>

                                                <td className="px-4 sm:px-6 py-3.5 font-medium text-slate-600">
                                                    {formatDate(employee.created_at)}
                                                </td>

                                                <td className="px-4 sm:px-6 py-3.5 text-center">
                                                    <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded font-bold uppercase text-[10px] border border-slate-200">
                                                        {employee.role || 'employee'}
                                                    </span>
                                                </td>

                                                <td className="px-4 sm:px-6 py-3.5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Link
                                                            to={`/admin/documents?employee_id=${employee.id}`}
                                                            className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 font-bold text-xs rounded-lg border border-sky-200 transition-all flex items-center gap-1 shadow-xs cursor-pointer touch-manipulation"
                                                            title="View 201 Documents"
                                                        >
                                                            <i className="ti ti-folders text-sky-600 text-sm shrink-0" />
                                                            <span>Docs</span>
                                                        </Link>
                                                        <Link
                                                            to={`/admin/employees/${employee.id}`}
                                                            className="px-3 py-1.5 bg-slate-900 hover:bg-indigo-600 active:scale-95 text-white font-bold rounded-lg transition-all flex items-center gap-1 shadow-xs cursor-pointer touch-manipulation"
                                                        >
                                                            <span>Profile</span>
                                                            <i className="ti ti-arrow-right text-xs shrink-0" />
                                                        </Link>
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
                <div className="bg-white rounded-2xl p-8 sm:p-12 text-center border border-slate-200 shadow-xs space-y-3">
                    <div className="w-14 h-14 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center mx-auto border border-slate-200">
                        <i className="ti ti-users text-3xl" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900">No personnel records match your search</h3>
                    <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                        Try adjusting your keywords or clearing the active department filter.
                    </p>
                    {isFiltered && (
                        <button
                            onClick={handleClearFilters}
                            className="mt-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer touch-manipulation"
                        >
                            Reset All Filters
                        </button>
                    )}
                </div>
            )}

            {/* Pagination */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-semibold">
                <div className="text-center sm:text-left text-[11px] sm:text-xs">
                    {totalItems > 0 ? (
                        <span>Showing <span className="text-slate-900 font-bold">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-900 font-bold">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-900 font-bold">{totalItems}</span> personnel</span>
                    ) : (
                        <span>Showing <span className="text-slate-900 font-bold">0</span> of <span className="text-slate-900 font-bold">0</span></span>
                    )}
                </div>

                <div className="flex items-center justify-center gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="flex-1 sm:flex-initial justify-center px-4 py-2.5 sm:py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 touch-manipulation"
                    >
                        <i className="ti ti-chevron-left text-sm" /> Prev
                    </button>

                    <span className="px-3.5 py-2.5 sm:py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-900 font-bold text-xs shrink-0 font-mono">
                        {currentPage} / {totalPages}
                    </span>

                    <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage >= totalPages}
                        className="flex-1 sm:flex-initial justify-center px-4 py-2.5 sm:py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 touch-manipulation"
                    >
                        Next <i className="ti ti-chevron-right text-sm" />
                    </button>
                </div>
            </div>
            </div>

            {/* Temporary password modal */}
            {tempCreds && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-3.5 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
                    <div className="bg-white rounded-2xl p-4 sm:p-7 max-w-md w-full my-auto shadow-2xl border border-slate-200 space-y-4 sm:space-y-5 max-h-[90vh] overflow-y-auto">
                        {/* Header */}
                        <div className="text-center space-y-2">
                            <div className="h-11 w-11 sm:h-12 sm:w-12 bg-emerald-100 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center border border-emerald-200 shadow-xs">
                                <i className="ti ti-check text-2xl font-bold" />
                            </div>
                            <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                                Account Created Successfully!
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">
                                Provide these temporary login credentials to the employee.
                            </p>
                        </div>

                        {/* Credentials */}
                        <div className="bg-slate-50 rounded-xl p-3.5 sm:p-4 border border-slate-200 space-y-3">
                            {tempCreds.name && (
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Employee</span>
                                    <span className="text-xs font-black text-slate-800 truncate text-right">{tempCreds.name}</span>
                                </div>
                            )}

                            {tempCreds.company_id && (
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Company ID</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(tempCreds.company_id, 'Company ID')}
                                        className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-slate-700 hover:text-blue-600 cursor-pointer active:scale-95 touch-manipulation"
                                    >
                                        <span>{tempCreds.company_id}</span>
                                        <i className={`ti ${copiedField === 'Company ID' ? 'ti-check text-emerald-500' : 'ti-copy text-slate-400'} text-xs`} />
                                    </button>
                                </div>
                            )}

                            {tempCreds.email && (
                                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">Login Email</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(tempCreds.email, 'Email')}
                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-blue-600 cursor-pointer min-w-0 max-w-[200px] truncate active:scale-95 touch-manipulation"
                                    >
                                        <span className="truncate">{tempCreds.email}</span>
                                        <i className={`ti ${copiedField === 'Email' ? 'ti-check text-emerald-500' : 'ti-copy text-slate-400'} text-xs shrink-0`} />
                                    </button>
                                </div>
                            )}

                            {/* Temporary password */}
                            <div className="p-3 bg-slate-900 rounded-lg text-white space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                                        <i className="ti ti-key text-xs" /> Temporary Password
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="text-slate-400 hover:text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                    >
                                        <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-xs`} />
                                        {showPassword ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-base sm:text-lg font-black tracking-wider text-white select-all">
                                        {showPassword ? (tempCreds.temp_password || 'Emp-1234') : '••••••••'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(tempCreds.temp_password, 'Password')}
                                        className="px-3 py-1.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-lg font-bold text-xs flex items-center gap-1 transition-all cursor-pointer touch-manipulation"
                                    >
                                        <i className={`ti ${copiedField === 'Password' ? 'ti-check text-emerald-400' : 'ti-copy'} text-xs`} />
                                        {copiedField === 'Password' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Copy all */}
                        <button
                            type="button"
                            onClick={copyAllCredentials}
                            className="w-full py-2.5 px-3 bg-blue-50 hover:bg-blue-100 active:scale-98 text-blue-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors border border-blue-200 cursor-pointer touch-manipulation"
                        >
                            <i className={`ti ${copiedAll ? 'ti-check text-emerald-600' : 'ti-clipboard-check'} text-sm`} />
                            {copiedAll ? 'Copied to Clipboard!' : 'Copy All Login Credentials'}
                        </button>

                        <p className="text-[11px] text-slate-400 text-center font-medium leading-relaxed">
                            <i className="ti ti-info-circle mr-1" />
                            The employee will be required to change this password upon their first sign-in.
                        </p>

                        {/* Dismiss button */}
                        <div className="pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setTempCreds(null)}
                                className="w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 active:scale-98 text-white rounded-xl font-bold text-xs transition-colors text-center cursor-pointer touch-manipulation"
                            >
                                Dismiss & View Directory
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
        </div>
    );
}
