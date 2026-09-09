import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
import FactoryPiece from './FactoryPiece';

// Payroll utilities & constants
import {
    parseDate,
    extractDateStr,
    formatLocalDate,
    formatReadableDate,
    getEmployeeDept,
    isFactoryDept,
    getEmployeeRates,
    matchJobTitle
} from './utils/payrollHelpers';

// Subcomponents
import CutoffPeriodSelector from './components/CutoffPeriodSelector';
import FactoryBatchSection from './components/FactoryBatchSection';
import SinglePayrollSection from './components/SinglePayrollSection';
import GroupSelectionModal from './components/GroupSelectionModal';
import EmployeeSelectionModal from './components/EmployeeSelectionModal';

// Re-export matchJobTitle for backwards-compatibility (e.g. FactoryPiece.jsx)
export { matchJobTitle };

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
    }, [periodStart, periodEnd, selectedGroup, loadFactoryLogs]);

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

    const applyCutoffPreset = useCallback((presetKey = 'current_week', withWeekends = includeWeekends) => {
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
    }, [includeWeekends]);

    // Cutoff Presets
    useEffect(() => {
        if (hasPrefilledPeriod) {
            setActivePreset('custom');
            return;
        }
        applyCutoffPreset('current_week', includeWeekends);
    }, [hasPrefilledPeriod, applyCutoffPreset, includeWeekends]);

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

    // Single Employee Attendance & Calculation (with 2-Hour Regular Lateness Rule)
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
                            className={`min-h-[38px] px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${entryMode === 'batch'
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-500 hover:text-slate-800'
                                }`}
                        >
                            <i className="ti ti-users-group text-sm"></i>
                            <span>Factory Batch Payout</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { setEntryMode('single'); setError(null); setSuccess(null); }}
                            className={`min-h-[38px] px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${entryMode === 'single'
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-500 hover:text-slate-800'
                                }`}
                        >
                            <i className="ti ti-user text-sm"></i>
                            <span>Single Employee</span>
                        </button>
                    </div>
                </div>

                {/* Notifications & Error Alerts */}
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

                {/* Sliced: Cutoff Period Selector Component */}
                <CutoffPeriodSelector
                    periodStart={periodStart}
                    periodEnd={periodEnd}
                    handleStartDateChange={handleStartDateChange}
                    handleEndDateChange={handleEndDateChange}
                    activePreset={activePreset}
                    includeWeekends={includeWeekends}
                    toggleWeekends={toggleWeekends}
                    periodDaysCount={periodDaysCount}
                    isInvalidDateRange={isInvalidDateRange}
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
                    holidayRateMultiplier={holidayRateMultiplier}
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
                        holidayRateMultiplier={holidayRateMultiplier}
                        isLoadingEmployees={isLoadingEmployees}
                        breakdownSearch={breakdownSearch}
                        setBreakdownSearch={setBreakdownSearch}
                        breakdownFilter={breakdownFilter}
                        setBreakdownFilter={setBreakdownFilter}
                        breakdownViewMode={breakdownViewMode}
                        setBreakdownViewMode={setBreakdownViewMode}
                        setIsFactoryPieceOpen={setIsFactoryPieceOpen}
                        setIsGroupModalOpen={setIsGroupModalOpen}
                        isSubmitting={isSubmitting}
                        isInvalidDateRange={isInvalidDateRange}
                        handleSubmitBatch={handleSubmitBatch}
                    />
                ) : (
                    <SinglePayrollSection
                        formData={formData}
                        handleInputChange={handleInputChange}
                        selectedEmployee={selectedEmployee}
                        employeeRates={employeeRates}
                        estimatedOtPay={estimatedOtPay}
                        setIsEmpModalOpen={setIsEmpModalOpen}
                        paidLeaves={paidLeaves}
                        isLoadingLeaves={isLoadingLeaves}
                        totalPaidLeaveDays={totalPaidLeaveDays}
                        isCalculating={isCalculating}
                        holidayPreview={holidayPreview}
                        isSubmitting={isSubmitting}
                        isInvalidDateRange={isInvalidDateRange}
                        handleSubmitSingle={handleSubmitSingle}
                        periodStart={periodStart}
                        periodEnd={periodEnd}
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
                availableDepartments={availableDepartments}
                selectedDeptFilter={selectedDeptFilter}
                setSelectedDeptFilter={setSelectedDeptFilter}
                empSearch={empSearch}
                setEmpSearch={setEmpSearch}
                onSelectEmployee={(empId) => setFormData(prev => ({ ...prev, employee_id: empId }))}
            />
        </div>
    );
};

export default PayrollCreate;