import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export default function StatutorySettings() {
    const [settings, setSettings] = useState({
        sss_employee_rate: 4.5,
        sss_employer_rate: 9.5,
        sss_max_msc: 30000,
        philhealth_rate: 5.0,
        philhealth_min_salary: 10000,
        philhealth_max_salary: 100000,
        pagibig_employee_rate: 2.0,
        pagibig_employer_rate: 2.0,
        pagibig_max_contribution: 200,
    });

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        const fetchStatutorySettings = async () => {
            setIsLoading(true);
            try {
                // Updated URL to include /payroll route prefix
                const res = await fetch('http://localhost:5000/api/payroll/statutory-settings');
                const result = await res.json();

                if (res.ok && (result.data || result.success || result.sss_employee_rate !== undefined)) {
                    setSettings(result.data || result);
                } else {
                    toast.error(result.error || 'Failed to load statutory settings from server');
                }
            } catch (err) {
                console.error('Error fetching statutory settings:', err);
                toast.error('Failed to load statutory settings from server');
            } finally {
                setIsLoading(false);
            }
        };

        fetchStatutorySettings();
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings((prev) => ({
            ...prev,
            [name]: value === '' ? '' : Number(value)
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);

        try {
            // Updated URL to include /payroll prefix and matched backend PUT method
            const res = await fetch('http://localhost:5000/api/payroll/statutory-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });

            const result = await res.json();

            if (res.ok && (result.success || !result.error)) {
                toast.success('Statutory settings saved successfully!');
            } else {
                toast.error(result.error || 'Failed to save statutory settings');
            }
        } catch (err) {
            console.error('Error saving settings:', err);
            toast.error('Network error saving statutory settings');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="p-8 text-center text-slate-500 font-bold">
                Loading Statutory Settings...
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            <div className="mb-6">
                <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                    Statutory Contribution Settings
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Manage mandatory Philippine government deduction rates (SSS, PhilHealth, Pag-IBIG).
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* SSS Settings */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="ti ti-building-bank text-blue-600 text-xl" /> SSS Contributions
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Employee Share (%)
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                name="sss_employee_rate"
                                value={settings.sss_employee_rate ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Employer Share (%)
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                name="sss_employer_rate"
                                value={settings.sss_employer_rate ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Max Salary Credit (₱)
                            </label>
                            <input
                                type="number"
                                name="sss_max_msc"
                                value={settings.sss_max_msc ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* PhilHealth Settings */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="ti ti-heart-handshake text-red-600 text-xl" /> PhilHealth Contributions
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Total Premium Rate (%)
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                name="philhealth_rate"
                                value={settings.philhealth_rate ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Min Salary Floor (₱)
                            </label>
                            <input
                                type="number"
                                name="philhealth_min_salary"
                                value={settings.philhealth_min_salary ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Max Salary Ceiling (₱)
                            </label>
                            <input
                                type="number"
                                name="philhealth_max_salary"
                                value={settings.philhealth_max_salary ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Pag-IBIG Settings */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                    <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="ti ti-home-heart text-green-600 text-xl" /> Pag-IBIG (HDMF) Contributions
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Employee Share (%)
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                name="pagibig_employee_rate"
                                value={settings.pagibig_employee_rate ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Employer Share (%)
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                name="pagibig_employer_rate"
                                value={settings.pagibig_employer_rate ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                Max Monthly Contribution (₱)
                            </label>
                            <input
                                type="number"
                                name="pagibig_max_contribution"
                                value={settings.pagibig_max_contribution ?? ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-md transition flex items-center gap-2"
                    >
                        <i className="ti ti-device-floppy text-lg" />
                        {isSaving ? 'Saving Changes...' : 'Save Settings'}
                    </button>
                </div>
            </form>
        </div>
    );
}