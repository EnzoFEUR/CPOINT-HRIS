import express from 'express';
import { generateOtpCode, storeOtp, verifyOtpCode, sendEmailOtp, sendSmsOtp } from '../services/otpService.js';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// POST /api/auth/otp/send - Generate and dispatch 6-digit OTP
router.post('/send', async (req, res) => {
    try {
        const { email, phone, user_id, method = 'email' } = req.body;
        
        if (!email && !phone && !user_id) {
            return res.status(400).json({ success: false, error: 'Missing user identifier (email, phone, or user_id)' });
        }

        // Fetch employee details
        let targetEmail = email;
        let targetPhone = phone;
        let targetName = 'Employee';

        if (user_id || email) {
            const query = supabase.from('employees').select('id, first_name, last_name, email, phone');
            const { data: emp } = user_id 
                ? await query.eq('id', user_id).maybeSingle()
                : await query.eq('email', email).maybeSingle();

            if (emp) {
                targetName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
                targetEmail = emp.email || targetEmail;
                targetPhone = emp.phone || targetPhone;
            }
        }

        const identifier = (method === 'sms' ? targetPhone : targetEmail) || email || user_id;
        if (!identifier) {
            return res.status(400).json({ 
                success: false, 
                error: `No registered ${method === 'sms' ? 'phone number' : 'email'} found for this account.` 
            });
        }

        // Generate 6-digit code and store in TTL memory store
        const code = generateOtpCode();
        storeOtp(identifier, code);
        
        // Also map to targetEmail so verification succeeds regardless of identifier provided
        if (targetEmail && identifier !== targetEmail) {
            storeOtp(targetEmail, code);
        }

        let dispatchResult;
        if (method === 'sms') {
            dispatchResult = await sendSmsOtp(targetPhone, code);
        } else {
            dispatchResult = await sendEmailOtp(targetEmail, code, targetName);
        }

        res.json({
            success: true,
            message: `Verification code sent via ${method === 'sms' ? 'SMS' : 'Email'}`,
            method,
            simulated: dispatchResult?.simulated || false,
            previewCode: dispatchResult?.simulated ? code : undefined
        });

    } catch (err) {
        console.error('[OTP_SEND_ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/auth/otp/verify - Validate 6-digit OTP code
router.post('/verify', async (req, res) => {
    try {
        const { identifier, email, phone, otp } = req.body;
        const targetId = identifier || email || phone;

        if (!targetId || !otp) {
            return res.status(400).json({ success: false, error: 'Missing identifier or OTP code' });
        }

        const result = verifyOtpCode(targetId, otp);
        if (!result.valid) {
            return res.status(400).json({ success: false, error: result.error });
        }

        res.json({
            success: true,
            message: 'OTP verified successfully'
        });

    } catch (err) {
        console.error('[OTP_VERIFY_ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
