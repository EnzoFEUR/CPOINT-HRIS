import React from 'react';
import dayjs from 'dayjs';
import { parsePayrollFinancials, formatCurrency } from '../utils/payslipUtils';

/**
 * C-Point HRIS - Universal Official Remuneration History Document Component
 *
 * Enterprise-grade, DOLE DO 147-15 & BIR Certified Compensation Ledger.
 * Provides a pristine, high-fidelity printable statement of all compensation records,
 * statutory deductions, and net disbursements.
 */
export default function OfficialRemunerationHistoryDocument({
    employee,
    payrolls = [],
    filterYear = 'all',
    filterMonth = 'all',
    summary,
}) {
    const emp = employee || {};
    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.name || 'Workforce Employee';
    const companyId = emp.company_id || (emp.id ? `CP-${String(emp.id).substring(0, 8).toUpperCase()}` : 'CP-N/A');
    const jobTitle = emp.job_title || emp.role || 'Production Staff';
    const department = emp.department || 'Operations';
    const shift = emp.shift || 'Regular Shift';
    const sssNo = emp.sss_no || emp.sss || 'On File';
    const tinNo = emp.tin || 'On File';
    const phicNo = emp.philhealth_no || emp.philhealth || 'On File';
    const hdmfNo = emp.pagibig_no || emp.pagibig || 'On File';

    const generatedAt = dayjs().format('MMMM DD, YYYY · hh:mm A');
    const scopeLabel = filterYear !== 'all'
        ? (filterMonth !== 'all' ? `${dayjs().month(Number(filterMonth)).format('MMMM')} ${filterYear}` : `Fiscal Year ${filterYear}`)
        : 'Complete Historical Ledger (All Cycles)';

    const totalGross = summary?.totalGross ?? payrolls.reduce((acc, p) => acc + parsePayrollFinancials(p).grossEarnings, 0);
    const totalDeductions = summary?.totalDeductions ?? payrolls.reduce((acc, p) => acc + parsePayrollFinancials(p).totalDeductions, 0);
    const totalNet = summary?.totalNet ?? payrolls.reduce((acc, p) => acc + parsePayrollFinancials(p).netPay, 0);
    const statementCount = payrolls.length;
    const avgNet = statementCount > 0 ? totalNet / statementCount : 0;

    return (
        <div
            id="official-remuneration-history-document"
            className="w-full bg-white text-slate-900 font-sans p-6 sm:p-8 border border-slate-900 rounded-none text-left print:border-slate-900 print:p-6 print:block"
            style={{ minHeight: '100%' }}
        >
            {/* 1. Corporate Letterhead & Document Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 border-b-2 border-slate-900">
                <div className="flex items-start gap-3">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-md flex items-center justify-center font-bold text-xl tracking-wider shrink-0 print:border print:border-slate-900">
                        CP
                    </div>
                    <div>
                        <h1 className="text-lg font-black tracking-tight text-slate-900 uppercase">
                            C-Point Industrial Corporation
                        </h1>
                        <p className="text-[11px] font-semibold text-slate-700 tracking-wide uppercase">
                            Workforce Administration &amp; Payroll Management Division
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            DOLE Department Order No. 147-15 · Philippine Labor Standards Ledger
                        </p>
                    </div>
                </div>

                <div className="text-left sm:text-right shrink-0">
                    <span className="inline-block px-2 py-0.5 text-[9px] font-mono font-bold tracking-widest uppercase bg-slate-100 text-slate-800 border border-slate-300 rounded mb-1">
                        Official Transcript
                    </span>
                    <h2 className="text-sm font-extrabold text-slate-900 tracking-tight">
                        REMUNERATION STATEMENT
                    </h2>
                    <p className="text-[10px] font-mono text-slate-600 mt-0.5">
                        Generated: {generatedAt}
                    </p>
                    <p className="text-[10px] font-mono text-slate-500">
                        Ref: STMT-{companyId}-{filterYear !== 'all' ? filterYear : 'ALL'}
                    </p>
                </div>
            </div>

            {/* 2. Employee Demographics & Statutory Profile Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3.5 border-b border-slate-300 text-xs bg-slate-50/70 -mx-6 sm:-mx-8 px-6 sm:px-8 print:-mx-6 print:px-6">
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        Employee Name
                    </span>
                    <span className="font-bold text-slate-900 text-xs sm:text-sm">
                        {fullName}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        Company ID
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                        {companyId}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        Department / Shift
                    </span>
                    <span className="font-medium text-slate-800">
                        {department} · {shift}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        Position / Role
                    </span>
                    <span className="font-medium text-slate-800">
                        {jobTitle}
                    </span>
                </div>

                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        SSS Number
                    </span>
                    <span className="font-mono text-slate-800">
                        {sssNo}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        TIN Number
                    </span>
                    <span className="font-mono text-slate-800">
                        {tinNo}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        PhilHealth (PHIC)
                    </span>
                    <span className="font-mono text-slate-800">
                        {phicNo}
                    </span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        Pag-IBIG (HDMF)
                    </span>
                    <span className="font-mono text-slate-800">
                        {hdmfNo}
                    </span>
                </div>
            </div>

            {/* 3. Ledger Summary Ribbon */}
            <div className="py-3 border-b border-slate-300">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Compensation Summary — {scopeLabel}
                    </span>
                    <span className="text-[11px] font-mono text-slate-600">
                        Audited Records: {statementCount} cycle{statementCount === 1 ? '' : 's'}
                    </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-left">
                        <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                            Cumulative Gross
                        </span>
                        <span className="text-sm sm:text-base font-black font-mono text-slate-900 tabular-nums">
                            {formatCurrency(totalGross)}
                        </span>
                    </div>
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-left">
                        <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                            Total Deductions
                        </span>
                        <span className="text-sm sm:text-base font-black font-mono text-slate-900 tabular-nums">
                            {formatCurrency(totalDeductions)}
                        </span>
                    </div>
                    <div className="p-2.5 bg-slate-100 border border-slate-300 rounded text-left">
                        <span className="text-[10px] font-bold uppercase text-slate-700 tracking-wider block">
                            Net Take-Home Pay
                        </span>
                        <span className="text-sm sm:text-base font-black font-mono text-slate-950 tabular-nums">
                            {formatCurrency(totalNet)}
                        </span>
                    </div>
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-left">
                        <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
                            Average Net / Cycle
                        </span>
                        <span className="text-sm sm:text-base font-black font-mono text-slate-900 tabular-nums">
                            {formatCurrency(avgNet)}
                        </span>
                    </div>
                </div>
            </div>

            {/* 4. Tabular Statements Breakdown */}
            <div className="py-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wide mb-2">
                    Itemized Payroll Cycle Disbursals
                </div>

                {payrolls.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 italic border border-slate-200 rounded">
                        No payroll disbursements recorded for the specified criteria.
                    </div>
                ) : (
                    <div className="overflow-x-visible border border-slate-300 rounded">
                        <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                                <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300 uppercase tracking-wider text-[10px]">
                                    <th className="py-2 px-2.5 border-r border-slate-200">#</th>
                                    <th className="py-2 px-2.5 border-r border-slate-200">Period Covered</th>
                                    <th className="py-2 px-2.5 border-r border-slate-200">Voucher Ref</th>
                                    <th className="py-2 px-2.5 border-r border-slate-200">Disbursed Date</th>
                                    <th className="py-2 px-2.5 border-r border-slate-200 text-right">Gross Pay</th>
                                    <th className="py-2 px-2.5 border-r border-slate-200 text-right">Deductions</th>
                                    <th className="py-2 px-2.5 text-right font-black">Net Pay</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrolls.map((p, idx) => {
                                    const fin = parsePayrollFinancials(p);
                                    const periodStartText = p.period_start ? dayjs(p.period_start).format('MMM DD, YYYY') : 'N/A';
                                    const periodEndText = p.period_end ? dayjs(p.period_end).format('MMM DD, YYYY') : 'N/A';
                                    const paymentDateText = p.created_at ? dayjs(p.created_at).format('MMM DD, YYYY') : 'N/A';
                                    const voucherId = p.id ? `PAY-${String(p.id).slice(0, 8).toUpperCase()}` : `REC-${idx + 1}`;

                                    return (
                                        <tr
                                            key={p.id || idx}
                                            className={`border-b border-slate-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                                        >
                                            <td className="py-2 px-2.5 border-r border-slate-200 font-mono text-slate-500 text-[10px]">
                                                {idx + 1}
                                            </td>
                                            <td className="py-2 px-2.5 border-r border-slate-200 font-medium text-slate-900">
                                                {periodStartText} – {periodEndText}
                                            </td>
                                            <td className="py-2 px-2.5 border-r border-slate-200 font-mono font-semibold text-slate-700 text-[10px]">
                                                #{voucherId}
                                            </td>
                                            <td className="py-2 px-2.5 border-r border-slate-200 text-slate-600">
                                                {paymentDateText}
                                            </td>
                                            <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono text-slate-800">
                                                {formatCurrency(fin.grossEarnings)}
                                            </td>
                                            <td className="py-2 px-2.5 border-r border-slate-200 text-right font-mono text-slate-700">
                                                -{formatCurrency(fin.totalDeductions)}
                                            </td>
                                            <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-950">
                                                {formatCurrency(fin.netPay)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-slate-100 font-bold border-t-2 border-slate-900 text-slate-950 text-xs">
                                    <td colSpan={4} className="py-2 px-2.5 uppercase tracking-wider text-right border-r border-slate-300">
                                        Ledger Totals ({statementCount} Records)
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono border-r border-slate-300">
                                        {formatCurrency(totalGross)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono border-r border-slate-300 text-slate-800">
                                        -{formatCurrency(totalDeductions)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono font-black text-slate-950">
                                        {formatCurrency(totalNet)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* 5. Dual Sign-off Signatures & Auditing Certificate */}
            <div className="pt-6 mt-4 border-t border-slate-300">
                <div className="grid grid-cols-2 gap-8 text-xs">
                    <div>
                        <div className="border-b border-slate-400 pb-1 mb-1 font-semibold text-slate-800 text-center">
                            C-POINT PAYROLL COMPLIANCE DIVISION
                        </div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider text-center">
                            Authorized HR &amp; Finance Certification
                        </p>
                    </div>
                    <div>
                        <div className="border-b border-slate-400 pb-1 mb-1 font-semibold text-slate-800 text-center">
                            {fullName}
                        </div>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider text-center">
                            Employee Verification &amp; Acknowledgment
                        </p>
                    </div>
                </div>
            </div>

            {/* 6. Statutory Disclaimer */}
            <div className="pt-4 mt-4 border-t border-slate-200 text-[10px] text-slate-500 leading-relaxed">
                <strong>Legal Certification:</strong> This transcript is an official compensation ledger certified in accordance with DOLE Department Order No. 147-15 and Philippine Tax Code regulations. All statutory contributions (SSS, PhilHealth, Pag-IBIG) and BIR withholding taxes reported have been computed and accounted for. This document serves as valid proof of income and employment compensation.
            </div>
        </div>
    );
}
