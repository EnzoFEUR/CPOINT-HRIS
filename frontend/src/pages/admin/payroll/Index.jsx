import React, { useState, useMemo, useEffect, useCallback, useDeferredValue } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../../utils/api';
import { supabase } from '../../../supabaseClient';
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

const isFactoryDept = (dept) => (dept || '').toLowerCase().includes('factory');

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

    const primarySources = [
        emp?.production_groups?.name,
        emp?.production_groups?.code,
        payroll?.production_groups?.name,
        payroll?.production_group,
        payroll?.production_group_name,
        emp?.production_group_name,
        emp?.production_group,
        emp?.group,
        emp?.factory_group,
    ];

    for (const src of primarySources) {
        const formatted = formatLineName(src);
        if (formatted) return formatted;
    }

    if (payroll?.remarks) {
        const match = payroll.remarks.match(/(?:Group|Line):\s*([^|,\n]+)/i);
        if (match && match[1]) {
            const formatted = formatLineName(match[1]);
            if (formatted) return formatted;
        }
    }

    const stringSources = [
        payroll?.line, payroll?.group, payroll?.factory_line, payroll?.line_name,
        emp?.line, emp?.factory_line, emp?.line_assignment, emp?.assigned_line,
        emp?.section, emp?.sub_department, emp?.work_center
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
            badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200/90',
            dotClass: 'bg-amber-500 animate-pulse',
        };
    }
    return {
        label: status || 'Completed',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200/90',
        dotClass: 'bg-emerald-500',
    };
};

// ── Memoized Table Row Component (Zero-lag rendering, Perfect Alignment, Fully Clickable) ──
const PayrollTableRow = React.memo(({ payroll, isGroupChild = false, viewMode = 'grouped', rosterCategory = 'all' }) => {
    const navigate = useNavigate();
    const statusVisuals = getStatusVisuals(payroll.status);
    const empIdStr = payroll.employee_id !== undefined && payroll.employee_id !== null ? String(payroll.employee_id) : '';

    const handleRowClick = useCallback((e) => {
        if (e.target.closest('a, button, select, input, [data-prevent-row-click]')) {
            return;
        }
        if (payroll.isPending) {
            navigate({
                pathname: '/admin/payroll/process',
                search: `?employee_id=${encodeURIComponent(empIdStr)}&period_start=${encodeURIComponent(payroll.period_start)}&period_end=${encodeURIComponent(payroll.period_end)}`,
            }, {
                state: {
                    employee_id: payroll.employee_id,
                    period_start: payroll.period_start,
                    period_end: payroll.period_end,
                    department: payroll.employees?.department,
                    base_salary: payroll.employees?.monthly_salary ?? payroll.employees?.salary,
                    daily_rate: payroll.employees?.daily_rate,
                    isFactoryEmployee: isFactoryDept(payroll.employees?.department),
                }
            });
        } else if (payroll.id) {
            navigate(`/admin/payroll/${payroll.id}`);
        }
    }, [navigate, payroll, empIdStr]);

    const isGroupEmp = isFactoryDept(payroll._dept) || Boolean(payroll._line);

    return (
        <tr
            onClick={handleRowClick}
            title={payroll.isPending ? `Click to process payroll for ${payroll._fullName}` : `Click to view payslip for ${payroll._fullName}`}
            className={`cursor-pointer transition-all duration-150 group select-none ${
                isGroupChild 
                    ? 'bg-slate-50/40 hover:bg-emerald-50/50 hover:shadow-2xs active:bg-emerald-100/30' 
                    : 'bg-white hover:bg-emerald-50/35 hover:shadow-2xs active:bg-emerald-100/30'
            }`}
        >
            {/* 1. Worker & Role */}
            <td className={`py-5 px-4 xl:px-6 align-middle ${isGroupChild ? 'pl-8 xl:pl-10' : ''}`}>
                <div className="flex items-center gap-3.5 min-w-0">
                    {isGroupChild && (
                        <i className="ti ti-corner-down-right text-emerald-600/70 shrink-0 text-sm" title="Factory Line Member" />
                    )}
                    <div className="shrink-0 relative group-hover:scale-105 transition-transform duration-150">
                        <EmployeeAvatar employee={payroll.employees} employeeId={payroll.employee_id} size="h-11 w-11" theme="emerald" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <p className="text-[15px] font-extrabold text-slate-900 group-hover:text-emerald-700 transition-colors truncate" title={payroll._fullName}>
                                {payroll._fullName || 'Unknown'}
                            </p>
                            <i className="ti ti-arrow-up-right text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm shrink-0" />
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span className="text-xs text-slate-500 font-medium truncate">
                                {payroll._jobTitle || payroll._dept || 'Staff'}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="text-[11px] font-mono text-slate-400 font-medium">
                                {payroll._companyId || `#${empIdStr.substring(0, 6)}`}
                            </span>
                            {isGroupEmp ? (
                                (viewMode === 'flat' || !isGroupChild) && (
                                    <span className="ml-1 px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200/80 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0 inline-flex items-center gap-1">
                                        <i className="ti ti-building-factory-2 text-[11px]" />
                                        <span>Group{payroll._line ? ` • ${payroll._line}` : ''}</span>
                                    </span>
                                )
                            ) : (
                                (viewMode === 'flat' || rosterCategory === 'all') && (
                                    <span className="ml-1 px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200/80 rounded-md text-[10px] font-bold uppercase tracking-wide shrink-0 inline-flex items-center gap-1">
                                        <i className="ti ti-user text-[11px]" />
                                        <span>Regular</span>
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </td>

            {/* 2. Pay Cycle Period */}
            <td className="py-5 px-4 xl:px-6 align-middle">
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-slate-800 whitespace-nowrap flex items-center gap-1.5">
                        <i className="ti ti-calendar-event text-slate-400 text-sm" />
                        <span>{payroll._startFormatted}</span>
                        <span className="text-slate-400 font-normal">→</span>
                        <span>{payroll._endFormatted}</span>
                    </span>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-semibold uppercase tracking-wider w-max border border-slate-200/60">
                        {payroll.isPending ? 'Current Cycle' : (payroll.pay_frequency ? `${payroll.pay_frequency}` : 'Semi-Monthly')}
                    </span>
                </div>
            </td>

            {/* 3. Gross Compensation */}
            <td className="py-5 px-4 xl:px-6 text-right font-mono tabular-nums align-middle">
                {payroll.isPending ? (
                    <span className="text-slate-300 font-bold text-sm">—</span>
                ) : (
                    <div className="flex flex-col items-end">
                        <span className="font-bold text-slate-900 text-sm sm:text-[15px]">
                            ₱{payroll._gross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {payroll.overtime_pay > 0 && (
                            <span className="text-[10px] font-semibold text-blue-600 font-sans mt-0.5">
                                +₱{toSafeNumber(payroll.overtime_pay).toFixed(2)} OT
                            </span>
                        )}
                    </div>
                )}
            </td>

            {/* 4. Statutory Deductions */}
            <td className="py-5 px-4 xl:px-6 text-right font-mono tabular-nums align-middle">
                {payroll.isPending ? (
                    <span className="text-slate-300 font-bold text-sm">—</span>
                ) : (
                    <div className="flex flex-col items-end">
                        <span className="font-bold text-rose-600 text-sm sm:text-[15px]">
                            -₱{payroll._deductions.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {(payroll._sss > 0 || payroll._philHealth > 0 || payroll._pagIbig > 0 || payroll._tax > 0) && (
                            <div 
                                className="text-[11px] text-slate-400 font-sans mt-0.5 flex items-center justify-end gap-1 cursor-help whitespace-nowrap"
                                title={`SSS: ₱${payroll._sss.toFixed(2)} | PhilHealth: ₱${payroll._philHealth.toFixed(2)} | Pag-IBIG: ₱${payroll._pagIbig.toFixed(2)} | BIR Tax: ₱${payroll._tax.toFixed(2)}`}
                            >
                                <span>SSS {payroll._sss.toFixed(0)}</span>
                                <span>•</span>
                                <span>PH {payroll._philHealth.toFixed(0)}</span>
                                <span>•</span>
                                <span>HDMF {payroll._pagIbig.toFixed(0)}</span>
                            </div>
                        )}
                    </div>
                )}
            </td>

            {/* 5. Net Payout */}
            <td className="py-5 px-4 xl:px-6 text-right font-mono tabular-nums align-middle">
                {payroll.isPending ? (
                    <span className="text-slate-300 font-bold text-sm">—</span>
                ) : (
                    <span className="text-base sm:text-[17px] font-black text-emerald-600 tracking-tight">
                        ₱{payroll._net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                )}
            </td>

            {/* 6. Audit Status */}
            <td className="py-5 px-4 xl:px-6 text-center align-middle whitespace-nowrap">
                <span className={`px-3 py-1.5 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 mx-auto ${statusVisuals.badgeClass}`}>
                    <span className={`w-2 h-2 rounded-full ${statusVisuals.dotClass}`} />
                    <span>{statusVisuals.label}</span>
                </span>
            </td>

            {/* 7. Actions */}
            <td className="py-5 px-4 xl:px-6 text-right align-middle whitespace-nowrap">
                <div className="flex justify-end">
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
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300/80 font-bold text-xs rounded-xl shadow-2xs transition-all active:scale-95 cursor-pointer"
                        >
                            <i className="ti ti-player-play text-xs font-bold text-amber-700" />
                            <span>Process</span>
                        </Link>
                    ) : (
                        <Link
                            to={`/admin/payroll/${payroll.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-600 hover:text-white text-slate-700 font-bold text-xs rounded-xl shadow-2xs group-hover:border-emerald-400 group-hover:text-emerald-700 group-hover:bg-emerald-50/80 transition-all active:scale-95 cursor-pointer"
                        >
                            <i className="ti ti-receipt-2 text-xs font-bold" />
                            <span>View Slip</span>
                        </Link>
                    )}
                </div>
            </td>
        </tr>
    );
});

// ── Memoized Factory Line Banner Row (7 Dedicated Columns, 100% Header & Ledger Alignment) ───
const FactoryLineBannerRow = React.memo(({ group, isExpanded, onToggle }) => {
    const firstItem = group.items[0] || {};
    const startText = firstItem._startFormatted || (firstItem.period_start ? dayjs(firstItem.period_start).format('MMM DD') : '');
    const endText = firstItem._endFormatted || (firstItem.period_end ? dayjs(firstItem.period_end).format('MMM DD, YYYY') : '');

    return (
        <tr
            onClick={onToggle}
            className={`cursor-pointer transition-all duration-150 border-y select-none group/line ${
                isExpanded
                    ? 'bg-emerald-50/75 border-emerald-200 shadow-2xs'
                    : 'bg-slate-50/90 border-slate-200/90 hover:bg-slate-100/90'
            }`}
        >
            {/* 1. Group Identity & Role (27%) */}
            <td className="py-5 px-4 xl:px-6 align-middle">
                <div className="flex items-center gap-3.5 min-w-0">
                    <div
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center text-base transition-all shadow-2xs shrink-0 ${
                            isExpanded
                                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                                : 'bg-slate-900 text-white group-hover/line:bg-emerald-600'
                        }`}
                    >
                        <i className="ti ti-building-factory-2 text-xl" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[15px] font-extrabold text-slate-900 group-hover/line:text-emerald-800 transition-colors truncate">
                                {group.groupName}
                            </span>
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300/60 text-[10px] font-black uppercase tracking-wider rounded-md shrink-0">
                                Group
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span className="text-xs text-slate-600 font-semibold truncate">
                                {group.items.length} {group.items.length === 1 ? 'Worker' : 'Workers'}
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="text-[11px] font-sans text-slate-400">
                                {group.department || 'Production Line'}
                            </span>
                        </div>
                    </div>
                </div>
            </td>

            {/* 2. Pay Cycle Period (15%) */}
            <td className="py-5 px-4 xl:px-6 align-middle">
                <div className="flex flex-col gap-1.5">
                    {startText && endText ? (
                        <span className="text-xs font-semibold text-slate-800 whitespace-nowrap flex items-center gap-1.5">
                            <i className="ti ti-calendar-event text-slate-400 text-sm" />
                            <span>{startText}</span>
                            <span className="text-slate-400 font-normal">→</span>
                            <span>{endText}</span>
                        </span>
                    ) : (
                        <span className="text-xs font-semibold text-slate-700">Current Cycle</span>
                    )}
                    <span className="px-2 py-0.5 bg-emerald-100/70 text-emerald-800 rounded-md text-[10px] font-bold uppercase tracking-wider w-max border border-emerald-200/80">
                        Line Batch
                    </span>
                </div>
            </td>

            {/* 3. Gross Compensation (14%) */}
            <td className="py-5 px-4 xl:px-6 text-right font-mono tabular-nums align-middle">
                <div className="flex flex-col items-end">
                    <span className="font-extrabold text-slate-900 text-sm sm:text-[15px]">
                        ₱{group.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 font-sans uppercase tracking-wider mt-0.5">
                        Group Total
                    </span>
                </div>
            </td>

            {/* 4. Statutory Deductions (17%) */}
            <td className="py-5 px-4 xl:px-6 text-right font-mono tabular-nums align-middle">
                <div className="flex flex-col items-end">
                    <span className="font-extrabold text-rose-600 text-sm sm:text-[15px]">
                        -₱{group.totalDed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 font-sans uppercase tracking-wider mt-0.5">
                        Combined Ded.
                    </span>
                </div>
            </td>

            {/* 5. Net Payout (13%) */}
            <td className="py-5 px-4 xl:px-6 text-right font-mono tabular-nums align-middle">
                <div className="flex flex-col items-end">
                    <span className="text-base sm:text-[17px] font-black text-emerald-600 tracking-tight">
                        ₱{group.totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 font-sans uppercase tracking-wider mt-0.5">
                        Net Take-Home
                    </span>
                </div>
            </td>

            {/* 6. Status (7%) */}
            <td className="py-5 px-4 xl:px-6 text-center align-middle whitespace-nowrap">
                {group.pendingCount === 0 && group.completedCount > 0 ? (
                    <span className="px-3 py-1.5 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 mx-auto bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>Paid</span>
                    </span>
                ) : group.pendingCount > 0 ? (
                    <span className="px-3 py-1.5 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 mx-auto bg-amber-50 text-amber-700 border border-amber-200">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Pending</span>
                    </span>
                ) : (
                    <span className="px-3 py-1.5 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 mx-auto bg-slate-100 text-slate-600 border border-slate-200">
                        <span>Empty</span>
                    </span>
                )}
            </td>

            {/* 7. Actions (7%) */}
            <td className="py-5 px-4 xl:px-6 text-right align-middle whitespace-nowrap">
                <div className="flex justify-end">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggle();
                        }}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 font-bold text-xs rounded-xl shadow-2xs transition-all active:scale-95 cursor-pointer border ${
                            isExpanded
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/20'
                                : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/60'
                        }`}
                        title={isExpanded ? `Collapse ${group.groupName}` : `Inspect workers in ${group.groupName}`}
                    >
                        <span>{isExpanded ? 'Hide' : 'Inspect'}</span>
                        <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'} text-xs font-bold`} />
                    </button>
                </div>
            </td>
        </tr>
    );
});

// ── Memoized Mobile Card Component ───────────────────────────────────────────
const PayrollMobileCard = React.memo(({ payroll, isGroupChild = false, viewMode = 'grouped', rosterCategory = 'all' }) => {
    const statusVisuals = getStatusVisuals(payroll.status);
    const empIdStr = payroll.employee_id !== undefined && payroll.employee_id !== null ? String(payroll.employee_id) : '';
    const isGroupEmp = isFactoryDept(payroll._dept) || Boolean(payroll._line);

    return (
        <div
            className={`p-4 space-y-3 rounded-2xl border transition-all ${
                isGroupChild ? 'bg-white border-slate-200 shadow-2xs border-l-4 border-l-emerald-500' : 'bg-white border-slate-200/90 hover:border-emerald-300 shadow-xs'
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <EmployeeAvatar employee={payroll.employees} employeeId={payroll.employee_id} size="h-10 w-10" theme="emerald" />
                    <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">
                            {payroll._fullName || 'Unknown'}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">
                                {payroll._jobTitle || payroll._dept || 'Staff'} &bull; {payroll._companyId || `#${empIdStr.substring(0, 6)}`}
                            </span>
                            {isGroupEmp ? (
                                (viewMode === 'flat' || !isGroupChild) && (
                                    <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-800 border border-emerald-200/80 rounded text-[9px] font-black uppercase inline-flex items-center gap-0.5">
                                        <i className="ti ti-building-factory-2 text-[10px]" />
                                        <span>Group{payroll._line ? ` • ${payroll._line}` : ''}</span>
                                    </span>
                                )
                            ) : (
                                (viewMode === 'flat' || rosterCategory === 'all') && (
                                    <span className="px-1.5 py-0.2 bg-slate-100 text-slate-600 border border-slate-200/80 rounded text-[9px] font-bold uppercase inline-flex items-center gap-0.5">
                                        <i className="ti ti-user text-[10px]" />
                                        <span>Regular</span>
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                </div>

                <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md flex items-center gap-1 shrink-0 ${statusVisuals.badgeClass}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusVisuals.dotClass}`} /> {statusVisuals.label}
                </span>
            </div>

            <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-500">Pay Period</span>
                    <span className="font-bold text-slate-700 bg-white px-2 py-0.5 rounded-md border border-slate-200/70 text-[11px]">
                        {payroll._startFormatted} &rarr; {payroll._endFormatted}
                    </span>
                </div>

                {payroll.isPending ? (
                    <div className="pt-2 border-t border-slate-200/50 text-xs text-center text-amber-700 font-bold py-1 bg-amber-50/50 rounded-lg">
                        Awaiting Computation for Current Cycle
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/40 text-xs">
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Gross Pay</span>
                                <p className="font-mono font-bold text-slate-800 text-xs">
                                    ₱{payroll._gross.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                            <div className="text-right">
                                <span className="text-[10px] font-bold text-red-400 uppercase">Deductions</span>
                                <p className="font-mono font-bold text-red-500 text-xs">
                                    -₱{payroll._deductions.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </p>
                            </div>
                        </div>

                        <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                            <span className="text-xs font-black uppercase text-slate-600">Net Take-Home Pay</span>
                            <span className="text-base font-black text-emerald-600 font-mono">
                                ₱{payroll._net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                    className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                >
                    <i className="ti ti-player-play text-base" />
                    <span>Process Payroll</span>
                </Link>
            ) : (
                <Link
                    to={`/admin/payroll/${payroll.id}`}
                    className="w-full py-2.5 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer"
                >
                    <i className="ti ti-receipt-2 text-base" />
                    <span>View Full Payslip</span>
                </Link>
            )}
        </div>
    );
});

// ── Main Component ────────────────────────────────────────────────────────────
export default function PayrollIndex() {
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentMonth = searchParams.get('month') || '';
    const currentYear = searchParams.get('year') || '';
    const rawCategory = (searchParams.get('category') || 'all').toLowerCase();
    const rosterCategory = ['all', 'group', 'regular'].includes(rawCategory) ? rawCategory : 'all';

    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearch = useDeferredValue(searchQuery);

    const [selectedDepartment, setSelectedDepartment] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All'); // 'All' | 'Completed' | 'Pending'
    const [viewMode, setViewMode] = useState('grouped'); // 'grouped' (default: Group rows + Regular rows) | 'flat'
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [expandedGroups, setExpandedGroups] = useState({});

    // Sorting Configuration: Default to 'hierarchy' (Group Paid -> Group Pending -> Regular Paid -> Regular Pending)
    const [sortConfig, setSortConfig] = useState({ key: 'hierarchy', direction: 'asc' });

    const handleSort = useCallback((key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                if (prev.direction === 'asc') return { key, direction: 'desc' };
                return { key: 'hierarchy', direction: 'asc' };
            }
            return { key, direction: 'asc' };
        });
    }, []);

    const currentYearNum = new Date().getFullYear();
    const years = Array.from({ length: 4 }, (_, i) => currentYearNum - 2 + i);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    const toggleGroup = useCallback((groupId) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupId]: !prev[groupId]
        }));
    }, []);

    // Real-time Supabase Subscription for zero-latency ledger updates
    useEffect(() => {
        const channel = supabase
            .channel('admin-live-payroll-ledger')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'production_groups' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });
                queryClient.invalidateQueries({ queryKey: ['adminPayrollEligibleEmployees'] });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => {
                queryClient.invalidateQueries({ queryKey: ['adminPayrollEligibleEmployees'] });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [queryClient]);

    // Keyboard shortcuts: ←/→ for pagination, Escape to clear search
    useEffect(() => {
        const handler = (e) => {
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

            if (e.key === 'ArrowLeft') {
                setCurrentPage(prev => Math.max(prev - 1, 1));
            } else if (e.key === 'ArrowRight') {
                setCurrentPage(prev => prev + 1); // clamped by the auto-clamp effect
            } else if (e.key === 'Escape' && searchQuery) {
                setSearchQuery('');
                setCurrentPage(1);
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [searchQuery]);

    const handleCategoryChange = useCallback((cat) => {
        const params = new URLSearchParams(searchParams);
        if (cat === 'group' || cat === 'regular') {
            params.set('category', cat);
        } else {
            params.delete('category'); // 'all' is the default
        }
        setSearchParams(params);
        setCurrentPage(1);
    }, [searchParams, setSearchParams]);

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
        setSortConfig({ key: 'hierarchy', direction: 'asc' });
        setSearchParams(new URLSearchParams());
        setCurrentPage(1);
    };

    const jumpToCurrentCycle = () => {
        const now = new Date();
        const currentM = String(now.getMonth() + 1).padStart(2, '0');
        const currentY = String(now.getFullYear());
        const params = new URLSearchParams(searchParams);
        params.set('month', currentM);
        params.set('year', currentY);
        setSearchParams(params);
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

    const { data: payrolls = [], isLoading: isLoadingPayrolls } = useQuery({
        queryKey: ['adminPayrolls', currentMonth, currentYear],
        queryFn: fetchPayrolls,
        staleTime: 60_000,
        gcTime: 600_000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
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

    const { data: employees = [], isLoading: isLoadingEmployees } = useQuery({
        queryKey: ['adminPayrollEligibleEmployees'],
        queryFn: fetchEmployees,
        staleTime: 120_000,
        gcTime: 600_000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    const isLoading = isLoadingPayrolls || isLoadingEmployees;

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

    // ── Single-Pass Precomputation & Enriched Records (High-Performance Core) ──
    const enrichedRecords = useMemo(() => {
        const computedEmployeeIds = new Set();
        const employeeLastKnownLineMap = {};

        const enrichedActual = payrolls.map(p => {
            const line = getEmployeeLine(p);
            if (line && p.employee_id) {
                employeeLastKnownLineMap[String(p.employee_id)] = line;
            }

            const periodStart = dayjs(p.period_start);
            if (periodStart.isValid() && periodStart.year() === cycleBounds.year && (periodStart.month() + 1) === cycleBounds.month) {
                computedEmployeeIds.add(String(p.employee_id));
            }

            const gross = calculateGrossPay(p);
            const deductions = toSafeNumber(p.deductions || p.total_deductions);
            const net = toSafeNumber(p.net_pay);
            const sss = toSafeNumber(p.sss_deduction);
            const philHealth = toSafeNumber(p.philhealth_deduction);
            const pagIbig = toSafeNumber(p.pagibig_deduction);
            const tax = toSafeNumber(p.tax_deduction);

            const emp = p.employees || {};
            const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
            const companyId = emp.company_id || (emp.id ? String(emp.id).substring(0, 6) : '');
            const dept = emp.department || '';
            const jobTitle = emp.job_title || emp.position || '';

            const searchTokens = `${fullName} ${companyId} ${emp.email || ''} ${jobTitle} ${dept} ${line}`.toLowerCase();

            return {
                ...p,
                _line: line,
                _gross: gross,
                _deductions: deductions,
                _net: net,
                _sss: sss,
                _philHealth: philHealth,
                _pagIbig: pagIbig,
                _tax: tax,
                _fullName: fullName,
                _companyId: companyId,
                _dept: dept,
                _jobTitle: jobTitle,
                _searchTokens: searchTokens,
                _startFormatted: p.period_start ? dayjs(p.period_start).format('MMM DD') : '',
                _endFormatted: p.period_end ? dayjs(p.period_end).format('MMM DD, YYYY') : '',
                isPending: false,
            };
        });

        if (!isActiveCycle) return enrichedActual;

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
            .filter(emp => !computedEmployeeIds.has(String(emp.id)) && !isExcludedStatus(emp))
            .map(emp => {
                const mockPayroll = { employees: emp };
                const inheritedLine = employeeLastKnownLineMap[String(emp.id)];
                const line = inheritedLine || getEmployeeLine(mockPayroll);

                const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
                const companyId = emp.company_id || (emp.id ? String(emp.id).substring(0, 6) : '');
                const dept = emp.department || '';
                const jobTitle = emp.job_title || emp.position || '';
                const searchTokens = `${fullName} ${companyId} ${emp.email || ''} ${jobTitle} ${dept} ${line}`.toLowerCase();

                return {
                    id: `pending-${emp.id}`,
                    employee_id: emp.id,
                    employees: emp,
                    line: line,
                    _line: line,
                    status: 'Pending',
                    period_start: cycleBounds.start,
                    period_end: cycleBounds.end,
                    gross_pay: 0,
                    deductions: 0,
                    net_pay: 0,
                    _gross: 0,
                    _deductions: 0,
                    _net: 0,
                    _sss: 0,
                    _philHealth: 0,
                    _pagIbig: 0,
                    _tax: 0,
                    _fullName: fullName,
                    _companyId: companyId,
                    _dept: dept,
                    _jobTitle: jobTitle,
                    _searchTokens: searchTokens,
                    _startFormatted: dayjs(cycleBounds.start).format('MMM DD'),
                    _endFormatted: dayjs(cycleBounds.end).format('MMM DD, YYYY'),
                    isPending: true,
                };
            });

        return [...enrichedActual, ...pendingEntries];
    }, [payrolls, employees, cycleBounds, isActiveCycle]);

    const departments = useMemo(() => {
        const depts = new Set();
        enrichedRecords.forEach(p => {
            if (p._dept) depts.add(p._dept);
        });
        return ['All', ...Array.from(depts)];
    }, [enrichedRecords]);

    // Live counts across regular, factory groups, and total ledger entries
    const categoryCounts = useMemo(() => {
        const groupSet = new Set();
        let regular = 0;
        let groupWorkers = 0;
        const targetMonth = currentMonth ? parseInt(currentMonth, 10) : null;
        const targetYear = currentYear ? parseInt(currentYear, 10) : null;

        enrichedRecords.forEach(p => {
            const roleStr = (p.employees?.role || '').toLowerCase();
            if (roleStr === 'admin' || roleStr === 'security') return;

            if (targetMonth) {
                const pDate = dayjs(p.period_start || p.period_end);
                if (pDate.isValid() && (pDate.month() + 1) !== targetMonth) return;
            }

            if (targetYear) {
                const pDate = dayjs(p.period_start || p.period_end);
                if (pDate.isValid() && pDate.year() !== targetYear) return;
            }

            if (selectedDepartment !== 'All' && p._dept !== selectedDepartment) return;

            const isGroup = isFactoryDept(p._dept) || Boolean(p._line);
            if (isGroup) {
                groupWorkers++;
                const groupName = p._line || (isFactoryDept(p._dept) ? 'Factory General' : '');
                if (groupName) {
                    const groupId = `factory-line-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                    groupSet.add(groupId);
                }
            } else {
                regular++;
            }
        });

        const groupCount = groupSet.size;
        const allEntries = viewMode === 'flat' ? (groupWorkers + regular) : (groupCount + regular);

        return {
            regular,
            group: groupCount,
            groupWorkers,
            all: allEntries,
            totalWorkers: groupWorkers + regular,
        };
    }, [enrichedRecords, currentMonth, currentYear, selectedDepartment, viewMode]);

    // ── Instant Filter (Sub-millisecond deferred lookup) ────────────────────────
    const filteredPayrolls = useMemo(() => {
        const q = deferredSearch.trim().toLowerCase();
        const targetMonth = currentMonth ? parseInt(currentMonth, 10) : null;
        const targetYear = currentYear ? parseInt(currentYear, 10) : null;

        return enrichedRecords.filter(p => {
            const roleStr = (p.employees?.role || '').toLowerCase();
            if (roleStr === 'admin' || roleStr === 'security') return false;

            if (targetMonth) {
                const pDate = dayjs(p.period_start || p.period_end);
                if (pDate.isValid() && (pDate.month() + 1) !== targetMonth) return false;
            }

            if (targetYear) {
                const pDate = dayjs(p.period_start || p.period_end);
                if (pDate.isValid() && pDate.year() !== targetYear) return false;
            }

            // Worker Category Filter: 'regular' (default) | 'group' | 'all'
            const isGroupWorker = isFactoryDept(p._dept) || Boolean(p._line);
            if (rosterCategory === 'regular' && isGroupWorker) return false;
            if (rosterCategory === 'group' && !isGroupWorker) return false;

            if (filterStatus === 'Completed' && p.status !== 'Completed' && p.status !== 'Paid') return false;
            if (filterStatus === 'Pending' && p.status !== 'Pending' && p.status !== 'Draft') return false;

            if (selectedDepartment !== 'All' && p._dept !== selectedDepartment) return false;

            if (q && !p._searchTokens.includes(q)) {
                return false;
            }

            return true;
        });
    }, [enrichedRecords, currentMonth, currentYear, rosterCategory, filterStatus, selectedDepartment, deferredSearch]);

    // ── High-Performance Client-Side Sorting ───────────────────────────────────
    const sortedPayrolls = useMemo(() => {
        const getTierScores = (p) => {
            const isGroup = isFactoryDept(p._dept) || Boolean(p._line);
            const isPaid = !p.isPending && (p.status === 'Completed' || p.status === 'Paid');
            // Tier 0: Group - Paid
            // Tier 1: Group - Pending
            // Tier 2: Regular - Paid
            // Tier 3: Regular - Pending
            const groupScore = isGroup ? 0 : 1;
            const statusScore = isPaid ? 0 : 1;
            return { isGroup, isPaid, tier: groupScore * 2 + statusScore };
        };

        if (sortConfig.key === 'hierarchy' || !sortConfig.key) {
            return [...filteredPayrolls].sort((a, b) => {
                const scoreA = getTierScores(a);
                const scoreB = getTierScores(b);

                // 1. Primary sort: Enterprise Hierarchy Tier
                // Group Paid (0) -> Group Pending (1) -> Regular Paid (2) -> Regular Pending (3)
                if (scoreA.tier !== scoreB.tier) {
                    return scoreA.tier - scoreB.tier;
                }

                // 2. Secondary sort within tier:
                if (scoreA.isGroup) {
                    const lineA = a._line || '';
                    const lineB = b._line || '';
                    const lineComp = lineA.localeCompare(lineB);
                    if (lineComp !== 0) return lineComp;
                } else {
                    const deptA = a._dept || '';
                    const deptB = b._dept || '';
                    const deptComp = deptA.localeCompare(deptB);
                    if (deptComp !== 0) return deptComp;
                }

                // 3. Tertiary sort: by worker name
                return a._fullName.localeCompare(b._fullName);
            });
        }

        const { key, direction } = sortConfig;
        const factor = direction === 'asc' ? 1 : -1;

        return [...filteredPayrolls].sort((a, b) => {
            if (key === 'name') {
                return factor * a._fullName.localeCompare(b._fullName);
            }
            if (key === 'date') {
                const dateA = a.period_start ? new Date(a.period_start).getTime() : 0;
                const dateB = b.period_start ? new Date(b.period_start).getTime() : 0;
                return factor * (dateA - dateB);
            }
            if (key === 'gross') {
                return factor * (a._gross - b._gross);
            }
            if (key === 'deductions') {
                return factor * (a._deductions - b._deductions);
            }
            if (key === 'net') {
                return factor * (a._net - b._net);
            }
            if (key === 'status') {
                const statusA = (a.status || 'Pending').toLowerCase();
                const statusB = (b.status || 'Pending').toLowerCase();
                return factor * statusA.localeCompare(statusB);
            }
            return 0;
        });
    }, [filteredPayrolls, sortConfig]);

    // ── Executive KPI Metrics (Live financial summary) ──────────────────────────
    const metrics = useMemo(() => {
        let totalNet = 0;
        let totalGross = 0;
        let totalDeductions = 0;
        let totalSSS = 0;
        let totalPhilHealth = 0;
        let totalPagIbig = 0;
        let totalTax = 0;
        let completedCount = 0;
        let pendingCount = 0;

        for (let i = 0; i < filteredPayrolls.length; i++) {
            const p = filteredPayrolls[i];
            if (p.isPending) {
                pendingCount++;
            } else {
                completedCount++;
                totalNet += p._net;
                totalGross += p._gross;
                totalDeductions += p._deductions;
                totalSSS += p._sss;
                totalPhilHealth += p._philHealth;
                totalPagIbig += p._pagIbig;
                totalTax += p._tax;
            }
        }

        const totalCount = completedCount + pendingCount;
        const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

        return {
            totalNet,
            totalGross,
            totalDeductions,
            totalSSS,
            totalPhilHealth,
            totalPagIbig,
            totalTax,
            completedCount,
            pendingCount,
            totalCount,
            completionRate,
        };
    }, [filteredPayrolls]);

    // ── Hierarchical Grouping for 'grouped' View Mode ──────────────────────────
    const ledgerDisplayItems = useMemo(() => {
        const factoryGroupsMap = {};
        const factoryGroupsList = [];
        const regularItems = [];

        sortedPayrolls.forEach(payroll => {
            const isFactory = isFactoryDept(payroll._dept) || Boolean(payroll._line);
            const groupName = payroll._line || (isFactoryDept(payroll._dept) ? 'Factory General' : '');

            if (isFactory && groupName) {
                const groupId = `factory-line-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

                if (!factoryGroupsMap[groupId]) {
                    factoryGroupsMap[groupId] = {
                        type: 'group',
                        id: groupId,
                        groupName,
                        department: payroll._dept || 'Factory',
                        items: [],
                        totalGross: 0,
                        totalDed: 0,
                        totalNet: 0,
                        completedCount: 0,
                        pendingCount: 0,
                    };
                    factoryGroupsList.push(factoryGroupsMap[groupId]);
                }
                const grp = factoryGroupsMap[groupId];
                grp.items.push(payroll);
                if (payroll.isPending) {
                    grp.pendingCount++;
                } else {
                    grp.completedCount++;
                    grp.totalGross += payroll._gross;
                    grp.totalDed += payroll._deductions;
                    grp.totalNet += payroll._net;
                }
            } else {
                regularItems.push({
                    type: 'individual',
                    id: payroll.id || `pending-${payroll.employee_id}`,
                    data: payroll
                });
            }
        });

        // Split factory groups into Paid (0 pending) and Pending (>0 pending)
        const groupPaidList = [];
        const groupPendingList = [];

        factoryGroupsList.forEach(grp => {
            // Ensure workers within each factory group are sorted Paid first, then Pending
            grp.items.sort((a, b) => {
                const aPaid = !a.isPending && (a.status === 'Completed' || a.status === 'Paid') ? 0 : 1;
                const bPaid = !b.isPending && (b.status === 'Completed' || b.status === 'Paid') ? 0 : 1;
                if (aPaid !== bPaid) return aPaid - bPaid;
                return a._fullName.localeCompare(b._fullName);
            });

            if (grp.pendingCount === 0 && grp.completedCount > 0) {
                groupPaidList.push(grp);
            } else {
                groupPendingList.push(grp);
            }
        });

        groupPaidList.sort((a, b) => a.groupName.localeCompare(b.groupName));
        groupPendingList.sort((a, b) => a.groupName.localeCompare(b.groupName));

        // Split regular staff into Paid and Pending
        const regularPaidItems = [];
        const regularPendingItems = [];

        regularItems.forEach(item => {
            const p = item.data;
            const isPaid = !p.isPending && (p.status === 'Completed' || p.status === 'Paid');
            if (isPaid) {
                regularPaidItems.push(item);
            } else {
                regularPendingItems.push(item);
            }
        });

        regularPaidItems.sort((a, b) => a.data._fullName.localeCompare(b.data._fullName));
        regularPendingItems.sort((a, b) => a.data._fullName.localeCompare(b.data._fullName));

        // Strict 4-Tier Hierarchy Order requested by user:
        // group - paid
        // group - paid
        // group - pending
        // regular - paid
        // regular - paid
        // regular - pending
        return [
            ...groupPaidList,
            ...groupPendingList,
            ...regularPaidItems,
            ...regularPendingItems
        ];
    }, [sortedPayrolls]);

    const hasFactoryGroups = useMemo(() => {
        return ledgerDisplayItems.some(i => i.type === 'group');
    }, [ledgerDisplayItems]);

    const isAllGroupsExpanded = useMemo(() => {
        const groupItems = ledgerDisplayItems.filter(i => i.type === 'group');
        if (groupItems.length === 0) return false;
        return groupItems.every(g => expandedGroups[g.id]);
    }, [ledgerDisplayItems, expandedGroups]);

    const toggleAllGroups = useCallback(() => {
        setExpandedGroups(prev => {
            const groupIds = ledgerDisplayItems.filter(i => i.type === 'group').map(g => g.id);
            const areAllExpanded = groupIds.length > 0 && groupIds.every(id => prev[id]);
            const next = {};
            groupIds.forEach(id => {
                next[id] = !areAllExpanded;
            });
            return next;
        });
    }, [ledgerDisplayItems]);

    // ── 1-Click Enterprise CSV Export ───────────────────────────────────────────
    const handleExportCSV = useCallback(() => {
        if (filteredPayrolls.length === 0) {
            toast.error('No payroll records to export');
            return;
        }

        const headers = [
            'Payroll ID',
            'Employee ID',
            'Company ID',
            'Employee Name',
            'Department',
            'Production Line',
            'Position / Title',
            'Period Start',
            'Period End',
            'Gross Pay',
            'SSS Deduction',
            'PhilHealth Deduction',
            'Pag-IBIG Deduction',
            'Withholding Tax',
            'Total Deductions',
            'Net Take-Home Pay',
            'Status'
        ];

        const escapeCSV = (val) => {
            if (val === null || val === undefined) return '""';
            const str = String(val).replace(/"/g, '""');
            return `"${str}"`;
        };

        const rows = filteredPayrolls.map(p => [
            escapeCSV(p.id || ''),
            escapeCSV(p.employee_id || ''),
            escapeCSV(p._companyId || ''),
            escapeCSV(p._fullName || ''),
            escapeCSV(p._dept || ''),
            escapeCSV(p._line || 'N/A'),
            escapeCSV(p._jobTitle || ''),
            escapeCSV(p.period_start || ''),
            escapeCSV(p.period_end || ''),
            p._gross.toFixed(2),
            p._sss.toFixed(2),
            p._philHealth.toFixed(2),
            p._pagIbig.toFixed(2),
            p._tax.toFixed(2),
            p._deductions.toFixed(2),
            p._net.toFixed(2),
            escapeCSV(p.status || 'Pending')
        ]);

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const filename = `c-point-payroll-ledger-${rosterCategory}-${currentYear || 'all'}-${currentMonth || 'all'}-${dayjs().format('YYYYMMDD-HHmm')}.csv`;
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(`Exported ${filteredPayrolls.length} payroll entries to CSV!`);
    }, [filteredPayrolls, rosterCategory, currentYear, currentMonth]);

    const isFiltered = Boolean(
        currentMonth ||
        currentYear ||
        (searchParams.get('category') && searchParams.get('category') !== 'all') ||
        sortConfig.key !== 'hierarchy' ||
        searchQuery.trim() ||
        selectedDepartment !== 'All' ||
        filterStatus !== 'All'
    );

    // Dynamic Display Items based on View Mode:
    // 'grouped': shows section banners for factory lines + non-factory workers
    // 'flat': shows individual rows for every worker directly
    const displayList = useMemo(() => {
        if (viewMode === 'flat') {
            return sortedPayrolls.map(p => ({
                type: 'individual',
                id: p.id || `pending-${p.employee_id}`,
                data: p,
            }));
        }
        return ledgerDisplayItems;
    }, [viewMode, sortedPayrolls, ledgerDisplayItems]);

    const totalItems = displayList.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 1;

    // Auto-clamp page when filters reduce total pages below current page
    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const paginatedDisplayItems = displayList.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    return (
        <div className="w-full pb-24 lg:pb-8 font-sans space-y-5">
            <PageHeader
                breadcrumbs={['Admin', 'Finance', 'Payroll Ledger']}
                title="Payroll Ledger"
                description="Executive wage ledger, DOLE statutory compliance audit, and multi-line batch distributions."
                actions={
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-xs sm:text-sm transition-all flex items-center gap-1.5 border border-slate-200 shadow-2xs cursor-pointer active:scale-95"
                            title="Export filtered records to CSV"
                        >
                            <i className="ti ti-download text-base text-slate-500" />
                            <span>Export CSV</span>
                        </button>

                        <Link
                            to="/admin/payroll/statutory-settings"
                            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-xs sm:text-sm transition-all flex items-center gap-1.5 border border-slate-200 shadow-2xs active:scale-95"
                        >
                            <i className="ti ti-adjustments-horizontal text-base text-slate-500" />
                            <span>Statutory Settings</span>
                        </Link>

                        <Link
                            to="/admin/payroll/process"
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs sm:text-sm transition-all shadow-xs flex items-center gap-1.5 active:scale-95 cursor-pointer"
                        >
                            <i className="ti ti-calculator text-base" />
                            <span>Compute Payroll</span>
                        </Link>
                    </div>
                }
            />

            {/* Executive Financial KPI Metric Ribbon */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Net Disbursement */}
                <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-2xs bg-gradient-to-br from-emerald-50/40 via-white to-white flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] sm:text-xs font-bold text-emerald-800 uppercase tracking-wider">
                            Total Net Payout
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold shadow-2xs">
                            <i className="ti ti-cash" />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-emerald-600 tracking-tight">
                            ₱{metrics.totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            Processed take-home disbursement
                        </p>
                    </div>
                </div>

                {/* 2. Total Gross Compensation */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Gross Compensation
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-sm font-bold shadow-2xs">
                            <i className="ti ti-calculator" />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-slate-900 tracking-tight">
                            ₱{metrics.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            Total wages before deductions
                        </p>
                    </div>
                </div>

                {/* 3. Statutory Deductions Remittance */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Statutory Deductions
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-sm font-bold shadow-2xs">
                            <i className="ti ti-scale" />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="text-xl sm:text-2xl font-black font-mono tabular-nums text-rose-500 tracking-tight">
                            -₱{metrics.totalDeductions.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <p
                            className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate"
                            title={`SSS: ₱${metrics.totalSSS.toFixed(2)} | PH: ₱${metrics.totalPhilHealth.toFixed(2)} | HDMF: ₱${metrics.totalPagIbig.toFixed(2)} | Tax: ₱${metrics.totalTax.toFixed(2)}`}
                        >
                            SSS, PhilHealth, HDMF &amp; BIR Tax
                        </p>
                    </div>
                </div>

                {/* 4. Audit Coverage / Status Progress */}
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
                            Cycle Audit Health
                        </span>
                        <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-bold shadow-2xs">
                            <i className="ti ti-shield-check" />
                        </div>
                    </div>
                    <div className="mt-2.5">
                        <div className="flex items-baseline justify-between">
                            <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                                {metrics.completionRate}%
                            </div>
                            <span className="text-xs font-bold text-slate-500">
                                <span className="text-emerald-600 font-black">{metrics.completedCount}</span> / {metrics.totalCount} Paid
                            </span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1.5">
                            <div
                                className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                                style={{ width: `${metrics.completionRate}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="bg-white p-3 sm:p-4 rounded-2xl shadow-2xs border border-slate-200 space-y-3">
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                    {/* Search input */}
                    <div className="relative flex-1 min-w-[240px]">
                        <i className="ti ti-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search employee name, company ID, line (Line A), position..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-10 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/15 focus:border-emerald-500 transition-all"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                                title="Clear search"
                            >
                                <i className="ti ti-x text-sm font-bold" />
                            </button>
                        )}
                    </div>

                    {/* Worker Category Switcher (All Personnel = Default, Factory Groups, Regular Staff) */}
                    <div className="flex items-center bg-slate-100/90 p-0.5 rounded-xl border border-slate-200/60 shrink-0">
                        <button
                            type="button"
                            onClick={() => handleCategoryChange('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                rosterCategory === 'all'
                                    ? 'bg-white text-slate-900 shadow-2xs font-extrabold'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="All Personnel (Default: Group Paid -> Group Pending -> Regular Paid -> Regular Pending)"
                        >
                            <i className="ti ti-users text-sm" />
                            <span>All</span>
                            <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono tabular-nums ${
                                rosterCategory === 'all' ? 'bg-slate-200 text-slate-900 font-bold' : 'bg-slate-200/70 text-slate-500'
                            }`}>
                                {categoryCounts.all}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCategoryChange('group')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                rosterCategory === 'group'
                                    ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Factory Production Lines & Groups (Paid first, then Pending)"
                        >
                            <i className="ti ti-building-factory-2 text-sm" />
                            <span>Group</span>
                            <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono tabular-nums ${
                                rosterCategory === 'group' ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-slate-200 text-slate-600'
                            }`}>
                                {categoryCounts.group}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleCategoryChange('regular')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                rosterCategory === 'regular'
                                    ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                                    : 'text-slate-500 hover:text-slate-800'
                            }`}
                            title="Regular Corporate / Individual Staff (Paid first, then Pending)"
                        >
                            <i className="ti ti-user text-sm" />
                            <span>Regular</span>
                            <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono tabular-nums ${
                                rosterCategory === 'regular' ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-slate-200 text-slate-600'
                            }`}>
                                {categoryCounts.regular}
                            </span>
                        </button>
                    </div>

                    {/* View Mode Toggle: Grouped vs Flat */}
                    {rosterCategory !== 'regular' && (
                        <div className="flex items-center bg-slate-100/90 p-0.5 rounded-xl border border-slate-200/60 shrink-0">
                            <button
                                type="button"
                                onClick={() => { setViewMode('grouped'); setCurrentPage(1); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                    viewMode === 'grouped'
                                        ? 'bg-white text-slate-900 shadow-2xs'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                                title="Group factory workers under line summary units"
                            >
                                <i className="ti ti-layout-distribute-vertical text-sm" />
                                <span className="hidden sm:inline">Grouped</span>
                                <span className="sm:hidden">Grouped</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => { setViewMode('flat'); setCurrentPage(1); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                                    viewMode === 'flat'
                                        ? 'bg-white text-slate-900 shadow-2xs'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                                title="Show flat list of all workers"
                            >
                                <i className="ti ti-list text-sm" />
                                <span className="hidden sm:inline">Flat Roster</span>
                                <span className="sm:hidden">Flat</span>
                            </button>
                        </div>
                    )}

                    {/* Status Pill Tabs */}
                    <div className="flex bg-slate-100/80 p-0.5 rounded-xl overflow-x-auto no-scrollbar shrink-0 gap-1">
                        {[
                            { id: 'All', label: 'All', count: metrics.totalCount },
                            { id: 'Completed', label: 'Completed', count: metrics.completedCount, dot: 'bg-emerald-500' },
                            { id: 'Pending', label: 'Pending', count: metrics.pendingCount, dot: 'bg-amber-500', alert: metrics.pendingCount > 0 },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => { setFilterStatus(tab.id); setCurrentPage(1); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                                    filterStatus === tab.id
                                        ? (tab.id === 'Completed'
                                            ? 'bg-emerald-600 text-white shadow-2xs'
                                            : tab.id === 'Pending'
                                                ? 'bg-amber-500 text-white shadow-2xs'
                                                : 'bg-slate-900 text-white shadow-2xs')
                                        : 'text-slate-500 hover:text-slate-900'
                                }`}
                            >
                                {tab.dot && <span className={`w-1.5 h-1.5 rounded-full ${tab.dot}`} />}
                                <span>{tab.label}</span>
                                <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono tabular-nums ${
                                    filterStatus === tab.id
                                        ? 'bg-white/20 text-white'
                                        : tab.alert
                                            ? 'bg-amber-100 text-amber-800 font-bold'
                                            : 'bg-slate-200/80 text-slate-600'
                                }`}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Filter controls row */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        {/* Worker Category Select (All Personnel = Default) */}
                        <div className="relative min-w-[145px] flex-1 sm:flex-initial">
                            <select
                                value={rosterCategory}
                                onChange={(e) => handleCategoryChange(e.target.value)}
                                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
                            >
                                <option value="all">All Personnel ({categoryCounts.all})</option>
                                <option value="group">Factory Groups ({categoryCounts.group})</option>
                                <option value="regular">Regular Staff ({categoryCounts.regular})</option>
                            </select>
                            <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                        </div>

                        {/* Month Select */}
                        <div className="relative min-w-[130px] flex-1 sm:flex-initial">
                            <select
                                value={currentMonth}
                                onChange={handleMonthChange}
                                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
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

                        {/* Year Select */}
                        <div className="relative min-w-[110px] flex-1 sm:flex-initial">
                            <select
                                value={currentYear}
                                onChange={handleYearChange}
                                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
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
                                    className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-bold text-slate-700 outline-none cursor-pointer focus:border-emerald-500 transition-colors"
                                >
                                    <option value="All">All Departments</option>
                                    {departments.filter(d => d !== 'All').map(d => (
                                        <option key={d} value={d}>{d}</option>
                                    ))}
                                </select>
                                <i className="ti ti-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none" />
                            </div>
                        )}

                        {!isActiveCycle && (
                            <button
                                type="button"
                                onClick={jumpToCurrentCycle}
                                className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                title="Jump to current active payroll cycle"
                            >
                                <i className="ti ti-calendar-event text-xs" />
                                <span>Current Cycle</span>
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2.5 ml-auto flex-wrap">
                        {sortConfig.key === 'hierarchy' ? (
                            <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200/80 rounded-xl text-[11px] font-bold">
                                <i className="ti ti-arrows-sort text-xs text-emerald-600" />
                                <span>Group (Paid → Pending) → Regular (Paid → Pending)</span>
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setSortConfig({ key: 'hierarchy', direction: 'asc' })}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                title="Restore Group/Regular Paid-First Order"
                            >
                                <i className="ti ti-rotate-clockwise text-xs" />
                                <span>Restore Hierarchy Order</span>
                            </button>
                        )}

                        {rosterCategory !== 'regular' && viewMode === 'grouped' && hasFactoryGroups && (
                            <button
                                type="button"
                                onClick={toggleAllGroups}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                title={isAllGroupsExpanded ? 'Collapse all factory lines' : 'Expand all factory lines'}
                            >
                                <i className={`ti ti-${isAllGroupsExpanded ? 'fold' : 'unfold'} text-xs`} />
                                <span>{isAllGroupsExpanded ? 'Collapse Lines' : 'Expand Lines'}</span>
                            </button>
                        )}

                        <span className="text-[11px] font-bold text-slate-400">
                            {totalItems} {totalItems === 1 ? 'entry' : 'entries'} listed
                        </span>

                        {isFiltered && (
                            <button
                                type="button"
                                onClick={handleClearFilters}
                                className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer"
                                title="Reset all filters"
                            >
                                <i className="ti ti-filter-off text-xs" />
                                <span>Reset</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Table & Content Container */}
            <div className="bg-white rounded-2xl shadow-2xs border border-slate-200 overflow-hidden">
                {isLoading ? (
                    /* Enterprise Skeleton — matches real table structure for zero layout shift */
                    <div className="animate-pulse">
                        <div className="hidden md:block w-full overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <colgroup>
                                    <col className="w-[27%]" />
                                    <col className="w-[15%]" />
                                    <col className="w-[14%]" />
                                    <col className="w-[17%]" />
                                    <col className="w-[13%]" />
                                    <col className="w-[7%]" />
                                    <col className="w-[7%]" />
                                </colgroup>
                                <thead className="bg-slate-50/90 border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-32 bg-slate-200 rounded" /></th>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-24 bg-slate-200 rounded" /></th>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-20 bg-slate-200 rounded ml-auto" /></th>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-24 bg-slate-200 rounded ml-auto" /></th>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-20 bg-slate-200 rounded ml-auto" /></th>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-14 bg-slate-200 rounded mx-auto" /></th>
                                        <th className="px-4 xl:px-6 py-4.5"><div className="h-3.5 w-14 bg-slate-200 rounded ml-auto" /></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                                        <tr key={n}>
                                            <td className="px-4 xl:px-6 py-5">
                                                <div className="flex items-center gap-3.5">
                                                    <div className="h-11 w-11 rounded-full bg-slate-200 shrink-0" />
                                                    <div className="space-y-2 flex-1">
                                                        <div className="h-4 bg-slate-200 rounded" style={{ width: `${60 + (n * 5) % 30}%` }} />
                                                        <div className="h-2.5 bg-slate-100 rounded w-2/3" />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 xl:px-6 py-5"><div className="h-3.5 w-28 bg-slate-100 rounded" /><div className="h-2.5 w-16 bg-slate-100 rounded mt-2" /></td>
                                            <td className="px-4 xl:px-6 py-5 text-right"><div className="h-4 w-24 bg-slate-200 rounded ml-auto" /></td>
                                            <td className="px-4 xl:px-6 py-5 text-right"><div className="h-4 w-28 bg-rose-100 rounded ml-auto" /><div className="h-2.5 w-20 bg-slate-100 rounded ml-auto mt-1.5" /></td>
                                            <td className="px-4 xl:px-6 py-5 text-right"><div className="h-4.5 w-24 bg-emerald-100 rounded ml-auto" /></td>
                                            <td className="px-4 xl:px-6 py-5 text-center"><div className="h-6 w-20 bg-slate-100 rounded-lg mx-auto" /></td>
                                            <td className="px-4 xl:px-6 py-5 text-right"><div className="h-8 w-24 bg-slate-100 rounded-xl ml-auto" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="block md:hidden p-3 space-y-3">
                            {[1, 2, 3, 4].map(n => (
                                <div key={n} className="p-4 rounded-2xl border border-slate-200 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-slate-200 shrink-0" />
                                        <div className="space-y-1.5 flex-1">
                                            <div className="h-3.5 bg-slate-200 rounded w-3/4" />
                                            <div className="h-2.5 bg-slate-100 rounded w-1/2" />
                                        </div>
                                        <div className="h-5 w-16 bg-slate-100 rounded-md shrink-0" />
                                    </div>
                                    <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                                        <div className="h-3 bg-slate-100 rounded w-full" />
                                        <div className="h-3 bg-slate-100 rounded w-2/3" />
                                    </div>
                                    <div className="h-9 bg-slate-200 rounded-xl" />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Mobile View */}
                        <div className="block md:hidden p-3 space-y-3">
                            {paginatedDisplayItems.length > 0 ? paginatedDisplayItems.map((item) => {
                                if (item.type === 'individual') {
                                    return <PayrollMobileCard key={item.id} payroll={item.data} viewMode={viewMode} rosterCategory={rosterCategory} />;
                                }

                                const isExpanded = Boolean(expandedGroups[item.id]);

                                return (
                                    <div key={item.id} className="border-2 border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
                                        <div
                                            onClick={() => toggleGroup(item.id)}
                                            className="p-4 bg-slate-100/90 hover:bg-slate-200/60 cursor-pointer space-y-3 transition-colors"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
                                                        <i className="ti ti-building-factory-2" />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            <h3 className="text-sm font-black text-slate-800">{item.groupName}</h3>
                                                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase rounded-md">
                                                                Factory Line
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                                            {item.items.length} Total {item.items.length === 1 ? 'Worker' : 'Workers'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button type="button" className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer">
                                                    <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'} text-lg`} />
                                                </button>
                                            </div>

                                            <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1.5 text-xs font-mono tabular-nums">
                                                <div className="flex justify-between font-sans">
                                                    <span className="text-slate-500 font-bold">Processed Line Gross</span>
                                                    <span className="font-mono font-bold text-slate-700">
                                                        ₱{item.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between font-sans">
                                                    <span className="text-red-500 font-bold">Processed Line Deductions</span>
                                                    <span className="font-mono font-bold text-red-500">
                                                        -₱{item.totalDed.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                                <div className="pt-2 border-t border-slate-100 flex justify-between items-center font-sans">
                                                    <span className="font-black text-slate-600 uppercase text-[10px]">Line Net Take-Home</span>
                                                    <span className="text-base font-black text-emerald-600 font-mono">
                                                        ₱{item.totalNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between text-xs font-bold pt-1">
                                                <div className="flex items-center gap-1.5">
                                                    {item.completedCount > 0 && (
                                                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black rounded-md">
                                                            {item.completedCount} Paid
                                                        </span>
                                                    )}
                                                    {item.pendingCount > 0 && (
                                                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-black rounded-md">
                                                            {item.pendingCount} Pending
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-emerald-600 text-xs font-black flex items-center gap-1">
                                                    {isExpanded ? 'Collapse' : 'Inspect Roster'}
                                                    <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'} text-lg`} />
                                                </span>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-3">
                                                {item.items.map(payroll => (
                                                    <PayrollMobileCard key={payroll.id || `m-${payroll.employee_id}`} payroll={payroll} isGroupChild={true} viewMode={viewMode} rosterCategory={rosterCategory} />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            }) : (
                                <div className="p-8 text-center text-slate-400 bg-white rounded-xl">
                                    <i className="ti ti-receipt-off text-3xl text-slate-300 block mb-2" />
                                    <p className="text-xs font-bold text-slate-600">No payroll records found</p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">Try adjusting your filters or search terms.</p>
                                </div>
                            )}
                        </div>

                        {/* Desktop Table View - 7 Dedicated Perfectly Aligned Columns */}
                        <div className="hidden md:block w-full overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <colgroup>
                                    <col className="w-[27%]" />
                                    <col className="w-[15%]" />
                                    <col className="w-[14%]" />
                                    <col className="w-[17%]" />
                                    <col className="w-[13%]" />
                                    <col className="w-[7%]" />
                                    <col className="w-[7%]" />
                                </colgroup>
                                <thead className="bg-slate-50/95 backdrop-blur-sm text-slate-500 text-[11px] uppercase tracking-wider font-bold border-b border-slate-200 select-none sticky top-0 z-10">
                                    <tr>
                                        {/* 1. Worker & Role */}
                                        <th
                                            onClick={() => handleSort('name')}
                                            className="px-4 xl:px-6 py-4.5 cursor-pointer hover:bg-slate-100/80 transition-colors group align-middle text-left"
                                            title="Sort by Worker Name"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span>Worker &amp; Role</span>
                                                <i className={`ti ${
                                                    sortConfig.key === 'name'
                                                        ? (sortConfig.direction === 'asc' ? 'ti-arrow-up text-emerald-600 font-bold' : 'ti-arrow-down text-emerald-600 font-bold')
                                                        : 'ti-arrows-sort text-slate-300 opacity-0 group-hover:opacity-100'
                                                } text-xs transition-opacity`} />
                                            </div>
                                        </th>

                                        {/* 2. Pay Cycle Period */}
                                        <th
                                            onClick={() => handleSort('date')}
                                            className="px-4 xl:px-6 py-4.5 cursor-pointer hover:bg-slate-100/80 transition-colors group align-middle text-left"
                                            title="Sort by Period Date"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span>Cycle Period</span>
                                                <i className={`ti ${
                                                    sortConfig.key === 'date'
                                                        ? (sortConfig.direction === 'asc' ? 'ti-arrow-up text-emerald-600 font-bold' : 'ti-arrow-down text-emerald-600 font-bold')
                                                        : 'ti-arrows-sort text-slate-300 opacity-0 group-hover:opacity-100'
                                                } text-xs transition-opacity`} />
                                            </div>
                                        </th>

                                        {/* 3. Gross Compensation */}
                                        <th
                                            onClick={() => handleSort('gross')}
                                            className="px-4 xl:px-6 py-4.5 text-right cursor-pointer hover:bg-slate-100/80 transition-colors group align-middle"
                                            title="Sort by Gross Pay"
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                <i className={`ti ${
                                                    sortConfig.key === 'gross'
                                                        ? (sortConfig.direction === 'asc' ? 'ti-arrow-up text-emerald-600 font-bold' : 'ti-arrow-down text-emerald-600 font-bold')
                                                        : 'ti-arrows-sort text-slate-300 opacity-0 group-hover:opacity-100'
                                                } text-xs transition-opacity`} />
                                                <span>Gross Pay</span>
                                            </div>
                                        </th>

                                        {/* 4. Statutory Deductions */}
                                        <th
                                            onClick={() => handleSort('deductions')}
                                            className="px-4 xl:px-6 py-4.5 text-right cursor-pointer hover:bg-slate-100/80 transition-colors group align-middle"
                                            title="Sort by Deductions"
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                <i className={`ti ${
                                                    sortConfig.key === 'deductions'
                                                        ? (sortConfig.direction === 'asc' ? 'ti-arrow-up text-emerald-600 font-bold' : 'ti-arrow-down text-emerald-600 font-bold')
                                                        : 'ti-arrows-sort text-slate-300 opacity-0 group-hover:opacity-100'
                                                } text-xs transition-opacity`} />
                                                <span>Deductions</span>
                                            </div>
                                        </th>

                                        {/* 5. Net Payout */}
                                        <th
                                            onClick={() => handleSort('net')}
                                            className="px-4 xl:px-6 py-4.5 text-right cursor-pointer hover:bg-slate-100/80 transition-colors group align-middle"
                                            title="Sort by Net Payout"
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                <i className={`ti ${
                                                    sortConfig.key === 'net'
                                                        ? (sortConfig.direction === 'asc' ? 'ti-arrow-up text-emerald-600 font-bold' : 'ti-arrow-down text-emerald-600 font-bold')
                                                        : 'ti-arrows-sort text-slate-300 opacity-0 group-hover:opacity-100'
                                                } text-xs transition-opacity`} />
                                                <span>Net Payout</span>
                                            </div>
                                        </th>

                                        {/* 6. Status */}
                                        <th
                                            onClick={() => handleSort('status')}
                                            className="px-4 xl:px-6 py-4.5 text-center cursor-pointer hover:bg-slate-100/80 transition-colors group align-middle"
                                            title="Sort by Status"
                                        >
                                            <div className="flex items-center justify-center gap-2">
                                                <span>Status</span>
                                                <i className={`ti ${
                                                    sortConfig.key === 'status'
                                                        ? (sortConfig.direction === 'asc' ? 'ti-arrow-up text-emerald-600 font-bold' : 'ti-arrow-down text-emerald-600 font-bold')
                                                        : 'ti-arrows-sort text-slate-300 opacity-0 group-hover:opacity-100'
                                                } text-xs transition-opacity`} />
                                            </div>
                                        </th>

                                        {/* 7. Actions */}
                                        <th className="px-4 xl:px-6 py-4.5 text-right align-middle">
                                            <span>Actions</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100/80 text-xs [&>tr:nth-child(even):not(:hover)]:bg-slate-50/20">
                                    {paginatedDisplayItems.length > 0 ? paginatedDisplayItems.map((item) => {
                                        if (item.type === 'individual') {
                                            return <PayrollTableRow key={item.id} payroll={item.data} viewMode={viewMode} rosterCategory={rosterCategory} />;
                                        }

                                        const isExpanded = Boolean(expandedGroups[item.id]);

                                        return (
                                            <React.Fragment key={item.id}>
                                                {/* Factory Line Banner Row - 7 Dedicated Aligned Columns */}
                                                <FactoryLineBannerRow
                                                    group={item}
                                                    isExpanded={isExpanded}
                                                    onToggle={() => toggleGroup(item.id)}
                                                />

                                                {/* Expanded Child Rows */}
                                                {isExpanded && item.items.map(payroll => (
                                                    <PayrollTableRow
                                                        key={payroll.id || `r-${payroll.employee_id}`}
                                                        payroll={payroll}
                                                        isGroupChild={true}
                                                        viewMode={viewMode}
                                                        rosterCategory={rosterCategory}
                                                    />
                                                ))}
                                            </React.Fragment>
                                        );
                                    }) : (
                                        <tr>
                                            <td colSpan={7} className="px-8 py-20 text-center">
                                                <div className="flex flex-col items-center justify-center text-slate-400 space-y-2">
                                                    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 text-3xl shadow-2xs">
                                                        <i className="ti ti-receipt-off" />
                                                    </div>
                                                    <p className="text-base font-black text-slate-800 tracking-tight">No Records Found</p>
                                                    <p className="text-xs text-slate-400 font-medium max-w-sm">
                                                        No payroll entries matched your search or cycle filters. Click "Compute Payroll" to generate new entries.
                                                    </p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Footer */}
                        <div className="px-4 sm:px-8 py-3.5 border-t border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 font-bold">
                            <div className="flex items-center gap-4 flex-wrap">
                                {totalItems > 0 ? (
                                    <span>
                                        Showing <span className="text-slate-800 font-black">{(currentPage - 1) * pageSize + 1}</span> - <span className="text-slate-800 font-black">{Math.min(currentPage * pageSize, totalItems)}</span> of <span className="text-slate-800 font-black">{totalItems}</span> {rosterCategory === 'regular' ? 'regular staff' : (rosterCategory === 'group' ? (viewMode === 'grouped' ? (totalItems === 1 ? 'factory group' : 'factory groups') : 'factory workers') : (viewMode === 'grouped' ? 'entries' : 'personnel'))}
                                    </span>
                                ) : (
                                    <span>Showing <span className="text-slate-800 font-black">0</span> of <span className="text-slate-800 font-black">0</span></span>
                                )}

                                <div className="flex items-center gap-1.5 text-slate-400 font-medium">
                                    <span>Show</span>
                                    <select
                                        value={pageSize}
                                        onChange={(e) => {
                                            setPageSize(Number(e.target.value));
                                            setCurrentPage(1);
                                        }}
                                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer hover:border-slate-300 shadow-2xs"
                                    >
                                        <option value={10}>10</option>
                                        <option value={25}>25</option>
                                        <option value={50}>50</option>
                                        <option value={100}>100</option>
                                    </select>
                                    <span>per page</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="ti ti-chevron-left text-sm" />
                                    <span>Prev</span>
                                </button>

                                <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl text-slate-800 font-black text-xs shadow-2xs">
                                    {currentPage} / {totalPages}
                                </span>

                                <button
                                    type="button"
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                    disabled={currentPage >= totalPages}
                                    className="px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
                                >
                                    <span>Next</span>
                                    <i className="ti ti-chevron-right text-sm" />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}