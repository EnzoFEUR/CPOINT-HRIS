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
            actualWorkdays: '',
            note: '',
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
            : '';
        return {
            basis: 'monthly_equivalent',
            type: 'monthly_equivalent',
            label: `Administrative & Salaried Staff (${emp.department || 'Office'})`,
            craftBadge: null,
            doleRule: 'DOLE RA 7641 Sec. 5.1 (Daily Equivalent of Monthly Salary)',
            dailyRate: computedRate,
            earnings12Months: '',
            actualWorkdays: '',
            note: computedRate ? (hasDailyRate
                ? `Recorded basic daily rate PHP ${computedRate}. HR must verify the applicable wage basis and supporting record for the retirement date.`
                : `Proposed daily equivalent PHP ${computedRate} from the recorded hourly rate using 8 hours. HR must verify the actual normal workday and supporting wage record.`) : '',
            signals: [
                `Salaried Role: ${emp.job_title || emp.department || 'Staff'}`,
                'Wage basis requires HR review'
            ]
        };
    }
    const dailyRateStr = hasDailyRate
        ? String(emp.daily_rate)
        : hasHourlyRate
        ? (Number(emp.hourly_rate) * 8).toFixed(2)
        : '';
    return {
        basis: 'daily',
        type: 'daily',
        label: `Regular Daily-Paid Employee (${emp.department || 'Operations'})`,
        craftBadge: null,
        doleRule: 'DOLE RA 7641 Sec. 5.1 (Latest Basic Daily Wage)',
        dailyRate: dailyRateStr,
        earnings12Months: '',
        actualWorkdays: '',
        note: dailyRateStr ? (hasDailyRate
            ? `Recorded basic daily rate PHP ${dailyRateStr}. HR must verify the applicable wage basis and supporting record for the retirement date.`
            : `Proposed daily equivalent PHP ${dailyRateStr} from the recorded hourly rate using 8 hours. HR must verify the actual normal workday and supporting wage record.`) : '',
        signals: [
            dailyRateStr ? `Recorded wage suggestion: PHP ${dailyRateStr}/day` : 'No daily or hourly wage is recorded',
            'Wage basis requires HR review'
        ]
    };
}


export function applyDetectedWageDefaults(previous, detected, editedFields) {
    if (!detected?.success) return previous;
    const updates = {};
    const apply = (key, value) => {
        if ((editedFields ? editedFields.has(key) : Boolean(previous[key])) || value === undefined || value === null || (!editedFields && !value)) return;
        if (previous[key] !== value) updates[key] = value;
    };
    apply('rate_basis', detected.detected_basis);
    if ((updates.rate_basis || previous.rate_basis) !== detected.detected_basis) return previous;
    if (detected.detected_basis === 'piece_rate') {
        apply('earnings_12_months', detected.recommended_earnings_12_months);
        apply('actual_workdays', detected.recommended_actual_workdays);
        if (editedFields) apply('daily_rate', '');
    } else {
        apply('daily_rate', detected.recommended_daily_rate);
        if (editedFields) {
            apply('earnings_12_months', '');
            apply('actual_workdays', '');
        }
    }
    apply('rate_note', detected.rate_note);
    return Object.keys(updates).length ? { ...previous, ...updates } : previous;
}
