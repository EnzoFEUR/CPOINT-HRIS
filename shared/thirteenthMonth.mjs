// 13th month pay timing, shared by the server (payroll.js) and the factory batch screen (Create.jsx).
// Client policy: total basic salary earned in the calendar year / 12, paid with the LAST cutoff of December.
// Weekly cutoffs end 7 days apart, so the last one ending in December ends on day 25 to 31.
export const LAST_CUTOFF_FIRST_END_DAY = 25;

export function isLastCutoffOfDecember(periodEnd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(periodEnd || ''));
    return Boolean(m) && m[2] === '12' && Number(m[3]) >= LAST_CUTOFF_FIRST_END_DAY;
}
