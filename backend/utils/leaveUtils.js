import { supabase } from '../supabaseClient.js';

/**
 * Calculates approved leave days (paid vs unpaid) for an employee in a given date range.
 * Fully compliant with DOLE Labor Code:
 * - Paid Leaves (LWP): Vacation, Sick, SIL, etc. with pay credits.
 * - Unpaid Leaves (LWOP / Absent): Absence days to be deducted from basic pay.
 *
 * @param {Object} params
 * @param {string} params.employeeId
 * @param {string} params.periodStart - YYYY-MM-DD
 * @param {string} params.periodEnd - YYYY-MM-DD
 * @returns {Promise<{
 *   employee_id: string,
 *   period_start: string,
 *   period_end: string,
 *   paid_leave_days: number,
 *   unpaid_leave_days: number,
 *   total_leave_days: number,
 *   leaves: Array<{
 *     id: string,
 *     type: string,
 *     is_paid: boolean,
 *     pay_type: 'with_pay' | 'without_pay',
 *     overlap_days: number,
 *     start_date: string,
 *     end_date: string,
 *     notes: string
 *   }>
 * }>}
 */
export async function getLeaveSummaryForPeriod({ employeeId, periodStart, periodEnd }) {
    if (!employeeId || !periodStart || !periodEnd) {
        return {
            employee_id: employeeId,
            period_start: periodStart,
            period_end: periodEnd,
            paid_leave_days: 0,
            unpaid_leave_days: 0,
            total_leave_days: 0,
            leaves: []
        };
    }

    const { data: rawLeaves, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('status', 'Approved')
        .lte('start_date', periodEnd)
        .gte('end_date', periodStart);

    if (error) {
        console.error('Error fetching approved leaves:', error);
        return {
            employee_id: employeeId,
            period_start: periodStart,
            period_end: periodEnd,
            paid_leave_days: 0,
            unpaid_leave_days: 0,
            total_leave_days: 0,
            leaves: []
        };
    }

    let paidDays = 0;
    let unpaidDays = 0;
    const leaveItems = [];

    for (const leave of (rawLeaves || [])) {
        const oStart = leave.start_date > periodStart ? leave.start_date : periodStart;
        const oEnd = leave.end_date < periodEnd ? leave.end_date : periodEnd;

        if (oStart <= oEnd) {
            const days = Math.round((new Date(oEnd) - new Date(oStart)) / (1000 * 60 * 60 * 24)) + 1;
            const rawNotes = leave.notes || '';
            const isUnpaid = /\[PAY_TYPE:WITHOUT_PAY\]/i.test(rawNotes) || /\[UNPAID\]/i.test(rawNotes);
            const isPaid = !isUnpaid;
            const cleanNotes = rawNotes
                .replace(/\[PAY_TYPE:[^\]]+\]/gi, '')
                .replace(/\[(PAID|UNPAID)\]/gi, '')
                .trim();

            if (isPaid) {
                paidDays += days;
            } else {
                unpaidDays += days;
            }

            leaveItems.push({
                id: leave.id,
                type: leave.type,
                is_paid: isPaid,
                pay_type: isPaid ? 'with_pay' : 'without_pay',
                overlap_days: days,
                start_date: leave.start_date,
                end_date: leave.end_date,
                notes: cleanNotes
            });
        }
    }

    return {
        employee_id: employeeId,
        period_start: periodStart,
        period_end: periodEnd,
        paid_leave_days: paidDays,
        unpaid_leave_days: unpaidDays,
        total_leave_days: paidDays + unpaidDays,
        leaves: leaveItems
    };
}
