// Limits apply to human-entered fields, never binary evidence or signed payload bytes.
export const HUMAN_TEXT_LIMITS = Object.freeze({
    title: 200, name: 255, operation: 120, stock_no: 80, group_name: 100,
    document_type: 100, category: 80,
    reason: 1000, rejection_reason: 1000, notes: 2000, description: 2000,
    separation_reason: 255, separation_notes: 2000,
    clearing_reason: 1000, exoneration_reason: 1000, investigation_notes: 2000,
    cert_ref: 120, document_url: 2048, emergency_contact_relationship: 50,
    reference: 120, payment_reference: 120,
});

export const hasUnsafeDisplayCharacters = value => /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);

// Generous input-safety bounds; these do not authorize pay or alter payroll formulas.
export const PAYROLL_NUMBER_LIMITS = Object.freeze({
    quantity_in: 999999.99,
    declared_quantity: 999999.99,
    amount: 99999999.99,
    overtime_hours: 744,
    rest_day_ot_hours: 744,
});

export function isBoundedDecimalInput(raw, max, allowEmpty = false) {
    if (!['number', 'string'].includes(typeof raw)) return false;
    if (raw === '' || raw === '.') return allowEmpty;
    const text = String(raw);
    if (text.length > String(Math.trunc(max)).length + 3 || !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) return false;
    return Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= max;
}

export const MAX_FACTORY_ROW_TOTAL = 99999999.99;

export function getFactoryRowsError(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 500) return 'Provide between 1 and 500 factory operation rows.';
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return 'Enter valid factory operation rows.';
        for (const name of ['operation', 'stock_no']) {
            const value = row[name];
            if (value !== undefined && (typeof value !== 'string' || value.length > HUMAN_TEXT_LIMITS[name] || hasUnsafeDisplayCharacters(value))) return `Review the ${name.replaceAll('_', ' ')} field.`;
        }
        if (!isBoundedDecimalInput(row.quantity_in, PAYROLL_NUMBER_LIMITS.quantity_in, row.quantity_in === '')
            || !isBoundedDecimalInput(row.amount, PAYROLL_NUMBER_LIMITS.amount, row.amount === '')) return 'Enter valid factory quantities and rates using up to two decimal places.';
        if (Number(row.quantity_in || 0) * Number(row.amount || 0) > MAX_FACTORY_ROW_TOTAL) return 'Each factory operation total must not exceed PHP 99,999,999.99.';
    }
    return '';
}
