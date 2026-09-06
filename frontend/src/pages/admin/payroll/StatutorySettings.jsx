import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient'; // Adjust path if needed

const DEFAULT_SETTINGS = {
    sss_employee_rate: 5,         // 5%
    sss_employer_rate: 10,        // 10%
    sss_max_msc: 35000,           // 2026 SSS MSC Cap (P35,000)
    philhealth_rate: 5,           // 5% Total
    philhealth_min_salary: 10000,
    philhealth_max_salary: 100000,
    pagibig_employee_rate: 2,     // 2%
    pagibig_employer_rate: 2,     // 2%
    pagibig_max_contribution: 100 // P100 Max EE share (P200 total EE+ER)
};

// Static class lookup map to fix Tailwind CSS JIT compilation issue with dynamic string interpolation
const FOCUS_STYLES = {
    blue: 'focus:ring-blue-500/20 focus:border-blue-500',
    rose: 'focus:ring-rose-500/20 focus:border-rose-500',
    emerald: 'focus:ring-emerald-500/20 focus:border-emerald-500'
};

// Moved component outside parent to preserve input DOM identity and focus state across re-renders
const FieldInput = ({ label, name, value, onChange, focusColor = 'blue', ...props }) => (
    <div>
        <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{label}</label>
        <input
            type="number"
            inputMode="decimal"
            min="0"
            name={name}
            value={value ?? ''}
            onChange={onChange}
            className={`w-full bg-[#f8fafc] border border-slate-200/80 rounded-xl px-4 py-3.5 sm:py-3 text-base sm:text-sm text-slate-800 font-semibold focus:outline-none focus:ring-2 ${FOCUS_STYLES[focusColor] || FOCUS_STYLES.blue} transition-all min-h-[48px]`}
            {...props}
        />
    </div>
);

export default function StatutorySettings({ onBack }) {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [fetching, setFetching] = useState(true);
    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        fetchSettings();
    }, []);

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

    const fetchSettings = async () => {
        try {
            setFetching(true);
            const { data, error } = await supabase
                .from('statutory_settings')
                .select('*')
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                setSettings(data);
            }
        } catch (err) {
            console.error("Database fetch error:", err);
            setErrorMessage("Unable to load current statutory settings. Default values are shown.");
        } finally {
            setFetching(false);
        }
    };

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
        setErrorMessage('');
        setSuccessMessage('');

        const hasEmpty = Object.entries(settings).some(([key, val]) => key !== 'id' && val === '');
        if (hasEmpty) {
            setErrorMessage("Please complete all required rate and cap fields before saving.");
            return;
        }

        const hasNegative = Object.entries(settings).some(([key, val]) => key !== 'id' && typeof val === 'number' && val < 0);
        if (hasNegative) {
            setErrorMessage("Contribution rates and salary limits cannot be negative values.");
            return;
        }

        if (Number(settings.philhealth_min_salary) > Number(settings.philhealth_max_salary)) {
            setErrorMessage("PhilHealth Minimum Salary Floor cannot be higher than the Maximum Salary Ceiling.");
            return;
        }

        setLoading(true);

        try {
            const payload = {
                ...settings,
                updated_at: new Date().toISOString()
            };

            let error;
            if (settings.id) {
                ({ error } = await supabase
                    .from('statutory_settings')
                    .update(payload)
                    .eq('id', settings.id));
            } else {
                const { data: inserted, error: insErr } = await supabase
                    .from('statutory_settings')
                    .insert([payload])
                    .select()
                    .single();

                error = insErr;
                if (inserted) setSettings(inserted);
            }

            if (error) throw error;

            setSuccessMessage("Statutory settings updated successfully.");
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
                <svg className="animate-spin h-5 w-5 mr-3 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading settings...
            </div>
        );
    }

    return (
        <div className="space-y-5 sm:space-y-6 max-w-7xl mx-auto pb-12 px-3 sm:px-4 md:px-0">
            <div>
                <button
                    type="button"
                    onClick={() => onBack ? onBack() : window.history.back()}
                    className="inline-flex items-center space-x-2 text-slate-500 hover:text-slate-800 text-sm font-semibold transition-colors group cursor-pointer min-h-[44px] -ml-1 px-1"
                >
                    <svg
                        className="w-4 h-4 transform group-hover:-translate-x-0.5 transition-transform shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    <span>Back to Payroll</span>
                </button>
            </div>

            {/* HR Success Alert */}
            {successMessage && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-start sm:items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-start sm:items-center space-x-2">
                        <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-semibold text-sm">{successMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSuccessMessage('')}
                        className="text-emerald-600 hover:text-emerald-800 text-sm font-bold ml-2 cursor-pointer shrink-0 min-h-[32px] min-w-[32px]"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* HR Error Alert */}
            {errorMessage && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex items-start sm:items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-start sm:items-center space-x-2">
                        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="font-semibold text-sm">{errorMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorMessage('')}
                        className="text-amber-700 hover:text-amber-900 text-sm font-bold ml-2 cursor-pointer shrink-0 min-h-[32px] min-w-[32px]"
                    >
                        ✕
                    </button>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                {/* SSS Contributions Card */}
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100/80">
                    <div className="flex items-center space-x-3 mb-5 sm:mb-6">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V9a2 2 0 012-2h2a2 2 0 012 2v12" />
                            </svg>
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800">SSS Contributions</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 sm:gap-6">
                        <FieldInput label="EMPLOYEE SHARE (%)" name="sss_employee_rate" value={settings.sss_employee_rate} onChange={handleChange} step="0.01" focusColor="blue" />
                        <FieldInput label="EMPLOYER SHARE (%)" name="sss_employer_rate" value={settings.sss_employer_rate} onChange={handleChange} step="0.01" focusColor="blue" />
                        <FieldInput label="MAX SALARY CREDIT (₱)" name="sss_max_msc" value={settings.sss_max_msc} onChange={handleChange} focusColor="blue" />
                    </div>
                </div>

                {/* PhilHealth Contributions Card */}
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100/80">
                    <div className="flex items-center space-x-3 mb-5 sm:mb-6">
                        <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.684a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800">PhilHealth Contributions</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 sm:gap-6">
                        <FieldInput label="TOTAL PREMIUM RATE (%)" name="philhealth_rate" value={settings.philhealth_rate} onChange={handleChange} step="0.01" focusColor="rose" />
                        <FieldInput label="MIN SALARY FLOOR (₱)" name="philhealth_min_salary" value={settings.philhealth_min_salary} onChange={handleChange} focusColor="rose" />
                        <FieldInput label="MAX SALARY CEILING (₱)" name="philhealth_max_salary" value={settings.philhealth_max_salary} onChange={handleChange} focusColor="rose" />
                    </div>
                </div>

                {/* Pag-IBIG Contributions Card */}
                <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-100/80">
                    <div className="flex items-center space-x-3 mb-5 sm:mb-6">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                        </div>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-800">Pag-IBIG (HDMF) Contributions</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 sm:gap-6">
                        <FieldInput label="EMPLOYEE SHARE (%)" name="pagibig_employee_rate" value={settings.pagibig_employee_rate} onChange={handleChange} step="0.01" focusColor="emerald" />
                        <FieldInput label="EMPLOYER SHARE (%)" name="pagibig_employer_rate" value={settings.pagibig_employer_rate} onChange={handleChange} step="0.01" focusColor="emerald" />
                        <FieldInput label="EE MAX MONTHLY CAP (₱)" name="pagibig_max_contribution" value={settings.pagibig_max_contribution} onChange={handleChange} focusColor="emerald" />
                    </div>
                </div>

                <div className="flex justify-end pt-2 sticky bottom-0 sm:static bg-white/95 backdrop-blur-xs sm:bg-transparent pb-3 sm:pb-0 -mx-3 px-3 sm:mx-0 sm:px-0">
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-8 py-3.5 sm:py-3 rounded-xl shadow-sm transition duration-150 disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2 min-h-[52px]"
                    >
                        {loading && (
                            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
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