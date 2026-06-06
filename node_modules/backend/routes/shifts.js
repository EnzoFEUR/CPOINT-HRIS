import express from 'express';
import fs from 'fs';
import path from 'path';
import { supabase } from '../index.js';
import { fileURLToPath } from 'url';
import { createNotification } from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shiftsFilePath = path.join(__dirname, '../data/shifts.json');

const router = express.Router();

// Ensure shifts file exists
const initShifts = () => {
    if (!fs.existsSync(path.join(__dirname, '../data'))) {
        fs.mkdirSync(path.join(__dirname, '../data'));
    }
    if (!fs.existsSync(shiftsFilePath)) {
        fs.writeFileSync(shiftsFilePath, JSON.stringify({}));
    }
};
initShifts();

router.get('/', async (req, res) => {
    try {
        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .order('first_name', { ascending: true });

        if (error) throw error;

        const shiftsData = JSON.parse(fs.readFileSync(shiftsFilePath, 'utf8'));

        // Attach shifts to employees
        const employeesWithShifts = employees.map(emp => ({
            ...emp,
            shift: shiftsData[emp.id] || 'Unassigned'
        }));

        res.json(employeesWithShifts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/assign', async (req, res) => {
    try {
        const { employee_id, shift } = req.body;
        
        const shiftsData = JSON.parse(fs.readFileSync(shiftsFilePath, 'utf8'));
        shiftsData[employee_id] = shift;
        
        fs.writeFileSync(shiftsFilePath, JSON.stringify(shiftsData, null, 2));

        // Enterprise: Broadcast Realtime Notification to specific employee
        await createNotification({
            target: employee_id,
            title: 'Shift Assignment Updated',
            text: `Your shift schedule was updated to: ${shift}`,
            type: 'shift'
        });

        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'shifts',
                description: `Assigned shift ${shift} to employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Employee',
                subject_id: employee_id,
                event: 'updated',
                causer_id: req.body.admin_id,
                properties: { shift }
            });
        }

        res.json({ success: true, message: `Shift updated to ${shift} successfully.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
