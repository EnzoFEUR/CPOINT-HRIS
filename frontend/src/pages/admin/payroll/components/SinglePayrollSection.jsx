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

            {/* Deductions & Overrides with 2-Hour Rule indicator */}
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
    );
};

export default React.memo(SinglePayrollSection);
