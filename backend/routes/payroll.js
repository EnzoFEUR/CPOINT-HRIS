import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

router.get('/', cacheResponse(20), async (req, res) => {
    try {
        let query = supabase.from('payrolls').select('*, employees:employee_id(*)').order('created_at', { ascending: false });
        
        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }
        
        if (req.query.month) query = query.gte('period_start', `${req.query.year || new Date().getFullYear()}-${req.query.month.padStart(2, '0')}-01`);
        
        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { employee_id, period_start, period_end, days_worked, overtime_hours, late_deductions } = req.body;

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

        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        if (!employee || !employee.salary) {
            return res.status(400).json({ error: 'Cannot compute payroll: Employee has no monthly salary set.' });
        }

        const monthlyRate = parseFloat(employee.salary);
        const dailyRate = monthlyRate / 21.75;
        const basicPay = monthlyRate / 2;
        const hourlyRate = dailyRate / 8;
        const overtimePay = (hourlyRate * 1.25) * parseFloat(overtime_hours || 0);

        const grossPay = basicPay + overtimePay;

        let philHealth = monthlyRate * 0.025;
        if (philHealth < 250) philHealth = 250;
        if (philHealth > 2500) philHealth = 2500;

        const pagIbig = monthlyRate >= 5000 ? 200 : monthlyRate * 0.01;
        
        let sss = monthlyRate * 0.05;
        if (sss > 1350) sss = 1350;

        const totalContributions = sss + philHealth + pagIbig;
        const lateDed = parseFloat(late_deductions || 0);
        const taxableIncome = grossPay - totalContributions - lateDed;

        let tax = 0;
        if (taxableIncome > 20833) {
            if (taxableIncome <= 33332) tax = (taxableIncome - 20833) * 0.15;
            else if (taxableIncome <= 66666) tax = 1875 + ((taxableIncome - 33333) * 0.20);
            else if (taxableIncome <= 166666) tax = 8541.80 + ((taxableIncome - 66667) * 0.25);
            else if (taxableIncome <= 666666) tax = 33541.80 + ((taxableIncome - 166667) * 0.30);
            else tax = 183541.80 + ((taxableIncome - 666667) * 0.35);
        }

        const totalDeductions = totalContributions + tax + lateDed;
        const netPay = grossPay - totalDeductions;

        let remarks = `SSS: ${sss.toFixed(2)}, PhilHealth: ${philHealth.toFixed(2)}, Pag-IBIG: ${pagIbig.toFixed(2)}, Tax: ${tax.toFixed(2)}`;
        if (lateDed > 0) remarks += `, Late/Absences: ${lateDed.toFixed(2)}`;

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

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// GET single payroll
router.get('/:id', cacheResponse(20), async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ 
                status: 'error', 
                code: 'INVALID_UUID', 
                message: 'Invalid Payroll ID format. Expected a valid UUID.' 
            });
        }

        const { data, error } = await supabase
            .from('payrolls')
            .select('*, employees:employee_id(*)')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ 
                status: 'error', 
                code: 'NOT_FOUND', 
                message: 'Payroll record not found.' 
            });
        }

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE payroll
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !isValidUUID(id)) {
            return res.status(400).json({ 
                status: 'error', 
                code: 'INVALID_UUID', 
                message: 'Invalid Payroll ID format. Expected a valid UUID.' 
            });
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
