import React, { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import PageHeader from '../../../components/ui/PageHeader';

const toSafeNumber = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const parsed = parseFloat(String(val).replace(/[^0-9.-]+/g, ''));
    return isNaN(parsed) ? 0 : parsed;
};

const calculateGrossPay = (payroll) => {
    if (!payroll) return 0;
    if (payroll.gross_pay !== undefined && payroll.gross_pay !== null) {
        return toSafeNumber(payroll.gross_pay);
    }
    const basic = toSafeNumber(payroll.basic_pay);
    const ot = toSafeNumber(payroll.overtime_pay);
    const holiday = toSafeNumber(payroll.holiday_pay);
    const leave = toSafeNumber(payroll.leave_pay);
    const matDiff = toSafeNumber(payroll.maternity_salary_differential);
    return basic + ot + holiday + leave + matDiff;
};

const isFactoryDept = (dept) => (dept || '').toLowerCase() === 'factory';

// Helper to extract group name from string, object, or array relations
const extractGroupName = (target) => {
    if (!target) return '';
    if (typeof target === 'string' || typeof target === 'number') return String(target);
    if (typeof target === 'object') {
        if (Array.isArray(target)) {
            return target[0]?.name || target[0]?.title || target[0]?.group_name || target[0]?.line_name || '';
        }
        return target.name || target.title || target.group_name || target.line_name || '';
    }
    return '';
};

// Formats line names cleanly (e.g., "b" or "line_b" -> "Line B")
const formatLineName = (val) => {
    if (!val) return '';
    const raw = extractGroupName(val).replace(/_/g, ' ').trim();
    if (!raw || /^unassigned/i.test(raw) || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') {
        return '';
    }
    const capitalized = raw.replace(/\b\w/g, (char) => char.toUpperCase());
    return /line|group/i.test(capitalized) ? capitalized : `Line ${capitalized}`;
};

// Resolves employee line across all Supabase/Laravel relation key variations
const getEmployeeLine = (payroll) => {
    const emp = payroll?.employees || {};

    const relationalSources = [
        payroll?.production_group,
        payroll?.production_groups,
        payroll?.productionGroup,
        payroll?.production_line,
        payroll?.production_lines,
        emp?.production_group,
        emp?.production_groups,
        emp?.productionGroup,
        emp?.production_line,
        emp?.production_lines,
        payroll?.production_group_name,
        emp?.production_group_name,
    ];

    for (const src of relationalSources) {
        const formatted = formatLineName(src);
        if (formatted) return formatted;
    }

    if (payroll?.remarks) {
        const match = payroll.remarks.match(/(?:Group|Line):\s*([^|]+)/i);
        if (match && match[1]) {
            const formatted = formatLineName(match[1]);
            if (formatted) return formatted;
        }
    }

    const stringSources = [
        payroll?.line, payroll?.group, payroll?.factory_line, payroll?.factory_group, payroll?.line_name, payroll?.group_name,
        emp?.line, emp?.factory_line, emp?.factory_group, emp?.group_name, emp?.group, emp?.line_assignment, emp?.assigned_line, emp?.line_name, emp?.section, emp?.sub_department, emp?.production_line, emp?.work_center, emp?.unit
    ];

    for (const str of stringSources) {
        const formatted = formatLineName(str);
        if (formatted) return formatted;
    }

    return '';
};

const getStatusVisuals = (status) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'pending' || normalized === 'draft') {
        return {
            label: status || 'Pending',
            badgeClass: 'bg-amber-50 text-amber-600 border border-amber-200',
            dotClass: 'bg-amber-500',
        };
    }
    return {
        label: status || 'Completed',
        badgeClass: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
        dotClass: 'bg-emerald-500',
    };
};

export default function PayrollIndex() {
    const [searchParams, setSearchParams] = useSearchParams();
    const currentMonth = searchParams.get('month') || '';
    const currentYear = searchParams.get('year') || '';

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDepartment, setSelectedDepartment] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All');
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedGroups, setExpandedGroups] = useState({});
    const itemsPerPage = 10;

    const currentYearNum = new Date().getFullYear();
    const years = Array.from({ length: 4 }, (_, i) => currentYearNum - 2 + i);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const toggleGroup = (groupId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupId]: !prev[groupId]
        }));
    };

    const handleMonthChange = (e) => {
        const month = e.target.value;
        const params = new URLSearchParams(searchParams);
        if (month) params.set('month', month);
        else params.delete('month');
        setSearchParams(params);
        setCurrentPage(1);
    };

    const handleYearChange = (e) => {
        const year = e.target.value;
        const params = new URLSearchParams(searchParams);
        if (year) params.set('year', year);
        else params.delete('year');
        setSearchParams(params);
        setCurrentPage(1);
    };

    const handleClearFilters = () => {
        setSearchQuery('');
        setSelectedDepartment('All');
        setFilterStatus('All');
        setSearchParams(new URLSearchParams());
        setCurrentPage(1);
    };

    const fetchPayrolls = async () => {
        let endpoint = '/api/payroll';
        const queryParams = new URLSearchParams();
        if (currentMonth) queryParams.append('month', currentMonth);
        if (currentYear) queryParams.append('year', currentYear);

        if (queryParams.toString()) {
            endpoint += `?${queryParams.toString()}`;
        }

        const res = await fetchWithAuth(endpoint);
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch payroll records');
        return Array.isArray(result) ? result : (result.data || []);
    };

    const { data: payrolls = [], isLoading } = useQuery({
        queryKey: ['adminPayrolls', currentMonth, currentYear],
        queryFn: fetchPayrolls,
        staleTime: 60_000,
        gcTime: 300_000,
        refetchOnMount: 'always',
    });

    const fetchEmployees = async () => {
        const res = await fetchWithAuth('/api/employees');
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to fetch employees');
        const list = Array.isArray(result) ? result : (result.data || []);
        return list.filter(e => {
            const roleStr = (e.role || '').toLowerCase();
            return roleStr !== 'admin' && roleStr !== 'security';
        });
    };

    const { data: employees = [] } = useQuery({
        queryKey: ['adminPayrollEligibleEmployees'],
        queryFn: fetchEmployees,
        staleTime: 60_000,
        gcTime: 300_000,
    });

    const cycleBounds = useMemo(() => {
        const targetYear = currentYear ? parseInt(currentYear, 10) : currentYearNum;
        const targetMonth = currentMonth ? parseInt(currentMonth, 10) : (new Date().getMonth() + 1);
        const start = dayjs(`${targetYear}-${String(targetMonth).padStart(2, '0')}-01`);
        return {
            year: targetYear,
            month: targetMonth,
            start: start.format('YYYY-MM-DD'),
            end: start.endOf('month').format('YYYY-MM-DD'),
        };
    }, [currentMonth, currentYear, currentYearNum]);

    const isActiveCycle = cycleBounds.year === currentYearNum && cycleBounds.month === (new Date().getMonth() + 1);

    const combinedRecords = useMemo(() => {
        const computedEmployeeIds = new Set();
        const employeeLastKnownLineMap = {};

        payrolls.forEach(p => {
            const line = getEmployeeLine(p);
            if (line) {
                employeeLastKnownLineMap[String(p.employee_id)] = line;
            }

            const periodStart = dayjs(p.period_start);
            if (periodStart.isValid() && periodStart.year() === cycleBounds.year && (periodStart.month() + 1) === cycleBounds.month) {
                computedEmployeeIds.add(String(p.employee_id));
            }
        });

        if (!isActiveCycle) return payrolls;

        const isExcludedStatus = (emp) => {
            const status = (emp.status || emp.employment_status || '').toLowerCase();
            return (
                status === 'terminated' ||
                status === 'suspended' ||
                status === 'inactive' ||
                emp.is_active === false ||
                emp.is_active === 0
            );
        };

        const pendingEntries = employees
            .filter(emp => !computedEmployeeIds.has(String(emp.id)))
            .filter(emp => !isExcludedStatus(emp))
            .map(emp => {
                const mockPayroll = { employees: emp };
                const inheritedLine = employeeLastKnownLineMap[String(emp.id)];
                const resolvedLine = inheritedLine || getEmployeeLine(mockPayroll);

                return {
                    id: `pending-${emp.id}`,
                    employee_id: emp.id,
                    employees: emp,
                    line: resolvedLine,
                    status: 'Pending',
                    period_start: cycleBounds.start,
                    period_end: cycleBounds.end,
                    gross_pay: 0,
                    deductions: 0,
                    net_pay: 0,
                    isPending: true,
                };
            });

        return [...payrolls, ...pendingEntries];
    }, [payrolls, employees, cycleBounds, isActiveCycle]);

    const departments = useMemo(() => {
        const depts = new Set();
        combinedRecords.forEach(p => {
            if (p.employees?.department) depts.add(p.employees.department);
        });
        return ['All', ...Array.from(depts)];
    }, [combinedRecords]);

    const filteredPayrolls = useMemo(() => {
        return combinedRecords.filter(p => {
            const roleStr = (p.employees?.role || '').toLowerCase();
            if (roleStr === 'admin' || roleStr === 'security') return false;

            // Month Filter
            if (currentMonth) {
                const targetMonth = parseInt(currentMonth, 10);
                const pDate = dayjs(p.period_start || p.period_end);
                if (pDate.isValid() && (pDate.month() + 1) !== targetMonth) {
                    return false;
                }
            }

            // Year Filter
            if (currentYear) {
                const targetYear = parseInt(currentYear, 10);
                const pDate = dayjs(p.period_start || p.period_end);
                if (pDate.isValid() && pDate.year() !== targetYear) {
                    return false;
                }
            }

            if (filterStatus === 'Completed' && p.status !== 'Completed' && p.status !== 'Paid') return false;
            if (filterStatus === 'Pending' && p.status !== 'Pending' && p.status !== 'Draft') return false;

            if (selectedDepartment !== 'All' && p.employees?.department !== selectedDepartment) return false;

            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const fullName = `${p.employees?.first_name || ''} ${p.employees?.last_name || ''}`.toLowerCase();
                const companyId = (p.employees?.company_id || '').toLowerCase();
                const empId = (p.employee_id || '').toLowerCase();
                const jobTitle = (p.employees?.job_title || '').toLowerCase();
                const factoryGroup = getEmployeeLine(p).toLowerCase();

                if (!fullName.includes(q) && !companyId.includes(q) && !empId.includes(q) && !jobTitle.includes(q) && !factoryGroup.includes(q)) {
                    return false;
                }
            }

            return true;
        });
    }, [combinedRecords, currentMonth, currentYear, filterStatus, selectedDepartment, searchQuery]);

    const ledgerDisplayItems = useMemo(() => {
        const items = [];
        const factoryGroupsMap = {};

        filteredPayrolls.forEach(payroll => {
            const isFactory = isFactoryDept(payroll.employees?.department);
            const groupName = getEmployeeLine(payroll);

            if (isFactory && groupName) {
                const groupId = `factory-line-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

                if (!factoryGroupsMap[groupId]) {
                    factoryGroupsMap[groupId] = {
                        type: 'group',
                        id: groupId,
                        groupName,
                        department: payroll.employees?.department || 'Factory',
                        items: []
                    };
                    items.push(factoryGroupsMap[groupId]);
                }
                factoryGroupsMap[groupId].items.push(payroll);
            } else {
                items.push({
                    type: 'individual',
                    id: payroll.id || `pending-${payroll.employee_id}`,
                    data: payroll
                });
            }
        });

        return items;
    }, [filteredPayrolls]);

    const isFiltered = Boolean(currentMonth || currentYear || searchQuery.trim() || selectedDepartment !== 'All' || filterStatus !== 'All');

    const totalItems = ledgerDisplayItems.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    const paginatedDisplayItems = ledgerDisplayItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const renderPayrollRow = (payroll, isGroupChild = false) => {
        const grossVal = calculateGrossPay(payroll);
        const dedVal = toSafeNumber(payroll.deductions);
        const netVal = toSafeNumber(payroll.net_pay);
        const statusVisuals = getStatusVisuals(payroll.status);
        const empIdStr = payroll.employee_id !== undefined && payroll.employee_id !== null ? String(payroll.employee_id) : '';

        return (
            <tr
                key={payroll.id || `row-${payroll.employee_id}`}
                className={`hover:bg-emerald-50/30 transition-colors group ${isGroupChild ? 'bg-slate-50/60 border-l-4 border-l-emerald-500' : ''}`}
            >
                <td className={`px-6 lg:px-8 py-4 ${isGroupChild ? 'pl-10 lg:pl-12' : ''}`}>
                    <div className="flex items-center gap-3">
                        <EmployeeAvatar employee={payroll.employees} employeeId={payroll.employee_id} size="h-10 w-10" theme="emerald" />
                        <div>
                            <p className="text-sm font-black text-slate-800 group-hover:text-emerald-600 transition-colors">
                                {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                                {payroll.employees?.department || 'Staff'} &bull; {payroll.employees?.company_id || `#${empIdStr.substring(0, 6)}`}
                            </p>
                        </div>
                    </div>
                </td>

                <td className="px-6 lg:px-8 py-4">
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-700">
                            {dayjs(payroll.period_start).format('MMM DD')}
                            <span className="text-slate-300 mx-1">&rarr;</span>
                            {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                        </span>
                        <span className="px-2 py-0.5 mt-1 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold uppercase tracking-widest w-max border border-slate-200">
                            {payroll.isPending ? 'Current Cycle' : '15-Day Cycle'}
                        </span>
                    </div>
                </td>

                <td className="px-6 lg:px-8 py-4">
                    {payroll.isPending ? (
                        <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200/80 inline-block">
                            Not yet computed
                        </span>
                    ) : (
                        <div className="flex flex-col gap-0.5 text-xs max-w-[180px]">
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-bold text-[11px]">Gross</span>
                                <span className="font-mono font-bold text-slate-700">₱{grossVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-red-400 font-bold text-[11px]">Deductions</span>
                                <span className="font-mono font-bold text-red-500">-₱{dedVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                    )}
                </td>

                <td className="px-6 lg:px-8 py-4 text-right">
                    {payroll.isPending ? (
                        <span className="text-sm font-bold text-slate-300">&mdash;</span>
                    ) : (
                        <span className="text-lg font-black text-emerald-600 font-mono tracking-tight">
                            ₱{netVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    )}
                </td>

                <td className="px-6 lg:px-8 py-4 text-center">
                    <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md flex w-max items-center gap-1.5 mx-auto ${statusVisuals.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusVisuals.dotClass}`} /> {statusVisuals.label}
                    </span>
                </td>

                <td className="px-6 lg:px-8 py-4 text-right">
                    {payroll.isPending ? (
                        <Link
                            to={{
                                pathname: '/admin/payroll/process',
                                search: `?employee_id=${encodeURIComponent(empIdStr)}&period_start=${encodeURIComponent(payroll.period_start)}&period_end=${encodeURIComponent(payroll.period_end)}`,
                            }}
                            state={{
                                employee_id: payroll.employee_id,
                                period_start: payroll.period_start,
                                period_end: payroll.period_end,
                                department: payroll.employees?.department,
                                base_salary: payroll.employees?.monthly_salary ?? payroll.employees?.salary,
                                daily_rate: payroll.employees?.daily_rate,
                                isFactoryEmployee: isFactoryDept(payroll.employees?.department),
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-amber-500 hover:bg-amber-50 text-slate-700 hover:text-amber-700 font-bold text-xs rounded-xl shadow-xs transition-all tap-active"
                        >
                            <i className="ti ti-player-play text-base font-bold text-amber-600" />
                            <span>Process</span>
                        </Link>
                    ) : (
                        <Link
                            to={`/admin/payroll/${payroll.id}`}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 font-bold text-xs rounded-xl shadow-xs transition-all tap-active"
                        >
                            <i className="ti ti-receipt-2 text-base font-bold text-emerald-600" />
                            <span>View</span>
                        </Link>
                    )}
                </td>
            </tr>
        );
    };

    const renderMobileCard = (payroll, isGroupChild = false) => {
        const grossVal = calculateGrossPay(payroll);
        const dedVal = toSafeNumber(payroll.deductions);
        const netVal = toSafeNumber(payroll.net_pay);
        const statusVisuals = getStatusVisuals(payroll.status);
        const empIdStr = payroll.employee_id !== undefined && payroll.employee_id !== null ? String(payroll.employee_id) : '';

        return (
            <div
                key={`mobile-${payroll.id || payroll.employee_id}`}
                className={`p-4 space-y-3 rounded-xl border transition-colors ${isGroupChild ? 'bg-white border-slate-200 shadow-xs' : 'hover:bg-emerald-50/20'}`}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <EmployeeAvatar employee={payroll.employees} employeeId={payroll.employee_id} size="h-10 w-10" theme="emerald" />
                        <div className="min-w-0">
                            <p className="text-sm font-black text-slate-800 truncate">
                                {payroll.employees ? `${payroll.employees.first_name} ${payroll.employees.last_name}` : 'Unknown'}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">
                                {payroll.employees?.department || 'Staff'} &bull; {payroll.employees?.company_id || `#${empIdStr.substring(0, 6)}`}
                            </p>
                        </div>
                    </div>

                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md flex items-center gap-1 shrink-0 ${statusVisuals.badgeClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusVisuals.dotClass}`} /> {statusVisuals.label}
                    </span>
                </div>

                <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-500">Pay Period</span>
                        <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200/60">
                            {dayjs(payroll.period_start).format('MMM DD')} &rarr; {dayjs(payroll.period_end).format('MMM DD, YYYY')}
                        </span>
                    </div>

                    {payroll.isPending ? (
                        <div className="pt-1 border-t border-slate-200/40 text-xs text-center text-amber-600 font-bold py-1">
                            Not yet computed
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/40 text-xs">
                                <div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Gross Pay</span>
                                    <p className="font-mono font-bold text-slate-700">₱{grossVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] font-bold text-red-400 uppercase">Deductions</span>
                                    <p className="font-mono font-bold text-red-500">-₱{dedVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                </div>
                            </div>

                            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                                <span className="text-xs font-black uppercase text-slate-500">Net Take-Home Pay</span>
                                <span className="text-base font-black text-emerald-600 font-mono">
                                    ₱{netVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {payroll.isPending ? (
                    <Link
                        to={{
                            pathname: '/admin/payroll/process',
                            search: `?employee_id=${encodeURIComponent(empIdStr)}&period_start=${encodeURIComponent(payroll.period_start)}&period_end=${encodeURIComponent(payroll.period_end)}`,
                        }}
                        state={{
                            employee_id: payroll.employee_id,
                            period_start: payroll.period_start,
                            period_end: payroll.period_end,
                            department: payroll.employees?.department,
                            base_salary: payroll.employees?.monthly_salary ?? payroll.employees?.salary,
                            daily_rate: payroll.employees?.daily_rate,
                            isFactoryEmployee: isFactoryDept(payroll.employees?.department),
                        }}
                        className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 tap-active transition-colors"
                    >
                        <i className="ti ti-player-play text-base" /> Process Payroll
                    </Link>
                ) : (
                    <Link
                        to={`/admin/payroll/${payroll.id}`}
                        className="w-full py-2.5 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 tap-active transition-colors"
                    >
                        <i className="ti ti-receipt-2 text-base" /> View Full Payslip
                    </Link>
                )}
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-10 h-10 border-3 border-slate-200 border-t-emerald-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-semibold tracking-wider uppercase text-xs">Loading Payroll Ledger...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Finance', 'Payroll Ledger']}
                title="Payroll Ledger"
                description="Review, audit, and distribute DOLE-compliant digital payslips to your entire workforce."
                actions={
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <Link
                            to="/admin/payroll/statutory-settings"
                            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg font-semibold text-xs sm:text-sm transition-colors flex items-center gap-1.5 border border-slate-200 shadow-xs"
                        >
                            <i className="ti ti-adjustments-horizontal text-base text-slate-500" />
                            <span>Statutory Settings</span>
                        </Link>

                        <Link
                            to="/admin/payroll/process"
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs sm:text-sm transition-colors shadow-xs flex items-center gap-1.5"
                        >
                            <i className="ti ti-calculator text-base" />
                            <span>Compute Payroll</span>
                        </Link>
                    </div>
                }
            />

            <div className="space-y-4 sm:space-y-6">

                {/* Filter toolbar */}
                <div className="bg-white p-3 sm:p-4 rounded-xl shadow-xs border border-slate-200 space-y-3">
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                        <div className="relative flex-1 min-w-[240px]">
                            <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search employee name, line (Line A, Line B), company ID..."
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-inner"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                    title="Clear search"
                                >
                                    <i className="ti ti-x text-sm font-bold" />
                                </button>
                            )}
                        </div>

                        {/* Status Pill Tabs */}
                        <div className="flex bg-slate-100/80 p-1 rounded-xl overflow-x-auto touch-scroll no-scrollbar shrink-0">
                            {['All', 'Completed', 'Pending'].map(status => (
                                <button
                                    key={status}
                                    onClick={() => { setFilterStatus(status); setCurrentPage(1); }}
                                    className={`px-3.5 sm:px-4 py-2 rounded-lg text-xs font-bold tap-active transition-all whitespace-nowrap ${filterStatus === status
                                        ? (status === 'Completed'
                                            ? 'bg-emerald-600 text-white shadow-xs'
                                            : status === 'Pending'
                                                ? 'bg-amber-500 text-white shadow-xs'
                                                : 'bg-slate-900 text-white shadow-xs')
                                        : 'text-slate-500 hover:text-slate-900'
                                        }`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                            <div className="relative min-w-[130px] flex-1 sm:flex-initial">
                                <select
                                    value={currentMonth}
                                    onChange={handleMonthChange}
                                    className="w-full appearance-none bg-slate-50 border border-slate-200/80 rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
                                >
                                    <option value="">All Months</option>
                                    {months.map(m => {
                                        const date = new Date(2000, m - 1, 1);
                                        const monthName = date.toLocaleString('default', { month: 'short' });
                                        return <option key={m} value={m.toString().padStart(2, '0')}>{monthName}</option>;
                                    })}
                                </select>
                                <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                            </div>

                            <div className="relative min-w-[110px] flex-1 sm:flex-initial">
                                <select
                                    value={currentYear}
                                    onChange={handleYearChange}
                                    className="w-full appearance-none bg-slate-50 border border-slate-200/80 rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
                                >
                                    <option value="">All Years</option>
                                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                            </div>

                            {departments.length > 2 && (
                                <div className="relative min-w-[140px] flex-1 sm:flex-initial">
                                    <select
                                        value={selectedDepartment}
                                        onChange={(e) => { setSelectedDepartment(e.target.value); setCurrentPage(1); }}
                                        className="w-full appearance-none bg-slate-50 border border-slate-200/80 rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
                                    >
                                        <option value="All">All Depts</option>
                                        {departments.filter(d => d !== 'All').map(d => (
                                            <option key={d} value={d}>{d}</option>
                                        ))}
                                    </select>
                                    <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                            <span className="text-[11px] font-bold text-slate-400">
                                {totalItems} {totalItems === 1 ? 'entry' : 'entries'} listed
                            </span>

                            {isFiltered && (
                                <button
                                    onClick={handleClearFilters}
                                    className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 tap-active"
                                    title="Reset all filters"
                                >
                                    <i className="ti ti-filter-off text-xs" /> Reset
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Table container */}
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                    {/* Mobile view */}
                    <div className="block md:hidden p-3 space-y-3">
                        {paginatedDisplayItems.length > 0 ? paginatedDisplayItems.map((item) => {
                            if (item.type === 'individual') {
                                return renderMobileCard(item.data);
                            }

                            const isExpanded = Boolean(expandedGroups[item.id]);
                            const completedCount = item.items.filter(p => !p.isPending).length;
                            const pendingCount = item.items.filter(p => p.isPending).length;
                            const totalGross = item.items.reduce((acc, p) => acc + calculateGrossPay(p), 0);
                            const totalDed = item.items.reduce((acc, p) => acc + toSafeNumber(p.deductions), 0);
                            const totalNet = item.items.reduce((acc, p) => acc + toSafeNumber(p.net_pay), 0);

                            return (
                                <div key={item.id} className="border-2 border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
                                    <div
                                        onClick={() => toggleGroup(item.id)}
                                        className="p-4 bg-slate-100/90 hover:bg-slate-200/60 cursor-pointer space-y-3 transition-colors"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                                                    <i className="ti ti-building-factory-2" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-1.5">
                                                        <h3 className="text-sm font-black text-slate-800">{item.groupName}</h3>
                                                        <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase rounded">
                                                            Factory Line
                                                        </span>
                                                    </div>
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                                        {item.items.length} Total {item.items.length === 1 ? 'Worker' : 'Workers'}
                                                    </p>
                                                </div>
                                            </div>
                                            <button type="button" className="p-1 text-slate-500 hover:text-slate-800">
                                                <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'} text-lg`} />
                                            </button>
                                        </div>

                                        <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                                            <div className="flex justify-between">
                                                <span className="text-slate-500 font-bold">Processed Line Gross</span>
                                                <span className="font-mono font-bold text-slate-700">₱{totalGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-red-500 font-bold">Processed Line Deductions</span>
                                                <span className="font-mono font-bold text-red-500">-₱{totalDed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className="pt-2 border-t border-slate-100 flex justify-between items-center">
                                                <span className="font-black text-slate-600 uppercase text-[10px]">Processed Line Net Pay</span>
                                                <span className="text-base font-black text-emerald-600 font-mono">
                                                    ₱{totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between text-xs font-bold pt-1">
                                            <div className="flex items-center gap-1.5">
                                                {completedCount > 0 && (
                                                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black rounded-md">
                                                        {completedCount} Completed
                                                    </span>
                                                )}
                                                {pendingCount > 0 && (
                                                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black rounded-md">
                                                        {pendingCount} Pending
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-emerald-600 text-xs font-black flex items-center gap-1">
                                                {isExpanded ? 'Hide Dropdown' : 'View Dropdown'}
                                                <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'}`} />
                                            </span>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-3">
                                            {item.items.map(payroll => renderMobileCard(payroll, true))}
                                        </div>
                                    )}
                                </div>
                            );
                        }) : (
                            <div className="p-8 text-center text-slate-400">
                                <p className="text-xs font-bold">No payroll records found for this period</p>
                            </div>
                        )}
                    </div>

                    {/* Desktop table view */}
                    <div className="hidden md:block overflow-x-auto no-scrollbar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50/80 text-slate-400 text-xs uppercase tracking-widest font-black border-b border-slate-100">
                                <tr>
                                    <th className="px-6 lg:px-8 py-4">Employee / Line</th>
                                    <th className="px-6 lg:px-8 py-4">Pay Period</th>
                                    <th className="px-6 lg:px-8 py-4">Ledger Summary</th>
                                    <th className="px-6 lg:px-8 py-4 text-right">Net Pay</th>
                                    <th className="px-6 lg:px-8 py-4 text-center">Status</th>
                                    <th className="px-6 lg:px-8 py-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {paginatedDisplayItems.length > 0 ? paginatedDisplayItems.map((item) => {
                                    if (item.type === 'individual') {
                                        return renderPayrollRow(item.data);
                                    }

                                    const isExpanded = Boolean(expandedGroups[item.id]);
                                    const completedCount = item.items.filter(p => !p.isPending).length;
                                    const pendingCount = item.items.filter(p => p.isPending).length;
                                    const totalGross = item.items.reduce((acc, p) => acc + calculateGrossPay(p), 0);
                                    const totalDed = item.items.reduce((acc, p) => acc + toSafeNumber(p.deductions), 0);
                                    const totalNet = item.items.reduce((acc, p) => acc + toSafeNumber(p.net_pay), 0);

                                    return (
                                        <React.Fragment key={item.id}>
                                            <tr
                                                onClick={() => toggleGroup(item.id)}
                                                className="bg-slate-100/90 hover:bg-slate-200/70 cursor-pointer transition-colors border-y-2 border-slate-200 font-semibold"
                                            >
                                                <td className="px-6 lg:px-8 py-3.5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-7 h-7 rounded-lg bg-white border border-slate-300 flex items-center justify-center text-slate-700 text-xs shadow-xs">
                                                            <i className={`ti ti-chevron-${isExpanded ? 'down' : 'right'} transition-transform font-bold`} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-black text-slate-900">{item.groupName}</span>
                                                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-md tracking-wider">
                                                                    Factory Line
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                                                                {item.items.length} Total {item.items.length === 1 ? 'Worker' : 'Workers'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-6 lg:px-8 py-3.5">
                                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Line Total</span>
                                                </td>

                                                <td className="px-6 lg:px-8 py-3.5">
                                                    <div className="flex flex-col gap-0.5 text-xs max-w-[180px]">
                                                        <div className="flex justify-between">
                                                            <span className="text-slate-500 font-bold text-[11px]">Gross</span>
                                                            <span className="font-mono font-bold text-slate-800">₱{totalGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-red-500 font-bold text-[11px]">Deductions</span>
                                                            <span className="font-mono font-bold text-red-500">-₱{totalDed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-6 lg:px-8 py-3.5 text-right">
                                                    <span className="text-lg font-black text-emerald-700 font-mono tracking-tight">
                                                        ₱{totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                </td>

                                                <td className="px-6 lg:px-8 py-3.5 text-center">
                                                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                                        {completedCount > 0 && (
                                                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md">
                                                                {completedCount} Completed
                                                            </span>
                                                        )}
                                                        {pendingCount > 0 && (
                                                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-md">
                                                                {pendingCount} Pending
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                <td className="px-6 lg:px-8 py-3.5 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); toggleGroup(item.id); }}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-xs transition-colors"
                                                    >
                                                        <span>{isExpanded ? 'Collapse' : 'Expand Line'}</span>
                                                        <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'} text-xs`} />
                                                    </button>
                                                </td>
                                            </tr>

                                            {isExpanded && item.items.map(payroll => renderPayrollRow(payroll, true))}
                                        </React.Fragment>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan="6" className="px-8 py-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-slate-400">
                                                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-3">
                                                    <i className="ti ti-receipt-off text-3xl text-slate-300" />
                                                </div>
                                                <p className="text-lg font-black text-slate-800 tracking-tight">Vault Empty</p>
                                                <p className="text-xs text-slate-400 font-medium mt-0.5 max-w-sm">No payroll records found for this period. Click "Compute" to generate new payslips.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="px-4 sm:px-8 py-4 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-bold">
                        <div>
                            {totalItems > 0 ? (
                                <span>Showing <span className="text-slate-800 font-black">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-slate-800 font-black">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="text-slate-800 font-black">{totalItems}</span></span>
                            ) : (
                                <span>Showing <span className="text-slate-800 font-black">0</span> of <span className="text-slate-800 font-black">0</span></span>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                disabled={currentPage === 1}
                                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                            >
                                <i className="ti ti-chevron-left text-sm" /> Prev
                            </button>

                            <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-slate-800 font-black text-xs">
                                {currentPage} / {totalPages}
                            </span>

                            <button
                                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                disabled={currentPage >= totalPages}
                                className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed tap-active transition-all shadow-xs flex items-center gap-1.5"
                            >
                                Next <i className="ti ti-chevron-right text-sm" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}