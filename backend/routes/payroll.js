import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';
import {
    computeHolidayPayForPeriod,
    aggregate13thMonthPay,
} from '../utils/payrollCalculations.js';

const router = express.Router();

// Helper to validate UUID format
const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// ==========================================
// 1. STATUTORY SETTINGS ROUTES
// ==========================================

// GET Statutory Settings
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

// UPDATE/UPSERT Statutory Settings from UI
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
// 2. HOLIDAYS
// ==========================================

// GET holiday list, optionally scoped to a date range: ?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/holidays', cacheResponse(60), async (req, res) => {
    try {
        let query = supabase.from('holidays').select('*').order('date', { ascending: true });
        if (req.query.start) query = query.gte('date', req.query.start);
        if (req.query.end) query = query.lte('date', req.query.end);

        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE a holiday (admin: proclamation additions/corrections)
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

// DELETE a holiday
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

// GET 13th month pay aggregation for one employee: ?year=2026
router.get('/13th-month/:employee_id', async (req, res) => {
    try {
        const { employee_id } = req.params;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();

        const { data: records, error } = await supabase
            .from('payrolls')
            .select('basic_pay, period_start')
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
// 4. HOLIDAY PAY PREVIEW (no write — for PayrollCreate's UI card)
// ==========================================

// POST so a full { employee_id, period_start, period_end } body can be
// sent without URL-encoding concerns. This is the SINGLE source of truth
// for holiday math — the frontend calls this instead of keeping its own
// copy of payrollCalculations.js, so the number shown before submit can
// never drift from what POST / actually saves.
router.post('/preview', async (req, res) => {
    try {
        const { employee_id, period_start, period_end } = req.body;
        if (!employee_id || !period_start || !period_end) {
            return res.status(400).json({ error: 'employee_id, period_start, and period_end are required.' });
        }

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        if (!employee || !employee.salary) {
            // Not an error — just nothing to preview yet (e.g. employee has
            // no salary set). Return an empty, well-shaped result.
            return res.json({ items: [], totalHolidayPay: 0 });
        }

        const [{ data: holidayList }, { data: attendanceLogs }] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', period_start).lte('date', period_end),
            supabase
                .from('attendance')
                .select('*')
                .eq('employee_id', employee_id)
                .gte('date', period_start)
                .lte('date', period_end),
        ]);

        const restDays = Array.isArray(employee.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0]; // default: Sunday only, until per-employee schedules exist

        const preview = computeHolidayPayForPeriod({
            periodStart: period_start,
            periodEnd: period_end,
            monthlySalary: employee.salary,
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
// 5. PAYROLL COMPUTATION & LIST ROUTES
// ==========================================

// GET All Payrolls
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

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// COMPUTE & SAVE PAYROLL
router.post('/', async (req, res) => {
    try {
        const { employee_id, period_start, period_end, days_worked, overtime_hours, late_deductions } = req.body;

        // Prevent duplicate payslips in the same period
        const { data: existing } = await supabase
            .from('payrolls')
            .select('id')
            .eq('employee_id', employee_id)
            .eq('period_start', period_start)
            .eq('period_end', period_end)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: 'A payslip for this employee in this pay period already exists.' });
        }

        // Fetch Employee Salary
        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        if (!employee || !employee.salary) {
            return res.status(400).json({ error: 'Cannot compute payroll: Employee has no monthly salary set.' });
        }

        // Fetch Dynamic Statutory Settings from Database
        const { data: statutory } = await supabase
            .from('statutory_settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        // Safe conversion of UI settings into variables with fallbacks
        const sssEeRate = statutory?.sss_employee_rate ? parseFloat(statutory.sss_employee_rate) / 100 : 0.05;
        const sssMaxMsc = statutory?.sss_max_msc || statutory?.sss_max_comp ? parseFloat(statutory.sss_max_msc || statutory.sss_max_comp) : 30000;

        const phTotalRate = statutory?.philhealth_rate ? parseFloat(statutory.philhealth_rate) / 100 : 0.053;
        const phFloor = statutory?.philhealth_min_salary ? parseFloat(statutory.philhealth_min_salary) : 10000;
        const phCeiling = statutory?.philhealth_max_salary ? parseFloat(statutory.philhealth_max_salary) : 100000;

        const pagIbigEeRate = statutory?.pagibig_employee_rate ? parseFloat(statutory.pagibig_employee_rate) / 100 : 0.022;
        const pagIbigMaxCap = statutory?.pagibig_max_contribution ? parseFloat(statutory.pagibig_max_contribution) : 33;

        // ------------------------------------------------------------
        // Holiday pay: pull holidays + attendance for THIS period and
        // let the calculation module do the DOLE math. This is computed
        // server-side from source data rather than trusting client-sent
        // numbers, since it directly affects taxable gross pay.
        // ------------------------------------------------------------
        const [{ data: holidayList }, { data: attendanceLogs }] = await Promise.all([
            supabase.from('holidays').select('*').gte('date', period_start).lte('date', period_end),
            supabase
                .from('attendance')
                .select('*')
                .eq('employee_id', employee_id)
                .gte('date', period_start)
                .lte('date', period_end),
        ]);

        const restDays = Array.isArray(employee.rest_days) && employee.rest_days.length
            ? employee.rest_days
            : [0]; // default: Sunday only, until per-employee schedules exist

        const { items: holidayBreakdown, totalHolidayPay } = computeHolidayPayForPeriod({
            periodStart: period_start,
            periodEnd: period_end,
            monthlySalary: employee.salary,
            holidayList: holidayList || [],
            attendanceLogs: attendanceLogs || [],
            restDays,
        });

        // Calculate Earnings
        const monthlyRate = parseFloat(employee.salary);
        const dailyRate = monthlyRate / 21.75;
        const basicPay = monthlyRate / 2;
        const hourlyRate = dailyRate / 8;
        const overtimePay = (hourlyRate * 1.25) * parseFloat(overtime_hours || 0);
        const grossPay = basicPay + overtimePay + totalHolidayPay;

        // 1. SSS: Cap Salary Base at Max Salary Credit, apply Employee Share %
        const sssSalaryBase = Math.min(monthlyRate, sssMaxMsc);
        const sss = sssSalaryBase * sssEeRate;

        // 2. PhilHealth: Clamp Salary Base between Floor & Ceiling, split total rate 50/50
        const phSalaryBase = Math.min(Math.max(monthlyRate, phFloor), phCeiling);
        const philHealth = (phSalaryBase * phTotalRate) / 2;

        // 3. Pag-IBIG: Apply Employee Share % to Salary, capped at Max Contribution
        let pagIbig = monthlyRate * pagIbigEeRate;
        if (pagIbig > pagIbigMaxCap) pagIbig = pagIbigMaxCap;

        // Split mandatory contributions for semi-monthly cutoff
        const semiMonthlyContributions = (sss + philHealth + pagIbig) / 2;
        const lateDed = parseFloat(late_deductions || 0);

        // 4. Semi-Monthly TRAIN Law Withholding Tax Bracket
        const taxableIncome = grossPay - semiMonthlyContributions - lateDed;
        let tax = 0;
        if (taxableIncome > 10417) {
            if (taxableIncome <= 16666) {
                tax = (taxableIncome - 10417) * 0.15;
            } else if (taxableIncome <= 33332) {
                tax = 937.50 + ((taxableIncome - 16667) * 0.20);
            } else if (taxableIncome <= 83332) {
                tax = 4270.83 + ((taxableIncome - 33333) * 0.25);
            } else if (taxableIncome <= 333332) {
                tax = 16770.83 + ((taxableIncome - 83333) * 0.30);
            } else {
                tax = 91770.83 + ((taxableIncome - 333333) * 0.35);
            }
        }

        const totalDeductions = semiMonthlyContributions + tax + lateDed;
        const netPay = grossPay - totalDeductions;

        const remarks = `SSS: ${sss.toFixed(2)}, PhilHealth: ${philHealth.toFixed(2)}, Pag-IBIG: ${pagIbig.toFixed(2)}, Tax: ${tax.toFixed(2)}`;

        // Save Computed Payroll to Supabase
        // NOTE: basic_pay stays flat salary-only (monthlyRate / 2) so that
        // aggregate13thMonthPay() — which sums basic_pay across the year —
        // never accidentally pulls in overtime or holiday premiums.
        const { error: insertError } = await supabase
            .from('payrolls')
            .insert({
                employee_id,
                period_start,
                period_end,
                basic_pay: basicPay,
                overtime_pay: overtimePay,
                holiday_pay: totalHolidayPay,
                holiday_breakdown: holidayBreakdown,
                deductions: totalDeductions,
                remarks,
                net_pay: netPay,
                status: 'Paid'
            });

        if (insertError) throw insertError;

        // Audit Log Entry
        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'payroll',
                description: `Computed payroll for employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Payroll',
                subject_id: null,
                event: 'created',
                causer_id: req.body.admin_id,
                properties: { basic_pay: basicPay, net_pay: netPay, holiday_pay: totalHolidayPay }
            });
        }

        // Notification Entry
        try {
            const { createNotification } = await import('./notifications.js');
            await createNotification({
                target: employee_id,
                title: 'New Payslip',
                text: `Your payslip for ${period_start} to ${period_end} is now available for viewing.`,
                type: 'payroll'
            });
        } catch (notifErr) {
            console.error('Failed to send payslip notification:', notifErr);
        }

        invalidateCache(['/api/payroll', '/api/dashboard']);
        res.json({ success: true, message: 'Payroll Computed & Saved!', holiday_pay: totalHolidayPay, holiday_breakdown: holidayBreakdown });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET Single Payroll
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

// DELETE Payroll
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ status: 'error', code: 'INVALID_UUID', message: 'Invalid Payroll ID format.' });
        }

        const { error } = await supabase.from('payrolls').delete().eq('id', id);
        if (error) throw error;

        invalidateCache(['/api/payroll', '/api/dashboard']);

        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'payroll',
                description: `Deleted payroll record ID ${id}`,
                subject_type: 'App\\Models\\Payroll',
                subject_id: id,
                event: 'deleted',
                causer_id: req.body.admin_id,
                properties: {}
            });
        }

        res.json({ success: true, message: 'Payroll record deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;