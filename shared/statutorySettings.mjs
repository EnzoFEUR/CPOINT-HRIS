import { WORK_POLICY_INPUT_LIMITS, isValidWorkPolicyInput } from './workPolicy.mjs';

const percentage = Object.freeze({ min: 0, max: 100, step: 0.01, maxLength: 6 });
// Input safety ceiling, not a legislated contribution amount.
const amount = Object.freeze({ min: 0, max: 999999.99, step: 0.01, maxLength: 9 });

export const STATUTORY_INPUT_LIMITS = Object.freeze({
    sss_employee_rate: percentage,
    sss_employer_rate: percentage,
    sss_max_msc: amount,
    philhealth_rate: percentage,
    philhealth_min_salary: amount,
    philhealth_max_salary: amount,
    pagibig_employee_rate: percentage,
    pagibig_employer_rate: percentage,
    pagibig_max_contribution: amount,
    minimum_daily_wage: amount,
    ...WORK_POLICY_INPUT_LIMITS,
});

export function isValidStatutoryInput(name, raw) {
    const limits = STATUTORY_INPUT_LIMITS[name];
    if (!limits || !['number', 'string'].includes(typeof raw)) return false;
    const text = String(raw);
    const maxLength = limits.maxLength ?? String(limits.max).length + (limits.step === 1 ? 0 : 3);
    if (text.length > maxLength || !/^\d+(?:\.\d{0,2})?$/.test(text)) return false;
    if (WORK_POLICY_INPUT_LIMITS[name]) return isValidWorkPolicyInput(name, raw);
    const value = Number(raw);
    return Number.isFinite(value) && value >= limits.min && value <= limits.max;
}

export function getStatutorySettingsError(settings) {
    for (const [name, limits] of Object.entries(STATUTORY_INPUT_LIMITS)) {
        if (Object.hasOwn(settings, name) && !isValidStatutoryInput(name, settings[name])) {
            const label = name.replaceAll('_', ' ');
            return `Enter ${label} between ${limits.min} and ${limits.max}, using ${limits.step === 1 ? 'whole numbers' : 'up to two decimal places'}.`;
        }
    }
    if (Object.hasOwn(settings, 'philhealth_min_salary') && Object.hasOwn(settings, 'philhealth_max_salary')
        && Number(settings.philhealth_min_salary) > Number(settings.philhealth_max_salary)) {
        return 'PhilHealth minimum salary cannot exceed the maximum salary.';
    }
    return '';
}
