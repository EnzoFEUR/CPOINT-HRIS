import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';
import Badge from '../../../components/ui/Badge';

export default function DisciplinaryIndex() {
    const [records, setRecords] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    
    // Form State
    const [employeeId, setEmployeeId] = useState('');
    const [type, setType] = useState('Warning');
    const [severity, setSeverity] = useState('Low');
    const [reason, setReason] = useState('');
    const [durationDays, setDurationDays] = useState(3);
    const [customDays, setCustomDays] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [filterStatus, setFilterStatus] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const handleFilterChange = (status) => {
        setFilterStatus(status);
        setCurrentPage(1);
    };

    const fetchData = async () => {
        try {
            setIsLoading(true);
            const [recRes, empRes] = await Promise.all([
                fetchWithAuth('/api/disciplinary'),
                fetchWithAuth('/api/employees')
            ]);
            
            if (recRes.ok) {
                const data = await recRes.json();
                setRecords(Array.isArray(data) ? data : (data?.data || []));
            }
            if (empRes.ok) {
                const data = await empRes.json();
                const empList = Array.isArray(data) ? data : (data?.data || []);
                setEmployees(empList.filter(e => e.role !== 'admin'));
            }
        } catch (err) {
            console.error(err);
            toast.error('Failed to load disciplinary records');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
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

            if (res.ok) {
                toast.success(`${type} action logged and applied to account`);
                setShowModal(false);
                setEmployeeId('');
                setReason('');
                setType('Warning');
                setSeverity('Low');
                setDurationDays(3);
                setCustomDays('');
                fetchData();
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to log action');
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleResolve = async (id, isSuspension = false) => {
        try {
            const res = await fetchWithAuth(`/api/disciplinary/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'Resolved' })
            });

            if (res.ok) {
                toast.success(isSuspension ? 'Suspension lifted & account reinstated!' : 'Record marked as Resolved');
                fetchData();
            } else {
                toast.error('Failed to update status');
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
        }
    };

    const activeCount = records.filter(r => r.status === 'Active').length;

    const filteredRecords = records.filter(r => {
        if (filterStatus === 'All') return true;
        return r.status === filterStatus;
    });

    const totalItems = filteredRecords.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedRecords = filteredRecords.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Compliance Records...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 lg:pb-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Compliance', 'Disciplinary Logs']}
                title="Disciplinary Logs"
                description="Track security infractions, log employee policy violations, and manage formal notices."
                actions={
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-lg">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Cases:</span>
                            <span className="font-mono text-sm font-bold text-rose-600 tabular-nums">{activeCount}</span>
                        </div>
                        <button 
                            onClick={() => setShowModal(true)} 
                            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs sm:text-sm transition-colors shadow-xs flex items-center gap-1.5"
                        >
                            <i className="ti ti-plus text-base" />
                            <span>Log Infraction</span>
                        </button>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">
                <div className="flex overflow-x-auto touch-scroll no-scrollbar">
                    <div className="flex gap-1 bg-white p-1 sm:p-1.5 rounded-xl shadow-xs border border-slate-200 w-max">
                        {['All', 'Active', 'Acknowledged', 'Resolved'].map(status => (
                            <button
                                key={status}
                                onClick={() => handleFilterChange(status)}
                                className={`px-3.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                                    filterStatus === status 
                                    ? 'bg-slate-900 text-white shadow-xs' 
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table container */}
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                    {/* DESKTOP TABLE VIEW */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider font-semibold border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-3.5">Employee</th>
                                    <th className="px-6 py-3.5">Infraction Details</th>
                                    <th className="px-6 py-3.5 text-center">Severity</th>
                                    <th className="px-6 py-3.5 text-center">Status</th>
                                    <th className="px-6 py-3.5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {paginatedRecords.length > 0 ? paginatedRecords.map((record) => (
                                    <tr key={record.id} className="hover:bg-slate-50/70 transition-colors">
                                        <td className="px-6 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <EmployeeAvatar
                                                    companyId={record.company_id}
                                                    employeeId={record.employee_id}
                                                    employeeName={record.employee_name}
                                                    size="h-10 w-10"
                                                />
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-900">
                                                        {record.employee_name}
                                                    </p>
                                                    <p className="text-[11px] text-slate-400 font-mono">
                                                        {record.department || 'Operations'} • {record.company_id || 'ID N/A'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        <td className="px-6 py-3.5">
                                            <div className="flex items-center gap-2">
                                                {record.type === 'Suspension' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200">
                                                        <i className="ti ti-lock text-xs" /> Suspension
                                                    </span>
                                                ) : record.type === 'Termination' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                                        <i className="ti ti-ban text-xs" /> Termination
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                                        <i className="ti ti-alert-triangle text-xs" /> Warning
                                                    </span>
                                                )}
                                                <span className="text-[10px] font-mono text-slate-400">REF: DISC-{(record.id || '').slice(0, 6).toUpperCase()}</span>
                                            </div>
                                            <p className="text-xs text-slate-600 mt-1 max-w-sm font-medium" title={record.reason}>
                                                {record.reason}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-mono mt-1">
                                                Issued: {record.date}
                                            </p>
                                        </td>

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

                                        <td className="px-6 py-3.5 text-center">
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
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                    Resolved
                                                </span>
                                            )}
                                            {record.status === 'Under Review' && (
                                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                                    Under Review
                                                </span>
                                            )}
                                        </td>

                                        <td className="px-6 py-3.5 text-right">
                                            {record.type === 'Suspension' && record.status === 'Active' ? (
                                                <button 
                                                    onClick={() => handleResolve(record.id, true)} 
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-xs rounded-lg border border-emerald-200 transition-colors shadow-xs cursor-pointer"
                                                    title="Lift suspension and immediately reinstate employee access"
                                                >
                                                    <i className="ti ti-lock-open text-emerald-600" />
                                                    <span>Lift & Reinstate</span>
                                                </button>
                                            ) : record.status !== 'Resolved' ? (
                                                <button 
                                                    onClick={() => handleResolve(record.id, false)} 
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-700 hover:bg-emerald-50 font-semibold text-xs rounded-lg border border-emerald-200 transition-colors shadow-xs cursor-pointer"
                                                >
                                                    <i className="ti ti-check text-emerald-600" />
                                                    <span>Mark Resolved</span>
                                                </button>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-mono">
                                                    <i className="ti ti-circle-check text-slate-400" /> Closed
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-slate-400">
                                            <p className="text-sm font-semibold text-slate-700">Zero Incidents</p>
                                            <p className="text-xs mt-0.5">No disciplinary records found. The facility is fully compliant.</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* MOBILE CARDS VIEW (md:hidden) */}
                    <div className="md:hidden divide-y divide-slate-100">
                        {paginatedRecords.length > 0 ? paginatedRecords.map((record) => (
                            <div key={record.id} className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <EmployeeAvatar
                                            companyId={record.company_id}
                                            employeeId={record.employee_id}
                                            employeeName={record.employee_name}
                                            size="h-10 w-10"
                                        />
                                        <div>
                                            <p className="text-sm font-bold text-slate-900 leading-tight">
                                                {record.employee_name}
                                            </p>
                                            <p className="text-[11px] text-slate-500 font-mono">
                                                {record.department || 'Operations'} • {record.company_id || 'ID N/A'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <Badge 
                                            variant={
                                                record.severity === 'Critical' || record.severity === 'High' ? 'absent' :
                                                record.severity === 'Medium' ? 'late' : 'neutral'
                                            }
                                        >
                                            {record.severity}
                                        </Badge>
                                    </div>
                                </div>

                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            {record.type === 'Suspension' ? (
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
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                Resolved
                                            </span>
                                        )}
                                    </div>

                                    {record.type === 'Suspension' && record.status === 'Active' ? (
                                        <button 
                                            onClick={() => handleResolve(record.id, true)} 
                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1 cursor-pointer"
                                        >
                                            <i className="ti ti-lock-open text-xs" /> Lift & Reinstate
                                        </button>
                                    ) : record.status !== 'Resolved' ? (
                                        <button 
                                            onClick={() => handleResolve(record.id, false)} 
                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-xs flex items-center gap-1 cursor-pointer"
                                        >
                                            <i className="ti ti-check text-xs" /> Mark Resolved
                                        </button>
                                    ) : (
                                        <span className="text-[11px] font-mono text-slate-400">Closed</span>
                                    )}
                                </div>
                            </div>
                        )) : (
                            <div className="p-8 text-center text-slate-400">
                                <p className="text-sm font-semibold text-slate-700">Zero Incidents</p>
                                <p className="text-xs mt-0.5">No disciplinary records found.</p>
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

            {/* Record modal */}
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
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${
                                    type === 'Suspension' ? 'bg-orange-100 text-orange-600' :
                                    type === 'Termination' ? 'bg-rose-100 text-rose-600' :
                                    'bg-amber-100 text-amber-600'
                                }`}>
                                    <i className={type === 'Suspension' ? 'ti ti-lock' : (type === 'Termination' ? 'ti ti-ban' : 'ti ti-alert-triangle')} />
                                </div>
                                <h2 className="text-base font-bold text-slate-900">
                                    {type === 'Suspension' ? 'Log Account Suspension' : (type === 'Termination' ? 'Log Employment Termination' : 'Issue Disciplinary Warning')}
                                </h2>
                            </div>
                            <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 flex items-center justify-center cursor-pointer">
                                <i className="ti ti-x text-base" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Target Personnel</label>
                                <select 
                                    required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
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
                                        value={severity} onChange={(e) => setSeverity(e.target.value)}
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

                                    {/* Preset Duration Chips */}
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

                                    {/* Reinstatement date calculation preview */}
                                    <div className="pt-2 border-t border-orange-200/60 flex items-center justify-between text-[11px] text-orange-900">
                                        <span>Reinstatement Date:</span>
                                        <strong className="font-mono font-bold text-orange-800">
                                            {new Date(Date.now() + (parseInt(customDays || durationDays, 10) || 3) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </strong>
                                    </div>

                                    <p className="text-[10px] text-orange-700 leading-snug">
                                        * Portal login will be deactivated for this duration. Historical payroll and biometric records are preserved. System auto-reinstates upon expiration or HR can lift it anytime.
                                    </p>
                                </div>
                            )}

                            {/* WARNING INFO CARD */}
                            {type === 'Warning' && (
                                <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2">
                                    <i className="ti ti-info-circle text-blue-600 text-base shrink-0 mt-0.5" />
                                    <p className="text-[11px] leading-relaxed">
                                        <strong>Account Remains Active:</strong> This is a formal written memo. The employee will receive an official notification and email memo to review and acknowledge in their dashboard.
                                    </p>
                                </div>
                            )}

                            {/* TERMINATION WARNING CARD */}
                            {type === 'Termination' && (
                                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-950 space-y-1.5">
                                    <div className="flex items-center gap-1.5 font-bold text-rose-700">
                                        <i className="ti ti-alert-triangle text-base" />
                                        <span>Employment Termination (Permanent Revocation)</span>
                                    </div>
                                    <p className="text-[11px] text-rose-800 leading-relaxed">
                                        The employee's portal access will be immediately deactivated. In accordance with labor standards, the account and 201 records (payrolls, biometrics, statutory filings) are <strong>NEVER hard-deleted</strong>.
                                    </p>
                                </div>
                            )}
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Detailed Reason & Incident Report</label>
                                <textarea 
                                    required rows="3" value={reason} onChange={(e) => setReason(e.target.value)}
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
            
        </div>
    );
}
