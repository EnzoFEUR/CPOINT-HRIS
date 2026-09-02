import express from 'express';
import { supabase } from '../supabaseClient.js';
import { verifyToken } from '../middleware/authMiddleware.js';

import { cacheResponse, invalidateCache } from '../middleware/cacheMiddleware.js';

const router = express.Router();

// Get profile and 201 documents in a single parallel batch
router.get('/', verifyToken, cacheResponse(15), async (req, res) => {
    try {
        const userId = req.user.id;
        const [empRes, docsRes] = await Promise.all([
            supabase.from('employees').select('*').eq('id', userId).single(),
            supabase.from('documents').select('*').eq('employee_id', userId).order('created_at', { ascending: false })
        ]);

        const employee = empRes.data || req.user;
        const documents = docsRes.data || [];

        res.json({
            success: true,
            user: employee,
            employee,
            documents
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, user: req.user, documents: [] });
    }
});

// Update profile
router.patch('/', verifyToken, async (req, res) => {
    try {
        const { first_name, last_name, email } = req.body;
        
        // Update Supabase Auth if email changes
        if (email && email !== req.user.email) {
            const { error: authError } = await supabase.auth.admin.updateUserById(req.user.id, { email });
            if (authError) throw authError;
        }

        // Update Employees table
        const { data, error } = await supabase
            .from('employees')
            .update({ first_name, last_name })
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, message: 'profile-updated', user: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Upload / Update Profile Avatar
router.post('/avatar', verifyToken, async (req, res) => {
    try {
        const { image_base64 } = req.body;
        if (!image_base64) {
            return res.status(400).json({ error: 'image_base64 is required' });
        }

        const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const companyId = req.user.company_id || 'CP-MAIN';
        const filePath = `face-baselines/${companyId}/${req.user.id}.jpg`;

        const { error: uploadError } = await supabase.storage
            .from('public-bucket')
            .upload(filePath, buffer, {
                contentType: 'image/jpeg',
                upsert: true,
            });

        if (uploadError) throw uploadError;

        const publicUrl = `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/${filePath}?t=${Date.now()}`;

        await supabase
            .from('employees')
            .update({ avatar_url: publicUrl, has_registered_biometrics: true })
            .eq('id', req.user.id);

        res.json({ success: true, avatar_url: publicUrl });
    } catch (err) {
        console.error('Avatar upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete account
router.delete('/', verifyToken, async (req, res) => {
    try {
        // Must verify password in a real scenario
        const { error } = await supabase.auth.admin.deleteUser(req.user.id);
        if (error) throw error;
        res.json({ success: true, message: 'account-deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
