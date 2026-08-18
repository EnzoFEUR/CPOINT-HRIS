import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function PayrollIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const currentMonth = searchParams.get('month') || '';
    const currentYear = searchParams.get('year') || '';

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
        return roleStr !== 'admin' && roleStr !== 'security';
    });

    // Premium Framer Motion Variants
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.08,
                delayChildren: 0.1
            }
        }
    };

    const rowVariants = {
        hidden: { opacity: 0, y: 15, scale: 0.99 },
        visible: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { type: 'spring', stiffness: 350, damping: 25 }
        },
        exit: {
            opacity: 0,
            height: 0,
            scale: 0.95,
            transition: { duration: 0.3, ease: 'easeInOut' }
        }
    };

    if (isLoading) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center min-h-[60vh] space-y-4"
            >
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="w-12 h-12 border-4 border-slate-200 border-t-emerald-500 rounded-full"
                />
                <motion.p
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-slate-500 font-bold tracking-widest uppercase text-sm"
                >
                    Loading Vault...
                </motion.p>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="max-w-7xl mx-auto pb-16 font-sans"
        >
            <div className="space-y-8">
                {/* Page header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="relative overflow-hidden bg-slate-900 rounded-2xl p-8 md:p-10 shadow-xl border border-slate-800 group"
                >
                    {/* Decorative ambient background glows */}
                    <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-emerald-500/15 transition-all duration-700" />
                    <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

                    <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                        <div>
                            <div className="flex items-center gap-3 mb-3">
                                <motion.div
                                    whileHover={{ rotate: 15, scale: 1.1 }}
                                    className="h-10 w-10 bg-emerald-500/10 backdrop-blur-xl rounded-xl flex items-center justify-center border border-emerald-500/20 shadow-inner"
                                >
                                    <i className="ti ti-cash-banknote text-xl text-emerald-400" />
                                </motion.div>
                                <span className="px-3.5 py-1 text-xs font-black tracking-widest uppercase bg-emerald-500/15 text-emerald-300 rounded-full border border-emerald-500/20">Financial Center</span>
                            </div>
                            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Payroll Ledger</h1>
                            <p className="text-slate-400 font-medium mt-1.5 text-base max-w-lg">Review, audit, and distribute digital payslips to your entire workforce.</p>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-3.5 flex-wrap">
                            <motion.div whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}>
                                <Link to="/admin/payroll/statutory-settings" className="flex items-center gap-2.5 px-5 py-3.5 bg-slate-800/90 hover:bg-slate-800 text-slate-200 hover:text-white rounded-xl shadow-sm border border-slate-700/80 transition-all group/btn">
                                    <div className="w-8 h-8 rounded-lg bg-slate-700/60 flex items-center justify-center group-hover/btn:bg-emerald-500/20 transition-colors">
                                        <i className="ti ti-settings text-base text-emerald-400 font-bold" />
                                    </div>
                                    <span className="font-bold text-sm tracking-wide">Statutory Settings</span>
                                </Link>
                            </motion.div>

                            <motion.div whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }}>
                                <Link to="/admin/payroll/process" className="relative flex items-center gap-2.5 px-6 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl shadow-lg shadow-emerald-900/20 overflow-hidden group/btn border border-emerald-500/30">
                                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center backdrop-blur-md relative z-10">
                                        <i className="ti ti-calculator text-base text-white font-bold" />
                                    </div>
                                    <span className="font-bold text-sm tracking-wide relative z-10">Compute Payroll</span>
                                </Link>
                            </motion.div>
                        </div>
                    </div>
                </motion.div>

                {/* FILTER BAR */}
                <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                    className="flex justify-end"
                >
                    <form onSubmit={handleFilterSubmit} className="flex items-center gap-2 bg-white p-2 rounded-lg shadow-sm border border-slate-100">
                        <div className="pl-4 pr-2 text-slate-400">
                            <i className="ti ti-calendar-stats text-xl" />
                        </div>

                        <select name="month" defaultValue={currentMonth} className="bg-slate-50 border border-slate-100 rounded-md px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-emerald-500/10 cursor-pointer appearance-none min-w-[140px]">
                            <option value="">All Months</option>
                            {months.map(m => {
                                const date = new Date(2000, m - 1, 1);
                                const monthName = date.toLocaleString('default', { month: 'long' });
                                return <option key={m} value={m.toString().padStart(2, '0')}>{monthName}</option>;
                            })}
                        </select>

                        <select name="year" defaultValue={currentYear} className="bg-slate-50 border border-slate-100 rounded-md px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-emerald-500/10 cursor-pointer appearance-none min-w-[120px]">
                            <option value="">All Years</option>
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>

                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }} type="submit" className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-md transition-all shadow-md">
                            Filter
                        </motion.button>

                        {(currentMonth || currentYear) && (
                            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                                <Link to="/admin/payroll" className="w-12 h-12 flex items-center justify-center rounded-md bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-colors ml-1" title="Clear Filters">
                                    <i className="ti ti-x text-lg font-bold" />
                                </Link>
                            </motion.div>
                        )}
                    </form>
                </motion.div>

                {/* Payroll table */}
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="bg-white rounded-md shadow-sm border border-slate-100 overflow-hidden"
                >
                    <div className="overflow-x-auto overflow-y-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-8 py-6">Employee</th>
                                    <th className="px-8 py-6">Pay Period</th>
                                    <th className="px-8 py-6">Ledger Summary</th>
                                    <th className="px-8 py-6 text-right">Net Pay</th>
                                    <th className="px-8 py-6 text-center">Status</th>
                                    <th className="px-8 py-6 text-right">Receipt</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                <AnimatePresence mode="popLayout">
                                    {filteredPayrolls.length > 0 ? filteredPayrolls.map((payroll) => (
                                        <motion.tr
                                            variants={rowVariants}
                                            initial="hidden"
                                            animate="visible"
                                            exit="exit"
                                            layout
                                            key={payroll.id}
                                            className="hover:bg-emerald-50/30 transition-colors group overflow-hidden"
                                        >
                                            <td className="px-8 py-5">
                                                <div className="flex items-center gap-4">
                                                    <motion.div
                                                        whileHover={{ scale: 1.08 }}
                                                        className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 border border-slate-200 shadow-sm bg-emerald-50 flex items-center justify-center"
                                                    >
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
                                                    </motion.div>
                                                    <div>
                                                        <p className="text-base font-black text-slate-800 group-hover:text-emerald-700 transition-colors">
                                                            {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                                                        </p>
                                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{payroll.employees?.company_id || `ID: #${payroll.employee_id.substring(0, 8)}`}</p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-8 py-5">
                                                <div className="bg-slate-50 inline-block px-3 py-1.5 rounded-lg border border-slate-100">
                                                    <p className="text-xs font-black text-slate-600">
                                                        {dayjs(payroll.period_start).format('MMM DD')} - {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                                                    </p>
                                                </div>
                                            </td>

                                            <td className="px-8 py-5">
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

                                            <td className="px-8 py-5 text-right">
                                                <span className="text-2xl font-black text-emerald-600 tracking-tight">
                                                    ₱{Number(payroll.net_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </td>

                                            <td className="px-8 py-5 text-center">
                                                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-md text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                                                    {payroll.status}
                                                </span>
                                            </td>

                                            <td className="px-8 py-5 text-right">
                                                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="inline-block">
                                                    <Link to={`/admin/payroll/${payroll.id}`}
                                                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-slate-700 font-bold text-xs uppercase tracking-widest rounded-md hover:bg-emerald-500 hover:text-white transition-all border border-slate-200 hover:border-emerald-500 shadow-sm opacity-100 lg:opacity-50 group-hover:opacity-100 focus:opacity-100">
                                                        <i className="ti ti-receipt-2 text-lg" /> View
                                                    </Link>
                                                </motion.div>
                                            </td>
                                        </motion.tr>
                                    )) : (
                                        <motion.tr variants={rowVariants} key="empty">
                                            <td colSpan="6" className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400">
                                                    <motion.div
                                                        animate={{ y: [0, -8, 0] }}
                                                        transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                                                        className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-sm"
                                                    >
                                                        <i className="ti ti-receipt-off text-4xl text-slate-300" />
                                                    </motion.div>
                                                    <p className="text-xl font-black text-slate-800 tracking-tight">Vault Empty</p>
                                                    <p className="text-sm font-medium mt-1 max-w-sm">No payroll records found for this period. Click "Compute Payroll" to generate new payslips.</p>
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
        </motion.div>
    );
}