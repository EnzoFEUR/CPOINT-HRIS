import React, { useState, useEffect } from 'react';
import Flatpickr from 'react-flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { fetchWithAuth } from '../../../utils/api';

const PayrollCreate = () => {
    const [employees, setEmployees] = useState([]);
    const [formData, setFormData] = useState({
        employee_id: '',
        period_start: '',
        period_end: '',
        days_worked: 0,
        overtime_hours: 0,
        late_deductions: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isCalculating, setIsCalculating] = useState(false);

    useEffect(() => {
        // Fetch active employees
        fetchWithAuth('/api/employees')
            .then(res => res.json())
            .then(result => setEmployees(result.data || []))
            .catch(err => console.error(err));

        // Inject custom Flatpickr styling
        const style = document.createElement('style');
        style.innerHTML = `
            .flatpickr-calendar {
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 1.5rem !important;
                border: 1px solid rgba(0, 0, 0, 0.05) !important;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
                padding: 10px;
                font-family: inherit;
            }
            .flatpickr-day.selected { background: #2563eb !important; border-color: #2563eb !important; border-radius: 10px !important; }
            .flatpickr-day:hover { background: #eff6ff !important; border-radius: 10px !important; }
            .flatpickr-months .flatpickr-month { color: #1e293b !important; font-weight: 700; }
            .flatpickr-current-month .flatpickr-monthDropdown-months { font-weight: 700 !important; }
        `;
        document.head.appendChild(style);
        return () => document.head.removeChild(style);
    }, []);

    useEffect(() => {
        const calculatePayroll = async () => {
            if (formData.employee_id && formData.period_start && formData.period_end) {
                setIsCalculating(true);
                try {
                    const res = await fetchWithAuth(`/api/attendance?employee_id=${formData.employee_id}&start_date=${formData.period_start}&end_date=${formData.period_end}`);
                    const logs = await res.json();
                    
                    const dole_divisor = 21.75;
                    const grace_period = 15; 
                    
                    const employee = employees.find(e => String(e.id) === String(formData.employee_id));
                    const salary = employee ? parseFloat(employee.salary || 0) : 0;
                    
                    const dailyRate = salary / dole_divisor;
                    const hourlyRate = dailyRate / 8;
                    const perMinuteRate = hourlyRate / 60;

                    let days_worked = 0;
                    let totalOvertime = 0;
                    let adjustments = 0;

                    const completedLogs = Array.isArray(logs) ? logs.filter(l => l.time_out) : [];
                    days_worked = completedLogs.length;

                    completedLogs.forEach(log => {
                        const timeIn = new Date(log.time_in);
                        const timeOut = new Date(log.time_out);
                        
                        const scheduleStart = new Date(log.date + 'T08:00:00');
                        
                        if (timeIn > scheduleStart) {
                            const minutes = Math.floor((timeIn - scheduleStart) / 60000);
                            if (minutes > grace_period) {
                                adjustments += (minutes * perMinuteRate);
                            }
                        }

                        const hoursWorked = (timeOut - timeIn) / (1000 * 60 * 60);
                        if (hoursWorked > 9) {
                            totalOvertime += (hoursWorked - 9);
                        }
                    });

                    setFormData(prev => ({
                        ...prev,
                        days_worked: days_worked,
                        overtime_hours: parseFloat(totalOvertime.toFixed(2)),
                        late_deductions: adjustments > 0 ? adjustments.toFixed(2) : ''
                    }));

                } catch (err) {
                    console.error("Calculation error:", err);
                } finally {
                    setIsCalculating(false);
                }
            }
        };
        calculatePayroll();
    }, [formData.employee_id, formData.period_start, formData.period_end, employees]);

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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || data.error) {
                setError(data.error || 'Failed to process payroll');
            } else {
                setSuccess('Payroll Computed & Saved!');
                // Reset form
                setFormData({
                    employee_id: '',
                    period_start: '',
                    period_end: '',
                    days_worked: 0,
                    overtime_hours: 0,
                    late_deductions: ''
                });
            }
        } catch (err) {
            setError('Connection error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100">
                
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="h-12 w-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-blue-100">
                        <i className="ti ti-file-invoice"></i>
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Payroll Calculator</h2>
                        <p className="text-slate-400 text-sm font-medium uppercase tracking-tight">Automated DOLE Wage & Deductions Calculation</p>
                    </div>
                </div>

                {/* --- ERROR ALERT BLOCK --- */}
                {error && (
                    <div className="mb-8 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-red-500 mt-0.5 text-xl"></i>
                        <div>
                            <h4 className="text-sm font-bold text-red-800">Action Stopped</h4>
                            <p className="text-sm text-red-600 mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {/* --- SUCCESS ALERT BLOCK --- */}
                {success && (
                    <div className="mb-8 p-4 bg-green-50 border-l-4 border-green-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-check text-green-500 mt-0.5 text-xl"></i>
                        <div>
                            <h4 className="text-sm font-bold text-green-800">Success</h4>
                            <p className="text-sm text-green-600 mt-1">{success}</p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-8">
                    {/* 1. Employee & Period Selection */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Employee</label>
                            <select 
                                name="employee_id" 
                                value={formData.employee_id}
                                onChange={handleInputChange} 
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer" 
                                required
                            >                            
                                <option value="" disabled>Select an employee...</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.first_name} {emp.last_name} (₱{parseFloat(emp.salary || 0).toLocaleString('en-US', {minimumFractionDigits: 2})})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Payroll Period</label>
                            <div className="flex items-center gap-2">
                                
                                {/* Start Date */}
                                <div className="w-full">
                                    <Flatpickr
                                        value={formData.period_start}
                                        onChange={([date]) => setFormData({...formData, period_start: date.toISOString().split('T')[0]})}
                                        options={{ dateFormat: "Y-m-d", altInput: true, altFormat: "F j, Y", disableMobile: true }}
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                                        placeholder="Start Date"
                                    />
                                </div>
                                
                                <span className="text-slate-300 font-bold">-</span>
                                
                                {/* End Date */}
                                <div className="w-full">
                                    <Flatpickr
                                        value={formData.period_end}
                                        onChange={([date]) => setFormData({...formData, period_end: date.toISOString().split('T')[0]})}
                                        options={{ dateFormat: "Y-m-d", altInput: true, altFormat: "F j, Y", disableMobile: true }}
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                                        placeholder="End Date"
                                    />
                                </div>

                            </div>
                        </div>
                    </div>

                    {/* 2. Attendance Data */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <i className="ti ti-calendar-check text-blue-600"></i> Attendance Data
                            </h3>
                            {isCalculating && (
                                <div className="text-xs font-bold text-blue-500 animate-pulse">
                                    Calculating logs...
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100">
                                <label className="block text-xs font-bold text-blue-600 uppercase mb-2">Days Worked</label>
                                <input 
                                    type="number" 
                                    step="0.5" 
                                    name="days_worked" 
                                    value={formData.days_worked} 
                                    readOnly 
                                    className="w-full p-3 bg-white border border-blue-200 rounded-xl font-mono text-lg focus:ring-2 focus:ring-blue-400 outline-none transition-all" 
                                    required 
                                />
                                <p className="text-[10px] text-blue-400 mt-2 font-bold uppercase tracking-tighter">Auto-calculated</p>
                            </div>
                            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100">
                                <label className="block text-xs font-bold text-blue-600 uppercase mb-2">Overtime Hours</label>
                                <input 
                                    type="number" 
                                    step="0.5" 
                                    name="overtime_hours" 
                                    value={formData.overtime_hours} 
                                    readOnly 
                                    className="w-full p-3 bg-white border border-blue-200 rounded-xl font-mono text-lg outline-none transition-all" 
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                        <div className="flex items-start gap-3">
                            <i className="ti ti-info-circle text-blue-500 mt-0.5"></i>
                            <p className="text-xs text-slate-600 leading-relaxed">
                                <strong>Automated Deductions Active:</strong> Income Tax (TRAIN Law), SSS, PhilHealth, and Pag-IBIG contributions will be automatically calculated by the system.
                            </p>
                        </div>
                        <div className="flex items-start gap-3 mt-1">
                            <i className="ti ti-scale text-blue-500 mt-0.5"></i>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                                <strong>Compliance Note:</strong> Daily rates are calculated using the DOLE standard EEMR factor (21.75 days/month). A 15-minute grace period is applied to all time-in logs.
                            </p>
                        </div>
                    </div>

                    {/* 3. Adjustments */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-red-600 flex items-center gap-2">
                                <i className="ti ti-minus"></i> Adjustments
                            </h3>
                        </div>

                        <div className="relative p-6 bg-red-50 rounded-[2rem] border border-red-100">
                            <div className="flex justify-between items-end mb-2">
                                <label className="block text-xs font-bold text-red-500 uppercase">Late / Absences (₱)</label>
                                <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider bg-white px-2 py-1 rounded-md border border-red-100">HR Override Allowed</span>
                            </div>
                            <input 
                                type="number" 
                                step="0.01" 
                                name="late_deductions" 
                                value={formData.late_deductions}
                                onChange={handleInputChange} 
                                className="w-full p-4 bg-white border border-red-200 rounded-xl font-mono text-red-600 text-xl font-bold focus:ring-4 focus:ring-red-100 transition-all outline-none" 
                                placeholder="0.00" 
                            />
                            <p className="text-[10px] text-red-400 mt-2">This amount is auto-calculated but can be manually adjusted before generating the payslip.</p>
                        </div>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-6">
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="w-full py-5 bg-slate-900 hover:bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-slate-100 transition-all duration-300 transform hover:-translate-y-1 flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:-translate-y-0 disabled:hover:bg-slate-900"
                        >
                            {!isSubmitting ? (
                                <i className="ti ti-calculator group-hover:scale-110 transition-transform"></i>
                            ) : (
                                <i className="ti ti-loader animate-spin"></i>
                            )}
                            <span>{isSubmitting ? 'Processing...' : 'Compute & Generate Payslip'}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PayrollCreate;
