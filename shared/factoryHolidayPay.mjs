// Holiday pay for piece-rate (factory) workers, per DOLE rules for workers paid by results:
//  - Their holiday credit is the Average Daily Output Wage (ADOW): the average daily earnings over their last
//    7 ACTUAL working days before the holiday (days they clocked in and out).
//  - The credit may never be lower than the regional daily minimum wage.
// Production is saved per cutoff, not per day, so each saved payslip's piece pay is spread evenly over the days
// the worker clocked in during that payslip's period. The current cutoff uses its own (unsaved) piece pay.
// Shared by the server (payroll.js) only, so the preview and the saved payroll cannot disagree.
import { MULTIPLIERS } from './holidayMultipliers.mjs';

export const FACTORY_ADOW_DAYS = 7;
// How far back attendance and saved payslips are loaded to find 7 actual working days.
export const FACTORY_ADOW_LOOKBACK_DAYS = 35;
// NCR non-agriculture daily minimum wage; HR can change it in Statutory Settings (minimum_daily_wage).
export const DEFAULT_MINIMUM_DAILY_WAGE = 755;

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const ymd = (value) => String(value || '').substring(0, 10);
const logDate = (log) => ymd(log?.date || (typeof log?.time_in === 'string' ? log.time_in.split('T')[0] : ''));
const shiftDate = (dateStr, days) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().substring(0, 10);
};
const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

export function computeFactoryHolidayPayAdow({
    holidays = [],
    logs = [],
    restDays = [],
    periodStart,
    periodEnd,
    piecePay = 0,
    priorPayslips = [],
    minimumDailyWage = DEFAULT_MINIMUM_DAILY_WAGE,
}) {
    const floor = Number(minimumDailyWage) > 0 ? Number(minimumDailyWage) : DEFAULT_MINIMUM_DAILY_WAGE;
    const workedDates = new Set((logs || []).filter(l => l && l.time_in && l.time_out).map(logDate).filter(Boolean));

    // Daily output wage for every worked day we have pay for.
    const wageByDate = new Map();
    const spread = (start, end, pay) => {
        const days = [...workedDates].filter(d => d >= start && d <= end);
        if (days.length === 0 || !(pay > 0)) return;
        const perDay = pay / days.length;
        days.forEach(d => wageByDate.set(d, perDay));
    };
    (priorPayslips || []).forEach(p => spread(ymd(p.period_start), ymd(p.period_end), Number(p.basic_pay) || 0));
    spread(ymd(periodStart), ymd(periodEnd), Number(piecePay) || 0);

    const holidayByDate = new Map();
    for (const h of holidays || []) {
        const date = ymd(h?.date);
        if (date && !holidayByDate.has(date)) holidayByDate.set(date, h);
    }

    // Eligibility for an unworked regular holiday: present on the last working day before it.
    const presentWorkdayBefore = (date) => {
        let d = shiftDate(date, -1);
        for (let i = 0; i < 7; i++) {
            if (!restDays.includes(weekday(d)) && !holidayByDate.has(d)) return workedDates.has(d);
            d = shiftDate(d, -1);
        }
        return false;
    };

    const items = [];
    let total = 0;
    for (const [date, h] of [...holidayByDate].sort((a, b) => a[0].localeCompare(b[0]))) {
        const table = MULTIPLIERS[h.type];
        if (!table) continue;

        const worked = workedDates.has(date);
        const onRestDay = restDays.includes(weekday(date));

        let multiplier;
        let paidFraction; // how many times the holiday credit is added on top of any pieces earned that day
        if (worked) {
            multiplier = onRestDay ? table.workedRestDay : table.worked;
            paidFraction = Math.max(0, multiplier - 1); // that day's pieces already pay the first 100%
        } else {
            multiplier = table.unworked;
            paidFraction = multiplier > 0 && presentWorkdayBefore(date) ? multiplier : 0;
        }
        if (paidFraction <= 0) continue;

        const previous = [...wageByDate.keys()].filter(d => d < date).sort().reverse().slice(0, FACTORY_ADOW_DAYS);
        const adow = previous.length > 0 ? previous.reduce((sum, d) => sum + wageByDate.get(d), 0) / previous.length : 0;
        const credit = Math.max(adow, floor);
        const pay = round2(paidFraction * credit);
        total += pay;
        items.push({
            date,
            holidayName: h.name || null,
            holidayType: h.type,
            worked,
            multiplier: worked ? multiplier : table.unworked,
            adow: round2(adow),
            dailyRate: round2(credit),
            minimumApplied: adow < floor,
            daysUsed: previous.length,
            pay,
        });
    }
    return { total: round2(total), items, missingRate: false };
}
