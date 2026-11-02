import { supabase } from '../supabaseClient.js';
import { isCreditUuid, isLeaveDate } from '../../shared/leaveCredits.mjs';

const fail = (message, status = 400, code = 'PAYMENT_INVALID_INPUT') => Object.assign(new Error(message), { status, code });
const failures = {
    PAYMENT_INVALID_INPUT: [400, 'Check the payment reference, date and confirmation.'],
    PAYMENT_FORBIDDEN: [403, 'You are not authorized to perform this payment action.'],
    PAYMENT_NOT_FOUND: [404, 'Payslip not found.'],
    PAYMENT_NOT_RECORDED: [409, 'HR must record the completed payment before you can acknowledge receipt.'],
    PAYMENT_NOT_PAYABLE: [409, 'This payslip is not ready for payment recording.'],
    PAYMENT_CHANGED: [409, 'The payment changed. Refresh the payslip before confirming.'],
    PAYMENT_CONFLICT: [409, 'Payment is already recorded or changed. Refresh to view the current record.'],
    PAYMENT_RECORD_LOCKED: [409, 'Recorded payment details cannot be changed.'],
};

export async function executePayrollPayment(actorId, payrollId, action, payload = {}, client = supabase) {
    if (!isCreditUuid(actorId) || !isCreditUuid(payrollId) || !['read', 'record', 'acknowledge'].includes(action)) throw fail('Invalid payment request.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('Invalid payment request.');
    const command = {};
    if (action !== 'read') {
        if (!isCreditUuid(payload.operation_id) || payload.confirmed !== true) throw fail('Confirm the payment action before submitting.');
        Object.assign(command, { operation_id: payload.operation_id, confirmed: true });
        if (action === 'record') {
            if (typeof payload.reference !== 'string' || !payload.reference.trim() || payload.reference.length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(payload.reference)) throw fail('Enter a completed payment reference of up to 120 characters.');
            command.reference = payload.reference.trim();
            if (payload.payment_date != null) {
                const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
                if (!isLeaveDate(payload.payment_date) || payload.payment_date > today) throw fail('Enter a valid payment date that is not in the future.');
                command.payment_date = payload.payment_date;
            }
        } else {
            if (!isCreditUuid(payload.payment_operation_id)) throw fail('Refresh the recorded payment before confirming.');
            command.payment_operation_id = payload.payment_operation_id;
        }
    }
    let response;
    try {
        response = await client.rpc('hris_payroll_payment_command', { p_actor_id: actorId, p_payroll_id: payrollId.toLowerCase(), p_action: action, p_payload: command }).abortSignal(AbortSignal.timeout(5000));
    } catch { throw fail('Payment confirmation is temporarily unavailable. Refresh before retrying.', 503, 'PAYMENT_UNAVAILABLE'); }
    if (response.error) {
        const code = Object.keys(failures).find(name => response.error.message?.includes(name));
        if (code) throw fail(failures[code][1], failures[code][0], code);
        if (response.error.code === '23505') throw fail('This payment request was already used. Refresh the payslip.', 409, 'PAYMENT_CONFLICT');
        console.error('[PAYROLL_PAYMENT_STORAGE]', { action, code: response.error.code });
        throw fail('Payment confirmation is temporarily unavailable. Contact HR if this continues.', 503, 'PAYMENT_UNAVAILABLE');
    }
    if (!response.data?.payroll_id || response.data.payroll_id !== payrollId.toLowerCase() || !response.data.employee_id) throw fail('Unable to verify the payment response. Refresh the payslip.', 503, 'PAYMENT_UNAVAILABLE');
    return response.data;
}
