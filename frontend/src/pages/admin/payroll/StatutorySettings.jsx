import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';

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
            type="number"
            inputMode="decimal"
            min="0"
            id={name}
            name={name}
            value={value ?? ''}
            onChange={onChange}
            className={`w-full h-9 bg-white border border-slate-200 rounded-md px-3 text-sm text-slate-800 font-semibold focus:outline-none ${FOCUS_STYLES[focusColor] || FOCUS_STYLES.blue} transition-colors duration-100 shadow-2xs`}
            {...props}
        />
        {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
);

export default function StatutorySettings({ onBack }) {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [fetching, setFetching] = useState(true);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [realtimeSynced, setRealtimeSynced] = useState(false);

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
                        setRealtimeSynced(true);
                        setTimeout(() => setRealtimeSynced(false), 3500);
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

        if (Number(settings.call_time_hour) < 0 || Number(settings.call_time_hour) > 23) {
            setErrorMessage("Shift call time hour must be between 0 and 23 (e.g. 8 for 8:00 AM).");
            return;
        }

        if (Number(settings.call_time_minute) < 0 || Number(settings.call_time_minute) > 59) {
            setErrorMessage("Shift call time minute must be between 0 and 59 (e.g. 0 for 8:00 AM).");
            return;
        }

        if (Number(settings.grace_period_minutes) < 0 || Number(settings.grace_period_minutes) > 1440) {
            setErrorMessage("Grace period must be between 0 and 1440 minutes.");
            return;
        }

        if (Number(settings.late_rate_per_minute) < 0 || Number(settings.late_rate_per_minute) > 10000) {
            setErrorMessage("Tardiness deduction rate must be between ₱0 and ₱10,000 per minute.");
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={() => onBack ? onBack() : window.history.back()}
                    className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-xs font-semibold rounded-md transition-colors duration-100 group cursor-pointer h-8 px-2"
                >
                    <svg
                        className="w-4 h-4 transform group-hover:-translate-x-0.5 transition-transform duration-100 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    <span>Back to Payroll</span>
                </button>
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
                        <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                <i className="ti ti-clock-check text-base" />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-slate-900">Attendance, Grace Period &amp; Tardiness Policy</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                </p>
                            </div>
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