// SSS Monthly Salary Credit (MSC): the monthly compensation is rounded to the nearest P500 step,
// never below the P5,000 minimum, and capped at the configured maximum (Statutory Settings).
// Shared by the server (payroll.js) and the factory batch preview (Create.jsx) so both agree.
export const SSS_MIN_MSC = 5000;
export const SSS_MSC_STEP = 500;
export const SSS_DEFAULT_MAX_MSC = 35000;

export function getSssMsc(monthlyCompensation, maxMsc = SSS_DEFAULT_MAX_MSC) {
    const compensation = Number(monthlyCompensation);
    if (!Number.isFinite(compensation) || compensation <= 0) return 0;
    const max = Number(maxMsc) > 0 ? Number(maxMsc) : SSS_DEFAULT_MAX_MSC;
    const rounded = Math.round(compensation / SSS_MSC_STEP) * SSS_MSC_STEP;
    return Math.min(Math.max(rounded, SSS_MIN_MSC), max);
}
