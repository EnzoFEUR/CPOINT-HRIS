export default function SilCashEarnings({ payroll }) {
    if (!(Number(payroll?.sil_cash_pay) > 0)) return null;
    const lines = Array.isArray(payroll.sil_cash_lines) ? payroll.sil_cash_lines : [];
    const money = amount => Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return <div className="space-y-1 py-1 text-xs text-slate-700">
        <div className="flex justify-between gap-3"><span>SIL Cash Conversion</span><span>PHP {money(payroll.sil_cash_pay)}</span></div>
        {lines.map(line => <div key={line.request_id} className="flex justify-between gap-3 text-[11px] text-slate-500">
            <span>{Number(line.days)} days × PHP {money(line.daily_rate)}{line.conversion_on ? ` · ${line.conversion_on}` : ''}</span><span>PHP {money(line.amount)}</span>
        </div>)}
    </div>;
}
