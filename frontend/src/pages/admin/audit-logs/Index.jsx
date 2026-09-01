import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchWithAuth } from '../../../utils/api';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

export default function AuditLogsIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [filterDate, setFilterDate] = useState(searchParams.get('date') || '');
    const [filterUserId, setFilterUserId] = useState(searchParams.get('user_id') || '');
    const [searchQuery, setSearchQuery] = useState('');
    
    const [logs, setLogs] = useState([]);
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                let url = '/api/audit-logs';
                const queryParams = new URLSearchParams();
                if (filterDate) queryParams.append('date', filterDate);
                if (filterUserId) queryParams.append('user_id', filterUserId);
                if (queryParams.toString()) url += `?${queryParams.toString()}`;

                const res = await fetchWithAuth(url);
                if (res.ok) {
                    const result = await res.json();
                    const records = Array.isArray(result) ? result : (result.data || []);
                    setLogs(records);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };

        const fetchUsers = async () => {
            try {
                const res = await fetchWithAuth('/api/employees');
                if (res.ok) {
                    const result = await res.json();
                    const userRecords = Array.isArray(result) ? result : (result.data || []);
                    setUsers(userRecords);
                }
            } catch (err) {
                console.error(err);
            }
        };

        fetchLogs();
        fetchUsers();
    }, [filterDate, filterUserId]);

    const handleApplyFilters = (e) => {
        e.preventDefault();
        const params = {};
        if (filterDate) params.date = filterDate;
        if (filterUserId) params.user_id = filterUserId;
        setSearchParams(params);
        setCurrentPage(1);
    };

    const handleResetFilters = () => {
        setFilterDate('');
        setFilterUserId('');
        setSearchQuery('');
        setSearchParams({});
        setCurrentPage(1);
    };

    const filteredLogs = logs.filter(log => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            (log.action && log.action.toLowerCase().includes(q)) ||
            (log.target_type && log.target_type.toLowerCase().includes(q)) ||
            (log.subject_type && log.subject_type.toLowerCase().includes(q)) ||
            (log.details && String(log.details).toLowerCase().includes(q)) ||
            (log.description && String(log.description).toLowerCase().includes(q)) ||
            (log.target_id && String(log.target_id).toLowerCase().includes(q)) ||
            (log.user_name && log.user_name.toLowerCase().includes(q)) ||
            (log.causer?.name && log.causer.name.toLowerCase().includes(q)) ||
            (log.causer?.email && log.causer.email.toLowerCase().includes(q))
        );
    });

    const totalItems = filteredLogs.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Audit Logs...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'System', 'Audit Trail']}
                title="System Audit Trail"
                description="Immutable chronological ledger of administrative operations, security authorizations, and data modifications."
                actions={
                    <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Events:</span>
                        <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">{logs.length}</span>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">
                {/* FILTER BAR */}
                <div className="flex flex-col md:flex-row gap-2.5 sm:gap-3">
                    <div className="flex-1 bg-white p-2 sm:p-2.5 rounded-xl shadow-xs border border-slate-200 relative">
                        <i className="ti ti-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base" />
                        <input 
                            type="text" 
                            placeholder="Search actions, records, or admin operators..." 
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:bg-white focus:border-slate-500 font-medium text-slate-800 transition-colors placeholder:text-slate-400"
                        />
                    </div>

                    <form onSubmit={handleApplyFilters} className="flex flex-wrap sm:flex-nowrap bg-white p-2 rounded-xl shadow-xs border border-slate-200 w-full md:w-auto gap-2">
                        <input 
                            type="date" 
                            value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none flex-1"
                        />
                        <select 
                            value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none flex-1"
                        >
                            <option value="">All Admins / System</option>
                            {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                        </select>
                        <button type="submit" className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg transition-colors">
                            Filter
                        </button>
                        {(filterDate || filterUserId || searchQuery) && (
                            <button type="button" onClick={handleResetFilters} className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-500 rounded-lg hover:bg-slate-200 transition-colors">
                                <i className="ti ti-x" />
                            </button>
                        )}
                    </form>
                </div>

                {/* DATA TABLE */}
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                    {/* DESKTOP TABLE VIEW */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-3.5">Timestamp</th>
                                    <th className="px-6 py-3.5">Actor</th>
                                    <th className="px-6 py-3.5">Action Details</th>
                                    <th className="px-6 py-3.5 text-right">Target ID</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {paginatedLogs.length > 0 ? paginatedLogs.map((log) => {
                                    const dateObj = new Date(log.created_at);
                                    const isSystem = !log.causer_id;
                                    
                                    const actionStr = (log.event || log.action || '').toUpperCase();
                                    const targetTypeStr = log.subject_type || log.log_name || log.target_type || '';
                                    const detailsStr = log.description || log.details || '';
                                    const targetIdStr = log.subject_id || log.target_id || '';
                                    const causerIdStr = log.causer_id || log.user_id || '';
                                    const userNameStr = log.causer?.name || log.users?.first_name || 'Admin';

                                    return (
                                        <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                                            <td className="px-6 py-3.5 font-mono">
                                                <div className="flex flex-col">
                                                    <span className="text-xs text-slate-500">{dateObj.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                                                    <span className="text-sm font-semibold text-slate-900 tabular-nums">{dateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                                </div>
                                            </td>

                                            <td className="px-6 py-3.5">
                                                {isSystem ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] font-semibold uppercase tracking-wider">
                                                        <i className="ti ti-cpu text-xs" /> System
                                                    </span>
                                                ) : (
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">
                                                            {userNameStr.charAt(0)}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-xs font-semibold text-slate-900 truncate">{userNameStr}</span>
                                                            <span className="text-[10px] text-slate-400 font-mono">ID: {String(causerIdStr).substring(0,8)}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>

                                            <td className="px-6 py-3.5">
                                                <div className="flex items-center gap-2">
                                                    <Badge 
                                                        variant={
                                                            actionStr.includes('CREATED') ? 'present' :
                                                            actionStr.includes('DELETED') ? 'absent' :
                                                            'neutral'
                                                        }
                                                    >
                                                        {actionStr}
                                                    </Badge>
                                                    <span className="text-xs text-slate-400 font-medium">on</span>
                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium font-mono border border-slate-200">
                                                        {targetTypeStr}
                                                    </span>
                                                </div>
                                                {detailsStr && (
                                                    <p className="text-xs text-slate-500 mt-1 line-clamp-1 max-w-sm">{detailsStr}</p>
                                                )}
                                            </td>

                                            <td className="px-6 py-3.5 text-right">
                                                <span className="text-xs text-slate-500 font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                                    {targetIdStr ? String(targetIdStr).substring(0, 8) : 'N/A'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center text-slate-400">
                                            <p className="text-sm font-semibold text-slate-700">No Logs Found</p>
                                            <p className="text-xs mt-0.5">The system audit trail is empty for the specified parameters.</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* MOBILE CARD VIEW */}
                    <div className="md:hidden divide-y divide-slate-100">
                        {paginatedLogs.length > 0 ? paginatedLogs.map((log) => {
                            const dateObj = new Date(log.created_at);
                            const isSystem = !log.causer_id;
                            
                            const actionStr = (log.event || log.action || '').toUpperCase();
                            const targetTypeStr = log.subject_type || log.log_name || log.target_type || '';
                            const detailsStr = log.description || log.details || '';
                            const targetIdStr = log.subject_id || log.target_id || '';
                            const causerIdStr = log.causer_id || log.user_id || '';
                            const userNameStr = log.causer?.name || log.user_name || 'Admin';

                            return (
                                <div key={log.id} className="p-4 space-y-2.5 bg-white">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <Badge 
                                                variant={
                                                    actionStr.includes('CREATED') ? 'present' :
                                                    actionStr.includes('DELETED') ? 'absent' :
                                                    'neutral'
                                                }
                                            >
                                                {actionStr}
                                            </Badge>
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium font-mono border border-slate-200">
                                                {targetTypeStr}
                                            </span>
                                        </div>
                                        <span className="text-[11px] font-mono text-slate-400">
                                            {dateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>

                                    {detailsStr && (
                                        <p className="text-xs text-slate-600 font-medium line-clamp-2 leading-relaxed">
                                            {detailsStr}
                                        </p>
                                    )}

                                    <div className="flex items-center justify-between pt-1 text-xs text-slate-400 border-t border-slate-50">
                                        <div className="flex items-center gap-1.5">
                                            <i className="ti ti-user text-xs" />
                                            <span className="font-semibold text-slate-700">{isSystem ? 'System' : userNameStr}</span>
                                        </div>
                                        <span className="font-mono text-[10px] text-slate-400">
                                            {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </span>
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="p-8 text-center text-slate-400">
                                <p className="text-sm font-semibold text-slate-700">No Logs Found</p>
                                <p className="text-xs mt-0.5">The system audit trail is empty.</p>
                            </div>
                        )}
                    </div>

                    {/* PAGINATION BAR */}
                    <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-medium">
                        <div>
                            {totalItems > 0 ? (
                                <span>Showing <span className="font-semibold text-slate-900 font-mono tabular-nums">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="font-semibold text-slate-900 font-mono tabular-nums">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="font-semibold text-slate-900 font-mono tabular-nums">{totalItems}</span></span>
                            ) : (
                                <span>Showing 0 of 0</span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs flex items-center gap-1"
                            >
                                <i className="ti ti-chevron-left text-xs" /> Prev
                            </button>
                            
                            <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-900 font-mono font-medium text-xs tabular-nums">
                                {currentPage} / {totalPages}
                            </span>

                            <button 
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage >= totalPages}
                                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs flex items-center gap-1"
                            >
                                Next <i className="ti ti-chevron-right text-xs" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
