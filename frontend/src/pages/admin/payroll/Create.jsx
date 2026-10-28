import { calculateBIRWithholdingTax } from '../../../../../shared/payrollTax.mjs';
import { getSssMsc } from '../../../../../shared/sssContribution.mjs';
import { PAYROLL_NUMBER_LIMITS, isBoundedDecimalInput } from '../../../../../shared/inputLimits.mjs';
import { isFirstCutoffOfMonth } from '../../../../../shared/statutoryTiming.mjs';
import { isLastCutoffOfDecember } from '../../../../../shared/thirteenthMonth.mjs';
import { getUser } from '../../../routes/guards';
import { getEmployeeRestDays, getScheduledWorkDates, calculateTardiness, DEFAULT_WORK_POLICY } from '../../../../../shared/workPolicy.mjs';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import FactoryPiece from './FactoryPiece';
import { factorySaveResult } from '../../../utils/factorySaveResult.mjs';
import BackButton from '../../../components/ui/BackButton';

// Payroll utilities & constants
import { parseDate, extractDateStr, formatLocalDate, formatReadableDate, getEmployeeDept, isFactoryDept, getEmployeeRates, matchJobTitle, loadPayrollAttendance } from './utils/payrollHelpers';

// Subcomponents
import CutoffPeriodSelector from './components/CutoffPeriodSelector';
import FactoryBatchSection from './components/FactoryBatchSection';
import AbsenteeOutputModal from './components/AbsenteeOutputModal';
import SinglePayrollSection from './components/SinglePayrollSection';
import GroupSelectionModal from './components/GroupSelectionModal';
import EmployeeSelectionModal from './components/EmployeeSelectionModal';

// The client works a 5-day week (Mon-Fri), so the weekly payroll cutoff is exactly 5 days:
// the end date is always the start date + 4 days and a cutoff can never be longer than 5 days.
const MAX_CUTOFF_DAYS = 5;
const CUTOFF_SPAN_DAYS = MAX_CUTOFF_DAYS - 1;

// Keeps a typed amount to digits and one decimal point (no minus sign, no letters).
const sanitizeAmount = (value) => {
    const cleaned = String(value ?? '').replace(/[^0-9.]/g, '');
    const [whole, ...decimals] = cleaned.split('.');
    return decimals.length > 0 ? `${whole}.${decimals.join('')}` : whole;
};

// Contractual daily rate of a piece-rate worker (same precedence as the server: daily, then hourly x 8).
// Piece rate is per piece, so it is never used to derive a daily rate.


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

    // Attendance-Based Proration for Factory Batch Payout
    // Maps employee_id -> { daysPresent, daysInPeriod } for the current cutoff period.
    // Used so a worker's piece-rate share reflects days actually present, not a flat
    // equal split across everyone assigned to an operation.
    const [groupAttendanceMap, setGroupAttendanceMap] = useState({});
    const [groupTardinessMap, setGroupTardinessMap] = useState({});
    const [attendanceRefreshTick, setAttendanceRefreshTick] = useState(0);
    const [attendanceError, setAttendanceError] = useState(null);
    const [workPolicy, setWorkPolicy] = useState(DEFAULT_WORK_POLICY);
    // employee_id -> list of dates (YYYY-MM-DD) the worker actually clocked in and out on
    const [groupWorkedDatesMap, setGroupWorkedDatesMap] = useState({});
    const [isLoadingGroupAttendance, setIsLoadingGroupAttendance] = useState(false);
    // Auto-detected overtime hours per date (single mode). Holiday dates are removed before filling the form.
    const [autoOtByDate, setAutoOtByDate] = useState({});

    // Absentee output declaration.
    // Shape: { [employeeId]: { [factoryRowId]: quantityString } }
    // When a worker misses even one day of the cutoff, HR must declare the quantity
    // that worker actually finished per operation. That quantity x the price rate is
    // the worker's own pay, and it is carved out of the operation's total price before
    // the remainder is split among the workers who were present.
    const [absenteeOutputs, setAbsenteeOutputs] = useState({});
    const [isAbsenteeModalOpen, setIsAbsenteeModalOpen] = useState(false);

    // Breakdown UI Friendly Mode: 'table' | 'cards'
    const [breakdownViewMode, setBreakdownViewMode] = useState('table');
    const [breakdownSearch, setBreakdownSearch] = useState('');
    const [breakdownFilter, setBreakdownFilter] = useState('all');

    // Prefill form values from location state or URL params
    const [initialPrefill] = useState(() => ({
        employee_id: location.state?.employee_id ?? searchParams.get('employee_id') ?? '',
        period_start: location.state?.period_start ?? searchParams.get('period_start') ?? '',
        period_end: location.state?.period_end ?? searchParams.get('period_end') ?? '',
    }));
    const hasPrefilledPeriod = Boolean(initialPrefill.period_start && initialPrefill.period_end);
    const [initialCutoff] = useState(() => {
        if (hasPrefilledPeriod) return initialPrefill;
        const start = new Date();
        start.setDate(start.getDate() - (start.getDay() + 6) % 7);
        const end = new Date(start);
        end.setDate(start.getDate() + CUTOFF_SPAN_DAYS);
        return { period_start: formatLocalDate(start), period_end: formatLocalDate(end) };
    });

    // Common Cutoff Dates State
    const [periodStart, setPeriodStart] = useState(() =>
        initialCutoff.period_start
    );
    const [periodEnd, setPeriodEnd] = useState(() =>
        initialCutoff.period_end
    );

    // Stable refs for realtime sync across client sessions
    const selectedGroupRef = useRef(selectedGroup);
    const productionGroupsRef = useRef(productionGroups);
    const periodStartRef = useRef(periodStart);
    const periodEndRef = useRef(periodEnd);
    const lastCalcKeyRef = useRef('');

    useEffect(() => { selectedGroupRef.current = selectedGroup; }, [selectedGroup]);
    useEffect(() => { productionGroupsRef.current = productionGroups; }, [productionGroups]);
    useEffect(() => { periodStartRef.current = periodStart; }, [periodStart]);
    useEffect(() => { periodEndRef.current = periodEnd; }, [periodEnd]);

    // Single Entry Form Data
    const [formData, setFormData] = useState(() => ({
        employee_id: initialPrefill.employee_id,
        days_worked: 0,
        overtime_hours: '',
        rest_day_ot_hours: '',
        late_deductions: '',
        late_minutes: 0,
        allowance: ''
    }));

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
    const [activePreset, setActivePreset] = useState(hasPrefilledPeriod ? 'custom' : 'current_week');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
    const [isCalculating, setIsCalculating] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [holidayPreview, setHolidayPreview] = useState({ items: [], totalHolidayPay: 0 });

    // Dynamic statutory deduction rates and caps loaded from system settings
    const [statutoryRates, setStatutoryRates] = useState({
        sss_employee_rate: 5,
        sss_max_msc: 35000,
        philhealth_rate: 5,
        philhealth_min_salary: 10000,
        philhealth_max_salary: 100000,
        pagibig_employee_rate: 2,
        pagibig_max_contribution: 200
    });
    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const res = await fetchWithAuth('/api/payroll/statutory-settings');
                if (!res.ok) return;
                const data = await res.json().catch(() => null);
                if (!data || !isMounted) return;
                setStatutoryRates(prev => {
                    const next = { ...prev };
                    Object.keys(prev).forEach(key => {
                        const raw = data[key];
                        if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
                            next[key] = Number(raw);
                        }
                    });
                    return next;
                });
            } catch (err) {
                console.error('Failed to load statutory settings, using defaults:', err);
            }
        })();
        return () => { isMounted = false; };
    }, []);
    const [prefillEmployeeMissing, setPrefillEmployeeMissing] = useState(false);
    // Explicit, HR-visible "Generate Holidays" gate — separate from the backend's
    // own silent auto-generation safety net. This lets HR see and confirm the
    // action for a given year, instead of it only ever happening invisibly.
    const [holidayYearStatus, setHolidayYearStatus] = useState({ checked: false, generated: true, year: null });
    const [isGeneratingHolidays, setIsGeneratingHolidays] = useState(false);
    const [justGeneratedHolidays, setJustGeneratedHolidays] = useState(null); // list shown right after a successful click
    const [holidayRefreshTick, setHolidayRefreshTick] = useState(0);

    // Calculate total paid leave days for selected employee
    const totalPaidLeaveDays = useMemo(() => {
        if (!paidLeaves || paidLeaves.length === 0) return 0;
        return paidLeaves.reduce((sum, leave) => {
            const days = parseFloat(leave.days || leave.duration || leave.number_of_days || leave.total_days || 1);
            return sum + (isNaN(days) ? 1 : days);
        }, 0);
    }, [paidLeaves]);

    const leaveScope = `${entryMode}|${formData.employee_id}|${periodStart}|${periodEnd}|${attendanceRefreshTick}`;
    const [previousLeaveScope, setPreviousLeaveScope] = useState(leaveScope);
    if (previousLeaveScope !== leaveScope) {
        setPreviousLeaveScope(leaveScope);
        setPaidLeaves([]);
        setIsLoadingLeaves(Boolean(entryMode === 'single' && formData.employee_id && periodStart && periodEnd));
    }
    // Fetch leave with pay information for selected employee during cutoff
    useEffect(() => {
        if (entryMode !== 'single' || !formData.employee_id || !periodStart || !periodEnd) {
            return;
        }

        let isMounted = true;

        const fetchPaidLeaves = async () => {
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
    }, [entryMode, formData.employee_id, periodStart, periodEnd, attendanceRefreshTick]);

    // Automatic Holiday Detection for Cutoff Period
    const holidayEmployeeId = formData.employee_id || employees[0]?.id || '';
    const holidayScope = `${entryMode}|${holidayEmployeeId}|${periodStart}|${periodEnd}`;
    const [previousHolidayScope, setPreviousHolidayScope] = useState(holidayScope);
    if (previousHolidayScope !== holidayScope) {
        setPreviousHolidayScope(holidayScope);
        setHolidayPreview({ items: [], totalHolidayPay: 0 });
    }
    useEffect(() => {
        const { isInvalidDateRange } = (() => {
            if (!periodStart || !periodEnd) return { isInvalidDateRange: false };
            const s = new Date(periodStart + 'T00:00:00');
            const e = new Date(periodEnd + 'T00:00:00');
            const spanDays = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
            return { isInvalidDateRange: e < s || spanDays > MAX_CUTOFF_DAYS };
        })();

        // FIX: targetEmpId now computed before the guard, and checked
        // alongside periodStart/periodEnd. Previously this could be an
        // empty string (no employee selected yet, employees list not
        // loaded yet) while periodStart/periodEnd were already set from a
        // default preset — the effect still fired and POSTed
        // employee_id: '' to /api/payroll/preview, which the backend
        // correctly rejects with "employee_id, period_start, and
        // period_end are required."
        const targetEmpId = holidayEmployeeId;

        if (!periodStart || !periodEnd || isInvalidDateRange || !targetEmpId) {
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
    }, [periodStart, periodEnd, formData.employee_id, holidayEmployeeId, entryMode, holidayRefreshTick, attendanceRefreshTick]);

    // Explicit holiday-generation status check (no side effects on the backend -
    // this is what lets the reminder banner below actually appear, rather than
    // always finding the year already silently generated by /preview above).
    if (periodStart && justGeneratedHolidays && justGeneratedHolidays.year !== periodStart.slice(0, 4)) {
        setJustGeneratedHolidays(null);
    }
    useEffect(() => {
        if (!periodStart) return;
        const year = periodStart.slice(0, 4);
        let isMounted = true;

        fetchWithAuth(`/api/payroll/holidays/status?year=${year}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (isMounted && data) {
                    setHolidayYearStatus({ checked: true, generated: !!data.generated, year });
                }
            })
            .catch(() => {
                if (isMounted) setHolidayYearStatus({ checked: false, generated: true, year });
            });

        return () => { isMounted = false; };
    }, [periodStart, holidayRefreshTick]);

    const handleGenerateHolidaysNow = async () => {
        if (!holidayYearStatus.year) return;
        setIsGeneratingHolidays(true);
        try {
            const res = await fetchWithAuth('/api/payroll/holidays/generate', {
                method: 'POST',
                body: JSON.stringify({ year: Number(holidayYearStatus.year) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Failed to generate holidays.');
            }
            setHolidayYearStatus((prev) => ({ ...prev, generated: true }));
            setHolidayRefreshTick((t) => t + 1); // re-run the /preview fetch above so the rate banner updates too
            setJustGeneratedHolidays({
                year: holidayYearStatus.year,
                inserted: Array.isArray(data.inserted) ? data.inserted : [],
                skippedExisting: data.skipped_existing || 0,
                reminder: data.reminder || '',
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsGeneratingHolidays(false);
        }
    };

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
        } catch { /* Best-effort browser cache or fallback lookup. */ }

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
            } catch { /* Best-effort browser cache or fallback lookup. */ }
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
                    total_amount: parseFloat((qty * baseAmt).toFixed(2)),
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
                } catch { /* Best-effort browser cache or fallback lookup. */ }

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
            const result = await res.json();
            factorySaveResult(res, result);
            if (res.ok) {
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    if (selectedGroupRef.current === groupToSave) {
                        setFactoryRows(result.data);
                    }
                    try {
                        localStorage.setItem(`hris_factory_piece_rows_${groupToSave}`, JSON.stringify(result.data));
                    } catch { /* Best-effort browser cache or fallback lookup. */ }
                }
            }
        } catch (err) {
            console.error('Cloud sync error:', err);
            setError(err.message || 'Factory records were not saved. Keep the form open and retry when connected.');
            throw err;
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
                                } catch { /* Best-effort browser cache or fallback lookup. */ }
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
    }, [queryClient, initialPrefill.employee_id]);

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

    const loadFactoryLogs = useCallback(async (groupName, start, end) => {
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
            } catch { /* Best-effort browser cache or fallback lookup. */ }
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
                } catch { /* Best-effort browser cache or fallback lookup. */ }
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
                    } catch { /* Best-effort browser cache or fallback lookup. */ }
                }
            }
        } catch (err) {
            console.error('Error fetching factory production logs:', err);
        }
    }, [productionGroups]);

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
        } catch { /* Best-effort browser cache or fallback lookup. */ }

        if (!loadedFromLocal) {
            setFactoryRows(DEFAULT_FACTORY_ROWS.map(r => ({ ...r })));
        }

        loadFactoryLogs(groupName, periodStart, periodEnd);
    };

    useEffect(() => {
        if (selectedGroup) {
            loadFactoryLogs(selectedGroup, periodStart, periodEnd);
        }
    }, [periodStart, periodEnd, selectedGroup, loadFactoryLogs]);

    // Realtime Supabase subscription for multi-client sync
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
                                    } catch { /* Best-effort browser cache or fallback lookup. */ }
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
                            } catch { /* Best-effort browser cache or fallback lookup. */ }
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



    // The end date is always derived from the start date (start + 4 days), so it is
    // never edited directly and a cutoff can't drift away from the weekly length.
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

        const date = new Date(dateStr + 'T00:00:00');
        if (!isNaN(date.getTime())) {
            const end = new Date(date);
            end.setDate(date.getDate() + CUTOFF_SPAN_DAYS);
            setPeriodEnd(formatLocalDate(end));
        }
    };

    const { periodDaysCount, isInvalidDateRange, isRangeTooLong } = useMemo(() => {
        const none = { periodDaysCount: 0, isInvalidDateRange: false, isRangeTooLong: false };
        if (!periodStart || !periodEnd) return none;
        const s = new Date(periodStart + 'T00:00:00');
        const e = new Date(periodEnd + 'T00:00:00');
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return none;
        if (e < s) return { periodDaysCount: 0, isInvalidDateRange: true, isRangeTooLong: false };
        const count = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
        // A cutoff longer than MAX_CUTOFF_DAYS is treated as invalid so every existing
        // guard (previews, batch math, submit buttons) blocks it automatically.
        const tooLong = count > MAX_CUTOFF_DAYS;
        return { periodDaysCount: count, isInvalidDateRange: tooLong, isRangeTooLong: tooLong };
    }, [periodStart, periodEnd]);

    // Factory Batch: fetch each active worker's attendance for the cutoff period
    // so piece-rate shares can be prorated by days present instead of a flat equal split.
    useEffect(() => {
        if (entryMode !== 'batch' || activeGroupEmployees.length === 0 || !periodStart || !periodEnd || isInvalidDateRange) {
            return;
        }

        let isMounted = true;

        const controller = new AbortController();
        const loadGroupAttendance = async () => {
            setIsLoadingGroupAttendance(true);
            setAttendanceError(null);
            // Drop the previous cutoff's attendance so stale days are never applied to the new fetch
            setGroupAttendanceMap({});
            setGroupWorkedDatesMap({});
            setGroupTardinessMap({});
            try {
                const results = await Promise.all(
                    activeGroupEmployees.map(async (emp) => {
                        const empId = String(emp.id);
                        const { logs, workPolicy: policy } = await loadPayrollAttendance(empId, periodStart, periodEnd, controller.signal);
                        const restDays = getEmployeeRestDays(emp);
                        const completedLogs = logs.filter(log => log && log.time_out && log.time_in);
                        const workedDatesSet = new Set(completedLogs.map(log => extractDateStr(log.date || log.time_in)).filter(Boolean));
                        return { empId, daysPresent: workedDatesSet.size, workedDates: Array.from(workedDatesSet), tardiness: calculateTardiness(logs, policy, restDays) };
                    })
                );

                if (isMounted) {
                    const map = {};
                    const datesMap = {};
                    const tardinessMap = {};
                    results.forEach(r => {
                        map[r.empId] = r.daysPresent;
                        datesMap[r.empId] = r.workedDates || [];
                        tardinessMap[r.empId] = r.tardiness;
                    });
                    setGroupAttendanceMap(map);
                    setGroupWorkedDatesMap(datesMap);
                    setGroupTardinessMap(tardinessMap);
                }
            } catch (err) {
                if (isMounted && err.name !== 'AbortError') setAttendanceError(err.message || 'Cannot load group attendance.');
            } finally {
                if (isMounted) setIsLoadingGroupAttendance(false);
            }
        };

        loadGroupAttendance();

        return () => { isMounted = false; controller.abort(); };
    }, [entryMode, activeGroupEmployees, periodStart, periodEnd, isInvalidDateRange, attendanceRefreshTick]);

    const activeGroupEmployeeIdSet = useMemo(() => {
        return new Set(activeGroupEmployees.map(e => String(e.id)));
    }, [activeGroupEmployees]);

    const leavePayEmployeeIds = useMemo(() => entryMode === 'single' ? (formData.employee_id ? [formData.employee_id] : []) : activeGroupEmployees.map(employee => employee.id).sort(), [entryMode, formData.employee_id, activeGroupEmployees]);
    const leavePayPreview = useQuery({
        queryKey: ['payrollLeavePay', getUser()?.id, leavePayEmployeeIds, periodStart, periodEnd],
        enabled: leavePayEmployeeIds.length > 0 && Boolean(periodStart && periodEnd) && !isInvalidDateRange,
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth('/api/payroll/leave-pay-preview', { method: 'POST', signal, body: JSON.stringify({ employee_ids: leavePayEmployeeIds, period_start: periodStart, period_end: periodEnd }) });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to verify leave payments.');
            return body;
        },
        staleTime: 15000, refetchInterval: 60000, refetchIntervalInBackground: false, retry: false,
    });
    const leavePayLoading = leavePayEmployeeIds.length > 0 && (leavePayPreview.isPending || leavePayPreview.isFetching);

    // Weekly payroll takes SSS / PhilHealth / Pag-IBIG once a month, in the first cutoff that ends in the month.
    // The server supplies each worker's monthly base (salary, or last month's average weekly pay).
    const isFirstCutoff = isFirstCutoffOfMonth(periodEnd);
    const statutoryBasesQuery = useQuery({
        queryKey: ['payrollStatutoryBases', getUser()?.id, leavePayEmployeeIds, periodStart, periodEnd],
        enabled: entryMode !== 'single' && isFirstCutoff && leavePayEmployeeIds.length > 0 && Boolean(periodStart && periodEnd) && !isInvalidDateRange,
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth('/api/payroll/statutory-preview', { method: 'POST', signal, body: JSON.stringify({ employee_ids: leavePayEmployeeIds, period_start: periodStart, period_end: periodEnd }) });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load statutory bases.');
            return body;
        },
        staleTime: 15000, retry: false,
    });
    const statutoryBases = statutoryBasesQuery.data?.bases;
    const singleCashPay = leavePayPreview.data?.data?.[formData.employee_id]?.cash_pay || 0;

    // The cutoff length does not change the Monday-Friday work schedule.
    const expectedWorkingDays = useMemo(() => {
        if (!periodStart || !periodEnd || isInvalidDateRange) return 0;
        return getScheduledWorkDates(periodStart, periodEnd).length;
    }, [periodStart, periodEnd, isInvalidDateRange]);

    useEffect(() => {
        const ids = entryMode === 'single' ? new Set([String(formData.employee_id)]) : activeGroupEmployeeIdSet;
        if ((entryMode === 'single' && !formData.employee_id) || ids.size === 0) return;
        let timer;
        const refresh = () => {
            if (document.visibilityState === 'hidden') return;
            clearTimeout(timer);
            timer = setTimeout(() => { setAttendanceRefreshTick(value => value + 1); queryClient.invalidateQueries({ queryKey: ['payrollLeavePay'] }); }, 150);
        };
        const channel = supabase.channel(`payroll-attendance-${entryMode}-${formData.employee_id || selectedGroup}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, event => { if (ids.has(String(event.new?.employee_id || event.old?.employee_id))) refresh(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sil_cash_out_requests' }, event => { if (ids.has(String(event.new?.employee_id || event.old?.employee_id))) refresh(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', ...(entryMode === 'single' ? { filter: `employee_id=eq.${formData.employee_id}` } : {}) }, event => {
                const id = event.new?.employee_id || event.old?.employee_id;
                if (ids.has(String(id)) || event.eventType === 'DELETE') refresh();
            })
            .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        const poll = setInterval(refresh, 60000);
        return () => {
            clearTimeout(timer);
            clearInterval(poll);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
            supabase.removeChannel(channel);
        };
    }, [entryMode, formData.employee_id, selectedGroup, activeGroupEmployeeIdSet, queryClient]);

    // Anyone short of even one expected day. Held back until attendance has actually
    // loaded so the whole roster isn't flagged mid-fetch.
    const absenteeInfo = useMemo(() => {
        const map = {};
        if (entryMode !== 'batch') return map;
        if (isLoadingGroupAttendance || expectedWorkingDays <= 0) return map;
        if (Object.keys(groupAttendanceMap).length === 0) return map;

        // Declared Special Non-Working Days and Regular Holidays are non-working by law; unworked days are not absences
        const nonWorkingHolidayDates = Array.from(new Set(
            (holidayPreview?.items || [])
                .filter(item => item && (item.holidayType === 'special_non_working' || item.holidayType === 'regular') && item.date)
                .map(item => extractDateStr(item.date))
                .filter(Boolean)
        ));

        activeGroupEmployees.forEach(emp => {
            const idStr = String(emp.id);
            const workDates = getScheduledWorkDates(periodStart, periodEnd, getEmployeeRestDays(emp));
            const workedDates = new Set(groupWorkedDatesMap[idStr] || []);
            const daysPresent = workDates.filter(date => workedDates.has(date)).length;
            const unworkedHolidayDays = nonWorkingHolidayDates.filter(date => workDates.includes(date) && !workedDates.has(date)).length;
            const expectedForWorker = Math.max(0, workDates.length - unworkedHolidayDays);
            const daysAbsent = Math.max(0, expectedForWorker - daysPresent);
            if (daysAbsent > 0) {
                map[idStr] = { employee: emp, daysPresent, daysAbsent, expectedWorkingDays: expectedForWorker };
            }
        });
        return map;
    }, [entryMode, activeGroupEmployees, groupAttendanceMap, groupWorkedDatesMap, expectedWorkingDays, isLoadingGroupAttendance, holidayPreview, periodStart, periodEnd]);

    // Workers with 0 days present this cutoff are skipped on every process: no declaration, no share.
    // Held empty while attendance is still loading so the whole roster isn't skipped mid-fetch.
    const zeroAttendanceIdSet = useMemo(() => {
        const ids = new Set();
        if (entryMode !== 'batch' || isLoadingGroupAttendance || Object.keys(groupAttendanceMap).length === 0) return ids;
        activeGroupEmployees.forEach(emp => {
            const idStr = String(emp.id);
            if (!(groupAttendanceMap[idStr] > 0)) ids.add(idStr);
        });
        return ids;
    }, [entryMode, isLoadingGroupAttendance, groupAttendanceMap, activeGroupEmployees]);

    // Computed Factory Operation Rows
    const computedFactoryRows = useMemo(() => {
        return factoryRows.map(row => {
            const qty = parseFloat(row.quantity_in) || 0;
            const baseAmt = parseFloat(row.amount) || 0;
            const effectiveAmt = baseAmt;
            const totalPrice = qty * effectiveAmt;

            const rawAssigned = Array.isArray(row.assignedEmployeeIds) ? row.assignedEmployeeIds : [];

            const groupAssignedIds = rawAssigned.filter(id =>
                activeGroupEmployeeIdSet.has(String(id))
            );

            let effectiveAssignedIds;

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

            // Workers with 0 days present are skipped: no declaration, no share.
            // The solo rule below still looks at the original roster, so a worker who only
            // looks "alone" because a coworker had 0 days is not handed the whole process.
            const rosterSizeBeforeSkip = effectiveAssignedIds.length;
            effectiveAssignedIds = effectiveAssignedIds.filter(id => !zeroAttendanceIdSet.has(String(id)));

            // A worker who is the ONLY one assigned to a process has nobody to split it
            // with, so the whole operation is theirs whether they were absent or not.
            // There is nothing for HR to declare, so they are never asked about this row.
            const isSoloAssignment = rosterSizeBeforeSkip === 1 && effectiveAssignedIds.length === 1;

            // Otherwise split the roster on this operation into workers who completed the
            // cutoff and workers who missed at least one day.
            const absenteeIdsOnRow = isSoloAssignment
                ? []
                : effectiveAssignedIds.filter(id => !!absenteeInfo[id]);
            const presentIdsOnRow = isSoloAssignment
                ? effectiveAssignedIds
                : effectiveAssignedIds.filter(id => !absenteeInfo[id]);

            // Absent workers are paid on declared output, not on a day-weighted share:
            //     worker amount = declared quantity x price rate
            // A missing or invalid entry pays ₱0 and blocks the batch from saving.
            const declaredForRow = {};
            let declaredQtyTotal = 0;
            let hasMissingDeclaration = false;

            absenteeIdsOnRow.forEach(id => {
                const raw = absenteeOutputs?.[id]?.[row.id];
                const declaredQty = (raw === undefined || raw === null || raw === '')
                    ? NaN
                    : parseFloat(raw);

                if (isNaN(declaredQty) || declaredQty < 0) {
                    declaredForRow[id] = null;
                    hasMissingDeclaration = true;
                    return;
                }
                declaredForRow[id] = declaredQty;
                declaredQtyTotal += declaredQty;
            });

            // Hard cap in QUANTITY, not pesos: the combined output declared by every
            // absent worker on this operation can never exceed the batch quantity HR
            // logged for it. 100 pairs logged means at most 100 pairs can be claimed
            // between all absentees, however many of them there are.
            const declaredQtyRemaining = Math.max(0, qty - declaredQtyTotal);
            const isOverDeclared = declaredQtyTotal > qty + 0.0001;

            const cappedDeclaredQty = Math.min(declaredQtyTotal, qty);
            const carveOutTotal = cappedDeclaredQty * effectiveAmt;
            const carveOutScale = declaredQtyTotal > 0 ? (cappedDeclaredQty / declaredQtyTotal) : 1;

            // What is left after the absentees' own output is taken out is the pool
            // the workers who were present share between them.
            const remainingPool = Math.max(0, totalPrice - carveOutTotal);

            const shareByEmployeeId = {};

            absenteeIdsOnRow.forEach(id => {
                const declaredQty = declaredForRow[id];
                shareByEmployeeId[id] = declaredQty === null
                    ? 0
                    : declaredQty * effectiveAmt * carveOutScale;
            });

            // Attendance-weighted proration for the present workers: each one's cut of
            // the remaining pool is proportional to their days present during the cutoff,
            // not a flat equal split. Falls back to an equal split if no attendance data
            // is available yet (e.g. still loading), so the payout doesn't show ₱0 while
            // attendance is being fetched.
            const presentWeights = presentIdsOnRow.map(id => groupAttendanceMap[id] || 0);
            const totalAttendanceWeight = presentWeights.reduce((sum, d) => sum + d, 0);

            presentIdsOnRow.forEach((id, idx) => {
                if (totalAttendanceWeight > 0) {
                    shareByEmployeeId[id] = remainingPool * (presentWeights[idx] / totalAttendanceWeight);
                } else {
                    shareByEmployeeId[id] = presentIdsOnRow.length > 0 ? remainingPool / presentIdsOnRow.length : 0;
                }
            });

            // Nobody present on this operation means the remainder has no one to go to.
            const unallocated = presentIdsOnRow.length === 0 ? remainingPool : 0;

            return {
                ...row,
                qty,
                amt: baseAmt,
                effectiveAmt,
                totalPrice,
                effectiveAssignedIds,
                shareByEmployeeId,
                isProrated: totalAttendanceWeight > 0,
                absenteeIdsOnRow,
                presentIdsOnRow,
                declaredForRow,
                carveOutTotal,
                declaredQtyTotal,
                declaredQtyRemaining,
                remainingPool,
                hasMissingDeclaration,
                isOverDeclared,
                unallocated,
                isSoloAssignment
            };
        });
    }, [factoryRows, activeGroupEmployees, activeGroupEmployeeIdSet, groupAttendanceMap, zeroAttendanceIdSet, absenteeInfo, absenteeOutputs]);

    // Holiday pay for piece-rate workers (client rule: daily basic x holiday multiplier).
    // Only a worker who actually clocked in AND out on the holiday gets it. That day's pieces are
    // already in their piece pay, so only the premium above 100% is added here
    // (regular 200% -> +1.0 day, special non-working 130% -> +0.3 day, rest-day variants too).
    // Holiday pay for piece-rate workers comes from the server: their holiday credit is the average daily output
    // wage of the last 7 actual working days (minimum wage floor), which needs saved payslips and older attendance.
    const factoryHolidayEntries = useMemo(() => {
        if (entryMode !== 'batch') return [];
        const piecePayByWorker = {};
        (computedFactoryRows || []).forEach(row => {
            (row.effectiveAssignedIds || []).forEach(empId => {
                piecePayByWorker[empId] = (piecePayByWorker[empId] || 0) + (row.shareByEmployeeId?.[empId] || 0);
            });
        });
        return activeGroupEmployees.map(emp => ({
            employee_id: String(emp.id),
            piece_pay: parseFloat((piecePayByWorker[String(emp.id)] || 0).toFixed(2)),
        }));
    }, [entryMode, computedFactoryRows, activeGroupEmployees]);
    const [debouncedHolidayEntries, setDebouncedHolidayEntries] = useState([]);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedHolidayEntries(factoryHolidayEntries), 400);
        return () => clearTimeout(timer);
    }, [factoryHolidayEntries]);
    const periodHasHolidays = (holidayPreview?.items || []).length > 0;
    // The last cutoff of December also pays the 13th month (basic pay earned this year / 12).
    const isDecemberClose = isLastCutoffOfDecember(periodEnd);
    const factoryHolidayQuery = useQuery({
        queryKey: ['factoryHolidayPreview', getUser()?.id, periodStart, periodEnd, JSON.stringify(debouncedHolidayEntries)],
        enabled: entryMode === 'batch' && (periodHasHolidays || isDecemberClose) && debouncedHolidayEntries.length > 0 && Boolean(periodStart && periodEnd) && !isInvalidDateRange,
        queryFn: async ({ signal }) => {
            const response = await fetchWithAuth('/api/payroll/factory-holiday-preview', {
                method: 'POST',
                signal,
                body: JSON.stringify({ entries: debouncedHolidayEntries, period_start: periodStart, period_end: periodEnd }),
            });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'Unable to load holiday pay.');
            return body;
        },
        staleTime: 15000, retry: false,
    });
    // Keep the last numbers on screen while a new preview loads for the same cutoff (no flashing to zero).
    const holidayPeriodKey = `${periodStart}|${periodEnd}`;
    const [lastFactoryHoliday, setLastFactoryHoliday] = useState({ source: null, period: '', holidays: {}, thirteenth: {} });
    if (factoryHolidayQuery.data?.holidays && (lastFactoryHoliday.source !== factoryHolidayQuery.data || lastFactoryHoliday.period !== holidayPeriodKey)) {
        setLastFactoryHoliday({
            source: factoryHolidayQuery.data,
            period: holidayPeriodKey,
            holidays: factoryHolidayQuery.data.holidays,
            thirteenth: factoryHolidayQuery.data.thirteenth || {},
        });
    }
    const thirteenthByWorker = useMemo(() => {
        if (entryMode !== 'batch' || !isDecemberClose) return {};
        if (factoryHolidayQuery.data?.holidays) return factoryHolidayQuery.data.thirteenth || {};
        return lastFactoryHoliday.period === holidayPeriodKey ? lastFactoryHoliday.thirteenth : {};
    }, [entryMode, isDecemberClose, factoryHolidayQuery.data, holidayPeriodKey, lastFactoryHoliday]);
    const holidayPayByWorker = useMemo(() => {
        if (entryMode !== 'batch' || !periodHasHolidays) return {};
        if (factoryHolidayQuery.data?.holidays) return factoryHolidayQuery.data.holidays;
        return lastFactoryHoliday.period === holidayPeriodKey ? lastFactoryHoliday.holidays : {};
    }, [entryMode, periodHasHolidays, factoryHolidayQuery.data, holidayPeriodKey, lastFactoryHoliday]);

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
                lateMinutes: groupTardinessMap[idStr]?.minutes || 0,
                lateDeduction: groupTardinessMap[idStr]?.deduction || 0,
                netPay: 0,
                daysPresent: groupAttendanceMap[idStr] || 0,
                skippedNoAttendance: zeroAttendanceIdSet.has(idStr),
                isAbsent: !!absenteeInfo[idStr],
                daysAbsent: absenteeInfo[idStr] ? absenteeInfo[idStr].daysAbsent : 0,
                expectedWorkingDays,
                declaredOutputTotal: 0,
                holidayPay: 0,
                holidayItems: [],
                holidayMissingRate: false,
                thirteenthMonthPay: 0
            };
        });

        computedFactoryRows.forEach(row => {
            const assignedIds = row.effectiveAssignedIds;
            if (assignedIds.length === 0) return;

            assignedIds.forEach(empId => {
                if (map[empId]) {
                    const share = row.shareByEmployeeId[empId] || 0;
                    const declaredQty = row.declaredForRow ? row.declaredForRow[empId] : undefined;
                    const isDeclaredOutput = declaredQty !== undefined;

                    map[empId].assignedOperations.push({
                        operation: row.operation || 'Unnamed Process',
                        stock_no: row.stock_no,
                        qty: row.qty,
                        amt: row.effectiveAmt,
                        baseAmt: row.amt,
                        totalPrice: row.totalPrice,
                        // Declared-output workers are paid on their own quantity, so the
                        // "shared between N workers" framing doesn't apply to them.
                        workerCount: isDeclaredOutput ? 1 : (row.presentIdsOnRow || assignedIds).length,
                        share,
                        isProrated: row.isProrated && !isDeclaredOutput,
                        isDeclaredOutput,
                        declaredQty: isDeclaredOutput ? declaredQty : null,
                        isMissingDeclaration: isDeclaredOutput && declaredQty === null && row.totalPrice > 0
                    });
                    map[empId].grossPay += share;
                    if (isDeclaredOutput && declaredQty !== null) {
                        map[empId].declaredOutputTotal += share;
                    }
                }
            });
        });

        Object.keys(map).forEach(empId => {
            const item = map[empId];
            const extra = leavePayPreview.data?.data?.[empId];
            item.piecePay = parseFloat(item.grossPay.toFixed(2));
            item.paidLeavePay = extra?.paid_leave_pay || 0;
            item.silCashPay = extra?.cash_pay || 0;
            const holiday = holidayPayByWorker[empId];
            item.holidayPay = holiday?.total || 0;
            item.holidayItems = holiday?.items || [];
            item.holidayMissingRate = !!holiday?.missingRate;
            item.thirteenthMonthPay = thirteenthByWorker[empId] || 0;
            const compensation = item.piecePay + item.paidLeavePay + item.holidayPay;
            const gross = parseFloat((compensation + item.silCashPay + item.thirteenthMonthPay).toFixed(2));
            item.grossPay = gross;
            if (compensation > 0 && isFirstCutoff) {
                // Full monthly amount, taken once (first cutoff of the month). No earlier payslips: this cutoff x4.
                const monthlyBase = statutoryBases?.[empId] ?? compensation * 4;
                item.sss = parseFloat((getSssMsc(monthlyBase, statutoryRates.sss_max_msc) * statutoryRates.sss_employee_rate / 100).toFixed(2));
                const phBase = Math.min(Math.max(monthlyBase, statutoryRates.philhealth_min_salary), statutoryRates.philhealth_max_salary);
                item.philHealth = parseFloat((phBase * statutoryRates.philhealth_rate / 100 / 2).toFixed(2));
                item.pagIbig = parseFloat(Math.min(monthlyBase * statutoryRates.pagibig_employee_rate / 100, statutoryRates.pagibig_max_contribution).toFixed(2));
            }
            const statutory = item.sss + item.philHealth + item.pagIbig;
            item.tax = calculateBIRWithholdingTax(Math.max(0, compensation + (extra?.taxable_cash || 0) + Math.max(0, item.thirteenthMonthPay - 90000) - statutory - item.lateDeduction), 'weekly');
            item.lateDeduction = Math.min(item.lateDeduction, Math.max(0, parseFloat((gross - statutory - item.tax).toFixed(2))));
            item.totalDeductions = Math.min(gross, parseFloat((statutory + item.tax + item.lateDeduction).toFixed(2)));
            item.netPay = Math.max(0, parseFloat((gross - item.totalDeductions).toFixed(2)));
        });

        return map;
    }, [activeGroupEmployees, computedFactoryRows, groupAttendanceMap, groupTardinessMap, absenteeInfo, expectedWorkingDays, statutoryRates, isFirstCutoff, statutoryBases, leavePayPreview.data, holidayPayByWorker, thirteenthByWorker, zeroAttendanceIdSet]);

    const grandTotalFactoryPayout = Object.values(workerPayrollMap).reduce((sum, item) => sum + item.grossPay, 0);

    // Gate for saving: every absent worker needs a quantity on every paid operation
    // they are assigned to, and no operation may be over-declared.
    const absenteeValidation = useMemo(() => {
        const missing = [];
        const overDeclaredRows = [];

        computedFactoryRows.forEach(row => {
            if (row.totalPrice <= 0) return;
            (row.absenteeIdsOnRow || []).forEach(id => {
                if (row.declaredForRow[id] === null || row.declaredForRow[id] === undefined) {
                    const info = absenteeInfo[id];
                    missing.push({
                        employeeId: id,
                        rowId: row.id,
                        operation: row.operation || 'Unnamed Process',
                        name: info ? `${info.employee.first_name || ''} ${info.employee.last_name || ''}`.trim() : id
                    });
                }
            });
            if (row.isOverDeclared) overDeclaredRows.push(row);
        });

        // Only absentees who share a process with someone else need declaring.
        // Someone absent but working alone on every process they're assigned to is
        // paid their full operation total and never shows up in the modal.
        const declarableIds = new Set();
        computedFactoryRows.forEach(row => {
            if (row.totalPrice <= 0) return;
            (row.absenteeIdsOnRow || []).forEach(id => declarableIds.add(id));
        });

        return {
            missing,
            overDeclaredRows,
            absenteeCount: declarableIds.size,
            totalAbsentCount: Object.keys(absenteeInfo).length,
            isComplete: missing.length === 0 && overDeclaredRows.length === 0
        };
    }, [computedFactoryRows, absenteeInfo]);

    // Drop stale declarations when the group, the cutoff or the operation list changes,
    // so a quantity typed for one batch can never leak into the next one.
    const absenteeScope = `${selectedGroup}|${periodStart}|${periodEnd}`;
    const [previousAbsenteeScope, setPreviousAbsenteeScope] = useState(absenteeScope);
    if (previousAbsenteeScope !== absenteeScope) {
        setPreviousAbsenteeScope(absenteeScope);
        setAbsenteeOutputs({});
        setIsAbsenteeModalOpen(false);
    }

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
        const restDayOtHours = parseFloat(formData.rest_day_ot_hours) || 0;
        return otHours * regularHourlyRate * 1.25 + restDayOtHours * regularHourlyRate * 1.69;
    }, [formData.overtime_hours, formData.rest_day_ot_hours, regularHourlyRate]);

    // Individual payroll: HR may still open this employee, but the server says there is nothing to
    // pay for (no completed attendance and no approved paid leave in the selected cutoff).
    // The echoed employee/period guard stops a slow answer for a previous selection from
    // blocking (or unblocking) the wrong person.
    const attendanceBlock = useMemo(() => {
        const check = holidayPreview?.attendanceCheck;
        if (entryMode !== 'single' || !check?.blocked || !formData.employee_id) return null;
        if (String(check.employee_id) !== String(formData.employee_id)) return null;
        if (check.period_start !== periodStart || check.period_end !== periodEnd) return null;
        return check;
    }, [holidayPreview, entryMode, formData.employee_id, periodStart, periodEnd]);

    const filteredEmployees = useMemo(() => {
        const search = empSearch.toLowerCase();
        return employees.filter(emp => {
            if (isFactoryDept(getEmployeeDept(emp))) return false;

            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
            const dept = getEmployeeDept(emp);
            return fullName.includes(search) || dept.toLowerCase().includes(search);
        });
    }, [employees, empSearch]);

    const calculationScope = `${entryMode}|${formData.employee_id}|${periodStart}|${periodEnd}|${attendanceRefreshTick}|${isInvalidDateRange}`;
    const [previousCalculationScope, setPreviousCalculationScope] = useState(calculationScope);
    if (previousCalculationScope !== calculationScope) {
        setPreviousCalculationScope(calculationScope);
        setIsCalculating(Boolean(entryMode === 'single' && formData.employee_id && periodStart && periodEnd && !isInvalidDateRange));
        setAttendanceError(null);
    }
    // Single payroll uses the same effective policy as server-side payout calculation.
    useEffect(() => {
        if (entryMode !== 'single' || !formData.employee_id || !periodStart || !periodEnd || isInvalidDateRange) {
            return;
        }

        let isMounted = true;
        const calcKey = `${formData.employee_id}|${periodStart}|${periodEnd}`;

        const controller = new AbortController();
        const calculatePayroll = async () => {
            try {
                const { logs, workPolicy: policy } = await loadPayrollAttendance(formData.employee_id, periodStart, periodEnd, controller.signal);
                const tardiness = calculateTardiness(logs, policy, getEmployeeRestDays(selectedEmployee));
                const otByDate = {};
                const addOt = (key, hours) => {
                    if (hours > 0) otByDate[key || '_'] = (otByDate[key || '_'] || 0) + hours;
                };
                const workedDatesSet = new Set();

                const completedLogs = Array.isArray(logs) ? logs.filter(l => l && l.time_out && l.time_in) : [];

                completedLogs.forEach(log => {
                    const dateStr = extractDateStr(log.date || log.time_in);
                    if (dateStr) workedDatesSet.add(dateStr);

                    const timeOut = parseDate(log.time_out);

                    if (log.overtime_hours) {
                        addOt(dateStr, parseFloat(log.overtime_hours) || 0);
                    } else if (log.ot_hours) {
                        addOt(dateStr, parseFloat(log.ot_hours) || 0);
                    } else if (timeOut && dateStr) {
                        const scheduleEnd = new Date(`${dateStr}T17:00:00`);
                        if (!isNaN(scheduleEnd.getTime()) && timeOut > scheduleEnd) {
                            const otMins = Math.floor((timeOut - scheduleEnd) / 60000);
                            if (otMins >= 30) {
                                addOt(dateStr, parseFloat((otMins / 60).toFixed(2)));
                            }
                        }
                    }
                });

                const uniqueWorkedDates = Array.from(workedDatesSet);
                const daysWorked = uniqueWorkedDates.length;

                if (isMounted) {
                    setWorkPolicy(policy);
                    setFormData(prev => ({
                        ...prev,
                        days_worked: daysWorked,
                        late_minutes: tardiness.minutes,
                        late_deductions: tardiness.deduction.toFixed(2)
                    }));
                    setAutoOtByDate(otByDate);
                    lastCalcKeyRef.current = calcKey;
                }
            } catch (err) {
                if (isMounted && err.name !== 'AbortError') setAttendanceError(err.message || 'Cannot load payroll attendance.');
            } finally {
                if (isMounted) setIsCalculating(false);
            }
        };

        calculatePayroll();
        return () => { isMounted = false; controller.abort(); };
    }, [entryMode, formData.employee_id, periodStart, periodEnd, selectedEmployee, employeeRates, isInvalidDateRange, attendanceRefreshTick]);

    // Overtime worked on a holiday is already paid by the server's holiday pay (hours over 8 at the
    // holiday rate), so those dates are left out of the ordinary overtime hours to avoid paying twice.
    const overtimeAutofill = useMemo(() => {
        if (entryMode !== 'single') return null;
        const holidayDates = new Set(
            (holidayPreview?.items || []).map(item => extractDateStr(item?.date)).filter(Boolean)
        );
        const restDays = getEmployeeRestDays(selectedEmployee);
        let rawTotal = 0;
        let ordinaryTotal = 0;
        let restDayTotal = 0;
        Object.entries(autoOtByDate).forEach(([date, hours]) => {
            rawTotal += hours;
            if (holidayDates.has(date)) return;
            const onRestDay = date !== '_' && restDays.includes(new Date(`${date}T00:00:00`).getDay());
            if (onRestDay) restDayTotal += hours;
            else ordinaryTotal += hours;
        });
        if (rawTotal <= 0) return null;
        // Rest-day overtime is paid at 1.69x instead of 1.25x, so it is kept in its own field.
        return {
            overtime_hours: ordinaryTotal > 0 ? ordinaryTotal.toFixed(2) : '',
            rest_day_ot_hours: restDayTotal > 0 ? restDayTotal.toFixed(2) : ''
        };
    }, [entryMode, autoOtByDate, holidayPreview, selectedEmployee]);
    const [previousOvertimeAutofill, setPreviousOvertimeAutofill] = useState(null);
    if (previousOvertimeAutofill !== overtimeAutofill) {
        setPreviousOvertimeAutofill(overtimeAutofill);
        if (overtimeAutofill) setFormData(previous => ({ ...previous, ...overtimeAutofill }));
    }

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (Object.hasOwn(PAYROLL_NUMBER_LIMITS, name) && !isBoundedDecimalInput(value, PAYROLL_NUMBER_LIMITS[name], true)) return;
        const next = name === 'late_deductions' ? sanitizeAmount(value) : value;
        setFormData(prev => ({ ...prev, [name]: next }));
    };

    const handleSubmitBatch = async (e) => {
        e.preventDefault();
        if (leavePayLoading || leavePayPreview.isError) { setError(leavePayPreview.error?.message || 'Still checking leave payments. Try again in a moment.'); return; }
        if (isInvalidDateRange) {
            setError(isRangeTooLong
                ? `Payroll cutoff cannot be longer than ${MAX_CUTOFF_DAYS} days (${periodDaysCount} selected).`
                : 'End date cannot be earlier than start date.');
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

        if (attendanceError) { setError(attendanceError); return; }
        if (isLoadingGroupAttendance) {
            setError('Still checking attendance for this group. Try again in a moment.');
            return;
        }

        if ((periodHasHolidays || isDecemberClose) && (factoryHolidayQuery.isFetching || debouncedHolidayEntries !== factoryHolidayEntries)) {
            setError('Holiday pay is still being calculated. Try again in a moment.');
            return;
        }
        const missingHolidayRate = activeGroupEmployees.filter(emp => workerPayrollMap[String(emp.id)]?.holidayMissingRate);
        if (missingHolidayRate.length > 0) {
            setError(`HR must save a daily rate before paying holiday work for: ${missingHolidayRate.map(emp => `${emp.first_name} ${emp.last_name}`.trim()).join(', ')}.`);
            return;
        }

        // Absent workers must have their real output declared before any payslip is saved.
        if (absenteeValidation.absenteeCount > 0 && !absenteeValidation.isComplete) {
            if (absenteeValidation.missing.length > 0) {
                setError(
                    `${absenteeValidation.absenteeCount} worker(s) missed days this cutoff. ` +
                    `Enter how much each one actually made before saving the payslips ` +
                    `(${absenteeValidation.missing.length} quantit${absenteeValidation.missing.length === 1 ? 'y' : 'ies'} still blank).`
                );
            } else {
                setError('Absent workers have claimed more output than the quantity logged for one or more processes. Lower the quantities before saving.');
            }
            setIsAbsenteeModalOpen(true);
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
                const absence = absenteeInfo[empIdStr];

                const declaredOutput = computedFactoryRows
                    .filter(row => row.declaredForRow && row.declaredForRow[empIdStr] !== undefined && row.declaredForRow[empIdStr] !== null)
                    .map(row => ({
                        row_id: row.id,
                        operation: row.operation || 'Unnamed Process',
                        stock_no: row.stock_no,
                        declared_quantity: row.declaredForRow[empIdStr],
                        rate: row.effectiveAmt,
                        amount: row.shareByEmployeeId[empIdStr] || 0
                    }));

                return {
                    employee_id: emp.id,
                    department: 'Factory',
                    group: selectedGroup,
                    production_group_id: emp.production_group_id || groupObj?.id || null,
                    period_start: periodStart,
                    period_end: periodEnd,
                    pay_frequency: 'weekly',
                    is_prorated: true,
                    gross_pay: workerData?.piecePay || 0,
                    expected_paid_leave_pay: workerData?.paidLeavePay || 0,
                    expected_sil_cash_pay: workerData?.silCashPay || 0,
                    sss_deduction: workerData ? workerData.sss : 0,
                    philhealth_deduction: workerData ? workerData.philHealth : 0,
                    pagibig_deduction: workerData ? workerData.pagIbig : 0,
                    tax_deduction: workerData ? workerData.tax : 0,
                    total_deductions: workerData ? workerData.totalDeductions : 0,
                    net_payout: workerData ? workerData.netPay : empGrossPay,
                    operations_breakdown: empOpsBreakdown,
                    days_present: workerData ? workerData.daysPresent : 0,
                    days_absent: absence ? absence.daysAbsent : 0,
                    expected_working_days: expectedWorkingDays,
                    is_absent: !!absence,
                    pay_basis: absence ? 'declared_output' : 'attendance_prorated',
                    declared_output: declaredOutput,
                    expected_holiday_pay: workerData?.holidayPay || 0,
                    expected_thirteenth_month_pay: workerData?.thirteenthMonthPay || 0,
                    admin_id: user?.id,
                    overtime_hours: 0,
                    overtime_pay: 0
                };
            }).filter(entry => entry.gross_pay + entry.expected_holiday_pay + entry.expected_paid_leave_pay + entry.expected_sil_cash_pay > 0);

            if (batchEntries.length === 0) {
                setError('No employees have output pay, paid leave or approved cash payouts this period.');
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
                const saved = data.saved || [];
                setSuccess(`Saved ${saved.length} payslip(s) for ${selectedGroup}.`);
                if (data.skipped?.length) setError(data.skipped.map(item => { const emp = employees.find(employee => employee.id === item.employee_id); return `${emp?.first_name || item.employee_id}: ${item.reason}`; }).join('; '));
                queryClient.invalidateQueries({ queryKey: ['payrollLeavePay'] });
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'], refetchType: 'all' });
                queryClient.invalidateQueries({ queryKey: ['adminPayrollEligibleEmployees'], refetchType: 'all' });
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'], refetchType: 'all' });
                if (!data.skipped?.length) setTimeout(() => navigate('/admin/payroll'), 900);
                else setIsSubmitting(false);
            }
        } catch  {
            setError('Connection error. Please check your network.');
            setIsSubmitting(false);
        }
    };

    const handleSubmitSingle = async (e) => {
        e.preventDefault();
        if (leavePayLoading || leavePayPreview.isError) { setError(leavePayPreview.error?.message || 'Still checking leave payments. Try again in a moment.'); return; }
        if (attendanceError || isCalculating) { setError(attendanceError || 'Attendance is still being checked.'); return; }
        if (isInvalidDateRange) {
            setError(isRangeTooLong
                ? `Payroll cutoff cannot be longer than ${MAX_CUTOFF_DAYS} days (${periodDaysCount} selected).`
                : 'End date cannot be earlier than start date.');
            return;
        }

        if (!selectedEmployee) {
            setError('Please select an employee.');
            return;
        }

        if (attendanceBlock) {
            setError(attendanceBlock.reason);
            return;
        }

        setError(null);
        setSuccess(null);
        setIsSubmitting(true);

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const otHours = parseFloat(formData.overtime_hours) || 0;
            const restDayOtHours = parseFloat(formData.rest_day_ot_hours) || 0;
            const otPay = otHours * regularHourlyRate * 1.25 + restDayOtHours * regularHourlyRate * 1.69;

            const payload = {
                ...formData,
                late_minutes: Number(formData.late_minutes) || 0,
                hourly_rate: employeeRates.hourlyRate,
                daily_rate: employeeRates.dailyRate,
                expected_paid_leave_pay: leavePayPreview.data?.data?.[formData.employee_id]?.paid_leave_pay || 0,
                expected_sil_cash_pay: singleCashPay,
                paid_leave_days: totalPaidLeaveDays,
                paid_leave_pay: parseFloat((totalPaidLeaveDays * employeeRates.dailyRate).toFixed(2)),
                overtime_hours: otHours,
                overtime_pay: parseFloat(otPay.toFixed(2)),
                period_start: periodStart,
                period_end: periodEnd,
                pay_frequency: 'weekly',
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
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'], refetchType: 'all' });
                queryClient.invalidateQueries({ queryKey: ['adminPayrollEligibleEmployees'], refetchType: 'all' });
                queryClient.invalidateQueries({ queryKey: ['adminEmployees'], refetchType: 'all' });
                if (!data.skipped?.length) setTimeout(() => navigate('/admin/payroll'), 900);
                else setIsSubmitting(false);
            }
        } catch  {
            setError('Connection error. Please check your network.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto py-4 sm:py-8 px-3 sm:px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            <div className="mb-4">
                <BackButton fallback="/admin/payroll" label="Back to Payroll Ledger" />
            </div>

            <div className="bg-white p-5 sm:p-6 rounded-lg shadow-2xs border border-slate-200">

                {/* Header & Mode Switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 bg-accent text-white rounded-md flex items-center justify-center text-lg shadow-2xs">
                            <i className="ti ti-calculator"></i>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg sm:text-xl font-bold text-slate-800 tracking-tight truncate">Compute Payroll</h2>
                        </div>
                    </div>

                    <div className="bg-slate-100 p-0.5 rounded-md flex items-center self-start sm:self-auto gap-0.5 border border-slate-200">
                        <button
                            type="button"
                            onClick={() => { setEntryMode('batch'); setError(null); setSuccess(null); }}
                            className={`h-8 px-3 rounded-sm text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 cursor-pointer ${entryMode === 'batch'
                                ? 'bg-white text-accent shadow-2xs font-semibold'
                                : 'text-slate-500 hover:text-slate-800'
                                }`}
                        >
                            <i className="ti ti-users-group text-sm"></i>
                            <span>Factory Group</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setEntryMode('single'); setError(null); setSuccess(null); }}
                            className={`h-8 px-3 rounded-sm text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 cursor-pointer ${entryMode === 'single'
                                ? 'bg-white text-accent shadow-2xs font-semibold'
                                : 'text-slate-500 hover:text-slate-800'
                                }`}
                        >
                            <i className="ti ti-user text-sm"></i>
                            <span>Individual Employee</span>
                        </button>
                    </div>
                </div>

                {/* Notifications & Error Alerts */}
                {attendanceError && <p role="alert" className="mb-4 text-sm text-danger-ink">{attendanceError} Payroll submission is blocked until attendance is available.</p>}
                {(error || leavePayPreview.isError) && (
                    <div className="mb-6 p-3.5 sm:p-4 bg-danger-subtle border-l-4 border-danger rounded-r-md shadow-2xs flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-danger-ink mt-0.5 text-lg"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-danger-ink">Action Stopped</h4>
                            <p className="text-xs sm:text-sm text-danger-ink mt-0.5 break-words">{error || leavePayPreview.error?.message}</p>
                        </div>
                    </div>
                )}

                {success && (
                    <div className="mb-6 p-3.5 sm:p-4 bg-surface-muted border-l-4 border-line rounded-r-md shadow-2xs flex items-start gap-3">
                        <i className="ti ti-circle-check text-ink mt-0.5 text-lg"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-ink">Success</h4>
                            <p className="text-xs sm:text-sm text-ink mt-0.5 break-words">{success}</p>
                        </div>
                    </div>
                )}

                {prefillEmployeeMissing && (
                    <div className="mb-6 p-3.5 sm:p-4 bg-warning-subtle border-l-4 border-warning rounded-r-md shadow-2xs flex items-start gap-3">
                        <i className="ti ti-alert-triangle text-warning-ink mt-0.5 text-lg"></i>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-warning-ink">Employee Not Found</h4>
                            <p className="text-xs sm:text-sm text-warning-ink mt-0.5 break-words">
                                The requested employee is no longer active in the roster or is a factory worker. Please select a valid daily/hourly employee.
                            </p>
                        </div>
                    </div>
                )}

                {/* Explicit Holiday Generation Reminder — only shows when this year genuinely has no holidays yet */}
                {holidayYearStatus.checked && !holidayYearStatus.generated && (
                    <div className="mb-6 bg-danger-subtle border border-danger/20 p-3.5 sm:p-4 rounded-lg shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-md bg-danger text-white flex items-center justify-center shrink-0">
                                <i className="ti ti-calendar-exclamation text-base"></i>
                            </div>
                            <div className="min-w-0">
                                <h4 className="text-xs sm:text-sm font-bold text-danger-ink">
                                    Holidays for {holidayYearStatus.year} haven't been generated yet
                                </h4>
                                <p className="text-xs text-danger-ink mt-0.5">
                                    Generate them now so holiday pay is applied correctly before you process payroll.
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleGenerateHolidaysNow}
                            disabled={isGeneratingHolidays}
                            className="shrink-0 h-8 px-3 bg-danger hover:bg-danger-ink text-white text-xs font-semibold rounded-md transition-colors duration-100 cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                        >
                            <i className="ti ti-wand text-sm"></i>
                            {isGeneratingHolidays ? 'Generating…' : `Generate ${holidayYearStatus.year} Holidays`}
                        </button>
                    </div>
                )}

                {/* List of holidays actually added, shown right after a successful "Generate" click */}
                {justGeneratedHolidays && (
                    <div className="mb-6 bg-surface-muted border border-line p-3.5 sm:p-4 rounded-lg shadow-2xs">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-md bg-ink-subtle text-white flex items-center justify-center shrink-0">
                                    <i className="ti ti-circle-check text-base"></i>
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-xs sm:text-sm font-bold text-ink">
                                        {justGeneratedHolidays.inserted.length > 0
                                            ? `${justGeneratedHolidays.inserted.length} holiday${justGeneratedHolidays.inserted.length === 1 ? '' : 's'} added for ${justGeneratedHolidays.year}`
                                            : `No new holidays to add for ${justGeneratedHolidays.year}`}
                                    </h4>
                                    {justGeneratedHolidays.skippedExisting > 0 && (
                                        <p className="text-[11px] text-ink mt-0.5">
                                            {justGeneratedHolidays.skippedExisting} already existed and were left as-is.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setJustGeneratedHolidays(null)}
                                className="shrink-0 w-7 h-7 rounded-md bg-surface-muted hover:bg-surface-muted text-ink flex items-center justify-center transition-colors duration-100 cursor-pointer"
                            >
                                <i className="ti ti-x text-sm"></i>
                            </button>
                        </div>

                        {justGeneratedHolidays.inserted.length > 0 && (
                            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                                {justGeneratedHolidays.inserted
                                    .slice()
                                    .sort((a, b) => (a.date < b.date ? -1 : 1))
                                    .map((h) => (
                                        <li key={h.id || `${h.date}-${h.name}`} className="text-xs text-ink flex items-center gap-1.5">
                                            <span className="font-mono font-semibold text-ink shrink-0">
                                                {formatReadableDate(h.date)}
                                            </span>
                                            <span className="truncate">{h.name}</span>
                                        </li>
                                    ))}
                            </ul>
                        )}

                        {justGeneratedHolidays.reminder && (
                            <p className="text-[11px] text-ink mt-3 border-t border-line pt-2">
                                {justGeneratedHolidays.reminder}
                            </p>
                        )}
                    </div>
                )}

                {/* Automatic Holiday Banner Indicator */}
                {holidayPreview.items.length > 0 && (
                    <div className="mb-6 bg-warning-subtle border border-warning/20 p-3.5 sm:p-4 rounded-lg shadow-2xs flex items-start gap-3">
                        <div className="w-8 h-8 rounded-md bg-warning text-white flex items-center justify-center font-bold text-base shrink-0">
                            <i className="ti ti-calendar-event"></i>
                        </div>
                        <div className="min-w-0">
                            <h4 className="text-xs sm:text-sm font-bold text-warning-ink">Holiday in this cutoff</h4>
                            <p className="text-xs text-warning-ink mt-0.5">
                                {holidayPreview.items.map(h => `${h.holidayName} (${formatReadableDate(h.date)})`).join(', ')}
                            </p>
                            {entryMode === 'batch' && (() => {
                                const workers = Object.values(workerPayrollMap);
                                const paid = workers.filter(w => w.holidayPay > 0).length;
                                const missing = workers.filter(w => w.holidayMissingRate).length;
                                return (
                                    <p className="text-[11px] text-warning-ink/80 mt-0.5">
                                        Holiday pay (daily rate &times; holiday multiplier) is added only for workers who clocked in and out that day:
                                        {' '}{isLoadingGroupAttendance ? 'checking attendance...' : `${paid} paid`}
                                        {!isLoadingGroupAttendance && missing > 0 && `, ${missing} worked it but have no daily rate saved`}.
                                    </p>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* Sliced: Cutoff Period Selector Component */}
                <CutoffPeriodSelector
                    periodStart={periodStart}
                    periodEnd={periodEnd}
                    handleStartDateChange={handleStartDateChange}
                    activePreset={activePreset}
                    periodDaysCount={periodDaysCount}
                    isInvalidDateRange={isInvalidDateRange}
                    isRangeTooLong={isRangeTooLong}
                    maxCutoffDays={MAX_CUTOFF_DAYS}
                />

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

                {/* Blocking declaration step for workers who missed days this cutoff */}
                <AbsenteeOutputModal
                    isOpen={isAbsenteeModalOpen}
                    onClose={() => setIsAbsenteeModalOpen(false)}
                    absenteeInfo={absenteeInfo}
                    computedFactoryRows={computedFactoryRows}
                    absenteeOutputs={absenteeOutputs}
                    setAbsenteeOutputs={setAbsenteeOutputs}
                    absenteeValidation={absenteeValidation}
                />

                {/* Sliced Section Views: Batch vs Single */}
                {entryMode === 'batch' ? (
                    <FactoryBatchSection
                        selectedGroup={selectedGroup}
                        grandTotalFactoryPayout={grandTotalFactoryPayout}
                        activeGroupEmployees={activeGroupEmployees}
                        batchSummaryTotals={batchSummaryTotals}
                        filteredGroupEmployees={filteredGroupEmployees}
                        workerPayrollMap={workerPayrollMap}
                            isLoadingEmployees={isLoadingEmployees}
                        isLoadingGroupAttendance={isLoadingGroupAttendance}
                        breakdownSearch={breakdownSearch}
                        setBreakdownSearch={setBreakdownSearch}
                        breakdownFilter={breakdownFilter}
                        setBreakdownFilter={setBreakdownFilter}
                        breakdownViewMode={breakdownViewMode}
                        setBreakdownViewMode={setBreakdownViewMode}
                        setIsFactoryPieceOpen={setIsFactoryPieceOpen}
                        setIsGroupModalOpen={setIsGroupModalOpen}
                        isSubmitting={isSubmitting || leavePayLoading || leavePayPreview.isError}
                        isInvalidDateRange={isInvalidDateRange || Boolean(attendanceError) || (holidayYearStatus.checked && !holidayYearStatus.generated)}
                        handleSubmitBatch={handleSubmitBatch}
                        absenteeInfo={absenteeInfo}
                        absenteeValidation={absenteeValidation}
                        setIsAbsenteeModalOpen={setIsAbsenteeModalOpen}
                        expectedWorkingDays={expectedWorkingDays}
                    />
                ) : (
                    <SinglePayrollSection
                        formData={formData}
                        handleInputChange={handleInputChange}
                        selectedEmployee={selectedEmployee}
                        employeeRates={employeeRates}
                        estimatedOtPay={estimatedOtPay}
                        setIsEmpModalOpen={setIsEmpModalOpen}
                        silCashPay={singleCashPay}
                        paidLeaves={paidLeaves}
                        isLoadingLeaves={isLoadingLeaves}
                        totalPaidLeaveDays={totalPaidLeaveDays}
                        isCalculating={isCalculating}
                        workPolicy={workPolicy}
                        holidayPreview={holidayPreview}
                        isSubmitting={isSubmitting || leavePayLoading || leavePayPreview.isError}
                        isInvalidDateRange={isInvalidDateRange || Boolean(attendanceError) || (holidayYearStatus.checked && !holidayYearStatus.generated)}
                        handleSubmitSingle={handleSubmitSingle}
                        periodStart={periodStart}
                        periodEnd={periodEnd}
                        attendanceBlock={attendanceBlock}
                    />
                )}
            </div>

            {/* Sliced: Factory Group Selection Modal */}
            <GroupSelectionModal
                isOpen={isGroupModalOpen}
                onClose={() => setIsGroupModalOpen(false)}
                selectedGroup={selectedGroup}
                employeesInSelectedGroup={employeesInSelectedGroup}
                selectedGroupMemberIds={selectedGroupMemberIds}
                toggleGroupMember={toggleGroupMember}
                selectAllGroupMembers={selectAllGroupMembers}
                clearAllGroupMembers={clearAllGroupMembers}
            />

            {/* Sliced: Single Mode Searchable Employee Modal */}
            <EmployeeSelectionModal
                isOpen={isEmpModalOpen}
                onClose={() => setIsEmpModalOpen(false)}
                filteredEmployees={filteredEmployees}
                empSearch={empSearch}
                setEmpSearch={setEmpSearch}
                onSelectEmployee={(empId) => setFormData(prev => ({ ...prev, employee_id: empId }))}
            />
        </div>
    );
};

export default PayrollCreate;
