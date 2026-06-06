import express from 'express';
import { supabase } from '../index.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get profile
router.get('/', verifyToken, async (req, res) => {
    res.json({ user: req.user });
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
