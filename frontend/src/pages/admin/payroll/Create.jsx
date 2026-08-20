import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Flatpickr from 'react-flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { fetchWithAuth } from '../../../utils/api';
import { motion } from 'framer-motion';

const formatLocalDate = (d) => {
    if (!d) return '';
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return '';
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatReadableDate = (dateStr) => {
    if (!dateStr) return 'Select Date';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const HOLIDAY_LABELS = {
    regular: 'Regular Holiday',
    special_non_working: 'Special Non-Working Day',
};

const PayrollCreate = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [employees, setEmployees] = useState([]);
    const [formData, setFormData] = useState({
        employee_id: '',
        period_start: '',
        period_end: '',
        days_worked: 0,
        overtime_hours: 0,
        late_deductions: ''
    });
    const [activePreset, setActivePreset] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isCalculating, setIsCalculating] = useState(false);

    // Holiday pay preview — fetched from POST /api/payroll/preview, which
    // runs the exact same payrollCalculations logic the backend uses on
    // submit. Informational only: this component holds no calculation
    // logic of its own, so the preview can never drift from what actually
    // gets saved.
    const [holidayPreview, setHolidayPreview] = useState({ items: [], totalHolidayPay: 0 });

    useEffect(() => {
        fetchWithAuth('/api/employees')
            .then(res => res.json())
            .then(result => {
                const list = Array.isArray(result) ? result : (result.data || []);
                // Admin and security accounts aren't paid through this
                // payroll flow, so they shouldn't appear in the picker.
                const payableList = list.filter(e => {
                    const roleStr = (e.role || '').toLowerCase();
                    return roleStr !== 'admin' && roleStr !== 'security';
                });
                setEmployees(payableList);
            })
            .catch(err => console.error('Failed to load employees:', err));

        const style = document.createElement('style');
        style.id = 'custom-payroll-flatpickr-style';
        style.innerHTML = `
            .flatpickr-calendar {
                background: #ffffff !important;
                border-radius: 1.25rem !important;
                border: 1px solid #e2e8f0 !important;
                box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25) !important;
                padding: 12px !important;
                font-family: inherit !important;
                width: min(320px, calc(100vw - 2rem)) !important;
                max-width: calc(100vw - 2rem) !important;
            }
            .flatpickr-months {
                margin-bottom: 8px !important;
            }
            .flatpickr-months .flatpickr-month {
                color: #0f172a !important;
                font-weight: 800 !important;
                font-size: 1.05rem !important;
            }
            .flatpickr-current-month {
                padding-top: 4px !important;
            }
            .flatpickr-current-month .flatpickr-monthDropdown-months {
                font-weight: 800 !important;
                color: #0f172a !important;
            }
            .flatpickr-weekdays {
                margin-bottom: 6px !important;
            }
            span.flatpickr-weekday {
                color: #64748b !important;
                font-weight: 700 !important;
                font-size: 0.8rem !important;
            }
            .flatpickr-days {
                width: 100% !important;
            }
            .dayContainer {
                width: 100% !important;
                min-width: 100% !important;
                max-width: 100% !important;
                justify-content: space-around !important;
            }
            .flatpickr-day {
                border-radius: 0.75rem !important;
                font-weight: 600 !important;
                color: #1e293b !important;
                height: 42px !important;
                line-height: 42px !important;
                margin: 2px 0 !important;
                transition: all 0.15s ease !important;
                touch-action: manipulation !important;
            }
            .flatpickr-day:hover {
                background: #eff6ff !important;
                color: #2563eb !important;
            }
            .flatpickr-day.selected, .flatpickr-day.startRange, .flatpickr-day.endRange {
                background: #2563eb !important;
                border-color: #2563eb !important;
                color: #ffffff !important;
                font-weight: 800 !important;
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35) !important;
            }
            .flatpickr-day.today {
                border-color: #93c5fd !important;
                background: #f0f9ff !important;
                color: #0284c7 !important;
            }
            .flatpickr-day.prevMonthDay, .flatpickr-day.nextMonthDay {
                color: #cbd5e1 !important;
            }
            .flatpickr-prev-month, .flatpickr-next-month {
                padding: 6px !important;
                border-radius: 0.5rem !important;
            }
            .flatpickr-prev-month:hover svg, .flatpickr-next-month:hover svg {
                fill: #2563eb !important;
            }
        `;
        document.head.appendChild(style);
        return () => {
            const el = document.getElementById('custom-payroll-flatpickr-style');
            if (el) document.head.removeChild(el);
        };
    }, []);

    useEffect(() => {
        applyCutoffPreset('current_1st');
    }, []);

    const applyCutoffPreset = (presetKey) => {
        setActivePreset(presetKey);
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        let start, end;
        if (presetKey === 'current_1st') {
            start = new Date(year, month, 1);
            end = new Date(year, month, 15);
        } else if (presetKey === 'current_2nd') {
            start = new Date(year, month, 16);
            end = new Date(year, month + 1, 0);
        } else if (presetKey === 'prev_2nd') {
            start = new Date(year, month - 1, 16);
            end = new Date(year, month, 0);
        } else if (presetKey === 'full_month') {
            start = new Date(year, month, 1);
            end = new Date(year, month + 1, 0);
        }

        if (start && end) {
            setFormData(prev => ({
                ...prev,
                period_start: formatLocalDate(start),
                period_end: formatLocalDate(end)
            }));
        }
    };

    const periodDaysCount = useMemo(() => {
        if (!formData.period_start || !formData.period_end) return 0;
        const s = new Date(formData.period_start + 'T00:00:00');
        const e = new Date(formData.period_end + 'T00:00:00');
        if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
        const diffTime = Math.abs(e - s);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }, [formData.period_start, formData.period_end]);

    const selectedEmployee = useMemo(() => {
        return employees.find(e => String(e.id) === String(formData.employee_id));
    }, [employees, formData.employee_id]);

    useEffect(() => {
        const calculatePayroll = async () => {
            if (formData.employee_id && formData.period_start && formData.period_end) {
                setIsCalculating(true);
                try {
                    // Attendance drives the client-side days_worked/overtime
                    // display; the holiday-pay figure is NOT computed here —
                    // it's fetched from the backend's /preview endpoint below,
                    // so this component never carries its own copy of the
                    // DOLE holiday math to drift out of sync with what
                    // actually gets saved on submit.
                    const [attendanceRes, previewRes] = await Promise.all([
                        fetchWithAuth(`/api/attendance?employee_id=${formData.employee_id}&start_date=${formData.period_start}&end_date=${formData.period_end}`),
                        fetchWithAuth('/api/payroll/preview', {
                            method: 'POST',
                            body: JSON.stringify({
                                employee_id: formData.employee_id,
                                period_start: formData.period_start,
                                period_end: formData.period_end,
                            }),
                        }),
                    ]);

                    const rawLogs = await attendanceRes.json();
                    const previewData = await previewRes.json().catch(() => ({ items: [], totalHolidayPay: 0 }));

                    // FIX: /api/attendance can return either a raw array or a
                    // wrapped { data: [...] } object (same as /api/employees
                    // above). The old code only handled the raw-array case,
                    // so a wrapped response silently produced an empty list
                    // and days_worked/overtime_hours stayed at 0.
                    const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs.data || rawLogs.logs || []);

                    setHolidayPreview(
                        previewRes.ok && Array.isArray(previewData.items)
                            ? previewData
                            : { items: [], totalHolidayPay: 0 }
                    );

                    const doleDivisor = 21.75;
                    const gracePeriodMins = 15;

                    const salary = selectedEmployee ? parseFloat(selectedEmployee.salary || selectedEmployee.monthly_salary || 0) : 0;
                    const dailyRate = salary / doleDivisor;
                    const hourlyRate = dailyRate / 8;
                    const perMinuteRate = hourlyRate / 60;

                    let daysWorked = 0;
                    let totalOvertime = 0;
                    let adjustments = 0;

                    const completedLogs = Array.isArray(logs) ? logs.filter(l => l && l.time_out) : [];
                    daysWorked = completedLogs.length;

                    completedLogs.forEach(log => {
                        const timeIn = new Date(log.time_in);
                        const timeOut = new Date(log.time_out);
                        const scheduleStart = new Date((log.date || (typeof log.time_in === 'string' ? log.time_in.split('T')[0] : '')) + 'T08:00:00');

                        if (!isNaN(timeIn.getTime()) && timeIn > scheduleStart) {
                            const minutes = Math.floor((timeIn - scheduleStart) / 60000);
                            if (minutes > gracePeriodMins) {
                                adjustments += (minutes * perMinuteRate);
                            }
                        }

                        if (!isNaN(timeIn.getTime()) && !isNaN(timeOut.getTime())) {
                            const hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                            if (hoursWorked > 9) {
                                totalOvertime += (hoursWorked - 9);
                            }
                        }
                    });

                    setFormData(prev => ({
                        ...prev,
                        days_worked: daysWorked,
                        overtime_hours: parseFloat(totalOvertime.toFixed(2)),
                        late_deductions: adjustments > 0 ? adjustments.toFixed(2) : ''
                    }));

                } catch (err) {
                    console.error('Calculation error:', err);
                    setHolidayPreview({ items: [], totalHolidayPay: 0 });
                } finally {
                    setIsCalculating(false);
                }
            }
        };
        calculatePayroll();
    }, [formData.employee_id, formData.period_start, formData.period_end, selectedEmployee]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setIsSubmitting(true);

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const payload = { ...formData, admin_id: user?.id };

            const response = await fetchWithAuth('/api/payroll', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || data.error) {
                setError(data.error || 'Failed to compute payroll');
                setIsSubmitting(false);
            } else {
                setSuccess('Payroll Computed & Saved to Ledger!');

                const newRecord = data.data || data.payroll || data;

                // If the response includes enough shape to render a row
                // (an id and the linked employee), prepend it to every
                // cached payroll list immediately — the new payslip shows
                // up on PayrollIndex before the network refetch even
                // finishes. If the response shape is unfamiliar, skip the
                // optimistic prepend and fall back to a plain invalidate.
                if (newRecord && newRecord.id && newRecord.employees) {
                    queryClient.setQueriesData({ queryKey: ['adminPayrolls'] }, (old) => {
                        if (!Array.isArray(old)) return old;
                        return [newRecord, ...old];
                    });
                }

                // Kick off the background refetch right away rather than
                // waiting for the navigation delay below — by the time the
                // list renders, it's either already correct (optimistic
                // prepend) or the refetch has had a head start.
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });

                // Still give the user a moment to see the success message
                // before navigating — this delay no longer blocks the data
                // from being ready.
                setTimeout(() => {
                    navigate('/admin/payroll');
                }, 900);
            }
        } catch (err) {
            setError('Connection error. Please check your network.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto py-6 sm:py-8 px-4 sm:px-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <div className="bg-white p-5 sm:p-10 rounded-3xl sm:rounded-[2rem] shadow-sm border border-slate-100">

                <div className="flex items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
                    <div className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white rounded-2xl flex items-center justify-center text-xl sm:text-2xl shadow-lg shadow-blue-500/20">
                        <i className="ti ti-calculator"></i>
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-xl sm:text-3xl font-black text-slate-800 tracking-tight leading-tight">Payroll Calculator</h2>
                        <p className="text-slate-400 text-[11px] sm:text-sm font-semibold uppercase tracking-wider mt-0.5 leading-snug">Automated DOLE Wage &amp; Deductions Computation</p>
                    </div>
                </div>

                {error && (
                    <div className="mb-8 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-red-500 mt-0.5 text-xl"></i>
                        <div>
                            <h4 className="text-sm font-bold text-red-800">Action Stopped</h4>
                            <p className="text-sm text-red-600 mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {success && (
                    <div className="mb-8 p-4 bg-emerald-50 border-l-4 border-emerald-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-circle-check text-emerald-500 mt-0.5 text-xl"></i>
                        <div>
                            <h4 className="text-sm font-bold text-emerald-800">Success</h4>
                            <p className="text-sm text-emerald-600 mt-1">{success}</p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-8">
                    <div className="bg-slate-50/80 p-5 sm:p-6 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                <i className="ti ti-user"></i>
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Employee Directory</h3>
                                <p className="text-[11px] text-slate-400 font-medium leading-snug">Select an employee from your active workforce</p>
                            </div>
                        </div>
                        <select
                            name="employee_id"
                            value={formData.employee_id}
                            onChange={handleInputChange}
                            className="w-full p-4 bg-white border border-slate-200 rounded-xl font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer shadow-sm text-base touch-manipulation"
                            required
                        >
                            <option value="" disabled>Select an employee…</option>
                            {employees.map((emp) => {
                                const salary = parseFloat(emp.salary || emp.monthly_salary || 0);
                                return (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.first_name} {emp.last_name} — {emp.department || 'General'} (₱{salary.toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo)
                                    </option>
                                );
                            })}
                        </select>

                        {selectedEmployee && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white p-3.5 rounded-xl border border-slate-200/70"
                            >
                                <div>
                                    <span className="text-[10px] font-bold uppercase text-slate-400">Monthly Basic</span>
                                    <p className="font-mono font-bold text-slate-800 text-sm">
                                        ₱{parseFloat(selectedEmployee.salary || selectedEmployee.monthly_salary || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase text-slate-400">Daily Rate (21.75)</span>
                                    <p className="font-mono font-bold text-slate-800 text-sm">
                                        ₱{(parseFloat(selectedEmployee.salary || selectedEmployee.monthly_salary || 0) / 21.75).toFixed(2)}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase text-slate-400">Hourly Rate</span>
                                    <p className="font-mono font-bold text-slate-800 text-sm">
                                        ₱{((parseFloat(selectedEmployee.salary || selectedEmployee.monthly_salary || 0) / 21.75) / 8).toFixed(2)}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase text-slate-400">Department</span>
                                    <p className="font-semibold text-slate-800 text-sm truncate">
                                        {selectedEmployee.department || 'Operations'}
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </div>

                    <div className="bg-slate-50/80 p-5 sm:p-6 rounded-2xl border border-slate-100 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                <i className="ti ti-calendar-event"></i>
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Payroll Cutoff Period</h3>
                                <p className="text-[11px] text-slate-400 font-medium leading-snug">Standard semi-monthly cutoff or custom date range</p>
                            </div>
                        </div>

                        {/* Horizontal-scroll chip strip: each preset keeps its full label on
                            one line no matter the screen width, and scrolls instead of
                            wrapping or squeezing on narrow phones. */}
                        <div
                            className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            <button
                                type="button"
                                onClick={() => applyCutoffPreset('current_1st')}
                                className={`shrink-0 whitespace-nowrap min-h-[42px] px-4 py-2.5 text-xs font-bold rounded-xl transition-all touch-manipulation active:scale-95 ${activePreset === 'current_1st' ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                            >
                                1st – 15th
                            </button>
                            <button
                                type="button"
                                onClick={() => applyCutoffPreset('current_2nd')}
                                className={`shrink-0 whitespace-nowrap min-h-[42px] px-4 py-2.5 text-xs font-bold rounded-xl transition-all touch-manipulation active:scale-95 ${activePreset === 'current_2nd' ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                            >
                                16th – End
                            </button>
                            <button
                                type="button"
                                onClick={() => applyCutoffPreset('prev_2nd')}
                                className={`shrink-0 whitespace-nowrap min-h-[42px] px-4 py-2.5 text-xs font-bold rounded-xl transition-all touch-manipulation active:scale-95 ${activePreset === 'prev_2nd' ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                            >
                                Last Month
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all group">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="ti ti-calendar-event text-blue-600 text-sm"></i> Cutoff Start Date
                                    </span>
                                    <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                                        {formatReadableDate(formData.period_start)}
                                    </span>
                                </div>
                                <Flatpickr
                                    value={formData.period_start}
                                    onChange={([date]) => {
                                        if (date) {
                                            setActivePreset('custom');
                                            setFormData(prev => ({ ...prev, period_start: formatLocalDate(date) }));
                                        }
                                    }}
                                    options={{
                                        dateFormat: "Y-m-d",
                                        altInput: true,
                                        altFormat: "F j, Y (D)",
                                        disableMobile: true,
                                        allowInput: false
                                    }}
                                    className="w-full p-2.5 min-h-[44px] bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold rounded-lg border border-slate-200 outline-none cursor-pointer text-base transition-colors touch-manipulation"
                                    placeholder="Click to pick start date"
                                />
                            </div>

                            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all group">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                        <i className="ti ti-flag text-emerald-600 text-sm"></i> Cutoff End Date
                                    </span>
                                    <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                                        {formatReadableDate(formData.period_end)}
                                    </span>
                                </div>
                                <Flatpickr
                                    value={formData.period_end}
                                    onChange={([date]) => {
                                        if (date) {
                                            setActivePreset('custom');
                                            setFormData(prev => ({ ...prev, period_end: formatLocalDate(date) }));
                                        }
                                    }}
                                    options={{
                                        dateFormat: "Y-m-d",
                                        altInput: true,
                                        altFormat: "F j, Y (D)",
                                        disableMobile: true,
                                        allowInput: false
                                    }}
                                    className="w-full p-2.5 min-h-[44px] bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold rounded-lg border border-slate-200 outline-none cursor-pointer text-base transition-colors touch-manipulation"
                                    placeholder="Click to pick end date"
                                />
                            </div>
                        </div>

                        {periodDaysCount > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50/70 border border-blue-100 px-4 py-2.5 rounded-xl text-xs text-blue-900 font-medium">
                                <div className="flex items-center gap-2 min-w-0">
                                    <i className="ti ti-info-circle text-blue-600 text-base shrink-0"></i>
                                    <span>
                                        {formatReadableDate(formData.period_start)} &rarr; {formatReadableDate(formData.period_end)}
                                    </span>
                                </div>
                                <span className="shrink-0 font-black bg-blue-600 text-white px-2.5 py-0.5 rounded-md text-[11px] shadow-sm">
                                    {periodDaysCount} Days
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                    <i className="ti ti-clock-check"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-sm font-bold text-slate-800 tracking-tight">Attendance & Rendered Hours</h3>
                                    <p className="text-[11px] text-slate-400 font-medium leading-snug">Verified biometric time logs & overtime</p>
                                </div>
                            </div>
                            {isCalculating && (
                                <div className="shrink-0 whitespace-nowrap text-xs font-semibold text-blue-600 flex items-center gap-1.5 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 animate-pulse">
                                    <i className="ti ti-loader animate-spin"></i> Calculating...
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Days Worked (Present)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    name="days_worked"
                                    value={formData.days_worked}
                                    readOnly
                                    className="w-full p-3 bg-white border border-slate-200 rounded-xl font-mono text-xl font-black text-slate-800 outline-none shadow-inner"
                                    required
                                />
                                <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-tight flex items-center gap-1">
                                    <i className="ti ti-bolt text-amber-500"></i> Auto-computed from biometric logs
                                </p>
                            </div>
                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Overtime Hours (&gt;9h shifts)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    name="overtime_hours"
                                    value={formData.overtime_hours}
                                    readOnly
                                    className="w-full p-3 bg-white border border-slate-200 rounded-xl font-mono text-xl font-black text-slate-800 outline-none shadow-inner"
                                />
                                <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-tight flex items-center gap-1">
                                    <i className="ti ti-clock text-blue-500"></i> Computed per standard shift schedule
                                </p>
                            </div>
                        </div>
                    </div>

                    {holidayPreview.items.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-3"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                        <i className="ti ti-confetti"></i>
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-bold text-slate-800 tracking-tight">Holiday Pay (DOLE)</h3>
                                        <p className="text-[11px] text-slate-400 font-medium leading-snug">Detected within this cutoff — recalculated authoritatively on save</p>
                                    </div>
                                </div>
                                <span className="self-start sm:self-auto shrink-0 font-black bg-amber-500 text-white px-3 py-1 rounded-lg text-sm shadow-sm">
                                    +₱{holidayPreview.totalHolidayPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                            </div>

                            <div className="bg-amber-50/60 border border-amber-100 rounded-2xl divide-y divide-amber-100/80 overflow-hidden">
                                {holidayPreview.items.map((item) => (
                                    <div key={item.date} className="flex items-center justify-between px-4 py-3 text-xs">
                                        <div>
                                            <p className="font-bold text-slate-800">
                                                {formatReadableDate(item.date)} &middot; {item.holidayName}
                                            </p>
                                            <p className="text-slate-500 mt-0.5">
                                                {HOLIDAY_LABELS[item.holidayType] || item.holidayType}
                                                {item.isRestDay ? ' · Rest Day' : ''}
                                                {' · '}
                                                {item.worked ? `Worked (${item.multiplier * 100}%)` : (item.eligible ? 'Unworked (paid)' : 'Unworked (unpaid)')}
                                            </p>
                                        </div>
                                        <span className={`font-mono font-bold ${item.pay > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                            ₱{item.pay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                <i className="ti ti-adjustments"></i>
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Adjustments & Manual Overrides</h3>
                                <p className="text-[11px] text-slate-400 font-medium leading-snug">Calculated tardiness deductions and allowable HR overrides</p>
                            </div>
                        </div>

                        <div className="p-5 bg-red-50/60 rounded-2xl border border-red-100 space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="block text-xs font-bold text-red-600 uppercase">Late Deductions / Absences (₱)</label>
                                <span className="text-[10px] font-bold text-red-600 uppercase bg-red-100/80 px-2 py-0.5 rounded-md">
                                    Admin Override Allowed
                                </span>
                            </div>
                            <input
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                name="late_deductions"
                                value={formData.late_deductions}
                                onChange={handleInputChange}
                                className="w-full p-4 bg-white border border-red-200 rounded-xl font-mono text-red-600 text-xl font-bold focus:ring-2 focus:ring-red-400 transition-all outline-none shadow-sm touch-manipulation"
                                placeholder="0.00"
                            />
                            <p className="text-[11px] text-slate-500">
                                15-minute grace period automatically accounted for. You can adjust this amount manually before saving.
                            </p>
                        </div>
                    </div>

                    <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3">
                        <i className="ti ti-shield-check text-blue-600 text-xl mt-0.5"></i>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            <strong>DOLE Compliance Engine:</strong> Government mandatory deductions (SSS, PhilHealth, Pag-IBIG, and TRAIN Law Withholding Tax) are automatically calculated and deducted upon generation. Holiday premiums shown above are included in gross pay before tax.
                        </p>
                    </div>

                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={isSubmitting || !formData.employee_id}
                            className="w-full py-5 bg-slate-900 hover:bg-blue-600 text-white font-black text-lg rounded-2xl shadow-xl shadow-slate-900/10 hover:shadow-blue-500/20 transition-all duration-300 transform hover:-translate-y-0.5 active:scale-[0.99] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-slate-900 touch-manipulation"
                        >
                            {!isSubmitting ? (
                                <>
                                    <i className="ti ti-cash text-2xl"></i>
                                    <span>Compute & Distribute Payslip</span>
                                </>
                            ) : (
                                <>
                                    <i className="ti ti-loader text-2xl animate-spin"></i>
                                    <span>Computing DOLE Contributions...</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PayrollCreate;