import React from 'react';
import { formatReadableDate } from '../utils/payrollHelpers';

const CutoffPeriodSelector = ({
    periodStart,
    periodEnd,
    handleStartDateChange,
    handleEndDateChange,
    activePreset,
    includeWeekends,
    toggleWeekends,
    periodDaysCount,
    isInvalidDateRange
}) => {
    return (
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
    );
};

export default React.memo(CutoffPeriodSelector);
