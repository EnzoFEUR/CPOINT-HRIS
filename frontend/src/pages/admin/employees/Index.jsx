import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';

/**
 * Senior Enterprise Personnel Hub
 * Engineered for maximum data scanability, visual accessibility, and seamless employee administration.
 */
export default function EmployeesIndex() {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All');
    const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = viewMode === 'grid' ? 9 : 10;

    const fetchEmployees = async () => {
        const res = await fetchWithAuth(`/api/employees?t=${Date.now()}`);
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch employee records');
        return Array.isArray(result) ? result : (result.data || []);
    };

    const { data: employees = [], isLoading } = useQuery({
        queryKey: ['adminEmployees'],
        queryFn: fetchEmployees,
        staleTime: 30_000,
        gcTime: 300_000,
        refetchOnMount: 'always',
    });

    // Extract unique departments dynamically
    const departments = useMemo(() => {
        const depts = new Set();
        employees.forEach(e => {
            if (e.department) depts.add(e.department);
        });
        return ['All', ...Array.from(depts)];
    }, [employees]);

    // Client-side real-time filtering
    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            const roleStr = (emp.role || emp.job_title || '').toLowerCase();
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim().toLowerCase();
            const email = (emp.email || '').toLowerCase();

            // Universal safeguard against technical system accounts
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

            if (filterStatus === 'Salaried' && isFactory) return false;
            if (filterStatus === 'Piece-Rate' && !isFactory) return false;

            if (selectedDepartment !== 'All' && emp.department !== selectedDepartment) return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const companyId = (emp.company_id || '').toLowerCase();
                const jobTitle = (emp.job_title || '').toLowerCase();

                if (!fullName.includes(q) && !companyId.includes(q) && !email.includes(q) && !jobTitle.includes(q)) {
                    return false;
                }
            }

            return true;
        });
    }, [employees, filterStatus, selectedDepartment, searchQuery]);

    // Live counts for status tabs
    const counts = useMemo(() => {
        const valid = employees.filter(e => {
            const r = (e.role || '').toLowerCase();
            const em = (e.email || '').toLowerCase();
            return !r.includes('admin') && !r.includes('security') && em !== 'admin@c-point.com' && em !== 'guard@c-point.com';
        });
        const salaried = valid.filter(e => !(e.department || '').toLowerCase().includes('factory')).length;
        const pieceRate = valid.length - salaried;
        return { all: valid.length, salaried, pieceRate };
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

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.04 } }
    };

    const cardVariants = {
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
        <div className="max-w-7xl mx-auto space-y-5 pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="relative bg-slate-900 rounded-2xl p-6 sm:p-8 shadow-sm group">
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-3 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
                                <i className="ti ti-users text-2xl text-indigo-400" />
                            </div>
                            <span className="px-3 py-1 text-xs font-bold tracking-wider uppercase bg-indigo-500/20 text-indigo-300 rounded-md border border-indigo-500/30">
                                Personnel Registry
                            </span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight">Personnel Directory</h1>
                        <p className="text-sm text-slate-300 mt-1 max-w-xl">
                            Active workforce registry, biometric identification baselines, and statutory salary configurations.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <Link
                            to="/admin/documents"
                            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-xs sm:text-sm transition-colors flex items-center gap-2 border border-slate-700 shadow-sm"
                        >
                            <i className="ti ti-folders text-sky-400 text-base" />
                            <span>201 Documents</span>
                        </Link>

                        <Link
                            to="/admin/employees/create"
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs sm:text-sm transition-colors shadow-xs flex items-center gap-2 border border-indigo-500"
                        >
                            <i className="ti ti-user-plus text-base" />
                            <span>Add Employee</span>
                        </Link>
                    </div>
                </div>
            </motion.div>

            {/* Filter Toolbar */}
            <div className="bg-white p-3.5 sm:p-4 rounded-2xl shadow-xs border border-slate-200 space-y-3">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                    
                    {/* Search Input */}
                    <div className="relative flex-1 min-w-[260px]">
                        <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search by name, company ID, email, or position..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-10 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                title="Clear search"
                            >
                                <i className="ti ti-x text-sm" />
                            </button>
                        )}
                    </div>

                    {/* Status Pill Tabs with Live Badges */}
                    <div className="flex items-center gap-2">
                        <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto shrink-0">
                            {[
                                { id: 'All', label: 'All Personnel', count: counts.all },
                                { id: 'Salaried', label: 'Salaried', count: counts.salaried },
                                { id: 'Piece-Rate', label: 'Piece-Rate', count: counts.pieceRate }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => { setFilterStatus(tab.id); setCurrentPage(1); }}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                                        filterStatus === tab.id
                                            ? 'bg-white text-slate-900 shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                    <span>{tab.label}</span>
                                    <span className={`px-1.5 py-0.2 text-[10px] rounded-md font-mono ${
                                        filterStatus === tab.id ? 'bg-slate-100 text-slate-700' : 'bg-slate-200/80 text-slate-500'
                                    }`}>
                                        {tab.count}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* View Switcher Toggle */}
                        <div className="hidden sm:flex bg-slate-100 p-1 rounded-xl shrink-0">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-1.5 rounded-lg text-sm transition-all ${
                                    viewMode === 'grid' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-700'
                                }`}
                                title="Grid View"
                            >
                                <i className="ti ti-layout-grid" />
                            </button>
                            <button
                                onClick={() => setViewMode('table')}
                                className={`p-1.5 rounded-lg text-sm transition-all ${
                                    viewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-700'
                                }`}
                                title="Table View"
                            >
                                <i className="ti ti-list" />
                            </button>
                        </div>
                    </div>

                </div>

                {/* Sub Toolbar: Department Select & Records Counter */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <span className="text-slate-400 font-semibold uppercase text-[11px]">Department:</span>
                        <div className="relative min-w-[160px]">
                            <select
                                value={selectedDepartment}
                                onChange={(e) => { setSelectedDepartment(e.target.value); setCurrentPage(1); }}
                                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg pl-3 pr-8 py-1.5 text-xs font-semibold text-slate-700 outline-none cursor-pointer focus:bg-white focus:border-indigo-500 transition-colors"
                            >
                                <option value="All">All Departments</option>
                                {departments.filter(d => d !== 'All').map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                            <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 ml-auto">
                        <span className="text-slate-500 font-medium">
                            Showing <strong className="text-slate-800">{totalItems}</strong> matching personnel
                        </span>

                        {isFiltered && (
                            <button
                                onClick={handleClearFilters}
                                className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                title="Reset all filters"
                            >
                                <i className="ti ti-filter-off text-xs" /> Clear Filters
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Employee List */}
            {paginatedEmployees.length > 0 ? (
                viewMode === 'grid' ? (
                    /* Card View */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {paginatedEmployees.map((employee) => {
                            const isFactory = (employee.department || '').toLowerCase().includes('factory');
                            const rate = isFactory
                                ? Number(employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? 0)
                                : Number(employee.monthly_salary ?? employee.salary ?? 0);
                            const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');

                            return (
                                <div
                                    key={employee.id}
                                    className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs hover:border-indigo-300 hover:shadow-md transition-all duration-150 flex flex-col justify-between space-y-4 group"
                                >
                                        <div className="space-y-3">
                                            
                                            {/* Header Row: Avatar + Names + Badges */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <EmployeeAvatar employee={employee} size="h-12 w-12" />
                                                    <div className="min-w-0">
                                                        <h3 className="font-bold text-slate-900 text-base leading-snug truncate group-hover:text-indigo-600 transition-colors">
                                                            {employee.first_name} {employee.last_name}
                                                        </h3>
                                                        <p className="text-xs font-semibold text-slate-500 truncate">
                                                            {employee.job_title || 'General Staff'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Company ID & Department Pills */}
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
                                                    {employee.department || 'Operations'}
                                                </span>
                                            </div>

                                            {/* Compensation Specs Box */}
                                            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                                                <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
                                                    <span className="uppercase tracking-wide text-[10px]">Wage Structure</span>
                                                    <span className="font-semibold text-slate-700">
                                                        {isFactory ? 'Piece-Rate Basis' : 'Fixed Monthly'}
                                                    </span>
                                                </div>
                                                <div className="flex items-baseline gap-1">
                                                    <span className={`text-lg font-black font-mono tracking-tight ${
                                                        isFactory ? 'text-amber-700' : 'text-emerald-700'
                                                    }`}>
                                                        ₱{rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                    <span className="text-[11px] font-medium text-slate-400">
                                                        {isFactory ? '/ output' : '/ month'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Scannable Metadata Rows */}
                                            <div className="space-y-1.5 text-xs text-slate-600 pt-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-400 font-medium">Email:</span>
                                                    <span className="font-medium text-slate-700 truncate max-w-[190px]" title={employee.email}>
                                                        {employee.email || 'N/A'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-slate-400 font-medium">Joined:</span>
                                                    <span className="font-medium text-slate-700">
                                                        {formatDate(employee.created_at)}
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between pt-0.5">
                                                    <span className="text-slate-400 font-medium">System Role:</span>
                                                    <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-700 font-bold rounded uppercase text-[10px]">
                                                        {employee.role || 'employee'}
                                                    </span>
                                                </div>
                                            </div>

                                        </div>

                                        {/* Action Buttons Footer */}
                                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                                            <Link
                                                to={`/admin/documents?employee_id=${employee.id}`}
                                                className="px-3.5 py-1.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 hover:text-sky-900 font-bold text-xs rounded-xl border border-sky-200 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer group/docs"
                                                title="Open 201 Document Vault"
                                            >
                                                <i className="ti ti-folders text-sky-600 text-sm group-hover/docs:scale-110 transition-transform" />
                                                <span>201 Docs</span>
                                                <i className="ti ti-arrow-up-right text-[10px] text-sky-500 opacity-60 group-hover/docs:opacity-100 group-hover/docs:translate-x-0.5 transition-all" />
                                            </Link>

                                            <Link
                                                to={`/admin/employees/${employee.id}`}
                                                className="px-4 py-1.5 bg-slate-900 hover:bg-indigo-600 active:scale-95 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                                            >
                                                <span>Profile</span>
                                                <i className="ti ti-arrow-right text-xs" />
                                            </Link>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                ) : (
                    /* ── HIGH-READABILITY DATA TABLE VIEW ── */
                    <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-3.5">Employee</th>
                                        <th className="px-6 py-3.5">Department & Role</th>
                                        <th className="px-6 py-3.5">Wage Structure</th>
                                        <th className="px-6 py-3.5">Hire Date</th>
                                        <th className="px-6 py-3.5 text-center">System Role</th>
                                        <th className="px-6 py-3.5 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-xs">
                                    {paginatedEmployees.map((employee) => {
                                        const isFactory = (employee.department || '').toLowerCase().includes('factory');
                                        const rate = isFactory
                                            ? Number(employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? 0)
                                            : Number(employee.monthly_salary ?? employee.salary ?? 0);
                                        const companyId = employee.company_id || (employee.id ? String(employee.id).substring(0, 8) : 'CP-PASS');

                                        return (
                                            <tr key={employee.id} className="hover:bg-slate-50/80 transition-colors">
                                                <td className="px-6 py-3.5">
                                                    <div className="flex items-center gap-3">
                                                        <EmployeeAvatar employee={employee} size="h-9 w-9" />
                                                        <div>
                                                            <p className="font-bold text-slate-900 text-sm">
                                                                {employee.first_name} {employee.last_name}
                                                            </p>
                                                            <p className="text-slate-400 font-mono text-[11px]">
                                                                {companyId} &bull; {employee.email}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-6 py-3.5">
                                                    <div>
                                                        <p className="font-semibold text-slate-800">{employee.job_title || 'Staff'}</p>
                                                        <span className={`inline-block mt-0.5 px-2 py-0.2 rounded text-[10px] font-bold uppercase border ${
                                                            isFactory ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                                        }`}>
                                                            {employee.department || 'General'}
                                                        </span>
                                                    </div>
                                                </td>

                                                <td className="px-6 py-3.5">
                                                    <p className={`font-mono font-bold text-sm ${isFactory ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                        ₱{rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-slate-400 text-[10px] uppercase font-semibold">
                                                        {isFactory ? 'Piece-Rate' : 'Fixed Monthly'}
                                                    </p>
                                                </td>

                                                <td className="px-6 py-3.5 font-medium text-slate-600">
                                                    {formatDate(employee.created_at)}
                                                </td>

                                                <td className="px-6 py-3.5 text-center">
                                                    <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded font-bold uppercase text-[10px] border border-slate-200">
                                                        {employee.role || 'employee'}
                                                    </span>
                                                </td>

                                                <td className="px-6 py-3.5 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Link
                                                            to={`/admin/documents?employee_id=${employee.id}`}
                                                            className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 active:scale-95 text-sky-700 font-bold text-xs rounded-lg border border-sky-200 transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                                                            title="View 201 Documents"
                                                        >
                                                            <i className="ti ti-folders text-sky-600 text-sm" />
                                                            <span>Docs</span>
                                                        </Link>
                                                        <Link
                                                            to={`/admin/employees/${employee.id}`}
                                                            className="px-3 py-1 bg-slate-900 hover:bg-indigo-600 active:scale-95 text-white font-bold rounded-lg transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                                                        >
                                                            <span>Profile</span>
                                                            <i className="ti ti-arrow-right text-xs" />
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
                /* Empty State */
                <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-xs space-y-3">
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
                            className="mt-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
                        >
                            Reset All Filters
                        </button>
                    )}
                </div>
            )}

            {/* Pagination */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-semibold">
                <div>
                    {totalItems > 0 ? (
                        <span>Showing <span className="text-slate-900 font-bold">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-900 font-bold">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-900 font-bold">{totalItems}</span> personnel</span>
                    ) : (
                        <span>Showing <span className="text-slate-900 font-bold">0</span> of <span className="text-slate-900 font-bold">0</span></span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                        <i className="ti ti-chevron-left text-sm" /> Prev
                    </button>

                    <span className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-bold text-xs">
                        {currentPage} / {totalPages}
                    </span>

                    <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage >= totalPages}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                        Next <i className="ti ti-chevron-right text-sm" />
                    </button>
                </div>
            </div>

        </div>
    );
}
