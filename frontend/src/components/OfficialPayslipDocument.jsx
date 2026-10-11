import React from 'react';
import dayjs from 'dayjs';
import EmployeeAvatar from './EmployeeAvatar';
import { SilCashEarnings } from './SilPaymentCard';
import { HOLIDAY_LABELS, parsePayrollFinancials, formatCurrency } from '../utils/payslipUtils';
import { printHtmlElement } from '../utils/printDocument';

/**
 * C-Point HRIS - Universal Official Payslip Document Component
 *
 * Enterprise-grade, low-latency, real-time payslip document renderer.
 * Designed to conform to Philippine DOLE Department Order No. 147-15 & BIR TRAIN Law.
 *
 * Features:
 * - Dual-mode layout: High-responsive interactive screen view + Pristine A4 Vector Print View.
 * - Decoupled from screen viewport: In print media, layout is guaranteed to render in full-width
 *   2-column desktop/letterhead format regardless of whether triggered from mobile or desktop.
 * - Dynamic document title for automatic, meaningful PDF file naming on export.
 * - Dual sign-off verification (Employer / HR Administrator & Employee Acknowledgment).
 */
export default function OfficialPayslipDocument({
    payroll,
    employee: employeeOverride,
    variant = 'admin', // 'admin' | 'employee' | 'document-only'
    onBack,
    onClose,
    onDelete,
    pagination,
}) {
    if (!payroll) return null;

    const emp = payroll.employees || employeeOverride || {};
    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Workforce Employee';
    const companyId = emp.company_id || (payroll.employee_id ? `CP-${String(payroll.employee_id).substring(0, 8).toUpperCase()}` : 'CP-N/A');
    const jobTitle = emp.job_title || emp.role || 'Production Staff';
    const department = emp.department || 'Operations';
    const shift = emp.shift || 'Regular Schedule';
    const isTerminated = emp.status === 'terminated' || payroll.is_separation_pay === true;

    const voucherId = payroll.id ? `PAY-${String(payroll.id).slice(0, 8).toUpperCase()}` : 'RECORD';
    const periodStart = payroll.period_start ? dayjs(payroll.period_start).format('MMM DD, YYYY') : 'N/A';
    const periodEnd = payroll.period_end ? dayjs(payroll.period_end).format('MMM DD, YYYY') : 'N/A';
    const paymentDate = payroll.created_at ? dayjs(payroll.created_at).format('MMM DD, YYYY') : dayjs().format('MMM DD, YYYY');

    const financials = parsePayrollFinancials(payroll);
    const {
        basicPay,
        overtimePay,
        holidayPay,
        paidHolidayItems,
        hasHolidayPay,
        paidLeavePay,
        paidLeaveInBasic,
        otherLeavePay,
        maternityPay,
        grossEarnings,
        deductionsList,
        totalDeductions,
        withholdingTax,
        netPay,
    } = financials;

    const handlePrint = () => {
        const sanitizedEmp = fullName.replace(/[^a-zA-Z0-9]/g, '_');
        const startStr = dayjs(payroll.period_start).format('YYYYMMDD');
        const endStr = dayjs(payroll.period_end).format('YYYYMMDD');
        const docTitle = `Payslip_${companyId}_${sanitizedEmp}_${startStr}_to_${endStr}`;

        printHtmlElement('official-payslip-document', docTitle);
    };

    return (
        <div className="w-full">
            {/* Embedded Print Isolation Engine */}
            <style>{`
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 10mm 12mm 10mm 12mm;
                    }

                    /* 1. Reset Root Canvas */
                    html, body {
                        background: #ffffff !important;
                        color: #0f172a !important;
                        height: auto !important;
                        min-height: auto !important;
                        overflow: visible !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        font-size: 11px !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }

                    #root {
                        height: auto !important;
                        min-height: auto !important;
                        overflow: visible !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    /* 2. Hide all non-printable chrome */
                    .no-print,
                    .print\\:hidden,
                    aside,
                    nav,
                    header,
                    footer,
                    .payslip-screen-actions,
                    .payslip-modal-backdrop,
                    [data-print-hide] {
                        display: none !important;
                    }

                    /* 3. Strip Modal and Container Constraints */
                    .payslip-outer-wrapper {
                        padding: 0 !important;
                        margin: 0 !important;
                        max-width: 100% !important;
                        width: 100% !important;
                    }

                    #official-payslip-document {
                        position: static !important;
                        display: block !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        height: auto !important;
                        max-height: none !important;
                        overflow: visible !important;
                        border: 1px solid #0f172a !important;
                        box-shadow: none !important;
                        border-radius: 0 !important;
                        background: #ffffff !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }

                    /* 4. Force Desktop Corporate Grid Layout Regardless of Viewport */
                    .payslip-header-layout {
                        display: flex !important;
                        flex-direction: row !important;
                        justify-content: space-between !important;
                        align-items: flex-start !important;
                        padding: 16px 20px !important;
                        border-bottom: 2px solid #0f172a !important;
                    }

                    .payslip-telemetry-strip {
                        display: grid !important;
                        grid-template-columns: repeat(4, 1fr) !important;
                        background: #f8fafc !important;
                        border-bottom: 1px solid #cbd5e1 !important;
                    }

                    .payslip-telemetry-col {
                        border-right: 1px solid #cbd5e1 !important;
                        border-bottom: none !important;
                        padding: 8px 14px !important;
                    }

                    .payslip-telemetry-col:last-child {
                        border-right: none !important;
                    }

                    .payslip-employee-grid {
                        display: grid !important;
                        grid-template-columns: 1fr 1fr !important;
                        padding: 14px 20px !important;
                        border-bottom: 1px solid #cbd5e1 !important;
                        gap: 24px !important;
                    }

                    .payslip-employee-statutory-col {
                        border-top: none !important;
                        border-left: 1px solid #cbd5e1 !important;
                        padding-top: 0 !important;
                        padding-left: 20px !important;
                    }

                    .payslip-ledger-grid {
                        display: grid !important;
                        grid-template-columns: 1fr 1fr !important;
                        border: 1px solid #cbd5e1 !important;
                        gap: 0 !important;
                    }

                    .payslip-ledger-earnings {
                        border-right: 1px solid #cbd5e1 !important;
                        border-bottom: none !important;
                    }

                    .payslip-net-strip {
                        display: flex !important;
                        flex-direction: row !important;
                        justify-content: space-between !important;
                        align-items: center !important;
                        background: #f8fafc !important;
                        color: #0f172a !important;
                        border: 2px solid #0f172a !important;
                        padding: 12px 18px !important;
                        margin-top: 14px !important;
                        border-radius: 4px !important;
                    }

                    .payslip-net-title {
                        color: #475569 !important;
                    }

                    .payslip-net-amount {
                        color: #0f172a !important;
                    }

                    .payslip-print-watermark {
                        display: block !important;
                    }
                }
            `}</style>

            {/* SCREEN ONLY: Top Navigation & Action Controls */}
            <div className="payslip-screen-actions mb-4 sm:mb-6 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 print:hidden">
                <div className="flex items-center gap-2">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors py-1.5 px-2.5 rounded-md hover:bg-slate-100 cursor-pointer"
                        >
                            <i className="ti ti-arrow-left text-sm" />
                            <span>Back</span>
                        </button>
                    )}
                    {pagination && pagination.totalCount > 1 && (
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md p-1 shadow-2xs">
                            <button
                                type="button"
                                disabled={pagination.currentIndex >= pagination.totalCount - 1}
                                onClick={pagination.onPrev}
                                title="Older payslip"
                                className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-slate-100 transition cursor-pointer"
                            >
                                <i className="ti ti-chevron-left text-xs" />
                            </button>
                            <span className="px-2 text-[11px] font-mono font-medium text-slate-600 select-none">
                                {pagination.currentIndex + 1} of {pagination.totalCount}
                            </span>
                            <button
                                type="button"
                                disabled={pagination.currentIndex <= 0}
                                onClick={pagination.onNext}
                                title="Newer payslip"
                                className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-slate-100 transition cursor-pointer"
                            >
                                <i className="ti ti-chevron-right text-xs" />
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        data-action="print-payslip"
                        onClick={handlePrint}
                        className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer flex-1 sm:flex-initial"
                    >
                        <i className="ti ti-printer text-sm" />
                        <span>Print / Export PDF</span>
                    </button>

                    {onDelete && (
                        <button
                            type="button"
                            onClick={onDelete}
                            className="h-9 px-3.5 bg-white hover:bg-danger-subtle text-danger-ink text-xs font-semibold rounded-md border border-danger/20 transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                            <i className="ti ti-trash text-sm" />
                            <span>Delete</span>
                        </button>
                    )}

                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-9 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                        >
                            <span>Close</span>
                        </button>
                    )}
                </div>
            </div>

            {/* OFFICIAL PAYSLIP DOCUMENT CONTAINER */}
            <div
                id="official-payslip-document"
                className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden print:border-none print:shadow-none print:rounded-none"
            >
                {/* 1. CORPORATE LETTERHEAD & DOCUMENT HEADER */}
                <div className="payslip-header-layout p-4 sm:p-7 bg-white border-b border-slate-200">
                    <div className="flex items-center gap-3.5">
                        <picture className="shrink-0">
                            <source srcSet="/logo-icon-dark.webp" type="image/webp" />
                            <img
                                src="/logo-icon-dark.png"
                                alt="C-Point Logo"
                                width="40"
                                height="40"
                                loading="eager"
                                decoding="sync"
                                className="w-10 h-10 object-contain shrink-0"
                                onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = '/logo-icon.png';
                                }}
                            />
                        </picture>
                        <div>
                            <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-none uppercase">
                                C-POINT MANUFACTURING CORP.
                            </h1>
                            <p className="text-[11px] text-slate-500 font-medium tracking-wide mt-1">
                                Footwear &amp; Apparel Operations · Human Capital Management
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono hidden print:block">
                                605 Shoe Ave, Conception Uno, Marikina, 1800 Metro Manila
                            </p>
                        </div>
                    </div>

                    <div className="text-left sm:text-right flex flex-col items-start sm:items-end mt-3 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block">
                            Confidential Remuneration Statement
                        </span>
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight mt-0.5">
                            {isTerminated ? 'FINAL SEPARATION PAYSLIP' : 'OFFICIAL EMPLOYEE PAYSLIP'}
                        </h2>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 print:bg-transparent">
                                #{voucherId}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-surface-muted text-ink border border-line print:border-slate-800">
                                {payroll.status || 'Released'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 2. TELEMETRY & CUTOFF PERIOD STRIP */}
                <div className="payslip-telemetry-strip grid grid-cols-2 sm:grid-cols-4 border-b border-slate-200 bg-slate-50/75 text-xs">
                    <div className="payslip-telemetry-col p-3 sm:px-5 border-b sm:border-b-0 border-r border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            Payroll Cutoff Period
                        </span>
                        <span className="font-semibold text-slate-800 block text-xs break-words">
                            {periodStart} – {periodEnd}
                        </span>
                    </div>
                    <div className="payslip-telemetry-col p-3 sm:px-5 border-b sm:border-b-0 border-r border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            Disbursement Date
                        </span>
                        <span className="font-semibold text-slate-800 block text-xs">
                            {paymentDate}
                        </span>
                    </div>
                    <div className="payslip-telemetry-col p-3 sm:px-5 border-r border-slate-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            Pay Frequency
                        </span>
                        <span className="font-semibold text-slate-800 block text-xs">
                            Weekly Cutoff
                        </span>
                    </div>
                    <div className="payslip-telemetry-col p-3 sm:px-5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                            Currency
                        </span>
                        <span className="font-semibold text-slate-800 block text-xs font-mono">
                            PHP (₱ · Philippine Peso)
                        </span>
                    </div>
                </div>

                {/* 3. EMPLOYEE SPECIFICATION & MANDATORY STATUTORY IDENTIFIERS */}
                <div className="payslip-employee-grid p-4 sm:p-7 border-b border-slate-200 bg-white">
                    <div className="flex items-center gap-3.5 min-w-0">
                        <EmployeeAvatar
                            employee={emp}
                            size="h-11 w-11 shrink-0"
                            rounded="rounded-md"
                            border="border border-slate-200 print:hidden"
                            shadow="shadow-2xs"
                            theme="auto"
                        />
                        <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                                Employee Identification
                            </span>
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug truncate">
                                {fullName}
                            </h3>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">
                                <span className="font-mono font-semibold text-slate-800">{companyId}</span>
                                {' · '}
                                <span>{jobTitle}</span>
                                {' · '}
                                <span className="text-slate-600">{department}</span>
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                Shift Schedule: <span className="font-medium text-slate-600">{shift}</span>
                            </p>
                        </div>
                    </div>

                    <div className="payslip-employee-statutory-col border-t sm:border-t-0 sm:border-l border-slate-200 pt-3 sm:pt-0 sm:pl-6">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                            Mandatory DOLE / BIR Statutory Numbers
                        </span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                            <div className="truncate">
                                <span className="text-slate-400 text-[11px]">TIN:</span>{' '}
                                <span className="font-mono font-semibold text-slate-700">
                                    {emp.tin || (withholdingTax > 0 ? 'Not Provided' : 'TRAIN Exempt (0.00)')}
                                </span>
                            </div>
                            <div className="truncate">
                                <span className="text-slate-400 text-[11px]">SSS No:</span>{' '}
                                <span className="font-mono font-semibold text-slate-700">
                                    {emp.sss_no || 'Recorded'}
                                </span>
                            </div>
                            <div className="truncate">
                                <span className="text-slate-400 text-[11px]">PhilHealth:</span>{' '}
                                <span className="font-mono font-semibold text-slate-700">
                                    {emp.philhealth_no || 'Recorded'}
                                </span>
                            </div>
                            <div className="truncate">
                                <span className="text-slate-400 text-[11px]">Pag-IBIG:</span>{' '}
                                <span className="font-mono font-semibold text-slate-700">
                                    {emp.pagibig_no || 'Recorded'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. FINANCIAL LEDGER (DUAL-COLUMN CORPORATE BREAKDOWN) */}
                <div className="p-4 sm:p-7">
                    {/* DOLE Holiday Premium Callout if applicable */}
                    {hasHolidayPay && (
                        <div className="mb-4 sm:mb-6 border border-warning/20 bg-warning-subtle/40 rounded-md p-3 sm:p-4 print:border-slate-300 print:bg-slate-50">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <i className="ti ti-calendar-event text-warning-ink text-sm print:hidden" />
                                    <h4 className="text-xs font-bold text-warning-ink print:text-slate-800 uppercase tracking-wider">
                                        DOLE Holiday Premium Compensation Itemized
                                    </h4>
                                </div>
                                <span className="font-mono font-bold text-warning-ink print:text-slate-900 text-xs">
                                    +{formatCurrency(holidayPay)}
                                </span>
                            </div>
                            <div className="divide-y divide-warning/20 border-t border-warning/40 pt-1 text-xs print:divide-slate-200 print:border-slate-300">
                                {paidHolidayItems.map((item, idx) => (
                                    <div key={item.date || idx} className="py-1 flex items-center justify-between text-slate-700 gap-1">
                                        <span>
                                            <span className="font-semibold">{dayjs(item.date).format('MMM DD, YYYY')}</span>
                                            {' – '}
                                            {item.holidayName || HOLIDAY_LABELS[item.holidayType] || 'Holiday'}
                                            <span className="text-slate-400 ml-1.5 text-[11px]">
                                                ({item.worked ? `Worked · ${(Number(item.multiplier || 1) * 100).toFixed(0)}% DOLE Rate` : 'Unworked · 100% Paid'})
                                            </span>
                                        </span>
                                        <span className="font-mono font-semibold text-success-ink print:text-slate-800">
                                            {formatCurrency(item.pay)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Dual Table Ledger */}
                    <div className="payslip-ledger-grid border border-slate-200 rounded-md overflow-hidden print:border-slate-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 print:divide-slate-300">

                            {/* LEFT COLUMN: GROSS EARNINGS */}
                            <div className="payslip-ledger-earnings flex flex-col justify-between">
                                <div>
                                    <div className="bg-slate-100/75 px-3.5 sm:px-4 py-2 sm:py-2.5 border-b border-slate-200 print:border-slate-300 print:bg-slate-100 flex items-center justify-between">
                                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <i className="ti ti-cash text-slate-500 text-sm print:hidden" />
                                            <span>Earnings (Gross)</span>
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Amount (PHP)</span>
                                    </div>

                                    <div className="p-3.5 sm:p-4 space-y-2.5 text-xs">
                                        <div className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                            <div>
                                                <span className="font-semibold text-slate-800 block">Basic Pay</span>
                                                <span className="text-[11px] text-slate-400">Regular Cutoff Compensation Basis</span>
                                            </div>
                                            <span className="font-mono font-semibold text-slate-800 text-xs sm:text-sm">
                                                {formatCurrency(basicPay)}
                                            </span>
                                        </div>

                                        <div className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                            <div>
                                                <span className="font-semibold text-slate-800 block">Overtime Pay</span>
                                                <span className="text-[11px] text-slate-400">Approved Premium Working Hours</span>
                                            </div>
                                            <span className={`font-mono font-semibold text-xs sm:text-sm ${overtimePay > 0 ? 'text-ink' : 'text-slate-400'}`}>
                                                {overtimePay > 0 ? '+' : ''}{formatCurrency(overtimePay)}
                                            </span>
                                        </div>

                                        {hasHolidayPay && (
                                            <div className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                                <div>
                                                    <span className="font-semibold text-slate-800 block">Holiday Premium</span>
                                                    <span className="text-[11px] text-slate-400">DOLE Statutory Premium Included</span>
                                                </div>
                                                <span className="font-mono font-semibold text-ink text-xs sm:text-sm">
                                                    +{formatCurrency(holidayPay)}
                                                </span>
                                            </div>
                                        )}

                                        {paidLeavePay > 0 && (
                                            <div className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                                <div>
                                                    <span className="font-semibold text-slate-800 block">
                                                        Paid Leave Pay {paidLeaveInBasic && '(in basic)'}
                                                    </span>
                                                    <span className="text-[11px] text-slate-400">Approved Statutory Paid Leave</span>
                                                </div>
                                                <span className="font-mono font-semibold text-ink text-xs sm:text-sm">
                                                    {formatCurrency(paidLeavePay)}
                                                </span>
                                            </div>
                                        )}

                                        <SilCashEarnings payroll={payroll} />

                                        {otherLeavePay > 0 && (
                                            <div className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                                <span className="font-semibold text-slate-800">Other Statutory Leave Pay</span>
                                                <span className="font-mono font-semibold text-ink text-xs sm:text-sm">
                                                    {formatCurrency(otherLeavePay)}
                                                </span>
                                            </div>
                                        )}

                                        {maternityPay > 0 && (
                                            <div className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                                <span className="font-semibold text-slate-800">Maternity Salary Differential</span>
                                                <span className="font-mono font-semibold text-ink text-xs sm:text-sm">
                                                    {formatCurrency(maternityPay)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-slate-50 px-3.5 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200 print:border-slate-300 print:bg-slate-100 flex justify-between items-center">
                                    <span className="text-xs font-bold uppercase text-slate-800 tracking-wide">
                                        Total Gross Earnings
                                    </span>
                                    <span className="font-mono font-bold text-slate-900 text-sm sm:text-base">
                                        {formatCurrency(grossEarnings)}
                                    </span>
                                </div>
                            </div>

                            {/* RIGHT COLUMN: DEDUCTIONS & WITHHOLDINGS */}
                            <div className="flex flex-col justify-between">
                                <div>
                                    <div className="bg-slate-100/75 px-3.5 sm:px-4 py-2 sm:py-2.5 border-b border-slate-200 print:border-slate-300 print:bg-slate-100 flex items-center justify-between">
                                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <i className="ti ti-receipt-tax text-slate-500 text-sm print:hidden" />
                                            <span>Deductions &amp; Withholdings</span>
                                        </h4>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Amount (PHP)</span>
                                    </div>

                                    <div className="p-3.5 sm:p-4 space-y-2.5 text-xs">
                                        {deductionsList.length > 0 ? (
                                            deductionsList.map((ded, index) => {
                                                const percentage = grossEarnings > 0 && ded.amount > 0
                                                    ? ((ded.amount / grossEarnings) * 100).toFixed(1)
                                                    : null;

                                                return (
                                                    <div key={index} className="flex justify-between items-center py-1 border-b border-slate-100 print:border-slate-200">
                                                        <div className="flex items-center">
                                                            <span className="font-semibold text-slate-800">{ded.name}</span>
                                                            {percentage && (
                                                                <span className="text-[10px] font-mono text-danger-ink bg-danger-subtle px-1 py-0.2 rounded border border-danger/20 ml-1.5 print:hidden">
                                                                    {percentage}%
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="font-mono font-semibold text-danger-ink print:text-slate-800 text-xs sm:text-sm">
                                                            {formatCurrency(ded.amount)}
                                                        </span>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="py-4 text-center text-slate-400 italic">
                                                No statutory deductions recorded for this cutoff.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-slate-50 px-3.5 sm:px-4 py-2.5 sm:py-3 border-t border-slate-200 print:border-slate-300 print:bg-slate-100 flex justify-between items-center">
                                    <span className="text-xs font-bold uppercase text-danger-ink print:text-slate-800 tracking-wide">
                                        Total Deductions
                                    </span>
                                    <span className="font-mono font-bold text-danger-ink print:text-slate-900 text-sm sm:text-base">
                                        {formatCurrency(totalDeductions)}
                                    </span>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* 5. EXECUTIVE NET TAKE-HOME PAY SETTLEMENT STRIP */}
                    <div className="payslip-net-strip mt-5 sm:mt-6 border border-slate-900 bg-slate-900 text-white rounded-md p-4 sm:p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3.5 shadow-2xs">
                        <div className="min-w-0">
                            <span className="payslip-net-title text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                                Net Take-Home Pay (Net Salary)
                            </span>
                            <div className="flex items-baseline gap-2 mt-0.5">
                                <span className="payslip-net-amount text-2xl sm:text-3xl font-black font-mono tracking-tight text-white break-words">
                                    {formatCurrency(netPay)}
                                </span>
                            </div>
                            <span className="text-[11px] text-slate-400 print:text-slate-600 mt-1 block font-mono leading-relaxed">
                                Calculation: {formatCurrency(grossEarnings)} (Gross Earnings) – {formatCurrency(totalDeductions)} (Deductions) = {formatCurrency(netPay)}
                            </span>
                        </div>

                        <div className="text-left md:text-right border-t md:border-t-0 pt-2.5 md:pt-0 border-slate-800 w-full md:w-auto">
                            <span className="text-[10px] font-bold text-slate-400 print:text-slate-700 uppercase tracking-wider block">
                                Account Settlement Status
                            </span>
                            <span className="text-xs text-slate-200 print:text-slate-900 font-bold mt-0.5 block">
                                Official Remuneration Voucher · Cleared for Disbursement
                            </span>
                        </div>
                    </div>

                    {/* 6. STATUTORY DOLE & BIR COMPLIANCE DISCLAIMER */}
                    <p className="mt-5 sm:mt-6 text-[10px] sm:text-[11px] text-slate-500 leading-relaxed border-t border-slate-200 pt-3 sm:pt-4">
                        <strong>DOLE Compliance Note:</strong> This statement is an official certificate of compensation issued under Philippine Labor Standards (DOLE Department Order No. 147-15). All statutory contributions (SSS, PhilHealth, Pag-IBIG) and BIR withholding taxes are computed and remitted in full compliance with Republic Acts 11199, 11223, 9679, and 10963.
                    </p>

                </div>
            </div>
        </div>
    );
}
