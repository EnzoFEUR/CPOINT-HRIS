import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWithAuth } from '../../../utils/api';

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

    const fetchData = async () => {
        try {
            const [recRes, empRes] = await Promise.all([
                fetchWithAuth('/api/disciplinary'),
                fetchWithAuth('/api/employees')
            ]);

            const recData = await recRes.json();
            const empData = await empRes.json();

            setRecords(Array.isArray(recData) ? recData : (recData?.data || []));
            if (empData.success && Array.isArray(empData.data)) {
                setEmployees(empData.data);
            } else if (Array.isArray(empData)) {
                setEmployees(empData);
            }
        } catch (err) {
            console.error("Failed to fetch data:", err);
            toast.error("Failed to load records");
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
            const user = JSON.parse(localStorage.getItem('user'));
            const payload = { employee_id: employeeId, type, severity, reason, admin_id: user?.id };

            const res = await fetchWithAuth('/api/disciplinary', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                toast.success(data.message);
                setShowModal(false);
                setEmployeeId('');
                setReason('');
                fetchData();
            } else {
                toast.error(data.error);
            }
        } catch (err) {
            toast.error('Network Error');
        }
    };

    const handleResolve = async (id) => {
        const previousRecords = [...records];
        setRecords(prev => prev.map(r => r.id === id ? { ...r, status: 'Resolved' } : r));

        try {
            const res = await fetchWithAuth(`/api/disciplinary/${id}/resolve`, { method: 'PUT' });
            const data = await res.json();
            if (data.success) {
                toast.success('Case marked as Resolved');
            } else {
                toast.error(data.error);
                setRecords(previousRecords);
            }
        } catch (err) {
            toast.error('Network Error');
            setRecords(previousRecords);
        }
    };

    const filteredRecords = records.filter(r => {
        if (filterStatus === 'All') return true;
        return r.status === filterStatus;
    });

    const activeCount = records.filter(r => r.status === 'Active').length;

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
    };

    const rowVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-red-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Case Files...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-16 font-sans">





            <div className="space-y-8">
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-md p-8 md:p-12 shadow-sm group">
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-lg flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-gavel text-2xl text-rose-400" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-rose-500/20 text-rose-300 rounded-md border border-rose-500/30">HR Compliance</span>
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">Disciplinary Logs</h1>
                            <p className="text-rose-100/70 font-medium mt-2 text-lg max-w-xl">Track violations, issue warnings, and maintain facility security records.</p>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="bg-white/10 backdrop-blur-md border border-white/20 p-5 rounded-lg flex items-center gap-4 hidden sm:flex">
                                <div className="text-right">
                                    <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Active Cases</p>
                                    <p className="text-3xl font-black text-white">{activeCount}</p>
                                </div>
                                <div className="h-14 w-14 rounded-full bg-red-500/30 flex items-center justify-center text-rose-300 border border-red-500/50">
                                    <i className={`ti ti-alert-triangle text-2xl ${activeCount > 0 ? 'animate-pulse' : ''}`} />
                                </div>
                            </div>

                            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                <button onClick={() => setShowModal(true)} className="relative flex items-center gap-3 px-8 py-5 bg-rose-500 rounded-lg shadow-sm overflow-hidden group/btn">
                                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                                    <div className="w-10 h-10 bg-white/20 rounded-md flex items-center justify-center backdrop-blur-md">
                                        <i className="ti ti-plus text-xl text-white font-bold" />
                                    </div>
                                    <span className="text-white font-black text-lg tracking-wide relative z-10">Log Infraction</span>
                                </button>
                            </motion.div>
                        </div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-2 rounded-lg shadow-sm border border-slate-100 w-max">
                    <div className="flex gap-1">
                        {['All', 'Active', 'Resolved'].map(status => (
                            <button
                                key={status}
                                onClick={() => setFilterStatus(status)}
                                className={`px-6 py-3 rounded-md text-sm font-bold transition-all ${filterStatus === status
                                        ? 'bg-slate-900 text-white shadow-md'
                                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                    }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </motion.div>

                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden">
                    <div className="overflow-x-auto overflow-y-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-8 py-6">Employee</th>
                                    <th className="px-8 py-6">Infraction Details</th>
                                    <th className="px-8 py-6 text-center">Severity</th>
                                    <th className="px-8 py-6 text-center">Status</th>
                                    <th className="px-8 py-6 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                <AnimatePresence>
                                    {filteredRecords.length > 0 ? filteredRecords.map((record) => (
                                        <motion.tr variants={rowVariants} layout key={record.id} className="hover:bg-red-50/30 transition-colors group">

                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform border border-slate-200 shadow-sm bg-red-50 flex items-center justify-center">
                                                        {record.company_id && record.employee_id ? (
                                                            <img
                                                                src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${record.company_id}/${record.employee_id}.jpg`}
                                                                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                                alt={record.employee_name}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : null}
                                                        <div
                                                            className="w-full h-full rounded-xl bg-red-50 flex items-center justify-center text-red-600 font-black text-base shadow-inner"
                                                            style={{ display: (record.company_id && record.employee_id) ? 'none' : 'flex' }}
                                                        >
                                                            {record.employee_name ? record.employee_name.charAt(0) : '?'}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-base font-black text-slate-800 group-hover:text-red-600 transition-colors">
                                                            {record.employee_name}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                                            {record.department}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-8 py-5">
                                                <p className="text-sm font-black text-slate-800">{record.type}</p>
                                                <p className="text-xs text-slate-500 mt-0.5 max-w-[250px] truncate" title={record.reason}>
                                                    {record.reason}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-bold mt-2 uppercase tracking-widest bg-slate-50 inline-block px-2 py-1 rounded-md border border-slate-100">
                                                    {record.date}
                                                </p>
                                            </td>

                                            <td className="px-8 py-5 text-center">
                                                <span className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md border flex w-max items-center gap-2 mx-auto ${record.severity === 'High' ? 'bg-red-50 text-red-600 border-red-200' :
                                                        record.severity === 'Medium' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                                                            'bg-amber-50 text-amber-600 border-amber-200'
                                                    }`}>
                                                    <span className={`w-2 h-2 rounded-full ${record.severity === 'High' ? 'bg-red-500' :
                                                            record.severity === 'Medium' ? 'bg-orange-500' :
                                                                'bg-amber-500'
                                                        }`} />
                                                    {record.severity}
                                                </span>
                                            </td>

                                            <td className="px-8 py-5 text-center">
                                                {record.status === 'Active' ? (
                                                    <span className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md bg-red-50 text-red-600 border border-red-200 shadow-sm flex w-max items-center gap-2 mx-auto animate-pulse">
                                                        Unresolved
                                                    </span>
                                                ) : (
                                                    <span className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 flex w-max items-center gap-2 mx-auto">
                                                        <i className="ti ti-check" /> Resolved
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-8 py-5 text-right">
                                                {record.status === 'Active' ? (
                                                    <button
                                                        onClick={() => handleResolve(record.id)}
                                                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 font-bold text-xs uppercase tracking-widest rounded-md hover:bg-emerald-500 hover:text-white transition-all border border-slate-200 hover:border-emerald-500 shadow-sm opacity-100 lg:opacity-50 group-hover:opacity-100 focus:opacity-100 active:scale-95"
                                                    >
                                                        <i className="ti ti-check text-lg" /> Resolve
                                                    </button>
                                                ) : (
                                                    <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">
                                                        <i className="ti ti-lock" /> Closed
                                                    </span>
                                                )}
                                            </td>
                                        </motion.tr>
                                    )) : (
                                        <motion.tr variants={rowVariants}>
                                            <td colSpan="5" className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                        <i className="ti ti-shield-check text-4xl text-emerald-400" />
                                                    </div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">Zero Incidents</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">No disciplinary records found. The facility is secure and compliant.</p>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    )}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            </div>

            {/* Record modal */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
                            onClick={() => setShowModal(false)}
                        />
                        <motion.div
                            initial={{ scale: 0.9, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 20, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-[3rem] w-full max-w-lg overflow-hidden shadow-2xl p-8"
                        >
                            <div className="flex justify-between items-center mb-8">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-2xl border border-red-100">
                                        <i className="ti ti-gavel" />
                                    </div>
                                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Log Infraction</h2>
                                </div>
                                <button onClick={() => setShowModal(false)} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200">
                                    <i className="ti ti-x text-xl" />
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">Employee</label>
                                    <select
                                        required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
                                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-slate-700 transition-all appearance-none"
                                    >
                                        <option value="">Select an employee...</option>
                                        {employees.map(emp => (
                                            <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-2">Type</label>
                                        <select
                                            value={type} onChange={(e) => setType(e.target.value)}
                                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-slate-700 transition-all appearance-none"
                                        >
                                            <option>Warning</option>
                                            <option>Suspension</option>
                                            <option>Termination</option>
                                            <option>Security Violation</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-2">Severity</label>
                                        <select
                                            value={severity} onChange={(e) => setSeverity(e.target.value)}
                                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-slate-700 transition-all appearance-none"
                                        >
                                            <option>Low</option>
                                            <option>Medium</option>
                                            <option>High</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">Detailed Reason</label>
                                    <textarea
                                        required rows="3" value={reason} onChange={(e) => setReason(e.target.value)}
                                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-slate-700 transition-all resize-none placeholder:font-medium placeholder:text-slate-400"
                                        placeholder="Describe the incident..."
                                    />
                                </div>

                                <div className="pt-4">
                                    <button type="submit" className="w-full py-4 bg-rose-500 hover:bg-red-700 text-white font-bold rounded-lg shadow-sm active:scale-95 transition-all text-lg flex justify-center items-center gap-2">
                                        <i className="ti ti-shield-lock" /> Submit Record
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

        </div>
    );
}
