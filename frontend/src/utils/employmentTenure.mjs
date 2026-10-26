import { isLeaveDate } from '../../../shared/leaveCredits.mjs';

export function employmentTenure(hireDate, asOfDate) {
    if (!isLeaveDate(hireDate) || !isLeaveDate(asOfDate) || asOfDate < hireDate) {
        return null;
    }

    const [hireYear, hireMonth, hireDay] = hireDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = asOfDate.split('-').map(Number);
    let completedMonths = (endYear - hireYear) * 12 + endMonth - hireMonth;
    const lastDayOfMonth = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();

    // Clamp anniversaries at month ends, matching the retirement calculation.
    if (endDay < Math.min(hireDay, lastDayOfMonth)) completedMonths--;

    return {
        years: Math.floor(completedMonths / 12),
        months: completedMonths % 12,
    };
}
