import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import {
    toSafeNumber,
    round2,
    deriveRates,
    computeHolidayPayForPeriod,
    calculateMaternityDifferential,
    calculateStatutoryLeavePay,
    aggregate13thMonthPay,
} from '../utils/payrollCalculations.js';

const router = express.Router();

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

/**
 * Helper to normalize and sort date bounds to work bi-directionally
 */
const normalizeDateRange = (d1, d2) => {
    if (!d1 || !d2) return { start: d1 || d2, end: d2 || d1 };
    return d1 <= d2 ? { start: d1, end: d2 } : { start: d2, end: d1 };
};

/**
 * Helper to derive an effective monthly salary base across all employee pay types
 * (Monthly Salary, Daily Rate, or Piece Rate)
 */
const getEffectiveMonthlySalary = (employee) => {
    if (!employee) return 0;

    // Check both salary and monthly_salary database fields
    const salary = toSafeNumber(employee.salary || employee.monthly_salary);
    if (salary > 0) return salary;

    const dailyRate = toSafeNumber(employee.daily_rate || employee.daily_pay);
    if (dailyRate > 0) return dailyRate * 26; // Standard 26 working days conversion factor

    const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
    if (pieceRate > 0) return pieceRate * 8 * 26; // Standard hourly equivalent conversion

    return 0;
};

// ==========================================
// 1. STATUTORY SETTINGS ROUTES
// ==========================================

router.get('/statutory-settings', cacheResponse(20), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        res.json(data || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/statutory-settings', async (req, res) => {
    try {
        const payload = req.body;

        const { data: existing } = await supabase
            .from('statutory_settings')
            .select('id')
            .limit(1)
            .maybeSingle();

        let error;
        if (existing) {
            ({ error } = await supabase
                .from('statutory_settings')
                .update(payload)
                .eq('id', existing.id));
        } else {
            ({ error } = await supabase
                .from('statutory_settings')
                .insert([payload]));
        }

        if (error) throw error;

        invalidateCache(['/api/payroll/statutory-settings']);
        res.json({ success: true, message: 'Statutory settings updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. HOLIDAYS (BI-DIRECTIONAL DATE SUPPORT)
// ==========================================

router.get('/holidays', cacheResponse(60), async (req, res) => {
    try {
        let query = supabase.from('holidays').select('*').order('date', { ascending: true });

        const rawStart = req.query.start || req.query.start_date;
        const rawEnd = req.query.end || req.query.end_date;

        if (rawStart && rawEnd) {
            const { start, end } = normalizeDateRange(rawStart, rawEnd);
            query = query.gte('date', start).lte('date', end);
        } else if (rawStart) {
            query = query.gte('date', rawStart);
        } else if (rawEnd) {
            query = query.lte('date', rawEnd);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/holidays', async (req, res) => {
    try {
        const { date, name, type } = req.body;
        if (!date || !name || !['regular', 'special_non_working'].includes(type)) {
            return res.status(400).json({ error: 'date, name, and a valid type are required.' });
        }

        const { data, error } = await supabase
            .from('holidays')
            .insert({ date, name, type })
            .select()
            .single();

        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/holidays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ error: 'Invalid holiday ID format.' });
        }

        const { error } = await supabase.from('holidays').delete().eq('id', id);
        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. 13TH MONTH PAY
// ==========================================

router.get('/13th-month/:employee_id', async (req, res) => {
    try {
        const { employee_id } = req.params;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();

        const { data: records, error } = await supabase
            .from('payrolls')
            .select('basic_pay, maternity_salary_differential, period_start')
            .eq('employee_id', employee_id)
            .gte('period_start', `${year}-01-01`)
            .lte('period_start', `${year}-12-31`);

        if (error) throw error;

        const result = aggregate13thMonthPay(records || []);
        res.json({ employee_id, year, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. HOLIDAY & PAYROLL PREVIEW
// ==========================================

router.post('/preview', async (req, res) => {
    try {
        const { employee_id, period_start, period_end } = req.body;
        if (!employee_id || !period_start || !period_end) {
            return res.status(400).json({ error: 'employee_id, period_start, and period_end are required.' });
        }

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);
        if (effectiveMonthlySalary <= 0) {
            return res.json({ items: [], totalHolidayPay: 0 });
        }

        const [{ data: holidayList }, { data: attendanceLogs }] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', pStart).lte('date', pEnd),
            supabase
                .from('attendances')
                .select('*')
                .eq('employee_id', employee_id)
                .gte('date', pStart)
                .lte('date', pEnd),
        ]);

        const restDays = Array.isArray(employee.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0];

        const preview = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: holidayList || [],
            attendanceLogs: attendanceLogs || [],
            restDays,
        });

        res.json(preview);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 5. COMPUTE & SAVE PAYROLL (FULL ENGINE)
// ==========================================

router.get('/', cacheResponse(20), async (req, res) => {
    try {
        let query = supabase.from('payrolls').select('*, employees:employee_id(*)').order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }

        if (req.query.month) {
            const year = req.query.year || new Date().getFullYear();
            const monthStr = req.query.month.padStart(2, '0');
            query = query.gte('period_start', `${year}-${monthStr}-01`);
        }

        if (req.query.limit) {
            const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
            query = query.limit(limitNum);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const {
            employee_id,
            period_start,
            period_end,
            overtime_hours,
            late_deductions,
            sss_cash_benefit,
            maternity_leave_days,
            paternity_days,
            solo_parent_days,
            sil_days,
            pieces_produced,
        } = req.body;

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        const { data: existing } = await supabase
            .from('payrolls')
            .select('id')
            .eq('employee_id', employee_id)
            .eq('period_start', pStart)
            .eq('period_end', pEnd)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: 'A payslip for this employee in this pay period already exists.' });
        }

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);

        if (!employee || effectiveMonthlySalary <= 0) {
            return res.status(400).json({ error: 'Cannot compute payroll: Employee has no salary, daily rate, or piece rate set.' });
        }

        const { data: statutory } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        const sssEeRate = statutory?.sss_employee_rate ? toSafeNumber(statutory.sss_employee_rate) / 100 : 0.05;
        const sssMaxMsc = statutory?.sss_max_msc ? toSafeNumber(statutory.sss_max_msc) : 35000;

        const phTotalRate = statutory?.philhealth_rate ? toSafeNumber(statutory.philhealth_rate) / 100 : 0.050;
        const phFloor = statutory?.philhealth_min_salary ? toSafeNumber(statutory.philhealth_min_salary) : 10000;
        const phCeiling = statutory?.philhealth_max_salary ? toSafeNumber(statutory.philhealth_max_salary) : 100000;

        const pagIbigEeRate = statutory?.pagibig_employee_rate ? toSafeNumber(statutory.pagibig_employee_rate) / 100 : 0.02;
        const pagIbigMaxCap = statutory?.pagibig_max_contribution ? toSafeNumber(statutory.pagibig_max_contribution) : 100;

        const [{ data: holidayList }, { data: attendanceLogs }] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', pStart).lte('date', pEnd),
            supabase
                .from('attendances')
                .select('*')
                .eq('employee_id', employee_id)
                .gte('date', pStart)
                .lte('date', pEnd),
        ]);

        const restDays = Array.isArray(employee.rest_days) && employee.rest_days.length ? employee.rest_days : [0];

        // --- DEPARTMENT & RATE CALCULATIONS ---
        const isFactory = (employee.department || '').toLowerCase() === 'factory';
        const piecesCount = toSafeNumber(pieces_produced);
        const ratePerPiece = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
        const monthlyRate = toSafeNumber(employee.salary || employee.monthly_salary);
        const dailyRate = toSafeNumber(employee.daily_rate || employee.daily_pay);

        const { hourlyRate } = deriveRates(effectiveMonthlySalary);

        // Basic Pay logic
        let basicPay = 0;
        if (isFactory && ratePerPiece > 0) {
            basicPay = round2(piecesCount * ratePerPiece);
        } else if (monthlyRate > 0) {
            basicPay = round2(monthlyRate / 2);
        } else if (dailyRate > 0) {
            basicPay = round2(dailyRate * 13);
        } else {
            basicPay = round2(effectiveMonthlySalary / 2);
        }

        const safeOtHours = toSafeNumber(overtime_hours);
        const overtimePay = round2(hourlyRate * 1.25 * safeOtHours);

        // Compute Holiday Pay using Effective Monthly Salary Base
        const { items: holidayBreakdown, totalHolidayPay } = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: holidayList || [],
            attendanceLogs: attendanceLogs || [],
            restDays,
        });

        // Compute Statutory Leave Payments
        const paternityPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Paternity', daysTaken: paternity_days }).leavePay;
        const soloParentPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Solo Parent', daysTaken: solo_parent_days }).leavePay;
        const silPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'SIL', daysTaken: sil_days }).leavePay;
        const totalOtherLeavePay = round2(toSafeNumber(paternityPay) + toSafeNumber(soloParentPay) + toSafeNumber(silPay));

        // Compute RA 11210 Maternity Salary Differential
        let matDiffPay = 0;
        if (toSafeNumber(maternity_leave_days) > 0) {
            const matResult = calculateMaternityDifferential({
                monthlySalary: effectiveMonthlySalary,
                sssCashBenefit: sss_cash_benefit,
                leaveDays: maternity_leave_days,
            });
            matDiffPay = toSafeNumber(matResult.salaryDifferential);
        }

        // Guaranteed Numeric Additions
        const safeBasic = toSafeNumber(basicPay);
        const safeOt = toSafeNumber(overtimePay);
        const safeHoliday = toSafeNumber(totalHolidayPay);
        const safeLeave = toSafeNumber(totalOtherLeavePay);
        const safeMatDiff = toSafeNumber(matDiffPay);

        const grossPay = round2(safeBasic + safeOt + safeHoliday + safeLeave + safeMatDiff);

        // --- STATUTORY DEDUCTIONS ---
        const contributionSalaryBase = (isFactory && monthlyRate <= 0) ? (grossPay * 2) : effectiveMonthlySalary;

        const sssSalaryBase = Math.min(contributionSalaryBase, sssMaxMsc);
        const sssMonthly = round2(sssSalaryBase * sssEeRate);

        const phSalaryBase = Math.min(Math.max(contributionSalaryBase, phFloor), phCeiling);
        const philHealthMonthly = round2((phSalaryBase * phTotalRate) / 2);

        let pagIbigMonthly = round2(contributionSalaryBase * pagIbigEeRate);
        if (pagIbigMonthly > pagIbigMaxCap) pagIbigMonthly = pagIbigMaxCap;

        // Halve for semi-monthly pay period deductions
        const sss = round2(sssMonthly / 2);
        const philHealth = round2(philHealthMonthly / 2);
        const pagIbig = round2(pagIbigMonthly / 2);

        const semiMonthlyContributions = round2(sss + philHealth + pagIbig);
        const lateDed = round2(toSafeNumber(late_deductions));

        // Tax Base Calculation (TRAIN Law)
        const taxableGross = Math.max(0, grossPay - safeMatDiff);
        const taxableIncome = Math.max(0, round2(taxableGross - semiMonthlyContributions - lateDed));

        let tax = 0;
        if (taxableIncome > 10417) {
            if (taxableIncome <= 16666) {
                tax = round2((taxableIncome - 10417) * 0.15);
            } else if (taxableIncome <= 33332) {
                tax = round2(937.50 + (taxableIncome - 16667) * 0.20);
            } else if (taxableIncome <= 83332) {
                tax = round2(4270.83 + (taxableIncome - 33333) * 0.25);
            } else if (taxableIncome <= 333332) {
                tax = round2(16770.83 + (taxableIncome - 83333) * 0.30);
            } else {
                tax = round2(91770.83 + (taxableIncome - 333333) * 0.35);
            }
        }

        tax = Math.min(tax, taxableIncome);

        const totalDeductions = round2(semiMonthlyContributions + tax + lateDed);
        const netPay = round2(grossPay - totalDeductions);

        const remarks = `SSS: ${sss.toFixed(2)}, PH: ${philHealth.toFixed(2)}, HDMF: ${pagIbig.toFixed(2)}, Tax: ${tax.toFixed(2)}${isFactory ? `, Pieces: ${piecesCount}` : ''}`;

        let insertPayload = {
            employee_id,
            period_start: pStart,
            period_end: pEnd,
            basic_pay: safeBasic,
            overtime_pay: safeOt,
            holiday_pay: safeHoliday,
            maternity_salary_differential: safeMatDiff,
            holiday_breakdown: holidayBreakdown,
            late_deductions: lateDed,
            pieces_produced: piecesCount,
            deductions: totalDeductions,
            remarks,
            net_pay: netPay,
            status: 'Paid',
        };

        let { error: insertError } = await supabase.from('payrolls').insert(insertPayload);

        if (insertError) {
            if (insertError.message?.includes('maternity_salary_differential')) {
                delete insertPayload.maternity_salary_differential;
            }
            if (insertError.message?.includes('late_deductions')) {
                delete insertPayload.late_deductions;
            }
            if (insertError.message?.includes('pieces_produced')) {
                delete insertPayload.pieces_produced;
            }
            const retry = await supabase.from('payrolls').insert(insertPayload);
            insertError = retry.error;
        }

        if (insertError) throw insertError;

        invalidateCache(['/api/payroll', '/api/dashboard']);
        res.json({
            success: true,
            message: 'Payroll Computed & Saved!',
            gross_pay: grossPay,
            net_pay: netPay,
            holiday_pay: safeHoliday,
            maternity_differential: safeMatDiff,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', cacheResponse(20), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UUID', message: 'Invalid Payroll ID format.' });
        }

        const { data, error } = await supabase
            .from('payrolls')
            .select('*, employees:employee_id(*)')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Payroll record not found.' });

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UUID', message: 'Invalid Payroll ID format.' });
        }

        const { error } = await supabase.from('payrolls').delete().eq('id', id);
        if (error) throw error;

        invalidateCache(['/api/payroll', '/api/dashboard']);
        res.json({ success: true, message: 'Payroll record deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;