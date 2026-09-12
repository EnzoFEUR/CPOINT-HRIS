
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

export const parseDate = (dStr) => {
    if (!dStr) return null;
    const formatted = typeof dStr === 'string' ? dStr.replace(' ', 'T') : dStr;
    const d = new Date(formatted);
    return isNaN(d.getTime()) ? null : d;
};

export const extractDateStr = (dStr) => {
    if (!dStr) return '';
    if (typeof dStr === 'string' && dStr.length >= 10) return dStr.substring(0, 10);
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const formatLocalDate = extractDateStr;

export const formatReadableDate = (dateStr) => {
    if (!dateStr) return 'Select Date';
    const cleanStr = extractDateStr(dateStr);
    if (!cleanStr) return dateStr;
    const d = new Date(cleanStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const getEmployeeDept = (emp) => emp?.department || 'Operations';
export const isFactoryDept = (dept) => (dept || '').toLowerCase() === 'factory';

export const getEmployeeRate = (emp) => parseFloat(
    emp?.piece_rate || emp?.rate_per_piece || emp?.salary || emp?.monthly_salary || 0
);

// Helper function to extract or derive Hourly & Daily Rates
export const getEmployeeRates = (emp) => {
    if (!emp) return { hourlyRate: 0, dailyRate: 0, monthlyRate: 0 };

    const hourlyRate = parseFloat(
        emp.hourly_rate || emp.rate_per_hour || emp.hourlyRate || emp.hourly_salary || 0
    );
    const dailyRate = parseFloat(
        emp.daily_rate || emp.rate_per_day || emp.dailyRate || emp.daily_salary || 0
    );
    const monthlyRate = parseFloat(
        emp.monthly_salary || emp.salary || emp.monthly_rate || emp.base_salary || emp.piece_rate || emp.rate_per_piece || 0
    );

    const doleDivisor = 21.75;

    let resolvedDaily = 0;
    let resolvedHourly = 0;

    if (dailyRate > 0) {
        resolvedDaily = dailyRate;
        resolvedHourly = hourlyRate > 0 ? hourlyRate : dailyRate / 8;
    } else if (hourlyRate > 0) {
        resolvedHourly = hourlyRate;
        resolvedDaily = hourlyRate * 8;
    } else if (monthlyRate > 0) {
        resolvedDaily = monthlyRate / doleDivisor;
        resolvedHourly = resolvedDaily / 8;
    }

    return {
        hourlyRate: resolvedHourly,
        dailyRate: resolvedDaily,
        monthlyRate: monthlyRate || (resolvedDaily * doleDivisor)
    };
};

export const matchJobTitle = (jobTitle, operation) => {
    if (!jobTitle || !operation) return false;
    const normJob = String(jobTitle).toLowerCase().trim();
    const normOp = String(operation).toLowerCase().trim();

    if (normJob === normOp || normJob.includes(normOp) || normOp.includes(normJob)) return true;

    const cleanJob = normJob.replace(/[^a-z0-9]/g, '');
    const cleanOp = normOp.replace(/[^a-z0-9]/g, '');
    if (!cleanJob || !cleanOp) return false;
    if (cleanJob === cleanOp || cleanJob.includes(cleanOp) || cleanOp.includes(cleanJob)) return true;

    const szJob = cleanJob.replace(/^z/, 's');
    const szOp = cleanOp.replace(/^z/, 's');
    if (szJob === szOp || szJob.includes(szOp) || szOp.includes(szJob)) return true;

    return false;
};

export const HOLIDAY_LABELS = {
    regular: 'Regular Holiday',
    special_non_working: 'Special Non-Working Day',
    special_working: 'Special Working Day',
};