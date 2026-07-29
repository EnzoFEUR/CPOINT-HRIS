import express from 'express';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

export const createAuditLog = async ({ log_name, description, subject_type, subject_id, event, causer_id, properties }) => {
    try {
        await supabase.from('activity_log').insert({
            log_name,
            description,
            subject_type,
            subject_id,
            event,
            causer_type: 'App\\Models\\User',
            causer_id,
            properties
        });
    } catch (err) {
        console.error("Failed to create audit log:", err);
    }
};

router.get('/', async (req, res) => {
    try {
        let query = supabase.from('activity_log').select('*').order('created_at', { ascending: false });

        if (req.query.date) {
            query = query.gte('created_at', `${req.query.date}T00:00:00Z`).lte('created_at', `${req.query.date}T23:59:59Z`);
        }

        if (req.query.user_id) {
            query = query.eq('causer_id', req.query.user_id);
        }

        const { data, error } = await query;
        if (error) {
             console.warn("Audit log query failed, table might not exist yet:", error.message);
             return res.json({ data: [] });
        }
        
        const safeData = data || [];
        const causerIds = [...new Set(safeData.map(d => d.causer_id).filter(Boolean))];
        let usersData = [];
        if (causerIds.length > 0) {
            const { data: users } = await supabase.from('employees').select('id, first_name, last_name').in('id', causerIds);
            usersData = users || [];
        }

        const mappedData = safeData.map(log => {
            const user = usersData.find(u => u.id === log.causer_id);
            return {
                ...log,
                causer: user ? { name: `${user.first_name} ${user.last_name}` } : null
            };
        });

        res.json({ data: mappedData });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
