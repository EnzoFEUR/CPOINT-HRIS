import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function Create({ errors = [], defaultValues = {} }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [displaySalary, setDisplaySalary] = useState(defaultValues.monthly_salary ? formatSalary(defaultValues.monthly_salary) : '');
    const [rawSalary, setRawSalary] = useState(defaultValues.monthly_salary || '');
    
    function formatSalary(value) {
        let strVal = String(value);
        let num = strVal.replace(/[^\d.]/g, '');
        let parts = num.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    const handleSalaryChange = (e) => {
        const value = e.target.value.replace(/[^0-9.]/g, '');
        setRawSalary(value);
        setDisplaySalary(formatSalary(value));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.monthly_salary = parseFloat(data.monthly_salary);

        setIsSubmitting(true);
        
        // Artificial delay for smooth UX
        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            const res = await fetchWithAuth('/api/employees', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            const result = await res.json();
            
            if (result.success) {
                // Instantly inject the new employee into the local cache
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    return oldData ? [result.data, ...oldData] : [result.data];
                });

                navigate('/admin/employees', { 
                    state: { 
                        success: 'Account Created Successfully!', 
                        temp_password: result.temp_password,
                        company_id: result.data.company_id
                    } 
                });
            } else {
                toast.error('Error: ' + result.error);
                setIsSubmitting(false);
            }
        } catch (err) {
            toast.error('Network error. Failed to create account.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-16 font-sans relative">
            
            
            {/* TOP NAVIGATION */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                <Link to="/admin/employees" className="px-5 py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-all shadow-sm border border-slate-200 flex items-center gap-2">
                    <i className="ti ti-arrow-left text-lg" /> Back to Directory
                </Link>
            </motion.div>

            {errors && errors.length > 0 && (
                <div className="bg-red-500 text-white p-6 rounded-[2rem] shadow-xl shadow-red-500/20 flex items-start gap-4">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                        <i className="ti ti-alert-triangle text-xl" />
                    </div>
                    <div>
                        <p className="font-black text-lg tracking-tight mb-2">Please fix the following errors:</p>
                        <ul className="list-disc ml-4 space-y-1 font-medium">
                            {errors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 md:p-12 rounded-[3rem] shadow-sm border border-slate-100">
                <div className="mb-10 text-center">
                    <h2 className="text-3xl md:text-4xl font-black text-slate-800 tracking-tight">Onboard Personnel</h2>
                    <p className="text-slate-500 font-medium mt-2">Create a new employee profile and system account.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-10">
                    
                    {/* ACCOUNT DETAILS */}
                    <div className="p-8 bg-white rounded-[2rem] border border-slate-200 shadow-sm">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight mb-6 flex items-center gap-3">
                            <span className="w-10 h-10 bg-slate-100 text-slate-700 rounded-xl flex items-center justify-center border border-slate-200"><i className="ti ti-mail text-xl" /></span>
                            Account Security
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Email Address</label>
                                <input type="email" name="email" required defaultValue={defaultValues.email || ''}
                                       className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-700 transition-all placeholder:text-slate-400"
                                       placeholder="employee@company.com" />
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">System Privilege</label>
                                <select name="role" defaultValue={defaultValues.role || 'employee'}
                                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-700 transition-all appearance-none cursor-pointer">
                                    <option value="employee">Standard Employee</option>
                                    <option value="security">Security Guard (Scanner Access)</option>
                                    <option value="admin">System Administrator</option>
                                </select>
                            </div>
                            
                            <div className="md:col-span-2 mt-2">
                                <div className="inline-flex items-center gap-3 px-4 py-3 bg-blue-50 text-blue-700 rounded-xl border border-blue-100 text-xs font-bold uppercase tracking-widest">
                                    <i className="ti ti-wand text-lg" />
                                    A secure temporary password will be auto-generated.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* EMPLOYEE INFORMATION */}
                    <div className="p-8 bg-white rounded-[2rem] border border-slate-200 shadow-sm">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight mb-6 flex items-center gap-3">
                            <span className="w-10 h-10 bg-slate-100 text-slate-700 rounded-xl flex items-center justify-center border border-slate-200"><i className="ti ti-id text-xl" /></span>
                            Personal Profile
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">First Name</label>
                                <input type="text" name="first_name" required defaultValue={defaultValues.first_name || ''}
                                       className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-700 transition-all placeholder:text-slate-400"
                                       placeholder="John" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Last Name</label>
                                <input type="text" name="last_name" required defaultValue={defaultValues.last_name || ''}
                                       className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-700 transition-all placeholder:text-slate-400"
                                       placeholder="Doe" />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Job Title</label>
                                <input type="text" name="job_title" required defaultValue={defaultValues.job_title || ''}
                                       className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-700 transition-all placeholder:text-slate-400"
                                       placeholder="e.g. Forklift Operator" />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Department</label>
                                <select name="department" defaultValue={defaultValues.department || 'Factory'}
                                        className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-700 transition-all appearance-none cursor-pointer">
                                    <option value="Factory">Factory Floor</option>
                                    <option value="Retail">Retail Store</option>
                                    <option value="Security">Security</option>
                                    <option value="HR/Admin">HR & Admin</option>
                                    <option value="IT">IT Department</option>
                                    <option value="Logistics">Logistics</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* PAYROLL DETAILS */}
                    <div className="p-8 bg-white rounded-[2rem] border border-slate-200 shadow-sm">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight mb-6 flex items-center gap-3">
                            <span className="w-10 h-10 bg-slate-100 text-slate-700 rounded-xl flex items-center justify-center border border-slate-200"><i className="ti ti-cash-banknote text-xl" /></span>
                            Payroll Configuration
                        </h3>
                        
                        <div className="max-w-md">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Monthly Base Salary</label>
                            <div className="relative">
                                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xl">₱</span>
                                <input type="text" required value={displaySalary} onChange={handleSalaryChange}
                                       className="w-full pl-12 pr-5 py-4 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-black text-xl text-slate-800 transition-all placeholder:text-slate-300"
                                       placeholder="0.00" />
                                <input type="hidden" name="monthly_salary" value={rawSalary} />
                            </div>
                            <p className="text-xs font-bold text-slate-400 mt-3 uppercase tracking-widest"><i className="ti ti-info-circle" /> Used for standard payslip generation</p>
                        </div>
                    </div>

                    {/* SUBMIT */}
                    <div className="pt-6">
                        <button type="submit" disabled={isSubmitting} className="w-full py-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black text-lg tracking-wide rounded-2xl shadow-xl shadow-slate-900/10 active:scale-95 transition-all flex items-center justify-center gap-3">
                            {isSubmitting ? (
                                <><i className="ti ti-loader animate-spin text-2xl" /> Creating Profile...</>
                            ) : (
                                <><i className="ti ti-user-plus text-2xl" /> Create Profile & Account</>
                            )}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
