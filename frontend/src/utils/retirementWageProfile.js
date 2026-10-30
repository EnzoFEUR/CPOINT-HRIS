import { getShoeRoleDetails } from './factoryRoles.js';

export function detectLocalWageProfile(emp) {
    if (!emp) return null;
    const jobTitle = String(emp.job_title || '').toLowerCase();
    const dept = String(emp.department || '').toLowerCase();
    const role = String(emp.role || '').toLowerCase();
    const hasDailyRate = Number(emp.daily_rate) > 0;
    const hasHourlyRate = Number(emp.hourly_rate) > 0;
    const shoeCraft = getShoeRoleDetails(emp.job_title);
    const isPieceRate = Boolean(shoeCraft) ||
        /cutter|cutting|marking|marka|areglo|sapatero|swela|lapat|alamoda|tahi|stitching|finish|qa|packing|sew|stitch|shoe|shoemaker/.test(jobTitle) ||
        (dept.includes('factory') && !hasDailyRate);
    const isSalaried = !isPieceRate && (
        role === 'admin' || role === 'hr' ||
        /admin|hr|finance|accounting|information technology|\bit\b|executive|management|office|supervisor|clerk/.test(dept) ||
        /admin|manager|supervisor|clerk|executive|analyst|developer|accountant|officer/.test(jobTitle) ||
        (!hasDailyRate && !dept.includes('factory'))
    );

    if (isPieceRate) {
        const shoeRole = shoeCraft?.label || emp.job_title || 'Shoe Craft Production';
        return {
            basis: 'piece_rate',
            type: 'piece_rate',
            label: `Shoe Craft Production · ${shoeRole} (Piece-Rate / Pakyao)`,
            craftBadge: shoeCraft ? { label: shoeCraft.label, stage: shoeCraft.stage, icon: shoeCraft.icon, color: shoeCraft.color } : null,
            doleRule: 'DOLE RA 7641 Sec. 5.2 (12-Mo Average Daily Salary / ADS)',
            dailyRate: hasDailyRate ? String(emp.daily_rate) : '',
            earnings12Months: '',
            actualWorkdays: '261',
            note: `12-month Average Daily Salary (ADS) pursuant to DOLE RA 7641 rules for piece-rate shoe craft (${shoeRole}).`,
            signals: [
                `Factory Shoe Craft: ${shoeRole}`,
                'DOLE RA 7641 12-Month ADS Basis'
            ]
        };
    }
    if (isSalaried) {
        const computedRate = hasDailyRate
            ? String(emp.daily_rate)
            : hasHourlyRate
            ? (Number(emp.hourly_rate) * 8).toFixed(2)
            : '610.00';
        return {
            basis: 'monthly_equivalent',
            type: 'monthly_equivalent',
            label: `Administrative & Salaried Staff (${emp.department || 'Office'})`,
            craftBadge: null,
            doleRule: 'DOLE RA 7641 Sec. 5.1 (Daily Equivalent of Monthly Salary)',
            dailyRate: computedRate,
            earnings12Months: '',
            actualWorkdays: '',
            note: `Daily equivalent computed from verified monthly compensation using standard statutory DOLE divisor (RA 7641 - ${emp.department || 'Administrative Staff'}).`,
            signals: [
                `Salaried Role: ${emp.job_title || emp.department || 'Staff'}`,
                'DOLE Divisor 261/313 Standard'
            ]
        };
    }
    const dailyRateStr = hasDailyRate
        ? String(emp.daily_rate)
        : hasHourlyRate
        ? (Number(emp.hourly_rate) * 8).toFixed(2)
        : '610.00';
    return {
        basis: 'daily',
        type: 'daily',
        label: `Regular Daily-Paid Employee (${emp.department || 'Operations'})`,
        craftBadge: null,
        doleRule: 'DOLE RA 7641 Sec. 5.1 (Latest Basic Daily Wage)',
        dailyRate: dailyRateStr,
        earnings12Months: '',
        actualWorkdays: '',
        note: `Verified statutory basic daily wage of PHP ${dailyRateStr} from certified employee master compensation record (${emp.department || 'Operations'} / ${emp.job_title || 'Regular'}).`,
        signals: [
            `Daily Wage Record: PHP ${dailyRateStr}/day`,
            'Latest Basic Daily Wage Statutory Standard'
        ]
    };
}


export function applyDetectedWageDefaults(previous, detected) {
    if (!detected?.success) return previous;
    const updates = {};
    if (!previous.rate_basis) updates.rate_basis = detected.detected_basis;
    if (detected.detected_basis === 'piece_rate') {
        if (!previous.earnings_12_months && detected.recommended_earnings_12_months) {
            updates.earnings_12_months = detected.recommended_earnings_12_months;
        }
        if (!previous.actual_workdays && detected.recommended_actual_workdays) {
            updates.actual_workdays = detected.recommended_actual_workdays;
        }
    } else if (!previous.daily_rate && detected.recommended_daily_rate) {
        updates.daily_rate = detected.recommended_daily_rate;
    }
    if (!previous.rate_note && detected.rate_note) updates.rate_note = detected.rate_note;
    return Object.keys(updates).length ? { ...previous, ...updates } : previous;
}
