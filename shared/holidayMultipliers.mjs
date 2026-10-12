// Single source of truth for holiday types, labels and pay multipliers.
// Imported by the server (payrollCalculations.js) and the browser (payrollHelpers.js)
// so the payroll preview and the saved payroll can never use different rates.
export const HOLIDAY_TYPES = Object.freeze({
    REGULAR: 'regular',
    SPECIAL_NON_WORKING: 'special_non_working',
    SPECIAL_WORKING: 'special_working',
});

export const HOLIDAY_TYPE_LABELS = Object.freeze({
    [HOLIDAY_TYPES.REGULAR]: 'Regular Holiday',
    [HOLIDAY_TYPES.SPECIAL_NON_WORKING]: 'Special Non-Working Day',
    [HOLIDAY_TYPES.SPECIAL_WORKING]: 'Special Working Day',
});

export const MULTIPLIERS = Object.freeze({
    [HOLIDAY_TYPES.REGULAR]: {
        worked: 2.0,
        workedRestDay: 2.6,
        unworked: 1.0,
    },
    [HOLIDAY_TYPES.SPECIAL_NON_WORKING]: {
        worked: 1.3,
        workedRestDay: 1.5,
        unworked: 0,
    },
    [HOLIDAY_TYPES.SPECIAL_WORKING]: {
        worked: 1.0,
        workedRestDay: 1.3,
        unworked: 0,
    },
});
