import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';

export default function Edit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [employee, setEmployee] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [department, setDepartment] = useState('Factory');

    // Monthly Salary State
    const [displaySalary, setDisplaySalary] = useState('');
    const [rawSalary, setRawSalary] = useState('');

    // Piece Rate State
    const [displayPieceRate, setDisplayPieceRate] = useState('');
    const [rawPieceRate, setRawPieceRate] = useState('');

    useEffect(() => {
        fetchWithAuth(`/api/employees/${id}?t=${Date.now()}`)
            .then(res => res.json())
            .then(data => {
                if (data.success || data.data) {
                    const emp = data.data || data;
                    setEmployee(emp);
                    if (emp.department) setDepartment(emp.department);

                    if (emp.monthly_salary !== null && emp.monthly_salary !== undefined) {
                        setDisplaySalary(formatSalary(emp.monthly_salary));
                        setRawSalary(String(emp.monthly_salary));
                    }

                    if (emp.piece_rate !== null && emp.piece_rate !== undefined) {
                        setDisplayPieceRate(formatSalary(emp.piece_rate));
                        setRawPieceRate(String(emp.piece_rate));
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
        if (value === null || value === undefined || value === '') return '';
        let strVal = String(value);
        let num = strVal.replace(/[^\d.]/g, '');
        let parts = num.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    const handleSalaryChange = (e) => {
        const val = e.target.value.replace(/[^0-9.]/g, '');
        setRawSalary(val);
        setDisplaySalary(formatSalary(val));
    };

    const handlePieceRateChange = (e) => {
        const val = e.target.value.replace(/[^0-9.]/g, '');
        setRawPieceRate(val);
        setDisplayPieceRate(formatSalary(val));
    };

    const isFactory = department?.toLowerCase().includes('factory');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Parse numerical values safely
        const numSalary = parseFloat(String(rawSalary).replace(/[^0-9.]/g, ''));
        const numPiece = parseFloat(String(rawPieceRate).replace(/[^0-9.]/g, ''));

        const cleanSalary = !isNaN(numSalary) ? numSalary : null;
        const cleanPiece = !isNaN(numPiece) ? numPiece : null;

        // Build precise payload aligned directly with Supabase schema columns
        const payload = {
            email: data.email,
            role: data.role,
            first_name: data.first_name,
            last_name: data.last_name,
            job_title: data.job_title,
            department: department,
            pay_type: isFactory ? 'piece_rate' : 'monthly',
            monthly_salary: isFactory ? null : cleanSalary,
            piece_rate: isFactory ? cleanPiece : null,
        };

        try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            if (user?.id) payload.admin_id = user.id;

            const res = await fetchWithAuth(`/api/employees/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();

            if (res.ok && (result.success || !result.error)) {
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
                queryClient.invalidateQueries({ queryKey: ['employee', id] });

                toast.success('Profile updated successfully!');
                navigate(`/admin/employees/${id}`);
            } else {
                toast.error('Error: ' + (result.error || result.message || 'Update failed'));
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
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
            <div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                <Link to={`/admin/employees/${id}`} className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-xs sm:shadow-sm border border-slate-100 flex items-center gap-1.5 sm:gap-2 tap-active">
                    <i className="ti ti-arrow-left text-base sm:text-lg" /> Cancel Edit
                </Link>
            </div>

            <div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-5 sm:p-8 lg:p-10 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100">
                <div className="mb-6 sm:mb-10 flex items-center gap-3 sm:gap-5">
                    <div className="h-12 w-12 sm:h-16 sm:w-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100 shrink-0">
                        <i className="ti ti-pencil-code text-2xl sm:text-3xl" />
                    </div>
                    <div>
                        <h2 className="text-xl sm:text-3xl font-black text-slate-800 tracking-tight">Edit Profile</h2>
                        <p className="text-slate-500 font-medium text-xs sm:text-sm mt-0.5">Updating records for {employee.first_name} {employee.last_name}</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
                    {/* ACCOUNT DETAILS */}
                    <div className="p-4 sm:p-6 bg-slate-50/60 rounded-2xl border border-slate-200/80">
                        <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
                            <span className="w-8 h-8 sm:w-10 sm:h-10 bg-white text-indigo-600 rounded-xl flex items-center justify-center border border-slate-200 shadow-xs"><i className="ti ti-mail text-lg sm:text-xl" /></span>
                            Account Info
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email Address</label>
                                <input type="email" name="email" required defaultValue={employee.email || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-xs sm:text-sm text-slate-700 transition-all" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">System Privilege</label>
                                <select name="role" defaultValue={employee.role || 'employee'}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 font-bold text-xs sm:text-sm text-slate-700 transition-all appearance-none cursor-pointer">
                                    <option value="employee">Standard Employee</option>
                                    <option value="security">Security Guard (Scanner Access)</option>
                                    <option value="admin">System Administrator</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* EMPLOYEE INFORMATION */}
                    <div className="p-4 sm:p-6 bg-slate-50/60 rounded-2xl border border-slate-200/80">
                        <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
                            <span className="w-8 h-8 sm:w-10 sm:h-10 bg-white text-purple-600 rounded-xl flex items-center justify-center border border-slate-200 shadow-xs"><i className="ti ti-id text-lg sm:text-xl" /></span>
                            Personal Profile
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">First Name</label>
                                <input type="text" name="first_name" required defaultValue={employee.first_name || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-xs sm:text-sm text-slate-700 transition-all" />
                            </div>
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Last Name</label>
                                <input type="text" name="last_name" required defaultValue={employee.last_name || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-xs sm:text-sm text-slate-700 transition-all" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Job Title</label>
                                <input type="text" name="job_title" required defaultValue={employee.job_title || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-xs sm:text-sm text-slate-700 transition-all" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
                                <select
                                    name="department"
                                    value={department}
                                    onChange={(e) => setDepartment(e.target.value)}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 font-bold text-xs sm:text-sm text-slate-700 transition-all appearance-none cursor-pointer"
                                >
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
                    <div className={`p-4 sm:p-6 rounded-2xl border transition-all ${isFactory ? 'bg-amber-50/70 border-amber-200' : 'bg-emerald-50/70 border-emerald-100'}`}>
                        <h3 className={`text-base sm:text-lg font-black tracking-tight mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3 ${isFactory ? 'text-amber-800' : 'text-emerald-800'}`}>
                            <span className={`w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-xl flex items-center justify-center shadow-xs ${isFactory ? 'text-amber-600' : 'text-emerald-600'}`}>
                                <i className={`ti ${isFactory ? 'ti-file-barcode' : 'ti-cash-banknote'} text-lg sm:text-xl`} />
                            </span>
                            Payroll Configuration {isFactory && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-800 font-black tracking-wider uppercase ml-auto">Piece Rate Mode</span>}
                        </h3>

                        {isFactory ? (
                            <div className="max-w-md">
                                <label className="block text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1.5 text-amber-800">Rate Per Piece (₱/unit)</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg text-amber-600">₱</span>
                                    <input
                                        type="text"
                                        name="piece_rate"
                                        required
                                        value={displayPieceRate}
                                        onChange={handlePieceRateChange}
                                        className="w-full pl-9 pr-4 py-2.5 sm:py-3 bg-white border-2 border-amber-300 focus:ring-4 focus:ring-amber-500/20 focus:border-amber-500 rounded-xl focus:outline-none font-black text-base sm:text-lg text-slate-800 transition-all"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-md">
                                <label className="block text-[10px] sm:text-xs font-bold uppercase tracking-widest mb-1.5 text-emerald-700">Monthly Base Salary</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg text-emerald-500">₱</span>
                                    <input
                                        type="text"
                                        name="monthly_salary"
                                        required
                                        value={displaySalary}
                                        onChange={handleSalaryChange}
                                        className="w-full pl-9 pr-4 py-2.5 sm:py-3 bg-white border-2 border-emerald-200 focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 rounded-xl focus:outline-none font-black text-base sm:text-lg text-slate-800 transition-all"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* SUBMIT */}
                    <div className="pt-2 sm:pt-4">
                        <button type="submit" className="w-full py-3.5 sm:py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm sm:text-base tracking-wide rounded-xl shadow-lg shadow-indigo-600/20 tap-active transition-all flex items-center justify-center gap-2 cursor-pointer">
                            <i className="ti ti-device-floppy text-lg sm:text-xl" /> Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}