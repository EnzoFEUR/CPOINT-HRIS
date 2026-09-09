import React, { useState } from 'react';
import EmployeeAvatar from '../../../../components/EmployeeAvatar';

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

export default WorkerPayrollCard;
