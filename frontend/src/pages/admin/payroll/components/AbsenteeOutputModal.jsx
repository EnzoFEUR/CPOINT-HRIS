import React, { useMemo } from 'react';
import EmployeeAvatar from '../../../../components/EmployeeAvatar';
const AbsenteeOutputModal = ({
    isOpen,
    onClose,
    absenteeInfo,
    computedFactoryRows,
    absenteeOutputs,
    setAbsenteeOutputs,
    absenteeValidation,
    holidayRateMultiplier
}) => {
    // Group the paid operations each absent worker is assigned to.
    const workerSections = useMemo(() => {
        return Object.values(absenteeInfo || {}).map(info => {
            const idStr = String(info.employee.id);
            const rows = (computedFactoryRows || []).filter(
                row => row.totalPrice > 0 && (row.absenteeIdsOnRow || []).includes(idStr)
            );
            const declaredTotal = rows.reduce((sum, row) => {
                const q = parseFloat(absenteeOutputs?.[idStr]?.[row.id]);
                return sum + (isNaN(q) ? 0 : q * row.effectiveAmt);
            }, 0);
            return { ...info, idStr, rows, declaredTotal };
        }).filter(section => section.rows.length > 0);
    }, [absenteeInfo, computedFactoryRows, absenteeOutputs]);

    if (!isOpen) return null;

    const setQty = (empId, rowId, value) => {
        if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
        setAbsenteeOutputs(prev => ({
            ...prev,
            [empId]: { ...(prev[empId] || {}), [rowId]: value }
        }));
    };

    const missingCount = absenteeValidation?.missing?.length || 0;
    const overDeclaredCount = absenteeValidation?.overDeclaredRows?.length || 0;
    const canClose = missingCount === 0 && overDeclaredCount === 0;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] sm:max-h-[88vh] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                        <h3 className="text-sm sm:text-base font-extrabold text-slate-800 flex items-center gap-2">
                            <i className="ti ti-user-exclamation text-lg text-amber-600" />
                            Declare output for workers who missed days
                        </h3>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            {workerSections.length} worker{workerSections.length === 1 ? '' : 's'} missed days and share a process with someone else.
                            Enter the quantity each one actually finished so their pay is based on real output, not a day-weighted split.
                            Workers who handle a process alone are not listed &mdash; they keep that process in full.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer shrink-0"
                        aria-label="Close"
                    >
                        <i className="ti ti-x text-lg" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50/60">
                    {workerSections.length === 0 ? (
                        <div className="text-center py-10">
                            <i className="ti ti-checks text-3xl text-emerald-500" />
                            <p className="text-xs font-bold text-slate-700 mt-2">Nothing to declare</p>
                            <p className="text-[11px] text-slate-400">
                                Either everyone was present for the whole cutoff, or each absent worker handles their process alone and already keeps its full total.
                            </p>
                        </div>
                    ) : workerSections.map(section => (
                        <div key={section.idStr} className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <EmployeeAvatar employee={section.employee} size="h-9 w-9" textSize="text-[11px]" />
                                    <div className="min-w-0">
                                        <span className="font-bold text-slate-800 text-xs block truncate">
                                            {section.employee.first_name} {section.employee.last_name}
                                        </span>
                                        <span className="text-[10px] font-semibold text-slate-400 block truncate">
                                            {section.employee.job_title || section.employee.position || 'No Title'}
                                        </span>
                                    </div>
                                </div>
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg shrink-0 text-center leading-tight">
                                    {section.daysPresent}/{section.expectedWorkingDays} days
                                    <span className="block font-extrabold">
                                        {section.daysAbsent} absent
                                    </span>
                                </span>
                            </div>

                            <div className="divide-y divide-slate-100">
                                {section.rows.map(row => {
                                    const raw = absenteeOutputs?.[section.idStr]?.[row.id] ?? '';
                                    const qty = parseFloat(raw);
                                    const hasQty = raw !== '' && !isNaN(qty) && qty >= 0;
                                    const amount = hasQty ? qty * row.effectiveAmt : 0;

                                    // Every absent worker on this process draws from the same
                                    // batch quantity, so the ceiling for this input is whatever
                                    // the other absentees have not already claimed.
                                    const claimedByOthers = Math.max(0, (row.declaredQtyTotal || 0) - (hasQty ? qty : 0));
                                    const availableToThisWorker = Math.max(0, row.qty - claimedByOthers);
                                    const exceeds = hasQty && qty > availableToThisWorker + 0.0001;
                                    const absenteesOnRow = (row.absenteeIdsOnRow || []).length;

                                    return (
                                        <div key={row.id} className="px-4 py-3">
                                            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                                                <div className="min-w-0 flex-1">
                                                    <span className="text-xs font-bold text-slate-700 block truncate">{row.operation || 'Unnamed Process'}</span>
                                                    <span className="text-[10px] text-slate-400 font-medium block">
                                                        Batch qty {row.qty.toLocaleString('en-US')} &middot; Rate &#8369;{row.effectiveAmt.toFixed(2)}
                                                        {holidayRateMultiplier > 1 && (
                                                            <span className="text-amber-600 font-bold"> ({holidayRateMultiplier.toFixed(1)}x holiday)</span>
                                                        )}
                                                        {' '}&middot; Total &#8369;{row.totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </span>
                                                    <span className={`text-[10px] font-bold block mt-0.5 ${row.isOverDeclared ? 'text-red-500' : 'text-slate-500'}`}>
                                                        {(row.declaredQtyTotal || 0).toLocaleString('en-US')} of {row.qty.toLocaleString('en-US')} claimed
                                                        {absenteesOnRow > 1 && ` by ${absenteesOnRow} absent workers`}
                                                        {' '}&middot; {(row.declaredQtyRemaining || 0).toLocaleString('en-US')} left for the present workers
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <div className="relative">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={raw}
                                                            onChange={(e) => setQty(section.idStr, row.id, e.target.value)}
                                                            placeholder="Qty made"
                                                            className={`w-28 px-3 py-2 text-xs font-mono font-bold rounded-xl border outline-none transition-all ${exceeds
                                                                ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                                                                : hasQty
                                                                    ? 'border-slate-200 bg-white text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                                                                    : 'border-amber-300 bg-amber-50 text-amber-900 placeholder:text-amber-500/70 focus:border-amber-500 focus:ring-2 focus:ring-amber-100'
                                                                }`}
                                                        />
                                                    </div>
                                                    <span className="font-mono font-black text-xs text-emerald-600 w-24 text-right">
                                                        &#8369;{amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                            </div>

                                            {exceeds && (
                                                <p className="text-[10px] font-semibold text-red-500 mt-1.5 flex items-center gap-1">
                                                    <i className="ti ti-alert-triangle" />
                                                    {claimedByOthers > 0
                                                        ? `Only ${availableToThisWorker.toLocaleString('en-US')} left on this process \u2014 the other absent worker${absenteesOnRow > 2 ? 's have' : ' has'} already claimed ${claimedByOthers.toLocaleString('en-US')} of ${row.qty.toLocaleString('en-US')}.`
                                                        : `Higher than the ${row.qty.toLocaleString('en-US')} logged for this process.`}
                                                </p>
                                            )}
                                            {row.isOverDeclared && !exceeds && (
                                                <p className="text-[10px] font-semibold text-red-500 mt-1.5 flex items-center gap-1">
                                                    <i className="ti ti-alert-triangle" />
                                                    Absent workers have claimed {(row.declaredQtyTotal || 0).toLocaleString('en-US')} between them, more than the {row.qty.toLocaleString('en-US')} logged. Lower the quantities to continue.
                                                </p>
                                            )}
                                            {!row.isOverDeclared && row.presentIdsOnRow?.length === 0 && row.remainingPool > 0.005 && (
                                                <p className="text-[10px] font-semibold text-amber-600 mt-1.5 flex items-center gap-1">
                                                    <i className="ti ti-info-circle" />
                                                    &#8369;{row.remainingPool.toFixed(2)} of this process stays unassigned &mdash; nobody assigned to it was present.
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Declared output total</span>
                                <span className="font-mono font-black text-sm text-emerald-600">
                                    &#8369;{section.declaredTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                    <p className={`text-[11px] font-semibold flex items-center gap-1.5 ${canClose ? 'text-emerald-600' : 'text-amber-600'}`}>
                        <i className={`ti ${canClose ? 'ti-circle-check' : 'ti-alert-circle'} text-base`} />
                        {missingCount > 0
                            ? `${missingCount} quantit${missingCount === 1 ? 'y' : 'ies'} still to enter`
                            : overDeclaredCount > 0
                                ? `${overDeclaredCount} process${overDeclaredCount === 1 ? '' : 'es'} claimed beyond the logged quantity`
                                : 'All declared. You can save the batch payroll.'}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={!canClose}
                        className="w-full sm:w-auto px-6 py-2.5 bg-slate-900 hover:bg-blue-600 text-white font-bold text-xs rounded-xl shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                        Apply to batch
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AbsenteeOutputModal;