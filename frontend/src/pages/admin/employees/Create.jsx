import { getManilaWorkDate } from '../../../../../shared/workPolicy.mjs';
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { FACTORY_SHOE_ROLES } from '../../../utils/factoryRoles';
import { formatPhPhone, validatePhPhone } from '../../../utils/phoneUtils';
import PhilippineAddressSelector from '../../../components/PhilippineAddressSelector';
import EmailDomainWarning from '../../../components/EmailDomainWarning';
import { sanitizePersonnelText, isPersonnelEmailInput, isValidPersonnelEmail, isEmployeePayInput, getEmployeePayError } from '../../../../../shared/personnelInput.mjs';
import BackButton from '../../../components/ui/BackButton';

export default function Create({ errors = [], defaultValues = {} }) {
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [role, setRole] = useState(defaultValues.role || 'employee');
    const isSecurityRole = role === 'security';
    const [stationLocation, setStationLocation] = useState(defaultValues.job_title || 'Main Gate Terminal');
    const [department, setDepartment] = useState(defaultValues.department || 'Factory');
    const [selectedCraft, setSelectedCraft] = useState(defaultValues.job_title || 'Sapatero (Lapat/Swelas)');
    const [selectedGroup, setSelectedGroup] = useState('Line A');
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [isCustomLine, setIsCustomLine] = useState(false);
    const [phone, setPhone] = useState(defaultValues.phone ? formatPhPhone(defaultValues.phone) : '');
    const [emailInput, setEmailInput] = useState(defaultValues.email || '');
    const phoneValidation = useMemo(() => validatePhPhone(phone), [phone]);
    const [firstName, setFirstName] = useState(defaultValues.first_name || '');
    const [lastName, setLastName] = useState(defaultValues.last_name || '');
    const [sex, setSex] = useState(defaultValues.sex || defaultValues.gender || '');
    const [birthDate, setBirthDate] = useState(defaultValues.birth_date || '');
    const [hireDate, setHireDate] = useState(defaultValues.date_hired || '');
    const [timekeepingDate, setTimekeepingDate] = useState(defaultValues.timekeeping_effective_date || getManilaWorkDate());
    const [address, setAddress] = useState(defaultValues.address || '');

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

    if (!selectedGroupId && productionGroups.length > 0) {
        const defaultLine = productionGroups.find(g => g.name === 'Line A') || productionGroups[0];
        if (defaultLine) {
            setSelectedGroupId(defaultLine.id);
            setSelectedGroup(defaultLine.name);
        }
    }

    // Existing production lines from workforce cache (fallback)
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

    // Real-time (0ms) duplicate name detection against workforce & archive
    const matchingArchivedEmployee = useMemo(() => {
        const fn = firstName.trim().toLowerCase();
        const ln = lastName.trim().toLowerCase();
        if (!fn || !ln || fn.length < 2 || ln.length < 2) return null;

        const allEmps = Array.isArray(workforceData) ? workforceData : (workforceData?.data || []);
        return allEmps.find(e => {
            const matchesName = (e.first_name || '').trim().toLowerCase() === fn && 
                                (e.last_name || '').trim().toLowerCase() === ln;
            const isSeparated = e.is_terminated || e.status === 'terminated' || e.status === 'inactive' || e.is_active === false;
            return matchesName && isSeparated;
        });
    }, [firstName, lastName, workforceData]);

    const matchingActiveEmployee = useMemo(() => {
        const fn = firstName.trim().toLowerCase();
        const ln = lastName.trim().toLowerCase();
        if (!fn || !ln || fn.length < 2 || ln.length < 2) return null;

        const allEmps = Array.isArray(workforceData) ? workforceData : (workforceData?.data || []);
        return allEmps.find(e => {
            const matchesName = (e.first_name || '').trim().toLowerCase() === fn && 
                                (e.last_name || '').trim().toLowerCase() === ln;
            const isActive = !e.is_terminated && e.status !== 'terminated' && e.status !== 'inactive' && e.is_active !== false;
            return matchesName && isActive;
        });
    }, [firstName, lastName, workforceData]);

    // Regular Pay State (Daily & Hourly)
    const [rawDailyPay, setRawDailyPay] = useState(defaultValues.daily_rate || defaultValues.monthly_salary ? String(defaultValues.daily_rate || '') : '');
    const [displayDailyPay, setDisplayDailyPay] = useState(defaultValues.daily_rate ? formatSalary(defaultValues.daily_rate) : '');

    const [rawHourlyPay, setRawHourlyPay] = useState(defaultValues.hourly_rate || '');
    const [displayHourlyPay, setDisplayHourlyPay] = useState(defaultValues.hourly_rate ? formatSalary(defaultValues.hourly_rate) : '');
    const [payError, setPayError] = useState('');

    function formatSalary(value) {
        let strVal = String(value);
        let num = strVal.replace(/[^\d.]/g, '');
        let parts = num.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    const handleDailyPayChange = (e) => {
        const value = e.target.value.replace(/,/g, '').trim();
        if (!isEmployeePayInput(value)) {
            setPayError(getEmployeePayError({ daily_rate: value }));
            return;
        }
        setPayError('');
        setRawDailyPay(value);
        setDisplayDailyPay(formatSalary(value));

        // Auto-calculate Hourly Pay (8 hours workday)
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
        const value = e.target.value.replace(/,/g, '').trim();
        if (!isEmployeePayInput(value)) {
            setPayError(getEmployeePayError({ hourly_rate: value }));
            return;
        }
        const daily = value && value !== '.' ? (Number(value) * 8).toFixed(2) : '';
        const error = getEmployeePayError({ daily_rate: daily });
        if (error) {
            setPayError(error);
            return;
        }
        setPayError('');
        setRawHourlyPay(value);
        setDisplayHourlyPay(formatSalary(value));

        // Auto-calculate Daily Pay (8 hours workday)
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
        const roleLabel = createdEmployee.role === 'security' ? 'Security Guard (Scanner Access)' : 'Employee';
        const targetApp = createdEmployee.role === 'security' ? 'Attendance Scanner Kiosk (/scanner)' : 'Employee Self-Service Portal';
        const text = `C-POINT HRIS Account Credentials\nRole: ${roleLabel}\nName: ${createdEmployee.first_name || ''} ${createdEmployee.last_name || ''}\nCompany ID: ${createdEmployee.company_id || ''}\nEmail: ${createdEmployee.email || ''}\nTemporary Password: ${createdEmployee.temp_password || ''}\nLogin Portal: ${window.location.origin}/login\nDesignated Access: ${targetApp}`;
        navigator.clipboard.writeText(text);
        setCopiedAll(true);
        toast.success('All credentials copied to clipboard!');
        setTimeout(() => setCopiedAll(false), 2000);
    };

    const handleCreateAnother = () => {
        setShowSuccessModal(false);
        setCreatedEmployee(null);
        setFirstName('');
        setLastName('');
        setEmailInput('');
        setDisplayDailyPay('');
        setRawDailyPay('');
        setDisplayHourlyPay('');
        setRawHourlyPay('');
        setPayError('');
        setSelectedCraft('Sapatero (Lapat/Swelas)');
        setSex('');
        setBirthDate('');
        setHireDate('');
        setAddress('');
        setRole('employee');
        setStationLocation('Main Gate Terminal');
        const defaultLine = productionGroups.find(g => g.name === 'Line A') || productionGroups[0];
        setSelectedGroupId(defaultLine?.id || '');
        setSelectedGroup(defaultLine?.name || 'Line A');
        setIsCustomLine(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isValidPersonnelEmail(emailInput.trim())) {
            toast.error('Enter a valid email address.');
            return;
        }
        if (!isSecurityRole && department !== 'Factory') {
            const error = payError || getEmployeePayError({ daily_rate: rawDailyPay, hourly_rate: rawHourlyPay });
            if (error) { toast.error(error); return; }
        }
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.email = emailInput.trim().toLowerCase();

        if (phone && phone.trim()) {
            const phoneCheck = validatePhPhone(phone);
            if (!phoneCheck.isValid) {
                toast.error(phoneCheck.message || 'A valid 10-digit Philippine mobile phone number starting with 9 is required.');
                return;
            }
            data.phone = phoneCheck.cleanPhone;
        } else {
            data.phone = null;
        }

        data.role = role;

        if (isSecurityRole) {
            data.department = 'Security';
            data.job_title = (stationLocation || 'Security Guard').trim();
            data.shift = 'Security Shift · Gate Terminal';
            data.production_group_id = null;
            data.production_group_name = null;
            data.pay_type = 'daily';
            data.daily_rate = 0;
            data.hourly_rate = 0;
            data.monthly_salary = null;
            data.piece_rate = null;
            data.sex = null;
            data.gender = null;
            data.birth_date = null;
            data.address = null;
            data.date_hired = hireDate || getManilaWorkDate();
            data.timekeeping_effective_date = getManilaWorkDate();
        } else {
            data.sex = sex || null;
            data.gender = sex || null;
            data.birth_date = birthDate || null;
            data.date_hired = hireDate;
            data.timekeeping_effective_date = timekeepingDate || getManilaWorkDate();
            data.address = (address || '').trim() || null;

            const isFactory = department === 'Factory';
            data.department = department;

            if (isFactory) {
                data.job_title = selectedCraft;
                data.pay_type = 'piece_rate';
                data.monthly_salary = null;
                data.daily_rate = null;
                data.hourly_rate = null;
                data.piece_rate = null;

                if (isCustomLine) {
                    const customName = (selectedGroup || '').trim();
                    data.production_group_name = customName;
                    data.production_group_id = null;
                    data.shift = `${customName} · Factory (08:00 AM - 05:00 PM)`;
                } else {
                    const activeGroup = productionGroups.find(g => g.id === selectedGroupId) ||
                        productionGroups.find(g => g.name === selectedGroup);
                    const resolvedId = activeGroup?.id || selectedGroupId || null;
                    const resolvedName = activeGroup?.name || selectedGroup || 'Line A';
                    data.production_group_id = resolvedId;
                    data.production_group_name = resolvedName;
                    data.shift = `${resolvedName} · Factory (08:00 AM - 05:00 PM)`;
                }
            } else {
                data.production_group_id = null;
                data.pay_type = 'daily';
                data.daily_rate = parseFloat(rawDailyPay || 0);
                data.hourly_rate = parseFloat(rawHourlyPay || 0);
                data.monthly_salary = parseFloat(rawDailyPay || 0) * 26;
                data.piece_rate = null;
                data.shift = 'Regular Worker (08:00 AM - 08:00 PM)';
            }
        }

        setIsSubmitting(true);

        try {
            const res = await fetchWithAuth('/api/employees', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            const result = await res.json();

            if (result.success) {
                const createdRecord = {
                    ...result.data,
                    temp_password: result.temp_password,
                    requires_password_change: true
                };
                queryClient.setQueryData(['adminEmployees'], (oldData) => {
                    return oldData ? [createdRecord, ...oldData] : [createdRecord];
                });
                if (result.data?.id) {
                    queryClient.setQueryData(['employeeDetails', String(result.data.id)], {
                        data: createdRecord,
                        documents: []
                    });
                }
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
                queryClient.invalidateQueries({ queryKey: ['productionGroups'] });

                setCreatedEmployee(createdRecord);
                setShowSuccessModal(true);
                setIsSubmitting(false);
            } else {
                const message = result.error || 'The employee account could not be created.';
                const requestId = res.headers.get('X-Request-ID');
                toast.error(res.status >= 500 && requestId ? `${message} Reference: ${requestId}` : message);
                setIsSubmitting(false);
            }
        } catch {
            toast.error('Network error. Failed to create account.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 pb-24 lg:pb-6 px-4 sm:px-6 lg:px-8 font-sans relative">
            <div className="flex items-center justify-between">
                <BackButton fallback="/admin/employees" label="Back to Directory" />
            </div>

            {errors && errors.length > 0 && (
                <div className="bg-danger-subtle border border-danger/20 text-danger-ink p-4 rounded-lg shadow-2xs flex items-start gap-3">
                    <div className="w-8 h-8 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center shrink-0">
                        <i className="ti ti-alert-triangle text-base" />
                    </div>
                    <div>
                        <p className="font-bold text-sm tracking-tight mb-1">Please fix the following errors:</p>
                        <ul className="list-disc ml-4 space-y-0.5 text-xs font-medium">
                            {errors.map((error, index) => <li key={index}>{error}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            <div className="bg-white p-5 sm:p-6 rounded-lg shadow-2xs border border-slate-200">
                <div className="mb-6 text-center">
                    <div className="inline-flex items-center gap-2 mb-2">
                        {isSecurityRole && (
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-900 text-white shadow-2xs flex items-center gap-1.5">
                                <i className="ti ti-scan text-xs" />
                                Scanner Kiosk Provisioning Mode
                            </span>
                        )}
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                        {isSecurityRole ? 'Provision Security Guard Terminal' : 'Onboard Personnel'}
                    </h2>
                    <p className="text-slate-500 font-medium text-xs mt-1">
                        {isSecurityRole 
                            ? 'Provision an attendance terminal account configured for gate QR code scanning.' 
                            : 'Create a new employee profile and system account.'}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">

                    {/* ACCOUNT DETAILS */}
                    <div className="p-4 sm:p-5 bg-slate-50/50 rounded-lg border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2.5">
                            <span className="w-7 h-7 bg-white text-slate-700 rounded-md flex items-center justify-center border border-slate-200 shadow-2xs"><i className="ti ti-mail text-base" /></span>
                            Account Security
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    Email Address <span className="text-danger-ink">*</span>
                                </label>
                                <input type="email" name="email" required maxLength={254} value={emailInput} onChange={e => {
                                        if (!isPersonnelEmailInput(e.target.value)) {
                                            toast.error('Use letters, numbers, @, dots, hyphens, underscores and plus signs only.', { id: 'personnel-email-characters' });
                                            return;
                                        }
                                        setEmailInput(e.target.value);
                                    }}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs"
                                    placeholder={isSecurityRole ? "guard-gate1@c-point.com" : "employee@company.com"} />
                                <EmailDomainWarning email={emailInput} />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">
                                        Mobile Phone <span className="text-slate-400 font-normal lowercase">(optional)</span>
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
                                        maxLength={12}
                                        value={phone}
                                        onChange={(e) => setPhone(formatPhPhone(e.target.value))}
                                        placeholder="917 123 4567"
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
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    System Privilege <span className="text-danger-ink">*</span>
                                </label>
                                <select 
                                    name="role" 
                                    value={role}
                                    onChange={(e) => setRole(e.target.value)}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 appearance-none cursor-pointer shadow-2xs"
                                >
                                    <option value="employee">Standard Employee (Portal, Leaves, Payslips)</option>
                                    <option value="security">Security Guard (Scanner Access Only)</option>
                                </select>
                                <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5">
                                    <i className="ti ti-shield-lock text-slate-400 text-xs" />
                                    <span>Administrator accounts require privileged governance. To provision an admin, use the <Link to="/admin/employees/provision-admin" className="text-accent font-semibold hover:underline">Admin Provisioning Portal</Link>.</span>
                                </p>
                            </div>

                            {isSecurityRole && (
                                <div className="md:col-span-2 space-y-3 pt-1">
                                    <div className="p-3.5 bg-accent-subtle/80 border border-accent/20 rounded-md text-xs text-accent-strong flex items-start gap-3 shadow-2xs">
                                        <div className="w-8 h-8 rounded-md bg-accent-subtle flex items-center justify-center shrink-0 text-accent font-bold mt-0.5">
                                            <i className="ti ti-scan text-base" />
                                        </div>
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold text-slate-900">Dedicated Scanner Operator Account</span>
                                                <span className="px-1.5 py-0.5 bg-accent-subtle text-accent font-semibold text-[10px] rounded uppercase tracking-wider border border-accent/20">
                                                    Kiosk Streamlined
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-slate-600 leading-relaxed font-normal">
                                                This account is provisioned strictly to operate the Attendance QR Scanner. In compliance with enterprise data minimization, personal HR fields (Philippine address, birth date, sex) and payroll compensation configurations are automatically bypassed.
                                            </p>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Assigned Station / Gate Location <span className="text-slate-400 font-normal lowercase">(optional)</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={stationLocation}
                                            maxLength={120}
                                            onChange={(e) => setStationLocation(sanitizePersonnelText(e.target.value, 'job_title'))}
                                            placeholder="e.g. Main Gate Terminal, Turnstile A, Warehouse Entrance"
                                            className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs"
                                        />
                                        <p className="text-[10px] text-slate-400 mt-1">Identifies the physical gate or scanner station in audit logs and terminal headers.</p>
                                    </div>
                                </div>
                            )}

                            <div className="md:col-span-2 mt-1">
                                <div className="inline-flex items-center gap-2 p-2.5 bg-accent-subtle text-accent rounded-md border border-accent/20 text-xs font-medium">
                                    <i className="ti ti-wand text-sm" />
                                    A secure temporary password will be auto-generated.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* EMPLOYEE / OPERATOR INFORMATION */}
                    <div className="p-4 sm:p-5 bg-slate-50/50 rounded-lg border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2.5">
                            <span className="w-7 h-7 bg-white text-slate-700 rounded-md flex items-center justify-center border border-slate-200 shadow-2xs">
                                <i className={`ti ${isSecurityRole ? 'ti-device-tablet' : 'ti-id'} text-base`} />
                            </span>
                            {isSecurityRole ? 'Operator / Station Identity' : 'Personal Profile'}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    {isSecurityRole ? 'Station Label / First Name' : 'First Name'} <span className="text-danger-ink">*</span>
                                </label>
                                <input 
                                    type="text" 
                                    name="first_name" 
                                    required 
                                    value={firstName}
                                    maxLength={100}
                                    onChange={(e) => setFirstName(sanitizePersonnelText(e.target.value))}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs"
                                    placeholder={isSecurityRole ? "Main Gate" : "John"} 
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                    {isSecurityRole ? 'Terminal Name / Last Name' : 'Last Name'} <span className="text-danger-ink">*</span>
                                </label>
                                <input 
                                    type="text" 
                                    name="last_name" 
                                    required 
                                    value={lastName}
                                    maxLength={100}
                                    onChange={(e) => setLastName(sanitizePersonnelText(e.target.value))}
                                    className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs"
                                    placeholder={isSecurityRole ? "Guard" : "Doe"} 
                                />
                            </div>

                            {/* Real-time Enterprise Collision / Duplicate Advisory */}
                            {matchingArchivedEmployee && (
                                <div className="md:col-span-2 p-3 bg-warning-subtle/90 border border-warning/20 rounded-md text-xs flex items-start gap-3 text-warning-ink shadow-2xs">
                                    <div className="w-7 h-7 rounded-md bg-warning-subtle flex items-center justify-center shrink-0 text-warning-ink mt-0.5">
                                        <i className="ti ti-archive text-base" />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-warning-ink">Archived Record Found in Vault</span>
                                            <span className="px-1.5 py-0.5 bg-warning-subtle/90 text-warning-ink font-mono text-[10px] font-bold rounded">
                                                {matchingArchivedEmployee.company_id || 'ID N/A'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-warning-ink leading-relaxed font-normal">
                                            A separated personnel record for <strong>"{matchingArchivedEmployee.first_name} {matchingArchivedEmployee.last_name}"</strong> ({matchingArchivedEmployee.job_title || 'Former Employee'}) exists in the Archive Vault. 
                                            The system will automatically allocate a <strong>distinct new Company ID</strong> and independent biometric facial baseline. No historical attendance, payroll, or personnel records will collide.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {!matchingArchivedEmployee && matchingActiveEmployee && (
                                <div className="md:col-span-2 p-3 bg-accent-subtle/90 border border-accent/20 rounded-md text-xs flex items-start gap-3 text-accent-strong shadow-2xs">
                                    <div className="w-7 h-7 rounded-md bg-accent-subtle flex items-center justify-center shrink-0 text-accent mt-0.5">
                                        <i className="ti ti-users text-base" />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-accent-strong">Active Personnel with Same Name</span>
                                            <span className="px-1.5 py-0.5 bg-accent-subtle/90 text-accent-strong font-mono text-[10px] font-bold rounded">
                                                {matchingActiveEmployee.company_id || 'ID N/A'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-accent-strong leading-relaxed font-normal">
                                            An active employee named <strong>"{matchingActiveEmployee.first_name} {matchingActiveEmployee.last_name}"</strong> ({matchingActiveEmployee.job_title} · {matchingActiveEmployee.department}) is registered. This new employee will receive a unique Company ID and separate biometric vectors to prevent any collision.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {isSecurityRole ? (
                                <div className="md:col-span-2 p-3.5 bg-white rounded-md border border-slate-200 space-y-2.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                                            <i className="ti ti-shield-check text-accent text-sm" />
                                            Terminal Deployment & Privilege Binding
                                        </span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200">
                                            Attendance Verifier
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-100 text-[11px]">
                                        <div className="p-2.5 bg-slate-50 rounded border border-slate-200/60">
                                            <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Authorized Route</span>
                                            <span className="font-mono font-semibold text-accent">/scanner (Direct)</span>
                                        </div>
                                        <div className="p-2.5 bg-slate-50 rounded border border-slate-200/60">
                                            <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">Department</span>
                                            <span className="font-semibold text-slate-800">Security</span>
                                        </div>
                                        <div className="p-2.5 bg-slate-50 rounded border border-slate-200/60">
                                            <span className="block text-[10px] text-slate-400 uppercase font-bold tracking-wider">HR Onboarding</span>
                                            <span className="font-semibold text-emerald-700">Exempt (Bypassed)</span>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-slate-500 font-normal">
                                        Personal DOLE compliance forms (Philippine residential address, birth date, gender) and compensation configurations are unnecessary for scanner operators and have been bypassed under data minimization principles.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Sex <span className="text-slate-400 font-normal lowercase">(optional — self-service eligible)</span>
                                        </label>
                                        <select 
                                            name="sex" 
                                            value={sex}
                                            onChange={(e) => setSex(e.target.value)}
                                            className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 appearance-none cursor-pointer shadow-2xs"
                                        >
                                            <option value="">Select Sex</option>
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Date of Birth <span className="text-slate-400 font-normal lowercase">(optional — self-service eligible)</span>
                                        </label>
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

                                    <div>
                                        <label htmlFor="date-hired" className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Date hired <span className="text-danger-ink">*</span>
                                        </label>
                                        <input id="date-hired" name="date_hired" type="date" required max={getManilaWorkDate()} value={hireDate} onChange={e => setHireDate(e.target.value)} className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 shadow-2xs" />
                                    </div>

                                    <div>
                                        <label htmlFor="timekeeping-effective-date" className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Timekeeping Cutover Date <span className="text-slate-400 font-normal lowercase">(defaults to today)</span>
                                        </label>
                                        <input id="timekeeping-effective-date" name="timekeeping_effective_date" type="date" value={timekeepingDate} onChange={e => setTimekeepingDate(e.target.value)} className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 shadow-2xs" />
                                    </div>

                                    <div className="md:col-span-2">
                                        <PhilippineAddressSelector
                                            value={address}
                                            onChange={(nextAddress) => setAddress(nextAddress)}
                                            idPrefix="create_emp_address"
                                            label="Residential Address (optional — employee can complete in onboarding)"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Department <span className="text-danger-ink">*</span>
                                        </label>
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

                                    {department !== 'Factory' ? (
                                        <div>
                                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                                Job Title <span className="text-danger-ink">*</span>
                                            </label>
                                            <input type="text" name="job_title" required maxLength={120} defaultValue={defaultValues.job_title || ''}
                                                onChange={e => { e.target.value = sanitizePersonnelText(e.target.value, 'job_title'); }}
                                                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors duration-100 placeholder:text-slate-400 shadow-2xs"
                                                placeholder="e.g. Sales Associate, HR Officer" />
                                        </div>
                                    ) : null}

                                    {/* FACTORY SHOE PRODUCTION CRAFT & GROUP SELECTION */}
                                    {department === 'Factory' && (
                                        <div className="md:col-span-2 space-y-4 pt-2 border-t border-slate-200/80">
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <label className="block text-[10px] sm:text-xs font-bold text-warning-ink uppercase tracking-widest">
                                                        Shoe Production Station (Select 1 of 6 Crafts) <span className="text-danger-ink">*</span>
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
                                                                className={`p-2.5 rounded-md border text-left transition-colors duration-100 flex items-center justify-between gap-2.5 cursor-pointer ${isSelected
                                                                    ? 'bg-warning/10 border-warning ring-1 ring-warning/30 shadow-2xs'
                                                                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                                    }`}
                                                            >
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    <span className={`w-7 h-7 rounded-md flex items-center justify-center text-xs shrink-0 ${isSelected ? 'bg-warning text-white' : 'bg-slate-100 text-slate-600'}`}>
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
                                                            Assigned Production Line / Group <span className="text-danger-ink">*</span>
                                                        </label>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const nextState = !isCustomLine;
                                                            setIsCustomLine(nextState);
                                                            if (nextState) {
                                                                setSelectedGroupId('');
                                                                setSelectedGroup('');
                                                            } else {
                                                                const defaultLine = productionGroups.find(g => g.name === 'Line A') || productionGroups[0];
                                                                setSelectedGroupId(defaultLine?.id || '');
                                                                setSelectedGroup(defaultLine?.name || 'Line A');
                                                            }
                                                        }}
                                                        className="self-start sm:self-auto text-[11px] font-bold text-warning-ink hover:text-warning-ink flex items-center gap-1 cursor-pointer transition-colors duration-100"
                                                    >
                                                        <i className={`ti ${isCustomLine ? 'ti-list' : 'ti-plus'} text-xs`} />
                                                        <span>{isCustomLine ? 'Choose from existing lines' : '+ Create new line'}</span>
                                                    </button>
                                                </div>

                                                {isCustomLine ? (
                                                    <div>
                                                        <input maxLength={100}
                                                            type="text"
                                                            value={selectedGroup}
                                                            onChange={(e) => setSelectedGroup(e.target.value)}
                                                            placeholder="Type new line name (e.g. Line 7, Sneaker Line Alpha)"
                                                            autoFocus
                                                            className="w-full h-9 px-3 bg-warning-subtle/50 border border-warning/20 focus:border-warning rounded-md text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors duration-100 shadow-2xs"
                                                        />
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
                                        <div className={`p-3 rounded-md border flex items-center justify-between gap-3 ${department === 'Factory' ? 'bg-warning-subtle/70 border-warning/20 text-warning-ink' : 'bg-accent-subtle/70 border-accent/20 text-accent-strong'
                                            }`}>
                                            <div className="flex items-center gap-2.5">
                                                <i className={`ti ${department === 'Factory' ? 'ti-clock-pause text-warning-ink' : 'ti-clock-play text-accent'} text-base shrink-0`} />
                                                <div>
                                                    <p className="text-xs font-bold">
                                                        {department === 'Factory' ? 'Factory Worker Schedule: 08:00 AM - 05:00 PM' : 'Regular Worker Schedule: 08:00 AM - 08:00 PM'}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shrink-0 ${department === 'Factory' ? 'bg-warning-subtle/80 text-warning-ink border-warning/20' : 'bg-accent-subtle/80 text-accent-strong border-accent/20'
                                                }`}>
                                                {department === 'Factory' ? 'No OT' : 'OT Eligible'}
                                            </span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* DYNAMIC PAYROLL DETAILS - ONLY FOR STANDARD EMPLOYEES */}
                    {!isSecurityRole && (
                        <div className="p-4 sm:p-5 bg-slate-50/50 rounded-lg border border-slate-200">
                            <h3 className="text-sm font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2.5">
                                <span className="w-7 h-7 bg-white text-slate-700 rounded-md flex items-center justify-center border border-slate-200 shadow-2xs">
                                    <i className="ti ti-cash-banknote text-base" />
                                </span>
                                Payroll Configuration
                            </h3>

                            {department === 'Factory' ? (
                                <div className="space-y-3">
                                    <div className="p-3.5 rounded-md border border-warning/20 bg-warning-subtle/70 text-warning-ink space-y-2">
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
                                                <i className="ti ti-check text-warning-ink" /> No fixed salary set at onboarding
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <i className="ti ti-users text-warning-ink" /> Production line batch pool
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <i className="ti ti-clock-off text-warning-ink" /> Strictly no overtime policy
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {payError && <div role="alert" className="sm:col-span-2 rounded-md border border-danger/20 bg-danger-subtle px-3 py-2 text-xs text-danger-ink">{payError}</div>}
                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                            Daily Pay Rate <span className="text-danger-ink">*</span>
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₱</span>
                                            <input maxLength={11}
                                                type="text"
                                                required
                                                value={displayDailyPay}
                                                inputMode="decimal"
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
                                            Hourly Pay Rate <span className="text-slate-400 font-normal lowercase">(auto-calculated)</span>
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">₱</span>
                                            <input maxLength={11}
                                                type="text"
                                                required
                                                value={displayHourlyPay}
                                                inputMode="decimal"
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
                    )}

                    {/* SUBMIT */}
                    <div className="pt-2">
                        <button type="submit" disabled={isSubmitting} className="w-full h-10 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs tracking-wide rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer">
                            {isSubmitting ? (
                                <><i className="ti ti-loader animate-spin text-sm" /> {isSecurityRole ? 'Provisioning Scanner Operator...' : 'Creating Profile...'}</>
                            ) : (
                                <><i className={`ti ${isSecurityRole ? 'ti-shield-check' : 'ti-user-plus'} text-sm`} /> {isSecurityRole ? 'Provision Security Guard Terminal' : 'Create Profile & Account'}</>
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {/* Account Created & Temporary Password Modal */}
            {showSuccessModal && createdEmployee && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/70">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl border border-slate-200 space-y-4">
                        {/* Header */}
                        <div className="text-center space-y-1.5">
                            <div className="h-10 w-10 bg-surface-muted text-ink rounded-md mx-auto flex items-center justify-center border border-line shadow-2xs">
                                <i className="ti ti-check text-xl font-bold" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                                Account Created Successfully
                            </h3>
                            <p className="text-xs text-slate-500 font-medium">
                                Provide these temporary login credentials to the {createdEmployee.role === 'security' ? 'scanner operator or gate personnel' : 'employee'}.
                            </p>
                        </div>

                        {/* Credentials Card */}
                        <div className="bg-slate-50 rounded-md p-3.5 border border-slate-200 space-y-2.5">

                            {/* Name */}
                            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    {createdEmployee.role === 'security' ? 'Scanner Operator' : 'Employee'}
                                </span>
                                <span className="text-xs font-bold text-slate-900">
                                    {createdEmployee.first_name} {createdEmployee.last_name}
                                </span>
                            </div>

                            {/* Company ID */}
                            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Company ID</span>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(createdEmployee.company_id, 'Company ID')}
                                    className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800 hover:text-accent cursor-pointer transition-colors duration-100"
                                >
                                    <span>{createdEmployee.company_id}</span>
                                    <i className={`ti ${copiedField === 'Company ID' ? 'ti-check text-ink' : 'ti-copy text-slate-400'} text-xs`} />
                                </button>
                            </div>

                            {/* Email Address */}
                            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Login Email</span>
                                <button
                                    type="button"
                                    onClick={() => copyToClipboard(createdEmployee.email, 'Email')}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 hover:text-accent cursor-pointer max-w-[200px] truncate transition-colors duration-100"
                                >
                                    <span className="truncate">{createdEmployee.email}</span>
                                    <i className={`ti ${copiedField === 'Email' ? 'ti-check text-ink' : 'ti-copy text-slate-400'} text-xs shrink-0`} />
                                </button>
                            </div>

                            {/* Temporary password */}
                            <div className="p-3 bg-slate-900 rounded-md text-white space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-warning flex items-center gap-1">
                                        <i className="ti ti-key text-xs" /> Temporary Password
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="text-slate-400 hover:text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors duration-100"
                                    >
                                        <i className={`ti ${showPassword ? 'ti-eye-off' : 'ti-eye'} text-xs`} />
                                        {showPassword ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-base font-bold tracking-wider text-white">
                                        {showPassword ? (createdEmployee.temp_password || 'Emp-1234') : '••••••••'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(createdEmployee.temp_password, 'Password')}
                                        className="h-7 px-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 rounded-sm font-semibold text-xs flex items-center gap-1 transition-colors duration-100 cursor-pointer shadow-2xs"
                                    >
                                        <i className={`ti ${copiedField === 'Password' ? 'ti-check text-ink' : 'ti-copy'} text-xs`} />
                                        {copiedField === 'Password' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Copy All Button */}
                        <button
                            type="button"
                            onClick={copyAllCredentials}
                            className="w-full h-9 bg-accent-subtle hover:bg-accent-subtle text-accent rounded-md font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors duration-100 border border-accent/20 cursor-pointer shadow-2xs"
                        >
                            <i className={`ti ${copiedAll ? 'ti-check text-ink' : 'ti-clipboard-check'} text-sm`} />
                            {copiedAll ? 'Copied to Clipboard!' : 'Copy All Login Credentials'}
                        </button>

                        {/* Modal Actions */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={handleCreateAnother}
                                className="h-9 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold text-xs transition-colors duration-100 text-center cursor-pointer shadow-2xs"
                            >
                                + Add Another
                            </button>
                            <Link
                                to={`/admin/employees/${createdEmployee.id}`}
                                className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs transition-colors duration-100 text-center flex items-center justify-center gap-1 shadow-2xs"
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
