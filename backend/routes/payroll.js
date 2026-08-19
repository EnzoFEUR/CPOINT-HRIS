import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

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
// 2. PAYROLL COMPUTATION & LIST ROUTES
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

        // Calculate Earnings
        const monthlyRate = parseFloat(employee.salary);
        const dailyRate = monthlyRate / 21.75;
        const basicPay = monthlyRate / 2;
        const hourlyRate = dailyRate / 8;
        const overtimePay = (hourlyRate * 1.25) * parseFloat(overtime_hours || 0);
        const grossPay = basicPay + overtimePay;

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
        const { error: insertError } = await supabase
            .from('payrolls')
            .insert({
                employee_id,
                period_start,
                period_end,
                basic_pay: basicPay,
                overtime_pay: overtimePay,
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
                properties: { basic_pay: basicPay, net_pay: netPay }
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
        res.json({ success: true, message: 'Payroll Computed & Saved!' });

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