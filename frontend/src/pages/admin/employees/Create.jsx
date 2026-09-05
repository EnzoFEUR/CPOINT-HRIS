import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { FACTORY_SHOE_ROLES, extractProductionLines } from '../../../utils/factoryRoles';

export default function Create({ errors = [], defaultValues = {} }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [department, setDepartment] = useState(defaultValues.department || 'Factory');
    const [selectedCraft, setSelectedCraft] = useState(defaultValues.job_title || 'Sapatero (Lapat/Swelas)');
    const [selectedGroup, setSelectedGroup] = useState('Line A');
    const [isCustomLine, setIsCustomLine] = useState(false);

    // Existing production lines from workforce cache
    const { data: workforceData } = useQuery({
        queryKey: ['adminEmployees'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/employees');
            const result = await res.json();
            return Array.isArray(result) ? result : (result.data || []);
        },
        initialData: () => queryClient.getQueryData(['adminEmployees']),
        staleTime: 60_000,
        gcTime: 300_000
    });

    const existingLines = useMemo(() => {
        const raw = Array.isArray(workforceData) ? workforceData : (workforceData?.data || []);
        const lines = extractProductionLines(raw);
        if (selectedGroup && !lines.includes(selectedGroup) && !isCustomLine) {
            lines.push(selectedGroup);
        }
        return lines;
    }, [workforceData, selectedGroup, isCustomLine]);

    // Regular salary state
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

    const handlePieceRateChange = (e) => {
        const value = e.target.value.replace(/[^0-9.]/g, '');
        setRawPieceRate(value);
        setDisplayPieceRate(formatSalary(value));
    };

    const [createdEmployee, setCreatedEmployee] = useState(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [copiedField, setCopiedField] = useState(null);
    const [copiedAll, setCopiedAll] = useState(false);
    const [showPassword, setShowPassword] = useState(true);

    const copyToClipboard = (text, fieldName) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedField(fieldName);
        toast.success(`${fieldName} copied!`);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const copyAllCredentials = () => {
        if (!createdEmployee) return;
        const text = `C-POINT HRIS Account Credentials\nName: ${createdEmployee.first_name || ''} ${createdEmployee.last_name || ''}\nCompany ID: ${createdEmployee.company_id || ''}\nEmail: ${createdEmployee.email || ''}\nTemporary Password: ${createdEmployee.temp_password || ''}\nLogin Portal: ${window.location.origin}/login`;
        navigator.clipboard.writeText(text);
        setCopiedAll(true);
        toast.success('All credentials copied to clipboard!');
        setTimeout(() => setCopiedAll(false), 2000);
    };

    const handleCreateAnother = () => {
        setShowSuccessModal(false);
        setCreatedEmployee(null);
        setDisplaySalary('');
        setRawSalary('');
        setSelectedCraft('Sapatero (Lapat/Swelas)');
        setSelectedGroup(existingLines[0] || 'Line A');
        setIsCustomLine(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        const isFactory = department === 'Factory';
        data.department = department;

        if (isFactory) {
            const lineName = (selectedGroup || 'Line A').trim();
            data.job_title = selectedCraft;
            data.pay_type = 'piece_rate';
            data.monthly_salary = null;
            data.piece_rate = null;
            data.shift = `${lineName} · Factory (08:00 AM - 05:00 PM)`;
        } else {
            data.pay_type = 'monthly';
            data.monthly_salary = parseFloat(rawSalary || 0);
            data.piece_rate = null;
            data.shift = 'Regular Worker (08:00 AM - 08:00 PM)';
        }

        setIsSubmitting(true);

        try {
            const res = await fetchWithAuth('/api/employees', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            const result = await res.json();

            if (result.success) {
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    return oldData ? [result.data, ...oldData] : [result.data];
                });
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
                queryClient.invalidateQueries({ queryKey: ['employees'] });

                setCreatedEmployee({
                    ...result.data,
                    temp_password: result.temp_password
                });
                setShowSuccessModal(true);
                setIsSubmitting(false);
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
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
            <div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
                <Link to="/admin/employees" className="px-3.5 sm:px-5 py-2 sm:py-2.5 bg-white text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-all shadow-xs sm:shadow-sm border border-slate-200 flex items-center gap-1.5 sm:gap-2 tap-active">
                    <i className="ti ti-arrow-left text-base sm:text-lg" /> Back to Directory
                </Link>
            </div>

            {errors && errors.length > 0 && (
                <div className="bg-red-500 text-white p-4 sm:p-6 rounded-2xl shadow-lg flex items-start gap-3 sm:gap-4">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                        <i className="ti ti-alert-triangle text-lg sm:text-xl" />
                    </div>
                    <div>
                        <p className="font-black text-sm sm:text-lg tracking-tight mb-1">Please fix the following errors:</p>
                        <ul className="list-disc ml-4 space-y-0.5 text-xs sm:text-sm font-medium">
                            {errors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            <div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-5 sm:p-8 lg:p-10 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100">
                <div className="mb-6 sm:mb-10 text-center">
                    <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-800 tracking-tight">Onboard Personnel</h2>
                    <p className="text-slate-500 font-medium text-xs sm:text-sm mt-1">Create a new employee profile and system account.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">

                    {/* ACCOUNT DETAILS */}
                    <div className="p-4 sm:p-6 bg-slate-50/60 rounded-2xl border border-slate-200/80">
                        <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
                            <span className="w-8 h-8 sm:w-10 sm:h-10 bg-white text-slate-700 rounded-xl flex items-center justify-center border border-slate-200 shadow-xs"><i className="ti ti-mail text-lg sm:text-xl" /></span>
                            Account Security
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Email Address</label>
                                <input type="email" name="email" required defaultValue={defaultValues.email || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all placeholder:text-slate-400"
                                    placeholder="employee@company.com" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">System Privilege</label>
                                <select name="role" defaultValue={defaultValues.role || 'employee'}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all appearance-none cursor-pointer">
                                    <option value="employee">Standard Employee</option>
                                    <option value="security">Security Guard (Scanner Access)</option>
                                    <option value="admin">System Administrator</option>
                                </select>
                            </div>

                            <div className="md:col-span-2 mt-1">
                                <div className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-xl border border-blue-100 text-[10px] sm:text-xs font-bold uppercase tracking-widest">
                                    <i className="ti ti-wand text-base" />
                                    A secure temporary password will be auto-generated.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* EMPLOYEE INFORMATION */}
                    <div className="p-4 sm:p-6 bg-slate-50/60 rounded-2xl border border-slate-200/80">
                        <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
                            <span className="w-8 h-8 sm:w-10 sm:h-10 bg-white text-slate-700 rounded-xl flex items-center justify-center border border-slate-200 shadow-xs"><i className="ti ti-id text-lg sm:text-xl" /></span>
                            Personal Profile
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">First Name</label>
                                <input type="text" name="first_name" required defaultValue={defaultValues.first_name || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all placeholder:text-slate-400"
                                    placeholder="John" />
                            </div>
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Last Name</label>
                                <input type="text" name="last_name" required defaultValue={defaultValues.last_name || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all placeholder:text-slate-400"
                                    placeholder="Doe" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Job Title</label>
                                <input type="text" name="job_title" required defaultValue={defaultValues.job_title || ''}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all placeholder:text-slate-400"
                                    placeholder="e.g. Machine Operator" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
                                <select
                                    name="department"
                                    value={department}
                                    onChange={(e) => setDepartment(e.target.value)}
                                    className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all appearance-none cursor-pointer"
                                >
                                    <option value="Factory">Factory Floor (Shoe Production)</option>
                                    <option value="Retail">Retail Store</option>
                                    <option value="Security">Security</option>
                                    <option value="HR/Admin">HR & Admin</option>
                                    <option value="IT">IT Department</option>
                                    <option value="Logistics">Logistics</option>
                                </select>
                            </div>

                            {department !== 'Factory' ? (
                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Job Title</label>
                                    <input type="text" name="job_title" required defaultValue={defaultValues.job_title || ''}
                                        className="w-full px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-base sm:text-sm text-slate-700 transition-all placeholder:text-slate-400"
                                        placeholder="e.g. Sales Associate, HR Officer" />
                                </div>
                            ) : null}

                            {/* FACTORY SHOE PRODUCTION CRAFT & GROUP SELECTION */}
                            {department === 'Factory' && (
                                <div className="md:col-span-2 space-y-4 pt-2 border-t border-slate-200/80">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-[10px] sm:text-xs font-bold text-amber-800 uppercase tracking-widest">
                                                Shoe Production Station (Select 1 of 6 Crafts)
                                            </label>
                                            <span className="text-[10px] font-bold text-slate-400">
                                                Sequential 6-Stage Assembly Line
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                            {FACTORY_SHOE_ROLES.map((craft) => {
                                                const isSelected = selectedCraft === craft.id;
                                                return (
                                                    <button
                                                        type="button"
                                                        key={craft.id}
                                                        onClick={() => setSelectedCraft(craft.id)}
                                                        className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between space-y-2 cursor-pointer ${
                                                            isSelected
                                                                ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/20 shadow-xs'
                                                                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                                                        }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                                                                    isSelected ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'
                                                                }`}>
                                                                    <i className={`ti ${craft.icon}`} />
                                                                </span>
                                                                <div>
                                                                    <p className="font-bold text-xs text-slate-800 leading-tight">{craft.label}</p>
                                                                    <p className="text-[10px] text-slate-400 font-medium">{craft.filipino}</p>
                                                                </div>
                                                            </div>
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                                                                {craft.stage.split(':')[0]}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-slate-500 leading-normal line-clamp-2">
                                                            {craft.description}
                                                        </p>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* PRODUCTION LINE ASSIGNMENT */}
                                    <div className="p-3.5 bg-white rounded-xl border border-amber-200/80">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
                                            <div>
                                                <label className="block text-[10px] sm:text-xs font-bold text-slate-700 uppercase tracking-widest">
                                                    Assigned Production Line / Group
                                                </label>
                                                <p className="text-[11px] text-slate-400 font-medium">
                                                    Assigns the worker to a distinct shoe production line (e.g. Line A, Line B, Line 7).
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const nextState = !isCustomLine;
                                                    setIsCustomLine(nextState);
                                                    if (nextState) {
                                                        setSelectedGroup('');
                                                    } else {
                                                        setSelectedGroup(existingLines[0] || 'Line A');
                                                    }
                                                }}
                                                className="self-start sm:self-auto text-[11px] font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 cursor-pointer transition-colors"
                                            >
                                                <i className={`ti ${isCustomLine ? 'ti-list' : 'ti-plus'} text-xs`} />
                                                <span>{isCustomLine ? 'Choose from existing' : '+ Create new line'}</span>
                                            </button>
                                        </div>

                                        {isCustomLine ? (
                                            <div>
                                                <input
                                                    type="text"
                                                    value={selectedGroup}
                                                    onChange={(e) => setSelectedGroup(e.target.value)}
                                                    placeholder="Type new line name (e.g. Line 7, Sneaker Line Alpha)"
                                                    autoFocus
                                                    className="w-full px-3 py-2 bg-amber-50/50 border border-amber-300 focus:border-amber-500 rounded-lg text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
                                                />
                                                <p className="text-[10px] text-amber-700 mt-1 flex items-center gap-1">
                                                    <i className="ti ti-sparkles text-xs" />
                                                    <span>This new production line will be saved and available for other workers.</span>
                                                </p>
                                            </div>
                                        ) : (
                                            <div>
                                                <select
                                                    value={selectedGroup}
                                                    onChange={(e) => {
                                                        if (e.target.value === '__NEW__') {
                                                            setIsCustomLine(true);
                                                            setSelectedGroup('');
                                                        } else {
                                                            setSelectedGroup(e.target.value);
                                                        }
                                                    }}
                                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 cursor-pointer"
                                                >
                                                    {existingLines.map(line => (
                                                        <option key={line} value={line}>{line}</option>
                                                    ))}
                                                    <option value="__NEW__">+ Create new production line...</option>
                                                </select>
                                                <p className="text-[10px] text-slate-400 mt-1">
                                                    Select an existing production line or create a custom one to organize separate teams.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="md:col-span-2">
                                <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                                    department === 'Factory' ? 'bg-amber-50/70 border-amber-200 text-amber-900' : 'bg-blue-50/70 border-blue-200 text-blue-900'
                                }`}>
                                    <div className="flex items-center gap-2.5">
                                        <i className={`ti ${department === 'Factory' ? 'ti-clock-pause text-amber-600' : 'ti-clock-play text-blue-600'} text-lg shrink-0`} />
                                        <div>
                                            <p className="text-xs font-bold">
                                                {department === 'Factory' ? 'Factory Worker Schedule: 08:00 AM - 05:00 PM' : 'Regular Worker Schedule: 08:00 AM - 08:00 PM'}
                                            </p>
                                            <p className="text-[11px] opacity-80 mt-0.5">
                                                {department === 'Factory' ? 'Fixed shift. Strictly NO overtime allowed per company policy.' : 'Extended shift. Overtime eligible for excess rendered hours.'}
                                            </p>
                                        </div>
                                    </div>
                                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${
                                        department === 'Factory' ? 'bg-amber-200/80 text-amber-900 border-amber-300' : 'bg-blue-200/80 text-blue-900 border-blue-300'
                                    }`}>
                                        {department === 'Factory' ? 'No OT' : 'OT Eligible'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* DYNAMIC PAYROLL DETAILS */}
                    <div className="p-4 sm:p-6 bg-slate-50/60 rounded-2xl border border-slate-200/80">
                        <h3 className="text-base sm:text-lg font-black text-slate-800 tracking-tight mb-4 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
                            <span className="w-8 h-8 sm:w-10 sm:h-10 bg-white text-slate-700 rounded-xl flex items-center justify-center border border-slate-200 shadow-xs">
                                <i className="ti ti-cash-banknote text-lg sm:text-xl" />
                            </span>
                            Payroll Configuration
                        </h3>

                        {department === 'Factory' ? (
                            <div className="space-y-3.5">
                                <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 text-amber-900 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-black text-xs sm:text-sm text-amber-900">
                                            <i className="ti ti-box-multiple text-lg text-amber-600" />
                                            Group Output Piece-Rate Model (Shoe Production Pool)
                                        </div>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-200/80 text-amber-900 border border-amber-300">
                                            Pakyawan Pool
                                        </span>
                                    </div>
                                    <p className="text-xs text-amber-800 leading-relaxed">
                                        Factory workers are <strong>not paid via fixed monthly salaries</strong>. Compensation is calculated per completed batch/volume of shoes produced by the 6-worker line (<strong>Cutter, Marking, Areglo, Sapatero/Swelas, Alamoda, Finishing</strong>).
                                    </p>
                                    <div className="pt-2 border-t border-amber-200/80 flex flex-wrap items-center gap-3 text-[11px] text-amber-800 font-medium">
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-check text-amber-600" /> No fixed salary set at onboarding
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-users text-amber-600" /> Production line batch pool
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-clock-off text-amber-600" /> Strictly no overtime policy
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-md">
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    Monthly Base Salary
                                </label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-lg">₱</span>
                                    <input
                                        type="text"
                                        required
                                        value={displaySalary}
                                        onChange={handleSalaryChange}
                                        className="w-full pl-9 pr-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-black text-base sm:text-lg text-slate-800 transition-all placeholder:text-slate-300"
                                        placeholder="0.00"
                                    />
                                    <input type="hidden" name="monthly_salary" value={rawSalary} />
                                </div>
                                <p className="text-[10px] sm:text-xs font-bold text-slate-400 mt-2 uppercase tracking-widest flex items-center gap-1">
                                    <i className="ti ti-info-circle" /> Used for standard semi-monthly payslip generation
                                </p>
                            </div>
                        )}
                    </div>

                    {/* SUBMIT */}
                    <div className="pt-2 sm:pt-4">
                        <button type="submit" disabled={isSubmitting} className="w-full py-3.5 sm:py-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-black text-sm sm:text-base tracking-wide rounded-xl shadow-lg tap-active transition-all flex items-center justify-center gap-2">
                            {isSubmitting ? (
                                <><i className="ti ti-loader animate-spin text-lg sm:text-xl" /> Creating Profile...</>
                            ) : (
                                <><i className="ti ti-user-plus text-lg sm:text-xl" /> Create Profile & Account</>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {/* Account Created & Temporary Password Modal */}
            
                {showSuccessModal && createdEmployee && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/70 backdrop-blur-xs">
                        <div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="bg-white rounded-2xl p-5 sm:p-7 max-w-md w-full shadow-2xl border border-slate-200 space-y-5"
                        >
                            {/* Header */}
                            <div className="text-center space-y-2">
                                <div className="h-12 w-12 bg-emerald-100 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center border border-emerald-200 shadow-xs">
                                    <i className="ti ti-check text-2xl font-bold" />
                                </div>
                                <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                                    Account Created Successfully!
                                </h3>
                                <p className="text-xs text-slate-500 font-medium">
                                    Provide these temporary login credentials to the employee.
                                </p>
                            </div>

                            {/* Credentials Card */}
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                                
                                {/* Name */}
                                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Employee</span>
                                    <span className="text-xs font-black text-slate-800">
                                        {createdEmployee.first_name} {createdEmployee.last_name}
                                    </span>
                                </div>

                                {/* Company ID */}
                                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Company ID</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(createdEmployee.company_id, 'Company ID')}
                                        className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-slate-700 hover:text-blue-600 cursor-pointer"
                                    >
                                        <span>{createdEmployee.company_id}</span>
                                        <i className={`ti ${copiedField === 'Company ID' ? 'ti-check text-emerald-500' : 'ti-copy text-slate-400'} text-xs`} />
                                    </button>
                                </div>

                                {/* Email Address */}
                                <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Login Email</span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(createdEmployee.email, 'Email')}
                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-blue-600 cursor-pointer max-w-[200px] truncate"
                                    >
                                        <span className="truncate">{createdEmployee.email}</span>
                                        <i className={`ti ${copiedField === 'Email' ? 'ti-check text-emerald-500' : 'ti-copy text-slate-400'} text-xs shrink-0`} />
                                    </button>
                                </div>

                                {/* Temporary password */}
                                <div className="p-3 bg-slate-900 rounded-lg text-white space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                                            <i className="ti ti-key text-xs" /> Temporary Password
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="text-slate-400 hover:text-white text-[11px] font-semibold flex items-center gap-1"
                                        >
                                            <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-xs`} />
                                            {showPassword ? 'Hide' : 'Show'}
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-base sm:text-lg font-black tracking-wider text-white">
                                            {showPassword ? (createdEmployee.temp_password || 'Emp-1234') : '••••••••'}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => copyToClipboard(createdEmployee.temp_password, 'Password')}
                                            className="px-2.5 py-1 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded font-bold text-xs flex items-center gap-1 transition-all cursor-pointer"
                                        >
                                            <i className={`ti ${copiedField === 'Password' ? 'ti-check text-emerald-400' : 'ti-copy'} text-xs`} />
                                            {copiedField === 'Password' ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Copy All Button */}
                            <button
                                type="button"
                                onClick={copyAllCredentials}
                                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 active:scale-98 text-blue-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors border border-blue-200 cursor-pointer"
                            >
                                <i className={`ti ${copiedAll ? 'ti-check text-emerald-600' : 'ti-clipboard-check'} text-sm`} />
                                {copiedAll ? 'Copied to Clipboard!' : 'Copy All Login Credentials'}
                            </button>

                            <p className="text-[11px] text-slate-400 text-center font-medium leading-relaxed">
                                <i className="ti ti-info-circle mr-1" />
                                The employee will be required to change this password upon their first sign-in.
                            </p>

                            {/* Modal Actions */}
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={handleCreateAnother}
                                    className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors text-center cursor-pointer"
                                >
                                    + Add Another
                                </button>
                                <Link
                                    to={`/admin/employees/${createdEmployee.id}`}
                                    className="py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-colors text-center flex items-center justify-center gap-1"
                                >
                                    View Profile <i className="ti ti-arrow-right text-xs" />
                                </Link>
                            </div>
                        </div>
                    </div>
                )}
            
        </div>
    );
}