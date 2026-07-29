import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { motion } from 'framer-motion';
import { fetchWithAuth } from '../utils/api';

export default function ProcessPayroll() {
    const [employees, setEmployees] = useState([]);
    const [employeeId, setEmployeeId] = useState('');
    const [periodStart, setPeriodStart] = useState('');
    const [periodEnd, setPeriodEnd] = useState('');
    const [daysWorked, setDaysWorked] = useState(0);
    const [overtimeHours, setOvertimeHours] = useState(0);
    const [lateDeductions, setLateDeductions] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        const fetchEmployees = async () => {
            const { data } = await supabase.from('employees').select('*');
            if (data) setEmployees(data);
        };
        fetchEmployees();
    }, []);

    // Simulate auto-calculation when dates or employee changes
    useEffect(() => {
        if (employeeId && periodStart && periodEnd) {
            // Mock auto-calc: 11 days per cutoff
            setDaysWorked(11);
        }
    }, [employeeId, periodStart, periodEnd]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            const res = await fetchWithAuth('/api/payroll', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: employeeId,
                    period_start: periodStart,
                    period_end: periodEnd,
                    days_worked: daysWorked,
                    overtime_hours: overtimeHours,
                    late_deductions: lateDeductions || 0
                })
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Failed to process payroll');
            
            setSuccess('Payroll Computed & Saved successfully!');
            // Reset form
            setEmployeeId('');
            setPeriodStart('');
            setPeriodEnd('');
            setDaysWorked(0);
            setOvertimeHours(0);
            setLateDeductions('');
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto py-10 px-4">
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 mb-8">
                    <div className="h-12 w-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-2xl shadow-lg shadow-blue-100">
                        
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Process PH Payroll</h2>
                        <p className="text-slate-400 text-sm font-medium uppercase tracking-tight">Standard Automated Computation</p>
                    </div>
                </div>

                {error && (
                    <div className="mb-8 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <span className="text-red-500 mt-0.5 text-xl"></span>
                        <div>
                            <h4 className="text-sm font-bold text-red-800">Action Stopped</h4>
                            <p className="text-sm text-red-600 mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {success && (
                    <div className="mb-8 p-4 bg-green-50 border-l-4 border-green-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <span className="text-green-500 mt-0.5 text-xl"></span>
                        <div>
                            <h4 className="text-sm font-bold text-green-800">Success</h4>
                            <p className="text-sm text-green-600 mt-1">{success}</p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Employee</label>
                            <select 
                                value={employeeId} 
                                onChange={(e) => setEmployeeId(e.target.value)} 
                                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                                required
                            >
                                <option value="" disabled>Select an employee...</option>
                                {employees.map(emp => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.first_name} {emp.last_name} (₱{parseFloat(emp.monthly_salary).toLocaleString()})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Payroll Period</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="date" 
                                    value={periodStart} 
                                    onChange={(e) => setPeriodStart(e.target.value)}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                                    required 
                                />
                                <span className="text-slate-300 font-bold">-</span>
                                <input 
                                    type="date" 
                                    value={periodEnd} 
                                    onChange={(e) => setPeriodEnd(e.target.value)}
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                                    required 
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-bold text-slate-800">Attendance Data</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100">
                                <label className="block text-xs font-bold text-blue-600 uppercase mb-2">Days Worked</label>
                                <input 
                                    type="number" 
                                    value={daysWorked}
                                    className="w-full p-3 bg-white border border-blue-200 rounded-xl font-mono text-lg outline-none" 
                                    readOnly 
                                />
                            </div>
                            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100">
                                <label className="block text-xs font-bold text-blue-600 uppercase mb-2">Overtime Hours</label>
                                <input 
                                    type="number" 
                                    step="0.5" 
                                    value={overtimeHours}
                                    onChange={(e) => setOvertimeHours(e.target.value)}
                                    className="w-full p-3 bg-white border border-blue-200 rounded-xl font-mono text-lg outline-none" 
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-bold text-red-600">Adjustments</h3>
                        <div className="relative p-6 bg-red-50 rounded-[2rem] border border-red-100">
                            <label className="block text-xs font-bold text-red-500 uppercase mb-2">Late / Absences (₱)</label>
                            <input 
                                type="number" 
                                step="0.01" 
                                value={lateDeductions}
                                onChange={(e) => setLateDeductions(e.target.value)}
                                className="w-full p-4 bg-white border border-red-200 rounded-xl font-mono text-red-600 text-xl font-bold outline-none" 
                                placeholder="0.00" 
                            />
                        </div>
                    </div>

                    <div className="pt-6">
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="w-full py-5 bg-slate-900 hover:bg-blue-600 text-white font-bold rounded-2xl shadow-xl transition-all flex items-center justify-center disabled:opacity-70"
                        >
                            {isSubmitting ? 'Processing...' : 'Compute & Generate Payslip'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
