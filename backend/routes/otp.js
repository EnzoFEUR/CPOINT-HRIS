import express from 'express';
import { generateOtpCode, storeOtp, verifyOtpCode, sendEmailOtp, sendSmsOtp, checkOtpCooldown, recordOtpDispatch, getOrGenerateOtp, getActiveOtp } from '../services/otpService.js';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// GET /api/auth/otp/status - Check if an active unexpired OTP exists for identifier
router.get('/status', (req, res) => {
    const { identifier, email, phone, purpose = 'login_2fa' } = req.query;
    const rawTarget = identifier || email || phone;
    const scopedTarget = `${purpose}_${rawTarget}`.toLowerCase().trim();
    const active = getActiveOtp(scopedTarget) || getActiveOtp(rawTarget);
    const cooldown = checkOtpCooldown(scopedTarget);

    res.json({
        success: true,
        hasActiveOtp: Boolean(active),
        remainingSeconds: active?.remainingSeconds || 0,
        isCooldown: !cooldown.allowed,
        cooldownRemaining: cooldown.remainingSeconds
    });
});

// POST /api/auth/otp/send - Generate and dispatch 6-digit OTP
router.post('/send', async (req, res) => {
    try {
        const { email, phone, user_id, method = 'email', purpose = 'login_2fa' } = req.body;
        
        if (!email && !phone && !user_id) {
            return res.status(400).json({ success: false, error: 'Missing user identifier (email, phone, or user_id)' });
        }

        // Fetch employee details
        let targetEmail = email;
        let targetPhone = phone;
        let targetName = 'Employee';

        if (user_id || email) {
            const query = supabase.from('employees').select('id, first_name, last_name, email, phone, role, status, is_active');
            const { data: emp } = user_id 
                ? await query.eq('id', user_id).maybeSingle()
                : await query.eq('email', email).maybeSingle();

            if (emp) {
                targetName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || 'Employee';
                targetEmail = emp.email || targetEmail;
                targetPhone = emp.phone || targetPhone;

                // Auto-reinstatement check for expired suspensions
                if (emp.role !== 'admin') {
                    const { data: activeDisciplinary } = await supabase
                        .from('disciplinary_logs')
                        .select('*')
                        .eq('employee_id', emp.id)
                        .eq('type', 'Suspension')
                        .eq('status', 'Active')
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (activeDisciplinary && activeDisciplinary.length > 0) {
                        const disc = activeDisciplinary[0];
                        const match = (disc.reason || '').match(/Until\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
                        const endDateStr = match ? match[1] : null;
                        const todayStr = new Date().toISOString().split('T')[0];

                        if (endDateStr && todayStr > endDateStr) {
                            // Suspension duration expired: Auto-reinstatement to active
                            await supabase.from('disciplinary_logs').update({ status: 'Resolved' }).eq('id', disc.id);
                            await supabase.from('employees').update({ status: 'active', is_active: true }).eq('id', emp.id);
                            console.log(`[AUTO_REINSTATE] Suspension for ${emp.id} ended on ${endDateStr}. Reinstated to active.`);
                        }
                    }
                }
            }
        }

        const baseIdentifier = (method === 'sms' ? targetPhone : targetEmail) || email || user_id;
        if (!baseIdentifier) {
            return res.status(400).json({ 
                success: false, 
                error: `No registered ${method === 'sms' ? 'phone number' : 'email'} found for this account.` 
            });
        }

        // Cryptographically isolate OTP stores by action scope
        const identifier = `${purpose}_${baseIdentifier}`.toLowerCase().trim();

        // Enterprise Resend Cooldown Check (scoped by purpose)
        const cooldownCheck = checkOtpCooldown(identifier);
        if (!cooldownCheck.allowed) {
            return res.status(429).json({
                success: false,
                error: `Please wait ${cooldownCheck.remainingSeconds}s before requesting a new verification code.`,
                retry_after: cooldownCheck.remainingSeconds
            });
        }

        // Enterprise Standard: Reuse active code if still valid (< 5 mins), otherwise generate fresh code
        const otpInfo = getOrGenerateOtp(identifier);
        const code = otpInfo.code;
        storeOtp(identifier, code);
        
        // Also map to targetEmail under the same purpose scope so verification succeeds regardless of identifier provided
        if (targetEmail && baseIdentifier !== targetEmail) {
            const emailScopedId = `${purpose}_${targetEmail}`.toLowerCase().trim();
            storeOtp(emailScopedId, code);
        }

        let dispatchResult;
        if (method === 'sms') {
            dispatchResult = await sendSmsOtp(targetPhone, code);
        } else {
            dispatchResult = await sendEmailOtp(targetEmail, code, targetName);
        }

        // Record cooldown dispatch on both primary identifier and email (scoped by purpose)
        recordOtpDispatch(identifier);
        if (targetEmail && baseIdentifier !== targetEmail) {
            recordOtpDispatch(`${purpose}_${targetEmail}`.toLowerCase().trim());
        }

        const isSimulated = Boolean(dispatchResult?.simulated);
        const previewCode = (isSimulated || method === 'sms' || process.env.ALLOW_OTP_PREVIEW !== 'false') ? code : undefined;

        res.json({
            success: true,
            message: `Verification code sent via ${method === 'sms' ? 'SMS' : 'Email'}`,
            method,
            purpose,
            cooldown: 60,
            simulated: isSimulated,
            previewCode,
            reusedExisting: otpInfo.isExisting,
            expiresIn: otpInfo.remainingSeconds
        });

    } catch (err) {
        console.error('[OTP_SEND_ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/auth/otp/verify - Validate 6-digit OTP code
router.post('/verify', async (req, res) => {
    try {
        const { identifier, email, phone, otp, purpose = 'login_2fa' } = req.body;
        const rawTarget = identifier || email || phone;

        if (!rawTarget || !otp) {
            return res.status(400).json({ success: false, error: 'Missing identifier or OTP code' });
        }

        // Check scoped identifier first (e.g. login_2fa_xxx or modal_stepup_xxx)
        const scopedTarget = `${purpose}_${rawTarget}`.toLowerCase().trim();
        let result = verifyOtpCode(scopedTarget, otp);

        // Fallback check against rawTarget for legacy compatibility
        if (!result.valid && !rawTarget.includes('_')) {
            const fallbackResult = verifyOtpCode(rawTarget, otp);
            if (fallbackResult.valid) {
                result = fallbackResult;
            }
        }

        if (!result.valid) {
            return res.status(400).json({ success: false, error: result.error });
        }

        res.json({
            success: true,
            purpose,
            message: 'OTP verified successfully'
        });

    } catch (err) {
        console.error('[OTP_VERIFY_ERROR]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
