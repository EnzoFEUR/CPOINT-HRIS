import React from 'react';
import EmployeeAvatar from '../../../../components/EmployeeAvatar';
import WorkerPayrollCard from './WorkerPayrollCard';

const FactoryBatchSection = ({
    selectedGroup,
    grandTotalFactoryPayout,
    activeGroupEmployees,
    batchSummaryTotals,
    filteredGroupEmployees,
    workerPayrollMap,
    holidayRateMultiplier,
    isLoadingEmployees,
    isLoadingGroupAttendance,
    breakdownSearch,
    setBreakdownSearch,
    breakdownFilter,
    setBreakdownFilter,
    breakdownViewMode,
    setBreakdownViewMode,
    setIsFactoryPieceOpen,
    setIsGroupModalOpen,
    isSubmitting,
    isInvalidDateRange,
    handleSubmitBatch,
    absenteeInfo,
    absenteeValidation,
    setIsAbsenteeModalOpen,
    expectedWorkingDays
}) => {
    const absenteeCount = absenteeValidation?.absenteeCount || 0;
    const needsDeclaration = absenteeCount > 0 && !absenteeValidation?.isComplete;

    return (
        <form onSubmit={handleSubmitBatch} className="space-y-6">
            {/* Access Button for Factory Piece Modal */}
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-9 h-9 rounded-md bg-accent text-white flex items-center justify-center text-lg shrink-0">
                        <i className="ti ti-table" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm sm:text-base font-bold text-slate-800 truncate">Factory Production &amp; Piece-Rate Manager</h3>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-md border shrink-0 ${selectedGroup ? 'bg-accent-subtle text-accent border-accent/20' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${selectedGroup ? 'bg-accent' : 'bg-slate-400'}`} />
                                {selectedGroup ? `Group: ${selectedGroup}` : 'No Group Active'}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">
                            {selectedGroup ? (
                                <>
                                    Output Total: <span className="font-bold font-mono text-ink">₱{grandTotalFactoryPayout.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> &middot; Active Roster: <span className="font-bold text-slate-700">{activeGroupEmployees.length} Workers</span>
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
                    className="w-full sm:w-auto h-9 px-4 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                    <i className="ti ti-adjustments-horizontal text-base" />
                    <span>{selectedGroup ? 'Edit Operations & Rates' : 'Select Group & Configure'}</span>
                </button>
            </div>

            {/* Absentee Warning & Declaration Trigger */}
            {selectedGroup && absenteeCount > 0 && (
                <div className={`p-4 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-colors duration-100 ${needsDeclaration
                    ? 'bg-warning-subtle/80 border-warning/20'
                    : 'bg-surface-muted border-line'
                    }`}>
                    <div className="flex items-start gap-3 min-w-0">
                        <i className={`ti ${needsDeclaration ? 'ti-user-exclamation text-warning-ink' : 'ti-circle-check text-ink'} text-xl shrink-0 mt-0.5`} />
                        <div className="min-w-0">
                            <p className={`text-xs font-bold ${needsDeclaration ? 'text-warning-ink' : 'text-ink'}`}>
                                {absenteeCount} worker{absenteeCount === 1 ? '' : 's'} missed days this cutoff
                                {expectedWorkingDays > 0 && (
                                    <span className="font-semibold"> (out of {expectedWorkingDays} expected)</span>
                                )}
                            </p>
                            <p className={`text-[11px] font-medium mt-0.5 ${needsDeclaration ? 'text-warning-ink' : 'text-ink'}`}>
                                {needsDeclaration
                                    ? (absenteeValidation.missing.length > 0
                                        ? `Enter how much each one actually made before saving. ${absenteeValidation.missing.length} quantit${absenteeValidation.missing.length === 1 ? 'y is' : 'ies are'} still blank.`
                                        : 'Their declared output adds up to more than the quantity logged for a process. Lower it before saving.')
                                    : 'Declared output recorded. Their pay is based on their own quantity, and the rest of each process goes to the workers who were present.'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsAbsenteeModalOpen && setIsAbsenteeModalOpen(true)}
                        className={`w-full sm:w-auto h-9 px-4 font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer shrink-0 text-white ${needsDeclaration ? 'bg-warning hover:bg-warning-ink' : 'bg-success hover:bg-success-ink'
                            }`}
                    >
                        <i className="ti ti-clipboard-text text-base" />
                        <span>{needsDeclaration ? 'Declare output' : 'Review declared output'}</span>
                    </button>
                </div>
            )}

            {/* Executive KPI Summary Ribbon */}
            {selectedGroup && activeGroupEmployees.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Production Group</span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-base sm:text-lg font-bold text-accent">{selectedGroup}</span>
                            <span className="text-xs font-semibold bg-accent-subtle text-accent border border-accent/20 px-2 py-0.5 rounded-md">
                                {activeGroupEmployees.length} Workers
                            </span>
                        </div>
                    </div>
                    <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Gross Output</span>
                        <div className="text-base sm:text-lg font-bold font-mono text-slate-900 mt-1">
                            ₱{batchSummaryTotals.gross.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                    <div className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Deductions</span>
                        <div className="text-base sm:text-lg font-bold font-mono text-danger-ink mt-1">
                            ₱{batchSummaryTotals.deductions.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                    <div className="bg-white p-3.5 rounded-lg border border-line shadow-2xs">
                        <span className="text-[10px] font-bold text-ink uppercase tracking-wider block">Net Distribution</span>
                        <div className="text-base sm:text-lg font-bold font-mono text-ink mt-1">
                            ₱{batchSummaryTotals.net.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                    </div>
                </div>
            )}

            {/* Operation Earnings & Deductions Breakdown per Employee */}
            <div className="bg-slate-50/50 p-4 rounded-lg border border-slate-200 space-y-3.5 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                    <div>
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <span>Worker Earnings &amp; Net Payout Breakdown</span>
                            {isLoadingEmployees ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent-subtle text-accent border border-accent/20">
                                    <svg className="animate-spin h-2.5 w-2.5 text-accent" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span>Loading...</span>
                                </span>
                            ) : (
                                <span className="text-slate-500 font-bold">({activeGroupEmployees.length})</span>
                            )}
                        </h4>
                    </div>
                    {!isLoadingEmployees && selectedGroup && (
                        <button
                            type="button"
                            onClick={() => setIsGroupModalOpen(true)}
                            className="h-8 px-3 text-xs font-semibold text-accent bg-white border border-accent/20 hover:bg-accent-subtle rounded-md transition-colors duration-100 shadow-2xs cursor-pointer self-start sm:self-auto flex items-center gap-1.5"
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
                                className="w-full h-8 pl-8 pr-8 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent font-medium placeholder:text-slate-400 shadow-2xs transition-colors duration-100"
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
                            <div className="flex items-center bg-slate-100 border border-slate-200 p-0.5 rounded-md text-[11px] font-medium">
                                <button
                                    type="button"
                                    onClick={() => setBreakdownFilter('all')}
                                    className={`px-2.5 py-1 rounded-sm transition-colors duration-100 cursor-pointer ${breakdownFilter === 'all'
                                        ? 'bg-white text-accent shadow-2xs font-semibold'
                                        : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                >
                                    All ({activeGroupEmployees.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBreakdownFilter('payable')}
                                    className={`px-2.5 py-1 rounded-sm transition-colors duration-100 cursor-pointer ${breakdownFilter === 'payable'
                                        ? 'bg-white text-ink shadow-2xs font-semibold'
                                        : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                >
                                    Payable ({batchSummaryTotals.payableCount})
                                </button>
                                {batchSummaryTotals.zeroCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setBreakdownFilter('unassigned')}
                                        className={`px-2.5 py-1 rounded-sm transition-colors duration-100 cursor-pointer ${breakdownFilter === 'unassigned'
                                            ? 'bg-white text-warning-ink shadow-2xs font-semibold'
                                            : 'text-slate-600 hover:text-slate-900'
                                            }`}
                                    >
                                        No Ops ({batchSummaryTotals.zeroCount})
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center bg-slate-100 border border-slate-200 p-0.5 rounded-md">
                                <button
                                    type="button"
                                    onClick={() => setBreakdownViewMode('table')}
                                    title="Roster Table View"
                                    className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 cursor-pointer ${breakdownViewMode === 'table'
                                        ? 'bg-white text-accent shadow-2xs font-semibold'
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
                                    className={`px-2.5 py-1 rounded-sm text-xs font-medium transition-colors duration-100 flex items-center gap-1.5 cursor-pointer ${breakdownViewMode === 'cards'
                                        ? 'bg-white text-accent shadow-2xs font-semibold'
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
                                className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-3 shadow-2xs"
                            >
                                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="h-7 w-7 rounded-full bg-slate-200" />
                                        <div className="space-y-1">
                                            <div className="h-3 w-24 bg-slate-200 rounded" />
                                            <div className="h-2 w-16 bg-slate-100 rounded" />
                                        </div>
                                    </div>
                                    <div className="h-5 w-20 bg-accent-subtle rounded-md" />
                                </div>

                                <div className="space-y-1.5 py-1">
                                    <div className="h-2 w-28 bg-slate-100 rounded" />
                                    <div className="h-3 w-full bg-slate-100 rounded" />
                                    <div className="h-3 w-3/4 bg-slate-100 rounded" />
                                </div>

                                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                    <div className="space-y-1">
                                        <div className="h-2 w-16 bg-slate-100 rounded" />
                                        <div className="h-3 w-12 bg-danger-subtle/60 rounded" />
                                    </div>
                                    <div className="space-y-1 text-right">
                                        <div className="h-2 w-16 bg-slate-100 rounded ml-auto" />
                                        <div className="h-4 w-16 bg-surface-muted rounded ml-auto" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !selectedGroup ? (
                    <div className="p-8 text-center text-slate-500 bg-white rounded-lg border border-dashed border-slate-200 space-y-3">
                        <div className="w-10 h-10 mx-auto rounded-md bg-accent-subtle text-accent flex items-center justify-center text-xl shadow-2xs">
                            <i className="ti ti-users-group" />
                        </div>
                        <div className="max-w-sm mx-auto">
                            <h5 className="font-bold text-slate-800 text-sm">No Factory Group Selected</h5>
                            <p className="text-xs text-slate-400 mt-1">
                                Choose a production group to configure operations, assign rates, and distribute payouts.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsFactoryPieceOpen(true)}
                            className="inline-flex items-center gap-2 h-8 px-3 bg-accent hover:bg-accent-hover text-white text-xs font-semibold rounded-md transition-colors duration-100 shadow-2xs cursor-pointer"
                        >
                            <i className="ti ti-adjustments-horizontal" />
                            <span>Select Group &amp; Open Piece Log</span>
                        </button>
                    </div>
                ) : activeGroupEmployees.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 bg-white rounded-lg border border-dashed border-slate-200">
                        <p className="text-xs font-semibold text-slate-600">No active employees assigned to {selectedGroup}.</p>
                        <p className="text-[11px] text-slate-400 mt-1">Use "Modify Group Roster" to add workers to this group.</p>
                    </div>
                ) : filteredGroupEmployees.length === 0 ? (
                    <div className="p-8 text-center bg-white rounded-lg border border-dashed border-slate-200 space-y-1.5">
                        <i className="ti ti-search text-2xl text-slate-300 block" />
                        <p className="text-xs font-bold text-slate-700">No matching employees</p>
                        <p className="text-[11px] text-slate-400">No employees in {selectedGroup} matched your search or filter.</p>
                    </div>
                ) : breakdownViewMode === 'table' ? (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-2xs">
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
                                        <tr key={worker.id} className="hover:bg-slate-50 transition-colors duration-100">
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
                                                                    <span className="text-[8px] font-bold text-warning-ink bg-warning-subtle px-1 rounded">
                                                                        {holidayRateMultiplier.toFixed(1)}x
                                                                    </span>
                                                                )}
                                                                <span className="font-mono font-bold text-accent">₱{op.share.toFixed(2)}</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] font-semibold text-warning-ink bg-warning-subtle px-2 py-0.5 rounded-md inline-block">
                                                        No matching process
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-right font-mono font-bold text-xs text-slate-800">
                                                ₱{workerData.grossPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </td>
                                            <td className="p-3 text-right">
                                                <span className="font-mono font-bold text-xs text-danger-ink block">
                                                    ₱{workerData.totalDeductions.toFixed(2)}
                                                </span>
                                                <span className="text-[9px] text-slate-400 block" title={`SSS: ₱${workerData.sss} | PH: ₱${workerData.philHealth} | Pag-IBIG: ₱${workerData.pagIbig} | Tax: ₱${workerData.tax}`}>
                                                    SSS {workerData.sss.toFixed(0)} &middot; PH {workerData.philHealth.toFixed(0)}
                                                </span>
                                            </td>
                                            <td className="p-3 text-right font-mono font-bold text-sm text-ink">
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
                disabled={isSubmitting || !selectedGroup || grandTotalFactoryPayout <= 0 || activeGroupEmployees.length === 0 || isInvalidDateRange || isLoadingGroupAttendance || needsDeclaration}
                className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
                {isSubmitting ? (
                    <>
                        <i className="ti ti-loader text-base animate-spin"></i>
                        <span>Distributing {selectedGroup || 'Factory'} Process Payroll...</span>
                    </>
                ) : (
                    <>
                        <i className={`ti ${needsDeclaration ? 'ti-lock' : 'ti-cash'} text-base`}></i>
                        <span>
                            {needsDeclaration
                                ? 'Declare absent workers\u2019 output to continue'
                                : selectedGroup
                                    ? `Save & Distribute ${selectedGroup} Process Payroll`
                                    : 'Select Factory Group to Distribute'}
                        </span>
                    </>
                )}
            </button>
        </form>
    );
};

export default React.memo(FactoryBatchSection);