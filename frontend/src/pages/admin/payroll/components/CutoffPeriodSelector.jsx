import React from 'react';
import { formatReadableDate } from '../utils/payrollHelpers';

const CUTOFF_MODE_META = {
    '7day': { label: '7 Days', hint: 'Mon\u2013Sun', badge: '7-Day Lock' },
    '5day': { label: '5 Days', hint: 'Mon\u2013Fri', badge: '5-Day Lock' }
};

const CutoffPeriodSelector = ({
    periodStart,
    periodEnd,
    handleStartDateChange,
    activePreset,
    cutoffMode,
    handleCutoffModeChange,
    periodDaysCount,
    isInvalidDateRange,
    isRangeTooLong = false,
    maxCutoffDays = 7
}) => {
    return (
        <div className="bg-slate-50 p-4 sm:p-5 rounded-lg border border-slate-200 space-y-4 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center text-sm font-bold border border-accent/20 shrink-0">
                        <i className="ti ti-calendar-event"></i>
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-xs sm:text-sm font-bold text-slate-800 tracking-tight">Payroll Cutoff</h3>
                        <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium leading-snug truncate">
                            Select work dates for this payroll run
                        </p>
                    </div>
                </div>

                {activePreset === 'custom' && (
                    <span className="text-[10px] sm:text-[11px] font-bold text-warning-ink bg-warning-subtle border border-warning/20 px-2.5 py-1 rounded-md shrink-0 flex items-center gap-1 shadow-2xs">
                        <i className="ti ti-edit"></i> {CUTOFF_MODE_META[cutoffMode]?.badge || 'Custom'}
                    </span>
                )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-wrap">
                <div className="inline-flex bg-slate-200/60 rounded-md p-1 gap-1 w-full sm:w-auto">
                    {Object.entries(CUTOFF_MODE_META).map(([key, meta]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => handleCutoffModeChange(key)}
                            title={meta.hint}
                            className={`flex-1 sm:flex-none h-8 px-3.5 rounded-md text-xs font-semibold transition-colors duration-100 cursor-pointer flex items-center justify-center ${cutoffMode === key
                                ? 'bg-white text-accent shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                                }`}
                        >
                            {meta.label}
                        </button>
                    ))}
                </div>
                <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium">
                    {`End date follows the start date automatically (${CUTOFF_MODE_META[cutoffMode]?.hint}).`}
                </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-white p-3.5 sm:p-4 rounded-lg border border-slate-200 shadow-2xs transition-colors duration-100">
                    <div className="flex items-center justify-between mb-2 gap-1">
                        <label htmlFor="cutoff-start-date" className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 truncate cursor-pointer">
                            <i className="ti ti-calendar-event text-accent text-sm shrink-0"></i> Start Date
                        </label>
                        <span className="text-[10px] sm:text-[11px] font-semibold text-accent bg-accent-subtle px-2 py-0.5 rounded-md shrink-0 font-mono">
                            {formatReadableDate(periodStart)}
                        </span>
                    </div>
                    <input
                        id="cutoff-start-date"
                        type="date"
                        value={periodStart}
                        onChange={(e) => handleStartDateChange(e.target.value)}
                        className="w-full h-9 px-3 bg-slate-50 hover:bg-white focus:bg-white text-slate-800 font-medium rounded-md border border-slate-200 focus:border-accent outline-none transition-colors duration-100 text-xs sm:text-sm cursor-pointer"
                    />
                </div>

                <div className="bg-white p-3.5 sm:p-4 rounded-lg border border-slate-200 shadow-2xs transition-colors duration-100">
                    <div className="flex items-center justify-between mb-2 gap-1">
                        <label htmlFor="cutoff-end-date" className="text-[11px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 truncate cursor-pointer">
                            <i className="ti ti-lock text-slate-400 text-sm shrink-0"></i> End Date
                            <span className="text-[9px] font-bold text-slate-400 normal-case tracking-normal">(auto)</span>
                        </label>
                        <span className="text-[10px] sm:text-[11px] font-semibold text-ink bg-surface-muted px-2 py-0.5 rounded-md shrink-0 font-mono">
                            {formatReadableDate(periodEnd)}
                        </span>
                    </div>
                    <input
                        id="cutoff-end-date"
                        type="date"
                        value={periodEnd}
                        readOnly
                        disabled
                        title={`Locked to start date + ${CUTOFF_MODE_META[cutoffMode]?.hint}.`}
                        className="w-full h-9 px-3 font-medium rounded-md border outline-none text-xs sm:text-sm bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                    />
                </div>
            </div>

            {isInvalidDateRange && (
                <p className="text-xs text-danger-ink font-bold flex items-center gap-1 pt-1">
                    <i className="ti ti-alert-circle text-base"></i>{' '}
                    {isRangeTooLong
                        ? `Cutoff cannot be longer than ${maxCutoffDays} days (${periodDaysCount} selected). Payroll is weekly.`
                        : 'End date cannot be earlier than start date.'}
                </p>
            )}

            {periodDaysCount > 0 && !isInvalidDateRange && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-subtle border border-accent/20 p-3 rounded-md text-xs text-accent-strong font-medium">
                    <div className="flex items-center gap-2 min-w-0">
                        <i className="ti ti-info-circle text-accent text-base shrink-0"></i>
                        <span className="truncate">
                            {formatReadableDate(periodStart)} &rarr; {formatReadableDate(periodEnd)}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="shrink-0 font-semibold bg-accent text-white px-2.5 py-0.5 rounded-md text-[11px] shadow-2xs">
                            {periodDaysCount} Days
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(CutoffPeriodSelector);