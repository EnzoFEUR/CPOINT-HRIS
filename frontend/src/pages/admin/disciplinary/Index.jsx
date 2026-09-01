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
            const res = await fetchWithAuth('/api/disciplinary', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: employeeId,
                    type,
                    severity,
                    reason
                })
            });

            if (res.ok) {
                toast.success('Disciplinary infraction logged successfully');
                setShowModal(false);
                setEmployeeId('');
                setReason('');
                setType('Warning');
                setSeverity('Low');
                fetchData();
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to log infraction');
            }
        } catch (err) {
            console.error(err);
            toast.error('Network error');
        }
    };

    const handleResolve = async (id) => {
        try {
            const res = await fetchWithAuth(`/api/disciplinary/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'Resolved' })
            });

            if (res.ok) {
                toast.success('Infraction marked as Resolved');
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
                        {['All', 'Active', 'Resolved'].map(status => (
                            <button
                                key={status}
                                onClick={() => handleFilterChange(status)}
                                className={`px-3.5 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
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
                                                        {record.department || 'Operations'}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        <td className="px-6 py-3.5">
                                            <p className="text-sm font-semibold text-slate-900">{record.type}</p>
                                            <p className="text-xs text-slate-500 mt-0.5 max-w-sm truncate" title={record.reason}>
                                                {record.reason}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-mono mt-1">
                                                {record.date}
                                            </p>
                                        </td>

                                        <td className="px-6 py-3.5 text-center">
                                            <Badge 
                                                variant={
                                                    record.severity === 'High' ? 'absent' :
                                                    record.severity === 'Medium' ? 'late' :
                                                    'neutral'
                                                }
                                            >
                                                {record.severity}
                                            </Badge>
                                        </td>

                                        <td className="px-6 py-3.5 text-center">
                                            <Badge 
                                                variant={record.status === 'Active' ? 'absent' : 'present'}
                                            >
                                                {record.status === 'Active' ? 'Unresolved' : 'Resolved'}
                                            </Badge>
                                        </td>

                                        <td className="px-6 py-3.5 text-right">
                                            {record.status === 'Active' ? (
                                                <button 
                                                    onClick={() => handleResolve(record.id)} 
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 font-medium text-xs rounded-lg hover:bg-slate-50 border border-slate-200 transition-colors shadow-xs"
                                                >
                                                    <i className="ti ti-check text-emerald-600" /> Resolve
                                                </button>
                                            ) : (
                                                <span className="text-xs text-slate-400 font-mono">
                                                    Closed
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
                            className="absolute inset-0 bg-slate-900/50"
                            onClick={() => setShowModal(false)}
                        />
                        <div 
                            className="relative bg-white rounded-xl w-full max-w-lg overflow-hidden shadow-xl p-5 sm:p-6 border border-slate-200 z-10"
                        >
                            <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-100">
                                <h2 className="text-base font-semibold text-slate-900">Log Disciplinary Infraction</h2>
                                <button onClick={() => setShowModal(false)} className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 flex items-center justify-center">
                                    <i className="ti ti-x text-base" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">Employee</label>
                                    <select 
                                        required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                                    >
                                        <option value="">Select employee...</option>
                                        {employees.map(emp => (
                                            <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                                        ))}
                                    </select>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                                        <select 
                                            value={type} onChange={(e) => setType(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                                        >
                                            <option>Warning</option>
                                            <option>Suspension</option>
                                            <option>Termination</option>
                                            <option>Security Violation</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Severity</label>
                                        <select 
                                            value={severity} onChange={(e) => setSeverity(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-blue-500"
                                        >
                                            <option>Low</option>
                                            <option>Medium</option>
                                            <option>High</option>
                                        </select>
                                    </div>
                                </div>
                                
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">Detailed Reason</label>
                                    <textarea 
                                        required rows="3" value={reason} onChange={(e) => setReason(e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-blue-500 resize-none"
                                        placeholder="Describe the violation..."
                                    />
                                </div>

                                <div className="pt-2 flex justify-end gap-2">
                                    <button 
                                        type="button" 
                                        onClick={() => setShowModal(false)}
                                        className="px-3.5 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg text-xs hover:bg-slate-50"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit" 
                                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-lg text-xs shadow-xs"
                                    >
                                        Submit Record
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            
        </div>
    );
}
