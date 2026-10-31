import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../utils/api';
import { calculateMaternityAssessment, getMaternityWindows } from '../../../shared/maternityAssessment.mjs';
import { isLeaveDate, getManilaWorkDate } from '../../../shared/leavePolicy.js';
import { isBoundedDecimalInput } from '../../../shared/inputLimits.mjs';

const currency = value => typeof value === 'number' ? value.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' }) : 'Needs verification';
const inputClass = 'mt-1 h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 disabled:bg-slate-100';

export default function MaternityApprovalReview({ leave, actorId, value, onChange, disabled }) {
    const advanceDue = new Date(Date.parse(getManilaWorkDate(leave.created_at || new Date())) + 30 * 86400000).toISOString().slice(0, 10);
    const client = useQueryClient();
    const key = ['maternityReviewDraft', actorId, String(leave.id)];
    const query = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
        const response = await fetchWithAuth(`/api/leaves/${leave.id}/maternity-draft`, { signal });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load maternity records.');
        return body.data;
    }, staleTime: 15000, retry: false, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchOnReconnect: true });
    const [edits, setEdits] = useState(null), [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
    const [outsideEnabled, setOutsideEnabled] = useState(null), [exemptionEnabled, setExemptionEnabled] = useState(null);
    const [base, setBase] = useState(null);
    const busy = useRef(false);
    const data = query.data, sources = edits || data?.sources;
    const changed = Boolean(edits && data && (base?.revision !== data.revision || JSON.stringify(base?.snapshot) !== JSON.stringify(data.employee_snapshot)));
    const ready = Boolean(data?.revision && data.calculation && !data.stale && !edits && !query.isFetching && !query.isError);
    useEffect(() => {
        onChange(ready ? { ...data.calculation.review, source_revision: data.revision, eligibility_confirmed: false } : null);
    }, [ready, data, onChange]);
    const update = (name, next) => {
        onChange(null);
        setBase(previous => previous || { revision: data.revision, snapshot: data.employee_snapshot });
        setEdits(previous => {
            const result = { ...(previous || data.sources), [name]: next };
            if (name === 'event' && next === 'miscarriage_etp') result.allocated_days = 0;
            if (name === 'wage_mode') {
                if (next === 'variable' && !result.variable_months) result.variable_months = data.defaults.variable_months;
                if (next === 'daily' && result.daily_rate == null) result.daily_rate = data.employee_pay.daily_rate || '';
                if (next === 'monthly' && result.monthly_salary == null) result.monthly_salary = data.employee_pay.monthly_salary || '';
            }
            if (['contingency_date', 'sss_mode'].includes(name) && isLeaveDate(result.contingency_date)) {
                const months = getMaternityWindows(result.contingency_date, leave.start_date).qualifying_months;
                result.sss_history = months.map(month => result.sss_history?.find(row => row.month === month) || { month, msc: '', paid_on: '' });
            }
            return result;
        });
        setError('');
    };
    const moneyField = (name, label) => <label className="block text-xs font-semibold text-slate-700">{label}<input type="text" inputMode="decimal" maxLength={12} value={sources?.[name] ?? ''} onChange={event => { if (isBoundedDecimalInput(event.target.value, 100000000, true)) update(name, event.target.value); }} className={inputClass} /></label>;
    const recordField = (collection, index, field, next) => update(collection, sources[collection].map((row, i) => i === index ? { ...row, [field]: next } : row));
    let draft = null, missing = '';
    if (data && sources) {
        try { draft = calculateMaternityAssessment(data.request, sources); } catch (error) { missing = error.message; }
    }
    const discard = async () => {
        setEdits(null); setBase(null); setError(''); setOutsideEnabled(null); setExemptionEnabled(null); setEditing(false);
        await query.refetch();
    };
    const save = async () => {
        if (busy.current || !draft || changed) return;
        busy.current = true; setSaving(true); setError('');
        try {
            const response = await fetchWithAuth(`/api/leaves/${leave.id}/maternity-draft`, { method: 'PUT', body: JSON.stringify({ sources, expected_revision: base?.revision ?? data.revision, employee_snapshot: base?.snapshot ?? data.employee_snapshot }) });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to save maternity source records.');
            client.setQueryData(key, body.data); setEdits(null); setBase(null); setEditing(false);
            setOutsideEnabled(null); setExemptionEnabled(null);
        } catch (error) { setError(error.message); }
        finally { busy.current = false; setSaving(false); }
    };
    if (!data) return <div role="status" className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600">{query.error?.message || 'Loading request, wage and benefit records…'}{query.isError && <button type="button" onClick={() => query.refetch()} className="ml-2 font-semibold text-accent underline">Retry</button>}</div>;
    const open = editing || !data.revision;
    const outside = outsideEnabled ?? Boolean(Number(sources.sss_paid_externally) || Number(sources.differential_paid_externally));
    const exemption = exemptionEnabled ?? Boolean(sources.differential_exemption);
    return <section aria-label="Maternity calculation" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-slate-900">Maternity benefit calculation</h4>
            <span className="text-xs text-slate-500">{data.revision ? `Saved calculation · Revision ${data.revision}` : 'Source verification needed'}</span>
        </div>
        <p className={`text-xs font-semibold ${advanceDue < getManilaWorkDate() ? 'text-danger-ink' : 'text-slate-600'}`}>Advance due by: {advanceDue} · No SIL deduction</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[['Gross full-pay entitlement', draft?.review.full_pay], ['SSS benefit', draft?.review.sss_benefit], ['Employer differential (gross)', draft?.review.salary_differential], ['Remaining gross advance', draft?.remaining_advance]].map(([label, amount]) => <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-lg font-bold tabular-nums text-slate-900">{currency(amount)}</dd></div>)}
        </dl>
        <p className="text-xs text-slate-500">Gross components. Existing payroll contribution rules still apply; payroll deductions are not proof of SSS remittance.</p>
        {(data.stale || changed) && <div role="alert" className="rounded-md bg-warning-subtle p-3 text-sm text-warning-ink">Source or wage records changed. Review the latest data before approval.<button type="button" onClick={discard} className="mt-2 block font-semibold underline">Discard edits and reload</button></div>}
        {query.isError && <p role="alert" className="text-sm text-danger-ink">{query.error.message}</p>}
        {!open && <button type="button" disabled={disabled || saving} onClick={() => setEditing(true)} className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700">Review source records</button>}
        {open && <fieldset disabled={disabled || saving} className="space-y-4 rounded-lg border border-slate-200 p-3 sm:p-4">
            <legend className="px-1 text-xs font-bold text-slate-700">Request and calculation sources</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">Maternity entitlement<select value={sources.event} onChange={event => update('event', event.target.value)} className={inputClass}><option value="live_birth">Live childbirth · 105 calendar days</option><option value="solo_parent_live_birth">Qualified solo parent · 120 calendar days</option><option value="miscarriage_etp">Miscarriage / ETP · 60 calendar days</option></select></label>
                <label className="block text-xs font-semibold text-slate-700">Days voluntarily allocated<select value={sources.allocated_days} onChange={event => update('allocated_days', Number(event.target.value))} disabled={sources.event === 'miscarriage_etp'} className={inputClass}>{[0,1,2,3,4,5,6,7].map(days => <option key={days} value={days}>{days}</option>)}</select></label>
                <label className="block text-xs font-semibold text-slate-700">Expected / actual contingency date<input type="date" max={leave.end_date} value={sources.contingency_date} onChange={event => update('contingency_date', event.target.value)} className={inputClass} /></label>
                <label className="block text-xs font-semibold text-slate-700">Verified wage basis<select value={sources.wage_mode} onChange={event => update('wage_mode', event.target.value)} className={inputClass}><option value="monthly">Monthly basic salary</option><option value="daily">Daily basic rate</option><option value="variable">Variable / factory earnings</option></select></label>
                {sources.wage_mode === 'monthly' && moneyField('monthly_salary', 'Monthly basic salary (PHP)')}
                {sources.wage_mode === 'daily' && <>{moneyField('daily_rate', 'Daily basic rate (PHP)')}<label className="block text-xs font-semibold text-slate-700">Verified annual paid-day factor<input type="number" min="1" max="366" step="1" value={sources.annual_paid_days ?? ''} onChange={event => update('annual_paid_days', event.target.value === '' ? '' : Number(event.target.value))} className={inputClass} /></label></>}
                {moneyField('regular_monthly_allowance', 'Regular monthly allowances, excluding amounts already in the basis (PHP)')}
            </div>
            {sources.wage_mode === 'variable' && <div className="space-y-2"><p className="text-xs text-slate-500">12-month basic earnings by payroll cutoff end month. Reconcile incomplete months and exclude allowances already entered separately.</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{sources.variable_months?.map((row, index) => <label key={row.month} className="block text-xs text-slate-700">Basic earnings {row.month}<input type="text" inputMode="decimal" maxLength={12} value={row.amount} onChange={event => { if (isBoundedDecimalInput(event.target.value, 100000000, true)) recordField('variable_months', index, 'amount', event.target.value); }} className={inputClass} /></label>)}</div></div>}
            <label className="block text-xs font-semibold text-slate-700">Wage / allowance evidence reference<input maxLength={300} value={sources.wage_reference} onChange={event => update('wage_reference', event.target.value)} className={inputClass} /></label>
            <label className="block text-xs font-semibold text-slate-700">SSS calculation source<select value={sources.sss_mode} onChange={event => update('sss_mode', event.target.value)} className={inputClass}><option value="history">Verified contribution history</option><option value="assessment">Documented SSS assessment</option></select></label>
            {sources.sss_mode === 'assessment' ? moneyField('sss_assessment_amount', 'Documented SSS benefit (PHP)') : <div className="space-y-3">
                <p className="text-xs text-slate-500">Enter every month in the qualifying window, including verified zero months. The highest six timely paid regular MSCs are used; regular MSC is capped at PHP 20,000.</p>
                {sources.sss_history?.map((row, index) => <div key={row.month} className="grid grid-cols-1 gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">MSC {row.month}<input type="text" inputMode="decimal" maxLength={12} value={row.msc} onChange={event => { if (isBoundedDecimalInput(event.target.value, 100000000, true)) recordField('sss_history', index, 'msc', event.target.value); }} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Remitted on {row.month}<input type="date" value={row.paid_on || ''} onChange={event => recordField('sss_history', index, 'paid_on', event.target.value)} className={inputClass} /></label></div>)}
                {!sources.sss_history?.length && <p className="text-xs text-warning-ink">Choose the contingency date to load the qualifying months.</p>}
            </div>}
            <label className="block text-xs font-semibold text-slate-700">SSS record / assessment reference<input maxLength={300} value={sources.sss_reference} onChange={event => update('sss_reference', event.target.value)} className={inputClass} /></label>
            <label className="block text-xs font-semibold text-slate-700">Advance payable on<input type="date" value={sources.payable_on} onChange={event => update('payable_on', event.target.value)} className={inputClass} /></label>
            <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={outside} onChange={event => { setOutsideEnabled(event.target.checked); update('sss_paid_externally', event.target.checked ? sources.sss_paid_externally : 0); if (!event.target.checked) { update('differential_paid_externally', 0); update('external_reference', ''); update('external_paid_on', ''); } }} className="mt-1" />A benefit payment was already made outside payroll</label>
            {outside && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{moneyField('sss_paid_externally', 'SSS benefit already paid (PHP)')}{moneyField('differential_paid_externally', 'Differential already paid (PHP)')}<label className="text-xs font-semibold text-slate-700">Actual external payment date<input type="date" value={sources.external_paid_on || ''} onChange={event => update('external_paid_on', event.target.value)} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">External payment reference<input maxLength={120} value={sources.external_reference || ''} onChange={event => update('external_reference', event.target.value)} className={inputClass} /></label></div>}
            <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={exemption} onChange={event => { setExemptionEnabled(event.target.checked); update('differential_exemption', event.target.checked ? sources.differential_exemption : ''); }} className="mt-1" />A documented employer differential exemption applies</label>
            {exemption && <label className="block text-xs font-semibold text-slate-700">Exemption evidence / approval reference<input maxLength={500} value={sources.differential_exemption || ''} onChange={event => update('differential_exemption', event.target.value)} className={inputClass} /></label>}
            {missing && <p role="status" className="rounded-md bg-warning-subtle p-3 text-sm text-warning-ink">{missing}</p>}
            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={discard} disabled={saving} className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700">Discard edits and reload</button><button type="button" onClick={save} disabled={saving || !draft || changed || query.isFetching || (outside && !(Number(sources.sss_paid_externally) || Number(sources.differential_paid_externally))) || (exemption && !sources.differential_exemption?.trim())} className="h-10 rounded-md bg-accent px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save calculation sources'}</button></div>
        </fieldset>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        {ready && <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><input type="checkbox" disabled={disabled} checked={value?.eligibility_confirmed === true} onChange={event => onChange(previous => ({ ...previous, eligibility_confirmed: event.target.checked }))} className="mt-1" />I verified the entitlement, wage evidence, SSS records and payment offsets for this calculation.</label>}
    </section>;
}
