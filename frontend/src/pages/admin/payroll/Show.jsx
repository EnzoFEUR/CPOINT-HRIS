import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWithAuth } from '../../../utils/api';

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

export default function PayrollShow() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [payroll, setPayroll] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState(null);

    useEffect(() => {
        // Defensive check: Do not execute network requests for undefined or malformed IDs
        if (!id || id === 'undefined' || !isValidUUID(id)) {
            setIsLoading(false);
            setErrorMessage('Invalid or missing Payroll record ID.');
            return;
        }

        const fetchPayroll = async () => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
                const res = await fetchWithAuth(`/api/payroll/${id}`);
                const result = await res.json();

                if (!res.ok || result.error) {
                    throw new Error(result.message || result.error || 'Failed to load payslip.');
                }

                setPayroll(result.data || result);
            } catch (err) {
                console.error('[PAYROLL_SHOW] Load Error:', err);
                setErrorMessage(err.message || 'Payslip record not found.');
            } finally {
                setIsLoading(false);
            }
        };
        fetchPayroll();
    }, [id]);

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    const confirmDelete = async () => {
        if (deleteConfirmText !== 'DELETE') {
            toast.error("Please type DELETE to confirm.");
            return;
        }

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetchWithAuth(`/api/payroll/${id}`, {
                method: 'DELETE',
                body: JSON.stringify({ admin_id: user?.id })
            });
            const resultData = await res.json();
            if (res.ok && resultData.success) {
                toast.success('Payroll record deleted successfully.');
                navigate('/admin/payroll');
            } else {
                toast.error('Error deleting payroll: ' + (resultData.error || resultData.message));
            }
        } catch (err) {
            console.error('Failed to delete payroll:', err);
            toast.error('Network error deleting payroll');
        }
    };

    const handleDelete = (e) => {
        e.preventDefault();
        setIsDeleteModalOpen(true);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">Loading Payslip Document...</p>
            </div>
        );
    }

    if (errorMessage || !payroll) {
        return (
            <div className="max-w-md mx-auto my-20 p-8 bg-white rounded-2xl border border-slate-200 shadow-sm text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <i className="ti ti-file-alert text-3xl" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 tracking-tight">Record Unavailable</h3>
                <p className="text-sm text-slate-500 mt-2 mb-6">{errorMessage || 'The requested payslip could not be found or has been removed.'}</p>
                <Link to="/admin/payroll" className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-md">
                    <i className="ti ti-arrow-left" /> Back to Payroll
                </Link>
            </div>
        );
    }

    // Pre-calculate Gross Earnings to compute percentages
    const grossEarnings = Number(payroll.basic_pay || 0) + Number(payroll.overtime_pay || 0);

    // Logic to split the remarks string into itemized deductions
    const deductionItems = payroll.remarks ? payroll.remarks.split(', ') : [];
    let hasItemizedDeductions = false;
    const itemizedDeductionsElements = [];

    deductionItems.forEach((item, index) => {
        const parts = item.split(': ');
        if (parts.length === 2 && !isNaN(Number(parts[1].replace(/,/g, '')))) {
            hasItemizedDeductions = true;
            const deductionName = parts[0].trim();
            const deductionAmount = Number(parts[1].replace(/,/g, ''));

            // Calculate percentage for ALL deductions if gross earnings exist
            let percentageDisplay = null;
            if (grossEarnings > 0) {
                const percentage = ((deductionAmount / grossEarnings) * 100).toFixed(2);
                percentageDisplay = (
                    <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-md ml-2 tracking-wide uppercase">
                        {percentage}%
                    </span>
                );
            }

            itemizedDeductionsElements.push(
                <div key={index} className="flex justify-between items-center">
                    <span className="text-sm text-slate-600 font-medium flex items-center">
                        {deductionName}
                        {percentageDisplay}
                    </span>
                    <span className="text-sm font-mono font-medium text-red-600">
                        -₱{deductionAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </div>
            );
        }
    });

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            {/* Top Actions */}
            <div className="mb-6 flex justify-between items-center print:hidden">
                <Link to="/admin/payroll" className="text-slate-500 hover:text-blue-600 font-bold transition flex items-center text-sm">
                    <i className="ti ti-arrow-left mr-2 text-lg"></i> Back to Payroll
                </Link>

                <div className="flex items-center gap-3">
                    {/* Print Button */}
                    <button onClick={() => window.print()} className="px-5 py-2.5 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-900 transition flex items-center shadow-md">
                        <i className="ti ti-printer mr-2 text-lg"></i> Print Payslip
                    </button>

                    {/* Delete Button */}
                    <form onSubmit={handleDelete}>
                        <button type="submit" className="px-5 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition flex items-center shadow-md">
                            <i className="ti ti-trash mr-2 text-lg"></i> Delete Record
                        </button>
                    </form>
                </div>
            </div>

            {/* Payslip Document */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">

                {/* Header */}
                <div className="bg-slate-50 border-b border-slate-100 p-8 text-center print:bg-transparent print:border-b-2 print:border-slate-800">
                    <h1 className="text-3xl font-black text-slate-800 tracking-tight">C-Point</h1>
                    <p className="text-slate-500 text-xs uppercase tracking-widest font-bold mt-1">Human Resource Information System</p>
                    <div className="mt-6 inline-block bg-white border border-slate-200 px-6 py-2 rounded-full shadow-sm print:border-none print:shadow-none print:p-0">
                        <h2 className="text-lg font-bold text-blue-600 uppercase tracking-wide">Payslip</h2>
                    </div>
                </div>

                <div className="p-8">
                    {/* Employee & Period Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 pb-8 border-b border-slate-100">
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Employee Details</p>
                            <p className="text-xl font-bold text-slate-800">{payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown Employee'}</p>
                            <p className="text-sm text-slate-500 mt-1">Company ID: <span className="font-bold text-slate-700">{payroll.employees?.company_id || 'N/A'}</span></p>
                            <p className="text-sm text-slate-500 mt-1">Role: <span className="capitalize">{payroll.employees?.role || 'Employee'}</span></p>
                        </div>
                        <div className="md:text-right">
                            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Pay Period</p>
                            <p className="text-lg font-bold text-slate-800">
                                {dayjs(payroll.period_start).format('MMMM DD, YYYY')} - {' '}
                                {dayjs(payroll.period_end).format('MMMM DD, YYYY')}
                            </p>
                            <p className="text-sm text-slate-500 mt-2">Date Generated: {dayjs(payroll.created_at).format('MMM DD, YYYY')}</p>
                            <div className="mt-2 inline-block px-3 py-1 bg-green-100 text-green-700 rounded-md text-xs font-bold uppercase print:border print:border-green-600 print:bg-transparent">
                                Status: {payroll.status}
                            </div>
                        </div>
                    </div>

                    {/* Financial Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-8">

                        {/* Earnings Column */}
                        <div>
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-4 border-b border-slate-200 pb-2">Earnings</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-600 font-medium">Basic Pay</span>
                                    <span className="text-sm font-mono font-medium text-slate-800">₱{Number(payroll.basic_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-slate-600 font-medium">Overtime Pay</span>
                                    <span className="text-sm font-mono font-medium text-slate-800">₱{Number(payroll.overtime_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                            <div className="mt-6 pt-3 border-t border-slate-100 flex justify-between items-center">
                                <span className="text-sm font-bold text-slate-800">Gross Earnings</span>
                                <span className="text-base font-mono font-bold text-slate-800">₱{grossEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        </div>

                        {/* Deductions Column */}
                        <div>
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-4 border-b border-slate-200 pb-2">Deductions</h3>
                            <div className="space-y-3">

                                {hasItemizedDeductions ? itemizedDeductionsElements : (
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-slate-600 font-medium">Total Deductions</span>
                                        <span className="text-sm font-mono font-medium text-red-600">-₱{Number(payroll.deductions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                )}

                            </div>
                            <div className="mt-6 pt-3 border-t border-slate-100 flex justify-between items-center">
                                <span className="text-sm font-bold text-slate-800">Total Deductions</span>
                                <span className="text-base font-mono font-bold text-red-600">-₱{Number(payroll.deductions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                    </div>

                    {/* Final Net Pay */}
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 flex flex-col md:flex-row justify-between items-center print:border-2 print:border-slate-800 print:bg-transparent">
                        <div>
                            <p className="text-sm font-bold text-blue-800 uppercase tracking-wider print:text-slate-800">Net Take Home Pay</p>
                            <p className="text-xs text-blue-600 mt-1 print:text-slate-500">This is the final amount transferred to the employee.</p>
                        </div>
                        <div className="mt-4 md:mt-0">
                            <span className="text-3xl font-black font-mono text-blue-700 print:text-slate-900">
                                ₱{Number(payroll.net_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>

                    {/* Signatures (Only visible when printing) */}
                    <div className="hidden print:flex justify-between mt-16 pt-8 border-t border-slate-300">
                        <div className="text-center w-48">
                            <div className="border-b border-slate-800 h-8 mb-2"></div>
                            <p className="text-xs font-bold text-slate-800">Employer Signature</p>
                        </div>
                        <div className="text-center w-48">
                            <div className="border-b border-slate-800 h-8 mb-2"></div>
                            <p className="text-xs font-bold text-slate-800">Employee Signature</p>
                        </div>
                    </div>

                </div>
            </div>

            {/* DESTRUCTIVE DELETE MODAL */}
            <AnimatePresence>
                {isDeleteModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
                            onClick={() => setIsDeleteModalOpen(false)}
                        />
                        <motion.div
                            initial={{ scale: 0.9, y: 20, opacity: 0 }}
                            animate={{ scale: 1, y: 0, opacity: 1 }}
                            exit={{ scale: 0.9, y: 20, opacity: 0 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative bg-white rounded-[3rem] w-full max-w-md overflow-hidden shadow-2xl p-8 text-center"
                        >
                            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 border-8 border-white shadow-lg relative z-10">
                                <i className="ti ti-alert-triangle text-4xl text-red-500 animate-pulse" />
                            </div>

                            <h2 className="text-2xl font-black text-slate-800 tracking-tight mb-2">Delete Payslip?</h2>
                            <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                                You are about to permanently delete this payroll record. This cannot be undone.
                            </p>

                            <div className="bg-slate-50 rounded-2xl p-4 mb-6 border border-slate-100 text-left">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                                    Type <span className="text-red-500 select-all">DELETE</span> to confirm
                                </label>
                                <input
                                    type="text"
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    placeholder="Type DELETE here..."
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-red-500/20 focus:border-red-500 font-bold text-slate-700 transition-all text-center"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsDeleteModalOpen(false)}
                                    className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-2xl transition-colors active:scale-95"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    disabled={deleteConfirmText !== 'DELETE'}
                                    className="flex-1 py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-2xl shadow-xl shadow-red-600/30 transition-all active:scale-95"
                                >
                                    Delete Forever
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}