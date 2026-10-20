// Preserve real names and existing factory titles such as Sapatero (Lapat/Swelas).
export const sanitizePersonnelText = (value, field = 'name') => value.replace(
    field === 'job_title' ? /[^\p{L}\p{M} .’'()&/\-]/gu : /[^\p{L}\p{M} .’'\-]/gu, '');

export const MAX_EMERGENCY_CONTACT_NAME_LENGTH = 100;

export const isValidPersonnelText = (value, field) => typeof value === 'string'
    && value.length <= (field === 'emergency_contact_name' ? MAX_EMERGENCY_CONTACT_NAME_LENGTH : 255)
    && /\p{L}/u.test(value) && sanitizePersonnelText(value, field) === value;

export const isPersonnelEmailInput = value => typeof value === 'string'
    && value.length <= 254 && /^[a-z\d@._+\-]*$/i.test(value);

export function isValidPersonnelEmail(value) {
    if (!isPersonnelEmailInput(value)) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    return local.length <= 64 && /^[a-z\d._+\-]+$/i.test(local)
        && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
        && /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/i.test(domain);
}

export const shouldWarnEmailDomain = email => Boolean(email.trim()) && !/^[^\s@]+@gmail\.com$/i.test(email.trim());

export const MAX_RESIDENTIAL_ADDRESS_LENGTH = 300;

export function getResidentialAddressError(value, partial = false) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return 'Enter a valid residential address.';
    if (value.length > MAX_RESIDENTIAL_ADDRESS_LENGTH) return 'Keep the complete address within 300 characters.';
    // The bundled PSGC list includes names such as Fuentes*; retain its markers.
    if (/[^\p{L}\p{M}\p{N} .,/#()&*:'’\-\r\n]/u.test(value)) return 'Use letters, numbers and normal address punctuation only.';
    if (!partial && value.trim() && !/\p{L}/u.test(value)) return 'Include a street or location name in the address.';
    return null;
}

// Both employee pay-rate columns use numeric(10,2).
export const MAX_EMPLOYEE_PAY_RATE = 99_999_999.99;

export const isEmployeePayInput = value => /^\d{0,8}(?:\.\d{0,2})?$/.test(value);

export function getEmployeePayError({ daily_rate, hourly_rate }) {
    for (const [label, value] of [['Daily pay', daily_rate], ['Hourly pay', hourly_rate]]) {
        if (value === undefined || value === null || value === '') continue;
        if (!['number', 'string'].includes(typeof value)
            || !/^(?:\d{1,8}(?:\.\d{0,2})?|\.\d{1,2})$/.test(String(value).trim())
            || !Number.isFinite(Number(value)) || Number(value) > MAX_EMPLOYEE_PAY_RATE) {
            return `${label} must be between PHP 0.00 and PHP 99,999,999.99, with at most 2 decimal places.`;
        }
    }
    return null;
}
