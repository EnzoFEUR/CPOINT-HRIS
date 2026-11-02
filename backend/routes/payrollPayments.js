import express from 'express';
import { validateUuidParam } from '../middleware/requestValidation.js';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { executePayrollPayment } from '../services/payrollPaymentService.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { broadcastPayrollUpdate } from './payroll.js';
import { refreshLeaveCredits } from './leaves.js';
import { supabase } from '../supabaseClient.js';
import { isLeaveDate } from '../../shared/leaveCredits.mjs';

const router = express.Router();
router.param('id', validateUuidParam);

const handle = action => async (req, res) => {
    if (req.user?.employee_identity_verified !== true || (action === 'record' && !hasVerifiedManagerRole(req.user))) {
        return res.status(403).json({ success: false, error: 'Verified employee identity and appropriate payment access are required.' });
    }
    if (action === 'record' && !isLeaveDate(req.body?.payment_date)) return res.status(400).json({ success: false, error: 'Enter the completed payment date.' });
    try {
        const data = await executePayrollPayment(req.user.id, req.params.id, action, action === 'read' ? {} : req.body);
        if (action !== 'read' && !data.replayed) {
            if (action === 'record') invalidateCache(['/api/payroll', '/api/dashboard']);
            broadcastPayrollUpdate(action === 'record' ? 'PAYROLL_UPDATED' : 'PAYROLL_PAYMENT_UPDATED', { id: data.payroll_id, employee_id: data.employee_id });
            if (action === 'record' && data.sil_payment) refreshLeaveCredits(supabase, data.employee_id);
        }
        res.json({ success: true, data });
    } catch (error) {
        res.status(error.status || 503).json({ success: false, code: error.code || 'PAYMENT_UNAVAILABLE', error: error.status ? error.message : 'Payment confirmation is temporarily unavailable.' });
    }
};
router.get('/:id', handle('read'));
router.post('/:id/record', handle('record'));
router.post('/:id/acknowledge', handle('acknowledge'));
export default router;
