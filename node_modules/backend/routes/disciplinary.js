import express from 'express';
import fs from 'fs';
import path from 'path';
import { supabase } from '../index.js';
import { fileURLToPath } from 'url';
import { createNotification } from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const discFilePath = path.join(__dirname, '../data/disciplinary.json');

const router = express.Router();

const initDisciplinary = () => {
    if (!fs.existsSync(path.join(__dirname, '../data'))) {
        fs.mkdirSync(path.join(__dirname, '../data'));
    }
    if (!fs.existsSync(discFilePath)) {
        fs.writeFileSync(discFilePath, JSON.stringify([]));
    }
};
initDisciplinary();

router.get('/', async (req, res) => {
    try {
        const records = JSON.parse(fs.readFileSync(discFilePath, 'utf8'));
        
        // Fetch employees to attach names
        const { data: employees, error } = await supabase.from('employees').select('id, first_name, last_name, department');
        if (error) throw error;
        
        const enrichedRecords = records.map(record => {
            const emp = employees.find(e => e.id === record.employee_id) || {};
            return {
                ...record,
                employee_name: emp.first_name ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
                department: emp.department || 'Unknown'
            };
        }).reverse(); // Latest first

        res.json(enrichedRecords);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { employee_id, type, reason, severity } = req.body;
        
        if (!employee_id || !type || !reason || !severity) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        const records = JSON.parse(fs.readFileSync(discFilePath, 'utf8'));
        
        const newRecord = {
            id: Date.now().toString(),
            employee_id,
            type,
            reason,
            severity,
            date: new Date().toISOString().split('T')[0],
            status: 'Active'
        };
        
        records.push(newRecord);
        fs.writeFileSync(discFilePath, JSON.stringify(records, null, 2));

        // Send notification to employee
        await createNotification({
            target: employee_id,
            title: 'New HR Notice',
            text: `You have a new disciplinary notice: ${type}`,
            type: 'system'
        });

        if (req.body.admin_id) {
            const { createAuditLog } = await import('./auditLogs.js');
            await createAuditLog({
                log_name: 'disciplinary',
                description: `Issued ${type} to employee ID ${employee_id}`,
                subject_type: 'App\\Models\\Disciplinary',
                subject_id: employee_id,
                event: 'created',
                causer_id: req.body.admin_id,
                properties: { type, severity, reason }
            });
        }

        res.json({ success: true, message: 'Disciplinary log recorded successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/resolve', async (req, res) => {
    try {
        const records = JSON.parse(fs.readFileSync(discFilePath, 'utf8'));
        const recordIndex = records.findIndex(r => r.id === req.params.id);
        
        if (recordIndex === -1) {
            return res.status(404).json({ error: 'Record not found.' });
        }
        
        records[recordIndex].status = 'Resolved';
        fs.writeFileSync(discFilePath, JSON.stringify(records, null, 2));

        res.json({ success: true, message: 'Record marked as resolved.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id/acknowledge', async (req, res) => {
    try {
        const records = JSON.parse(fs.readFileSync(discFilePath, 'utf8'));
        const recordIndex = records.findIndex(r => r.id === req.params.id);
        
        if (recordIndex === -1) {
            return res.status(404).json({ error: 'Record not found.' });
        }
        
        records[recordIndex].status = 'Acknowledged';
        fs.writeFileSync(discFilePath, JSON.stringify(records, null, 2));

        res.json({ success: true, message: 'Record acknowledged.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
