import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Flatpickr from 'react-flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import FactoryPiece from './FactoryPiece';

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

export const matchJobTitle = (jobTitle, operation) => {
    if (!jobTitle || !operation) return false;
    const normJob = String(jobTitle).toLowerCase().trim();
    const normOp = String(operation).toLowerCase().trim();

    if (normJob === normOp || normJob.includes(normOp) || normOp.includes(normJob)) return true;

    const cleanJob = normJob.replace(/[^a-z0-9]/g, '');
    const cleanOp = normOp.replace(/[^a-z0-9]/g, '');
    if (!cleanJob || !cleanOp) return false;
    if (cleanJob === cleanOp || cleanJob.includes(cleanOp) || cleanOp.includes(cleanJob)) return true;

    const szJob = cleanJob.replace(/^z/, 's');
    const szOp = cleanOp.replace(/^z/, 's');
    if (szJob === szOp || szJob.includes(szOp) || szOp.includes(szJob)) return true;

    return false;
};

const HOLIDAY_LABELS = {
    regular: 'Regular Holiday',
    special_non_working: 'Special Non-Working Day',
};

const WorkerPayrollCard = React.memo(({ worker, workerData }) => {
    if (!workerData) return null;
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2.5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between">
            <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2 truncate">
                        <EmployeeAvatar employee={worker} size="h-7 w-7" textSize="text-[10px]" />
                        <div className="min-w-0">
                            <span className="font-bold text-slate-800 text-xs block truncate">
                                {worker.first_name} {worker.last_name}
                            </span>
                            <span className="text-[9px] font-semibold text-slate-400 uppercase block truncate">
                                {worker.job_title || worker.position || 'No Title'}
                            </span>
                        </div>
                    </div>
                    <span className="font-mono font-black text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md shrink-0">
                        Gross: ₱{workerData.grossPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                </div>

                {/* Operation Shares Breakdown */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <span>Assigned Processes</span>
                        {workerData.assignedOperations.length > 2 && (
                            <button
                                type="button"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="text-blue-600 hover:text-blue-700 font-bold lowercase cursor-pointer"
                            >
                                {isExpanded ? 'show less' : `+${workerData.assignedOperations.length - 2} more`}
                            </button>
                        )}
                    </div>
                    {workerData.assignedOperations.length > 0 ? (
                        <div className="space-y-0.5">
                            {(isExpanded ? workerData.assignedOperations : workerData.assignedOperations.slice(0, 2)).map((op, idx) => (
                                <div key={idx} className="flex justify-between items-center text-[11px]">
                                    <span className="text-slate-600 font-medium truncate">
                                        &bull; {op.operation} ({op.workerCount} worker{op.workerCount > 1 ? 's' : ''})
                                    </span>
                                    <span className="font-mono font-semibold text-slate-800">
                                        ₱{op.share.toFixed(2)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[10px] text-amber-600 italic">No matching job operation assigned</p>
                    )}
                </div>
            </div>

            {/* Deductions & Net Pay */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                <div>
                    <span className="text-[10px] text-slate-400 font-bold block">
                        Deductions
                    </span>
                    <span className="font-mono font-bold text-red-500 text-[11px] block">
                        -₱{workerData.totalDeductions.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-400 block" title={`SSS: ₱${workerData.sss} | PH: ₱${workerData.philHealth} | Pag-IBIG: ₱${workerData.pagIbig} | Tax: ₱${workerData.tax}`}>
                        SSS {workerData.sss.toFixed(0)} &middot; PH {workerData.philHealth.toFixed(0)}
                    </span>
                </div>
                <div className="text-right">
                    <span className="text-[10px] text-emerald-600 font-bold block uppercase">Net Payout</span>
                    <span className="font-mono font-black text-emerald-600 text-sm">
                        ₱{workerData.netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                </div>
            </div>
        </div>
    );
});
WorkerPayrollCard.displayName = 'WorkerPayrollCard';

const PayrollCreate = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const queryClient = useQueryClient();

    // Mode state: 'batch' (Factory Group) | 'single' (Individual Employee)
    const [entryMode, setEntryMode] = useState('batch');
    const [employees, setEmployees] = useState([]);
    const [productionGroups, setProductionGroups] = useState([]);

    // Factory Piece Rate Log Modal Control State
    const [isFactoryPieceOpen, setIsFactoryPieceOpen] = useState(false);

    // Dynamic Group Selection State
    const [selectedGroup, setSelectedGroup] = useState('');
    const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState([]);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [groupSearch, setGroupSearch] = useState('');

    // Breakdown UI Friendly Mode: 'table' | 'cards'
    const [breakdownViewMode, setBreakdownViewMode] = useState('table');
    const [breakdownSearch, setBreakdownSearch] = useState('');
    const [breakdownFilter, setBreakdownFilter] = useState('all'); // 'all' | 'payable' | 'unassigned'

    // Prefill form values from location state or URL params
    const initialPrefillRef = useRef({
        employee_id: location.state?.employee_id ?? searchParams.get('employee_id') ?? '',
        period_start: location.state?.period_start ?? searchParams.get('period_start') ?? '',
        period_end: location.state?.period_end ?? searchParams.get('period_end') ?? '',
    });
    const initialPrefill = initialPrefillRef.current;
    const hasPrefilledPeriod = Boolean(initialPrefill.period_start && initialPrefill.period_end);

    // Common Cutoff Dates State
    const [periodStart, setPeriodStart] = useState(
        initialPrefill.period_start || extractDateStr(new Date())
    );
    const [periodEnd, setPeriodEnd] = useState(
        initialPrefill.period_end || extractDateStr(new Date(Date.now() + 6 * 24 * 60 * 60 * 1000))
    );

    // Single Entry Form Data (Overtime enabled ONLY for Regular Employees)
    const [formData, setFormData] = useState({
        employee_id: initialPrefill.employee_id,
        days_worked: 0,
        overtime_hours: '',
        late_deductions: '',
        allowance: ''
    });

    const DEFAULT_FACTORY_ROWS = useMemo(() => [
        { id: 1, operation: 'Cutter', stock_no: 'Formal', quantity_in: '100', amount: '10.00', assignedEmployeeIds: [] },
        { id: 2, operation: 'Marking', stock_no: 'Formal', quantity_in: '100', amount: '5.00', assignedEmployeeIds: [] },
        { id: 3, operation: 'Areglo', stock_no: 'Formal', quantity_in: '100', amount: '50.00', assignedEmployeeIds: [] },
        { id: 4, operation: 'Sapatero (Lapat/Swelas)', stock_no: 'Formal', quantity_in: '100', amount: '100.00', assignedEmployeeIds: [] },
        { id: 5, operation: 'Alamoda', stock_no: 'Formal', quantity_in: '100', amount: '10.00', assignedEmployeeIds: [] },
        { id: 6, operation: 'Finishing', stock_no: 'Formal', quantity_in: '100', amount: '20.00', assignedEmployeeIds: [] },
    ], []);

    // Factory Batch Sheet Operations Table State
    const [factoryRows, setFactoryRows] = useState(DEFAULT_FACTORY_ROWS);

    // Modal & UI State
    const [isEmpModalOpen, setIsEmpModalOpen] = useState(false);
    const [empSearch, setEmpSearch] = useState('');
    const [selectedDeptFilter, setSelectedDeptFilter] = useState('ALL');
    const [activePreset, setActivePreset] = useState('current_week');
    const [includeWeekends, setIncludeWeekends] = useState(true);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
    const [isCalculating, setIsCalculating] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [holidayPreview, setHolidayPreview] = useState({ items: [], totalHolidayPay: 0 });
    const [prefillEmployeeMissing, setPrefillEmployeeMissing] = useState(false);

    // Save Factory Piece Rows Callback with persistence and feedback
    const handleSaveFactoryPiece = (updatedRows) => {
        if (Array.isArray(updatedRows)) {
            setFactoryRows(updatedRows);
            if (selectedGroup) {
                try {
                    localStorage.setItem(`hris_factory_piece_rows_${selectedGroup}`, JSON.stringify(updatedRows));
                } catch (e) {
                    console.error('Failed to cache factory rows:', e);
                }
            }
        }
        setSuccess(`Factory piece-rate operations for ${selectedGroup || 'group'} saved successfully.`);
        setTimeout(() => setSuccess(null), 3000);
        setIsFactoryPieceOpen(false);
    };

    // Load active employees and production groups from database
    useEffect(() => {
        let isMounted = true;

        const loadData = async () => {
            try {
                setIsLoadingEmployees(true);

                // Quick cache check for sub-millisecond instant initial hydration
                const cachedEmps = queryClient.getQueryData(['adminPayrollEligibleEmployees']) || queryClient.getQueryData(['adminEmployees']);
                if (cachedEmps && Array.isArray(cachedEmps) && cachedEmps.length > 0 && isMounted) {
                    const payableList = cachedEmps.filter(e => {
                        const roleStr = (e.role || '').toLowerCase();
                        const statusStr = (e.status || 'active').toLowerCase();
                        return roleStr !== 'admin' && roleStr !== 'security' && statusStr === 'active';
                    });
                    if (payableList.length > 0) {
                        const formattedList = payableList.map(e => ({
                            ...e,
                            group: e.production_group?.name || e.group_name || e.group || 'Unassigned',
                            production_group_id: e.production_group_id || e.production_group?.id || null
                        }));
                        setEmployees(formattedList);
                        if (initialPrefill.employee_id) {
                            const targetEmp = formattedList.find(e => String(e.id) === String(initialPrefill.employee_id));
                            if (targetEmp && isFactoryDept(getEmployeeDept(targetEmp)) && targetEmp.group) {
                                setSelectedGroup(targetEmp.group);
                                const factoryEmps = formattedList.filter(e => isFactoryDept(getEmployeeDept(e)));
                                setSelectedGroupMemberIds(factoryEmps.filter(e => e.group === targetEmp.group).map(e => String(e.id)));
                            }
                        } else {
                            setSelectedGroup('');
                            setSelectedGroupMemberIds([]);
                        }
                    }
                }

                const [groupsRes, empRes] = await Promise.all([
                    fetchWithAuth('/api/production-groups').catch(() => null),
                    fetchWithAuth('/api/employees').catch(() => null)
                ]);

                let groupsList = [];
                if (groupsRes && groupsRes.ok) {
                    const groupsData = await groupsRes.json();
                    groupsList = Array.isArray(groupsData) ? groupsData : (groupsData.data || []);
                    if (isMounted) setProductionGroups(groupsList);
                }

                const groupMap = {};
                groupsList.forEach(g => {
                    if (g.id && g.name) groupMap[g.id] = g.name;
                });

                if (empRes && empRes.ok && isMounted) {
                    const result = await empRes.json();
                    const list = Array.isArray(result) ? result : (result.data || []);
                    const payableList = list.filter(e => {
                        const roleStr = (e.role || '').toLowerCase();
                        const statusStr = (e.status || 'active').toLowerCase();
                        return roleStr !== 'admin' && roleStr !== 'security' && statusStr === 'active';
                    });

                    const formattedList = payableList.map(e => {
                        const resolvedGroupName = e.production_group?.name
                            || groupMap[e.production_group_id]
                            || e.group_name
                            || e.group
                            || (e.production_group_id ? `Group ${e.production_group_id.substring(0, 4)}` : 'Unassigned');

                        return {
                            ...e,
                            group: resolvedGroupName,
                            production_group_id: e.production_group_id || e.production_group?.id || null
                        };
                    });

                    setEmployees(formattedList);

                    const factoryEmps = formattedList.filter(e => isFactoryDept(getEmployeeDept(e)));

                    if (initialPrefill.employee_id) {
                        const targetEmp = formattedList.find(
                            e => String(e.id) === String(initialPrefill.employee_id)
                        );
                        if (!targetEmp) {
                            setPrefillEmployeeMissing(true);
                            setFormData(prev => ({ ...prev, employee_id: '' }));
                        } else if (isFactoryDept(getEmployeeDept(targetEmp))) {
                            if (targetEmp.group) {
                                setSelectedGroup(targetEmp.group);
                                const groupMembers = factoryEmps.filter(e => e.group === targetEmp.group);
                                setSelectedGroupMemberIds(groupMembers.map(e => String(e.id)));

                                try {
                                    const saved = localStorage.getItem(`hris_factory_piece_rows_${targetEmp.group}`);
                                    if (saved) {
                                        const parsed = JSON.parse(saved);
                                        if (Array.isArray(parsed) && parsed.length > 0) {
                                            setFactoryRows(parsed);
                                        }
                                    }
                                } catch (e) {}
                            }
                            setEntryMode('batch');
                        } else {
                            setEntryMode('single');
                            setFormData(prev => ({ ...prev, employee_id: String(targetEmp.id) }));
                        }
                    } else {
                        // Default to none: user selects group manually in Factory Piece Log
                        setSelectedGroup('');
                        setSelectedGroupMemberIds([]);
                    }
                }
            } catch (err) {
                console.error('Failed to load payroll initialization data:', err);
            } finally {
                if (isMounted) setIsLoadingEmployees(false);
            }
        };

        loadData();
        return () => { isMounted = false; };
    }, []);

    const factoryEmployees = useMemo(() => {
        return employees.filter(e => isFactoryDept(getEmployeeDept(e)));
    }, [employees]);

    const availableGroups = useMemo(() => {
        const empGroups = factoryEmployees.map(e => e.group);
        const dbGroups = productionGroups.map(g => g.name);
        const set = new Set([...dbGroups, ...empGroups].filter(Boolean));
        return Array.from(set);
    }, [factoryEmployees, productionGroups]);

    const employeesInSelectedGroup = useMemo(() => {
        return factoryEmployees.filter(e => e.group === selectedGroup);
    }, [factoryEmployees, selectedGroup]);

    const handleGroupTabChange = (groupName) => {
        if (selectedGroup === groupName) {
            setSelectedGroup('');
            setSelectedGroupMemberIds([]);
            return;
        }
        setSelectedGroup(groupName);
        const membersOfGroup = factoryEmployees.filter(e => e.group === groupName);
        setSelectedGroupMemberIds(membersOfGroup.map(e => String(e.id)));

        // Load saved template for this group if available
        try {
            const saved = localStorage.getItem(`hris_factory_piece_rows_${groupName}`);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setFactoryRows(parsed);
                    return;
                }
            }
            setFactoryRows(DEFAULT_FACTORY_ROWS);
        } catch (e) {}
    };

    const activeGroupEmployees = useMemo(() => {
        return factoryEmployees.filter(e => selectedGroupMemberIds.includes(String(e.id)));
    }, [factoryEmployees, selectedGroupMemberIds]);

    const toggleGroupMember = (empId) => {
        const idStr = String(empId);
        setSelectedGroupMemberIds(prev =>
            prev.includes(idStr) ? prev.filter(id => id !== idStr) : [...prev, idStr]
        );
    };

    const selectAllGroupMembers = () => {
        setSelectedGroupMemberIds(employeesInSelectedGroup.map(e => String(e.id)));
    };

    const clearAllGroupMembers = () => {
        setSelectedGroupMemberIds([]);
    };

    // Cutoff Presets
    useEffect(() => {
        if (hasPrefilledPeriod) {
            setActivePreset('custom');
            return;
        }
        applyCutoffPreset('current_week', includeWeekends);
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

            setPeriodStart(formatLocalDate(start));
            setPeriodEnd(formatLocalDate(end));
        }
    };

    const toggleWeekends = () => {
        const nextState = !includeWeekends;
        setIncludeWeekends(nextState);

        if (activePreset === 'current_week') {
            applyCutoffPreset('current_week', nextState);
        } else if (nextState && periodStart) {
            const s = new Date(periodStart + 'T00:00:00');
            if (!isNaN(s.getTime())) {
                const e = new Date(s);
                e.setDate(s.getDate() + 6);
                setPeriodEnd(formatLocalDate(e));
            }
        }
    };

    const handleStartDateChange = ([date]) => {
        if (!date) return;
        setActivePreset('custom');
        const startStr = formatLocalDate(date);
        setPeriodStart(startStr);

        if (includeWeekends) {
            const end = new Date(date);
            end.setDate(date.getDate() + 6);
            setPeriodEnd(formatLocalDate(end));
        }
    };

    const handleEndDateChange = ([date]) => {
        if (!date) return;
        setActivePreset('custom');
        const endStr = formatLocalDate(date);
        setPeriodEnd(endStr);

        if (includeWeekends) {
            const start = new Date(date);
            start.setDate(date.getDate() - 6);
            setPeriodStart(formatLocalDate(start));
        }
    };

    const { periodDaysCount, isInvalidDateRange } = useMemo(() => {
        if (!periodStart || !periodEnd) return { periodDaysCount: 0, isInvalidDateRange: false };
        const s = new Date(periodStart + 'T00:00:00');
        const e = new Date(periodEnd + 'T00:00:00');
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return { periodDaysCount: 0, isInvalidDateRange: false };
        if (e < s) return { periodDaysCount: 0, isInvalidDateRange: true };
        const diffTime = Math.abs(e - s);
        const count = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        return { periodDaysCount: count, isInvalidDateRange: false };
    }, [periodStart, periodEnd]);

    const activeGroupEmployeeIdSet = useMemo(() => {
        return new Set(activeGroupEmployees.map(e => String(e.id)));
    }, [activeGroupEmployees]);

    // Computed Factory Operation Rows
    const computedFactoryRows = useMemo(() => {
        return factoryRows.map(row => {
            const qty = parseFloat(row.quantity_in) || 0;
            const amt = parseFloat(row.amount) || 0;
            const totalPrice = qty * amt;

            const rawAssigned = Array.isArray(row.assignedEmployeeIds) ? row.assignedEmployeeIds : [];

            const groupAssignedIds = rawAssigned.filter(id =>
                activeGroupEmployeeIdSet.has(String(id))
            );

            let effectiveAssignedIds = [];

            if (row.isExplicitlyEmpty) {
                effectiveAssignedIds = [];
            } else if (groupAssignedIds.length > 0) {
                effectiveAssignedIds = groupAssignedIds;
            } else {
                const jobMatchedEmployees = activeGroupEmployees.filter(emp => {
                    const empJobTitle = emp.job_title || emp.position || '';
                    return matchJobTitle(empJobTitle, row.operation);
                });

                effectiveAssignedIds = jobMatchedEmployees.map(e => String(e.id));
            }

            return {
                ...row,
                qty,
                amt,
                totalPrice,
                effectiveAssignedIds,
                perWorkerShare: effectiveAssignedIds.length > 0 ? totalPrice / effectiveAssignedIds.length : 0
            };
        });
    }, [factoryRows, activeGroupEmployees]);

    const grandTotalFactoryPayout = useMemo(() => {
        if (!selectedGroup) return 0;
        return computedFactoryRows.reduce((sum, r) => sum + r.totalPrice, 0);
    }, [computedFactoryRows, selectedGroup]);

    // Operation-Level Calculation & Statutory Breakdown per Employee
    const workerPayrollMap = useMemo(() => {
        const map = {};

        activeGroupEmployees.forEach(emp => {
            const idStr = String(emp.id);
            map[idStr] = {
                employee: emp,
                assignedOperations: [],
                grossPay: 0,
                sss: 0,
                philHealth: 0,
                pagIbig: 0,
                tax: 0,
                totalDeductions: 0,
                netPay: 0
            };
        });

        computedFactoryRows.forEach(row => {
            const assignedIds = row.effectiveAssignedIds;
            if (assignedIds.length === 0) return;

            const share = row.perWorkerShare;

            assignedIds.forEach(empId => {
                if (map[empId]) {
                    map[empId].assignedOperations.push({
                        operation: row.operation || 'Unnamed Process',
                        stock_no: row.stock_no,
                        qty: row.qty,
                        amt: row.amt,
                        totalPrice: row.totalPrice,
                        workerCount: assignedIds.length,
                        share
                    });
                    map[empId].grossPay += share;
                }
            });
        });

        Object.keys(map).forEach(empId => {
            const item = map[empId];
            const gross = item.grossPay;

            let sss = 0;
            let philHealth = 0;
            let pagIbig = 0;
            let tax = 0;

            if (gross > 0) {
                // Monthly equivalent base for statutory tiers (Weekly gross * 4)
                const monthlyEquiv = gross * 4;

                // 1. SSS: 5% EE share, capped at P35,000 MSC, divided by 4 for weekly
                const sssBase = Math.min(monthlyEquiv, 35000);
                const monthlySss = sssBase * 0.05;
                sss = parseFloat((monthlySss / 4).toFixed(2));

                // 2. PhilHealth: 5% total split 50/50 (2.5% EE share), min P10k, max P100k, divided by 4 for weekly
                const phBase = Math.min(Math.max(monthlyEquiv, 10000), 100000);
                const monthlyPhilHealth = (phBase * 0.05) / 2;
                philHealth = parseFloat((monthlyPhilHealth / 4).toFixed(2));

                // 3. Pag-IBIG: 2% EE share capped at P100/mo (P200 total), divided by 4 for weekly
                const monthlyPagIbig = Math.min(monthlyEquiv * 0.02, 100);
                pagIbig = parseFloat((monthlyPagIbig / 4).toFixed(2));

                // 4. BIR Withholding Tax (TRAIN Law weekly brackets)
                const totalStatutory = parseFloat((sss + philHealth + pagIbig).toFixed(2));
                const weeklyTaxable = Math.max(0, gross - totalStatutory);
                const monthlyTaxable = weeklyTaxable * 4;

                let monthlyTax = 0;
                if (monthlyTaxable > 20833.33) {
                    if (monthlyTaxable <= 33333.33) {
                        monthlyTax = (monthlyTaxable - 20833.33) * 0.15;
                    } else if (monthlyTaxable <= 66666.67) {
                        monthlyTax = 1875.00 + (monthlyTaxable - 33333.33) * 0.20;
                    } else if (monthlyTaxable <= 166666.67) {
                        monthlyTax = 8541.67 + (monthlyTaxable - 66666.67) * 0.25;
                    } else if (monthlyTaxable <= 666666.67) {
                        monthlyTax = 33541.67 + (monthlyTaxable - 166666.67) * 0.30;
                    } else {
                        monthlyTax = 183541.67 + (monthlyTaxable - 666666.67) * 0.35;
                    }
                }
                tax = parseFloat((monthlyTax / 4).toFixed(2));

                item.sss = sss;
                item.philHealth = philHealth;
                item.pagIbig = pagIbig;
                item.tax = tax;

                const rawTotalDeductions = parseFloat((totalStatutory + tax).toFixed(2));
                item.totalDeductions = Math.min(gross, rawTotalDeductions);
                item.netPay = Math.max(0, parseFloat((gross - item.totalDeductions).toFixed(2)));
            } else {
                item.sss = 0;
                item.philHealth = 0;
                item.pagIbig = 0;
                item.tax = 0;
                item.totalDeductions = 0;
                item.netPay = 0;
            }
        });

        return map;
    }, [activeGroupEmployees, computedFactoryRows]);

    // Executive Metrics & Summary for the Active Group
    const batchSummaryTotals = useMemo(() => {
        let gross = 0;
        let deductions = 0;
        let net = 0;
        let sss = 0;
        let philHealth = 0;
        let pagIbig = 0;
        let tax = 0;
        let payableCount = 0;
        let zeroCount = 0;

        activeGroupEmployees.forEach(emp => {
            const data = workerPayrollMap[String(emp.id)];
            if (data) {
                const g = data.grossPay || 0;
                gross += g;
                deductions += data.totalDeductions || 0;
                net += data.netPay || 0;
                sss += data.sss || 0;
                philHealth += data.philHealth || 0;
                pagIbig += data.pagIbig || 0;
                tax += data.tax || 0;
                if (g > 0) payableCount++;
                else zeroCount++;
            } else {
                zeroCount++;
            }
        });

        return { gross, deductions, net, sss, philHealth, pagIbig, tax, payableCount, zeroCount };
    }, [activeGroupEmployees, workerPayrollMap]);

    const filteredGroupEmployees = useMemo(() => {
        return activeGroupEmployees.filter(worker => {
            const data = workerPayrollMap[String(worker.id)];
            if (breakdownFilter === 'payable' && (!data || data.grossPay <= 0)) return false;
            if (breakdownFilter === 'unassigned' && data && data.grossPay > 0) return false;

            if (!breakdownSearch.trim()) return true;
            const q = breakdownSearch.toLowerCase();
            const name = `${worker.first_name || ''} ${worker.last_name || ''}`.toLowerCase();
            const title = (worker.job_title || worker.position || '').toLowerCase();
            return name.includes(q) || title.includes(q);
        });
    }, [activeGroupEmployees, workerPayrollMap, breakdownSearch, breakdownFilter]);

    // Single Mode Employee Computations
    const selectedEmployee = useMemo(() => {
        return employees.find(e => String(e.id) === String(formData.employee_id));
    }, [employees, formData.employee_id]);

    const employeeRate = useMemo(() => {
        return getEmployeeRate(selectedEmployee);
    }, [selectedEmployee]);

    // Regular Employee Rates & Live Overtime Calculations
    const regularHourlyRate = useMemo(() => {
        const doleDivisor = 21.75;
        const monthlyBase = employeeRate;
        const dailyRate = monthlyBase > 0 ? (monthlyBase / doleDivisor) : parseFloat(selectedEmployee?.daily_rate || 0);
        return dailyRate / 8;
    }, [employeeRate, selectedEmployee]);

    const estimatedOtPay = useMemo(() => {
        const otHours = parseFloat(formData.overtime_hours) || 0;
        return otHours * regularHourlyRate * 1.25; // 125% DOLE regular OT rate
    }, [formData.overtime_hours, regularHourlyRate]);

    const availableDepartments = useMemo(() => {
        const nonFactoryEmployees = employees.filter(e => !isFactoryDept(getEmployeeDept(e)));
        const depts = new Set(nonFactoryEmployees.map(getEmployeeDept));
        return ['ALL', ...Array.from(depts)];
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        const search = empSearch.toLowerCase();
        return employees.filter(emp => {
            if (isFactoryDept(getEmployeeDept(emp))) return false;

            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const dept = getEmployeeDept(emp);
            const matchesSearch = fullName.includes(search) || dept.toLowerCase().includes(search);
            const matchesDept = selectedDeptFilter === 'ALL' || dept === selectedDeptFilter;
            return matchesSearch && matchesDept;
        });
    }, [employees, empSearch, selectedDeptFilter]);

    // Single Employee Attendance & Calculation
    useEffect(() => {
        if (entryMode !== 'single' || !formData.employee_id || !periodStart || !periodEnd || isInvalidDateRange) {
            return;
        }

        let isMounted = true;
        setIsCalculating(true);

        const calculatePayroll = async () => {
            try {
                const attendanceRes = await fetchWithAuth(
                    `/api/attendance?employee_id=${formData.employee_id}&start_date=${periodStart}&end_date=${periodEnd}`
                );
                const rawLogs = await attendanceRes.json();
                const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs.data || rawLogs.logs || []);

                const doleDivisor = 21.75;
                const gracePeriodMins = 15;

                const monthlyBase = employeeRate;
                const dailyRate = monthlyBase > 0 ? (monthlyBase / doleDivisor) : parseFloat(selectedEmployee?.daily_rate || 0);
                const hourlyRate = dailyRate / 8;
                const perMinuteRate = hourlyRate / 60;

                let adjustments = 0;
                let calculatedOtHours = 0;
                const workedDatesSet = new Set();

                const completedLogs = Array.isArray(logs) ? logs.filter(l => l && l.time_out && l.time_in) : [];

                completedLogs.forEach(log => {
                    const dateStr = extractDateStr(log.date || log.time_in);
                    if (dateStr) workedDatesSet.add(dateStr);

                    const timeIn = parseDate(log.time_in);
                    const timeOut = parseDate(log.time_out);

                    // Late tardiness calculations
                    if (timeIn && dateStr) {
                        const scheduleStart = new Date(`${dateStr}T08:00:00`);
                        if (!isNaN(scheduleStart.getTime()) && timeIn > scheduleStart) {
                            const minutes = Math.floor((timeIn - scheduleStart) / 60000);
                            if (minutes > gracePeriodMins && perMinuteRate > 0) {
                                adjustments += (minutes * perMinuteRate);
                            }
                        }
                    }

                    // Overtime calculations (Regular Employee Only)
                    if (log.overtime_hours) {
                        calculatedOtHours += parseFloat(log.overtime_hours) || 0;
                    } else if (log.ot_hours) {
                        calculatedOtHours += parseFloat(log.ot_hours) || 0;
                    } else if (timeOut && dateStr) {
                        const scheduleEnd = new Date(`${dateStr}T17:00:00`);
                        if (!isNaN(scheduleEnd.getTime()) && timeOut > scheduleEnd) {
                            const otMins = Math.floor((timeOut - scheduleEnd) / 60000);
                            if (otMins >= 30) {
                                calculatedOtHours += parseFloat((otMins / 60).toFixed(2));
                            }
                        }
                    }
                });

                const uniqueWorkedDates = Array.from(workedDatesSet);
                const daysWorked = uniqueWorkedDates.length;

                const previewRes = await fetchWithAuth('/api/payroll/preview', {
                    method: 'POST',
                    body: JSON.stringify({
                        employee_id: formData.employee_id,
                        period_start: periodStart,
                        period_end: periodEnd,
                        department: getEmployeeDept(selectedEmployee),
                        days_worked: daysWorked,
                        monthly_salary: selectedEmployee?.monthly_salary || selectedEmployee?.salary || 0,
                        daily_rate: dailyRate,
                        worked_dates: uniqueWorkedDates,
                        apply_deductions: true
                    }),
                });

                const previewData = await previewRes.json().catch(() => ({ items: [], totalHolidayPay: 0 }));

                if (isMounted) {
                    setFormData(prev => ({
                        ...prev,
                        days_worked: daysWorked,
                        overtime_hours: calculatedOtHours > 0 ? calculatedOtHours.toString() : prev.overtime_hours,
                        late_deductions: adjustments > 0 ? adjustments.toFixed(2) : prev.late_deductions
                    }));

                    setHolidayPreview(
                        previewRes.ok && Array.isArray(previewData.items) ? previewData : { items: [], totalHolidayPay: 0 }
                    );
                }
            } catch (err) {
                console.error('Calculation error:', err);
                if (isMounted) setHolidayPreview({ items: [], totalHolidayPay: 0 });
            } finally {
                if (isMounted) setIsCalculating(false);
            }
        };

        calculatePayroll();
        return () => { isMounted = false; };
    }, [entryMode, formData.employee_id, periodStart, periodEnd, selectedEmployee, employeeRate, isInvalidDateRange]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Submit Factory Batch Payroll (Piece-Rate Output Only - No Overtime)
    const handleSubmitBatch = async (e) => {
        e.preventDefault();
        if (isInvalidDateRange) {
            setError('End date cannot be earlier than start date.');
            return;
        }

        if (!selectedGroup) {
            setError('Please select a factory production group from the Factory Piece Log first.');
            return;
        }

        if (activeGroupEmployees.length === 0) {
            setError(`Please select at least one employee from ${selectedGroup} for batch production payout.`);
            return;
        }

        if (grandTotalFactoryPayout <= 0) {
            setError('Please enter valid quantities and amounts for factory operations.');
            return;
        }

        setError(null);
        setSuccess(null);
        setIsSubmitting(true);

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const groupObj = productionGroups.find(g => g.name === selectedGroup);

            const batchEntries = activeGroupEmployees.map(emp => {
                const empIdStr = String(emp.id);
                const workerData = workerPayrollMap[empIdStr];
                const empGrossPay = workerData ? workerData.grossPay : 0;
                const empOpsBreakdown = workerData ? workerData.assignedOperations : [];

                return {
                    employee_id: emp.id,
                    department: 'Factory',
                    group: selectedGroup,
                    production_group_id: emp.production_group_id || groupObj?.id || null,
                    period_start: periodStart,
                    period_end: periodEnd,
                    pay_frequency: 'weekly',
                    is_prorated: true,
                    gross_pay: empGrossPay,
                    sss_deduction: workerData ? workerData.sss : 0,
                    philhealth_deduction: workerData ? workerData.philHealth : 0,
                    pagibig_deduction: workerData ? workerData.pagIbig : 0,
                    tax_deduction: workerData ? workerData.tax : 0,
                    total_deductions: workerData ? workerData.totalDeductions : 0,
                    net_payout: workerData ? workerData.netPay : empGrossPay,
                    operations_breakdown: empOpsBreakdown,
                    admin_id: user?.id,
                    overtime_hours: 0,
                    overtime_pay: 0
                };
            }).filter(entry => entry.gross_pay > 0);

            if (batchEntries.length === 0) {
                setError('No employees were assigned to operations with positive payouts.');
                setIsSubmitting(false);
                return;
            }

            const response = await fetchWithAuth('/api/payroll/batch', {
                method: 'POST',
                body: JSON.stringify({
                    entries: batchEntries,
                    period_start: periodStart,
                    period_end: periodEnd,
                    pay_frequency: 'weekly',
                    admin_id: user?.id
                })
            });

            const data = await response.json();
            if (!response.ok || data.error) {
                setError(data.error || 'Failed to submit factory batch payroll.');
                setIsSubmitting(false);
            } else {
                setSuccess(`${selectedGroup} Payroll Distributed! Distributed ₱${grandTotalFactoryPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })} across ${batchEntries.length} assigned workers in ${selectedGroup}.`);
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });
                queryClient.invalidateQueries({ queryKey: ['adminPayrollEligibleEmployees'] });
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
                setTimeout(() => navigate('/admin/payroll'), 900);
            }
        } catch (err) {
            setError('Connection error. Please check your network.');
            setIsSubmitting(false);
        }
    };

    // Submit Single Payroll Entry (Regular Employee with OT)
    const handleSubmitSingle = async (e) => {
        e.preventDefault();
        if (isInvalidDateRange) {
            setError('End date cannot be earlier than start date.');
            return;
        }

        if (!selectedEmployee) {
            setError('Please select an employee.');
            return;
        }

        setError(null);
        setSuccess(null);
        setIsSubmitting(true);

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const otHours = parseFloat(formData.overtime_hours) || 0;
            const otPay = otHours * regularHourlyRate * 1.25;

            const payload = {
                ...formData,
                overtime_hours: otHours,
                overtime_pay: parseFloat(otPay.toFixed(2)),
                period_start: periodStart,
                period_end: periodEnd,
                apply_deductions: true,
                admin_id: user?.id
            };

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
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });
                queryClient.invalidateQueries({ queryKey: ['adminPayrollEligibleEmployees'] });
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'] });
                setTimeout(() => navigate('/admin/payroll'), 900);
            }
        } catch (err) {
            setError('Connection error. Please check your network.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto py-4 sm:py-8 px-3 sm:px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            <Link
                to="/admin/payroll"
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors mb-4 tap-active"
            >
                <i className="ti ti-arrow-left text-base" />
                <span>Back to Payroll Ledger</span>
            </Link>

            <div className="bg-white p-4 sm:p-8 lg:p-10 rounded-2xl sm:rounded-[2rem] shadow-sm border border-slate-100">

                {/* Header & Mode Switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="h-10 w-10 sm:h-14 sm:w-14 shrink-0 bg-blue-600 text-white rounded-xl sm:rounded-2xl flex items-center justify-center text-lg sm:text-2xl shadow-lg shadow-blue-500/20">
                            <i className="ti ti-calculator"></i>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg sm:text-3xl font-black text-slate-800 tracking-tight truncate">Payroll Engine</h2>
                            <p className="text-slate-400 text-[10px] sm:text-sm font-semibold uppercase tracking-wider mt-0.5 truncate">
                                Operation-Based Piece-Rate &amp; DOLE Wage Calculator
                            </p>
                        </div>
                    </div>

                    <div className="bg-slate-100 p-1.5 rounded-xl flex items-center self-start sm:self-auto gap-1 border border-slate-200/80">
                        <button
                            type="button"
                            onClick={() => { setEntryMode('batch'); setError(null); setSuccess(null); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${entryMode === 'batch' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            <i className="ti ti-building-factory text-sm" />
                            <span>Factory Process Batch</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setEntryMode('single'); setError(null); setSuccess(null); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${entryMode === 'single' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            <i className="ti ti-user-check text-sm" />
                            <span>Regular Employee</span>
                        </button>
                    </div>
                </div>

                {/* Alerts */}
                {error && (
                    <div className="mb-6 p-3.5 sm:p-4 bg-red-50 border-l-4 border-red-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-red-500 mt-0.5 text-lg sm:text-xl"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-red-800">Action Stopped</h4>
                            <p className="text-xs sm:text-sm text-red-600 mt-0.5 break-words">{error}</p>
                        </div>
                    </div>
                )}

                {success && (
                    <div className="mb-6 p-3.5 sm:p-4 bg-emerald-50 border-l-4 border-emerald-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-circle-check text-emerald-500 mt-0.5 text-lg sm:text-xl"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-emerald-800">Success</h4>
                            <p className="text-xs sm:text-sm text-emerald-600 mt-0.5 break-words">{success}</p>
                        </div>
                    </div>
                )}

                {prefillEmployeeMissing && (
                    <div className="mb-6 p-3.5 sm:p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r-xl shadow-sm flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-amber-500 mt-0.5 text-lg sm:text-xl"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-amber-800">Employee Not Found</h4>
                            <p className="text-xs sm:text-sm text-amber-700 mt-0.5 break-words">
                                The requested employee is no longer active in the roster or is a factory worker. Please select a valid daily/hourly employee.
                            </p>
                        </div>
                    </div>
                )}

                {/* Cutoff Period Selector */}
                <div className="bg-slate-50/80 p-4 sm:p-6 rounded-2xl border border-slate-100 space-y-4 mb-6">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2.5 sm:gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                <i className="ti ti-calendar-event"></i>
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Payroll Cutoff</h3>
                                <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">
                                    Configure payroll cutoff dates for this processing period
                                </p>
                            </div>
                        </div>

                        {activePreset === 'custom' && (
                            <span className="text-[10px] sm:text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1">
                                <i className="ti ti-edit"></i> {includeWeekends ? 'Auto-Week Lock' : 'Free Choice Mode'}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={toggleWeekends}
                            className={`shrink-0 whitespace-nowrap min-h-[38px] sm:min-h-[42px] px-3.5 sm:px-4 py-2 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-2 ${includeWeekends
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-slate-200 text-slate-700 border border-slate-300'
                                }`}
                        >
                            <i className={`ti ${includeWeekends ? 'ti-calendar-check text-emerald-600' : 'ti-calendar-minus text-slate-500'} text-base`}></i>
                            <span>{includeWeekends ? 'Auto-Weekends: Active (1 Week Auto)' : 'Auto-Weekends: Inactive (Free Choice)'}</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all group">
                            <div className="flex items-center justify-between mb-2 gap-1">
                                <span className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 truncate">
                                    <i className="ti ti-calendar-event text-blue-600 text-sm shrink-0"></i> Start Date
                                </span>
                                <span className="text-[10px] sm:text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md shrink-0">
                                    {formatReadableDate(periodStart)}
                                </span>
                            </div>
                            <Flatpickr
                                value={periodStart}
                                onChange={handleStartDateChange}
                                options={{ dateFormat: "Y-m-d", altInput: true, altFormat: "F j, Y (D)", disableMobile: true }}
                                className="w-full p-2.5 min-h-[44px] bg-slate-50 text-slate-800 font-bold rounded-lg border border-slate-200 outline-none cursor-pointer text-sm sm:text-base"
                            />
                        </div>

                        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 transition-all group">
                            <div className="flex items-center justify-between mb-2 gap-1">
                                <span className="text-[11px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 truncate">
                                    <i className="ti ti-flag text-emerald-600 text-sm shrink-0"></i> End Date
                                </span>
                                <span className="text-[10px] sm:text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                                    {formatReadableDate(periodEnd)}
                                </span>
                            </div>
                            <Flatpickr
                                value={periodEnd}
                                onChange={handleEndDateChange}
                                options={{ dateFormat: "Y-m-d", altInput: true, altFormat: "F j, Y (D)", disableMobile: true }}
                                className="w-full p-2.5 min-h-[44px] bg-slate-50 text-slate-800 font-bold rounded-lg border border-slate-200 outline-none cursor-pointer text-sm sm:text-base"
                            />
                        </div>
                    </div>

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
                                    {formatReadableDate(periodStart)} &rarr; {formatReadableDate(periodEnd)}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="shrink-0 font-black bg-blue-600 text-white px-2.5 py-0.5 rounded-md text-[11px] shadow-sm">
                                    {periodDaysCount} Days
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal containing factory piece operations log */}
                <FactoryPiece
                    isOpen={isFactoryPieceOpen}
                    onClose={() => setIsFactoryPieceOpen(false)}
                    onSave={handleSaveFactoryPiece}
                    availableGroups={availableGroups}
                    selectedGroup={selectedGroup}
                    handleGroupTabChange={handleGroupTabChange}
                    factoryEmployees={factoryEmployees}
                    activeGroupEmployees={activeGroupEmployees}
                    grandTotalFactoryPayout={grandTotalFactoryPayout}
                    factoryRows={factoryRows}
                    setFactoryRows={setFactoryRows}
                    computedFactoryRows={computedFactoryRows}
                />

                {/* BATCH MODE: FACTORY DEPARTMENT OPERATION-BASED PAYROLL */}
                {entryMode === 'batch' ? (
                    <form onSubmit={handleSubmitBatch} className="space-y-6">
                        {/* Access Button for Factory Piece Modal */}
                        <div className="bg-gradient-to-r from-blue-50/90 via-white to-blue-50/60 p-4 sm:p-5 rounded-2xl border border-blue-200 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
                            <div className="flex items-center gap-3.5 min-w-0">
                                <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xl shadow-md shadow-blue-500/20 shrink-0">
                                    <i className="ti ti-table" />
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="text-sm sm:text-base font-extrabold text-slate-800 truncate">Factory Production &amp; Piece-Rate Manager</h3>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${selectedGroup ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {selectedGroup ? `Group: ${selectedGroup}` : 'No Group Active'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">
                                        {selectedGroup ? (
                                            <>
                                                Output Total: <span className="font-bold font-mono text-emerald-600">₱{grandTotalFactoryPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> &middot; Active Roster: <span className="font-bold text-slate-700">{activeGroupEmployees.length} Workers</span>
                                            </>
                                        ) : (
                                            'Click to select a production group and configure batch quantities & operation rates.'
                                        )}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsFactoryPieceOpen(true)}
                                className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                            >
                                <i className="ti ti-adjustments-horizontal text-base" />
                                <span>{selectedGroup ? 'Edit Operations & Rates' : 'Select Group & Configure'}</span>
                            </button>
                        </div>

                        {/* Executive KPI Summary Ribbon (Visible when group is selected) */}
                        {selectedGroup && activeGroupEmployees.length > 0 && (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Production Group</span>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-base sm:text-lg font-black text-blue-700">{selectedGroup}</span>
                                        <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                                            {activeGroupEmployees.length} Workers
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Gross Output</span>
                                    <div className="text-base sm:text-lg font-black font-mono text-slate-900 mt-1">
                                        ₱{batchSummaryTotals.gross.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Deductions</span>
                                    <div className="text-base sm:text-lg font-black font-mono text-red-500 mt-1">
                                        -₱{batchSummaryTotals.deductions.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <div className="bg-white p-3.5 rounded-2xl border border-emerald-200 shadow-2xs bg-gradient-to-br from-emerald-50/40 to-white">
                                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Net Distribution</span>
                                    <div className="text-base sm:text-lg font-black font-mono text-emerald-600 mt-1">
                                        ₱{batchSummaryTotals.net.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Operation Earnings & Deductions Breakdown per Employee */}
                        <div className="bg-slate-50/80 p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-3.5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                                <div>
                                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                                        <span>Worker Earnings &amp; Net Payout Breakdown</span>
                                        {isLoadingEmployees ? (
                                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                                                <svg className="animate-spin h-2.5 w-2.5 text-blue-600" viewBox="0 0 24 24" fill="none">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                                <span>Loading...</span>
                                            </span>
                                        ) : (
                                            <span className="text-slate-500 font-bold">({activeGroupEmployees.length})</span>
                                        )}
                                    </h4>
                                    <p className="text-[11px] text-slate-400 font-medium">
                                        Each worker's gross pay is derived from their assigned process shares based on job title.
                                    </p>
                                </div>
                                {!isLoadingEmployees && selectedGroup && (
                                    <button
                                        type="button"
                                        onClick={() => setIsGroupModalOpen(true)}
                                        className="text-[11px] font-bold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer self-start sm:self-auto flex items-center gap-1.5"
                                    >
                                        <i className="ti ti-users text-xs" />
                                        <span>Modify Group Roster</span>
                                    </button>
                                )}
                            </div>

                            {/* Toolbar: Search, Filters & View Switcher */}
                            {!isLoadingEmployees && selectedGroup && activeGroupEmployees.length > 0 && (
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                                    {/* Search Input */}
                                    <div className="relative flex-1 max-w-xs sm:max-w-sm">
                                        <i className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                                        <input
                                            type="text"
                                            value={breakdownSearch}
                                            onChange={(e) => setBreakdownSearch(e.target.value)}
                                            placeholder="Filter worker or title..."
                                            className="w-full pl-8 pr-8 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium placeholder:text-slate-400 shadow-2xs"
                                        />
                                        {breakdownSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownSearch('')}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer text-xs"
                                            >
                                                <i className="ti ti-x" />
                                            </button>
                                        )}
                                    </div>

                                    {/* Filter Pills & View Switcher */}
                                    <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
                                        <div className="flex items-center bg-slate-200/70 p-0.5 rounded-xl text-[11px] font-bold">
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownFilter('all')}
                                                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                                                    breakdownFilter === 'all'
                                                        ? 'bg-white text-blue-700 shadow-2xs'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                All ({activeGroupEmployees.length})
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownFilter('payable')}
                                                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                                                    breakdownFilter === 'payable'
                                                        ? 'bg-white text-emerald-700 shadow-2xs'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                Payable ({batchSummaryTotals.payableCount})
                                            </button>
                                            {batchSummaryTotals.zeroCount > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setBreakdownFilter('unassigned')}
                                                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                                                        breakdownFilter === 'unassigned'
                                                            ? 'bg-white text-amber-700 shadow-2xs'
                                                            : 'text-slate-600 hover:text-slate-900'
                                                    }`}
                                                >
                                                    No Ops ({batchSummaryTotals.zeroCount})
                                                </button>
                                            )}
                                        </div>

                                        {/* View Mode Toggle: Table vs Cards */}
                                        <div className="flex items-center bg-slate-200/70 p-0.5 rounded-xl">
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownViewMode('table')}
                                                title="Roster Table View"
                                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                                    breakdownViewMode === 'table'
                                                        ? 'bg-white text-blue-700 shadow-2xs'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                <i className="ti ti-table" />
                                                <span className="hidden sm:inline">Roster</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownViewMode('cards')}
                                                title="Detailed Cards View"
                                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                                    breakdownViewMode === 'cards'
                                                        ? 'bg-white text-blue-700 shadow-2xs'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                }`}
                                            >
                                                <i className="ti ti-layout-grid" />
                                                <span className="hidden sm:inline">Cards</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {isLoadingEmployees ? (
                                /* Enterprise Skeleton Loader */
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
                                    {[1, 2, 3].map((n) => (
                                        <div
                                            key={n}
                                            className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-3 shadow-2xs"
                                        >
                                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-7 w-7 rounded-full bg-slate-200" />
                                                    <div className="space-y-1">
                                                        <div className="h-3 w-24 bg-slate-200 rounded" />
                                                        <div className="h-2 w-16 bg-slate-100 rounded" />
                                                    </div>
                                                </div>
                                                <div className="h-5 w-20 bg-blue-50 rounded-md" />
                                            </div>

                                            <div className="space-y-1.5 py-1">
                                                <div className="h-2 w-28 bg-slate-100 rounded" />
                                                <div className="h-3 w-full bg-slate-100 rounded" />
                                                <div className="h-3 w-3/4 bg-slate-100 rounded" />
                                            </div>

                                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                                <div className="space-y-1">
                                                    <div className="h-2 w-16 bg-slate-100 rounded" />
                                                    <div className="h-3 w-12 bg-red-100/60 rounded" />
                                                </div>
                                                <div className="space-y-1 text-right">
                                                    <div className="h-2 w-16 bg-slate-100 rounded ml-auto" />
                                                    <div className="h-4 w-16 bg-emerald-100/60 rounded ml-auto" />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : !selectedGroup ? (
                                <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200 space-y-3">
                                    <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl shadow-xs">
                                        <i className="ti ti-users-group" />
                                    </div>
                                    <div className="max-w-sm mx-auto">
                                        <h5 className="font-extrabold text-slate-800 text-sm">No Factory Group Selected</h5>
                                        <p className="text-xs text-slate-400 mt-1">
                                            Choose a production group to configure operations, assign rates, and distribute payouts.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsFactoryPieceOpen(true)}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                                    >
                                        <i className="ti ti-adjustments-horizontal" />
                                        <span>Select Group &amp; Open Piece Log</span>
                                    </button>
                                </div>
                            ) : activeGroupEmployees.length === 0 ? (
                                <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-dashed border-slate-200">
                                    <p className="text-xs font-semibold text-slate-600">No active employees assigned to {selectedGroup}.</p>
                                    <p className="text-[11px] text-slate-400 mt-1">Use "Modify Group Roster" to add workers to this group.</p>
                                </div>
                            ) : filteredGroupEmployees.length === 0 ? (
                                <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-1.5">
                                    <i className="ti ti-search text-2xl text-slate-300 block" />
                                    <p className="text-xs font-bold text-slate-700">No matching employees</p>
                                    <p className="text-[11px] text-slate-400">No employees in {selectedGroup} matched your search or filter.</p>
                                </div>
                            ) : breakdownViewMode === 'table' ? (
                                /* Clean Roster Table View (Non-overwhelming, high information density) */
                                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="bg-slate-50/90 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                <th className="p-3">Worker</th>
                                                <th className="p-3">Assigned Processes</th>
                                                <th className="p-3 text-right">Gross Output</th>
                                                <th className="p-3 text-right">Deductions</th>
                                                <th className="p-3 text-right">Net Payout</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {filteredGroupEmployees.map((worker) => {
                                                const workerData = workerPayrollMap[String(worker.id)];
                                                if (!workerData) return null;

                                                return (
                                                    <tr key={worker.id} className="hover:bg-blue-50/20 transition-colors">
                                                        <td className="p-3">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <EmployeeAvatar employee={worker} size="h-8 w-8" textSize="text-[10px]" />
                                                                <div className="min-w-0">
                                                                    <span className="font-bold text-slate-800 text-xs block truncate">
                                                                        {worker.first_name} {worker.last_name}
                                                                    </span>
                                                                    <span className="text-[10px] font-semibold text-slate-400 uppercase block truncate">
                                                                        {worker.job_title || worker.position || 'No Title'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-3">
                                                            {workerData.assignedOperations.length > 0 ? (
                                                                <div className="flex flex-wrap gap-1 max-w-sm">
                                                                    {workerData.assignedOperations.map((op, idx) => (
                                                                        <span
                                                                            key={idx}
                                                                            className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md"
                                                                        >
                                                                            <span>{op.operation}</span>
                                                                            <span className="font-mono font-bold text-blue-600">₱{op.share.toFixed(2)}</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md inline-block">
                                                                    No matching process
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="p-3 text-right font-mono font-bold text-xs text-slate-800">
                                                            ₱{workerData.grossPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            <span className="font-mono font-bold text-xs text-red-500 block">
                                                                -₱{workerData.totalDeductions.toFixed(2)}
                                                            </span>
                                                            <span className="text-[9px] text-slate-400 block" title={`SSS: ₱${workerData.sss} | PH: ₱${workerData.philHealth} | Pag-IBIG: ₱${workerData.pagIbig} | Tax: ₱${workerData.tax}`}>
                                                                SSS {workerData.sss.toFixed(0)} &middot; PH {workerData.philHealth.toFixed(0)}
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-right font-mono font-black text-sm text-emerald-600">
                                                            ₱{workerData.netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                /* Detailed Cards View */
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {filteredGroupEmployees.map((worker) => (
                                        <WorkerPayrollCard
                                            key={worker.id}
                                            worker={worker}
                                            workerData={workerPayrollMap[String(worker.id)]}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !selectedGroup || grandTotalFactoryPayout <= 0 || activeGroupEmployees.length === 0 || isInvalidDateRange}
                            className="w-full min-h-[52px] py-4 bg-slate-900 hover:bg-blue-600 text-white font-black text-base rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {isSubmitting ? (
                                <>
                                    <i className="ti ti-loader text-xl animate-spin"></i>
                                    <span>Distributing {selectedGroup || 'Factory'} Process Payroll...</span>
                                </>
                            ) : (
                                <>
                                    <i className="ti ti-cash text-xl"></i>
                                    <span>{selectedGroup ? `Save & Distribute ${selectedGroup} Process Payroll` : 'Select Factory Group to Distribute'}</span>
                                </>
                            )}
                        </button>
                    </form>
                ) : (
                    /* SINGLE MODE: INDIVIDUAL REGULAR EMPLOYEE FORM */
                    <form onSubmit={handleSubmitSingle} className="space-y-6 sm:space-y-8">
                        <div className="bg-slate-50/80 p-4 sm:p-6 rounded-2xl border border-slate-100">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2.5 sm:gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold shadow-xs shrink-0">
                                        <i className="ti ti-user"></i>
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Regular Employee Directory</h3>
                                        <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium leading-snug truncate">
                                            Select daily or hourly paid employee
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 bg-slate-200/60 px-2 sm:px-2.5 py-1 rounded-full shrink-0">
                                    {employees.filter(e => !isFactoryDept(getEmployeeDept(e))).length} Active Regular
                                </span>
                            </div>

                            {!selectedEmployee ? (
                                <button
                                    type="button"
                                    onClick={() => setIsEmpModalOpen(true)}
                                    className="w-full min-h-[56px] p-3.5 sm:p-4 bg-white hover:bg-slate-100/80 border-2 border-dashed border-blue-200 hover:border-blue-400 rounded-2xl text-left transition-all group flex items-center justify-between shadow-xs touch-manipulation cursor-pointer"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-xl bg-blue-50 group-hover:bg-blue-100 text-blue-600 flex items-center justify-center text-lg transition-colors shrink-0">
                                            <i className="ti ti-user-plus"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm sm:text-base font-bold text-slate-700 group-hover:text-blue-600 transition-colors truncate">Tap to choose regular employee</p>
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
                                                    ₱{employeeRate.toLocaleString('en-US', { minimumFractionDigits: 2 })} / month
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setIsEmpModalOpen(true)}
                                            className="shrink-0 px-2.5 sm:px-3 py-1.5 min-h-[36px] bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
                                        >
                                            Change
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Attendance Logged & Overtime Hours (Side-by-Side) */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs sm:text-sm font-bold text-slate-800">Attendance Logged</h3>
                                {isCalculating && (
                                    <div className="text-xs font-semibold text-blue-600 flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
                                        <i className="ti ti-loader animate-spin text-sm"></i> Calculating...
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Days Worked */}
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 flex flex-col justify-between">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Days Worked (Present)</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            name="days_worked"
                                            value={formData.days_worked}
                                            readOnly
                                            className="w-full p-3 bg-white border border-slate-200 rounded-xl font-mono text-lg font-black text-slate-800 outline-none"
                                        />
                                    </div>
                                </div>

                                {/* Overtime (OT) Hours - Regular Employee Only */}
                                <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 flex flex-col justify-between space-y-2">
                                    <div className="flex items-center justify-between gap-1 flex-wrap">
                                        <label className="block text-xs font-bold text-blue-700 uppercase flex items-center gap-1.5">
                                            <i className="ti ti-clock-play text-sm"></i> Overtime (OT) Hours
                                        </label>
                                        {estimatedOtPay > 0 && (
                                            <span className="text-xs font-bold text-emerald-600 font-mono bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                                +₱{estimatedOtPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (1.25x Rate)
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        name="overtime_hours"
                                        value={formData.overtime_hours}
                                        onChange={handleInputChange}
                                        className="w-full p-3 bg-white border border-blue-200 rounded-xl font-mono text-blue-800 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="0.0"
                                    />
                                    <p className="text-[11px] text-slate-500 font-medium">
                                        Overtime pay is exclusively available for regular employees (computed at standard 125% DOLE rate).
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Holiday Pay Preview */}
                        {holidayPreview.items.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs sm:text-sm font-bold text-slate-800">Holiday Pay (DOLE)</h3>
                                    <span className="font-black bg-amber-500 text-white px-3 py-1 rounded-lg text-xs">
                                        +₱{holidayPreview.totalHolidayPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                                <div className="bg-amber-50/60 border border-amber-100 rounded-2xl divide-y divide-amber-100/80">
                                    {holidayPreview.items.map((item) => (
                                        <div key={item.date} className="flex justify-between p-3 text-xs">
                                            <div>
                                                <p className="font-bold text-slate-800">{formatReadableDate(item.date)} &middot; {item.holidayName}</p>
                                                <p className="text-slate-500 text-[11px]">{HOLIDAY_LABELS[item.holidayType] || item.holidayType}</p>
                                            </div>
                                            <span className="font-mono font-bold text-emerald-600">
                                                ₱{item.pay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Deductions & Overrides */}
                        <div className="p-4 bg-red-50/60 rounded-2xl border border-red-100 space-y-2">
                            <label className="block text-xs font-bold text-red-600 uppercase">Late Deductions / Tardiness (₱)</label>
                            <input
                                type="number"
                                step="0.01"
                                name="late_deductions"
                                value={formData.late_deductions}
                                onChange={handleInputChange}
                                className="w-full p-3 bg-white border border-red-200 rounded-xl font-mono text-red-600 text-lg font-bold outline-none"
                                placeholder="0.00"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !formData.employee_id || isInvalidDateRange}
                            className="w-full min-h-[52px] py-4 bg-slate-900 hover:bg-blue-600 text-white font-black text-base sm:text-lg rounded-2xl shadow-xl transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50 cursor-pointer"
                        >
                            {!isSubmitting ? (
                                <>
                                    <i className="ti ti-cash text-xl"></i>
                                    <span>Compute &amp; Distribute Payslip</span>
                                </>
                            ) : (
                                <>
                                    <i className="ti ti-loader text-xl animate-spin"></i>
                                    <span>Computing Payroll...</span>
                                </>
                            )}
                        </button>
                    </form>
                )}
            </div>

            {/* Factory Group Selection Modal */}
            {isGroupModalOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div onClick={() => setIsGroupModalOpen(false)} className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs" />
                    <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h3 className="text-sm font-extrabold text-slate-800">Select {selectedGroup} Members</h3>
                                <p className="text-[11px] text-slate-400 font-semibold">Choose active members under {selectedGroup}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsGroupModalOpen(false)}
                                className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                            >
                                <i className="ti ti-x"></i>
                            </button>
                        </div>

                        <div className="p-3.5 border-b border-slate-100 space-y-3 bg-white">
                            <input
                                type="text"
                                value={groupSearch}
                                onChange={(e) => setGroupSearch(e.target.value)}
                                placeholder={`Search ${selectedGroup} worker...`}
                                className="w-full px-4 py-2.5 bg-slate-100 border border-transparent focus:border-blue-500 rounded-xl text-sm font-medium text-slate-800 outline-none"
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500">
                                    {selectedGroupMemberIds.length} of {employeesInSelectedGroup.length} Selected
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={selectAllGroupMembers}
                                        className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                    >
                                        Select All
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearAllGroupMembers}
                                        className="px-2.5 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-y-auto p-2.5 space-y-1.5">
                            {employeesInSelectedGroup
                                .filter(emp => `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase().includes(groupSearch.toLowerCase()))
                                .map((emp) => {
                                    const isChecked = selectedGroupMemberIds.includes(String(emp.id));

                                    return (
                                        <div
                                            key={emp.id}
                                            onClick={() => toggleGroupMember(emp.id)}
                                            className={`w-full p-2.5 rounded-2xl flex items-center justify-between text-left cursor-pointer transition-colors ${isChecked ? 'bg-blue-50/80 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => { }}
                                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                                                />
                                                <EmployeeAvatar employee={emp} size="h-9 w-9" rounded="rounded-xl" textSize="text-xs" />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-slate-800 truncate">{emp.first_name} {emp.last_name}</p>
                                                    <p className="text-[10px] text-slate-500 uppercase">{emp.job_title || emp.group} &middot; {getEmployeeDept(emp)}</p>
                                                </div>
                                            </div>
                                            {isChecked && (
                                                <span className="text-[10px] font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-md shrink-0">
                                                    Included
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>

                        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
                            <button
                                type="button"
                                onClick={() => setIsGroupModalOpen(false)}
                                className="w-full py-3 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                            >
                                Confirm Selection ({selectedGroupMemberIds.length} Members)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Single Mode Searchable Employee Modal */}
            {isEmpModalOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div onClick={() => setIsEmpModalOpen(false)} className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs" />
                    <div className="relative w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] z-10">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h3 className="text-sm font-extrabold text-slate-800">Select Regular Employee</h3>
                            <button
                                type="button"
                                onClick={() => setIsEmpModalOpen(false)}
                                className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-200 flex items-center justify-center cursor-pointer"
                            >
                                <i className="ti ti-x"></i>
                            </button>
                        </div>

                        <div className="p-3.5 border-b border-slate-100 space-y-3 bg-white">
                            <input
                                type="text"
                                value={empSearch}
                                onChange={(e) => setEmpSearch(e.target.value)}
                                placeholder="Search regular employee by name or department..."
                                className="w-full px-4 py-2.5 bg-slate-100 border border-transparent focus:border-blue-500 rounded-xl text-sm font-medium text-slate-800 outline-none"
                            />
                            <div className="flex gap-1.5 overflow-x-auto pb-1">
                                {availableDepartments.map((dept) => (
                                    <button
                                        key={dept}
                                        type="button"
                                        onClick={() => setSelectedDeptFilter(dept)}
                                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${selectedDeptFilter === dept ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
                                    >
                                        {dept}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="overflow-y-auto p-2.5 space-y-1.5">
                            {filteredEmployees.length === 0 ? (
                                <p className="text-center text-slate-400 text-xs py-6">No regular daily/hourly employees found.</p>
                            ) : (
                                filteredEmployees.map((emp) => {
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
                                            className={`w-full p-2.5 rounded-2xl flex items-center justify-between text-left cursor-pointer ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <EmployeeAvatar employee={emp} size="h-10 w-10" rounded="rounded-xl" textSize="text-xs" />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-slate-800 truncate">{emp.first_name} {emp.last_name}</p>
                                                    <p className="text-[10px] text-slate-500 uppercase">{getEmployeeDept(emp)} &middot; ₱{rate.toFixed(2)} / MO</p>
                                                </div>
                                            </div>
                                            {isSelected && <i className="ti ti-check text-blue-600"></i>}
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