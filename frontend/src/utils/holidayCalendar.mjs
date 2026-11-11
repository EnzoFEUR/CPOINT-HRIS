export const HOLIDAY_CALENDAR_EVENT = 'holiday-calendar-updated';

const calendarQueries = new Set([
    'holidays', 'holidayHistory', 'applicableHolidays', 'systemHolidaysList',
    'attendanceCalendar', 'adminAttendance', 'employeeMonthlyAttendance',
    'adminPayrolls', 'payrollCoverage', 'payrollPreview', 'batchPayrollPreview', 'payrollLeavePay', 'factoryHolidayPreview',
    'adminLeaves', 'leaveCreditPreview', 'employeeLeaveCredits', 'employeeLeaves',
    'employeeLeaveRequestPreview', 'employeeLeaveRequestSchedule',
    'employeeDashboard', 'adminDashboardOverview', 'adminDashboardAI', 'attendanceToday',
]);

export function refreshHolidayCalendar(queryClient, version) {
    void queryClient.invalidateQueries({ predicate: query => calendarQueries.has(query.queryKey[0]) });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HOLIDAY_CALENDAR_EVENT, { detail: { version } }));
}

export function safeHolidaySource(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export async function readHolidayResponse(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        let message = 'The holiday request could not be completed. Please try again.';
        if (response.status === 400) message = 'Check the holiday details, selected personnel and source reference.';
        if (response.status === 403) message = 'Only active HR and administrators can manage holidays.';
        if (response.status === 409) message = 'This record or calendar changed. Refresh and review the latest revision before trying again.';
        if (response.status === 503) message = 'Holiday management is not configured. Contact the system administrator.';
        if (['HOLIDAY_RECONCILIATION_REQUIRED', 'RECONCILIATION_REQUIRED'].includes(body?.code)) message = 'This change affects credited leave. HR must reconcile the leave records before changing this holiday.';
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    if (!body || typeof body !== 'object') throw new Error('The holiday service returned an invalid response. Please try again.');
    return body;
}
