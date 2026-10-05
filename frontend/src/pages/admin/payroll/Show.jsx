import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';

import { HOLIDAY_LABELS, parsePayrollFinancials } from '../../../utils/payslipUtils';

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

export default function PayrollShow() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const isIdValid = Boolean(id && id !== 'undefined' && isValidUUID(id));

    const { data: payroll = null, isLoading, error: queryError } = useQuery({
        queryKey: ['payroll', id],
        queryFn: async () => {
            const res = await fetchWithAuth(`/api/payroll/${id}`);
            const result = await res.json();
            if (!res.ok || result.error) {
                throw new Error(result.message || result.error || 'Failed to load payslip.');
            }
            return result.data || result;
        },
        enabled: isIdValid,
        staleTime: 10_000,
        gcTime: 300_000,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
    });

    // Real-time synchronization: live updates if payslip is modified or deleted
    useEffect(() => {
        if (!isIdValid || !id) return;

        const channel = supabase
            .channel(`payslip-live-${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls', filter: `id=eq.${id}` }, (payload) => {
                if (payload.eventType === 'DELETE') {
                    toast.error('This payslip was deleted by an administrator.');
                    navigate('/admin/payroll');
                } else {
                    queryClient.invalidateQueries({ queryKey: ['payroll', id], refetchType: 'active' });
                }
            })
            .on('broadcast', { event: 'PAYROLL_DELETED' }, (msg) => {
                if (msg.payload?.id === id) {
                    toast.error('This payslip was deleted by an administrator.');
                    navigate('/admin/payroll');
                }
            })
            .on('broadcast', { event: 'PAYROLL_BULK_DELETED' }, (msg) => {
                if (Array.isArray(msg.payload?.ids) && msg.payload.ids.includes(id)) {
                    toast.error('This payslip was deleted by an administrator.');
                    navigate('/admin/payroll');
                }
            })
            .on('broadcast', { event: 'PAYROLL_UPDATED' }, (msg) => {
                if (msg.payload?.id === id) {
                    queryClient.invalidateQueries({ queryKey: ['payroll', id], refetchType: 'active' });
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [id, isIdValid, queryClient, navigate]);

    const errorMessage = !isIdValid ? 'Invalid or missing Payroll record ID.' : (queryError?.message || null);

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
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });
                queryClient.removeQueries({ queryKey: ['payroll', id] });
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
                <div className="w-12 h-12 border-4 border-slate-200 border-t-accent rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">Loading Payslip Document...</p>
            </div>
        );
    }

    if (errorMessage || !payroll) {
        return (
            <div className="max-w-md mx-auto my-20 p-8 bg-white rounded-lg border border-slate-200 shadow-2xs text-center">
                <div className="w-14 h-14 bg-danger-subtle text-danger-ink rounded-lg flex items-center justify-center mx-auto mb-4 border border-danger/20">
                    <i className="ti ti-file-alert text-2xl" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 tracking-tight">Record Unavailable</h3>
                <p className="text-xs text-slate-500 mt-2 mb-6">{errorMessage || 'The requested payslip could not be found or has been removed.'}</p>
                <Link to="/admin/payroll" className="inline-flex items-center gap-2 h-9 px-4 bg-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800 transition-colors duration-100 shadow-2xs">
                    <i className="ti ti-arrow-left" /> Back to Payroll
                </Link>
            </div>
        );
    }

    const {
        grossEarnings,
        holidayPay,
        paidHolidayItems,
        hasHolidayPay,
        deductionsList,
        totalDeductions,
        withholdingTax,
        netPay,
    } = parsePayrollFinancials(payroll);

    return (
        <div className="max-w-4xl mx-auto py-4 sm:py-8 px-3 sm:px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            {/* Top Actions */}
            <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 print:hidden">
                <Link to="/admin/payroll" className="text-slate-600 hover:text-slate-900 font-semibold transition-colors duration-100 flex items-center text-xs tracking-wide">
                    <i className="ti ti-arrow-left mr-1.5 text-base"></i> Back to Payroll Ledger
                </Link>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => window.print()}
                        className="h-9 px-3 sm:px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer flex-1 sm:flex-initial"
                    >
                        <i className="ti ti-printer text-sm"></i>
                        <span className="hidden sm:inline">Print / Export PDF</span>
                        <span className="sm:hidden">Print PDF</span>
                    </button>

                    <form onSubmit={handleDelete} className="flex-1 sm:flex-initial">
                        <button
                            type="submit"
                            className="w-full sm:w-auto h-9 px-3.5 bg-white hover:bg-danger-subtle text-danger-ink text-xs font-semibold rounded-md border border-danger/20 transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                            <i className="ti ti-trash text-sm"></i> Delete
                        </button>
                    </form>
                </div>
            </div>

            {/* Official Payslip Document */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden print:border-none print:shadow-none print:rounded-none">

                {/* 1. Header: Corporate Letterhead */}
                <div className="p-4 sm:p-8 bg-white border-b border-slate-200 print:bg-transparent">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6">
                        <div>
                            <div className="flex items-center gap-3">
                                <picture className="shrink-0">
                                    <source srcSet="/logo-icon-dark.webp" type="image/webp" />
                                    <img
                                        src="/logo-icon-dark.png"
                                        alt="C-Point"
                                        width="36"
                                        height="36"
                                        loading="eager"
                                        decoding="sync"
                                        className="w-9 h-9 object-contain shrink-0"
                                        onError={(e) => {
                                            e.currentTarget.onerror = null;
                                            e.currentTarget.src = '/logo-icon.png';
                                        }}
                                    />
                                </picture>
                                <div>
                                    <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none uppercase">C-POINT HRIS</h1>
                                    <p className="text-[11px] text-slate-500 font-medium tracking-wide mt-0.5">Manufacturing &amp; Human Capital Operations</p>
                                </div>
                            </div>
                        </div>

                        <div className="sm:text-right flex flex-col sm:items-end">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Confidential Document</span>
                            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5">EMPLOYEE PAYSLIP</h2>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                    #{payroll.id ? `PAY-${String(payroll.id).slice(0, 8).toUpperCase()}` : 'RECORD'}
                                </span>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase bg-surface-muted text-ink border border-line">
                                    {payroll.status || 'Released'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Pay Period & Metadata Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-3 border-b border-slate-200 bg-slate-50/70 text-xs">
                    <div className="p-3 sm:px-5 col-span-2 sm:col-span-1 border-b sm:border-b-0 sm:border-r border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Pay Period</span>
                        <span className="font-semibold text-slate-800 block text-xs break-words">
                            {dayjs(payroll.period_start).format('MMM DD, YYYY')} – {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                        </span>
                    </div>
                    <div className="p-3 sm:px-5 border-r border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Payment Date</span>
                        <span className="font-semibold text-slate-800 block text-xs">
                            {dayjs(payroll.created_at).format('MMM DD, YYYY')}
                        </span>
                    </div>
                    <div className="p-3 sm:px-5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Currency</span>
                        <span className="font-semibold text-slate-800 block text-xs font-mono">
                            PHP (₱ • Philippine Peso)
                        </span>
                    </div>
                </div>

                {/* 3. Employee Profile & Statutory Identifiers */}
                <div className="p-4 sm:p-7 border-b border-slate-200 bg-white">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-center">
                        <div className="md:col-span-6 flex items-center gap-3 sm:gap-3.5 min-w-0">
                            <EmployeeAvatar
                                employee={payroll.employees}
                                size="h-10 w-10 sm:h-12 sm:w-12 shrink-0"
                                rounded="rounded-md"
                                border="border border-slate-200"
                                shadow="shadow-2xs"
                                theme="emerald"
                            />
                            <div className="min-w-0 flex-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Employee Details</span>
                                <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug truncate">
                                    {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Employee'}
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">
                                    <span className="font-mono font-semibold text-slate-700">{payroll.employees?.company_id || 'ID N/A'}</span>
                                    {' • '}
                                    <span>{payroll.employees?.job_title || payroll.employees?.role || 'Staff'}</span>
                                    {' • '}
                                    <span className="text-slate-600">{payroll.employees?.department || 'Operations'}</span>
                                </p>
                            </div>
                        </div>

                        <div className="md:col-span-6 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 md:pl-6">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Mandatory Statutory Identifiers</span>
                            <div className="grid grid-cols-2 gap-x-3 sm:gap-x-4 gap-y-1.5 text-xs">
                                <div className="truncate">
                                    <span className="text-slate-400 text-[11px]">TIN:</span>{' '}
                                    <span className="font-mono font-semibold text-slate-700">{payroll.employees?.tin || (withholdingTax > 0 ? 'Not Provided' : 'TRAIN Exempt')}</span>
                                </div>
                                <div className="truncate">
                                    <span className="text-slate-400 text-[11px]">SSS No:</span>{' '}
                                    <span className="font-mono font-semibold text-slate-700">{payroll.employees?.sss_no || 'Recorded'}</span>
                                </div>
                                <div className="truncate">
                                    <span className="text-slate-400 text-[11px]">PhilHealth:</span>{' '}
                                    <span className="font-mono font-semibold text-slate-700">{payroll.employees?.philhealth_no || 'Recorded'}</span>
                                </div>
                                <div className="truncate">
                                    <span className="text-slate-400 text-[11px]">Pag-IBIG:</span>{' '}
                                    <span className="font-mono font-semibold text-slate-700">{payroll.employees?.pagibig_no || 'Recorded'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. Financial Ledger Table (Dual-Column Corporate Breakdown) */}
                <div className="p-4 sm:p-7">
                    {/* Holiday Pay Callout if present */}
                    {hasHolidayPay && (
                        <div className="mb-4 sm:mb-6 border border-warning/20 bg-warning-subtle/40 rounded-md p-3 sm:p-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <i className="ti ti-calendar-event text-warning-ink text-sm" />
                                    <h4 className="text-xs font-bold text-warning-ink uppercase tracking-wider">DOLE Holiday Premium Compensation Included</h4>
                                </div>
                                <span className="font-mono font-bold text-warning-ink text-xs">
                                    +₱{holidayPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div className="divide-y divide-warning/20 border-t border-warning/60 pt-1 text-xs">
                                {paidHolidayItems.map((item, idx) => (
                                    <div key={item.date || idx} className="py-1.5 flex flex-wrap sm:flex-nowrap items-center justify-between text-slate-700 gap-1">
                                        <span>
                                            <span className="font-semibold">{dayjs(item.date).format('MMM DD, YYYY')}</span> – {item.holidayName || HOLIDAY_LABELS[item.holidayType] || 'Holiday'}
                                            <span className="text-slate-400 ml-1">({item.worked ? `Worked • ${(Number(item.multiplier || 1) * 100).toFixed(0)}%` : 'Unworked • Paid'})</span>
                                        </span>
                                        <span className="font-mono font-semibold text-success-ink">
                                            ₱{Number(item.pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Dual Table Grid */}
                    <div className="border border-slate-200 rounded-md overflow-hidden">
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">

                            {/* LEFT: EARNINGS */}
                            <div className="flex flex-col justify-between">
                                <div>
                                    <div className="bg-slate-100/75 px-3.5 sm:px-4 py-2 sm:py-2.5 border-b border-slate-200 flex items-center justify-between">
                                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <i className="ti ti-cash text-slate-500 text-sm" />
                                            <span>Earnings (Gross)</span>
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Amount</span>
                                    </div>

                                    <div className="p-3.5 sm:p-4 space-y-2.5 text-xs">
                                        <div className="flex justify-between items-center py-1 border-b border-slate-100">
                                            <div>
                                                <span className="font-semibold text-slate-800 block">Basic Pay</span>
                                                <span className="text-[11px] text-slate-400">Regular Salary Cutoff Basis</span>
                                            </div>
                                            <span className="font-mono font-semibold text-slate-800 text-xs sm:text-sm">
                                                ₱{Number(payroll.basic_pay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>

                                        <div className="flex justify-between items-center py-1 border-b border-slate-100">
                                            <div>
                                                <span className="font-semibold text-slate-800 block">Overtime Pay</span>
                                                <span className="text-[11px] text-slate-400">Approved Premium Hours</span>
                                            </div>
                                            <span className={`font-mono font-semibold text-xs sm:text-sm ${Number(payroll.overtime_pay || 0) > 0 ? 'text-ink' : 'text-slate-400'}`}>
                                                {Number(payroll.overtime_pay || 0) > 0 ? '+' : ''}₱{Number(payroll.overtime_pay || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>

                                        {hasHolidayPay && (
                                            <div className="flex justify-between items-center py-1 border-b border-slate-100">
                                                <div>
                                                    <span className="font-semibold text-slate-800 block">Holiday Premium</span>
                                                    <span className="text-[11px] text-slate-400">DOLE Statutory Premium</span>
                                                </div>
                                                <span className="font-mono font-semibold text-ink text-xs sm:text-sm">
                                                    +₱{holidayPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-slate-50 px-3.5 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200 flex justify-between items-center">
                                    <span className="text-xs font-bold uppercase text-slate-700 tracking-wide">Total Gross Earnings</span>
                                    <span className="font-mono font-bold text-slate-900 text-sm sm:text-base">
                                        ₱{grossEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>

                            {/* RIGHT: DEDUCTIONS */}
                            <div className="flex flex-col justify-between">
                                <div>
                                    <div className="bg-slate-100/75 px-3.5 sm:px-4 py-2 sm:py-2.5 border-b border-slate-200 flex items-center justify-between">
                                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <i className="ti ti-receipt-tax text-slate-500 text-sm" />
                                            <span>Deductions &amp; Withholdings</span>
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Amount</span>
                                    </div>

                                    <div className="p-3.5 sm:p-4 space-y-2.5 text-xs">
                                        {deductionsList.length > 0 ? (
                                            deductionsList.map((ded, index) => {
                                                let percentageDisplay = null;
                                                if (grossEarnings > 0 && ded.amount > 0) {
                                                    const percentage = ((ded.amount / grossEarnings) * 100).toFixed(1);
                                                    percentageDisplay = (
                                                        <span className="text-[10px] font-mono text-danger-ink bg-danger-subtle px-1 py-0.2 rounded border border-danger/20 ml-1.5">
                                                            {percentage}%
                                                        </span>
                                                    );
                                                }

                                                return (
                                                    <div key={index} className="flex justify-between items-center py-1 border-b border-slate-100">
                                                        <div className="flex items-center">
                                                            <span className="font-semibold text-slate-800">{ded.name}</span>
                                                            {percentageDisplay}
                                                        </div>
                                                        <span className="font-mono font-semibold text-danger-ink text-xs sm:text-sm">
                                                            ₱{ded.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="py-4 text-center text-slate-400">
                                                No deductions recorded for this cutoff.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-slate-50 px-3.5 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200 flex justify-between items-center">
                                    <span className="text-xs font-bold uppercase text-danger-ink tracking-wide">Total Deductions</span>
                                    <span className="font-mono font-bold text-danger-ink text-sm sm:text-base">
                                        ₱{totalDeductions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* 5. Executive Net Pay Settlement Strip */}
                    <div className="mt-5 sm:mt-6 border border-slate-900 bg-slate-900 text-white rounded-md p-3.5 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3.5 shadow-2xs print:bg-transparent print:text-slate-900 print:border-2 print:border-slate-900">
                        <div className="min-w-0">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block print:text-slate-600">Net Take-Home Pay</span>
                            <div className="flex items-baseline gap-2 mt-0.5">
                                <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-white print:text-slate-900 break-words">
                                    ₱{netPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <span className="text-[10px] sm:text-xs text-slate-400 mt-1 block font-mono print:text-slate-600 break-words leading-relaxed">
                                Net Calculation: ₱{grossEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Gross) – ₱{totalDeductions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Deductions)
                            </span>
                        </div>

                        <div className="text-left md:text-right border-t md:border-t-0 pt-2.5 md:pt-0 border-slate-800 w-full md:w-auto">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block print:text-slate-700">Account Settlement</span>
                            <span className="text-xs text-slate-300 print:text-slate-700 font-medium mt-0.5 block">Official Remuneration Voucher</span>
                        </div>
                    </div>

                    {/* DOLE Compliance Note */}
                    <p className="mt-5 sm:mt-6 text-[10px] sm:text-[11px] text-slate-400 leading-relaxed border-t border-slate-200/80 pt-3 sm:pt-4">
                        <strong>DOLE Compliance Note:</strong> This statement is an official certificate of compensation prepared under Philippine Labor Standards (DOLE DO 147-15). All statutory withholdings for SSS, PhilHealth, Pag-IBIG, and Bureau of Internal Revenue (BIR) taxes are computed and remitted on behalf of the employee.
                    </p>
                </div>
            </div>

            {/* Delete confirmation modal */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={() => setIsDeleteModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-lg w-full max-w-md overflow-hidden shadow-xl p-6 text-center border border-slate-200">
                        <div className="w-12 h-12 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center mx-auto mb-4 border border-danger/20">
                            <i className="ti ti-alert-triangle text-2xl" />
                        </div>

                        <h2 className="text-lg font-bold text-slate-900 tracking-tight mb-1">Delete Payroll Record?</h2>
                        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                            This will permanently remove this payslip from compliance logs. This action cannot be undone.
                        </p>

                        <div className="bg-slate-50 rounded-md p-3.5 mb-5 border border-slate-200 text-left">
                            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                                Type <span className="text-danger-ink font-mono select-all">DELETE</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="DELETE"
                                autoCapitalize="characters"
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md outline-none focus:border-danger font-mono font-bold text-slate-800 text-sm text-center"
                            />
                        </div>

                        <div className="flex gap-2.5">
                            <button
                                onClick={() => setIsDeleteModalOpen(false)}
                                className="flex-1 h-9 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-md transition-colors duration-100 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={deleteConfirmText !== 'DELETE'}
                                className="flex-1 h-9 bg-danger hover:bg-danger-ink disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 cursor-pointer"
                            >
                                Delete Record
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}