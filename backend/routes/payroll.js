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

    const salary = toSafeNumber(employee.salary || employee.monthly_salary);
    if (salary > 0) return salary;

    const dailyRate = toSafeNumber(employee.daily_rate || employee.daily_pay);
    if (dailyRate > 0) return dailyRate * 21.75; // DOLE standard monthly divisor

    const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
    if (pieceRate > 0) return pieceRate * 8 * 21.75;

    return 0;
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

        const restDays = Array.isArray(employee.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0];

        const empDept = (employee.department || '').toLowerCase();
        const empShift = (employee.shift || '').toLowerCase();
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
            policyNotice: isFactoryWorker ? 'Factory Worker: Fixed schedule 8:00 AM - 5:00 PM. Overtime prohibited per HR policy.' : 'Regular Worker: Fixed schedule 8:00 AM - 8:00 PM. Overtime eligible.'
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
            late_deductions,
            sss_cash_benefit,
            maternity_leave_days,
            paternity_days,
            solo_parent_days,
            sil_days,
            pieces_produced,
            admin_id
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

        // 1. Check if employee is Terminated - standard payroll cannot be processed
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

        // --- WEEKLY RATE & BASIC PAY COMPUTATION ---
        const dailyRate = round2(effectiveMonthlySalary / 21.75);
        const hourlyRate = round2(dailyRate / 8);
        const weeklySalary = round2((effectiveMonthlySalary * 12) / 52);

        let basicPay = 0;
        if (isFactory) {
            const pieceRate = toSafeNumber(employee.piece_rate || employee.rate_per_piece);
            basicPay = round2(toSafeNumber(pieces_produced) * pieceRate);
        } else {
            basicPay = weeklySalary;
        }

        // 2. DOLE Policy: Suspension = No Work, No Pay
        // Check if employee has active suspension overlapping pay period
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

                // Check overlap with [pStart, pEnd]
                const oStart = sStart > pStart ? sStart : pStart;
                const oEnd = sEnd < pEnd ? sEnd : pEnd;

                if (oStart <= oEnd) {
                    const days = Math.round((new Date(oEnd) - new Date(oStart)) / (1000 * 60 * 60 * 24)) + 1;
                    if (days >= 7 || (pStart >= sStart && pEnd <= sEnd)) {
                        // Entire period covered by suspension -> 0 basic pay
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

        // Strict Company HR Policy:
        // - Factory Worker (8:00 AM - 5:00 PM): STRICTLY NO OVERTIME ALLOWED (0 OT hours / 0 OT pay).
        // - Regular Worker (8:00 AM - 8:00 PM): OVERTIME ELIGIBLE.
        const effectiveOtHours = isFactory ? 0 : toSafeNumber(overtime_hours);
        const overtimePay = round2(effectiveOtHours * hourlyRate * 1.25);

        // Fetch Statutory Settings
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

        // Fetch Holidays & Attendance
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

        // Compute Holiday Pay
        const { items: holidayBreakdown, totalHolidayPay } = computeHolidayPayForPeriod({
            periodStart: pStart,
            periodEnd: pEnd,
            monthlySalary: effectiveMonthlySalary,
            holidayList: holidayList || [],
            attendanceLogs: attendanceLogs || [],
            restDays,
            canOvertime: !isFactory,
        });

        // Compute Leave Payments
        const paternityPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Paternity', daysTaken: paternity_days }).leavePay;
        const soloParentPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'Solo Parent', daysTaken: solo_parent_days }).leavePay;
        const silPay = calculateStatutoryLeavePay({ monthlySalary: effectiveMonthlySalary, leaveType: 'SIL', daysTaken: sil_days }).leavePay;
        const totalOtherLeavePay = round2(toSafeNumber(paternityPay) + toSafeNumber(soloParentPay) + toSafeNumber(silPay));

        // Compute Maternity Differential
        let matDiffPay = 0;
        if (toSafeNumber(maternity_leave_days) > 0) {
            const matResult = calculateMaternityDifferential({
                monthlySalary: effectiveMonthlySalary,
                sssCashBenefit: sss_cash_benefit,
                leaveDays: maternity_leave_days,
            });
            matDiffPay = toSafeNumber(matResult.salaryDifferential);
        }

        // Guaranteed Numeric Gross Additions
        const safeBasic = toSafeNumber(basicPay);
        const safeOt = toSafeNumber(overtimePay);
        const safeHoliday = toSafeNumber(totalHolidayPay);
        const safeLeave = toSafeNumber(totalOtherLeavePay);
        const safeMatDiff = toSafeNumber(matDiffPay);

        const grossPay = round2(safeBasic + safeOt + safeHoliday + safeLeave + safeMatDiff);

        // --- SECOND-HALF / END-OF-MONTH STATUTORY DEDUCTION FILTER ---
        // SSS, PhilHealth, and Pag-IBIG are deducted only on the end of the month cutoff (day >= 22)
        const periodEndDay = new Date(pEnd).getDate();
        const isEndOfMonthCutoff = periodEndDay >= 22;

        let sss = 0;
        let philHealth = 0;
        let pagIbig = 0;

        if (isEndOfMonthCutoff) {
            const contributionSalaryBase = (isFactory && effectiveMonthlySalary <= 0) ? (grossPay * 4) : effectiveMonthlySalary;

            const sssSalaryBase = Math.min(contributionSalaryBase, sssMaxMsc);
            sss = round2(sssSalaryBase * sssEeRate);

            const phSalaryBase = Math.min(Math.max(contributionSalaryBase, phFloor), phCeiling);
            philHealth = round2((phSalaryBase * phTotalRate) / 2);

            pagIbig = round2(contributionSalaryBase * pagIbigEeRate);
            if (pagIbig > pagIbigMaxCap) pagIbig = pagIbigMaxCap;
        }

        const totalStatutoryContributions = round2(sss + philHealth + pagIbig);
        const lateDed = round2(toSafeNumber(late_deductions));

        // Tax Base Calculation (TRAIN Law - Weekly brackets)
        const taxableGross = Math.max(0, grossPay - safeMatDiff);
        const taxableIncome = Math.max(0, round2(taxableGross - totalStatutoryContributions - lateDed));

        let tax = 0;
        if (taxableIncome > 2404) {
            if (taxableIncome <= 3846) {
                tax = round2((taxableIncome - 2404) * 0.15);
            } else if (taxableIncome <= 7692) {
                tax = round2(216.35 + (taxableIncome - 3846) * 0.20);
            } else if (taxableIncome <= 19231) {
                tax = round2(985.55 + (taxableIncome - 7692) * 0.25);
            } else if (taxableIncome <= 76923) {
                tax = round2(3870.30 + (taxableIncome - 19231) * 0.30);
            } else {
                tax = round2(21177.90 + (taxableIncome - 76923) * 0.35);
            }
        }

        const totalDeductions = round2(totalStatutoryContributions + tax + lateDed);
        const netPay = round2(grossPay - totalDeductions);

        const baseRemarks = isEndOfMonthCutoff
            ? `End of Month Deductions Applied - SSS: ${sss.toFixed(2)}, PhilHealth: ${philHealth.toFixed(2)}, Pag-IBIG: ${pagIbig.toFixed(2)}, Tax: ${tax.toFixed(2)}`
            : `Weekly Period (No Statutory Deductions) - Tax: ${tax.toFixed(2)}, Late: ${lateDed.toFixed(2)}`;
        const otPolicyNote = isFactory && toSafeNumber(overtime_hours) > 0
            ? ' [Factory Worker: Overtime disallowed per HR policy (₱0.00)]'
            : '';
        const remarks = `${baseRemarks}${suspensionNote}${otPolicyNote}`;

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

        // Fallback retry if holiday columns aren't present in Supabase table schema
        if (insertError && (insertError.message?.includes('holiday_pay') || insertError.message?.includes('holiday_breakdown'))) {
            delete insertPayload.holiday_pay;
            delete insertPayload.holiday_breakdown;
            const retry = await supabase.from('payrolls').insert(insertPayload);
            insertError = retry.error;
        }

        if (insertError) throw insertError;

        // Notify employee of new payslip
        const { data: emp } = await supabase
            .from('employees')
            .select('id, company_id, first_name, last_name')
            .eq('id', employee_id)
            .maybeSingle();

        const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
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

        // Audit Log Entry
        if (req.body.admin_id) {
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
            message: 'Weekly Payroll Computed & Saved!',
            gross_pay: grossPay,
            net_pay: netPay,
            holiday_pay: safeHoliday,
            maternity_differential: safeMatDiff,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Factory batch submission (Production Group piece-rate payout)
// Consumed by PayrollCreate's Factory Process Batch Mode. Each entry already
// carries its computed gross/deductions/net from the operations breakdown -
// this route just validates, persists, and notifies per-employee.

router.post('/batch', async (req, res) => {
    try {
        const { entries, period_start, period_end } = req.body;

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

            // Guard against double-processing the same worker/period, same as single mode
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
            const totalDeductions = round2(toSafeNumber(entry.total_deductions));
            const netPay = round2(toSafeNumber(entry.net_payout ?? (grossPay - totalDeductions)));

            const opsSummary = Array.isArray(entry.operations_breakdown)
                ? entry.operations_breakdown.map(op => `${op.operation}: ₱${toSafeNumber(op.share).toFixed(2)}`).join(', ')
                : '';

            const remarks = `Factory Batch Payout - Group: ${entry.group || 'N/A'}${opsSummary ? ` | Operations - ${opsSummary}` : ''} | SSS: ${toSafeNumber(entry.sss_deduction).toFixed(2)}, PhilHealth: ${toSafeNumber(entry.philhealth_deduction).toFixed(2)}, Pag-IBIG: ${toSafeNumber(entry.pagibig_deduction).toFixed(2)}, Tax: ${toSafeNumber(entry.tax_deduction).toFixed(2)}`;

            // Map onto the canonical payrolls schema (deductions/net_pay) so
            // PayrollIndex's calculateGrossPay()/deductions/net_pay reads line up
            // with factory rows the same way they do for single-mode payrolls.
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

            // Fallback if optional columns (e.g. gross_pay) aren't present in the schema yet
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

            if (req.body.admin_id) {
                await createAuditLog({
                    log_name: 'payroll',
                    description: `Computed factory batch payroll for employee ID ${employee_id}`,
                    subject_type: 'App\\Models\\Payroll',
                    subject_id: null,
                    event: 'created',
                    causer_id: req.body.admin_id,
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