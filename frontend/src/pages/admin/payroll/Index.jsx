import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function PayrollIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const currentMonth = searchParams.get('month') || '';
    const currentYear = searchParams.get('year') || '';

    const [filterStatus, setFilterStatus] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const currentYearNum = new Date().getFullYear();
    const years = Array.from({ length: 3 }, (_, i) => currentYearNum - 2 + i);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

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

    const handleFilterStatusChange = (status) => {
        setFilterStatus(status);
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
        queryFn: fetchPayrolls,
        refetchOnMount: 'always',
    });

    const filteredPayrolls = payrolls.filter(p => {
        const roleStr = (p.employees?.role || '').toLowerCase();
        if (roleStr === 'admin' || roleStr === 'security') return false;

        if (filterStatus === 'All') return true;
        if (filterStatus === 'Completed') return p.status === 'Completed' || p.status === 'Paid';
        if (filterStatus === 'Pending') return p.status === 'Pending' || p.status === 'Draft';
        return p.status === filterStatus;
    });

    const totalNetDisbursed = filteredPayrolls.reduce((sum, p) => sum + (Number(p.net_pay) || 0), 0);

    const totalItems = filteredPayrolls.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedPayrolls = filteredPayrolls.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
                <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Payroll Ledger...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans">
            
            {/* HERO HEADER */}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="relative bg-slate-900 rounded-2xl p-5 sm:p-8 lg:p-10 shadow-xs sm:shadow-sm group">
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 sm:gap-8">
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-3 sm:p-4 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 shadow-inner">
                                <i className="ti ti-cash text-2xl text-emerald-400" />
                            </div>
                            <span className="px-3 sm:px-4 py-1 sm:py-1.5 text-[10px] sm:text-xs font-black tracking-widest uppercase bg-emerald-500/20 text-emerald-300 rounded-md border border-emerald-500/30">Financial Center</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight">Payroll Ledger</h1>
                        <p className="text-sm sm:text-base text-white/70 mt-1 max-w-xl">Review, audit, and distribute DOLE-compliant digital payslips to your entire workforce.</p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <Link 
                            to="/admin/payroll/statutory-settings" 
                            className="px-4 sm:px-5 py-3 sm:py-3.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center gap-2 border border-slate-700 shadow-md tap-active"
                        >
                            <i className="ti ti-adjustments-horizontal text-lg text-emerald-400" />
                            <span>Statutory Settings</span>
                        </Link>

                        <Link 
                            to="/admin/payroll/process" 
                            className="px-5 sm:px-6 py-3 sm:py-3.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 rounded-xl font-black text-xs sm:text-sm transition-all shadow-lg shadow-emerald-500/30 flex items-center gap-2 tap-active border border-emerald-400"
                        >
                            <i className="ti ti-calculator text-lg" />
                            <span>Compute Payroll</span>
                        </Link>
                    </div>
                </div>
            </motion.div>

            {/* CONTROLS: FILTER TABS & PERIOD SELECTOR */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                
                {/* FILTER STATUS TABS */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex bg-white p-1 sm:p-1.5 rounded-xl shadow-xs border border-slate-100 overflow-x-auto touch-scroll no-scrollbar w-full sm:w-max">
                    <div className="flex gap-1 min-w-max">
                        {['All', 'Completed', 'Pending'].map(status => (
                            <button
                                key={status}
                                onClick={() => handleFilterStatusChange(status)}
                                className={`px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-bold tap-active transition-all whitespace-nowrap ${
                                    filterStatus === status 
                                    ? 'bg-slate-900 text-white shadow-xs' 
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                }`}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                </motion.div>

                {/* MONTH / YEAR PICKER FORM */}
                <motion.form 
                    initial={{ opacity: 0, y: 20 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    onSubmit={handleFilterSubmit} 
                    className="flex items-center gap-2 bg-white p-1.5 rounded-xl shadow-xs border border-slate-100 shrink-0"
                >
                    <div className="pl-3 pr-1 text-slate-400">
                        <i className="ti ti-calendar-stats text-lg" />
                    </div>

                    <select 
                        name="month" 
                        defaultValue={currentMonth} 
                        className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                    >
                        <option value="">All Months</option>
                        {months.map(m => {
                            const date = new Date(2000, m - 1, 1);
                            const monthName = date.toLocaleString('default', { month: 'short' });
                            return <option key={m} value={m.toString().padStart(2, '0')}>{monthName}</option>;
                        })}
                    </select>

                    <select 
                        name="year" 
                        defaultValue={currentYear} 
                        className="bg-slate-50 border border-slate-200/80 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer"
                    >
                        <option value="">All Years</option>
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>

                    <button 
                        type="submit" 
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition-all tap-active"
                    >
                        Filter
                    </button>

                    {(currentMonth || currentYear) && (
                        <Link 
                            to="/admin/payroll" 
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-colors" 
                            title="Clear Date Filters"
                        >
                            <i className="ti ti-x text-sm font-bold" />
                        </Link>
                    )}
                </motion.form>
            </div>

            {/* TABLE CONTAINER */}
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
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : null}
                                            <div 
                                                className="w-full h-full rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-black text-sm shadow-inner"
                                                style={{ display: (payroll.employees?.company_id && payroll.employees?.id) ? 'none' : 'flex' }}
                                            >
                                                {payroll.employees?.first_name ? payroll.employees.first_name.charAt(0) : '?'}
                                            </div>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-slate-800 truncate">
                                                {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">
                                                {payroll.employees?.department || 'Staff'} &bull; {payroll.employees?.company_id || `#${payroll.employee_id.substring(0, 6)}`}
                                            </p>
                                        </div>
                                    </div>

                                    <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center gap-1 shrink-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {payroll.status || 'Completed'}
                                    </span>
                                </div>

                                {/* Body details */}
                                <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-slate-500">Pay Period</span>
                                        <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200/60">
                                            {dayjs(payroll.period_start).format('MMM DD')} &rarr; {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                                        </span>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/40 text-xs">
                                        <div>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Gross Pay</span>
                                            <p className="font-mono font-bold text-slate-700">₱{Number(payroll.basic_pay + payroll.overtime_pay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[10px] font-bold text-red-400 uppercase">Deductions</span>
                                            <p className="font-mono font-bold text-red-500">-₱{Number(payroll.deductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                                        <span className="text-xs font-black uppercase text-slate-500">Net Take-Home Pay</span>
                                        <span className="text-base font-black text-emerald-600 font-mono">
                                            ₱{Number(payroll.net_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>

                                {/* Action button */}
                                <Link 
                                    to={`/admin/payroll/${payroll.id}`}
                                    className="w-full py-2.5 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 tap-active transition-colors"
                                >
                                    <i className="ti ti-receipt-2 text-base" /> View Full Payslip
                                </Link>
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
                                <th className="px-6 lg:px-8 py-4">Employee</th>
                                <th className="px-6 lg:px-8 py-4">Pay Period</th>
                                <th className="px-6 lg:px-8 py-4">Ledger Summary</th>
                                <th className="px-6 lg:px-8 py-4 text-right">Net Pay</th>
                                <th className="px-6 lg:px-8 py-4 text-center">Status</th>
                                <th className="px-6 lg:px-8 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            <AnimatePresence>
                                {paginatedPayrolls.length > 0 ? paginatedPayrolls.map((payroll) => (
                                    <motion.tr variants={rowVariants} layout key={payroll.id} className="hover:bg-emerald-50/30 transition-colors group">
                                        
                                        {/* Employee */}
                                        <td className="px-6 lg:px-8 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 group-hover:scale-105 transition-transform border border-slate-200 shadow-xs bg-emerald-50 flex items-center justify-center">
                                                    {payroll.employees?.company_id && payroll.employees?.id ? (
                                                        <img 
                                                            src={`https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${payroll.employees.company_id}/${payroll.employees.id}.jpg`}
                                                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                            alt={payroll.employees.first_name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : null}
                                                    <div 
                                                        className="w-full h-full rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-black text-base shadow-inner"
                                                        style={{ display: (payroll.employees?.company_id && payroll.employees?.id) ? 'none' : 'flex' }}
                                                    >
                                                        {payroll.employees?.first_name ? payroll.employees.first_name.charAt(0) : '?'}
                                                    </div>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-black text-slate-800 group-hover:text-emerald-600 transition-colors">
                                                        {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                                        {payroll.employees?.department || 'Staff'} &bull; {payroll.employees?.company_id || `#${payroll.employee_id.substring(0, 6)}`}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Pay Period */}
                                        <td className="px-6 lg:px-8 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-slate-700">
                                                    {dayjs(payroll.period_start).format('MMM DD')} 
                                                    <span className="text-slate-300 mx-1">&rarr;</span> 
                                                    {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                                                </span>
                                                <span className="px-2 py-0.5 mt-1 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest w-max border border-slate-200">
                                                    15-Day Cycle
                                                </span>
                                            </div>
                                        </td>

                                        {/* Breakdown */}
                                        <td className="px-6 lg:px-8 py-4">
                                            <div className="flex flex-col gap-0.5 text-xs max-w-[180px]">
                                                <div className="flex justify-between">
                                                    <span className="text-slate-400 font-bold text-[11px]">Gross</span>
                                                    <span className="font-mono font-bold text-slate-700">₱{Number(payroll.basic_pay + payroll.overtime_pay).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-red-400 font-bold text-[11px]">Deductions</span>
                                                    <span className="font-mono font-bold text-red-500">-₱{Number(payroll.deductions).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Net Pay */}
                                        <td className="px-6 lg:px-8 py-4 text-right">
                                            <span className="text-lg font-black text-emerald-600 font-mono tracking-tight">
                                                ₱{Number(payroll.net_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </td>

                                        {/* Status */}
                                        <td className="px-6 lg:px-8 py-4 text-center">
                                            <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 flex w-max items-center gap-1.5 mx-auto">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {payroll.status || 'Completed'}
                                            </span>
                                        </td>

                                        {/* Action */}
                                        <td className="px-6 lg:px-8 py-4 text-right">
                                            <Link 
                                                to={`/admin/payroll/${payroll.id}`}
                                                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 font-bold text-xs rounded-xl shadow-xs transition-all tap-active"
                                            >
                                                <i className="ti ti-receipt-2 text-base font-bold text-emerald-600" />
                                                <span>View</span>
                                            </Link>
                                        </td>
                                    </motion.tr>
                                )) : (
                                    <motion.tr variants={rowVariants}>
                                        <td colSpan="6" className="px-8 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-slate-400">
                                                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-3">
                                                    <i className="ti ti-receipt-off text-3xl text-slate-300" />
                                                </div>
                                                <p className="text-lg font-black text-slate-800 tracking-tight">Vault Empty</p>
                                                <p className="text-xs text-slate-400 font-medium mt-0.5 max-w-sm">No payroll records found for this period. Click "Compute" to generate new payslips.</p>
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
    );
}