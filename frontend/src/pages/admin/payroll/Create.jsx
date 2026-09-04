import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Flatpickr from 'react-flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';

const parseDate = (dStr) => {
    if (!dStr) return null;
    const formatted = typeof dStr === 'string' ? dStr.replace(' ', 'T') : dStr;
    const d = new Date(formatted);
    return isNaN(d.getTime()) ? null : d;
};

const extractDateStr = (dStr) => {
    if (!dStr) return '';
    if (typeof dStr === 'string' && dStr.length >= 10) return dStr.substring(0, 10);
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatLocalDate = extractDateStr;

const formatReadableDate = (dateStr) => {
    if (!dateStr) return 'Select Date';
    const cleanStr = extractDateStr(dateStr);
    if (!cleanStr) return dateStr;
    const d = new Date(cleanStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getEmployeeDept = (emp) => emp?.department || 'Operations';
const isFactoryDept = (dept) => (dept || '').toLowerCase() === 'factory';
const getEmployeeRate = (emp) => parseFloat(
    emp?.piece_rate || emp?.rate_per_piece || emp?.salary || emp?.monthly_salary || 0
);

const HOLIDAY_LABELS = {
    regular: 'Regular Holiday',
    special_non_working: 'Special Non-Working Day',
};

const PayrollCreate = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const [employees, setEmployees] = useState([]);

    // Seamless hand-off from the Payroll Ledger's "Pending" list: HR may
    // arrive here via React Router state (rich object, set on click) or via
    // URL search params (survives a direct page reload / shared link).
    // Captured once on mount — subsequent edits to the form should not be
    // clobbered by a stale location.state on re-render.
    const initialPrefillRef = useRef({
        employee_id: location.state?.employee_id ?? searchParams.get('employee_id') ?? '',
        period_start: location.state?.period_start ?? searchParams.get('period_start') ?? '',
        period_end: location.state?.period_end ?? searchParams.get('period_end') ?? '',
    });
    const initialPrefill = initialPrefillRef.current;
    const hasPrefilledPeriod = Boolean(initialPrefill.period_start && initialPrefill.period_end);

    const [formData, setFormData] = useState({
        employee_id: initialPrefill.employee_id,
        period_start: initialPrefill.period_start,
        period_end: initialPrefill.period_end,
        days_worked: 0,
        overtime_hours: 0,
        pieces_produced: '',
        late_deductions: ''
    });

    const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
    const [empSearch, setEmpSearch] = useState('');
    const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');

    const [activePreset, setActivePreset] = useState('current_week');
    const [includeWeekends, setIncludeWeekends] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const [holidayPreview, setHolidayPreview] = useState({ items: [], totalHolidayPay: 0 });
    const [prefillEmployeeMissing, setPrefillEmployeeMissing] = useState(false);

    useEffect(() => {
        fetchWithAuth('/api/employees')
            .then(res => res.json())
            .then(result => {
                const list = Array.isArray(result) ? result : (result.data || []);
                const payableList = list.filter(e => {
                    const roleStr = (e.role || '').toLowerCase();
                    return roleStr !== 'admin' && roleStr !== 'security';
                });
                setEmployees(payableList);

                // Edge case: a pending employee_id was handed off from the
                // ledger (via state or URL) but doesn't resolve against the
                // eligible roster — e.g. the employee was deactivated
                // between the ledger view and this page load, or the query
                // param was malformed. Clear it so HR isn't left with a
                // dead selection, and surface a notice instead of silently
                // reverting to the blank picker.
                if (initialPrefill.employee_id) {
                    const stillValid = payableList.some(e => String(e.id) === String(initialPrefill.employee_id));
                    if (!stillValid) {
                        setPrefillEmployeeMissing(true);
                        setFormData(prev => (
                            String(prev.employee_id) === String(initialPrefill.employee_id)
                                ? { ...prev, employee_id: '' }
                                : prev
                        ));
                    }
                }
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
            .flatpickr-months { margin-bottom: 8px !important; }
            .flatpickr-months .flatpickr-month { color: #0f172a !important; font-weight: 800 !important; font-size: 1.05rem !important; }
            .flatpickr-current-month { padding-top: 4px !important; }
            .flatpickr-current-month .flatpickr-monthDropdown-months { font-weight: 800 !important; color: #0f172a !important; }
            .flatpickr-weekdays { margin-bottom: 6px !important; }
            span.flatpickr-weekday { color: #64748b !important; font-weight: 700 !important; font-size: 0.8rem !important; }
            .flatpickr-days { width: 100% !important; }
            .dayContainer { width: 100% !important; min-width: 100% !important; max-width: 100% !important; justify-content: space-around !important; }
            .flatpickr-day { border-radius: 0.75rem !important; font-weight: 600 !important; color: #1e293b !important; height: 42px !important; line-height: 42px !important; margin: 2px 0 !important; transition: all 0.15s ease !important; touch-action: manipulation !important; }
            .flatpickr-day:hover { background: #eff6ff !important; color: #2563eb !important; }
            .flatpickr-day.selected, .flatpickr-day.startRange, .flatpickr-day.endRange { background: #2563eb !important; border-color: #2563eb !important; color: #ffffff !important; font-weight: 800 !important; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35) !important; }
            .flatpickr-day.today { border-color: #93c5fd !important; background: #f0f9ff !important; color: #0284c7 !important; }
            .flatpickr-day.prevMonthDay, .flatpickr-day.nextMonthDay { color: #cbd5e1 !important; }
            .flatpickr-prev-month, .flatpickr-next-month { padding: 6px !important; border-radius: 0.5rem !important; }
            .flatpickr-prev-month:hover svg, .flatpickr-next-month:hover svg { fill: #2563eb !important; }
        `;
        document.head.appendChild(style);
        return () => {
            const el = document.getElementById('custom-payroll-flatpickr-style');
            if (el) document.head.removeChild(el);
        };
    }, []);

    useEffect(() => {
        // Don't stomp on a period passed in from the Payroll Ledger — only
        // fall back to the default current-week cutoff when nothing was
        // pre-filled (fresh, direct visit to the Create page).
        if (hasPrefilledPeriod) {
            setActivePreset('custom');
            return;
        }
        applyCutoffPreset('current_week', includeWeekends);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyCutoffPreset = (presetKey = 'current_week', withWeekends = includeWeekends) => {
        setActivePreset(presetKey);
        const now = new Date();

        if (presetKey === 'current_week') {
            const dayOfWeek = now.getDay();
            const distanceToMon = (dayOfWeek + 6) % 7;
            const start = new Date(now);
            start.setDate(now.getDate() - distanceToMon);
            const end = new Date(start);

            end.setDate(start.getDate() + (withWeekends ? 6 : 4));

            setFormData(prev => ({
                ...prev,
                period_start: formatLocalDate(start),
                period_end: formatLocalDate(end)
            }));
        }
    };

    const toggleWeekends = () => {
        const nextState = !includeWeekends;
        setIncludeWeekends(nextState);

        if (activePreset === 'current_week') {
            applyCutoffPreset('current_week', nextState);
        } else if (nextState && formData.period_start) {
            const s = new Date(formData.period_start + 'T00:00:00');
            if (!isNaN(s.getTime())) {
                const e = new Date(s);
                e.setDate(s.getDate() + 6);
                setFormData(prev => ({
                    ...prev,
                    period_end: formatLocalDate(e)
                }));
            }
        }
    };

    const handleStartDateChange = ([date]) => {
        if (!date) return;
        setActivePreset('custom');
        const startStr = formatLocalDate(date);

        if (includeWeekends) {
            const end = new Date(date);
            end.setDate(date.getDate() + 6);
            setFormData(prev => ({
                ...prev,
                period_start: startStr,
                period_end: formatLocalDate(end)
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                period_start: startStr
            }));
        }
    };

    const handleEndDateChange = ([date]) => {
        if (!date) return;
        setActivePreset('custom');
        const endStr = formatLocalDate(date);

        if (includeWeekends) {
            const start = new Date(date);
            start.setDate(date.getDate() - 6);
            setFormData(prev => ({
                ...prev,
                period_start: formatLocalDate(start),
                period_end: endStr
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                period_end: endStr
            }));
        }
    };

    const { periodDaysCount, isInvalidDateRange } = useMemo(() => {
        if (!formData.period_start || !formData.period_end) {
            return { periodDaysCount: 0, isInvalidDateRange: false };
        }
        const s = new Date(formData.period_start + 'T00:00:00');
        const e = new Date(formData.period_end + 'T00:00:00');
        if (isNaN(s.getTime()) || isNaN(e.getTime())) {
            return { periodDaysCount: 0, isInvalidDateRange: false };
        }
        if (e < s) {
            return { periodDaysCount: 0, isInvalidDateRange: true };
        }
        const diffTime = Math.abs(e - s);
        const count = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        return { periodDaysCount: count, isInvalidDateRange: false };
    }, [formData.period_start, formData.period_end]);

    const selectedEmployee = useMemo(() => {
        return employees.find(e => String(e.id) === String(formData.employee_id));
    }, [employees, formData.employee_id]);

    const isFactoryEmployee = useMemo(() => {
        return isFactoryDept(selectedEmployee?.department);
    }, [selectedEmployee]);

    const employeeRate = useMemo(() => {
        return getEmployeeRate(selectedEmployee);
    }, [selectedEmployee]);

    // Check if the selected employee has no worked days, overtime, or pieces produced
    const hasNoWorkedTime = useMemo(() => {
        if (!formData.employee_id || isCalculating) return false;
        const days = parseFloat(formData.days_worked || 0);
        const ot = parseFloat(formData.overtime_hours || 0);
        const pieces = parseFloat(formData.pieces_produced || 0);

        if (isFactoryEmployee) {
            return days === 0 && ot === 0 && pieces === 0;
        }
        return days === 0 && ot === 0;
    }, [formData.employee_id, formData.days_worked, formData.overtime_hours, formData.pieces_produced, isFactoryEmployee, isCalculating]);

    const availableDepartments = useMemo(() => {
        const depts = new Set(employees.map(getEmployeeDept));
        return ['ALL', ...Array.from(depts)];
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        const search = empSearch.toLowerCase();
        return employees.filter(emp => {
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const dept = getEmployeeDept(emp);
            const matchesSearch = fullName.includes(search) || dept.toLowerCase().includes(search);
            const matchesDept = selectedDeptFilter === 'ALL' || dept === selectedDeptFilter;
            return matchesSearch && matchesDept;
        });
    }, [employees, empSearch, selectedDeptFilter]);

    useEffect(() => {
        if (!formData.employee_id || !formData.period_start || !formData.period_end || isInvalidDateRange) {
            return;
        }

        let isMounted = true;
        setIsCalculating(true);

        const calculatePayroll = async () => {
            try {
                const attendanceRes = await fetchWithAuth(
                    `/api/attendance?employee_id=${formData.employee_id}&start_date=${formData.period_start}&end_date=${formData.period_end}`
                );
                const rawLogs = await attendanceRes.json();
                const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs.data || rawLogs.logs || []);

                const doleDivisor = 21.75;
                const gracePeriodMins = 15;

                const monthlyBase = isFactoryEmployee
                    ? parseFloat(selectedEmployee?.monthly_salary || selectedEmployee?.salary || 0)
                    : employeeRate;

                const dailyRate = monthlyBase > 0 ? (monthlyBase / doleDivisor) : parseFloat(selectedEmployee?.daily_rate || 0);
                const hourlyRate = dailyRate / 8;
                const perMinuteRate = hourlyRate / 60;

                let totalOvertime = 0;
                let adjustments = 0;
                const workedDatesSet = new Set();

                const completedLogs = Array.isArray(logs) ? logs.filter(l => l && l.time_out && l.time_in) : [];

                completedLogs.forEach(log => {
                    const dateStr = extractDateStr(log.date || log.time_in);
                    if (dateStr) workedDatesSet.add(dateStr);

                    const timeIn = parseDate(log.time_in);
                    const timeOut = parseDate(log.time_out);

                    if (timeIn && dateStr) {
                        const scheduleStart = new Date(`${dateStr}T08:00:00`);

                        if (!isNaN(scheduleStart.getTime()) && timeIn > scheduleStart) {
                            const minutes = Math.floor((timeIn - scheduleStart) / 60000);
                            if (minutes > gracePeriodMins && perMinuteRate > 0) {
                                adjustments += (minutes * perMinuteRate);
                            }
                        }
                    }

                    if (timeIn && timeOut) {
                        const hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                        // Strict HR Policy:
                        // Factory Worker (8:00 AM - 5:00 PM): STRICTLY CANNOT OVERTIME (0h).
                        // Regular Worker (8:00 AM - 8:00 PM): CAN OVERTIME.
                        if (!isFactoryEmployee && hoursWorked > 8) {
                            totalOvertime += (hoursWorked - 8);
                        }
                    }
                });

                const uniqueWorkedDates = Array.from(workedDatesSet);
                const daysWorked = uniqueWorkedDates.length;

                const previewRes = await fetchWithAuth('/api/payroll/preview', {
                    method: 'POST',
                    body: JSON.stringify({
                        employee_id: formData.employee_id,
                        period_start: formData.period_start,
                        period_end: formData.period_end,
                        department: getEmployeeDept(selectedEmployee),
                        days_worked: daysWorked,
                        monthly_salary: selectedEmployee?.monthly_salary || selectedEmployee?.salary || 0,
                        daily_rate: dailyRate,
                        worked_dates: uniqueWorkedDates
                    }),
                });

                const previewData = await previewRes.json().catch(() => ({ items: [], totalHolidayPay: 0 }));

                if (isMounted) {
                    setFormData(prev => ({
                        ...prev,
                        days_worked: daysWorked,
                        overtime_hours: isFactoryEmployee ? 0 : parseFloat(totalOvertime.toFixed(2)),
                        late_deductions: adjustments > 0 ? adjustments.toFixed(2) : ''
                    }));

                    setHolidayPreview(
                        previewRes.ok && Array.isArray(previewData.items)
                            ? previewData
                            : { items: [], totalHolidayPay: 0 }
                    );
                }

            } catch (err) {
                console.error('Calculation error:', err);
                if (isMounted) {
                    setHolidayPreview({ items: [], totalHolidayPay: 0 });
                }
            } finally {
                if (isMounted) {
                    setIsCalculating(false);
                }
            }
        };

        calculatePayroll();

        return () => {
            isMounted = false;
        };
    }, [formData.employee_id, formData.period_start, formData.period_end, selectedEmployee, isFactoryEmployee, employeeRate, isInvalidDateRange]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isInvalidDateRange) {
            setError('End date cannot be earlier than start date.');
            return;
        }

        if (hasNoWorkedTime) {
            setError('Cannot compute payroll for an employee with 0 worked days and 0 overtime hours.');
            return;
        }

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

                if (newRecord && newRecord.id) {
                    queryClient.setQueriesData({ queryKey: ['adminPayrolls'] }, (old) => {
                        if (!Array.isArray(old)) return old;
                        return [newRecord, ...old];
                    });
                }

                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });

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
        <div className="max-w-4xl mx-auto py-4 sm:py-8 px-3 sm:px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            <Link
                to="/admin/payroll"
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors mb-4 tap-active"
            >
                <i className="ti ti-arrow-left text-base" />
                <span>Back to Payroll</span>
            </Link>

            <div className="bg-white p-4 sm:p-8 lg:p-10 rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-100">

                <div className="flex items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
                    <div className="h-10 w-10 sm:h-14 sm:w-14 shrink-0 bg-blue-600 text-white rounded-xl sm:rounded-2xl flex items-center justify-center text-lg sm:text-2xl shadow-lg shadow-blue-500/20">
                        <i className="ti ti-calculator"></i>
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg sm:text-3xl font-black text-slate-800 tracking-tight leading-tight truncate">Payroll Calculator</h2>
                        <p className="text-slate-400 text-[10px] sm:text-sm font-semibold uppercase tracking-wider mt-0.5 leading-snug truncate">Automated DOLE Wage &amp; Deductions Computation</p>
                    </div>
                </div>

                {error && (
                    <div className="mb-6 sm:mb-8 p-3.5 sm:p-4 bg-red-50 border-l-4 border-red-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-red-500 mt-0.5 text-lg sm:text-xl"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-red-800">Action Stopped</h4>
                            <p className="text-xs sm:text-sm text-red-600 mt-0.5 break-words">{error}</p>
                        </div>
                    </div>
                )}

                {success && (
                    <div className="mb-6 sm:mb-8 p-3.5 sm:p-4 bg-emerald-50 border-l-4 border-emerald-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-circle-check text-emerald-500 mt-0.5 text-lg sm:text-xl"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-emerald-800">Success</h4>
                            <p className="text-xs sm:text-sm text-emerald-600 mt-0.5 break-words">{success}</p>
                        </div>
                    </div>
                )}

                {prefillEmployeeMissing && (
                    <div className="mb-6 sm:mb-8 p-3.5 sm:p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-amber-500 mt-0.5 text-lg sm:text-xl"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-amber-800">Employee Not Found</h4>
                            <p className="text-xs sm:text-sm text-amber-700 mt-0.5 break-words">
                                The employee passed in from the Payroll Ledger could no longer be located in the active roster. Please select them manually below.
                            </p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
                    {/* Employee Selection */}
                    <div className="bg-slate-50/80 p-4 sm:p-6 rounded-2xl border border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2.5 sm:gap-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                    <i className="ti ti-user"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Employee Directory</h3>
                                    <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">Select an active workforce member</p>
                                </div>
                            </div>
                            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 bg-slate-200/60 px-2 sm:px-2.5 py-1 rounded-full shrink-0">
                                {employees.length} Active
                            </span>
                        </div>

                        {!selectedEmployee ? (
                            <button
                                type="button"
                                onClick={() => setIsEmpModalOpen(true)}
                                className="w-full min-h-[56px] p-3.5 sm:p-4 bg-white hover:bg-slate-100/80 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-2xl text-left transition-all group flex items-center justify-between shadow-xs touch-manipulation"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-blue-50 group-hover:bg-blue-100 text-blue-600 flex items-center justify-center text-lg transition-colors shrink-0">
                                        <i className="ti ti-user-plus"></i>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm sm:text-base font-bold text-slate-700 group-hover:text-blue-600 transition-colors truncate">Tap to choose employee</p>
                                        <p className="text-xs text-slate-400 truncate">Search by name or department...</p>
                                    </div>
                                </div>
                                <i className="ti ti-chevron-right text-slate-400 text-lg group-hover:translate-x-0.5 transition-transform shrink-0 ml-2"></i>
                            </button>
                        ) : (
                            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-blue-200 shadow-sm relative overflow-hidden">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
                                        <EmployeeAvatar
                                            employee={selectedEmployee}
                                            size="h-11 w-11 sm:h-13 sm:w-13"
                                            rounded="rounded-xl sm:rounded-2xl"
                                            border="border-2 border-white"
                                            shadow="shadow-md shadow-blue-500/15"
                                            textSize="text-base sm:text-lg"
                                        />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <h4 className="text-sm sm:text-base font-black text-slate-800 truncate">
                                                    {selectedEmployee.first_name} {selectedEmployee.last_name}
                                                </h4>
                                                <span className="shrink-0 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-md">
                                                    {getEmployeeDept(selectedEmployee)}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 font-mono font-semibold mt-0.5">
                                                ₱{employeeRate.toLocaleString('en-US', { minimumFractionDigits: 2 })} / {isFactoryEmployee ? 'PC' : 'month'}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsEmpModalOpen(true)}
                                        className="shrink-0 px-2.5 sm:px-3 py-1.5 min-h-[36px] bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors touch-manipulation"
                                    >
                                        Change
                                    </button>
                                </div>

                                <div className="mt-3.5 pt-3 border-t border-slate-100">
                                    {isFactoryEmployee ? (
                                        <div className="bg-amber-50/80 border border-amber-200/80 p-2.5 sm:p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                            <div>
                                                <span className="block text-[10px] font-bold uppercase text-amber-800">Factory Compensation Model</span>
                                                <p className="text-xs font-semibold text-amber-700">Piece Rate Payment System</p>
                                            </div>
                                            <span className="self-start sm:self-auto font-mono font-black text-amber-900 text-xs sm:text-sm bg-white px-2.5 py-1 rounded-lg border border-amber-200 shadow-xs">
                                                ₱{employeeRate.toLocaleString('en-US', { minimumFractionDigits: 2 })} / PC
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center">
                                            <div className="bg-slate-50 p-2 rounded-xl">
                                                <span className="block text-[8px] sm:text-[9px] font-bold uppercase text-slate-400">Monthly</span>
                                                <p className="font-mono font-bold text-slate-800 text-[11px] sm:text-xs">
                                                    ₱{employeeRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                </p>
                                            </div>
                                            <div className="bg-slate-50 p-2 rounded-xl">
                                                <span className="block text-[8px] sm:text-[9px] font-bold uppercase text-slate-400">Daily (21.75)</span>
                                                <p className="font-mono font-bold text-slate-800 text-[11px] sm:text-xs">
                                                    ₱{(employeeRate / 21.75).toFixed(2)}
                                                </p>
                                            </div>
                                            <div className="bg-slate-50 p-2 rounded-xl">
                                                <span className="block text-[8px] sm:text-[9px] font-bold uppercase text-slate-400">Hourly Rate</span>
                                                <p className="font-mono font-bold text-slate-800 text-[11px] sm:text-xs">
                                                    ₱{((employeeRate / 21.75) / 8).toFixed(2)}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Cutoff Period Section */}
                    <div className="bg-slate-50/80 p-4 sm:p-6 rounded-2xl border border-slate-100 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2.5 sm:gap-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                    <i className="ti ti-calendar-event"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Payroll Cutoff Period</h3>
                                    <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">
                                        {includeWeekends ? 'Auto 7-Day calculation active' : 'Pick start & end dates freely'}
                                    </p>
                                </div>
                            </div>

                            {activePreset === 'custom' && (
                                <span className="text-[10px] sm:text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1">
                                    <i className="ti ti-edit"></i> {includeWeekends ? 'Auto-Week Lock' : 'Free Choice Mode'}
                                </span>
                            )}
                        </div>

                        {/* Toggle Button */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={toggleWeekends}
                                className={`shrink-0 whitespace-nowrap min-h-[38px] sm:min-h-[42px] px-3.5 sm:px-4 py-2 text-xs font-bold rounded-xl transition-colors touch-manipulation flex items-center gap-2 ${includeWeekends
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-slate-200 text-slate-700 border border-slate-300'
                                    }`}
                            >
                                <i className={`ti ${includeWeekends ? 'ti-calendar-check text-emerald-600' : 'ti-calendar-minus text-slate-500'} text-base`}></i>
                                <span>{includeWeekends ? 'Auto-Weekends: Active (1 Week Auto)' : 'Auto-Weekends: Inactive (Free Choice)'}</span>
                            </button>
                        </div>

                        {/* Date Pickers */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all group">
                                <div className="flex items-center justify-between mb-2 gap-1">
                                    <span className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 truncate">
                                        <i className="ti ti-calendar-event text-blue-600 text-sm shrink-0"></i> Start Date
                                    </span>
                                    <span className="text-[10px] sm:text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md shrink-0">
                                        {formatReadableDate(formData.period_start)}
                                    </span>
                                </div>
                                <Flatpickr
                                    value={formData.period_start}
                                    onChange={handleStartDateChange}
                                    options={{
                                        dateFormat: "Y-m-d",
                                        altInput: true,
                                        altFormat: "F j, Y (D)",
                                        disableMobile: true,
                                        allowInput: false
                                    }}
                                    className="w-full p-2.5 min-h-[44px] bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold rounded-lg border border-slate-200 outline-none cursor-pointer text-sm sm:text-base transition-colors touch-manipulation"
                                    placeholder="Click to pick start date"
                                />
                            </div>

                            <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all group">
                                <div className="flex items-center justify-between mb-2 gap-1">
                                    <span className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 truncate">
                                        <i className="ti ti-flag text-emerald-600 text-sm shrink-0"></i> End Date
                                    </span>
                                    <span className="text-[10px] sm:text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                                        {formatReadableDate(formData.period_end)}
                                    </span>
                                </div>
                                <Flatpickr
                                    value={formData.period_end}
                                    onChange={handleEndDateChange}
                                    options={{
                                        dateFormat: "Y-m-d",
                                        altInput: true,
                                        altFormat: "F j, Y (D)",
                                        disableMobile: true,
                                        allowInput: false
                                    }}
                                    className="w-full p-2.5 min-h-[44px] bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold rounded-lg border border-slate-200 outline-none cursor-pointer text-sm sm:text-base transition-colors touch-manipulation"
                                    placeholder="Click to pick end date"
                                />
                            </div>
                        </div>

                        {/* Date Validation Warning */}
                        {isInvalidDateRange && (
                            <p className="text-xs text-red-600 font-bold flex items-center gap-1 pt-1">
                                <i className="ti ti-alert-circle text-base"></i> End date cannot be earlier than start date.
                            </p>
                        )}

                        {periodDaysCount > 0 && !isInvalidDateRange && (
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50/70 border border-blue-100 p-3 rounded-xl text-xs text-blue-900 font-medium">
                                <div className="flex items-center gap-2 min-w-0">
                                    <i className="ti ti-info-circle text-blue-600 text-base shrink-0"></i>
                                    <span className="truncate">
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
                        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 min-h-[32px]">
                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                    <i className="ti ti-clock-check"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Attendance & Rendered Hours</h3>
                                    <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">Verified biometric time logs & overtime</p>
                                </div>
                            </div>
                            {isCalculating && (
                                <div className="shrink-0 text-xs font-semibold text-blue-600 flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
                                    <i className="ti ti-loader animate-spin text-sm"></i> Calculating...
                                </div>
                            )}
                        </div>

                        {isFactoryEmployee && (
                            <div className="p-4 sm:p-5 bg-amber-50/80 rounded-2xl border border-amber-200/80 space-y-2.5">
                                <div className="flex justify-between items-center flex-wrap gap-1">
                                    <label className="block text-xs font-bold text-amber-900 uppercase tracking-wide">
                                        Pieces Produced / Output Quantity
                                    </label>
                                    <span className="text-[10px] font-bold text-amber-800 uppercase bg-amber-200/60 px-2 py-0.5 rounded-md">
                                        ₱{employeeRate.toFixed(2)} / Piece
                                    </span>
                                </div>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    name="pieces_produced"
                                    value={formData.pieces_produced}
                                    onChange={handleInputChange}
                                    className="w-full p-3.5 sm:p-4 bg-white border border-amber-300 rounded-xl font-mono text-amber-950 text-xl sm:text-2xl font-black focus:ring-2 focus:ring-amber-500 transition-all outline-none shadow-xs touch-manipulation"
                                    placeholder="Enter total pieces..."
                                    required
                                />
                                <div className="flex justify-between items-center text-xs font-semibold text-slate-600 pt-1">
                                    <span>Calculated Gross Earnings:</span>
                                    <span className="font-mono font-black text-emerald-600 text-sm sm:text-base">
                                        ₱{((parseFloat(formData.pieces_produced) || 0) * employeeRate).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div className="bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200/80">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 sm:mb-2">Days Worked (Present)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    name="days_worked"
                                    value={formData.days_worked}
                                    readOnly
                                    className="w-full p-3 bg-white border border-slate-200 rounded-xl font-mono text-lg sm:text-xl font-black text-slate-800 outline-none shadow-inner"
                                    required
                                />
                                <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-tight flex items-center gap-1">
                                    <i className="ti ti-bolt text-amber-500 shrink-0"></i> Auto-computed from logs
                                </p>
                            </div>
                            <div className="bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200/80">
                                <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase">
                                        {isFactoryEmployee ? 'Overtime (Strictly Prohibited)' : 'Overtime Hours (Eligible)'}
                                    </label>
                                    {isFactoryEmployee ? (
                                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">
                                            No OT Allowed
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-blue-100 text-blue-800 border border-blue-200">
                                            OT Eligible
                                        </span>
                                    )}
                                </div>
                                <input
                                    type="number"
                                    step="0.5"
                                    name="overtime_hours"
                                    value={isFactoryEmployee ? 0 : formData.overtime_hours}
                                    readOnly
                                    className={`w-full p-3 bg-white border border-slate-200 rounded-xl font-mono text-lg sm:text-xl font-black ${isFactoryEmployee ? 'text-slate-400 bg-slate-100/80' : 'text-slate-800'} outline-none shadow-inner`}
                                />
                                <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-tight flex items-center gap-1">
                                    <i className={`ti ${isFactoryEmployee ? 'ti-ban text-rose-500' : 'ti-clock text-blue-500'} shrink-0`}></i>
                                    {isFactoryEmployee 
                                        ? 'Factory Worker (8-5): Overtime prohibited per HR policy' 
                                        : 'Regular Worker (8-8): Overtime computed per standard shift'}
                                </p>
                            </div>
                        </div>

                        {/* Zero Work Warning Banner */}
                        {hasNoWorkedTime && (
                            <div className="p-3.5 sm:p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                                <i className="ti ti-alert-circle text-amber-600 text-xl shrink-0"></i>
                                <p className="text-xs sm:text-sm text-amber-800 font-bold">
                                    Employee has 0 worked days and 0 overtime hours for this cutoff period. Payroll cannot be generated.
                                </p>
                            </div>
                        )}
                    </div>

                    {holidayPreview.items.length > 0 && (
                        <div className="space-y-3 transition-opacity duration-200">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                        <i className="ti ti-confetti"></i>
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight truncate">Holiday Pay (DOLE)</h3>
                                        <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">Detected within cutoff — recalculated on save</p>
                                    </div>
                                </div>
                                <span className="self-start sm:self-auto shrink-0 font-black bg-amber-500 text-white px-3 py-1 rounded-lg text-xs sm:text-sm shadow-sm">
                                    +₱{holidayPreview.totalHolidayPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                            </div>

                            <div className="bg-amber-50/60 border border-amber-100 rounded-2xl divide-y divide-amber-100/80 overflow-hidden">
                                {holidayPreview.items.map((item) => (
                                    <div key={item.date} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-1 sm:gap-2 text-xs">
                                        <div>
                                            <p className="font-bold text-slate-800">
                                                {formatReadableDate(item.date)} &middot; {item.holidayName}
                                            </p>
                                            <p className="text-slate-500 mt-0.5 text-[11px]">
                                                {HOLIDAY_LABELS[item.holidayType] || item.holidayType}
                                                {item.isRestDay ? ' · Rest Day' : ''}
                                                {' · '}
                                                {item.worked ? `Worked (${item.multiplier * 100}%)` : (item.eligible ? 'Unworked (paid)' : 'Unworked (unpaid)')}
                                            </p>
                                        </div>
                                        <span className={`font-mono font-bold self-end sm:self-auto ${item.pay > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                            ₱{item.pay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="flex items-center gap-2.5 sm:gap-3">
                            <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                <i className="ti ti-adjustments"></i>
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Adjustments & Manual Overrides</h3>
                                <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">Calculated tardiness deductions & allowable HR overrides</p>
                            </div>
                        </div>

                        <div className="p-4 sm:p-5 bg-red-50/60 rounded-2xl border border-red-100 space-y-2">
                            <div className="flex justify-between items-center flex-wrap gap-1">
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
                                className="w-full p-3.5 sm:p-4 bg-white border border-red-200 rounded-xl font-mono text-red-600 text-lg sm:text-xl font-bold focus:ring-2 focus:ring-red-400 transition-all outline-none shadow-sm touch-manipulation"
                                placeholder="0.00"
                            />
                            <p className="text-[10px] sm:text-[11px] text-slate-500">
                                15-minute grace period automatically accounted for. You can adjust this amount manually before saving.
                            </p>
                        </div>
                    </div>

                    <div className="p-3.5 sm:p-4 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-2.5 sm:gap-3">
                        <i className="ti ti-shield-check text-blue-600 text-lg sm:text-xl mt-0.5 shrink-0"></i>
                        <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                            <strong>DOLE Compliance Engine:</strong> Government mandatory deductions (SSS, PhilHealth, Pag-IBIG, and TRAIN Law Withholding Tax) are automatically calculated and deducted upon generation.
                        </p>
                    </div>

                    <div className="pt-2 sm:pt-4">
                        <button
                            type="submit"
                            disabled={isSubmitting || !formData.employee_id || isInvalidDateRange || hasNoWorkedTime}
                            className="w-full min-h-[52px] sm:min-h-[56px] py-4 sm:py-5 bg-slate-900 hover:bg-blue-600 text-white font-black text-base sm:text-lg rounded-2xl shadow-xl shadow-slate-900/10 hover:shadow-blue-500/20 transition-colors flex items-center justify-center gap-2.5 sm:gap-3 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation cursor-pointer"
                        >
                            {!isSubmitting ? (
                                <>
                                    <i className="ti ti-cash text-xl sm:text-2xl"></i>
                                    <span>Compute & Distribute Payslip</span>
                                </>
                            ) : (
                                <>
                                    <i className="ti ti-loader text-xl sm:text-2xl animate-spin"></i>
                                    <span>Computing DOLE Contributions...</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {/* Searchable Employee Modal */}

            {isEmpModalOpen && (
                <div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
                >
                    <div
                        onClick={() => setIsEmpModalOpen(false)}
                        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
                    />

                    <div
                        initial={{ opacity: 0, y: 24, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 24, scale: 0.96 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10 pb-[env(safe-area-inset-bottom)]"
                    >
                        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-sm sm:text-base font-bold shrink-0">
                                    <i className="ti ti-users"></i>
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-sm sm:text-base font-extrabold text-slate-800 truncate">Select Employee</h3>
                                    <p className="text-[10px] sm:text-xs text-slate-400 truncate">Choose workforce member for payroll computation</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsEmpModalOpen(false)}
                                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-slate-200/70 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-base sm:text-lg transition-colors touch-manipulation shrink-0 ml-2 cursor-pointer"
                            >
                                <i className="ti ti-x"></i>
                            </button>
                        </div>

                        <div className="p-3.5 sm:p-4 border-b border-slate-100 space-y-3 bg-white">
                            <div className="relative">
                                <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
                                <input
                                    type="text"
                                    value={empSearch}
                                    onChange={(e) => setEmpSearch(e.target.value)}
                                    placeholder="Search by name or department..."
                                    className="w-full pl-10 pr-9 py-2.5 sm:py-3 bg-slate-100 focus:bg-white border border-transparent focus:border-blue-500 rounded-xl text-sm sm:text-base font-medium text-slate-800 outline-none transition-all"
                                />
                                {empSearch && (
                                    <button
                                        type="button"
                                        onClick={() => setEmpSearch('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                    >
                                        <i className="ti ti-x text-sm"></i>
                                    </button>
                                )}
                            </div>

                            <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {availableDepartments.map((dept) => (
                                    <button
                                        key={dept}
                                        type="button"
                                        onClick={() => setSelectedDeptFilter(dept)}
                                        className={`shrink-0 min-h-[34px] sm:min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold transition-all touch-manipulation cursor-pointer ${selectedDeptFilter === dept ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        {dept}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="overflow-y-auto p-2.5 sm:p-3 space-y-1.5 sm:space-y-2 divide-y divide-slate-100">
                            {filteredEmployees.length === 0 ? (
                                <div className="py-12 text-center text-slate-400 space-y-2">
                                    <i className="ti ti-search-off text-3xl block"></i>
                                    <p className="text-xs sm:text-sm font-semibold">No employees match your search</p>
                                </div>
                            ) : (
                                filteredEmployees.map((emp) => {
                                    const isEmpFactory = isFactoryDept(emp.department);
                                    const rate = getEmployeeRate(emp);
                                    const isSelected = String(formData.employee_id) === String(emp.id);

                                    return (
                                        <button
                                            key={emp.id}
                                            type="button"
                                            onClick={() => {
                                                setFormData(prev => ({ ...prev, employee_id: emp.id }));
                                                setIsEmpModalOpen(false);
                                            }}
                                            className={`w-full min-h-[52px] p-2.5 sm:p-3 rounded-2xl flex items-center justify-between text-left transition-colors touch-manipulation cursor-pointer ${isSelected ? 'bg-blue-50/80 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
                                        >
                                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                                <EmployeeAvatar
                                                    employee={emp}
                                                    size="h-10 w-10 sm:h-11 sm:w-11"
                                                    rounded="rounded-xl"
                                                    textSize="text-xs sm:text-sm"
                                                />
                                                <div className="min-w-0">
                                                    <p className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                                                        {emp.first_name} {emp.last_name}
                                                    </p>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <span className="text-[9px] sm:text-[10px] font-semibold text-slate-500 uppercase truncate">
                                                            {getEmployeeDept(emp)}
                                                        </span>
                                                        <span className="text-slate-300">&middot;</span>
                                                        <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-600 truncate">
                                                            ₱{rate.toLocaleString('en-US', { minimumFractionDigits: 2 })} / {isEmpFactory ? 'PC' : 'MO'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="shrink-0 ml-2">
                                                {isSelected ? (
                                                    <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">
                                                        <i className="ti ti-check"></i>
                                                    </span>
                                                ) : (
                                                    <i className="ti ti-chevron-right text-slate-300"></i>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default PayrollCreate;