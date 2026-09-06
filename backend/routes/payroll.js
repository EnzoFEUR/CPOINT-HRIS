import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import { createAuditLog } from './auditLogs.js';
import { createNotification } from './notifications.js';
import {
    toSafeNumber,
    round2,
    computeHolidayPayForPeriod,
    calculateMaternityDifferential,
    calculateStatutoryLeavePay,
    aggregate13thMonthPay,
} from '../utils/payrollCalculations.js';

const router = express.Router();

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

const normalizeDateRange = (d1, d2) => {
    if (!d1 || !d2) return { start: d1 || d2, end: d2 || d1 };
    return d1 <= d2 ? { start: d1, end: d2 } : { start: d2, end: d1 };
};

const getEffectiveMonthlySalary = (employee) => {
    if (!employee) return 0;

    const salary = toSafeNumber(employee.salary || employee.monthly_salary);
    if (salary > 0) return salary;

    const dailyRate = toSafeNumber(employee.daily_rate || employee.daily_pay);
    if (dailyRate > 0) return dailyRate * 21.75;

    const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
    if (pieceRate > 0) return pieceRate * 8 * 21.75;

    return 0;
};

/**
 * Helper: Computes BIR Monthly Withholding Tax under TRAIN Law (2026 Brackets)
 */
const calculateBIRWithholdingTax = (monthlyTaxableIncome) => {
    const taxable = Math.max(0, toSafeNumber(monthlyTaxableIncome));

    // Annual <= P250,000 (Monthly <= P20,833.33) -> 0% Tax
    if (taxable <= 20833.33) return 0;
    if (taxable <= 33333.33) return round2((taxable - 20833.33) * 0.15);
    if (taxable <= 66666.67) return round2(1875.00 + (taxable - 33333.33) * 0.20);
    if (taxable <= 166666.67) return round2(8541.67 + (taxable - 66666.67) * 0.25);
    if (taxable <= 666666.67) return round2(33541.67 + (taxable - 166666.67) * 0.30);
    return round2(183541.67 + (taxable - 666666.67) * 0.35);
};

// 1. Statutory settings
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

// 2. Holidays
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
        const { name, date, type } = req.body;
        if (!name || !date || !type) {
            return res.status(400).json({ error: 'name, date, and type are required.' });
        }

        const { data, error } = await supabase
            .from('holidays')
            .insert([{ name, date, type }])
            .select()
            .single();

        if (error) throw error;

        invalidateCache(['/api/payroll/holidays']);
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/holidays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const isNumericId = !isNaN(Number(id));
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        if (!isNumericId && !isUUID) {
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

// 3. 13th month pay
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

// 4. Holiday and payroll preview
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

        const restDays = Array.isArray(employee?.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0];

        const empDept = (employee?.department || '').toLowerCase();
        const empShift = (employee?.shift || '').toLowerCase();
        const isFactoryWorker = empDept.includes('factory') || empShift.includes('factory');

        const preview = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: holidayList || [],
            attendanceLogs: attendanceLogs || [],
            restDays,
            canOvertime: !isFactoryWorker,
        });

        res.json({
            ...preview,
            isFactoryWorker,
            canOvertime: !isFactoryWorker,
            policyNotice: isFactoryWorker
                ? 'Factory Worker: Fixed schedule 8:00 AM - 5:00 PM. Overtime prohibited per HR policy.'
                : 'Regular Worker: Fixed schedule. Overtime eligible.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Compute and save payroll
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
            regular_ot_hours,
            regular_holiday_ot_hours,
            special_holiday_ot_hours,
            late_deductions,
            late_minutes,
            working_days_in_year,
            sss_cash_benefit,
            maternity_leave_days,
            paternity_days,
            solo_parent_days,
            sil_days,
            pieces_produced,
            admin_id,
            apply_deductions,
            deduction_timing,
            pay_frequency = 'weekly' // Options: 'weekly' | 'semi-monthly' | 'monthly'
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

        if (!employee) {
            return res.status(400).json({ error: 'Employee not found.' });
        }

        const { data: terminationLog } = await supabase
            .from('disciplinary_logs')
            .select('id, date, reason')
            .eq('employee_id', employee_id)
            .eq('type', 'Termination')
            .maybeSingle();

        if (terminationLog) {
            return res.status(400).json({
                error: `Standard payroll cannot be processed for separated/terminated personnel (Terminated on ${terminationLog.date}). Use Final Pay / Clearance processing.`
            });
        }

        const department = (employee.department || '').toLowerCase();
        const shiftStr = (employee.shift || '').toLowerCase();
        const isFactory = department.includes('factory') || shiftStr.includes('factory');
        const effectiveMonthlySalary = getEffectiveMonthlySalary(employee);

        if (effectiveMonthlySalary <= 0 && !isFactory) {
            return res.status(400).json({ error: 'Cannot compute payroll: Employee has no salary, daily rate, or piece rate set.' });
        }

        // DOLE Standard Base Rate Formulas: (Monthly Basic * 12) / Working Days in a Year
        const annualWorkDays = toSafeNumber(working_days_in_year) || 261;
        const dailyRate = round2((effectiveMonthlySalary * 12) / annualWorkDays);
        const hourlyRate = round2(dailyRate / 8);
        const weeklySalary = round2((effectiveMonthlySalary * 12) / 52);

        let basicPay = 0;
        if (isFactory) {
            const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
            basicPay = round2(toSafeNumber(pieces_produced) * pieceRate);
        } else {
            basicPay = weeklySalary;
        }

        // Lateness Policy Handling (2-Hour Rule for Regular Employees)
        const lateMins = toSafeNumber(late_minutes);
        let lateDed = 0;
        let tardinessNote = '';

        if (!isFactory && lateMins > 0) {
            if (lateMins >= 120) {
                // >= 2 Hours Late (120+ mins): Payment scheme converts to HOURLY rate for actual hours worked
                const lateHours = lateMins / 60;
                const workedHours = Math.max(0, 8 - lateHours);
                const earnedHourlyPay = round2(workedHours * hourlyRate);

                // Convert daily component to actual hourly earnings
                basicPay = Math.max(0, round2(basicPay - dailyRate + earnedHourlyPay));
                lateDed = 0; // Set to 0 to avoid double-deducting since basicPay was directly adjusted

                tardinessNote = ` [Lateness >= 2 hrs (${lateMins} mins): Converted to HOURLY rate (${workedHours.toFixed(2)} hrs worked @ ₱${hourlyRate.toFixed(2)}/hr = ₱${earnedHourlyPay.toFixed(2)})]`;
            } else {
                // < 2 Hours Late (< 120 mins): Standard per-minute deduction against standard basic pay
                lateDed = round2((hourlyRate / 60) * lateMins);
                tardinessNote = ` [Lateness < 2 hrs (${lateMins} mins): Deduction -₱${lateDed.toFixed(2)}]`;
            }
        } else {
            lateDed = round2(toSafeNumber(late_deductions));
        }

        // Suspension Deduction Handling
        let suspensionDeduction = 0;
        let suspensionNote = '';
        const { data: suspensionLogs } = await supabase
            .from('disciplinary_logs')
            .select('id, date, reason, status')
            .eq('employee_id', employee_id)
            .eq('type', 'Suspension');

        if (suspensionLogs && suspensionLogs.length > 0) {
            for (const susp of suspensionLogs) {
                const sStart = susp.date;
                const match = (susp.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
                const sEnd = match ? match[1] : susp.date;

                const oStart = sStart > pStart ? sStart : pStart;
                const oEnd = sEnd < pEnd ? sEnd : pEnd;

                if (oStart <= oEnd) {
                    const days = Math.round((new Date(oEnd) - new Date(oStart)) / (1000 * 60 * 60 * 24)) + 1;
                    if (days >= 7 || (pStart >= sStart && pEnd <= sEnd)) {
                        basicPay = 0;
                        suspensionNote = ` [FULL SUSPENSION: Unpaid period (${sStart} to ${sEnd})]`;
                    } else if (days > 0) {
                        suspensionDeduction = round2(dailyRate * days);
                        basicPay = Math.max(0, round2(basicPay - suspensionDeduction));
                        suspensionNote = ` [SUSPENSION: ${days} unpaid day(s) (-₱${suspensionDeduction.toFixed(2)})]`;
                    }
                }
            }
        }

        // Overtime Computation (DOLE Multipliers)
        let overtimePay = 0;
        if (!isFactory) {
            const regOtHours = toSafeNumber(regular_ot_hours || overtime_hours);
            const regHolOtHours = toSafeNumber(regular_holiday_ot_hours);
            const specHolOtHours = toSafeNumber(special_holiday_ot_hours);

            const regOtPay = regOtHours * hourlyRate * 1.25;                  // 125%
            const regHolOtPay = regHolOtHours * hourlyRate * 2.00 * 1.30;     // 260%
            const specHolOtPay = specHolOtHours * hourlyRate * 1.30 * 1.30;   // 169%

            overtimePay = round2(regOtPay + regHolOtPay + specHolOtPay);
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

        const { items: holidayBreakdown, totalHolidayPay } = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: holidayList || [],
            attendanceLogs: attendanceLogs || [],
            restDays,
            canOvertime: !isFactory,
        });

        const paternityPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Paternity', daysTaken: paternity_days }).leavePay;
        const soloParentPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Solo Parent', daysTaken: solo_parent_days }).leavePay;
        const silPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'SIL', daysTaken: sil_days }).leavePay;
        const totalOtherLeavePay = round2(toSafeNumber(paternityPay) + toSafeNumber(soloParentPay) + toSafeNumber(silPay));

        let matDiffPay = 0;
        if (toSafeNumber(maternity_leave_days) > 0) {
            const matResult = calculateMaternityDifferential({
                monthlySalary: effectiveMonthlySalary,
                sssCashBenefit: sss_cash_benefit,
                leaveDays: maternity_leave_days,
            });
            matDiffPay = toSafeNumber(matResult.salaryDifferential);
        }

        const safeBasic = toSafeNumber(basicPay);
        const safeOt = toSafeNumber(overtimePay);
        const safeHoliday = toSafeNumber(totalHolidayPay);
        const safeLeave = toSafeNumber(totalOtherLeavePay);
        const safeMatDiff = toSafeNumber(matDiffPay);

        const grossPay = round2(safeBasic + safeOt + safeHoliday + safeLeave + safeMatDiff);

        // Deductions schedule evaluation
        const periodEndDay = new Date(pEnd).getDate();
        const shouldDeductStatutory = apply_deductions !== undefined
            ? Boolean(apply_deductions)
            : (deduction_timing === 'none' ? false : (deduction_timing ? true : periodEndDay >= 22));

        let sssEE = 0;
        let sssER = 0;
        let sssEC = 0;
        let philHealthEE = 0;
        let philHealthER = 0;
        let pagIbigEE = 0;
        let pagIbigER = 0;

        if (shouldDeductStatutory) {
            const contributionSalaryBase = (isFactory && effectiveMonthlySalary <= 0) ? (grossPay * 4) : effectiveMonthlySalary;

            // Frequency Divisor (Weekly = 4, Semi-Monthly = 2, Monthly = 1)
            const divisor = pay_frequency === 'weekly' ? 4 : (pay_frequency === 'semi-monthly' ? 2 : 1);

            // 1. SSS (2026 Rules: 5% EE, 10% ER, Max MSC P35,000, EC fee P30/P10)
            const sssMsc = Math.min(contributionSalaryBase, 35000);
            sssEE = round2((sssMsc * 0.05) / divisor);
            sssER = round2((sssMsc * 0.10) / divisor);
            sssEC = sssMsc >= 15000 ? 30 : 10;

            // 2. PhilHealth (2026 Rules: 5% Total split 50/50, Min P10k, Max P100k)
            const phSalaryBase = Math.min(Math.max(contributionSalaryBase, 10000), 100000);
            philHealthEE = round2(((phSalaryBase * 0.05) / 2) / divisor);
            philHealthER = round2(((phSalaryBase * 0.05) / 2) / divisor);

            // 3. Pag-IBIG (2026 Rules: 2% EE, 2% ER, Max Contribution P200 Total -> P100 EE / P100 ER)
            const monthlyPagIbigEE = Math.min(round2(contributionSalaryBase * 0.02), 100);
            const monthlyPagIbigER = Math.min(round2(contributionSalaryBase * 0.02), 100);
            pagIbigEE = round2(monthlyPagIbigEE / divisor);
            pagIbigER = round2(monthlyPagIbigER / divisor);
        }

        const totalStatutoryContributions = round2(sssEE + philHealthEE + pagIbigEE);

        // BIR Taxable Income & Withholding Tax
        const taxableGross = Math.max(0, grossPay - safeMatDiff);
        const taxableIncome = Math.max(0, round2(taxableGross - totalStatutoryContributions - lateDed));
        const tax = calculateBIRWithholdingTax(taxableIncome);

        // DEDUCTION CAP GUARDRAIL: Deductions can never exceed Gross Pay
        const rawDeductions = round2(totalStatutoryContributions + tax + lateDed);
        const totalDeductions = Math.min(rawDeductions, grossPay);
        const netPay = Math.max(0, round2(grossPay - totalDeductions));

        const baseRemarks = shouldDeductStatutory
            ? `2026 Statutory Applied (${pay_frequency.toUpperCase()}) - SSS: ${sssEE.toFixed(2)} (ER: ${sssER.toFixed(2)}, EC: ${sssEC}), PhilHealth: ${philHealthEE.toFixed(2)}, Pag-IBIG: ${pagIbigEE.toFixed(2)}, Tax: ${tax.toFixed(2)}`
            : `Regular Period (No Statutory Deductions) - Tax: ${tax.toFixed(2)}, Late: ${lateDed.toFixed(2)}`;
        const otPolicyNote = isFactory && (toSafeNumber(overtime_hours) > 0 || toSafeNumber(regular_ot_hours) > 0)
            ? ' [Factory Worker: Overtime disallowed per HR policy (₱0.00)]'
            : '';
        const remarks = `${baseRemarks}${tardinessNote}${suspensionNote}${otPolicyNote}`;

        let insertPayload = {
            employee_id,
            period_start: pStart,
            period_end: pEnd,
            basic_pay: safeBasic,
            overtime_pay: isFactory ? 0 : safeOt,
            holiday_pay: safeHoliday,
            holiday_breakdown: holidayBreakdown,
            deductions: totalDeductions,
            remarks,
            net_pay: netPay,
            status: 'Paid'
        };

        let { error: insertError } = await supabase.from('payrolls').insert(insertPayload);

        if (insertError && (insertError.message?.includes('holiday_pay') || insertError.message?.includes('holiday_breakdown'))) {
            delete insertPayload.holiday_pay;
            delete insertPayload.holiday_breakdown;
            const retry = await supabase.from('payrolls').insert(insertPayload);
            insertError = retry.error;
        }

        if (insertError) throw insertError;

        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const avatarUrl = emp?.company_id && emp?.id
            ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
            : null;

        await createNotification({
            target: employee_id,
            title: 'New Payslip Available',
            text: `Your payslip for ${pStart} to ${pEnd} is ready (Net Pay: ₱${netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
            type: 'payroll',
            sender_id: emp?.id,
            company_id: emp?.company_id,
            sender_name: 'HR & Payroll',
            sender_avatar: avatarUrl
        });

        if (admin_id) {
            await createAuditLog({
                log_name: 'payroll',
                description: `Computed weekly payroll for employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Payroll',
                subject_id: null,
                event: 'created',
                causer_id: admin_id,
                properties: { basic_pay: safeBasic, net_pay: netPay, holiday_pay: safeHoliday }
            });
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        res.json({
            success: true,
            message: 'Payroll Computed & Saved Successfully!',
            gross_pay: grossPay,
            net_pay: netPay,
            holiday_pay: safeHoliday,
            maternity_differential: safeMatDiff,
            employer_contributions: {
                sss_er: sssER,
                sss_ec: sssEC,
                philhealth_er: philHealthER,
                pagibig_er: pagIbigER,
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Factory batch submission
router.post('/batch', async (req, res) => {
    try {
        const { entries, period_start, period_end, pay_frequency = 'weekly' } = req.body;

        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'No payroll entries were provided for this batch.' });
        }
        if (!period_start || !period_end) {
            return res.status(400).json({ error: 'period_start and period_end are required.' });
        }

        const { start: pStart, end: pEnd } = normalizeDateRange(period_start, period_end);

        const results = [];
        const skipped = [];

        for (const entry of entries) {
            const employee_id = entry.employee_id;
            if (!employee_id) { skipped.push({ employee_id, reason: 'Missing employee_id' }); continue; }

            const { data: existing } = await supabase
                .from('payrolls')
                .select('id')
                .eq('employee_id', employee_id)
                .eq('period_start', pStart)
                .eq('period_end', pEnd)
                .maybeSingle();

            if (existing) {
                skipped.push({ employee_id, reason: 'Payslip already exists for this period' });
                continue;
            }

            const grossPay = round2(toSafeNumber(entry.gross_pay));

            // Determine frequency divisor (default to weekly = / 4)
            const frequency = entry.pay_frequency || pay_frequency || 'weekly';
            const divisor = frequency === 'weekly' ? 4 : (frequency === 'semi-monthly' ? 2 : 1);

            // Pro-rate raw monthly deductions
            const sssDed = round2(toSafeNumber(entry.sss_deduction) / divisor);
            const phDed = round2(toSafeNumber(entry.philhealth_deduction) / divisor);
            const pgbDed = round2(toSafeNumber(entry.pagibig_deduction) / divisor);
            const taxDed = round2(toSafeNumber(entry.tax_deduction) / divisor);

            const rawDeductions = round2(sssDed + phDed + pgbDed + taxDed);

            // DEDUCTION CAP GUARDRAIL: Deductions can never exceed Gross Pay
            const totalDeductions = Math.min(rawDeductions, grossPay);
            const netPay = Math.max(0, round2(grossPay - totalDeductions));

            const opsSummary = Array.isArray(entry.operations_breakdown)
                ? entry.operations_breakdown.map(op => `${op.operation}: ₱${toSafeNumber(op.share).toFixed(2)}`).join(', ')
                : '';

            const remarks = `Factory Batch Payout (${frequency.toUpperCase()}) - Group: ${entry.group || 'N/A'}${opsSummary ? ` | Operations - ${opsSummary}` : ''} | SSS: ₱${sssDed.toFixed(2)}, PhilHealth: ₱${phDed.toFixed(2)}, Pag-IBIG: ₱${pgbDed.toFixed(2)}, Tax: ₱${taxDed.toFixed(2)}`;

            let insertPayload = {
                employee_id,
                period_start: pStart,
                period_end: pEnd,
                basic_pay: grossPay,
                overtime_pay: 0,
                gross_pay: grossPay,
                deductions: totalDeductions,
                remarks,
                net_pay: netPay,
                status: 'Paid'
            };

            let { error: insertError } = await supabase.from('payrolls').insert(insertPayload);

            if (insertError && insertError.message?.includes('gross_pay')) {
                delete insertPayload.gross_pay;
                const retry = await supabase.from('payrolls').insert(insertPayload);
                insertError = retry.error;
            }

            if (insertError) {
                skipped.push({ employee_id, reason: insertError.message });
                continue;
            }

            results.push({ employee_id, net_pay: netPay });

            const { data: emp } = await supabase
                .from('employees')
                .select('id, company_id, first_name, last_name')
                .eq('id', employee_id)
                .maybeSingle();

            const avatarUrl = emp?.company_id && emp?.id
                ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${emp.company_id}/${emp.id}.jpg`
                : null;

            await createNotification({
                target: employee_id,
                title: 'New Payslip Available',
                text: `Your payslip for ${pStart} to ${pEnd} is ready (Net Pay: ₱${netPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}).`,
                type: 'payroll',
                sender_id: emp?.id,
                company_id: emp?.company_id,
                sender_name: 'HR & Payroll',
                sender_avatar: avatarUrl
            }).catch(() => { });

            if (req.body.admin_id || entry.admin_id) {
                await createAuditLog({
                    log_name: 'payroll',
                    description: `Computed factory batch payroll for employee ID ${employee_id}`,
                    subject_type: 'App\\Models\\Payroll',
                    subject_id: null,
                    event: 'created',
                    causer_id: req.body.admin_id || entry.admin_id,
                    properties: { gross_pay: grossPay, net_pay: netPay, group: entry.group }
                }).catch(() => { });
            }
        }

        if (results.length === 0) {
            return res.status(400).json({ error: 'No entries were saved.', skipped });
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        res.json({
            success: true,
            message: `Factory batch payroll saved for ${results.length} worker(s).`,
            saved: results,
            skipped
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