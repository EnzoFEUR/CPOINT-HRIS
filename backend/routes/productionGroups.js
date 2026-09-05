import express from 'express';
import { supabase } from '../supabaseClient.js';
import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

// GET all active production groups with member counts
router.get('/', cacheResponse(30), async (req, res) => {
    try {
        const { data: groups, error } = await supabase
            .from('production_groups')
            .select(`
                id,
                code,
                name,
                target_output_pairs,
                is_active,
                created_at,
                updated_at,
                employees:employees(id, job_title, status)
            `)
            .eq('is_active', true)
            .order('code', { ascending: true });

        if (error) throw error;

        const enriched = (groups || []).map(group => {
            const activeEmployees = (group.employees || []).filter(e => e.status !== 'terminated');
            return {
                id: group.id,
                code: group.code,
                name: group.name,
                target_output_pairs: group.target_output_pairs || 100,
                is_active: group.is_active,
                member_count: activeEmployees.length,
                stages_filled: Array.from(new Set(activeEmployees.map(e => e.job_title).filter(Boolean))),
                created_at: group.created_at,
                updated_at: group.updated_at
            };
        });

        res.json({ success: true, data: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST create or ensure a production group
router.post('/', async (req, res) => {
    try {
        const { name, target_output_pairs = 100 } = req.body;
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Group name is required' });
        }

        const trimmedName = name.trim();
        const generatedCode = trimmedName
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        // Check if group code or name already exists
        const { data: existing } = await supabase
            .from('production_groups')
            .select('*')
            .or(`code.eq.${generatedCode},name.ilike.${trimmedName}`)
            .maybeSingle();

        if (existing) {
            return res.status(200).json({ success: true, data: existing, message: 'Production group already exists.' });
        }

        const { data: newGroup, error: insertError } = await supabase
            .from('production_groups')
            .insert({
                code: generatedCode || `LINE-${Date.now()}`,
                name: trimmedName,
                target_output_pairs: parseInt(target_output_pairs, 10) || 100,
                is_active: true
            })
            .select()
            .single();

        if (insertError) throw insertError;

        invalidateCache(['/api/production-groups', '/api/employees']);

        res.status(201).json({ success: true, data: newGroup, message: 'Production group created successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
