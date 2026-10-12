// When statutory contributions (SSS, PhilHealth, Pag-IBIG) are deducted, and what monthly amount they use.
// Client policy: for weekly payroll they are taken once a month, in the first cutoff that ends in that month.
// Shared by the server (payroll.js) and the factory batch preview (Create.jsx) so both agree.

// Weekly cutoffs end 7 days apart, so the first one ending in a month always ends on day 1 to 7.
export const FIRST_CUTOFF_LAST_END_DAY = 7;

const parseYmd = (value) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
};

export function isFirstCutoffOfMonth(periodEnd) {
    const d = parseYmd(periodEnd);
    return Boolean(d) && d.day <= FIRST_CUTOFF_LAST_END_DAY;
}

// Calendar month before the month the cutoff ends in, as { start, end } (YYYY-MM-DD).
export function previousMonthRange(periodEnd) {
    const d = parseYmd(periodEnd);
    if (!d) return null;
    const year = d.month === 1 ? d.year - 1 : d.year;
    const month = d.month === 1 ? 12 : d.month - 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, '0');
    return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

// Pay that counts toward contributions for one saved payslip (SIL cash is excluded).
export function cycleCompensation(row) {
    const n = (v) => Number(v) || 0;
    return n(row?.basic_pay) + n(row?.holiday_pay) + (row?.paid_leave_in_basic ? 0 : n(row?.paid_leave_pay));
}

// Average weekly pay of the given payslips, as a monthly figure (x4, the same factor used everywhere else).
// Returns null when there is no pay to average.
export function averageMonthlyBase(rows, cyclesPerMonth = 4) {
    const pays = (rows || []).map(cycleCompensation).filter((v) => v > 0);
    if (pays.length === 0) return null;
    const average = pays.reduce((sum, v) => sum + v, 0) / pays.length;
    return Math.round((average * cyclesPerMonth + Number.EPSILON) * 100) / 100;
}
