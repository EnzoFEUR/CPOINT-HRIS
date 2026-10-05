import React from 'react';
import EmployeeAvatar from '../../../../components/EmployeeAvatar';
import { getEmployeeDept, formatReadableDate, extractDateStr, HOLIDAY_LABELS } from '../utils/payrollHelpers';

const SinglePayrollSection = ({
    formData,
    handleInputChange,
    selectedEmployee,
    employeeRates,
    estimatedOtPay,
    setIsEmpModalOpen,
    paidLeaves,
    isLoadingLeaves,
    totalPaidLeaveDays,
    isCalculating,
    holidayPreview,
    isSubmitting,
    isInvalidDateRange,
    handleSubmitSingle,
    periodStart,
    periodEnd
}) => {
    return (
        <form onSubmit={handleSubmitSingle} className="space-y-6">
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Select Regular Employee
                    </label>
                    <span className="text-[11px] text-slate-400 font-semibold">
                        Daily &amp; Monthly Salaried Only
                    </span>
                </div>

                {!selectedEmployee ? (
                    <button
                        type="button"
                        onClick={() => setIsEmpModalOpen(true)}
                        className="w-full h-14 p-3.5 sm:p-4 bg-white hover:bg-slate-50 border border-dashed border-slate-300 hover:border-accent rounded-lg text-left transition-colors duration-100 group flex items-center justify-between shadow-2xs cursor-pointer"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-md bg-accent-subtle text-accent flex items-center justify-center text-base shrink-0 border border-accent/20">
                                <i className="ti ti-user-plus"></i>
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-700 group-hover:text-accent transition-colors truncate">Tap to choose regular employee</p>
                                <p className="text-xs text-slate-400 truncate">Search by name or department...</p>
                            </div>
                        </div>
                        <i className="ti ti-chevron-right text-slate-400 text-base group-hover:text-accent transition-colors shrink-0 ml-2"></i>
                    </button>
                ) : (
                    <div className="bg-white p-3.5 sm:p-4 rounded-lg border border-slate-200 shadow-2xs relative overflow-hidden">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
                                <EmployeeAvatar
                                    employee={selectedEmployee}
                                    size="h-11 w-11 sm:h-12 sm:w-12"
                                    rounded="rounded-md"
                                    border="border border-slate-200"
                                    shadow="shadow-2xs"
                                    textSize="text-base"
                                />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <h4 className="text-sm sm:text-base font-bold text-slate-800 truncate">
                                            {selectedEmployee.first_name} {selectedEmployee.last_name}
                                        </h4>
                                        <span className="shrink-0 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-accent bg-accent-subtle border border-accent/20 px-1.5 py-0.5 rounded-md">
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
                                className="shrink-0 h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-md transition-colors duration-100 cursor-pointer flex items-center"
                            >
                                Change
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Leave with Pay Details Banner */}
            {selectedEmployee && (
                <div className="bg-surface-muted border border-line p-4 rounded-lg shadow-2xs space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-md bg-ink-subtle text-white flex items-center justify-center text-base shrink-0">
                                <i className="ti ti-calendar-off" />
                            </div>
                            <div>
                                <h4 className="text-xs sm:text-sm font-bold text-ink flex items-center gap-2">
                                    <span>Leave with Pay Status</span>
                                    {isLoadingLeaves ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink bg-surface-muted border border-line px-2.5 py-0.5 rounded-md">
                                            Checking leaves...
                                        </span>
                                    ) : paidLeaves.length > 0 ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-ink bg-success-subtle border border-success/20 px-2.5 py-0.5 rounded-md">
                                            {totalPaidLeaveDays} Day{totalPaidLeaveDays > 1 ? 's' : ''} Leave with Pay
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-md">
                                            No Leave with Pay in Cutoff
                                        </span>
                                    )}
                                </h4>
                                <p className="text-[11px] text-ink font-medium">
                                    Approved leave with pay records overlapping this cutoff period ({formatReadableDate(periodStart)} – {formatReadableDate(periodEnd)})
                                </p>
                            </div>
                        </div>

                        {paidLeaves.length > 0 && employeeRates.dailyRate > 0 && (
                            <div className="bg-white border border-success/20 px-3 py-1.5 rounded-md shadow-2xs font-mono text-xs text-right">
                                <span className="text-[10px] text-success-ink font-bold block uppercase">Est. Leave Pay</span>
                                <span className="font-bold text-success-ink">
                                    +₱{(totalPaidLeaveDays * employeeRates.dailyRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                        )}
                    </div>

                    {paidLeaves.length > 0 && (
                        <div className="space-y-2 pt-1">
                            {paidLeaves.map((leave, idx) => (
                                <div key={idx} className="bg-white p-3 rounded-md border border-success/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                    <div className="min-w-0 space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-success-ink">
                                                {leave.leave_type || leave.type || 'Paid Leave'}
                                            </span>
                                            <span className="text-[10px] font-bold bg-success-subtle text-success-ink px-2 py-0.5 rounded-md">
                                                Approved &bull; Leave with Pay
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 font-medium">
                                            Period: <span className="font-semibold text-slate-700">{formatReadableDate(extractDateStr(leave.start_date || leave.from_date || leave.date))}</span>
                                            {(leave.end_date || leave.to_date) && extractDateStr(leave.end_date || leave.to_date) !== extractDateStr(leave.start_date || leave.from_date || leave.date) ? (
                                                <> &rarr; <span className="font-semibold text-slate-700">{formatReadableDate(extractDateStr(leave.end_date || leave.to_date))}</span></>
                                            ) : ''}
                                            {leave.reason ? ` (${leave.reason})` : ''}
                                        </p>
                                    </div>
                                    <div className="shrink-0 text-right font-mono font-bold text-success-ink bg-success-subtle px-2.5 py-1 rounded-md border border-success/20">
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
                        <div className="text-xs font-semibold text-accent flex items-center gap-1.5 bg-accent-subtle px-2.5 py-1 rounded-md border border-accent/20">
                            <i className="ti ti-loader animate-spin text-sm"></i> Calculating...
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col justify-between">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Days Worked (Present)</label>
                            <input
                                type="number"
                                step="0.01"
                                name="days_worked"
                                value={formData.days_worked}
                                readOnly
                                className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md font-mono text-base font-bold text-slate-800 outline-none"
                            />
                        </div>
                    </div>

                    <div className="bg-surface-muted p-4 rounded-lg border border-line flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-xs font-bold text-ink uppercase flex items-center gap-1">
                                    <i className="ti ti-calendar-check text-sm" /> Leave with Pay
                                </label>
                                <span className="text-[10px] font-bold text-ink bg-surface-muted px-1.5 py-0.5 rounded">
                                    Approved
                                </span>
                            </div>
                            <input
                                type="number"
                                step="0.01"
                                value={totalPaidLeaveDays}
                                readOnly
                                className="w-full h-10 px-3 bg-white border border-success/20 rounded-md font-mono text-base font-bold text-success-ink outline-none"
                            />
                            <p className="text-[10px] text-success-ink font-medium mt-1">
                                {totalPaidLeaveDays > 0 ? `${totalPaidLeaveDays} day(s) paid leave detected` : 'No paid leave this cutoff'}
                            </p>
                        </div>
                    </div>

                    <div className="p-4 bg-accent-subtle/40 rounded-lg border border-accent/20 flex flex-col justify-between space-y-2">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                            <label className="block text-xs font-bold text-accent uppercase flex items-center gap-1.5">
                                <i className="ti ti-clock-play text-sm"></i> Overtime (OT) Hours
                            </label>
                            {estimatedOtPay > 0 && (
                                <span className="text-xs font-bold text-ink font-mono bg-surface-muted px-2 py-0.5 rounded-md border border-line">
                                    +₱{estimatedOtPay.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (1.25x Rate)
                                </span>
                            )}
                        </div>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            name="overtime_hours"
                            value={formData.overtime_hours}
                            onChange={handleInputChange}
                            className="w-full h-10 px-3 bg-white border border-accent/20 rounded-md font-mono text-accent-strong text-base font-bold outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors duration-100"
                            placeholder="0.0"
                        />
                        <p className="text-[11px] text-slate-500 font-medium">
                            Approved overtime hours eligible for extra pay.
                        </p>
                    </div>
                </div>
            </div>

            {/* Holiday Pay Preview (DOLE) */}
            {holidayPreview.items.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xs sm:text-sm font-bold text-slate-800">Holiday Pay (DOLE)</h3>
                        <span className="font-bold bg-warning text-white px-2.5 py-1 rounded-md text-xs">
                            +₱{holidayPreview.totalHolidayPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                    </div>
                    <div className="bg-warning-subtle/40 border border-warning/20 rounded-lg divide-y divide-warning/80">
                        {holidayPreview.items.map((item) => (
                            <div key={item.date} className="flex justify-between p-3 text-xs">
                                <div>
                                    <p className="font-bold text-slate-800">{formatReadableDate(item.date)} &middot; {item.holidayName}</p>
                                    <p className="text-slate-500 text-[11px]">{HOLIDAY_LABELS[item.holidayType] || item.holidayType}</p>
                                </div>
                                <span className="font-mono font-bold text-ink">
                                    ₱{item.pay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Deductions & Overrides with 2-Hour Rule indicator */}
            <div className="p-4 bg-danger-subtle/40 rounded-lg border border-danger/20 space-y-2">
                <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-danger-ink uppercase">Late Deductions / Tardiness (₱)</label>
                    {Number(formData.late_minutes) > 0 && (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-md border ${Number(formData.late_minutes) >= 120
                            ? 'bg-warning-subtle text-warning-ink border-warning/20'
                            : 'bg-danger-subtle text-danger-ink border-danger/20'
                            }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${Number(formData.late_minutes) >= 120 ? 'bg-warning' : 'bg-danger'}`} />
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
                    className="w-full h-10 px-3 bg-white border border-danger/20 rounded-md font-mono text-danger-ink text-base font-bold outline-none focus:border-danger focus:ring-1 focus:ring-danger transition-colors duration-100"
                    placeholder="0.00"
                />
                {Number(formData.late_minutes) >= 120 && (
                    <p className="text-[11px] text-warning-ink font-medium">
                        <i className="ti ti-info-circle mr-1" />
                        Regular Policy: Lateness of 2+ hours converts shift earnings to actual worked hours ({Math.max(0, 8 - (Number(formData.late_minutes) / 60)).toFixed(1)} hrs @ ₱{employeeRates.hourlyRate.toFixed(2)}/hr).
                    </p>
                )}
            </div>

            <button
                type="submit"
                disabled={isSubmitting || !formData.employee_id || isInvalidDateRange}
                className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
                {!isSubmitting ? (
                    <>
                        <i className="ti ti-cash text-base"></i>
                        <span>Compute &amp; Distribute Payslip</span>
                    </>
                ) : (
                    <>
                        <i className="ti ti-loader text-base animate-spin"></i>
                        <span>Computing Payroll...</span>
                    </>
                )}
            </button>
        </form>
    );
};

export default React.memo(SinglePayrollSection);
