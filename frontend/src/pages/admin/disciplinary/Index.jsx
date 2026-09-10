import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

export default function DisciplinaryIndex() {
    const [records, setRecords] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    // Search, Filter & Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('Active');
    const [filterType, setFilterType] = useState('All');
    const [filterSeverity, setFilterSeverity] = useState('All');
    const [sortBy, setSortBy] = useState('date_desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Form State for Logging Infraction
    const [showModal, setShowModal] = useState(false);
    const [employeeId, setEmployeeId] = useState('');
    const [type, setType] = useState('Warning');
    const [severity, setSeverity] = useState('Low');
    const [reason, setReason] = useState('');
    const [durationDays, setDurationDays] = useState(3);
    const [customDays, setCustomDays] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Clear Disciplinary Record Modal State
    const [showClearModal, setShowClearModal] = useState(false);
    const [selectedRecordForClear, setSelectedRecordForClear] = useState(null);
    const [clearReason, setClearReason] = useState('');
    const [investigationNotes, setInvestigationNotes] = useState('');
    const [isConfirmed, setIsConfirmed] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    // Employee profile modal state
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [selectedEmployeeProfile, setSelectedEmployeeProfile] = useState(null);

    // Fetch disciplinary records & employee directory
    const fetchData = async (isBackground = false) => {
        try {
            if (!isBackground && records.length === 0) {
                setIsLoading(true);
            } else {
                setIsRefreshing(true);
            }

            const [recRes, empRes] = await Promise.all([
                fetchWithAuth('/api/disciplinary'),
                fetchWithAuth('/api/employees')
            ]);
            
            if (recRes.ok) {
                const data = await recRes.json();
                const fetchedRecords = Array.isArray(data) ? data : (data?.data || []);
                setRecords(fetchedRecords);
            }
            if (empRes.ok) {
                const data = await empRes.json();
                const empList = Array.isArray(data) ? data : (data?.data || []);
                setEmployees(empList.filter(e => e.role !== 'admin'));
            }
        } catch (err) {
            console.error(err);
            if (!isBackground) {
                toast.error('Failed to load disciplinary records');
            }
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();

        let debounceTimer = null;
        const debouncedRefresh = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                fetchData(true);
            }, 250);
        };

        const channel = supabase
            .channel('disciplinary_realtime_sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'disciplinary_logs' }, debouncedRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, debouncedRefresh)
            .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, debouncedRefresh)
            .on('broadcast', { event: 'DISCIPLINARY_STATUS_UPDATED' }, debouncedRefresh)
            .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, debouncedRefresh)
            .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, debouncedRefresh)
            .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, debouncedRefresh)
            .on('broadcast', { event: 'DISCIPLINARY_DELETED' }, debouncedRefresh)
            .subscribe();

        return () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            supabase.removeChannel(channel);
        };
    }, []);

    // Selected employee for modal preview
    const selectedEmployeeObj = useMemo(() => {
        if (!employeeId) return null;
        return employees.find(e => e.id === employeeId) || null;
    }, [employeeId, employees]);

    // Clear false or unfounded disciplinary record
    const handleClearSubmit = async (e) => {
        e.preventDefault();
        if (!selectedRecordForClear || !clearReason.trim()) {
            toast.error('Please enter a reason for clearing this record.');
            return;
        }

        if (!isConfirmed) {
            toast.error('Please check the confirmation box before clearing this record.');
            return;
        }

        const targetRecordId = selectedRecordForClear.id;
        const previousRecords = [...records];

        setRecords(prev => prev.map(rec => {
            if (rec.id === targetRecordId) {
                return {
                    ...rec,
                    status: 'Overturned',
                    employee_status: 'active',
                    employee_is_active: true,
                    reason: `[CLEARED | ${new Date().toISOString().split('T')[0]}] Reason: ${clearReason.trim()}\n---\n${rec.reason}`
                };
            }
            return rec;
        }));

        setShowClearModal(false);

        try {
            setIsClearing(true);
            const res = await fetchWithAuth(`/api/disciplinary/${targetRecordId}/overturn`, {
                method: 'PUT',
                body: JSON.stringify({
                    clearing_reason: clearReason.trim(),
                    investigation_notes: investigationNotes.trim()
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(data.message || 'Record cleared and employee reinstated.');
                setSelectedRecordForClear(null);
                setClearReason('');
                setInvestigationNotes('');
                setIsConfirmed(false);
            } else {
                setRecords(previousRecords);
                toast.error(data.error || 'Failed to clear record.');
            }
        } catch (err) {
            console.error('Error clearing record:', err);
            setRecords(previousRecords);
            toast.error('Network error while clearing record.');
        } finally {
            setIsClearing(false);
        }
    };

    // Log Infraction Submit
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!employeeId) {
            toast.error('Please select an employee.');
            return;
        }

        try {
            setIsSubmitting(true);
            const resolvedDuration = type === 'Suspension' ? (customDays ? parseInt(customDays, 10) : durationDays) : undefined;
            const res = await fetchWithAuth('/api/disciplinary', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: employeeId,
                    type,
                    severity: type === 'Termination' ? 'Critical' : (type === 'Suspension' ? 'High' : severity),
                    reason,
                    duration_days: resolvedDuration
                })
            });

            const data = await res.json();
            if (res.ok) {
                toast.success(`${type} action logged and applied to employee account`);
                setShowModal(false);
                setEmployeeId('');
                setReason('');
                setType('Warning');
                setSeverity('Low');
                setDurationDays(3);
                setCustomDays('');
                fetchData(true);
            } else {
                toast.error(data.error || 'Failed to log action');
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Lift suspension or resolve disciplinary action
    const handleResolve = async (id, empId, isSuspension = false) => {
        const previousRecords = [...records];

        setRecords(prev => prev.map(rec => {
            if (rec.id === id) {
                return {
                    ...rec,
                    status: 'Resolved',
                    employee_status: isSuspension ? 'active' : rec.employee_status,
                    employee_is_active: isSuspension ? true : rec.employee_is_active
                };
            }
            return rec;
        }));

        try {
            const res = await fetchWithAuth(`/api/disciplinary/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'Resolved' })
            });

            if (res.ok) {
                const result = await res.json();
                if (result?.data) {
                    setRecords(prev => prev.map(rec => {
                        if (rec.id === id) {
                            return {
                                ...rec,
                                ...result.data,
                                status: 'Resolved',
                                employee_status: 'active',
                                employee_is_active: true
                            };
                        }
                        return rec;
                    }));
                }
                toast.success(isSuspension ? 'Suspension lifted and account reinstated.' : 'Record marked as resolved.');
            } else {
                setRecords(previousRecords);
                const errorData = await res.json().catch(() => ({}));
                toast.error(errorData.error || 'Failed to update status.');
            }
        } catch (err) {
            console.error('Error updating status:', err);
            setRecords(previousRecords);
            toast.error('Network error updating status.');
        }
    };

    // Permanently delete disciplinary record
    const handleDeleteRecord = async (id) => {
        if (!window.confirm('Permanently delete this disciplinary record? This will remove it from compliance logs.')) {
            return;
        }

        const previousRecords = [...records];
        setRecords(prev => prev.filter(r => r.id !== id));

        try {
            const res = await fetchWithAuth(`/api/disciplinary/${id}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setRecords(previousRecords);
                toast.error(data.error || 'Failed to delete record.');
            } else {
                toast.success('Disciplinary record deleted.');
            }
        } catch (err) {
            console.error('Error deleting record:', err);
            setRecords(previousRecords);
            toast.error('Network error deleting record.');
        }
    };

    // Open employee profile modal
    const handleOpenProfile = (record) => {
        // Find matching employee details
        const emp = employees.find(e => e.id === record.employee_id) || {
            id: record.employee_id,
            company_id: record.company_id,
            first_name: record.first_name || record.employee_name?.split(' ')[0] || '',
            last_name: record.last_name || record.employee_name?.split(' ')[1] || '',
            department: record.department || 'Operations',
            job_title: record.job_title || 'Staff',
            email: record.employee_email,
            status: record.employee_status || 'active',
            is_active: record.employee_is_active ?? true,
            avatar_url: record.avatar_url,
            biometric_baseline_path: record.biometric_baseline_path,
            date_hired: record.date_hired,
            shift: record.shift
        };

        // Get all disciplinary records for this specific employee
        const empRecords = records.filter(r => r.employee_id === record.employee_id);

        setSelectedEmployeeProfile({
            employee: emp,
            infractionHistory: empRecords
        });
        setShowProfileModal(true);
    };

    // Metric Calculations
    const totalCases = records.length;
    const activeCases = records.filter(r => r.status === 'Active').length;
    const acknowledgedCases = records.filter(r => r.status === 'Acknowledged').length;
    const resolvedCases = records.filter(r => r.status === 'Resolved').length;
    const overturnedCases = records.filter(r => r.status === 'Overturned').length;
    const suspensionsActive = records.filter(r => r.type === 'Suspension' && r.status === 'Active').length;

    // Filter, Search, and Sort Pipeline
    const filteredRecords = useMemo(() => {
        return records.filter(record => {
            // Status filter
            if (filterStatus !== 'All' && record.status !== filterStatus) {
                return false;
            }
            // Type filter
            if (filterType !== 'All' && record.type !== filterType) {
                return false;
            }
            // Severity filter
            if (filterSeverity !== 'All' && record.severity !== filterSeverity) {
                return false;
            }
            // Search query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const name = (record.employee_name || '').toLowerCase();
                const compId = (record.company_id || '').toLowerCase();
                const dept = (record.department || '').toLowerCase();
                const reasonText = (record.reason || '').toLowerCase();
                const ref = `disc-${(record.id || '').slice(0, 6)}`.toLowerCase();
                if (!name.includes(q) && !compId.includes(q) && !dept.includes(q) && !reasonText.includes(q) && !ref.includes(q)) {
                    return false;
                }
            }
            return true;
        }).sort((a, b) => {
            if (sortBy === 'date_desc') {
                return new Date(b.created_at || b.date) - new Date(a.created_at || a.date);
            }
            if (sortBy === 'date_asc') {
                return new Date(a.created_at || a.date) - new Date(b.created_at || b.date);
            }
            if (sortBy === 'severity') {
                const rank = { Critical: 4, High: 3, Medium: 2, Low: 1 };
                return (rank[b.severity] || 0) - (rank[a.severity] || 0);
            }
            if (sortBy === 'name') {
                return (a.employee_name || '').localeCompare(b.employee_name || '');
            }
            return 0;
        });
    }, [records, filterStatus, filterType, filterSeverity, searchQuery, sortBy]);

    // Pagination
    const totalItems = filteredRecords.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedRecords = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredRecords.slice(start, start + itemsPerPage);
    }, [filteredRecords, currentPage, itemsPerPage]);

    // Reset pagination when filter changes
    const handleFilterChange = (status) => {
        setFilterStatus(status);
        setCurrentPage(1);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-rose-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Disciplinary Hub...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 lg:pb-8 font-sans space-y-6">
            {/* PAGE HEADER */}
            <PageHeader
                breadcrumbs={['Admin', 'Compliance', 'Disciplinary Hub']}
                title="Disciplinary &amp; Compliance Governance"
                description="Suspension controls, gate access management, and record clearance workflows."
                actions={
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => setShowModal(true)} 
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs sm:text-sm transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                        >
                            <i className="ti ti-plus text-base" />
                            <span>Log Infraction</span>
                        </button>
                    </div>
                }
            />

            {/* EXECUTIVE METRIC CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Active Cases Requiring Action */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl shrink-0 border border-rose-100">
                        <i className="ti ti-alert-triangle" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Action Required</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-2xl font-bold font-mono text-rose-600 tabular-nums">{activeCases}</span>
                            <span className="text-[11px] text-slate-400 font-medium">pending inquiry</span>
                        </div>
                    </div>
                </div>

                {/* 2. Suspensions Enforced */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center text-xl shrink-0 border border-orange-100">
                        <i className="ti ti-lock" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Suspensions</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-2xl font-bold font-mono text-orange-600 tabular-nums">{suspensionsActive}</span>
                            <span className="text-[11px] text-slate-400 font-medium">gate locked</span>
                        </div>
                    </div>
                </div>

                {/* 3. Cleared Records */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center text-xl shrink-0 border border-teal-100">
                        <i className="ti ti-shield-check" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cleared Records</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-2xl font-bold font-mono text-teal-600 tabular-nums">{overturnedCases}</span>
                            <span className="text-[11px] text-slate-400 font-medium">records cleared</span>
                        </div>
                    </div>
                </div>

                {/* 4. Total Incidents */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-xl shrink-0 border border-slate-200">
                        <i className="ti ti-history" />
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Recorded</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">{totalCases}</span>
                            <span className="text-[11px] text-slate-400 font-medium">{resolvedCases} resolved</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* FILTER & SEARCH CONTROL BAR */}
            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                {/* Search and Dropdowns */}
                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
                    {/* Search Input */}
                    <div className="relative flex-1">
                        <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            placeholder="Search employee name, company ID, case REF, department..."
                            className="w-full pl-10 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-blue-500 transition-colors"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                            >
                                <i className="ti ti-x text-xs" />
                            </button>
                        )}
                    </div>

                    {/* Filter Type */}
                    <div className="flex items-center gap-2">
                        <select
                            value={filterType}
                            onChange={(e) => { setFilterType(e.target.value); setCurrentPage(1); }}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-blue-500"
                        >
                            <option value="All">All Action Types</option>
                            <option value="Warning">Warnings</option>
                            <option value="Suspension">Suspensions</option>
                            <option value="Termination">Terminations</option>
                        </select>

                        {/* Filter Severity */}
                        <select
                            value={filterSeverity}
                            onChange={(e) => { setFilterSeverity(e.target.value); setCurrentPage(1); }}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-blue-500"
                        >
                            <option value="All">All Severities</option>
                            <option value="Critical">Critical</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                        </select>

                        {/* Sort Order */}
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:bg-white focus:border-blue-500"
                        >
                            <option value="date_desc">Newest First</option>
                            <option value="date_asc">Oldest First</option>
                            <option value="severity">Highest Severity</option>
                            <option value="name">Employee (A-Z)</option>
                        </select>
                    </div>
                </div>

                {/* Status Navigation Tabs with Badges */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 overflow-x-auto no-scrollbar gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                        {[
                            { key: 'Active', label: 'Action Required', count: activeCases, badgeColor: 'bg-rose-100 text-rose-700' },
                            { key: 'All', label: 'All Incidents', count: totalCases },
                            { key: 'Acknowledged', label: 'Acknowledged', count: acknowledgedCases, badgeColor: 'bg-emerald-100 text-emerald-700' },
                            { key: 'Resolved', label: 'Resolved / Restored', count: resolvedCases, badgeColor: 'bg-slate-200 text-slate-700' },
                            { key: 'Overturned', label: 'Cleared', count: overturnedCases, badgeColor: 'bg-teal-100 text-teal-800' }
                        ].map(tab => {
                            const isSelected = filterStatus === tab.key;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => handleFilterChange(tab.key)}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                                        isSelected
                                            ? 'bg-slate-900 text-white shadow-xs'
                                            : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
                                    }`}
                                >
                                    <span>{tab.label}</span>
                                    <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${
                                        isSelected 
                                            ? 'bg-white/20 text-white' 
                                            : (tab.badgeColor || 'bg-slate-100 text-slate-600')
                                    }`}>
                                        {tab.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {(searchQuery || filterStatus !== 'All' || filterType !== 'All' || filterSeverity !== 'All') && (
                        <button
                            onClick={() => {
                                setSearchQuery('');
                                setFilterStatus('All');
                                setFilterType('All');
                                setFilterSeverity('All');
                                setCurrentPage(1);
                            }}
                            className="text-xs font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                            <i className="ti ti-filter-off text-xs" />
                            <span>Reset Filters</span>
                        </button>
                    )}
                </div>
            </div>

            {/* TABLE CONTAINER */}
            <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
                {/* DESKTOP TABLE VIEW */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-3.5">Employee Profile</th>
                                <th className="px-6 py-3.5">Infraction &amp; Grounds</th>
                                <th className="px-6 py-3.5 text-center">Severity</th>
                                <th className="px-6 py-3.5 text-center">Operational Standing</th>
                                <th className="px-6 py-3.5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                            {paginatedRecords.length > 0 ? paginatedRecords.map((record) => {
                                const isSuspended = !record.employee_is_active && record.type === 'Suspension';
                                const isTerminated = !record.employee_is_active && record.type === 'Termination';

                                return (
                                    <tr key={record.id} className="hover:bg-slate-50/70 transition-colors group">
                                        {/* 1. Employee Profile Column with Avatar */}
                                        <td className="px-6 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <div 
                                                    onClick={() => handleOpenProfile(record)} 
                                                    className="relative cursor-pointer transition-transform hover:scale-105"
                                                    title="View employee profile"
                                                >
                                                    <EmployeeAvatar
                                                        companyId={record.company_id}
                                                        employeeId={record.employee_id}
                                                        employeeName={record.employee_name}
                                                        avatarUrl={record.avatar_url}
                                                        photoUrl={record.photo_url}
                                                        department={record.department}
                                                        size="h-10 w-10"
                                                        rounded="rounded-xl"
                                                    />
                                                    {/* Operational Status Dot on Avatar */}
                                                    <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white flex items-center justify-center ${
                                                        isTerminated ? 'bg-rose-600' :
                                                        isSuspended ? 'bg-orange-500' :
                                                        'bg-emerald-500'
                                                    }`} title={isTerminated ? 'Separated / Deactivated' : isSuspended ? 'Suspended / Locked' : 'Active Personnel'} />
                                                </div>

                                                <div>
                                                    <button
                                                        onClick={() => handleOpenProfile(record)}
                                                        className="text-sm font-bold text-slate-900 hover:text-blue-600 transition-colors text-left flex items-center gap-1.5 cursor-pointer"
                                                    >
                                                        <span>{record.employee_name}</span>
                                                        <i className="ti ti-external-link text-[11px] opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                                                    </button>
                                                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                                                        <span className="font-semibold text-slate-600">{record.company_id || 'ID N/A'}</span>
                                                        <span className="mx-1.5">•</span>
                                                        <span>{record.department || 'Operations'}</span>
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* 2. Infraction & Grounds */}
                                        <td className="px-6 py-3.5">
                                            <div className="flex items-center gap-2">
                                                {record.type === 'Termination' && (record.status === 'Resolved' || record.employee_is_active) ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                                        <i className="ti ti-arrow-back-up text-xs text-emerald-600" /> Termination (Revoked / Restored)
                                                    </span>
                                                ) : record.type === 'Suspension' && record.status === 'Resolved' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                                        <i className="ti ti-lock-open text-xs text-emerald-600" /> Suspension (Lifted)
                                                    </span>
                                                ) : record.type === 'Suspension' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-100 text-orange-800 border border-orange-200">
                                                        <i className="ti ti-lock text-xs" /> Suspension
                                                    </span>
                                                ) : record.type === 'Termination' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                                        <i className="ti ti-ban text-xs" /> Termination
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                                        <i className="ti ti-alert-triangle text-xs" /> Warning
                                                    </span>
                                                )}
                                                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                                    REF: DISC-{(record.id || '').slice(0, 6).toUpperCase()}
                                                </span>
                                            </div>

                                            <p className="text-xs text-slate-600 mt-1.5 max-w-md font-medium leading-snug line-clamp-2" title={record.reason}>
                                                {record.reason}
                                            </p>

                                            <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400 font-mono">
                                                <span>Issued: {record.date}</span>
                                                {record.created_at && (
                                                    <span>• {new Date(record.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                )}
                                            </div>
                                        </td>

                                        {/* 3. Severity Rating */}
                                        <td className="px-6 py-3.5 text-center">
                                            <Badge 
                                                variant={
                                                    record.severity === 'Critical' || record.severity === 'High' ? 'absent' :
                                                    record.severity === 'Medium' ? 'late' :
                                                    'neutral'
                                                }
                                            >
                                                {record.severity}
                                            </Badge>
                                        </td>

                                        {/* 4. 1-to-1 Operational Standing */}
                                        <td className="px-6 py-3.5 text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                {/* Infraction Status Badge */}
                                                {record.status === 'Active' && (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                                        Action Required
                                                    </span>
                                                )}
                                                {record.status === 'Acknowledged' && (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                        ✓ Acknowledged
                                                    </span>
                                                )}
                                                {record.status === 'Resolved' && (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                        {record.type === 'Termination' ? '✓ Reinstated & Resolved' : 'Resolved'}
                                                    </span>
                                                )}
                                                {record.status === 'Under Review' && (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                                        Under Review
                                                    </span>
                                                )}
                                                {record.status === 'Overturned' && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                                                        <i className="ti ti-shield-check text-xs" /> Cleared
                                                    </span>
                                                )}

                                                {/* 1-to-1 Gate & Employee Account Standing */}
                                                <div className="text-[10px] font-mono font-medium flex items-center gap-1 mt-0.5">
                                                    {isTerminated ? (
                                                        <span className="text-rose-600 font-bold bg-rose-50 px-1.5 py-0.2 rounded border border-rose-100">
                                                            Gate: Blocked (Archive)
                                                        </span>
                                                    ) : isSuspended ? (
                                                        <span className="text-orange-600 font-bold bg-orange-50 px-1.5 py-0.2 rounded border border-orange-100">
                                                            Gate: Blocked (Suspended)
                                                        </span>
                                                    ) : (
                                                        <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100">
                                                            Gate: Allowed (Active)
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>

                                        {/* 5. Actions */}
                                        <td className="px-6 py-3.5 text-right">
                                            <div className="flex items-center justify-end gap-1.5">
                                                {/* Review & Clear Button (Available unless already cleared) */}
                                                {record.status !== 'Overturned' && (
                                                    <button 
                                                        onClick={() => {
                                                            setSelectedRecordForClear(record);
                                                            setClearReason('');
                                                            setInvestigationNotes('');
                                                            setIsConfirmed(false);
                                                            setShowClearModal(true);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 font-bold text-xs rounded-lg border border-teal-200 transition-colors shadow-xs cursor-pointer"
                                                        title="Review this case and clear record"
                                                    >
                                                        <i className="ti ti-file-check text-teal-600" />
                                                        <span>Review &amp; Clear</span>
                                                    </button>
                                                )}

                                                {/* Lift & Reinstate (for Active Suspension) */}
                                                {record.type === 'Suspension' && record.status === 'Active' ? (
                                                    <button 
                                                        onClick={() => handleResolve(record.id, record.employee_id, true)}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-xs rounded-lg border border-emerald-200 transition-colors shadow-xs cursor-pointer"
                                                        title="Lift suspension and immediately reinstate employee access"
                                                    >
                                                        <i className="ti ti-lock-open text-emerald-600" />
                                                        <span>Lift &amp; Reinstate</span>
                                                    </button>
                                                ) : record.status !== 'Resolved' && record.status !== 'Overturned' ? (
                                                    <button 
                                                        onClick={() => handleResolve(record.id, record.employee_id, false)}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-700 hover:bg-emerald-50 font-semibold text-xs rounded-lg border border-emerald-200 transition-colors shadow-xs cursor-pointer"
                                                    >
                                                        <i className="ti ti-check text-emerald-600" />
                                                        <span>Mark Resolved</span>
                                                    </button>
                                                ) : record.status === 'Overturned' ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-teal-600 font-mono font-semibold">
                                                        <i className="ti ti-shield-check" /> Cleared
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-mono">
                                                        <i className="ti ti-circle-check text-slate-400" /> Closed
                                                    </span>
                                                )}

                                                {/* View employee profile */}
                                                <button
                                                    onClick={() => handleOpenProfile(record)}
                                                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                                                    title="View Employee Profile & History"
                                                >
                                                    <i className="ti ti-user-search text-base" />
                                                </button>

                                                {/* Permanently Delete Record */}
                                                <button
                                                    onClick={() => handleDeleteRecord(record.id)}
                                                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                                                    title="Permanently Delete Disciplinary Record"
                                                >
                                                    <i className="ti ti-trash text-base" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-slate-400">
                                        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                                            <i className="ti ti-file-certificate text-2xl" />
                                        </div>
                                        <p className="text-sm font-bold text-slate-700">No Incidents Found</p>
                                        <p className="text-xs mt-0.5 text-slate-500">
                                            {searchQuery ? `No matching records found for "${searchQuery}".` : 'The workplace is fully compliant with zero active violations.'}
                                        </p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* MOBILE RESPONSIVE CARDS VIEW */}
                <div className="md:hidden divide-y divide-slate-100">
                    {paginatedRecords.length > 0 ? paginatedRecords.map((record) => {
                        const isSuspended = !record.employee_is_active && record.type === 'Suspension';
                        const isTerminated = !record.employee_is_active && record.type === 'Termination';

                        return (
                            <div key={record.id} className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div onClick={() => handleOpenProfile(record)} className="relative cursor-pointer">
                                            <EmployeeAvatar
                                                companyId={record.company_id}
                                                employeeId={record.employee_id}
                                                employeeName={record.employee_name}
                                                avatarUrl={record.avatar_url}
                                                photoUrl={record.photo_url}
                                                department={record.department}
                                                size="h-11 w-11"
                                                rounded="rounded-xl"
                                            />
                                            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white flex items-center justify-center ${
                                                isTerminated ? 'bg-rose-600' :
                                                isSuspended ? 'bg-orange-500' :
                                                'bg-emerald-500'
                                            }`} />
                                        </div>
                                        <div>
                                            <button
                                                onClick={() => handleOpenProfile(record)}
                                                className="text-sm font-bold text-slate-900 text-left cursor-pointer"
                                            >
                                                {record.employee_name}
                                            </button>
                                            <p className="text-[11px] text-slate-500 font-mono">
                                                {record.department || 'Operations'} • {record.company_id || 'ID N/A'}
                                            </p>
                                        </div>
                                    </div>

                                    <Badge 
                                        variant={
                                            record.severity === 'Critical' || record.severity === 'High' ? 'absent' :
                                            record.severity === 'Medium' ? 'late' : 'neutral'
                                        }
                                    >
                                        {record.severity}
                                    </Badge>
                                </div>

                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            {record.type === 'Termination' && (record.status === 'Resolved' || record.employee_is_active) ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                                    <i className="ti ti-arrow-back-up text-xs text-emerald-600" /> Termination (Revoked)
                                                </span>
                                            ) : record.type === 'Suspension' && record.status === 'Resolved' ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                                                    <i className="ti ti-lock-open text-xs text-emerald-600" /> Suspension (Lifted)
                                                </span>
                                            ) : record.type === 'Suspension' ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800">
                                                    <i className="ti ti-lock" /> Suspension
                                                </span>
                                            ) : record.type === 'Termination' ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                                                    <i className="ti ti-ban" /> Termination
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                                    <i className="ti ti-alert-triangle" /> Warning
                                                </span>
                                            )}
                                            <span className="text-[10px] font-mono text-slate-400">REF: DISC-{(record.id || '').slice(0, 6).toUpperCase()}</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-slate-400">{record.date}</span>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed font-medium">{record.reason}</p>
                                </div>

                                <div className="flex items-center justify-between pt-1">
                                    <div>
                                        {record.status === 'Active' && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                                Action Required
                                            </span>
                                        )}
                                        {record.status === 'Acknowledged' && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                ✓ Acknowledged
                                            </span>
                                        )}
                                        {record.status === 'Resolved' && (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                                {record.type === 'Termination' ? '✓ Reinstated & Resolved' : 'Resolved'}
                                            </span>
                                        )}
                                        {record.status === 'Overturned' && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                                                <i className="ti ti-shield-check text-[10px]" /> Cleared
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {record.status !== 'Overturned' && (
                                            <button 
                                                onClick={() => {
                                                    setSelectedRecordForClear(record);
                                                    setClearReason('');
                                                    setInvestigationNotes('');
                                                    setIsConfirmed(false);
                                                    setShowClearModal(true);
                                                }}
                                                className="px-2.5 py-1 bg-teal-50 text-teal-700 font-bold text-xs rounded-lg border border-teal-200 shadow-xs flex items-center gap-1 cursor-pointer"
                                                title="Review this case and clear record"
                                            >
                                                <i className="ti ti-file-check text-xs" /> Review &amp; Clear
                                            </button>
                                        )}

                                        {record.type === 'Suspension' && record.status === 'Active' ? (
                                            <button 
                                                onClick={() => handleResolve(record.id, record.employee_id, true)} 
                                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1 cursor-pointer"
                                            >
                                                <i className="ti ti-lock-open text-xs" /> Lift &amp; Reinstate
                                            </button>
                                        ) : record.status !== 'Resolved' && record.status !== 'Overturned' ? (
                                            <button 
                                                onClick={() => handleResolve(record.id, record.employee_id, false)} 
                                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-xs flex items-center gap-1 cursor-pointer"
                                            >
                                                <i className="ti ti-check text-xs" /> Mark Resolved
                                            </button>
                                        ) : null}

                                        {/* Permanently Delete Record */}
                                        <button
                                            onClick={() => handleDeleteRecord(record.id)}
                                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                                            title="Permanently Delete Disciplinary Record"
                                        >
                                            <i className="ti ti-trash text-sm" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    }) : (
                        <div className="p-8 text-center text-slate-400">
                            <p className="text-sm font-semibold text-slate-700">Zero Incidents</p>
                            <p className="text-xs mt-0.5">No disciplinary records found.</p>
                        </div>
                    )}
                </div>

                {/* PAGINATION BAR */}
                <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-medium">
                    <div className="flex items-center gap-3">
                        {totalItems > 0 ? (
                            <span>
                                Showing <span className="font-semibold text-slate-900 font-mono tabular-nums">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="font-semibold text-slate-900 font-mono tabular-nums">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="font-semibold text-slate-900 font-mono tabular-nums">{totalItems}</span>
                            </span>
                        ) : (
                            <span>Showing 0 of 0</span>
                        )}

                        <div className="hidden sm:flex items-center gap-1.5 ml-4">
                            <span>Per page:</span>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                                className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-xs font-semibold text-slate-700"
                            >
                                <option value={10}>10</option>
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                        >
                            <i className="ti ti-chevron-left text-xs" /> Prev
                        </button>
                        
                        <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono font-medium text-xs tabular-nums">
                            {currentPage} / {totalPages}
                        </span>

                        <button 
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage >= totalPages}
                            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                        >
                            Next <i className="ti ti-chevron-right text-xs" />
                        </button>
                    </div>
                </div>
            </div>

            {/* LOG INFRACTION MODAL */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
                        onClick={() => setShowModal(false)}
                    />
                    <div 
                        className="relative bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-5 sm:p-7 border border-slate-200 z-10 max-h-[90vh] flex flex-col"
                    >
                        <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-100 shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${
                                    type === 'Suspension' ? 'bg-orange-100 text-orange-600' :
                                    type === 'Termination' ? 'bg-rose-100 text-rose-600' :
                                    'bg-amber-100 text-amber-600'
                                }`}>
                                    <i className={type === 'Suspension' ? 'ti ti-lock' : (type === 'Termination' ? 'ti ti-ban' : 'ti ti-alert-triangle')} />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-slate-900 leading-tight">
                                        {type === 'Suspension' ? 'Log Account Suspension' : (type === 'Termination' ? 'Log Employment Termination' : 'Issue Disciplinary Warning')}
                                    </h2>
                                    <p className="text-[11px] text-slate-400 font-medium">Compliance &amp; Security Protocol</p>
                                </div>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer">
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1">
                            {/* TARGET PERSONNEL SELECTOR */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Target Personnel</label>
                                <select 
                                    required 
                                    value={employeeId} 
                                    onChange={(e) => setEmployeeId(e.target.value)}
                                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-blue-500 transition-colors"
                                >
                                    <option value="">Select employee...</option>
                                    {employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.first_name} {emp.last_name} ({emp.company_id || 'ID N/A'}) • {emp.department || 'Staff'}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* SELECTED EMPLOYEE AVATAR & BIO PREVIEW CARD */}
                            {selectedEmployeeObj && (
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3 animate-fade-in">
                                    <EmployeeAvatar
                                        companyId={selectedEmployeeObj.company_id}
                                        employeeId={selectedEmployeeObj.id}
                                        name={`${selectedEmployeeObj.first_name} ${selectedEmployeeObj.last_name}`}
                                        avatarUrl={selectedEmployeeObj.avatar_url}
                                        photoUrl={selectedEmployeeObj.biometric_baseline_path ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${selectedEmployeeObj.biometric_baseline_path}` : null}
                                        department={selectedEmployeeObj.department}
                                        size="h-11 w-11"
                                        rounded="rounded-xl"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold text-slate-900 truncate">
                                                {selectedEmployeeObj.first_name} {selectedEmployeeObj.last_name}
                                            </p>
                                            <span className="text-[10px] font-mono text-slate-400 font-semibold">
                                                {selectedEmployeeObj.company_id || 'ID N/A'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                            {selectedEmployeeObj.job_title || 'Staff'} • {selectedEmployeeObj.department || 'Operations'}
                                        </p>
                                    </div>
                                </div>
                            )}
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Action Type</label>
                                    <select 
                                        value={type} 
                                        onChange={(e) => {
                                            const newType = e.target.value;
                                            setType(newType);
                                            if (newType === 'Warning') setSeverity('Low');
                                            if (newType === 'Suspension') setSeverity('High');
                                            if (newType === 'Termination') setSeverity('Critical');
                                        }}
                                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-blue-500 transition-colors"
                                    >
                                        <option value="Warning">Warning (Active Access)</option>
                                        <option value="Suspension">Suspension (Account Lockout)</option>
                                        <option value="Termination">Termination (Permanent Revocation)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Severity Rating</label>
                                    <select 
                                        disabled={type === 'Termination'}
                                        value={severity} 
                                        onChange={(e) => setSeverity(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-blue-500 disabled:opacity-60 transition-colors"
                                    >
                                        <option value="Low">Low Severity</option>
                                        <option value="Medium">Medium Severity</option>
                                        <option value="High">High Severity</option>
                                        <option value="Critical">Critical Severity</option>
                                    </select>
                                </div>
                            </div>

                            {/* DURATION CONFIGURATOR FOR SUSPENSION */}
                            {type === 'Suspension' && (
                                <div className="p-3.5 bg-orange-50 border border-orange-200 rounded-xl space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                                            <i className="ti ti-clock-hour-4" />
                                            <span>Suspension Duration (3 Days to 1 Week)</span>
                                        </label>
                                        <span className="text-[11px] font-mono font-bold text-orange-700">
                                            {customDays ? `${customDays} Days` : `${durationDays} Days`}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-4 gap-2">
                                        {[
                                            { label: '3 Days', val: 3 },
                                            { label: '5 Days', val: 5 },
                                            { label: '1 Week', val: 7 },
                                            { label: 'Custom', val: 'custom' }
                                        ].map(preset => {
                                            const isSelected = preset.val === 'custom' ? Boolean(customDays) : (!customDays && durationDays === preset.val);
                                            return (
                                                <button
                                                    key={preset.label}
                                                    type="button"
                                                    onClick={() => {
                                                        if (preset.val === 'custom') {
                                                            setCustomDays('10');
                                                        } else {
                                                            setCustomDays('');
                                                            setDurationDays(preset.val);
                                                        }
                                                    }}
                                                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                        isSelected 
                                                            ? 'bg-orange-600 text-white shadow-sm' 
                                                            : 'bg-white border border-orange-200 text-orange-900 hover:bg-orange-100/70'
                                                    }`}
                                                >
                                                    {preset.label}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {customDays && (
                                        <div className="pt-1 flex items-center gap-2">
                                            <label className="text-xs text-orange-900 font-semibold shrink-0">Enter Custom Days:</label>
                                            <input 
                                                type="number"
                                                min="1"
                                                max="60"
                                                value={customDays}
                                                onChange={(e) => setCustomDays(e.target.value)}
                                                className="w-24 px-2.5 py-1 bg-white border border-orange-300 rounded-lg text-xs font-bold text-slate-800 outline-none focus:border-orange-500"
                                            />
                                        </div>
                                    )}

                                    <div className="pt-2 border-t border-orange-200/60 flex items-center justify-between text-[11px] text-orange-900">
                                        <span>Reinstatement Date:</span>
                                        <strong className="font-mono font-bold text-orange-800">
                                            {new Date(Date.now() + (parseInt(customDays || durationDays, 10) || 3) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </strong>
                                    </div>

                                    <p className="text-[10px] text-orange-700 leading-snug">
                                        * Portal login and Gate Scanner passage are deactivated for this duration. Historical payroll and biometric records are preserved.
                                    </p>
                                </div>
                            )}

                            {/* WARNING INFO CARD */}
                            {type === 'Warning' && (
                                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
                                    <i className="ti ti-info-circle text-blue-600 text-base shrink-0 mt-0.5" />
                                    <p className="text-[11px] leading-relaxed">
                                        <strong>Account Remains Active:</strong> Formal written memo. The employee will receive an official notification and Brevo email memo to review in their portal.
                                    </p>
                                </div>
                            )}

                            {/* TERMINATION WARNING CARD */}
                            {type === 'Termination' && (
                                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-950 space-y-1.5">
                                    <div className="flex items-center gap-1.5 font-bold text-rose-700">
                                        <i className="ti ti-alert-triangle text-base" />
                                        <span>1-to-1 Employee Archive Separation</span>
                                    </div>
                                    <p className="text-[11px] text-rose-800 leading-relaxed">
                                        The employee is immediately deactivated and moved to the <strong>Employee Archive</strong> with complete separation details. Biometric Gate Scanner access is revoked. Historical 201 records are preserved.
                                    </p>
                                </div>
                            )}
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Detailed Grounds &amp; Incident Report</label>
                                <textarea 
                                    required 
                                    rows="3" 
                                    value={reason} 
                                    onChange={(e) => setReason(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-blue-500 resize-none transition-colors"
                                    placeholder={type === 'Suspension' ? 'State grounds for suspension (e.g. repeated tardiness, security policy breach)...' : (type === 'Termination' ? 'State grounds for termination (e.g. gross misconduct, authorized cause)...' : 'Describe the policy infraction...')}
                                />
                            </div>

                            <div className="pt-2 flex justify-end gap-2 shrink-0">
                                <button 
                                    type="button" 
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button 
                                    disabled={isSubmitting}
                                    type="submit" 
                                    className={`px-5 py-2 font-bold rounded-xl text-xs shadow-sm text-white cursor-pointer transition-all flex items-center gap-2 ${
                                        type === 'Suspension' ? 'bg-orange-600 hover:bg-orange-700' :
                                        type === 'Termination' ? 'bg-rose-600 hover:bg-rose-700' :
                                        'bg-slate-900 hover:bg-black'
                                    }`}
                                >
                                    {isSubmitting ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <i className={type === 'Suspension' ? 'ti ti-lock' : (type === 'Termination' ? 'ti ti-ban' : 'ti ti-send')} />
                                            <span>{type === 'Suspension' ? 'Confirm Suspension' : (type === 'Termination' ? 'Confirm Termination' : 'Issue Warning')}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* CLEAR DISCIPLINARY RECORD MODAL */}
            {showClearModal && selectedRecordForClear && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in">
                    <div className="relative bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200">
                        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-teal-50/50">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center text-lg shadow-xs">
                                    <i className="ti ti-shield-check" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-slate-900 leading-none">Clear Disciplinary Record</h2>
                                    <p className="text-[11px] text-teal-700 font-medium mt-0.5">Remove False or Inaccurate Infraction</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => { setShowClearModal(false); setSelectedRecordForClear(null); }} 
                                className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 cursor-pointer"
                            >
                                <i className="ti ti-x text-sm" />
                            </button>
                        </div>

                        <form onSubmit={handleClearSubmit} className="p-6 space-y-4">
                            {/* Employee Avatar & Record Header */}
                            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                                <div className="flex items-center gap-3">
                                    <EmployeeAvatar
                                        companyId={selectedRecordForClear.company_id}
                                        employeeId={selectedRecordForClear.employee_id}
                                        employeeName={selectedRecordForClear.employee_name}
                                        avatarUrl={selectedRecordForClear.avatar_url}
                                        photoUrl={selectedRecordForClear.photo_url}
                                        department={selectedRecordForClear.department}
                                        size="h-10 w-10"
                                        rounded="rounded-xl"
                                    />
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 leading-tight">
                                            {selectedRecordForClear.employee_name}
                                        </p>
                                        <p className="text-[11px] text-slate-500 font-mono">
                                            {selectedRecordForClear.company_id || 'ID N/A'} • {selectedRecordForClear.department || 'Staff'}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 text-xs pt-1 border-t border-slate-200/60">
                                    <span className="font-semibold text-slate-600">Action:</span>
                                    <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-white border border-slate-200 text-slate-700">
                                        {selectedRecordForClear.type}
                                    </span>
                                    <span className="text-slate-400 text-[10px] font-mono">Issued {selectedRecordForClear.date}</span>
                                </div>

                                <div className="text-[11px] text-slate-600 bg-white p-2.5 rounded-lg border border-slate-100 leading-snug">
                                    <span className="font-bold text-slate-700 block mb-0.5">Original Allegation:</span>
                                    {selectedRecordForClear.reason}
                                </div>
                            </div>

                            {/* Impact Banner */}
                            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-950 space-y-1">
                                <div className="flex items-center gap-1.5 font-bold text-teal-800">
                                    <i className="ti ti-info-circle text-base text-teal-600" />
                                    <span>Account &amp; Access Restored</span>
                                </div>
                                <p className="text-[11px] text-teal-900 leading-relaxed">
                                    Confirming will mark this record as <strong>Cleared</strong>, restore the employee's status to <strong>Active</strong> (if suspended or terminated), re-enable biometric gate access, and send a clearance confirmation.
                                </p>
                            </div>

                            {/* Reason for Clearing */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Reason for Clearing Record <span className="text-rose-500">*</span>
                                </label>
                                <input 
                                    type="text"
                                    required
                                    value={clearReason}
                                    onChange={(e) => setClearReason(e.target.value)}
                                    placeholder="e.g. Cleared of wrongdoing, mistaken identity, complaint dismissed..."
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-teal-500 transition-colors"
                                />
                            </div>

                            {/* Investigation / Inquiry Notes */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Investigation Notes <span className="text-slate-400 font-normal">(Optional)</span>
                                </label>
                                <textarea 
                                    rows="2"
                                    value={investigationNotes}
                                    onChange={(e) => setInvestigationNotes(e.target.value)}
                                    placeholder="e.g. CCTV review findings, committee inquiry conclusion, notes..."
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-teal-500 resize-none transition-colors"
                                />
                            </div>

                            {/* Confirmation Checkbox */}
                            <div className="pt-1">
                                <label className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all cursor-pointer select-none ${
                                    isConfirmed ? 'bg-teal-50/70 border-teal-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100/60'
                                }`}>
                                    <input 
                                        type="checkbox"
                                        checked={isConfirmed}
                                        onChange={(e) => setIsConfirmed(e.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer shrink-0"
                                    />
                                    <span className="text-xs font-medium text-slate-700">
                                        I have reviewed this case and confirm clearing this record.
                                    </span>
                                </label>
                            </div>

                            <div className="pt-2 flex justify-end gap-2 shrink-0">
                                <button 
                                    type="button" 
                                    onClick={() => { setShowClearModal(false); setSelectedRecordForClear(null); setIsConfirmed(false); }}
                                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button 
                                    disabled={isClearing || !isConfirmed || !clearReason.trim()}
                                    type="submit" 
                                    className={`px-5 py-2 font-bold rounded-xl text-xs shadow-sm transition-all flex items-center gap-2 ${
                                        isConfirmed && clearReason.trim() && !isClearing
                                            ? 'text-white bg-teal-600 hover:bg-teal-700 cursor-pointer shadow-teal-700/20'
                                            : 'text-slate-400 bg-slate-100 border border-slate-200 cursor-not-allowed opacity-60'
                                    }`}
                                >
                                    {isClearing ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            <i className="ti ti-shield-check" />
                                            <span>Confirm &amp; Clear Record</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Employee Profile Modal */}
            {showProfileModal && selectedEmployeeProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
                    <div className="relative bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-6 bg-slate-900 text-white flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-4">
                                <EmployeeAvatar
                                    companyId={selectedEmployeeProfile.employee.company_id}
                                    employeeId={selectedEmployeeProfile.employee.id}
                                    employeeName={`${selectedEmployeeProfile.employee.first_name || ''} ${selectedEmployeeProfile.employee.last_name || ''}`}
                                    avatarUrl={selectedEmployeeProfile.employee.avatar_url}
                                    photoUrl={selectedEmployeeProfile.employee.photo_url}
                                    department={selectedEmployeeProfile.employee.department}
                                    size="h-16 w-16"
                                    rounded="rounded-2xl"
                                    border="border-2 border-slate-700"
                                />
                                <div>
                                    <h3 className="text-lg font-bold text-white leading-tight">
                                        {selectedEmployeeProfile.employee.first_name} {selectedEmployeeProfile.employee.last_name}
                                    </h3>
                                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                                        {selectedEmployeeProfile.employee.company_id || 'ID N/A'} • {selectedEmployeeProfile.employee.job_title || 'Staff'}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                                            {selectedEmployeeProfile.employee.department || 'Operations'}
                                        </span>
                                        {selectedEmployeeProfile.employee.is_active ? (
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                                Gate Access Allowed
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                                                Gate Access Restricted
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button 
                                onClick={() => { setShowProfileModal(false); setSelectedEmployeeProfile(null); }}
                                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
                            >
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        {/* Dossier Content & Disciplinary Lifetime History */}
                        <div className="p-6 overflow-y-auto space-y-6">
                            {/* Summary Counters */}
                            <div className="grid grid-cols-4 gap-2">
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Warnings</span>
                                    <span className="text-xl font-bold font-mono text-amber-600 tabular-nums">
                                        {selectedEmployeeProfile.infractionHistory.filter(r => r.type === 'Warning').length}
                                    </span>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Suspensions</span>
                                    <span className="text-xl font-bold font-mono text-orange-600 tabular-nums">
                                        {selectedEmployeeProfile.infractionHistory.filter(r => r.type === 'Suspension').length}
                                    </span>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cleared</span>
                                    <span className="text-xl font-bold font-mono text-teal-600 tabular-nums">
                                        {selectedEmployeeProfile.infractionHistory.filter(r => r.status === 'Overturned').length}
                                    </span>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Cases</span>
                                    <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                                        {selectedEmployeeProfile.infractionHistory.length}
                                    </span>
                                </div>
                            </div>

                            {/* Chronological Incident History */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                                    <i className="ti ti-history text-slate-500 text-sm" />
                                    <span>Personnel Compliance Records</span>
                                </h4>
                                {selectedEmployeeProfile.infractionHistory.length > 0 ? (
                                    <div className="space-y-2.5">
                                        {selectedEmployeeProfile.infractionHistory.map((inf) => (
                                            <div 
                                                key={inf.id}
                                                className={`p-3.5 rounded-xl border flex flex-col gap-1.5 ${
                                                    inf.status === 'Resolved' ? 'bg-slate-50/60 border-slate-200 opacity-80' :
                                                    inf.status === 'Overturned' ? 'bg-teal-50/40 border-teal-200' :
                                                    'bg-white border-slate-200 shadow-2xs'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                            inf.type === 'Termination' ? 'bg-rose-100 text-rose-700' :
                                                            inf.type === 'Suspension' ? 'bg-orange-100 text-orange-700' :
                                                            'bg-amber-100 text-amber-700'
                                                        }`}>
                                                            {inf.type}
                                                        </span>
                                                        <span className="text-xs font-semibold text-slate-700">
                                                            {inf.date}
                                                        </span>
                                                    </div>
                                                    <Badge 
                                                        variant={
                                                            inf.status === 'Resolved' ? 'success' :
                                                            inf.status === 'Overturned' ? 'info' :
                                                            inf.status === 'Acknowledged' ? 'default' :
                                                            'warning'
                                                        }
                                                        size="xs"
                                                    >
                                                        {inf.status === 'Overturned' ? 'Cleared' : inf.status}
                                                    </Badge>
                                                </div>
                                                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                                                    {inf.reason}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                                        <p className="text-xs font-semibold">No disciplinary violations found.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 shrink-0">
                            <button
                                onClick={() => { setShowProfileModal(false); setSelectedEmployeeProfile(null); }}
                                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-100 cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
