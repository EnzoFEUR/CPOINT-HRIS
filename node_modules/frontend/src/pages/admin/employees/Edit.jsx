import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

export default function Edit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [employee, setEmployee] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [displaySalary, setDisplaySalary] = useState('');
    const [rawSalary, setRawSalary] = useState('');

    useEffect(() => {
        fetch(`http://localhost:5000/api/employees/${id}`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setEmployee(data.data);
                    if (data.data.monthly_salary) {
                        setDisplaySalary(formatSalary(data.data.monthly_salary));
                        setRawSalary(data.data.monthly_salary);
                    }
                } else {
                    toast.error('Employee not found');
                    navigate('/admin/employees');
                }
            })
            .catch(() => toast.error('Failed to load employee'))
            .finally(() => setIsLoading(false));
    }, [id, navigate]);

    function formatSalary(value) {
        let strVal = String(value);
        let num = strVal.replace(/[^\d.]/g, '');
        let parts = num.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    const handleSalaryChange = (e) => {
        const val = e.target.value;
        setDisplaySalary(formatSalary(val));
        setRawSalary(val.replace(/[^\d.]/g, ''));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.monthly_salary = parseFloat(data.monthly_salary);

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            data.admin_id = user?.id;

            const res = await fetch(`http://localhost:5000/api/employees/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            
            if (result.success) {
                toast.success('Profile updated successfully!');
                navigate(`/admin/employees/${id}`);
            } else {
                toast.error('Error: ' + result.error);
            }
        } catch (err) {
            toast.error('Network error. Failed to update account.');
        }
    };

    if (isLoading || !employee) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Editor...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-16 font-sans relative">
            
            
            <div className="fixed top-[-10%] left-[-5%] w-[40vw] h-[40vw] bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />
            <div className="fixed bottom-[-10%] right-[-5%] w-[40vw] h-[40vw] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none -z-10" />

            {/* TOP NAVIGATION */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                <Link to={`/admin/employees/${id}`} className="px-5 py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm border border-slate-100 flex items-center gap-2">
                    <i className="ti ti-arrow-left text-lg" /> Cancel Edit
                </Link>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-8 md:p-12 rounded-[3rem] shadow-sm border border-slate-100">
                <div className="mb-10 flex items-center gap-6">
                    <div className="h-20 w-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center border border-indigo-100 shrink-0">
                        <i className="ti ti-pencil-code text-4xl" />
                    </div>
                    <div>
                        <h2 className="text-3xl md:text-4xl font-black text-slate-800 tracking-tight">Edit Profile</h2>
                        <p className="text-slate-500 font-medium mt-1">Updating records for {employee.first_name} {employee.last_name}</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-10">
                    
                    {/* ACCOUNT DETAILS */}
                    <div className="p-8 bg-slate-50/50 rounded-[2rem] border border-slate-100">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight mb-6 flex items-center gap-3">
                            <span className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100"><i className="ti ti-mail text-xl" /></span>
                            Account Info
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Email Address</label>
                                <input type="email" name="email" required defaultValue={employee.email || ''}
                                       className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-slate-700 transition-all placeholder:text-slate-300"
                                />
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">System Privilege</label>
                                <select name="role" defaultValue={employee.role || 'employee'}
                                        className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-slate-700 transition-all appearance-none cursor-pointer">
                                    <option value="employee">Standard Employee</option>
                                    <option value="security">Security Guard (Scanner Access)</option>
                                    <option value="admin">System Administrator</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* EMPLOYEE INFORMATION */}
                    <div className="p-8 bg-slate-50/50 rounded-[2rem] border border-slate-100">
                        <h3 className="text-lg font-black text-slate-800 tracking-tight mb-6 flex items-center gap-3">
                            <span className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center border border-purple-100"><i className="ti ti-id text-xl" /></span>
                            Personal Profile
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">First Name</label>
                                <input type="text" name="first_name" required defaultValue={employee.first_name || ''}
                                       className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-slate-700 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Last Name</label>
                                <input type="text" name="last_name" required defaultValue={employee.last_name || ''}
                                       className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-slate-700 transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Job Title</label>
                                <input type="text" name="job_title" required defaultValue={employee.job_title || ''}
                                       className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-slate-700 transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Department</label>
                                <select name="department" defaultValue={employee.department || 'Factory'}
                                        className="w-full px-5 py-4 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-slate-700 transition-all appearance-none cursor-pointer">
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
                    <div className="p-8 bg-emerald-50 rounded-[2rem] border border-emerald-100 shadow-inner">
                        <h3 className="text-lg font-black text-emerald-800 tracking-tight mb-6 flex items-center gap-3">
                            <span className="w-10 h-10 bg-white text-emerald-600 rounded-xl flex items-center justify-center shadow-sm"><i className="ti ti-cash-banknote text-xl" /></span>
                            Payroll Configuration
                        </h3>
                        
                        <div className="max-w-md">
                            <label className="block text-xs font-bold text-emerald-700 uppercase tracking-widest mb-2">Monthly Base Salary</label>
                            <div className="relative">
                                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-emerald-500 font-black text-xl">₱</span>
                                <input type="text" required value={displaySalary} onChange={handleSalaryChange}
                                       className="w-full pl-12 pr-5 py-4 bg-white border-2 border-emerald-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 font-black text-xl text-slate-800 transition-all"
                                />
                                <input type="hidden" name="monthly_salary" value={rawSalary} />
                            </div>
                            <p className="text-xs font-bold text-emerald-600/70 mt-3 uppercase tracking-widest"><i className="ti ti-info-circle" /> Modifying this will affect future payroll processing.</p>
                        </div>
                    </div>

                    {/* SUBMIT */}
                    <div className="pt-6">
                        <button type="submit" className="w-full py-5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black text-lg tracking-wide rounded-2xl shadow-xl shadow-indigo-600/30 active:scale-95 transition-all flex items-center justify-center gap-3">
                            <i className="ti ti-device-floppy text-2xl" /> Save Changes
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
}
