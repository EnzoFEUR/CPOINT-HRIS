import { getManilaWorkDate } from '../../../shared/workPolicy.mjs';
import { isBoundedDecimalInput } from '../../../shared/inputLimits.mjs';

export default function StatutoryLeaveReviewFields({ leave, value, onChange, disabled }) {
    const advanceDue = new Date(Date.parse(getManilaWorkDate(leave.created_at || new Date())) + 30 * 86400000).toISOString().slice(0, 10);
    const set = (name, next) => onChange(previous => ({ ...previous, [name]: next }));
    const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100';
    const money = (name, label) => <label className="block text-xs font-semibold text-slate-700">{label}<input type="text" inputMode="decimal" maxLength={12} required disabled={disabled} value={value[name]} onChange={event => { if (isBoundedDecimalInput(event.target.value, 100000000, true)) set(name, event.target.value); }} className={inputClass} /></label>;
    return <fieldset disabled={disabled} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <legend className="px-1 text-xs font-bold text-slate-800">Statutory benefit review · No SIL deduction</legend>
        <label className="block text-xs font-semibold text-slate-700">Contingency / document reference<input maxLength={120} required value={value.contingency_reference} onChange={event => set('contingency_reference', event.target.value)} className={inputClass} /></label>
        {leave.type === 'Paternity Leave' ? <>
            <div className="grid gap-3 sm:grid-cols-2">
                {money('daily_rate', 'Verified full-pay daily rate (PHP)')}
                <label className="block text-xs font-semibold text-slate-700">Qualifying delivery number<select value={value.delivery_number} onChange={event => set('delivery_number', Number(event.target.value))} className={inputClass}>{[1, 2, 3, 4].map(number => <option key={number} value={number}>{number}</option>)}</select></label>
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={value.married_cohabiting} onChange={event => set('married_cohabiting', event.target.checked)} className="mt-0.5" />Legal spouse, cohabitation and qualifying delivery verified</label>
            <p className="text-xs font-medium text-slate-700">Scheduled paid days: {leave.scheduled_workdays ?? 'Schedule unavailable'} / 7</p>
        </> : <>
            <p className={`text-xs font-semibold ${advanceDue < getManilaWorkDate() ? 'text-danger-ink' : 'text-slate-700'}`}>Advance due by: {advanceDue}</p>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">Maternity entitlement<select value={value.event} onChange={event => set('event', event.target.value)} className={inputClass}><option value="live_birth">Live childbirth · 105 calendar days</option><option value="solo_parent_live_birth">Qualified solo parent · 120 calendar days</option><option value="miscarriage_etp">Miscarriage / ETP · 60 calendar days</option></select></label>
                <label className="block text-xs font-semibold text-slate-700">Days allocated to caregiver<input type="number" min="0" max={value.event === 'miscarriage_etp' ? 0 : 7} step="1" value={value.allocated_days} onChange={event => set('allocated_days', Number(event.target.value))} className={inputClass} /></label>
                {money('full_pay', 'Verified full-pay entitlement (PHP)')}
                {money('sss_benefit', 'Verified SSS benefit (PHP)')}
                {money('sss_paid_externally', 'SSS benefit already paid outside payroll (PHP)')}
                {money('differential_paid_externally', 'Differential already paid outside payroll (PHP)')}
                <label className="block text-xs font-semibold text-slate-700">Advance payable on<input type="date" required value={value.payable_on} onChange={event => set('payable_on', event.target.value)} className={inputClass} /></label>
                <label className="block text-xs font-semibold text-slate-700">External payment date<input type="date" value={value.external_paid_on} onChange={event => set('external_paid_on', event.target.value)} className={inputClass} /></label>
            </div>
            <label className="block text-xs font-semibold text-slate-700">External payment reference<input maxLength={120} value={value.external_reference} onChange={event => set('external_reference', event.target.value)} className={inputClass} /></label>
            <label className="block text-xs font-semibold text-slate-700">Documented differential exemption, if applicable<input maxLength={500} value={value.differential_exemption} onChange={event => set('differential_exemption', event.target.value)} className={inputClass} /></label>
            <p className="text-xs font-medium text-slate-700">Employer differential: PHP {Math.max(0, value.differential_exemption.trim() ? 0 : (Number(value.full_pay) || 0) - (Number(value.sss_benefit) || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
        </>}
        <label className="block text-xs font-semibold text-slate-700">Eligibility and wage evidence<textarea required maxLength={1000} rows={3} value={value.basis} onChange={event => set('basis', event.target.value)} className={inputClass} /><span className="mt-1 block text-right font-normal text-slate-500">{value.basis.length}/1000</span></label>
        <label className="flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={value.eligibility_confirmed} onChange={event => set('eligibility_confirmed', event.target.checked)} className="mt-0.5" />Applicable entitlement, wage basis and supporting evidence verified</label>
    </fieldset>;
}
