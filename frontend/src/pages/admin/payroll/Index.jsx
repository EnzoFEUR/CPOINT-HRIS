import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function PayrollIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const currentMonth = searchParams.get('month') || '';
    const currentYear = searchParams.get('year') || '';

    const currentYearNum = new Date().getFullYear();
    const years = Array.from({ length: 3 }, (_, i) => currentYearNum - 2 + i);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const [currentPage, setCurrentPage] = React.useState(1);
    const itemsPerPage = 10;

    const handleFilterSubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const month = formData.get('month');
        const year = formData.get('year');
        const params = new URLSearchParams();
        if (month) params.set('month', month);
        if (year) params.set('year', year);
        setSearchParams(params);
        setCurrentPage(1);
    };

    const fetchPayrolls = async () => {
        let endpoint = '/api/payroll';
        const queryParams = new URLSearchParams();
        if (currentMonth) queryParams.append('month', currentMonth);
        if (currentYear) queryParams.append('year', currentYear);
        
        if (queryParams.toString()) {
            endpoint += `?${queryParams.toString()}`;
        }
        
        const res = await fetchWithAuth(endpoint);
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch');
        return Array.isArray(result) ? result : (result.data || []);
    };

    const { data: payrolls = [], isLoading } = useQuery({
        queryKey: ['adminPayrolls', currentMonth, currentYear],
        queryFn: fetchPayrolls
    });

    const filteredPayrolls = payrolls.filter(p => {
        const roleStr = (p.employees?.role || '').toLowerCase();
        return roleStr !== 'admin' && roleStr !== 'security';
    });

    const totalItems = filteredPayrolls.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedPayrolls = filteredPayrolls.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // Animations
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
                <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Vault...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans">
            
            
            
            

            <div className="space-y-4 sm:space-y-6">
                
                {/* Page header */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden bg-slate-900 rounded-2xl p-5 sm:p-8 lg:p-10 shadow-xs sm:shadow-sm group">
                    
                    
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-12 w-12 bg-white/10 backdrop-blur-xl rounded-lg flex items-center justify-center border border-white/20 shadow-inner">
                                    <i className="ti ti-cash-banknote text-2xl text-emerald-400" />
                                </div>
                                <span className="px-4 py-1.5 text-xs font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-300 rounded-2xl border border-emerald-500/30">Financial Center</span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">Payroll Ledger</h1>
                            <p className="text-emerald-100/70 font-medium mt-2 text-lg max-w-xl">Review, audit, and distribute digital payslips to your entire workforce.</p>
                        </div>
                        
                        {/* Action button */}
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link to="/admin/payroll/process" className="relative flex items-center gap-3 px-8 py-5 bg-emerald-600 rounded-lg shadow-xs sm:shadow-sm overflow-hidden group/btn tap-active">
                                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                                <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md">
                                    <i className="ti ti-plus text-xl text-white font-bold" />
                                </div>
                                <span className="text-white font-black text-lg tracking-wide relative z-10">Compute Payroll</span>
                            </Link>
                        </motion.div>
                    </div>
                </motion.div>

                {/* 2. FILTER BAR */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                    <form onSubmit={handleFilterSubmit} className="flex items-center gap-2 bg-white p-2 sm:p-3 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 overflow-x-auto touch-scroll no-scrollbar">
                        <div className="pl-4 pr-2 text-slate-400">
                            <i className="ti ti-calendar-stats text-xl" />
                        </div>

                        <select name="month" defaultValue={currentMonth} className="bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-emerald-500/10 cursor-pointer appearance-none min-w-[140px]">
                            <option value="">All Months</option>
                            {months.map(m => {
                                const date = new Date(2000, m - 1, 1);
                                const monthName = date.toLocaleString('default', { month: 'long' });
                                return <option key={m} value={m.toString().padStart(2, '0')}>{monthName}</option>;
                            })}
                        </select>

                        <select name="year" defaultValue={currentYear} className="bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-emerald-500/10 cursor-pointer appearance-none min-w-[120px]">
                            <option value="">All Years</option>
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>

                        <button type="submit" className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl tap-active transition-all shadow-md">
                            Filter
                        </button>

                        {(currentMonth || currentYear) && (
                            <Link to="/admin/payroll" className="w-12 h-12 flex items-center justify-center rounded-2xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-colors ml-1 tap-active" title="Clear Filters">
                                <i className="ti ti-x text-lg font-bold" />
                            </Link>
                        )}
                    </form>
                </motion.div>

                {/* Payroll table & Mobile Cards */}
                <motion.div variants={containerVariants} initial="hidden" animate="visible" className="bg-white rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 overflow-hidden">
                    
                    {/* MOBILE CARDS VIEW (Phones) */}
                    <div className="block md:hidden divide-y divide-slate-100">
                        <AnimatePresence>
                            {paginatedPayrolls.length > 0 ? paginatedPayrolls.map((payroll) => (
                                <motion.div 
                                    variants={rowVariants} 
                                    layout 
                                    key={`mobile-${payroll.id}`} 
                                    className="p-4 space-y-3 hover:bg-emerald-50/20 transition-colors"
                                >
                                    {/* Header: Employee + Status */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="relative h-10 w-10 rounded-xl overflow-hidden shrink-0 border border-slate-200 shadow-xs bg-emerald-50 flex items-center justify-center">
                                                {payroll.employees?.company_id && payroll.employees?.id ? (
                                                    <img 
                                                        src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${payroll.employees.company_id}/${payroll.employees.id}.jpg`}
                                                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                        alt={payroll.employees?.first_name || 'Employee'}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : null}
                                                <div 
                                                    className="w-full h-full rounded-xl bg-emerald-50 flex items-center justify-center font-black text-emerald-600 text-xs shadow-inner"
                                                    style={{ display: (payroll.employees?.company_id && payroll.employees?.id) ? 'none' : 'flex' }}
                                                >
                                                    {(payroll.employees?.first_name || 'U').charAt(0)}{(payroll.employees?.last_name || 'S').charAt(0)}
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-slate-800 truncate">
                                                    {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                                    {payroll.employees?.company_id || `ID: #${payroll.employee_id.substring(0, 8)}`}
                                                </p>
                                            </div>
                                        </div>

                                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[9px] font-black uppercase tracking-wider border border-emerald-200 shrink-0">
                                            {payroll.status}
                                        </span>
                                    </div>

                                    {/* Period & Breakdown Box */}
                                    <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 space-y-2">
                                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 pb-1.5 border-b border-slate-200/60">
                                            <span>Pay Period</span>
                                            <span className="text-slate-700 font-black">
                                                {dayjs(payroll.period_start).format('MMM DD')} - {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <span className="text-[10px] text-slate-400 font-bold uppercase">Gross</span>
                                                <p className="font-mono font-bold text-slate-800">₱{Number(payroll.basic_pay + payroll.overtime_pay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                            </div>
                                            <div>
                                                <span className="text-[10px] text-slate-400 font-bold uppercase">Deductions</span>
                                                <p className="font-mono font-bold text-red-500">-₱{Number(payroll.deductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Net Pay & Action Button */}
                                    <div className="flex items-center justify-between pt-1">
                                        <div>
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Net Pay</p>
                                            <span className="text-xl font-black text-emerald-600 tracking-tight">
                                                ₱{Number(payroll.net_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>

                                        <Link 
                                            to={`/admin/payroll/${payroll.id}`} 
                                            className="px-4 py-2 bg-slate-900 text-white font-bold text-xs uppercase tracking-wider rounded-xl tap-active shadow-sm flex items-center gap-1.5"
                                        >
                                            <i className="ti ti-receipt-2 text-sm" /> View Payslip
                                        </Link>
                                    </div>
                                </motion.div>
                            )) : (
                                <div className="p-8 text-center text-slate-400">
                                    <p className="text-xs font-bold">No payroll records found for this period</p>
                                </div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* DESKTOP TABLE VIEW */}
                    <div className="hidden md:block overflow-x-auto no-scrollbar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-6 py-4">Employee</th>
                                    <th className="px-6 py-4">Pay Period</th>
                                    <th className="px-6 py-4">Ledger Summary</th>
                                    <th className="px-6 py-4 text-right">Net Pay</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-right">Receipt</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                <AnimatePresence>
                                    {paginatedPayrolls.length > 0 ? paginatedPayrolls.map((payroll) => (
                                        <motion.tr variants={rowVariants} key={payroll.id} className="hover:bg-emerald-50/30 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform border border-slate-200 shadow-xs sm:shadow-sm bg-emerald-50 flex items-center justify-center">
                                                        {payroll.employees?.company_id && payroll.employees?.id ? (
                                                            <img 
                                                                src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${payroll.employees.company_id}/${payroll.employees.id}.jpg`}
                                                                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                                alt={payroll.employees?.first_name || 'Employee'}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : null}
                                                        <div 
                                                            className="w-full h-full rounded-xl bg-emerald-50 flex items-center justify-center font-black text-emerald-600 text-base shadow-inner"
                                                            style={{ display: (payroll.employees?.company_id && payroll.employees?.id) ? 'none' : 'flex' }}
                                                        >
                                                            {(payroll.employees?.first_name || 'U').charAt(0)}{(payroll.employees?.last_name || 'S').charAt(0)}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-base font-black text-slate-800 group-hover:text-emerald-700 transition-colors">
                                                            {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{payroll.employees?.company_id || `ID: #${payroll.employee_id.substring(0, 8)}`}</p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-6 py-4">
                                                <div className="bg-slate-50 inline-block px-3 py-1.5 rounded-lg border border-slate-100">
                                                    <p className="text-xs font-black text-slate-600">
                                                        {dayjs(payroll.period_start).format('MMM DD')} - {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                                                    </p>
                                                </div>
                                            </td>

                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 text-xs">
                                                    <div className="flex justify-between max-w-[200px]">
                                                        <span className="text-slate-500 font-bold">Earnings</span>
                                                        <span className="font-mono font-bold text-slate-800">₱{Number(payroll.basic_pay + payroll.overtime_pay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                    </div>
                                                    <div className="flex justify-between max-w-[200px]">
                                                        <span className="text-slate-500 font-bold">Deductions</span>
                                                        <span className="font-mono font-bold text-red-500">-₱{Number(payroll.deductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 text-right">
                                                <span className="text-2xl font-black text-emerald-600 tracking-tight">
                                                    ₱{Number(payroll.net_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </td>

                                            <td className="px-6 py-4 text-center">
                                                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                                                    {payroll.status}
                                                </span>
                                            </td>

                                            <td className="px-6 py-4 text-right">
                                                <Link to={`/admin/payroll/${payroll.id}`} 
                                                   className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 font-bold text-xs uppercase tracking-widest rounded-2xl hover:bg-emerald-500 hover:text-white transition-all border border-slate-200 hover:border-emerald-500 shadow-xs sm:shadow-sm opacity-100 lg:opacity-50 group-hover:opacity-100 focus:opacity-100 tap-active">
                                                    <i className="ti ti-receipt-2 text-lg" /> View
                                                </Link>
                                            </td>
                                        </motion.tr>
                                    )) : (
                                        <motion.tr variants={rowVariants}>
                                            <td colSpan="6" className="px-6 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4">
                                                        <i className="ti ti-receipt-off text-4xl text-slate-300" />
                                                    </div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">Vault Empty</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">No payroll records found for this period. Click "Run Payroll" to generate new payslips.</p>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    )}
                                </AnimatePresence>
                            </tbody>
                        </table>
                    </div>

                    {/* PAGINATION BAR */}
                    <div className="px-4 sm:px-8 py-4 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-bold">
                        <div>
                            {totalItems > 0 ? (
                                <span>Showing <span className="text-slate-800 font-black">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-black">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-black">{totalItems}</span></span>
                            ) : (
                                <span>Showing <span className="text-slate-800 font-black">0</span> of <span className="text-slate-800 font-black">0</span></span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                            >
                                <i className="ti ti-chevron-left text-sm" /> Prev
                            </button>
                            
                            <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-slate-800 font-black text-xs">
                                {currentPage} / {totalPages}
                            </span>

                            <button 
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage >= totalPages}
                                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                            >
                                Next <i className="ti ti-chevron-right text-sm" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
