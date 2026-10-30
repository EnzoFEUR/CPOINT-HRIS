import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../utils/api';
import { formatCurrency } from '../utils/payslipUtils';
import { printHtmlElement } from '../utils/printDocument';

export function RetirementPayStatement({ record }) {
    const employee = record.employee_snapshot;
    const calculation = record.calculation;
    const paid = record.status === 'paid';
    return (
        <article id={'retirement-statement-' + record.id} className="space-y-4 rounded-md border border-slate-200 bg-white p-4 text-xs text-slate-700 [overflow-wrap:anywhere]">
            <header className="border-b border-slate-200 pb-3">
                <p className="font-semibold text-slate-500">C-Point HRIS · Final Pay</p>
                <h3 className="text-base font-bold text-slate-900">Retirement Pay Statement</h3>
                <p className="mt-1 font-semibold">{paid ? 'Payment recorded' : 'Approved — awaiting payment'}</p>
                <p className="mt-1">Statement ID: {record.id}</p>
            </header>
            <dl className="grid grid-cols-2 gap-3">
                <div><dt className="text-slate-500">Employee</dt><dd className="font-semibold">{employee.first_name} {employee.last_name}</dd></div>
                <div><dt className="text-slate-500">Employee number</dt><dd>{employee.company_id || 'Not recorded'}</dd></div>
                <div><dt className="text-slate-500">Department</dt><dd>{employee.department || 'Not recorded'}</dd></div>
                <div><dt className="text-slate-500">Retirement date</dt><dd>{record.retirement_date}</dd></div>
                <div><dt className="text-slate-500">Employment start</dt><dd>{record.employment_start}</dd></div>
                <div><dt className="text-slate-500">Completed / credited service</dt><dd>{calculation.service_years} / {calculation.credited_years} years</dd></div>
            </dl>
            <div>
                <p className="mb-2 font-semibold">Verified daily wage basis: {formatCurrency(calculation.daily_rate)}</p>
                <table className="w-full text-left">
                    <caption className="pb-2 text-left font-semibold">Retirement formula components</caption>
                    <thead><tr className="border-b border-slate-200"><th scope="col" className="py-2">Component</th><th scope="col" className="py-2 text-right">Amount</th></tr></thead>
                    <tbody>
                        {[
                            ['15-day salary component', calculation.components.basic],
                            ['5-day SIL component', calculation.components.sil],
                            ['2.5-day 13th-month component', calculation.components.thirteenth],
                            ['Centavo rounding adjustment', calculation.components.rounding_adjustment],
                            ['Approved gross retirement pay', calculation.statutory_gross],
                            ...(paid ? [['Tax withheld', record.tax_withheld], ['Net payment recorded', record.net_paid]] : []),
                        ].map(([label, amount]) => <tr key={label} className="border-b border-slate-100"><th scope="row" className="py-2 font-medium">{label}</th><td className="py-2 text-right font-mono tabular-nums">{formatCurrency(amount)}</td></tr>)}
                    </tbody>
                </table>
                <p className="mt-2 text-slate-500">These components form the retirement benefit; they are not additional salary or leave payouts.</p>
            </div>
            {paid ? <dl className="grid grid-cols-2 gap-3">
                <div><dt className="text-slate-500">Payment date</dt><dd>{record.payment_date}</dd></div>
                <div><dt className="text-slate-500">Payment reference</dt><dd>{record.payment_reference}</dd></div>
            </dl> : <p role="status" className="rounded-md bg-amber-50 p-3 text-amber-900">This approved calculation is not a payment receipt. Net pay and tax withheld will appear after HR records the actual payment.</p>}
            <p className="border-t border-slate-200 pt-3 text-slate-500">This settlement is not included in regular payroll totals. It is one component of final pay; other final-pay items are handled separately.</p>
        </article>
    );
}

export default function EmployeeRetirementStatements({ employeeId }) {
    const [page, setPage] = useState(1);
    const statements = useQuery({
        queryKey: ['employeeRetirementStatements', employeeId, page],
        enabled: Boolean(employeeId),
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth('/api/retirement-pay/my-statements?page=' + page, { signal });
            const result = await response.json();
            if (!response.ok || !Array.isArray(result.data)) throw Object.assign(new Error('Retirement statements could not refresh.'), { status: response.status });
            return result;
        },
        staleTime: 15_000,
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (count, error) => count < 1 && ![400, 401, 403, 404].includes(error.status),
    });
    const rows = statements.data?.data || [];
    return (
        <section aria-labelledby="employee-retirement-statements-heading" className="space-y-3 border-b border-slate-200 pb-4 mb-4">
            <div>
                <h3 id="employee-retirement-statements-heading" className="text-sm font-bold text-slate-900">Retirement Pay / Final Settlement</h3>
                <p className="mt-1 text-xs text-slate-500">Approved retirement statements, separate from your regular salary payslips.</p>
            </div>
            {statements.isPending && <p role="status" className="text-xs text-slate-500">Loading retirement statements…</p>}
            {statements.isError && <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <span>Retirement statements could not refresh. Previously loaded information may be out of date.</span>
                <button type="button" disabled={statements.isFetching} onClick={() => statements.refetch()} className="font-semibold underline disabled:opacity-50">Retry</button>
            </div>}
            {!statements.isPending && !statements.isError && rows.length === 0 && <p className="text-xs text-slate-500">No approved retirement statement on this page. Draft calculations appear only after HR approval.</p>}
            {rows.map(record => <details key={record.id} className="rounded-md border border-slate-200">
                <summary className="cursor-pointer p-3 text-xs font-semibold text-slate-800 [overflow-wrap:anywhere]">
                    Retirement Pay · {record.retirement_date} · {record.status === 'paid' ? 'Payment recorded' : 'Approved — awaiting payment'} · Gross {formatCurrency(record.calculation.statutory_gross)}
                </summary>
                <div className="space-y-3 p-3 pt-0">
                    <button type="button" disabled={statements.isError || statements.isFetching} onClick={() => printHtmlElement('retirement-statement-' + record.id, 'Retirement_Pay_' + record.id)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Print / Save PDF</button>
                    <RetirementPayStatement record={record} />
                </div>
            </details>)}
            {(page > 1 || statements.data?.total > 25) && <nav aria-label="Retirement statement pages" className="flex items-center justify-between text-xs">
                <button type="button" disabled={page === 1 || statements.isFetching} onClick={() => setPage(previous => previous - 1)} className="rounded border border-slate-200 px-3 py-2 disabled:opacity-50">Previous</button>
                <span>Page {page}</span>
                <button type="button" disabled={!statements.data || page * 25 >= statements.data.total || statements.isFetching} onClick={() => setPage(previous => previous + 1)} className="rounded border border-slate-200 px-3 py-2 disabled:opacity-50">Next</button>
            </nav>}
        </section>
    );
}
