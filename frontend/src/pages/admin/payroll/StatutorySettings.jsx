import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import { STATUTORY_INPUT_LIMITS, isValidStatutoryInput, getStatutorySettingsError, getWithholdingTableVersionError, WITHHOLDING_MAX_BRACKETS } from '../../../../../shared/statutorySettings.mjs';
import BackButton from '../../../components/ui/BackButton';
import {useQuery} from '@tanstack/react-query';

const DEFAULT_SETTINGS = {
    sss_employee_rate: 5,         // 5%
    sss_employer_rate: 10,        // 10%
    sss_max_msc: 35000,           // 2026 SSS MSC Cap (P35,000)
    philhealth_rate: 5,           // 5% Total
    philhealth_min_salary: 10000,
    philhealth_max_salary: 100000,
    pagibig_employee_rate: 2,     // 2%
    pagibig_employer_rate: 2,     // 2%
    pagibig_max_contribution: 200, // P200 Max EE share (P400 total EE+ER under Circular 460)
    // Attendance & Tardiness Policies
    grace_period_minutes: 15,     // 15-minute grace period
    late_rate_per_minute: 25,     // ₱25.00/min deduction
    call_time_hour: 8,            // 8:00 AM
    call_time_minute: 0,
    // NCR non-agriculture daily minimum wage (floor for piece-rate holiday pay)
    minimum_daily_wage: 755,
};

// Static class lookup map to fix Tailwind CSS JIT compilation issue with dynamic string interpolation
const FOCUS_STYLES = {
    blue: 'focus:border-accent focus:ring-1 focus:ring-accent',
    rose: 'focus:border-danger focus:ring-1 focus:ring-danger',
    emerald: 'focus:border-line focus:ring-1 focus:ring-line',
    indigo: 'focus:border-slate-900 focus:ring-1 focus:ring-slate-900'
};

const FieldInput = ({ label, name, value, onChange, hint, focusColor = 'blue', ...props }) => (
    <div>
        <label htmlFor={name} className="block text-xs font-medium text-slate-700 mb-1.5">{label}</label>
        <input
            type="text"
            min="0"
            id={name}
            name={name}
            value={value ?? ''}
            onChange={onChange}
            className={`w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-sm text-slate-800 font-semibold focus:outline-none ${FOCUS_STYLES[focusColor] || FOCUS_STYLES.blue} transition-colors duration-100 shadow-2xs`}
            {...props}
            {...STATUTORY_INPUT_LIMITS[name]}
            maxLength={STATUTORY_INPUT_LIMITS[name]?.maxLength ?? String(STATUTORY_INPUT_LIMITS[name]?.max ?? 0).length + 3}
            required={Boolean(STATUTORY_INPUT_LIMITS[name]) || props.required}
            inputMode={STATUTORY_INPUT_LIMITS[name]?.step === 1 ? 'numeric' : 'decimal'}
        />
        {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
);

const FREQUENCY_LABELS = { weekly: 'Weekly', 'semi-monthly': 'Semi-monthly', monthly: 'Monthly' };
const AMOUNT_INPUT = /^\d*\.?\d{0,2}$/;
const formatPeso = (value) => `₱${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
const toRowDrafts = (brackets) => (brackets || []).map(b => ({ over: String(b.over), base: String(b.base), rate: String(b.rate) }));

const BracketTable = ({ brackets }) => (
    <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] tracking-wide">
                <tr>
                    <th className="text-left font-semibold px-3 py-2">Taxable income over</th>
                    <th className="text-right font-semibold px-3 py-2">Base tax</th>
                    <th className="text-right font-semibold px-3 py-2">Plus % of the excess</th>
                </tr>
            </thead>
            <tbody>
                {[...brackets].sort((a, b) => Number(a.over) - Number(b.over)).map((b, index) => (
                    <tr key={index} className="border-t border-slate-100 font-mono text-slate-800">
                        <td className="px-3 py-2">{formatPeso(b.over)}</td>
                        <td className="px-3 py-2 text-right">{formatPeso(b.base)}</td>
                        <td className="px-3 py-2 text-right">{Number(b.rate)}%</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// HR-editable BIR withholding tax tables. Each saved version has an effective date; payroll uses the
// version in force on the payroll period end date, and falls back to the built-in BIR table.
// Edits (new versions, changes, deletions) are only staged here. The page's single Save Changes button
// validates and saves them through the ref (validate / commit), together with the other settings.
const WithholdingTaxTables = forwardRef(function WithholdingTaxTables(_props, ref) {
    const tables = useQuery({
        queryKey:['payrollWithholdingTables'],
        queryFn:async({signal})=>{
            const response=await fetchWithAuth('/api/payroll/withholding-tax-tables',{signal});
            const result=await response.json();
            if(!response.ok||!Array.isArray(result.versions))throw new Error(result.error||'Unable to load withholding tax tables.');
            return result;
        },
        staleTime:15_000,retry:false,
    });
    const data=tables.data;
    const [frequency, setFrequency] = useState('weekly');
    const [drafts, setDrafts] = useState({}); // staged add/edit per frequency: { id, effective_from, rows }
    const [pendingDeletes, setPendingDeletes] = useState([]); // version ids removed when the page is saved
    const error=tables.error?.message||'';

    const editor = drafts[frequency] || null;
    const setEditor = (updater) => setDrafts(prev => {
        const next = typeof updater === 'function' ? updater(prev[frequency]) : updater;
        const copy = { ...prev };
        if (next) copy[frequency] = next; else delete copy[frequency];
        return copy;
    });

    const refetch=tables.refetch;
    const load=useCallback(async()=>{const result=await refetch();if(result.isError)throw result.error;},[refetch]);

    const today = data?.today || '';
    const unsaved = Object.keys(drafts).length > 0 || pendingDeletes.length > 0;
    const versions = (data?.versions || [])
        .filter(v => v.frequency === frequency)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    const inEffect = versions.find(v => v.effective_from <= today) || null;
    const upcoming = versions.filter(v => v.effective_from > today).reverse();
    const history = versions.filter(v => v !== inEffect && v.effective_from <= today);
    const activeBrackets = inEffect ? inEffect.brackets : (data?.defaults?.[frequency] || []);
    const canChange = (version) => version.effective_from > today;
    const isPendingDelete = (version) => pendingDeletes.includes(version.id);

    const buildPayload = (freq, draft) => ({
        frequency: freq,
        effective_from: draft.effective_from,
        brackets: draft.rows.map(row => ({ over: row.over, base: row.base, rate: row.rate })),
    });

    // Used by the page's Save Changes button.
    useImperativeHandle(ref, () => ({
        hasChanges: () => unsaved,
        validate: () => {
            for (const [freq, draft] of Object.entries(drafts)) {
                const label = `${FREQUENCY_LABELS[freq]} withholding tax`;
                const payload = buildPayload(freq, draft);
                if (!payload.effective_from) return `${label}: choose the date the new rates take effect.`;
                if (payload.effective_from < today) return `${label}: the effective date cannot be in the past.`;
                const problem = getWithholdingTableVersionError(payload);
                if (problem) return `${label}: ${problem}`;
            }
            return '';
        },
        commit: async () => {
            // Deletions first so a new version can reuse a deleted version's date.
            const operations = [
                ...pendingDeletes.map(id => ({ kind: 'delete', id })),
                ...Object.entries(drafts).map(([freq, draft]) => ({ kind: 'save', freq, draft })),
            ];
            const remainingDrafts = { ...drafts };
            let remainingDeletes = [...pendingDeletes];
            try {
                for (const op of operations) {
                    if (op.kind === 'delete') {
                        const version = data.versions.find(v => v.id === op.id);
                        const response = await fetchWithAuth(`/api/payroll/withholding-tax-tables/${op.id}`, { method: 'DELETE', body:JSON.stringify({expected_updated_at:version?.updated_at}) });
                        const result = await response.json();
                        if (!response.ok || result.error) throw new Error(result.error || 'Unable to delete a withholding tax table.');
                        remainingDeletes = remainingDeletes.filter(id => id !== op.id);
                    } else {
                        const response = await fetchWithAuth(
                            op.draft.id ? `/api/payroll/withholding-tax-tables/${op.draft.id}` : '/api/payroll/withholding-tax-tables',
                            { method: op.draft.id ? 'PUT' : 'POST', body: JSON.stringify({...buildPayload(op.freq, op.draft), ...(op.draft.id ? {expected_updated_at:data.versions.find(v=>v.id===op.draft.id)?.updated_at} : {})}) }
                        );
                        const result = await response.json();
                        if (!response.ok || result.error) throw new Error(`${FREQUENCY_LABELS[op.freq]}: ${result.error || 'Unable to save the withholding tax table.'}`);
                        delete remainingDrafts[op.freq];
                    }
                }
            } finally {
                // Anything that was saved disappears from the staged list; anything that failed stays for another try.
                setDrafts(remainingDrafts);
                setPendingDeletes(remainingDeletes);
                await load();
            }
        },
    }), [drafts, pendingDeletes, today, unsaved, load, data]);

    useEffect(() => {
        const channel = supabase.channel('admin-live-payroll-ledger')
            .on('broadcast', {event:'WITHHOLDING_TAX_TABLES_UPDATED'}, () => {load().catch(()=>{});}).subscribe();
        return () => {supabase.removeChannel(channel);};
    }, [load]);

    const switchFrequency = (next) => setFrequency(next);

    const openNew = () => setEditor({ id: null, effective_from: '', rows: toRowDrafts(activeBrackets) });
    const openEdit = (version) => setEditor({ id: version.id, effective_from: version.effective_from, rows: toRowDrafts(version.brackets) });
    const setRow = (index, field, value) => {
        if (value !== '' && !AMOUNT_INPUT.test(value)) return;
        setEditor(prev => ({ ...prev, rows: prev.rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)) }));
    };
    const addRow = () => setEditor(prev => ({ ...prev, rows: [...prev.rows, { over: '', base: '', rate: '' }] }));
    const removeRow = (index) => setEditor(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== index) }));
    const resetRows = () => setEditor(prev => ({ ...prev, rows: toRowDrafts(data.defaults[frequency]) }));
    const toggleDelete = (version) => setPendingDeletes(prev => (prev.includes(version.id) ? prev.filter(id => id !== version.id) : [...prev, version.id]));

    const inputClass = 'w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-sm text-slate-800 font-semibold focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100 shadow-2xs read-only:bg-slate-50 read-only:text-slate-500';
    const smallButton = 'h-8 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-md transition-colors duration-100 cursor-pointer';

    const pendingBadge = (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded border bg-warning-subtle text-warning-ink border-warning/20">Deleted when you save</span>
    );

    return (
        // Enter inside these fields must not submit the whole settings form.
        <div onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }} className="bg-white rounded-lg p-5 shadow-2xs border border-slate-200 space-y-5">
            <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <i className="ti ti-receipt-tax text-base" />
                </div>
                <div>
                    <h2 className="text-base font-bold text-slate-800">Withholding Tax Tables (BIR)</h2>
                    <p className="text-xs text-slate-500 mt-0.5">When BIR changes the rates, add a new version with the date it takes effect. Payslips already issued keep their amounts.</p>
                </div>
            </div>

            {data?.setup_required && (
                <div className="bg-warning-subtle border border-warning/20 text-warning-ink px-4 py-3 rounded-md text-sm font-semibold">
                    Custom table management is unavailable. Built-in BIR withholding tables remain active.
                </div>
            )}
            {error && (
                <div className="bg-warning-subtle border border-warning/20 text-warning-ink px-4 py-3 rounded-md text-sm font-semibold">{error}</div>
            )}
            {unsaved && (
                <div className="bg-accent-subtle border border-accent/20 text-accent px-4 py-3 rounded-md text-sm font-semibold">
                    You have unsaved withholding tax changes. They are applied when you press Save Changes at the bottom of the page.
                </div>
            )}

            {!data ? (
                <p className="text-xs text-slate-500">{error ? '' : 'Loading withholding tax tables...'}</p>
            ) : (
                <>
                    <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-4">
                        {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => switchFrequency(key)}
                                className={`h-8 px-3 rounded-md text-xs font-semibold border cursor-pointer transition-colors duration-100 flex items-center gap-1.5 ${frequency === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                            >
                                {label}
                                {drafts[key] && <span className="w-1.5 h-1.5 rounded-full bg-warning" title="Unsaved changes" />}
                            </button>
                        ))}
                    </div>

                    {!editor && (
                        <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-slate-800">
                                        {inEffect ? `In effect since ${formatDate(inEffect.effective_from)}` : 'In effect now'}
                                    </p>
                                    {inEffect && isPendingDelete(inEffect) ? pendingBadge : (
                                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${inEffect ? 'bg-accent-subtle text-accent border-accent/20' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                            {inEffect ? 'Custom' : 'Built-in BIR 2023'}
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    {inEffect && canChange(inEffect) && (isPendingDelete(inEffect) ? (
                                        <button type="button" onClick={() => toggleDelete(inEffect)} className={smallButton}>Undo delete</button>
                                    ) : (
                                        <>
                                            <button type="button" onClick={() => openEdit(inEffect)} className={smallButton}>Edit</button>
                                            <button type="button" onClick={() => toggleDelete(inEffect)} className={`${smallButton} text-danger-ink`}>Delete</button>
                                        </>
                                    ))}
                                    <button type="button" disabled={data.setup_required} onClick={openNew} className="h-8 px-3 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 cursor-pointer disabled:opacity-50">
                                        New version
                                    </button>
                                </div>
                            </div>
                            <BracketTable brackets={activeBrackets} />
                        </div>
                    )}

                    {!editor && upcoming.length > 0 && (
                        <div className="space-y-2 border-t border-slate-100 pt-4">
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Scheduled</p>
                            {upcoming.map(version => (
                                <div key={version.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                        <span className={isPendingDelete(version) ? 'line-through text-slate-400' : ''}>Starts {formatDate(version.effective_from)}</span>
                                        {isPendingDelete(version) && pendingBadge}
                                    </span>
                                    <div className="flex gap-2">
                                        {isPendingDelete(version) ? (
                                            <button type="button" onClick={() => toggleDelete(version)} className={smallButton}>Undo delete</button>
                                        ) : (
                                            <>
                                                <button type="button" onClick={() => openEdit(version)} className={smallButton}>Edit</button>
                                                <button type="button" onClick={() => toggleDelete(version)} className={`${smallButton} text-danger-ink`}>Delete</button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {editor && (
                        <>
                            <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                                    <div className="sm:w-56">
                                        <label htmlFor="tax-effective-from" className="block text-xs font-medium text-slate-700 mb-1.5">Effective from</label>
                                        <input
                                            id="tax-effective-from"
                                            type="date"
                                            min={today}
                                            value={editor.effective_from}
                                            onChange={(e) => setEditor(prev => ({ ...prev, effective_from: e.target.value }))}
                                            className={inputClass}
                                        />
                                        <p className="text-[11px] text-slate-400 mt-1">Applies to payrolls whose period ends on or after this date.</p>
                                    </div>
                                    <button type="button" onClick={resetRows} className={smallButton}>Reset to BIR 2023 table</button>
                                </div>

                                <div className="space-y-2">
                                    <div className="hidden sm:grid grid-cols-[1fr_1fr_8rem_2rem] gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                                        <span>Taxable income over (₱)</span>
                                        <span>Base tax (₱)</span>
                                        <span>Plus % of excess</span>
                                        <span />
                                    </div>
                                    {editor.rows.map((row, index) => (
                                        <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem_2rem] gap-2 items-center">
                                            <input aria-label={`Bracket ${index + 1} over`} inputMode="decimal" maxLength={12} value={row.over} readOnly={index === 0} onChange={(e) => setRow(index, 'over', e.target.value)} placeholder="Over (₱)" className={inputClass} />
                                            <input aria-label={`Bracket ${index + 1} base tax`} inputMode="decimal" maxLength={12} value={row.base} readOnly={index === 0} onChange={(e) => setRow(index, 'base', e.target.value)} placeholder="Base tax (₱)" className={inputClass} />
                                            <input aria-label={`Bracket ${index + 1} rate`} inputMode="decimal" maxLength={6} value={row.rate} onChange={(e) => setRow(index, 'rate', e.target.value)} placeholder="Rate (%)" className={inputClass} />
                                            {index > 0 ? (
                                                <button type="button" onClick={() => removeRow(index)} aria-label={`Remove bracket ${index + 1}`} className="w-8 h-9 flex items-center justify-center rounded-md text-slate-400 hover:text-danger-ink hover:bg-white cursor-pointer">
                                                    <i className="ti ti-x text-sm" />
                                                </button>
                                            ) : <span />}
                                        </div>
                                    ))}
                                    <button type="button" disabled={editor.rows.length >= WITHHOLDING_MAX_BRACKETS} onClick={addRow} className={smallButton}>Add bracket</button>
                                </div>

                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                                    <p className="text-[11px] text-slate-500">Saved when you press Save Changes at the bottom of the page.</p>
                                    <button type="button" onClick={() => setEditor(null)} className={smallButton}>Discard changes</button>
                                </div>
                            </div>
                        </>
                    )}

                    {!editor && history.length > 0 && (
                        <div className="space-y-2 border-t border-slate-100 pt-4">
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Earlier versions</p>
                            {history.map(version => (
                                <details key={version.id} className="rounded-md border border-slate-200 px-3 py-2">
                                    <summary className="text-sm font-semibold text-slate-700 cursor-pointer">Started {formatDate(version.effective_from)}</summary>
                                    <div className="mt-2"><BracketTable brackets={version.brackets} /></div>
                                </details>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
});

export default function StatutorySettings({ onBack }) {
    const taxTablesRef = useRef(null);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [fetching, setFetching] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const topRef = useRef(null);

    // The save button is at the bottom of a long page and the result banners are at the top: bring them into view.
    useEffect(() => {
        if (successMessage || errorMessage) topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [successMessage, errorMessage]);

    const getCleanErrorMessage = (err) => {
        if (!err) return "An unexpected error occurred while processing your request.";
        const msg = typeof err === 'string' ? err : err.message || '';

        if (msg.includes('network') || msg.includes('Failed to fetch')) {
            return "Unable to connect to the server. Please check your internet connection.";
        }
        if (msg.includes('permission') || msg.includes('row-level security') || msg.includes('42501')) {
            return "You do not have permission to update statutory settings. Please contact your administrator.";
        }
        return "Unable to update statutory rates right now. Please try again later.";
    };

    useEffect(() => {
        let stopped = false;
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetchWithAuth('/api/payroll/statutory-settings', { signal: controller.signal });
                const data = await response.json();
                if (!response.ok || data.error) throw new Error(data.error || 'Unable to load settings.');
                if (!stopped) { setSettings(previous => ({ ...previous, ...data })); setSettingsLoaded(true); }
            } catch (error) {
                if (!stopped && error.name !== 'AbortError') setErrorMessage('Unable to load current statutory settings. Refresh before saving.');
            } finally { if (!stopped) setFetching(false); }
        };
        load();

        // Enterprise Low-Latency Real-Time Channel via Supabase Realtime
        const channel = supabase
            .channel('realtime:statutory_settings')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'statutory_settings' },
                (payload) => {
                    if (payload.new && !stopped) {
                        setSettings(previous => ({ ...previous, ...payload.new }));
                    }
                }
            )
            .subscribe();

        return () => {
            stopped = true;
            controller.abort();
            supabase.removeChannel(channel);
        };
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (value === '') {
            setSettings(prev => ({ ...prev, [name]: '' }));
            return;
        }

        if (STATUTORY_INPUT_LIMITS[name]) {
            if (!isValidStatutoryInput(name, value)) return;
            setSettings(prev => ({ ...prev, [name]: value }));
            return;
        }

        const numVal = Number(value);
        if (numVal < 0) return;

        setSettings(prev => ({
            ...prev,
            [name]: numVal
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!settingsLoaded || loading) return;
        setErrorMessage('');
        setSuccessMessage('');

        const hasEmpty = Object.entries(settings).some(([key, val]) => key !== 'id' && val === '');
        if (hasEmpty) {
            setErrorMessage("Please complete all required rate and cap fields before saving.");
            return;
        }

        const hasNegative = Object.entries(settings).some(([key, val]) => key !== 'id' && typeof val === 'number' && val < 0);
        if (hasNegative) {
            setErrorMessage("Contribution rates, tardiness deduction, and limits cannot be negative values.");
            return;
        }

        if (Number(settings.philhealth_min_salary) > Number(settings.philhealth_max_salary)) {
            setErrorMessage("PhilHealth Minimum Salary Floor cannot be higher than the Maximum Salary Ceiling.");
            return;
        }

        const validationError = getStatutorySettingsError(settings);
        if (validationError) {
            setErrorMessage(validationError);
            return;
        }

        const taxTableError = taxTablesRef.current?.validate() || '';
        if (taxTableError) {
            setErrorMessage(taxTableError);
            return;
        }

        setLoading(true);

        try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const payload = {
                ...settings,
                admin_id: user?.id,
                updated_at: new Date().toISOString()
            };

            const response = await fetchWithAuth('/api/payroll/statutory-settings', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || 'Unable to save settings.');
            if (data.data) setSettings(previous => ({ ...previous, ...data.data }));

            if (taxTablesRef.current?.hasChanges()) {
                try {
                    await taxTablesRef.current.commit();
                } catch (taxError) {
                    setErrorMessage(`Your other settings were saved, but the withholding tax changes were not: ${taxError.message}`);
                    return;
                }
            }

            setSuccessMessage("Changes saved");
            setTimeout(() => setSuccessMessage(''), 4000);
        } catch (err) {
            console.error("Database update error:", err);
            setErrorMessage(getCleanErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    if (fetching) {
        return (
            <div className="flex items-center justify-center py-20 text-slate-500 font-medium text-sm px-4 text-center">
                <svg className="animate-spin h-5 w-5 mr-3 text-accent shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading settings...
            </div>
        );
    }

    const callHour = Number(settings.call_time_hour ?? 8);
    const callMin = Number(settings.call_time_minute ?? 0);
    const graceMins = Number(settings.grace_period_minutes ?? 15);
    const lateRate = Number(settings.late_rate_per_minute ?? 25);

    const formatTimeDisplay = (hour, minute) => {
        const period = hour >= 12 ? 'PM' : 'AM';
        const h12 = hour % 12 === 0 ? 12 : hour % 12;
        const mStr = String(minute).padStart(2, '0');
        return `${h12}:${mStr} ${period}`;
    };

    const callTimeFormatted = formatTimeDisplay(callHour, callMin);
    const totalDeadlineMins = callHour * 60 + callMin + graceMins;
    const deadlineHour = Math.floor(totalDeadlineMins / 60) % 24;
    const deadlineMin = totalDeadlineMins % 60;
    const graceDeadlineFormatted = formatTimeDisplay(deadlineHour, deadlineMin);

    return (
        <div className="space-y-5 sm:space-y-6 max-w-7xl mx-auto pb-12 px-3 sm:px-4 md:px-0">
            <div ref={topRef} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <BackButton fallback="/admin/payroll" label="Back to Payroll" onClick={onBack} />
                <div className="flex items-center gap-2">
                </div>
            </div>

            {/* HR Success Alert */}
            {successMessage && (
                <div className="bg-success-subtle border border-success/20 text-success-ink px-4 py-3 rounded-md flex items-start sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-start sm:items-center space-x-2">
                        <svg className="w-5 h-5 text-ink flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-semibold text-sm">{successMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSuccessMessage('')}
                        className="w-7 h-7 rounded-md text-success-ink hover:text-success-ink hover:bg-success-subtle text-sm font-bold cursor-pointer shrink-0 flex items-center justify-center transition-colors duration-100"
                        aria-label="Dismiss success message"
                    >
                        <i className="ti ti-x text-sm" />
                    </button>
                </div>
            )}

            {/* HR Error Alert */}
            {errorMessage && (
                <div className="bg-warning-subtle border border-warning/20 text-warning-ink px-4 py-3 rounded-md flex items-start sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-start sm:items-center space-x-2">
                        <svg className="w-5 h-5 text-warning-ink flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="font-semibold text-sm">{errorMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorMessage('')}
                        className="w-7 h-7 rounded-md text-warning-ink hover:text-warning-ink hover:bg-warning-subtle text-sm font-bold cursor-pointer shrink-0 flex items-center justify-center transition-colors duration-100"
                        aria-label="Dismiss error message"
                    >
                        <i className="ti ti-x text-sm" />
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                {/* SSS Contributions Card */}
                <div className="bg-white rounded-lg p-5 shadow-2xs border border-slate-200">
                    <div className="flex items-center space-x-3 mb-5">
                        <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V9a2 2 0 012-2h2a2 2 0 012 2v12" />
                            </svg>
                        </div>
                        <h2 className="text-base font-bold text-slate-800">SSS Contributions</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <FieldInput label="Employee share (%)" name="sss_employee_rate" value={settings.sss_employee_rate} onChange={handleChange} step="0.01" focusColor="blue" />
                        <FieldInput label="Employer share (%)" name="sss_employer_rate" value={settings.sss_employer_rate} onChange={handleChange} step="0.01" focusColor="blue" />
                        <FieldInput label="Maximum salary credit (₱)" name="sss_max_msc" value={settings.sss_max_msc} onChange={handleChange} focusColor="blue" />
                    </div>
                </div>

                {/* PhilHealth Contributions Card */}
                <div className="bg-white rounded-lg p-5 shadow-2xs border border-slate-200">
                    <div className="flex items-center space-x-3 mb-5">
                        <div className="w-8 h-8 rounded-md bg-danger-subtle text-danger-ink flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.684a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                        </div>
                        <h2 className="text-base font-bold text-slate-800">PhilHealth Contributions</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <FieldInput label="Premium rate (%)" name="philhealth_rate" value={settings.philhealth_rate} onChange={handleChange} step="0.01" focusColor="rose" />
                        <FieldInput label="Minimum salary floor (₱)" name="philhealth_min_salary" value={settings.philhealth_min_salary} onChange={handleChange} focusColor="rose" />
                        <FieldInput label="Maximum salary ceiling (₱)" name="philhealth_max_salary" value={settings.philhealth_max_salary} onChange={handleChange} focusColor="rose" />
                    </div>
                </div>

                {/* Pag-IBIG Contributions Card */}
                <div className="bg-white rounded-lg p-5 shadow-2xs border border-slate-200">
                    <div className="flex items-center space-x-3 mb-5">
                        <div className="w-8 h-8 rounded-md bg-surface-muted text-ink flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                        </div>
                        <h2 className="text-base font-bold text-slate-800">Pag-IBIG (HDMF) Contributions</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <FieldInput label="Employee share (%)" name="pagibig_employee_rate" value={settings.pagibig_employee_rate} onChange={handleChange} step="0.01" focusColor="emerald" />
                        <FieldInput label="Employer share (%)" name="pagibig_employer_rate" value={settings.pagibig_employer_rate} onChange={handleChange} step="0.01" focusColor="emerald" />
                        <FieldInput label="Maximum contribution (₱)" name="pagibig_max_contribution" value={settings.pagibig_max_contribution} onChange={handleChange} focusColor="emerald" />
                    </div>
                </div>

                {/* Attendance, Grace Period & Tardiness Policy Card */}
                <div className="bg-white rounded-lg p-5 shadow-2xs border border-slate-200 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                            <h2 className="text-base font-bold text-slate-900">Attendance, Grace Period &amp; Tardiness Policy</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                </p>
                            </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <FieldInput
                            label="Tardiness deduction rate (₱ / minute)"
                            name="late_rate_per_minute"
                            value={settings.late_rate_per_minute}
                            onChange={handleChange}
                            step="0.01"
                            focusColor="blue"
                        />
                        <FieldInput
                            label="Grace period window (minutes)"
                            name="grace_period_minutes"
                            value={settings.grace_period_minutes}
                            onChange={handleChange}
                            step="1"
                            focusColor="blue"
                        />
                        <FieldInput
                            label="Shift call time hour (0 - 23)"
                            name="call_time_hour"
                            value={settings.call_time_hour}
                            onChange={handleChange}
                            step="1"
                            focusColor="blue"
                        />
                        <FieldInput
                            label="Shift call time minute (0 - 59)"
                            name="call_time_minute"
                            value={settings.call_time_minute}
                            onChange={handleChange}
                            step="1"
                            focusColor="blue"
                        />
                    </div>

                    {/* Live Enterprise Policy Simulation & Ledger Preview */}
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <i className="ti ti-calculator text-slate-600 text-sm" />
                                Policy Preview
                            </span>
                            <span className="text-[11px] font-semibold text-slate-600">
                                Call Time: <strong className="font-mono text-slate-900">{callTimeFormatted}</strong> &middot; Grace Deadline: <strong className="font-mono text-slate-900">{graceDeadlineFormatted}</strong>
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="bg-white rounded-md p-3 border border-slate-200 shadow-2xs">
                                <p className="text-[11px] font-semibold text-slate-500 uppercase">Within Grace Window</p>
                                <p className="text-xs font-medium text-slate-700 mt-1">Clock-in prior to {graceDeadlineFormatted}</p>
                                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                    <span className="text-xs text-slate-500">Deduction:</span>
                                    <span className="font-mono font-bold text-sm text-slate-900">₱0.00</span>
                                </div>
                            </div>

                            <div className="bg-white rounded-md p-3 border border-slate-200 shadow-2xs">
                                <p className="text-[11px] font-semibold text-slate-500 uppercase">Moderate Lateness (5 mins past grace)</p>
                                <p className="text-xs font-medium text-slate-700 mt-1">5 chargeable whole minutes</p>
                                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                    <span className="text-xs text-slate-500">5 mins &times; ₱{lateRate.toFixed(2)}:</span>
                                    <span className="font-mono font-bold text-sm text-slate-900">
                                        ₱{(5 * lateRate).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>

                            <div className="bg-white rounded-md p-3 border border-slate-200 shadow-2xs">
                                <p className="text-[11px] font-semibold text-slate-500 uppercase">High Lateness (30 mins past grace)</p>
                                <p className="text-xs font-medium text-slate-700 mt-1">30 chargeable whole minutes</p>
                                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                                    <span className="text-xs text-slate-500">30 mins &times; ₱{lateRate.toFixed(2)}:</span>
                                    <span className="font-mono font-bold text-sm text-slate-900">
                                        ₱{(30 * lateRate).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-start gap-1.5 pt-1">
                            <span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* Piece-rate holiday pay floor */}
                <div className="bg-white rounded-lg p-5 shadow-2xs border border-slate-200">
                    <div className="flex items-center space-x-3 mb-5">
                        <div className="w-8 h-8 rounded-md bg-surface-muted text-ink flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h2 className="text-base font-bold text-slate-800">Holiday Pay Floor (Piece-Rate Workers)</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <FieldInput label="Daily minimum wage (₱)" name="minimum_daily_wage" value={settings.minimum_daily_wage} onChange={handleChange} step="0.01" focusColor="blue"  />
                    </div>
                </div>

                {/* BIR Withholding Tax Tables: staged here, saved by the single Save Changes button below */}
                <WithholdingTaxTables ref={taxTablesRef} />

                <div className="flex justify-end pt-3 sticky bottom-0 sm:static bg-white border-t border-slate-200 sm:border-0 sm:bg-transparent pb-3 sm:pb-0 -mx-3 px-3 sm:mx-0 sm:px-0">
                    <button
                        type="submit"
                        disabled={loading || !settingsLoaded}
                        className="w-full sm:w-auto h-9 px-6 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                    >
                        {loading && (
                            <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                        )}
                        <span>{loading ? 'Saving Changes...' : 'Save Changes'}</span>
                    </button>
                </div>
            </form>

        </div>
    );
}
