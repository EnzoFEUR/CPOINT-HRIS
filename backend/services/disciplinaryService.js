import crypto from 'node:crypto';
import { supabase } from '../supabaseClient.js';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (message, status, code) => Object.assign(new Error(message), { status, code });

export function createDisciplinaryService(client = supabase) {
    return {
        async command({ actorId = null, employeeId = null, action, recordId = null, payload = {}, operationId = crypto.randomUUID() }) {
            if (!uuid(operationId) || employeeId !== null && !uuid(employeeId) || recordId !== null && !uuid(recordId) || actorId !== null && !uuid(actorId)) {
                throw fail('Invalid disciplinary request identifier.', 400, 'DISCIPLINARY_INVALID');
            }
            let response;
            try { response = await client.rpc('hris_disciplinary_command', { p_actor_id: actorId, p_employee_id: employeeId, p_action: action,
                p_record_id: recordId, p_payload: payload, p_operation_id: operationId }).abortSignal(AbortSignal.timeout(10000)); }
            catch { throw fail('The action outcome could not be confirmed. Retry using the same request.', 503, 'DISCIPLINARY_UNAVAILABLE'); }
            if (response.error) {
                const message = response.error.message || '';
                if (message.includes('DISCIPLINARY_FORBIDDEN')) throw fail('Administrative privileges or ownership are required.', 403, 'DISCIPLINARY_FORBIDDEN');
                if (message.includes('DISCIPLINARY_NOT_FOUND')) throw fail('Employee or disciplinary record not found.', 404, 'DISCIPLINARY_NOT_FOUND');
                if (message.includes('DISCIPLINARY_CONFLICT')) throw fail('The employee or case changed. Refresh before retrying.', 409, 'DISCIPLINARY_CONFLICT');
                if (message.includes('DISCIPLINARY_NOT_EXPIRED')) throw fail('This suspension has not expired.', 409, 'DISCIPLINARY_NOT_EXPIRED');
                if (message.includes('DISCIPLINARY_INVALID') || message.includes('DISCIPLINARY_EXEMPT') || ['22007','22008','22P02'].includes(response.error.code)) throw fail('Invalid disciplinary details or effective date, or an exempt employee.', 400, 'DISCIPLINARY_INVALID');
                throw fail('The disciplinary service is unavailable. No nontransactional fallback was attempted.', 503, 'DISCIPLINARY_UNAVAILABLE');
            }
            if (!response.data?.record || !response.data?.employee) throw fail('The committed action could not be verified.', 503, 'DISCIPLINARY_UNAVAILABLE');
            return response.data;
        },
        expire(employeeId, recordId) { return this.command({ employeeId, recordId, action: 'expire' }); }
    };
}
export const disciplinaryService = createDisciplinaryService();
