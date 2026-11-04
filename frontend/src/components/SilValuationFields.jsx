import { useEffect, useId, useRef, useState } from 'react';
import { isBoundedDecimalInput } from '../../../shared/inputLimits.mjs';
import { calculateSilConversion, calculateSilDailyEquivalent, formatSilEvidenceReference, isLeaveDate } from '../../../shared/leavePolicy.js';
import { fetchWithAuth } from '../utils/api';
import { readLeaveCreditResponse } from '../utils/useEmployeeLeaveCredits';
import SilEvidencePeriodPicker from './SilEvidencePeriodPicker';
import SilWageDocumentField from './SilWageDocumentField';

const money = value => Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SilValuationFields({ employeeId, value, onChange, asOf, inputClass, previousReview, requestedDays, sourceNotice, onSourceReviewed, sourceRevision = 0 }) {
    const fieldId = useId();
    const [mode, setMode] = useState(() => value.source_document_id && !value.source && !value.calculation ? 'external' : 'saved');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [evidence, setEvidence] = useState(null);
    const [previewRevision, setPreviewRevision] = useState(sourceRevision);
    if (previewRevision !== sourceRevision) {
        setPreviewRevision(sourceRevision);
        setLoading(false);
        setError('');
        setEvidence(null);
    }
    const activeLoad = useRef(null);
    useEffect(() => () => activeLoad.current?.abort(), []);
    useEffect(() => {
        // Recheck saved evidence without remounting the document uploader or losing its file.
        activeLoad.current?.abort();
        activeLoad.current = null;
    }, [sourceRevision]);
    const set = (name, next) => {
        onChange(previous => ({ ...previous, [name]: next, as_of: asOf, verified: name === 'verified' ? next : false }));
        if (name === 'verified' && next) onSourceReviewed?.();
    };
    const stopLoad = () => {
        activeLoad.current?.abort(); activeLoad.current = null;
        setLoading(false); setError('');
    };
    const emptyReview = changes => onChange(previous => ({ ...previous, ...changes, daily_rate: '', evidence_reference: '', calculation_basis: '',
        authority_reference: '', source_document_id: '', calculation: null, source: null, verified: false, as_of: asOf }));
    const clearSuggestion = changes => {
        stopLoad(); setEvidence(null); emptyReview(changes);
    };
    const enterDocumentedReview = () => {
        stopLoad(); setMode('external'); emptyReview({ reference_start: '', reference_end: '' });
    };
    const reuseReferences = () => {
        if (!previousReview) return;
        stopLoad(); setMode('external');
        const basis = previousReview.valuation_basis;
        onChange(previous => ({ ...previous, source_document_id: basis.source_document_id, reference_start: '', reference_end: '', daily_rate: '',
            calculation: null, source: null, as_of: asOf, verified: false }));
    };
    const loadEvidence = async (period = value) => {
        const from = period.reference_start, to = period.reference_end;
        if (!isLeaveDate(from) || !isLeaveDate(to) || from > to || to > asOf) { setError('Choose an evidence period before loading saved records.'); return; }
        stopLoad(); setEvidence(null);
        const controller = new AbortController(); activeLoad.current = controller;
        setLoading(true);
        emptyReview({ reference_start: from, reference_end: to });
        try {
            const query = new URLSearchParams({ employee_id: employeeId, from, to });
            const data = await readLeaveCreditResponse(await fetchWithAuth(`/api/leave-credits/valuation-evidence?${query}`, { signal: controller.signal }));
            if (controller.signal.aborted || activeLoad.current !== controller) return;
            if (data?.employee_id !== employeeId || data.reference_start !== from || data.reference_end !== to
                || !Array.isArray(data.payrolls) || !data.payrolls.length || data.payrolls.length > 60
                || typeof data.evidence_reference !== 'string' || typeof data.calculation_basis !== 'string'
                || data.source?.kind !== 'saved_weekly_factory' || calculateSilDailyEquivalent(data.calculation) !== data.daily_rate) {
                throw new Error('The calculation response is incomplete. Refresh and reload.');
            }
            setEvidence(data);
            onChange(previous => ({ ...previous, daily_rate: String(data.daily_rate), calculation: data.calculation, source: data.source,
                evidence_reference: data.evidence_reference, calculation_basis: data.calculation_basis, verified: false, as_of: asOf }));
            onSourceReviewed?.();
        } catch (failure) {
            if (!controller.signal.aborted && activeLoad.current === controller) setError(failure.message || 'Unable to load payroll evidence.');
        } finally {
            if (activeLoad.current === controller) { activeLoad.current = null; setLoading(false); }
        }
    };
    let cashPreview = null;
    try { if (evidence) cashPreview = calculateSilConversion(requestedDays, evidence.daily_rate); } catch { /* no payable-day preview */ }
    let reviewedCash = null;
    try { reviewedCash = calculateSilConversion(requestedDays, value.daily_rate); } catch { /* rate not entered */ }

    return (
        <div className="min-w-0 rounded-lg border border-line bg-surface p-3.5 space-y-3 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-line">
                <div>
                    <h4 className="text-xs font-bold text-ink uppercase tracking-wider">SIL Rate Assistant</h4>
                    <p className="text-[11px] text-ink-subtle">Gather records · Review wage basis · Weekly payout</p>
                </div>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-surface-muted border border-line text-ink-muted">As of {asOf}</span>
            </div>

            {sourceNotice && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">{sourceNotice}</p>}

            {previousReview && <details className="rounded-md border border-line bg-surface-muted/50 p-2.5 text-xs">
                <summary className="cursor-pointer font-semibold text-ink">Previous documented wage review</summary>
                <div className="mt-2 space-y-2 break-words text-ink-muted">
                    <p>Previously reviewed: PHP {money(previousReview.valuation_basis.daily_rate)}/day · {previousReview.valuation_basis.as_of}</p>
                    <p>{formatSilEvidenceReference(previousReview.valuation_basis.evidence_reference)}</p>
                    <p>The linked document will be checked again before approval.</p>
                    <button type="button" onClick={reuseReferences} className="rounded-md border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-muted">Use previous wage source</button>
                </div>
            </details>}

            <div>
                <label htmlFor={`${fieldId}-source`} className="block text-[11px] font-medium text-ink-muted mb-1">Rate Source</label>
                <select id={`${fieldId}-source`} aria-label="Rate source" value={mode}
                    onChange={event => { setMode(event.target.value); clearSuggestion({ reference_start: '', reference_end: '' }); }} className={inputClass}>
                    <option value="saved">Saved payroll preview</option>
                    <option value="external">Documented wage review</option>
                </select>
            </div>

            {mode === 'saved' && <div className="space-y-3">
                <SilEvidencePeriodPicker employeeId={employeeId} asOf={asOf} value={value} onChange={clearSuggestion} onPreview={loadEvidence} loading={loading} />
                <button type="button" disabled={loading || !value.reference_start || !value.reference_end} onClick={() => loadEvidence()}
                    className="w-full min-h-9 px-3 py-2 rounded-md text-xs font-semibold bg-ink text-white hover:bg-slate-800 disabled:opacity-50">
                    {loading ? 'Loading payroll and attendance…' : 'Load Saved Payroll Data'}
                </button>
                {!evidence && <button type="button" onClick={enterDocumentedReview} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-muted">I have a documented wage rate</button>}
            </div>}

            {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-md border border-rose-200">{error}</p>}

            {evidence && <div className="p-3 bg-surface-muted border border-line rounded-md space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <span className="text-[11px] font-semibold text-ink uppercase tracking-wider">Arithmetic Preview</span>
                    <span className="text-base font-bold font-mono text-ink tabular-nums">PHP {money(evidence.daily_rate)} / day</span>
                </div>
                <p className="text-xs text-ink-muted">PHP {money(evidence.calculation.earnings)} production earnings ÷ {evidence.calculation.worked_days} completed attendance dates</p>
                <p className="text-[11px] text-ink-subtle">{evidence.reference_start} to {evidence.reference_end} · {evidence.payrolls.length} weekly payslip(s)</p>
                {cashPreview != null && <p className="text-xs font-semibold text-ink">Preview for {requestedDays} SIL days: PHP {money(cashPreview)}</p>}
                <p className="text-[11px] text-amber-900">{mode === 'saved' ? 'Wage method needs confirmation. This preview cannot authorize SIL payment.' : 'Supporting payroll preview only. Approval uses the documented conversion-date rate below.'}</p>
                <details className="text-[11px] text-ink-muted">
                    <summary className="cursor-pointer font-semibold">View source records ({evidence.payrolls.length})</summary>
                    <div className="mt-2 max-h-48 overflow-auto rounded border border-line">
                        <table aria-label="Saved payroll source records" className="w-full table-fixed text-left text-[11px]">
                            <thead className="bg-surface"><tr><th scope="col" className="p-2">Payroll period</th><th scope="col" className="p-2 text-right">Production earnings</th></tr></thead>
                            <tbody>{evidence.payrolls.map(payroll => <tr key={payroll.id} className="border-t border-line">
                                <td className="p-2"><span className="block">{payroll.period_start}</span><span className="block">to {payroll.period_end}</span></td>
                                <td className="p-2 text-right tabular-nums break-words">PHP {money(payroll.basic_pay)}</td>
                            </tr>)}</tbody>
                        </table>
                    </div>
                </details>
                <details className="text-[11px] text-ink-subtle">
                    <summary className="cursor-pointer font-medium">View Calculation Details</summary>
                    <div className="mt-1 space-y-1 break-words leading-5">
                        <p><strong>Evidence Reference:</strong> {formatSilEvidenceReference(evidence.evidence_reference)}</p>
                        <p><strong>Calculation Basis:</strong> {evidence.calculation_basis}</p>
                    </div>
                </details>
                {mode === 'saved' && <button type="button" onClick={enterDocumentedReview} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-muted">Enter documented rate for approval</button>}
            </div>}

            {mode === 'external' && <div className="space-y-3">
                <SilWageDocumentField employeeId={employeeId} asOf={asOf} sourceId={value.source_document_id || ''}
                    onChange={documentId => set('source_document_id', documentId)} inputClass={inputClass} />
                <div>
                    <label htmlFor={`${fieldId}-rate`} className="block text-[11px] font-medium text-ink-muted mb-1">Reviewed Daily Rate (PHP) *</label>
                    <input id={`${fieldId}-rate`} required type="text" inputMode="decimal" maxLength={10} value={value.daily_rate}
                        onChange={event => { if (isBoundedDecimalInput(event.target.value, 1000000, true)) set('daily_rate', event.target.value); }}
                        placeholder="Enter verified rate" className={inputClass} />
                </div>
                <div className="rounded-md border border-line bg-surface-muted/50 p-2.5 text-xs">
                    <span className="block text-ink-muted">Calculated SIL cash-out (gross)</span>
                    <strong className="mt-1 block text-base tabular-nums text-ink">{reviewedCash == null ? 'Enter the reviewed rate' : `PHP ${money(reviewedCash)}`}</strong>
                    <p className="mt-1 text-[11px] text-ink-subtle">The verified source and approval details are recorded automatically.</p>
                </div>
                <label className="flex items-start gap-2 text-xs font-medium text-ink cursor-pointer">
                    <input type="checkbox" required checked={value.verified && value.as_of === asOf} onChange={event => set('verified', event.target.checked)} className="mt-0.5 rounded border-line text-accent focus:ring-accent" />
                    <span>I verified the linked wage document supports this conversion-date rate and applicable wage method.</span>
                </label>
            </div>}
        </div>
    );
}
