import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import EmployeeAvatar from '../../../components/EmployeeAvatar';
import FactoryPiece from './FactoryPiece';
import { supabase } from '../../../supabaseClient';

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

// Helper function to extract or derive Hourly & Daily Rates
const getEmployeeRates = (emp) => {
    if (!emp) return { hourlyRate: 0, dailyRate: 0, monthlyRate: 0 };

    const hourlyRate = parseFloat(
        emp.hourly_rate || emp.rate_per_hour || emp.hourlyRate || emp.hourly_salary || 0
    );
    const dailyRate = parseFloat(
        emp.daily_rate || emp.rate_per_day || emp.dailyRate || emp.daily_salary || 0
    );
    const monthlyRate = parseFloat(
        emp.monthly_salary || emp.salary || emp.monthly_rate || emp.base_salary || emp.piece_rate || emp.rate_per_piece || 0
    );

    const doleDivisor = 21.75;

    let resolvedDaily = 0;
    let resolvedHourly = 0;

    if (dailyRate > 0) {
        resolvedDaily = dailyRate;
        resolvedHourly = hourlyRate > 0 ? hourlyRate : dailyRate / 8;
    } else if (hourlyRate > 0) {
        resolvedHourly = hourlyRate;
        resolvedDaily = hourlyRate * 8;
    } else if (monthlyRate > 0) {
        resolvedDaily = monthlyRate / doleDivisor;
        resolvedHourly = resolvedDaily / 8;
    }

    return {
        hourlyRate: resolvedHourly,
        dailyRate: resolvedDaily,
        monthlyRate: monthlyRate || (resolvedDaily * doleDivisor)
    };
};

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

const WorkerPayrollCard = React.memo(({ worker, workerData, holidayRateMultiplier }) => {
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
                                        {holidayRateMultiplier > 1 && (
                                            <span className="text-[9px] text-amber-600 font-bold ml-1">(Hol. Rate)</span>
                                        )}
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

    // Leave with pay information for selected employee
    const [paidLeaves, setPaidLeaves] = useState([]);
    const [isLoadingLeaves, setIsLoadingLeaves] = useState(false);

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
    const [breakdownFilter, setBreakdownFilter] = useState('all');

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

    // Stable refs for zero-latency realtime Supabase sync across multiple client machines
    const selectedGroupRef = useRef(selectedGroup);
    const productionGroupsRef = useRef(productionGroups);
    const periodStartRef = useRef(periodStart);
    const periodEndRef = useRef(periodEnd);

    useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);
    useEffect(() => { productionGroupsRef.current = productionGroups; }, [productionGroups]);
    useEffect(() => { periodStartRef.current = periodStart; }, [periodStart]);
    useEffect(() => { periodEndRef.current = periodEnd; }, [periodEnd]);

    // Single Entry Form Data
    const [formData, setFormData] = useState({
        employee_id: initialPrefill.employee_id,
        days_worked: 0,
        overtime_hours: '',
        late_deductions: '',
        late_minutes: 0,
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

    // Calculate total paid leave days for selected employee
    const totalPaidLeaveDays = useMemo(() => {
        if (!paidLeaves || paidLeaves.length === 0) return 0;
        return paidLeaves.reduce((sum, leave) => {
            const days = parseFloat(leave.days || leave.duration || leave.number_of_days || leave.total_days || 1);
            return sum + (isNaN(days) ? 1 : days);
        }, 0);
    }, [paidLeaves]);

    // Fetch leave with pay information for selected employee during cutoff
    useEffect(() => {
        if (entryMode !== 'single' || !formData.employee_id || !periodStart || !periodEnd) {
            setPaidLeaves([]);
            return;
        }

        let isMounted = true;

        const fetchPaidLeaves = async () => {
            setIsLoadingLeaves(true);
            try {
                // 1. Primary: Dedicated leave summary endpoint with exact DOLE overlap calculations
                const res = await fetchWithAuth(
                    `/api/leaves/summary?employee_id=${formData.employee_id}&start_date=${periodStart}&end_date=${periodEnd}`
                ).catch(() => null);

                if (res && res.ok) {
                    const summary = await res.json();
                    if (isMounted) {
                        const paidLeavesList = (summary.leaves || []).filter(l => l.is_paid);
                        setPaidLeaves(paidLeavesList.map(l => ({
                            ...l,
                            leave_type: l.type,
                            days: l.overlap_days || 1,
                            reason: l.notes
                        })));
                    }
                    return;
                }

                // 2. Secondary: Direct Supabase query on leave_requests table with exact period overlap math
                const { data: sbData } = await supabase
                    .from('leave_requests')
                    .select('*')
                    .eq('employee_id', formData.employee_id)
                    .eq('status', 'Approved')
                    .lte('start_date', periodEnd)
                    .gte('end_date', periodStart);

                if (!isMounted) return;

                const leavesList = (sbData || []).filter(l => {
                    const rawNotes = l.notes || '';
                    const isUnpaid = /\[PAY_TYPE:WITHOUT_PAY\]/i.test(rawNotes) || /\[UNPAID\]/i.test(rawNotes);
                    return !isUnpaid;
                }).map(l => {
                    const oStart = l.start_date > periodStart ? l.start_date : periodStart;
                    const oEnd = l.end_date < periodEnd ? l.end_date : periodEnd;
                    const overlapDays = Math.max(1, Math.round((new Date(oEnd) - new Date(oStart)) / (1000 * 60 * 60 * 24)) + 1);
                    return {
                        ...l,
                        leave_type: l.type,
                        days: overlapDays,
                        reason: (l.notes || '').replace(/\[PAY_TYPE:[^\]]+\]/gi, '').replace(/\[(PAID|UNPAID)\]/gi, '').trim()
                    };
                });

                setPaidLeaves(leavesList);
            } catch (err) {
                console.error('Failed to fetch paid leaves:', err);
                if (isMounted) setPaidLeaves([]);
            } finally {
                if (isMounted) setIsLoadingLeaves(false);
            }
        };

        fetchPaidLeaves();
        return () => { isMounted = false; };
    }, [entryMode, formData.employee_id, periodStart, periodEnd]);

    // Automatic Holiday Rate Multiplier for Piece-Rate calculations
    const holidayRateMultiplier = useMemo(() => {
        if (!holidayPreview || !holidayPreview.items || holidayPreview.items.length === 0) return 1;

        let premiumFactor = 0;
        holidayPreview.items.forEach(item => {
            if (item.holidayType === 'regular') {
                premiumFactor += 1.0;
            } else if (item.holidayType === 'special_non_working') {
                premiumFactor += 0.3;
            } else if (item.multiplier) {
                premiumFactor += Math.max(0, item.multiplier - 1);
            }
        });

        return 1 + premiumFactor;
    }, [holidayPreview]);

    // Automatic Holiday Detection for Cutoff Period
    useEffect(() => {
        const { isInvalidDateRange } = (() => {
            if (!periodStart || !periodEnd) return { isInvalidDateRange: false };
            const s = new Date(periodStart + 'T00:00:00');
            const e = new Date(periodEnd + 'T00:00:00');
            return { isInvalidDateRange: e < s };
        })();

        // FIX: targetEmpId now computed before the guard, and checked
        // alongside periodStart/periodEnd. Previously this could be an
        // empty string (no employee selected yet, employees list not
        // loaded yet) while periodStart/periodEnd were already set from a
        // default preset — the effect still fired and POSTed
        // employee_id: '' to /api/payroll/preview, which the backend
        // correctly rejects with "employee_id, period_start, and
        // period_end are required."
        const targetEmpId = formData.employee_id || (employees.length > 0 ? employees[0].id : '');

        if (!periodStart || !periodEnd || isInvalidDateRange || !targetEmpId) {
            setHolidayPreview({ items: [], totalHolidayPay: 0 });
            return;
        }

        let isMounted = true;
        const fetchHolidayPreview = async () => {
            try {
                // In single mode with selected employee, pass that employee's ID.
                // In batch mode or before employee selection, pass null/undefined to retrieve period holidays for piece-rate multiplier
                const targetEmpId = (entryMode === 'single' && formData.employee_id)
                    ? formData.employee_id
                    : (formData.employee_id || null);

                const previewRes = await fetchWithAuth('/api/payroll/preview', {
                    method: 'POST',
                    body: JSON.stringify({
                        employee_id: targetEmpId || undefined,
                        period_start: periodStart,
                        period_end: periodEnd,
                        apply_deductions: false
                    }),
                });

                if (previewRes.ok) {
                    const previewData = await previewRes.json().catch(() => ({ items: [], totalHolidayPay: 0 }));
                    if (isMounted) {
                        setHolidayPreview(
                            Array.isArray(previewData.items) ? previewData : { items: [], totalHolidayPay: 0 }
                        );
                    }
                }
            } catch (err) {
                console.error('Holiday preview fetch error:', err);
                if (isMounted) setHolidayPreview({ items: [], totalHolidayPay: 0 });
            }
        };

        fetchHolidayPreview();
        return () => { isMounted = false; };
    }, [periodStart, periodEnd, formData.employee_id, entryMode]);

    // Save Factory Piece Rows Callback
    const handleSaveFactoryPiece = async (updatedRows, shouldClose = true, targetGroupName = null) => {
        if (!Array.isArray(updatedRows)) return;
        const groupToSave = targetGroupName || selectedGroup;
        if (!groupToSave) return;

        if (groupToSave === selectedGroup) {
            setFactoryRows(updatedRows);
        }

        try {
            localStorage.setItem(`hris_factory_piece_rows_${groupToSave}`, JSON.stringify(updatedRows));
        } catch (e) { }

        const groups = productionGroupsRef.current || productionGroups;
        let groupObj = groups.find(g => g.name === groupToSave);
        let resolvedGroupId = groupObj?.id || null;

        if (!resolvedGroupId && groupToSave) {
            try {
                const { data: grp } = await supabase
                    .from('production_groups')
                    .select('id')
                    .ilike('name', groupToSave.trim())
                    .maybeSingle();
                if (grp?.id) resolvedGroupId = grp.id;
            } catch (e) { }
        }

        try {
            let existingRows = [];
            if (resolvedGroupId) {
                const { data: dbExisting } = await supabase
                    .from('factory_production_logs')
                    .select('id, operation, production_group_id')
                    .eq('production_group_id', resolvedGroupId);
                existingRows = dbExisting || [];
            }

            const existingById = new Map(existingRows.map(r => [r.id, r]));
            const existingByOp = new Map(existingRows.map(r => [(r.operation || '').trim().toLowerCase(), r]));

            const upsertPayloads = updatedRows.map(r => {
                const qty = parseFloat(r.quantity_in) || 0;
                const baseAmt = parseFloat(r.amount) || 0;
                const effectiveAmt = baseAmt * holidayRateMultiplier;
                const opName = (r.operation || 'General Operation').trim();

                let targetId = (r.id && existingById.has(r.id)) ? r.id : null;
                if (!targetId && existingByOp.has(opName.toLowerCase())) {
                    targetId = existingByOp.get(opName.toLowerCase()).id;
                }

                const payload = {
                    production_group_id: resolvedGroupId,
                    period_start: periodStart,
                    period_end: periodEnd,
                    operation: opName,
                    stock_no: r.stock_no || 'Formal',
                    quantity_in: qty,
                    amount: baseAmt,
                    total_amount: parseFloat((qty * effectiveAmt).toFixed(2)),
                    assigned_worker_ids: Array.isArray(r.assignedEmployeeIds) ? r.assignedEmployeeIds : [],
                    updated_at: new Date().toISOString()
                };
                if (targetId) payload.id = targetId;
                return payload;
            });

            const { data: savedData, error: upsertErr } = await supabase
                .from('factory_production_logs')
                .upsert(upsertPayloads, { onConflict: 'id' })
                .select('*');

            if (!upsertErr && savedData && savedData.length > 0) {
                const formatted = savedData.map(r => ({
                    id: r.id,
                    operation: r.operation,
                    stock_no: r.stock_no || 'Formal',
                    quantity_in: String(r.quantity_in ?? 0),
                    amount: String(r.amount ?? 0),
                    assignedEmployeeIds: Array.isArray(r.assigned_worker_ids) ? r.assigned_worker_ids : []
                }));

                if (selectedGroupRef.current === groupToSave) {
                    setFactoryRows(formatted);
                }
                try {
                    localStorage.setItem(`hris_factory_piece_rows_${groupToSave}`, JSON.stringify(formatted));
                } catch (e) { }

                fetchWithAuth('/api/payroll/factory-logs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        production_group_id: resolvedGroupId,
                        group_name: groupToSave,
                        period_start: periodStart,
                        period_end: periodEnd,
                        rows: formatted
                    })
                }).catch(() => { });

                if (shouldClose) {
                    setSuccess(`Factory piece-rate operations for ${groupToSave} saved successfully to cloud.`);
                    setTimeout(() => setSuccess(null), 3000);
                    setIsFactoryPieceOpen(false);
                }
                return;
            }
        } catch (cloudErr) {
            console.warn('Direct Cloud upsert failed, falling back to API:', cloudErr);
        }

        try {
            const res = await fetchWithAuth('/api/payroll/factory-logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    production_group_id: resolvedGroupId,
                    group_name: groupToSave,
                    period_start: periodStart,
                    period_end: periodEnd,
                    rows: updatedRows
                })
            });
            if (res.ok) {
                const result = await res.json();
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    if (selectedGroupRef.current === groupToSave) {
                        setFactoryRows(result.data);
                    }
                    try {
                        localStorage.setItem(`hris_factory_piece_rows_${groupToSave}`, JSON.stringify(result.data));
                    } catch (e) { }
                }
            }
        } catch (err) {
            console.error('Cloud sync error:', err);
        }

        if (shouldClose) {
            setSuccess(`Factory piece-rate operations for ${groupToSave} saved successfully.`);
            setTimeout(() => setSuccess(null), 3000);
            setIsFactoryPieceOpen(false);
        }
    };

    // Load active employees and production groups from database
    useEffect(() => {
        let isMounted = true;

        const loadData = async () => {
            try {
                setIsLoadingEmployees(true);

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
                                } catch (e) { }
                            }
                            setEntryMode('batch');
                        } else {
                            setEntryMode('single');
                            setFormData(prev => ({ ...prev, employee_id: String(targetEmp.id) }));
                        }
                    } else {
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

    const loadFactoryLogs = async (groupName, start, end) => {
        if (!groupName) return;
        const groups = productionGroupsRef.current || productionGroups;
        let groupObj = groups.find(g => g.name === groupName);
        let resolvedGroupId = groupObj?.id || null;

        if (!resolvedGroupId && groupName) {
            try {
                const { data: grp } = await supabase
                    .from('production_groups')
                    .select('id')
                    .ilike('name', groupName.trim())
                    .maybeSingle();
                if (grp?.id) resolvedGroupId = grp.id;
            } catch (e) { }
        }

        try {
            let query = supabase.from('factory_production_logs').select('*');
            if (resolvedGroupId) {
                query = query.eq('production_group_id', resolvedGroupId);
            }
            if (start && end) {
                query = query.eq('period_start', start).eq('period_end', end);
            }

            let { data, error } = await query.order('created_at', { ascending: true });

            if ((!data || data.length === 0) && resolvedGroupId) {
                const { data: latestData } = await supabase
                    .from('factory_production_logs')
                    .select('*')
                    .eq('production_group_id', resolvedGroupId)
                    .order('updated_at', { ascending: false })
                    .order('period_end', { ascending: false })
                    .limit(30);

                if (latestData && latestData.length > 0) {
                    const seenOps = new Set();
                    const uniqueLatest = [];
                    for (const row of latestData) {
                        if (!seenOps.has(row.operation)) {
                            seenOps.add(row.operation);
                            uniqueLatest.push(row);
                        }
                    }
                    data = uniqueLatest;
                }
            }

            if (!error && data && data.length > 0) {
                const rows = data.map(r => ({
                    id: r.id,
                    operation: r.operation,
                    stock_no: r.stock_no || 'Formal',
                    quantity_in: String(r.quantity_in ?? 0),
                    amount: String(r.amount ?? 0),
                    assignedEmployeeIds: Array.isArray(r.assigned_worker_ids) ? r.assigned_worker_ids : []
                }));
                if (selectedGroupRef.current === groupName) {
                    setFactoryRows(rows);
                }
                try {
                    localStorage.setItem(`hris_factory_piece_rows_${groupName}`, JSON.stringify(rows));
                } catch (e) { }
                return;
            }
        } catch (cloudErr) {
            console.warn('Direct Cloud fetch failed, falling back to API:', cloudErr);
        }

        const groupIdParam = resolvedGroupId ? `&production_group_id=${resolvedGroupId}` : '';
        try {
            const res = await fetchWithAuth(
                `/api/payroll/factory-logs?group_name=${encodeURIComponent(groupName)}&period_start=${start}&period_end=${end}${groupIdParam}`
            );
            if (res.ok) {
                const json = await res.json();
                if (json.success && Array.isArray(json.data) && json.data.length > 0) {
                    if (selectedGroupRef.current === groupName) {
                        setFactoryRows(json.data);
                    }
                    try {
                        localStorage.setItem(`hris_factory_piece_rows_${groupName}`, JSON.stringify(json.data));
                    } catch (e) { }
                }
            }
        } catch (err) {
            console.error('Error fetching factory production logs:', err);
        }
    };

    const handleGroupTabChange = (groupName) => {
        if (selectedGroup === groupName) {
            return;
        }
        setSelectedGroup(groupName);
        selectedGroupRef.current = groupName;
        const membersOfGroup = factoryEmployees.filter(e => e.group === groupName);
        setSelectedGroupMemberIds(membersOfGroup.map(e => String(e.id)));

        let loadedFromLocal = false;
        try {
            const saved = localStorage.getItem(`hris_factory_piece_rows_${groupName}`);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setFactoryRows(parsed);
                    loadedFromLocal = true;
                }
            }
        } catch (e) { }

        if (!loadedFromLocal) {
            setFactoryRows(DEFAULT_FACTORY_ROWS.map(r => ({ ...r })));
        }

        loadFactoryLogs(groupName, periodStart, periodEnd);
    };

    useEffect(() => {
        if (selectedGroup) {
            loadFactoryLogs(selectedGroup, periodStart, periodEnd);
        }
    }, [periodStart, periodEnd, selectedGroup]);

    // Realtime Supabase Subscription for multi-client zero-latency sync
    useEffect(() => {
        const channel = supabase
            .channel('realtime_factory_production_logs_sync')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'factory_production_logs'
                },
                (payload) => {
                    if (!payload) return;
                    const { eventType, new: updatedRow, old: oldRow } = payload;
                    const currentGroup = selectedGroupRef.current;
                    const groups = productionGroupsRef.current || [];
                    const activeGroupObj = groups.find(g => g.name === currentGroup);
                    const activeGroupId = activeGroupObj?.id;

                    const rowGroupId = updatedRow?.production_group_id || oldRow?.production_group_id;

                    // If the change applies to the currently active group or if no specific group is selected
                    const isForActiveGroup = !activeGroupId || !rowGroupId || activeGroupId === rowGroupId;

                    if (isForActiveGroup) {
                        if (eventType === 'DELETE' && oldRow?.id) {
                            setFactoryRows(prev => prev.filter(r => String(r.id) !== String(oldRow.id)));
                        } else if ((eventType === 'UPDATE' || eventType === 'INSERT') && updatedRow) {
                            setFactoryRows(prev => {
                                const isMatch = (r) =>
                                    String(r.id) === String(updatedRow.id) ||
                                    (r.operation && updatedRow.operation && r.operation.trim().toLowerCase() === updatedRow.operation.trim().toLowerCase());

                                const rowExists = prev.some(isMatch);
                                let next;
                                if (rowExists) {
                                    next = prev.map(r => {
                                        if (isMatch(r)) {
                                            return {
                                                ...r,
                                                id: updatedRow.id,
                                                operation: updatedRow.operation || r.operation,
                                                stock_no: updatedRow.stock_no || r.stock_no,
                                                quantity_in: String(updatedRow.quantity_in ?? r.quantity_in),
                                                amount: String(updatedRow.amount ?? r.amount),
                                                assignedEmployeeIds: Array.isArray(updatedRow.assigned_worker_ids)
                                                    ? updatedRow.assigned_worker_ids
                                                    : (r.assignedEmployeeIds || [])
                                            };
                                        }
                                        if (updatedRow.stock_no && r.stock_no !== updatedRow.stock_no) {
                                            return { ...r, stock_no: updatedRow.stock_no };
                                        }
                                        return r;
                                    });
                                } else {
                                    next = [...prev, {
                                        id: updatedRow.id,
                                        operation: updatedRow.operation,
                                        stock_no: updatedRow.stock_no || 'Formal',
                                        quantity_in: String(updatedRow.quantity_in ?? 0),
                                        amount: String(updatedRow.amount ?? 0),
                                        assignedEmployeeIds: Array.isArray(updatedRow.assigned_worker_ids)
                                            ? updatedRow.assigned_worker_ids
                                            : []
                                    }];
                                }
                                if (currentGroup) {
                                    try {
                                        localStorage.setItem(`hris_factory_piece_rows_${currentGroup}`, JSON.stringify(next));
                                    } catch (e) { }
                                }
                                return next;
                            });
                        }
                    } else if (rowGroupId) {
                        // Background-sync cache for other production group if edited remotely
                        const targetGroupObj = groups.find(g => g.id === rowGroupId);
                        if (targetGroupObj?.name) {
                            try {
                                const cacheKey = `hris_factory_piece_rows_${targetGroupObj.name}`;
                                const cached = localStorage.getItem(cacheKey);
                                if (cached) {
                                    const parsed = JSON.parse(cached);
                                    if (Array.isArray(parsed)) {
                                        const next = parsed.map(r => {
                                            if (String(r.id) === String(updatedRow?.id) || (r.operation && updatedRow?.operation && r.operation.trim().toLowerCase() === updatedRow.operation.trim().toLowerCase())) {
                                                return {
                                                    ...r,
                                                    id: updatedRow.id,
                                                    operation: updatedRow.operation || r.operation,
                                                    stock_no: updatedRow.stock_no || r.stock_no,
                                                    quantity_in: String(updatedRow.quantity_in ?? r.quantity_in),
                                                    amount: String(updatedRow.amount ?? r.amount),
                                                    assignedEmployeeIds: Array.isArray(updatedRow.assigned_worker_ids) ? updatedRow.assigned_worker_ids : []
                                                };
                                            }
                                            if (updatedRow?.stock_no && r.stock_no !== updatedRow.stock_no) {
                                                return { ...r, stock_no: updatedRow.stock_no };
                                            }
                                            return r;
                                        });
                                        localStorage.setItem(cacheKey, JSON.stringify(next));
                                    }
                                }
                            } catch (e) { }
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

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

    const handleStartDateChange = (val) => {
        let dateStr = '';
        if (typeof val === 'string') {
            dateStr = val;
        } else if (Array.isArray(val) && val[0]) {
            dateStr = formatLocalDate(val[0]);
        } else if (val instanceof Date) {
            dateStr = formatLocalDate(val);
        }
        if (!dateStr) return;
        setActivePreset('custom');
        setPeriodStart(dateStr);

        if (includeWeekends) {
            const date = new Date(dateStr + 'T00:00:00');
            if (!isNaN(date.getTime())) {
                const end = new Date(date);
                end.setDate(date.getDate() + 6);
                setPeriodEnd(formatLocalDate(end));
            }
        }
    };

    const handleEndDateChange = (val) => {
        let dateStr = '';
        if (typeof val === 'string') {
            dateStr = val;
        } else if (Array.isArray(val) && val[0]) {
            dateStr = formatLocalDate(val[0]);
        } else if (val instanceof Date) {
            dateStr = formatLocalDate(val);
        }
        if (!dateStr) return;
        setActivePreset('custom');
        setPeriodEnd(dateStr);

        if (includeWeekends) {
            const date = new Date(dateStr + 'T00:00:00');
            if (!isNaN(date.getTime())) {
                const start = new Date(date);
                start.setDate(date.getDate() - 6);
                setPeriodStart(formatLocalDate(start));
            }
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
            const baseAmt = parseFloat(row.amount) || 0;
            const effectiveAmt = baseAmt * holidayRateMultiplier;
            const totalPrice = qty * effectiveAmt;

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
                amt: baseAmt,
                effectiveAmt,
                totalPrice,
                effectiveAssignedIds,
                perWorkerShare: effectiveAssignedIds.length > 0 ? totalPrice / effectiveAssignedIds.length : 0
            };
        });
    }, [factoryRows, activeGroupEmployees, activeGroupEmployeeIdSet, holidayRateMultiplier]);

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
                        amt: row.effectiveAmt,
                        baseAmt: row.amt,
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
                const monthlyEquiv = gross * 4;

                const sssBase = Math.min(monthlyEquiv, 35000);
                const monthlySss = sssBase * 0.05;
                sss = parseFloat((monthlySss / 4).toFixed(2));

                const phBase = Math.min(Math.max(monthlyEquiv, 10000), 100000);
                const monthlyPhilHealth = (phBase * 0.05) / 2;
                philHealth = parseFloat((monthlyPhilHealth / 4).toFixed(2));

                const monthlyPagIbig = Math.min(monthlyEquiv * 0.02, 100);
                pagIbig = parseFloat((monthlyPagIbig / 4).toFixed(2));

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

    // Retrieve full rate breakdown (Hourly & Daily Rates)
    const employeeRates = useMemo(() => {
        return getEmployeeRates(selectedEmployee);
    }, [selectedEmployee]);

    const regularHourlyRate = employeeRates.hourlyRate;

    const estimatedOtPay = useMemo(() => {
        const otHours = parseFloat(formData.overtime_hours) || 0;
        return otHours * regularHourlyRate * 1.25;
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

        const calculatePayroll = async () => {
            setIsCalculating(true);
            try {
                const attendanceRes = await fetchWithAuth(
                    `/api/attendance?employee_id=${formData.employee_id}&start_date=${periodStart}&end_date=${periodEnd}`
                );
                const rawLogs = await attendanceRes.json();
                const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs.data || rawLogs.logs || []);

                const gracePeriodMins = 120; // 2-Hour Late Rule threshold
                const { hourlyRate, dailyRate } = employeeRates;
                const perMinuteRate = hourlyRate / 60;

                let adjustments = 0;
                let calculatedOtHours = 0;
                let totalLateMinutes = 0;
                const workedDatesSet = new Set();

                const completedLogs = Array.isArray(logs) ? logs.filter(l => l && l.time_out && l.time_in) : [];

                completedLogs.forEach(log => {
                    const dateStr = extractDateStr(log.date || log.time_in);
                    if (dateStr) workedDatesSet.add(dateStr);

                    const timeIn = parseDate(log.time_in);
                    const timeOut = parseDate(log.time_out);

                    if (timeIn && dateStr) {
                        const scheduleStart = new Date(`${dateStr}T08:00:00`);
                        if (!isNaN(scheduleStart.getTime()) && timeIn > scheduleStart) {
                            const minutes = Math.floor((timeIn - scheduleStart) / 60000);
                            if (minutes > 0) {
                                totalLateMinutes += minutes;
                                if (minutes >= gracePeriodMins) {
                                    // 2-Hour Rule: Lateness >= 2 hrs (120+ mins): payment converts to HOURLY rate for actual hours worked
                                    const lateHours = minutes / 60;
                                    const workedHours = Math.max(0, 8 - lateHours);
                                    const earnedHourlyPay = workedHours * hourlyRate;
                                    const dayLoss = Math.max(0, dailyRate - earnedHourlyPay);
                                    adjustments += dayLoss;
                                } else if (perMinuteRate > 0) {
                                    // < 2 Hours Late (< 120 mins): Standard per-minute deduction against standard basic pay
                                    adjustments += (minutes * perMinuteRate);
                                }
                            }
                        }
                    }

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

                if (isMounted) {
                    setFormData(prev => ({
                        ...prev,
                        days_worked: daysWorked,
                        late_minutes: totalLateMinutes,
                        overtime_hours: calculatedOtHours > 0 ? calculatedOtHours.toString() : prev.overtime_hours,
                        late_deductions: adjustments > 0 ? adjustments.toFixed(2) : (prev.late_deductions || '0.00')
                    }));
                }
            } catch (err) {
                console.error('Calculation error:', err);
            } finally {
                if (isMounted) setIsCalculating(false);
            }
        };

        calculatePayroll();
        return () => { isMounted = false; };
    }, [entryMode, formData.employee_id, periodStart, periodEnd, selectedEmployee, employeeRates, isInvalidDateRange]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

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
                    holiday_rate_multiplier: holidayRateMultiplier,
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
                late_minutes: Number(formData.late_minutes) || 0,
                hourly_rate: employeeRates.hourlyRate,
                daily_rate: employeeRates.dailyRate,
                paid_leave_days: totalPaidLeaveDays,
                paid_leave_pay: parseFloat((totalPaidLeaveDays * employeeRates.dailyRate).toFixed(2)),
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

                {/* Automatic Holiday Banner Indicator */}
                {holidayPreview.items.length > 0 && (
                    <div className="mb-6 bg-gradient-to-r from-amber-50 via-amber-50/70 to-amber-100/50 border border-amber-200/80 p-3.5 sm:p-4 rounded-2xl shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
                                <i className="ti ti-calendar-event"></i>
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-xs sm:text-sm font-extrabold text-amber-950">
                                        Automatic Holiday Rate Adjustment Active
                                    </h4>
                                    <span className="text-[10px] font-black bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md">
                                        +{(holidayRateMultiplier * 100 - 100).toFixed(0)}% Rate Premium
                                    </span>
                                </div>
                                <p className="text-xs text-amber-800 mt-0.5 truncate">
                                    Holidays: {holidayPreview.items.map(h => `${h.holidayName} (${formatReadableDate(h.date)})`).join(', ')}
                                </p>
                            </div>
                        </div>
                        <div className="self-end sm:self-center shrink-0">
                            <span className="text-xs font-mono font-bold text-amber-900 bg-white/80 border border-amber-200 px-3 py-1 rounded-xl shadow-2xs">
                                Rate Multiplier: {holidayRateMultiplier.toFixed(2)}x
                            </span>
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
                        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                            <div className="flex items-center justify-between mb-2 gap-1">
                                <label htmlFor="cutoff-start-date" className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 truncate cursor-pointer">
                                    <i className="ti ti-calendar-event text-blue-600 text-sm shrink-0"></i> Start Date
                                </label>
                                <span className="text-[10px] sm:text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md shrink-0 font-mono">
                                    {formatReadableDate(periodStart)}
                                </span>
                            </div>
                            <input
                                id="cutoff-start-date"
                                type="date"
                                value={periodStart}
                                onChange={(e) => handleStartDateChange(e.target.value)}
                                className="w-full p-2.5 min-h-[44px] bg-slate-50 hover:bg-white focus:bg-white text-slate-800 font-bold rounded-lg border border-slate-200 focus:border-blue-500 outline-none transition-all text-sm sm:text-base cursor-pointer"
                            />
                        </div>

                        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100 transition-all">
                            <div className="flex items-center justify-between mb-2 gap-1">
                                <label htmlFor="cutoff-end-date" className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 truncate cursor-pointer">
                                    <i className="ti ti-flag text-emerald-600 text-sm shrink-0"></i> End Date
                                </label>
                                <span className="text-[10px] sm:text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md shrink-0 font-mono">
                                    {formatReadableDate(periodEnd)}
                                </span>
                            </div>
                            <input
                                id="cutoff-end-date"
                                type="date"
                                value={periodEnd}
                                onChange={(e) => handleEndDateChange(e.target.value)}
                                className="w-full p-2.5 min-h-[44px] bg-slate-50 hover:bg-white focus:bg-white text-slate-800 font-bold rounded-lg border border-slate-200 focus:border-emerald-500 outline-none transition-all text-sm sm:text-base cursor-pointer"
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
                    holidayRateMultiplier={holidayRateMultiplier}
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

                        {/* Executive KPI Summary Ribbon */}
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

                                    <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
                                        <div className="flex items-center bg-slate-200/70 p-0.5 rounded-xl text-[11px] font-bold">
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownFilter('all')}
                                                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${breakdownFilter === 'all'
                                                    ? 'bg-white text-blue-700 shadow-2xs'
                                                    : 'text-slate-600 hover:text-slate-900'
                                                    }`}
                                            >
                                                All ({activeGroupEmployees.length})
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownFilter('payable')}
                                                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${breakdownFilter === 'payable'
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
                                                    className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${breakdownFilter === 'unassigned'
                                                        ? 'bg-white text-amber-700 shadow-2xs'
                                                        : 'text-slate-600 hover:text-slate-900'
                                                        }`}
                                                >
                                                    No Ops ({batchSummaryTotals.zeroCount})
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center bg-slate-200/70 p-0.5 rounded-xl">
                                            <button
                                                type="button"
                                                onClick={() => setBreakdownViewMode('table')}
                                                title="Roster Table View"
                                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${breakdownViewMode === 'table'
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
                                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${breakdownViewMode === 'cards'
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
                                                                            {holidayRateMultiplier > 1 && (
                                                                                <span className="text-[8px] font-bold text-amber-700 bg-amber-100 px-1 rounded">
                                                                                    {holidayRateMultiplier.toFixed(1)}x
                                                                                </span>
                                                                            )}
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
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {filteredGroupEmployees.map((worker) => (
                                        <WorkerPayrollCard
                                            key={worker.id}
                                            worker={worker}
                                            workerData={workerPayrollMap[String(worker.id)]}
                                            holidayRateMultiplier={holidayRateMultiplier}
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
                                                    ₱{employeeRates.dailyRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}/day &middot; ₱{employeeRates.hourlyRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}/hr
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

                        {/* Leave with Pay Details Banner */}
                        {selectedEmployee && (
                            <div className="bg-emerald-50/70 border border-emerald-200 p-4 sm:p-5 rounded-2xl space-y-3">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-base shadow-sm shrink-0">
                                            <i className="ti ti-calendar-off" />
                                        </div>
                                        <div>
                                            <h4 className="text-xs sm:text-sm font-extrabold text-emerald-950 flex items-center gap-2">
                                                <span>Leave with Pay Status</span>
                                                {isLoadingLeaves ? (
                                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full animate-pulse">
                                                        Checking leaves...
                                                    </span>
                                                ) : paidLeaves.length > 0 ? (
                                                    <span className="text-[10px] font-black text-white bg-emerald-600 px-2 py-0.5 rounded-full">
                                                        {totalPaidLeaveDays} Day{totalPaidLeaveDays > 1 ? 's' : ''} Leave with Pay
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-bold text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded-full">
                                                        No Leave with Pay in Cutoff
                                                    </span>
                                                )}
                                            </h4>
                                            <p className="text-[11px] text-emerald-800 font-medium">
                                                Approved leave with pay records overlapping this cutoff period ({formatReadableDate(periodStart)} – {formatReadableDate(periodEnd)})
                                            </p>
                                        </div>
                                    </div>

                                    {paidLeaves.length > 0 && employeeRates.dailyRate > 0 && (
                                        <div className="bg-white border border-emerald-200 px-3 py-1.5 rounded-xl shadow-2xs font-mono text-xs text-right">
                                            <span className="text-[10px] text-emerald-700 font-bold block uppercase">Est. Leave Pay</span>
                                            <span className="font-extrabold text-emerald-700">
                                                +₱{(totalPaidLeaveDays * employeeRates.dailyRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {paidLeaves.length > 0 && (
                                    <div className="space-y-2 pt-1">
                                        {paidLeaves.map((leave, idx) => (
                                            <div key={idx} className="bg-white p-3 rounded-xl border border-emerald-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                                <div className="min-w-0 space-y-0.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-emerald-900">
                                                            {leave.leave_type || leave.type || 'Paid Leave'}
                                                        </span>
                                                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md">
                                                            Approved &bull; Leave with Pay
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-500 font-medium">
                                                        Period: <span className="font-semibold text-slate-700">{formatReadableDate(extractDateStr(leave.start_date || leave.from_date || leave.date))}</span>
                                                        {(leave.end_date || leave.to_date) && extractDateStr(leave.end_date || leave.to_date) !== extractDateStr(leave.start_date || leave.from_date || leave.date) ? (
                                                            <> &rarr; <span className="font-semibold text-slate-700">{formatReadableDate(extractDateStr(leave.end_date || leave.to_date))}</span></>
                                                        ) : ''}
                                                        {leave.reason ? ` — "${leave.reason}"` : ''}
                                                    </p>
                                                </div>
                                                <div className="shrink-0 text-right font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
                                                    {leave.days || leave.duration || leave.number_of_days || 1} Paid Day(s)
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Attendance Logged & Overtime Hours */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs sm:text-sm font-bold text-slate-800">Attendance Logged</h3>
                                {isCalculating && (
                                    <div className="text-xs font-semibold text-blue-600 flex items-center gap-1.5 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100">
                                        <i className="ti ti-loader animate-spin text-sm"></i> Calculating...
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

                                <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 flex flex-col justify-between">
                                    <div>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className="block text-xs font-bold text-emerald-800 uppercase flex items-center gap-1">
                                                <i className="ti ti-calendar-check text-sm" /> Leave with Pay
                                            </label>
                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                                Approved
                                            </span>
                                        </div>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={totalPaidLeaveDays}
                                            readOnly
                                            className="w-full p-3 bg-white border border-emerald-200 rounded-xl font-mono text-lg font-black text-emerald-800 outline-none"
                                        />
                                        <p className="text-[10px] text-emerald-700 font-medium mt-1">
                                            {totalPaidLeaveDays > 0 ? `${totalPaidLeaveDays} day(s) paid leave detected` : 'No paid leave this cutoff'}
                                        </p>
                                    </div>
                                </div>

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

                        {/* Holiday Pay Preview (DOLE) */}
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
                            <div className="flex items-center justify-between">
                                <label className="block text-xs font-bold text-red-600 uppercase">Late Deductions / Tardiness (₱)</label>
                                {Number(formData.late_minutes) > 0 && (
                                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                                        Number(formData.late_minutes) >= 120 
                                            ? 'bg-amber-100 text-amber-800 border border-amber-300' 
                                            : 'bg-red-100 text-red-700'
                                    }`}>
                                        {formData.late_minutes} mins late {Number(formData.late_minutes) >= 120 ? '(≥ 2 hrs: Hourly Pay Rule)' : '(< 2 hrs: Per-Min Deduction)'}
                                    </span>
                                )}
                            </div>
                            <input
                                type="number"
                                step="0.01"
                                name="late_deductions"
                                value={formData.late_deductions}
                                onChange={handleInputChange}
                                className="w-full p-3 bg-white border border-red-200 rounded-xl font-mono text-red-600 text-lg font-bold outline-none"
                                placeholder="0.00"
                            />
                            {Number(formData.late_minutes) >= 120 && (
                                <p className="text-[11px] text-amber-700 font-medium">
                                    <i className="ti ti-info-circle mr-1" />
                                    Regular Policy: Lateness of 2+ hours converts shift earnings to actual worked hours ({Math.max(0, 8 - (Number(formData.late_minutes) / 60)).toFixed(1)} hrs @ ₱{employeeRates.hourlyRate.toFixed(2)}/hr).
                                </p>
                            )}
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
                            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                                {availableDepartments.map((dept) => (
                                    <button
                                        key={dept}
                                        type="button"
                                        onClick={() => setSelectedDeptFilter(dept)}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${selectedDeptFilter === dept ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        {dept}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="overflow-y-auto p-2.5 space-y-1.5">
                            {filteredEmployees.length === 0 ? (
                                <p className="text-center text-slate-400 text-xs py-8">No regular employees found.</p>
                            ) : (
                                filteredEmployees.map((emp) => (
                                    <button
                                        key={emp.id}
                                        type="button"
                                        onClick={() => {
                                            setFormData(prev => ({ ...prev, employee_id: String(emp.id) }));
                                            setIsEmpModalOpen(false);
                                        }}
                                        className="w-full p-2.5 hover:bg-blue-50/60 rounded-2xl flex items-center justify-between text-left transition-colors cursor-pointer group border border-transparent hover:border-blue-100"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <EmployeeAvatar employee={emp} size="h-9 w-9" rounded="rounded-xl" textSize="text-xs" />
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-800 group-hover:text-blue-700 transition-colors truncate">
                                                    {emp.first_name} {emp.last_name}
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-semibold uppercase truncate">
                                                    {getEmployeeDept(emp)} &middot; {emp.job_title || emp.position || 'Employee'}
                                                </p>
                                            </div>
                                        </div>
                                        <i className="ti ti-chevron-right text-slate-300 group-hover:text-blue-600 transition-colors"></i>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PayrollCreate;