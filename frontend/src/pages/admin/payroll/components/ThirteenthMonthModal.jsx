import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../../utils/api';

const peso = (value) => `₱${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const ThirteenthMonthModal = ({ onClose }) => {
    const currentYear = new Date().getFullYear();
    const [year, setYear] = useState(currentYear);
    const [search, setSearch] = useState('');

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['thirteenthMonthReport', year],
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth(`/api/payroll/13th-month-report?year=${year}`, { signal });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load the 13th month report.');
            return body;
        },
        staleTime: 15000,
        retry: false,
    });

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase();
        return (data?.employees || []).filter(r => !term || `${r.name} ${r.department || ''}`.toLowerCase().includes(term));
    }, [data, search]);

    const totals = useMemo(() => rows.reduce((acc, r) => ({
        basic: acc.basic + r.total_basic,
        owed: acc.owed + r.thirteenth_month_pay,
        paid: acc.paid + r.paid_amount,
    }), { basic: 0, owed: 0, paid: 0 }), [rows]);

    const exportCsv = () => {
        const header = ['Employee', 'Department', 'Payslips', 'Months with pay', 'Basic pay earned', '13th month pay (/12)', 'Taxable excess', 'Paid in payslip', 'Status'];
        const lines = rows.map(r => [r.name, r.department || '', r.payslips, r.months, r.total_basic.toFixed(2), r.thirteenth_month_pay.toFixed(2), r.taxable_excess.toFixed(2), r.paid_amount.toFixed(2), r.status === 'paid' ? 'Paid' : 'Not yet paid']);
        const csv = [header, ...lines].map(line => line.map(csvCell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `13th-month-${year}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div onClick={onClose} className="fixed inset-0 bg-slate-950/70" />
            <div className="relative w-full max-w-5xl bg-white rounded-t-lg sm:rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[92vh] z-10 border border-slate-200">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-800">13th Month Pay</h3>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-md bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors duration-100 border border-slate-200 cursor-pointer shrink-0">
                        <i className="ti ti-x text-base font-semibold" />
                    </button>
                </div>

                <div className="p-3.5 border-b border-slate-100 flex flex-wrap items-center gap-2 bg-white">
                    <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 px-3 bg-slate-50 border border-slate-200 rounded-md text-sm font-medium text-slate-800 outline-none focus:border-accent cursor-pointer">
                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <input maxLength={200} type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee or department..." className="h-9 flex-1 min-w-[160px] px-3.5 bg-slate-50 border border-slate-200 focus:bg-white focus:border-accent rounded-md text-sm font-medium text-slate-800 outline-none transition-colors duration-100 placeholder:text-slate-400" />
                    <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="h-9 px-3.5 bg-white hover:bg-slate-50 text-slate-700 rounded-md font-medium text-xs sm:text-sm border border-slate-200 shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        <i className="ti ti-download text-base text-slate-500" /> Export CSV
                    </button>
                </div>

                <div className="overflow-auto touch-scroll flex-1">
                    {isLoading ? (
                        <p className="p-10 text-center text-xs font-semibold text-slate-400">Loading 13th month report&hellip;</p>
                    ) : isError ? (
                        <p className="p-10 text-center text-xs font-semibold text-danger-ink">{error?.message || 'Unable to load the report.'}</p>
                    ) : rows.length === 0 ? (
                        <p className="p-10 text-center text-xs font-semibold text-slate-400">No payslips found for {year}.</p>
                    ) : (
                        <table className="w-full text-left text-xs min-w-[620px]">
                            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                                <tr>
                                    <th className="p-3">Employee</th>
                                    <th className="p-3 text-right">Payslips</th>
                                    <th className="p-3 text-right">Basic pay earned</th>
                                    <th className="p-3 text-right">13th month (&divide;12)</th>
                                    <th className="p-3 text-right">Taxable excess</th>
                                    <th className="p-3">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rows.map(r => (
                                    <tr key={r.employee_id}>
                                        <td className="p-3">
                                            <span className="font-bold text-slate-800 block">{r.name}</span>
                                            <span className="text-[10px] text-slate-400 font-semibold uppercase">{r.department || '—'}{r.position ? ` · ${r.position}` : ''}</span>
                                        </td>
                                        <td className="p-3 text-right font-mono text-slate-600">{r.payslips} <span className="text-[10px] text-slate-400">({r.months} mo)</span></td>
                                        <td className="p-3 text-right font-mono text-slate-700">{peso(r.total_basic)}</td>
                                        <td className="p-3 text-right font-mono font-bold text-ink">{peso(r.thirteenth_month_pay)}</td>
                                        <td className="p-3 text-right font-mono text-slate-500">{r.taxable_excess > 0 ? peso(r.taxable_excess) : '—'}</td>
                                        <td className="p-3">
                                            {r.status === 'paid'
                                                ? <span className="text-[10px] font-bold text-success-ink bg-success-subtle px-2 py-0.5 rounded-md">Paid {peso(r.paid_amount)}</span>
                                                : <span className="text-[10px] font-bold text-warning-ink bg-warning-subtle px-2 py-0.5 rounded-md">Not yet paid</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-50 font-bold text-slate-700">
                                <tr>
                                    <td className="p-3" colSpan={2}>Total ({rows.length} employee{rows.length === 1 ? '' : 's'})</td>
                                    <td className="p-3 text-right font-mono">{peso(totals.basic)}</td>
                                    <td className="p-3 text-right font-mono">{peso(totals.owed)}</td>
                                    <td className="p-3" />
                                    <td className="p-3 font-mono text-[11px]">Paid {peso(totals.paid)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default React.memo(ThirteenthMonthModal);