import { WORK_POLICY_INPUT_LIMITS, isValidWorkPolicyInput } from './workPolicy.mjs';
import {isLeaveDate} from './leaveCredits.mjs';

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

// ---- Withholding tax tables (HR-editable, versioned by effective date) ----
export const WITHHOLDING_FREQUENCIES = Object.freeze(['weekly', 'semi-monthly', 'monthly']);
export const WITHHOLDING_MAX_BRACKETS = 20;
const WITHHOLDING_AMOUNT_MAX = 999999999.99;
// Progressive tables are continuous: a bracket's base tax should equal the tax at that point from the bracket
// before it. BIR rounding leaves a few centavos, so allow up to P2 before treating it as a typing mistake.
const WITHHOLDING_BOUNDARY_TOLERANCE = 2;
const TWO_DECIMALS = /^\d+(?:\.\d{1,2})?$/;

export function normalizeWithholdingBrackets(brackets) {
    return (Array.isArray(brackets) ? brackets : [])
        .map(row => ({
            over: Math.round(Number(row?.over) * 100) / 100,
            base: Math.round(Number(row?.base) * 100) / 100,
            rate: Math.round(Number(row?.rate) * 100) / 100,
        }))
        .sort((a, b) => a.over - b.over);
}

export function getWithholdingTableError(brackets) {
    if (!Array.isArray(brackets) || brackets.length < 2 || brackets.length > WITHHOLDING_MAX_BRACKETS) {
        return `Enter between 2 and ${WITHHOLDING_MAX_BRACKETS} tax brackets.`;
    }
    const fields = [['over', 'the "over" amount', WITHHOLDING_AMOUNT_MAX], ['base', 'the base tax', WITHHOLDING_AMOUNT_MAX], ['rate', 'the rate (%)', 100]];
    for (const [index, row] of brackets.entries()) {
        for (const [field, label, max] of fields) {
            const raw = row?.[field];
            if (!['number', 'string'].includes(typeof raw) || !TWO_DECIMALS.test(String(raw).trim()) || Number(raw) > max) {
                return `Bracket ${index + 1}: enter ${label} as a number from 0 to ${max}, using up to two decimal places.`;
            }
        }
    }

    const rows = normalizeWithholdingBrackets(brackets);
    if (rows[0].over !== 0) return 'The first bracket must start at ₱0.';
    if (rows[0].base !== 0) return 'The first bracket must have a base tax of ₱0.';
    for (let i = 1; i < rows.length; i++) {
        const previous = rows[i - 1];
        const current = rows[i];
        if (current.over === previous.over) return 'Every bracket must start at a different amount.';
        if (current.base < previous.base) return `Bracket ${i + 1}: base tax cannot be lower than the bracket before it.`;
        const expected = previous.base + (current.over - previous.over) * previous.rate / 100;
        if (Math.abs(current.base - expected) > WITHHOLDING_BOUNDARY_TOLERANCE) {
            return `Bracket ${i + 1}: base tax ₱${current.base.toFixed(2)} does not match the bracket before it (about ₱${expected.toFixed(2)} at ₱${current.over.toFixed(2)}). Check for a typing mistake.`;
        }
    }
    return '';
}

export function getWithholdingTableVersionError({ frequency, effective_from, brackets } = {}) {
    if (!WITHHOLDING_FREQUENCIES.includes(frequency)) return 'Choose weekly, semi-monthly or monthly.';
    const validDate = isLeaveDate(effective_from);
    if (!validDate) return 'Enter a valid effective date.';
    return getWithholdingTableError(brackets);
}
