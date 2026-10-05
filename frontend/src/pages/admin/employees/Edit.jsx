import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { FACTORY_SHOE_ROLES, extractProductionLines, getShoeRoleDetails, parseProductionGroup } from '../../../utils/factoryRoles';
import { formatPhPhone, validatePhPhone, cleanPhPhone } from '../../../utils/phoneUtils';

export default function Edit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const cachedEmp = useMemo(() => {
        const details = queryClient.getQueryData(['employeeDetails', id])?.data;
        if (details) return details;
        const list = queryClient.getQueryData(['adminEmployees']);
        if (Array.isArray(list)) {
            return list.find(e => String(e.id) === String(id)) || null;
        }
        return null;
    }, [queryClient, id]);

    const [employee, setEmployee] = useState(cachedEmp);
    const [isLoading, setIsLoading] = useState(!cachedEmp);

    const [emailInput, setEmailInput] = useState(cachedEmp?.email || '');
    const [emailStatus, setEmailStatus] = useState({ state: 'idle', message: '' });

    const [phone, setPhone] = useState(cachedEmp?.phone ? formatPhPhone(cachedEmp.phone) : '');
    const phoneValidation = useMemo(() => validatePhPhone(phone), [phone]);

    const [department, setDepartment] = useState(cachedEmp?.department || 'Factory');
    const [selectedCraft, setSelectedCraft] = useState(() => {
        const match = getShoeRoleDetails(cachedEmp?.job_title);
        return match ? match.id : 'Sapatero (Lapat/Swelas)';
    });
    const [selectedGroup, setSelectedGroup] = useState(() => {
        return parseProductionGroup(cachedEmp?.shift) || 'Line A';
    });
    const [selectedGroupId, setSelectedGroupId] = useState(cachedEmp?.production_group_id || '');
    const [isCustomLine, setIsCustomLine] = useState(false);

    const [gender, setGender] = useState(cachedEmp?.gender || '');
    const [birthDate, setBirthDate] = useState(cachedEmp?.birth_date ? String(cachedEmp.birth_date).split('T')[0] : '');
    const [address, setAddress] = useState(cachedEmp?.address || '');

    const maxBirthDate = useMemo(() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 15);
        return d.toISOString().split('T')[0];
    }, []);

    // Fetch real production groups from the dedicated database table
    const { data: productionGroupsData } = useQuery({
        queryKey: ['productionGroups'],
        queryFn: async () => {
            const res = await fetchWithAuth('/api/production-groups');
            const result = await res.json();
            return result?.data || [];
        },
        staleTime: 60_000,
        gcTime: 300_000
    });

    const productionGroups = useMemo(() => {
        return Array.isArray(productionGroupsData) ? productionGroupsData : [];
    }, [productionGroupsData]);

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

    const [rawDailyPay, setRawDailyPay] = useState(() => {
        const val = cachedEmp?.daily_rate ?? (cachedEmp?.monthly_salary ? (Number(cachedEmp.monthly_salary) / 26).toFixed(2) : '');
        return val ? String(val) : '';
    });
    const [displayDailyPay, setDisplayDailyPay] = useState(() => {
        const val = cachedEmp?.daily_rate ?? (cachedEmp?.monthly_salary ? (Number(cachedEmp.monthly_salary) / 26).toFixed(2) : '');
        return val ? formatSalary(val) : '';
    });

    const [rawHourlyPay, setRawHourlyPay] = useState(() => {
        const val = cachedEmp?.hourly_rate ?? (cachedEmp?.daily_rate ? (Number(cachedEmp.daily_rate) / 8).toFixed(2) : '');
        return val ? String(val) : '';
    });
    const [displayHourlyPay, setDisplayHourlyPay] = useState(() => {
        const val = cachedEmp?.hourly_rate ?? (cachedEmp?.daily_rate ? (Number(cachedEmp.daily_rate) / 8).toFixed(2) : '');
        return val ? formatSalary(val) : '';
    });

    useEffect(() => {
        let isMounted = true;
        fetchWithAuth(`/api/employees/${id}`)
            .then(res => res.json())
            .then(data => {
                if (!isMounted) return;
                if (data.success || data.data) {
                    const emp = data.data || data;
                    setEmployee(emp);
                    if (emp.department) setDepartment(emp.department);

                    const craftMatch = getShoeRoleDetails(emp.job_title);
                    if (craftMatch) setSelectedCraft(craftMatch.id);

                    const parsedGroup = parseProductionGroup(emp.shift);
                    if (parsedGroup) setSelectedGroup(parsedGroup);

                    const daily = emp.daily_rate ?? (emp.monthly_salary ? (Number(emp.monthly_salary) / 26).toFixed(2) : '');
                    const hourly = emp.hourly_rate ?? (daily ? (Number(daily) / 8).toFixed(2) : '');

                    if (daily) {
                        setRawDailyPay(String(daily));
                        setDisplayDailyPay(formatSalary(daily));
                    }
                    if (hourly) {
                        setRawHourlyPay(String(hourly));
                        setDisplayHourlyPay(formatSalary(hourly));
                    }
                    if (emp.phone) {
                        setPhone(formatPhPhone(emp.phone));
                    }
                    if (emp.email) {
                        setEmailInput(emp.email);
                    }
                    if (emp.gender) {
                        setGender(emp.gender);
                    }
                    if (emp.birth_date) {
                        setBirthDate(String(emp.birth_date).split('T')[0]);
                    }
                    if (emp.address) {
                        setAddress(emp.address);
                    }
                } else if (!cachedEmp) {
                    toast.error('Employee not found');
                    navigate('/admin/employees');
                }
            })
            .catch(() => {
                if (!cachedEmp && isMounted) toast.error('Failed to load employee');
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [id, navigate, cachedEmp]);

    // Real-time low-latency email conflict and archive availability check
    useEffect(() => {
        const clean = String(emailInput || '').trim().toLowerCase();
        if (!clean) {
            setEmailStatus({ state: 'empty', message: '' });
            return;
        }
        if (clean === String(employee?.email || '').trim().toLowerCase()) {
            setEmailStatus({ state: 'current', message: '' });
            return;
        }

        const timer = setTimeout(async () => {
            try {
                const res = await fetchWithAuth(`/api/employees/check-email?email=${encodeURIComponent(clean)}&exclude_id=${id}`);
                const data = await res.json();
                if (data.heldByArchived) {
                    setEmailStatus({
                        state: 'archived',
                        message: 'Archived record (will auto-reassign)'
                    });
                } else if (data.available) {
                    setEmailStatus({
                        state: 'available',
                        message: 'Available'
                    });
                } else {
                    setEmailStatus({
                        state: 'conflict',
                        message: data.message || 'Email in use by active personnel'
                    });
                }
            } catch (_) {
                setEmailStatus({ state: 'idle', message: '' });
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [emailInput, employee?.email, id]);

    function formatSalary(value) {
        if (value === null || value === undefined || value === '') return '';
        let strVal = String(value);
        let num = strVal.replace(/[^\d.]/g, '');
        let parts = num.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    const handleDailyPayChange = (e) => {
        const value = e.target.value.replace(/[^0-9.]/g, '');
        setRawDailyPay(value);
        setDisplayDailyPay(formatSalary(value));

        const num = parseFloat(value);
        if (!isNaN(num) && num > 0) {
            const hourly = (num / 8).toFixed(2);
            setRawHourlyPay(hourly);
            setDisplayHourlyPay(formatSalary(hourly));
        } else {
            setRawHourlyPay('');
            setDisplayHourlyPay('');
        }
    };

    const handleHourlyPayChange = (e) => {
        const value = e.target.value.replace(/[^0-9.]/g, '');
        setRawHourlyPay(value);
        setDisplayHourlyPay(formatSalary(value));

        const num = parseFloat(value);
        if (!isNaN(num) && num > 0) {
            const daily = (num * 8).toFixed(2);
            setRawDailyPay(daily);
            setDisplayDailyPay(formatSalary(daily));
        } else {
            setRawDailyPay('');
            setDisplayDailyPay('');
        }
    };

    const isFactory = department?.toLowerCase().includes('factory');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Parse numerical values safely
        const numDaily = parseFloat(String(rawDailyPay).replace(/[^0-9.]/g, ''));
        const cleanDailyRate = !isNaN(numDaily) ? numDaily : null;

        const numHourly = parseFloat(String(rawHourlyPay).replace(/[^0-9.]/g, ''));
        const cleanHourlyRate = !isNaN(numHourly) ? numHourly : null;

        const lineName = (selectedGroup || 'Line A').trim();

        let groupId = null;
        if (isFactory) {
            if (!isCustomLine) {
                const found = productionGroups.find(g => g.id === selectedGroupId) ||
                              productionGroups.find(g => g.name === selectedGroup);
                groupId = found?.id || selectedGroupId || null;
            }
        }

        if (emailStatus.state === 'conflict') {
            toast.error(emailStatus.message || 'This email address is already registered to another active personnel.');
            return;
        }

        const cleanEmail = (emailInput || data.email || '').trim().toLowerCase();
        if (!cleanEmail) {
            toast.error('A valid email address is required.');
            return;
        }

        const phoneCheck = validatePhPhone(phone);
        if (!phoneCheck.isValid) {
            toast.error(phoneCheck.message || 'A valid 11-digit Philippine mobile phone number starting with 09 is required.');
            return;
        }

        // Form payload
        const payload = {
            email: cleanEmail,
            phone: phoneCheck.cleanPhone,
            role: data.role,
            first_name: data.first_name,
            last_name: data.last_name,
            gender: gender || null,
            birth_date: birthDate || null,
            address: (address || '').trim() || null,
            job_title: isFactory ? selectedCraft : data.job_title,
            department: department,
            production_group_id: isFactory ? groupId : null,
            pay_type: isFactory ? 'piece_rate' : 'daily',
            daily_rate: cleanDailyRate,
            hourly_rate: cleanHourlyRate,
            shift: isFactory 
                ? `${lineName} · Factory (08:00 AM - 05:00 PM)` 
                : 'Regular Worker (08:00 AM - 08:00 PM)',
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
                const updated = result.data || { ...employee, ...payload };
                queryClient.setQueryData(['adminEmployees'], (old) => {
                    if (!Array.isArray(old)) return old;
                    return old.map(e => String(e.id) === String(id) ? { ...e, ...updated } : e);
                });
                queryClient.setQueryData(['employeeDetails', id], (old) => {
                    if (!old) return old;
                    return { ...old, data: { ...old.data, ...updated } };
                });

                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
                queryClient.invalidateQueries({ queryKey: ['employeeDetails', id] });
                queryClient.invalidateQueries({ queryKey: ['productionGroups'] });

                toast.success('Profile updated successfully!');
                navigate(`/admin/employees/${id}`);
            } else {
                toast.error(result.error || result.message || 'Update failed');
            }
        } catch (err) {
            toast.error('Network error. Failed to update account.');
        }
    };

    if (isLoading || !employee) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-accent rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Editor...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
            <div className="flex items-center justify-between">
                <Link to={`/admin/employees/${id}`} className="h-8 px-3 bg-white text-slate-600 font-semibold text-xs rounded-md hover:bg-slate-50 hover:text-accent transition-colors duration-100 shadow-2xs border border-slate-200 flex items-center gap-1.5">
                    <i className="ti ti-arrow-left text-sm" /> Cancel Edit
                </Link>
            </div>

            <div className="bg-white p-5 sm:p-6 rounded-lg shadow-2xs border border-slate-200">
                <div className="mb-6 flex items-center gap-3.5">
                    <div className="h-10 w-10 bg-accent-subtle text-accent rounded-md flex items-center justify-center border border-accent/20 shrink-0">
                        <i className="ti ti-pencil text-xl" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Edit Profile</h2>
                        <p className="text-slate-500 font-medium text-xs mt-0.5">Updating records for {employee.first_name} {employee.last_name}</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* ACCOUNT DETAILS */}
                    <div className="p-4 sm:p-5 bg-slate-50/50 rounded-lg border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2.5">
                            <span className="w-7 h-7 bg-white text-slate-700 rounded-md flex items-center justify-center border border-slate-200 shadow-2xs"><i className="ti ti-mail text-base" /></span>
                            Account Info
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        Email Address <span className="text-danger-ink">*</span>
                                    </label>
                                    {emailStatus.state !== 'idle' && emailStatus.state !== 'empty' && emailStatus.state !== 'current' && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors duration-100 ${
                                            emailStatus.state === 'available'
                                                ? 'bg-surface-muted text-ink border border-line'
                                                : emailStatus.state === 'archived'
                                                ? 'bg-accent-subtle text-accent border border-accent/20'
                                                : emailStatus.state === 'conflict'
                                                ? 'bg-danger-subtle text-danger-ink border border-danger/20'
                                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                                        }`}>
                                            {emailStatus.message}
                                        </span>
                                    )}
                                </div>
                                <input 
                                    type="email" 
                                    name="email" 
                                    required 
                                    value={emailInput}
                                    onChange={(e) => setEmailInput(e.target.value)}
                                    placeholder="employee@cpoint.com"
                                    className={`w-full h-9 px-3 bg-white border rounded-md focus:outline-none text-xs text-slate-800 transition-colors duration-100 shadow-2xs ${
                                        emailStatus.state === 'available'
                                            ? 'border-line focus:border-line'
                                            : emailStatus.state === 'archived'
                                            ? 'border-accent/20 focus:border-accent'
                                            : emailStatus.state === 'conflict'
                                            ? 'border-danger/20 focus:border-danger'
                                            : 'border-slate-200 focus:border-accent'
                                    }`} 
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        Mobile Phone <span className="text-danger-ink">*</span>
                                    </label>
                                    {phone && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors duration-100 ${
                                            phoneValidation.isValid
                                                ? 'bg-surface-muted text-ink border border-line'
                                                : phoneValidation.status === 'invalid_prefix'
                                                ? 'bg-danger-subtle text-danger-ink border border-danger/20'
                                                : 'bg-warning-subtle text-warning-ink border border-warning/20'
                                        }`}>
                                            {phoneValidation.isValid ? (phoneValidation.carrier || 'Valid PH Mobile') : phoneValidation.message}
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 text-xs font-bold font-mono">
                                        +63
                                    </div>
                                    <input
                                        type="tel"
                                        name="phone"
                                        required
                                        value={phone}
                                        onChange={(e) => setPhone(formatPhPhone(e.target.value))}
                                        placeholder="0917 123 4567"
                                        className={`w-full h-9 pl-12 pr-3 bg-white border rounded-md focus:outline-none text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 font-mono shadow-2xs ${
                                            phone && phoneValidation.isValid
                                                ? 'border-line focus:border-line'
                                                : phone && !phoneValidation.isValid
                                                ? 'border-warning/20 focus:border-warning'
                                                : 'border-slate-200 focus:border-accent'
                                        }`}
                                    />
                                </div>
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">System Privilege</label>
                                <select name="role" defaultValue={employee.role || 'employee'}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 appearance-none cursor-pointer shadow-2xs">
                                    <option value="employee">Standard Employee</option>
                                    <option value="security">Security Guard (Scanner Access)</option>
                                    <option value="admin">System Administrator</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* EMPLOYEE INFORMATION */}
                    <div className="p-4 sm:p-5 bg-slate-50/50 rounded-lg border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2.5">
                            <span className="w-7 h-7 bg-white text-slate-700 rounded-md flex items-center justify-center border border-slate-200 shadow-2xs"><i className="ti ti-id text-base" /></span>
                            Personal Profile
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">First Name</label>
                                <input type="text" name="first_name" required defaultValue={employee.first_name || ''}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 shadow-2xs" />
                            </div>
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Last Name</label>
                                <input type="text" name="last_name" required defaultValue={employee.last_name || ''}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 shadow-2xs" />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Gender</label>
                                <select 
                                    name="gender" 
                                    value={gender}
                                    onChange={(e) => setGender(e.target.value)}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 appearance-none cursor-pointer shadow-2xs"
                                >
                                    <option value="">Select Gender</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                    <option value="Other">Other</option>
                                    <option value="Prefer not to say">Prefer not to say</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Date of Birth</label>
                                <input 
                                    type="date" 
                                    name="birth_date" 
                                    max={maxBirthDate}
                                    min="1920-01-01"
                                    value={birthDate}
                                    onChange={(e) => setBirthDate(e.target.value)}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 font-mono transition-colors duration-100 shadow-2xs" 
                                />
                            </div>

                            <div className="md:col-span-2">
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">Residential Address</label>
                                    <span className="text-[10px] text-slate-400 font-mono">{address.length} / 300</span>
                                </div>
                                <textarea 
                                    name="address" 
                                    rows={2}
                                    maxLength={300}
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    placeholder="Unit / House No., Street, Barangay, City / Municipality, Province, Postal Code"
                                    className="w-full p-2.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs resize-none" 
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Department</label>
                                <select
                                    name="department"
                                    value={department}
                                    onChange={(e) => setDepartment(e.target.value)}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 appearance-none cursor-pointer shadow-2xs"
                                >
                                    <option value="Factory">Factory Floor (Shoe Production)</option>
                                    <option value="Retail">Retail Store</option>
                                    <option value="Security">Security</option>
                                    <option value="HR/Admin">HR & Admin</option>
                                    <option value="IT">IT Department</option>
                                    <option value="Logistics">Logistics</option>
                                </select>
                            </div>

                            {!isFactory ? (
                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Job Title</label>
                                    <input type="text" name="job_title" required defaultValue={employee.job_title || ''}
                                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 shadow-2xs" />
                                </div>
                            ) : null}

                            {/* FACTORY SHOE PRODUCTION CRAFT & GROUP SELECTION */}
                            {isFactory && (
                                <div className="md:col-span-2 space-y-4 pt-2 border-t border-slate-200/80">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-[10px] sm:text-xs font-bold text-warning-ink uppercase tracking-widest">
                                                Shoe Production Station (Select 1 of 6 Crafts)
                                            </label>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                            {FACTORY_SHOE_ROLES.map((craft) => {
                                                const isSelected = selectedCraft === craft.id;
                                                return (
                                                    <button
                                                        type="button"
                                                        key={craft.id}
                                                        onClick={() => setSelectedCraft(craft.id)}
                                                        className={`p-2.5 rounded-md border text-left transition-colors duration-100 flex items-center justify-between gap-2.5 cursor-pointer ${
                                                            isSelected
                                                                ? 'bg-warning/10 border-warning ring-1 ring-warning/30 shadow-2xs'
                                                                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <span className={`w-7 h-7 rounded-md flex items-center justify-center text-xs shrink-0 ${
                                                                isSelected ? 'bg-warning text-white' : 'bg-slate-100 text-slate-600'
                                                            }`}>
                                                                <i className={`ti ${craft.icon}`} />
                                                            </span>
                                                            <div className="min-w-0">
                                                                <p className="font-bold text-xs text-slate-800 leading-tight truncate">{craft.label}</p>
                                                                <p className="text-[10px] text-slate-400 font-medium truncate">{craft.filipino}</p>
                                                            </div>
                                                        </div>
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0 border border-slate-200/60">
                                                            {craft.stage.split(':')[0]}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* PRODUCTION LINE ASSIGNMENT */}
                                    <div className="p-3 bg-white rounded-md border border-warning/20">
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
                                                className="self-start sm:self-auto text-[11px] font-bold text-warning-ink hover:text-warning-ink flex items-center gap-1 cursor-pointer transition-colors duration-100"
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
                                                    className="w-full h-9 px-3 bg-warning-subtle/50 border border-warning/20 focus:border-warning rounded-md text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors duration-100 shadow-2xs"
                                                />
                                                <p className="text-[10px] text-warning-ink mt-1 flex items-center gap-1">
                                                    <i className="ti ti-sparkles text-xs" />
                                                    <span>This new production line will be saved and available for other workers.</span>
                                                </p>
                                            </div>
                                        ) : (
                                            <div>
                                                <select
                                                    value={selectedGroupId || (productionGroups.find(g => g.name === selectedGroup)?.id || '')}
                                                    onChange={(e) => {
                                                        if (e.target.value === '__NEW__') {
                                                            setIsCustomLine(true);
                                                            setSelectedGroupId('');
                                                            setSelectedGroup('');
                                                        } else {
                                                            setSelectedGroupId(e.target.value);
                                                            const found = productionGroups.find(g => g.id === e.target.value);
                                                            if (found) setSelectedGroup(found.name);
                                                        }
                                                    }}
                                                    className="w-full h-9 px-3 bg-slate-50 border border-slate-200 rounded-md text-xs font-semibold text-slate-700 focus:outline-none focus:border-warning transition-colors duration-100 cursor-pointer shadow-2xs"
                                                >
                                                    {productionGroups.length > 0 ? (
                                                        productionGroups.map(group => (
                                                            <option key={group.id} value={group.id}>
                                                                {group.name} ({group.code}) {group.member_count !== undefined ? `· ${group.member_count} active workers` : ''}
                                                            </option>
                                                        ))
                                                    ) : (
                                                        <option value="">Loading production lines...</option>
                                                    )}
                                                    <option value="__NEW__">+ Create new production line...</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="md:col-span-2">
                                <div className={`p-3 rounded-md border flex items-center justify-between gap-3 ${
                                    isFactory ? 'bg-warning-subtle/70 border-warning/20 text-warning-ink' : 'bg-accent-subtle/70 border-accent/20 text-accent-strong'
                                }`}>
                                    <div className="flex items-center gap-2.5">
                                        <i className={`ti ${isFactory ? 'ti-clock-pause text-warning-ink' : 'ti-clock-play text-accent'} text-base shrink-0`} />
                                        <div>
                                            <p className="text-xs font-bold">
                                                {isFactory ? 'Factory Worker Schedule: 08:00 AM - 05:00 PM' : 'Regular Worker Schedule: 08:00 AM - 08:00 PM'}
                                            </p>
                                        </div>
                                    </div>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${
                                        isFactory ? 'bg-warning-subtle/80 text-warning-ink border-warning/20' : 'bg-accent-subtle/80 text-accent-strong border-accent/20'
                                    }`}>
                                        {isFactory ? 'No OT' : 'OT Eligible'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* PAYROLL DETAILS */}
                    <div className={`p-4 sm:p-5 rounded-lg border ${isFactory ? 'bg-warning-subtle/70 border-warning/20' : 'bg-surface-muted border-line'}`}>
                        <h3 className={`text-sm font-bold tracking-tight mb-4 flex items-center gap-2.5 ${isFactory ? 'text-warning-ink' : 'text-ink'}`}>
                            <span className={`w-7 h-7 bg-white rounded-md flex items-center justify-center shadow-2xs ${isFactory ? 'text-warning-ink' : 'text-ink'}`}>
                                <i className={`ti ${isFactory ? 'ti-file-barcode' : 'ti-cash-banknote'} text-base`} />
                            </span>
                            Payroll Configuration {isFactory && <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-md bg-warning-subtle text-warning-ink border border-warning/20 font-semibold ml-auto"><span className="w-1.5 h-1.5 rounded-full bg-warning" />Pakyawan Pool Mode</span>}
                        </h3>

                        {isFactory ? (
                            <div className="space-y-3">
                                <div className="p-3.5 rounded-md border border-warning/20 bg-white text-warning-ink space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold text-xs text-warning-ink">
                                            <i className="ti ti-box-multiple text-base text-warning-ink" />
                                            Group Output Piece-Rate Model (Shoe Production Pool)
                                        </div>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-warning-subtle/80 text-warning-ink border border-warning/20">
                                            Pakyawan Pool
                                        </span>
                                    </div>
                                    <div className="pt-2 border-t border-warning/80 flex flex-wrap items-center gap-3 text-[11px] text-warning-ink font-medium">
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-check text-warning-ink" /> No arbitrary monthly base salary
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-users text-warning-ink" /> Batch piece-rate distribution
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <i className="ti ti-clock-off text-warning-ink" /> Strictly no overtime policy
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        Daily Pay Rate
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₱</span>
                                        <input
                                            type="text"
                                            value={displayDailyPay}
                                            onChange={handleDailyPayChange}
                                            className="w-full h-10 pl-8 pr-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent font-bold text-sm text-slate-800 transition-colors duration-100 placeholder:text-slate-300 font-mono shadow-2xs"
                                            placeholder="0.00"
                                        />
                                        <input type="hidden" name="daily_rate" value={rawDailyPay} />
                                    </div>
                                    <p className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-1.5 uppercase tracking-widest flex items-center gap-1">
                                        <i className="ti ti-calendar" /> Base daily compensation rate
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                        Hourly Pay Rate
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₱</span>
                                        <input
                                            type="text"
                                            value={displayHourlyPay}
                                            onChange={handleHourlyPayChange}
                                            className="w-full h-10 pl-8 pr-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent font-bold text-sm text-slate-800 transition-colors duration-100 placeholder:text-slate-300 font-mono shadow-2xs"
                                            placeholder="0.00"
                                        />
                                        <input type="hidden" name="hourly_rate" value={rawHourlyPay} />
                                    </div>
                                    <p className="text-[10px] sm:text-xs font-semibold text-slate-400 mt-1.5 uppercase tracking-widest flex items-center gap-1">
                                        <i className="ti ti-clock" /> Calculated per 8-hour workday standard
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* SUBMIT */}
                    <div className="pt-2">
                        <button type="submit" className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs tracking-wide rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer">
                            <i className="ti ti-device-floppy text-sm" /> Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}