import express from 'express';
import { supabase } from '../supabaseClient.js';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import { validateUuidParam } from '../middleware/requestValidation.js';
import { exitPayload, exitRequestIds, requiresRetirementLetter, retirementLetterDocumentId, validRetirementLetterFile } from '../../shared/employmentExit.mjs';
import { findDocument, normalizeDocumentPath } from '../services/documentService.js';
import { publishExitUpdate } from '../services/employmentExitEvents.js';
const errors = {
    EXIT_FORBIDDEN: [
        403,
        'You can access only your own receipts; HR access must be verified.',
    ],
    EXIT_NOT_FOUND: [404, 'The receipt was not found.'],
    EXIT_CONFLICT: [
        409,
        'This receipt changed. Refresh and review the latest version.',
    ],
    EXIT_DUPLICATE: [
        409,
        'An open case already exists for this request. Open it to reply or ask HR for review instead of submitting another.',
    ],
    EXIT_EVIDENCE: [
        400,
        'Provide the original received time and evidence, or a clear review note.',
    ],
    EXIT_INVALID: [
        400,
        'Check the request type, dates, confirmations and finding. A resignation notice has no arbitrary Reject action.',
    ],
    EXIT_DATE_AGREEMENT: [
        400,
        'A change to the employee’s proposed date needs explicit agreement and a written explanation.',
    ],
    EXIT_ELIGIBILITY_REVIEW: [
        400,
        'Verify statutory age, actual service, coverage and retirement intent. Early-retirement agreements need separate review.',
    ],
    EXIT_NOTICE_REVIEW: [
        400,
        'The standard notice period is not met. Review an agreed shorter period or the applicable legal basis.',
    ],
    EXIT_NOT_DUE: [
        409,
        'The effective date has not arrived. The employee remains active.',
    ],
    EXIT_REVIEW_PENDING: [
        409,
        'Respond to the outstanding review or withdrawal request before finalizing separation.',
    ],
    EXIT_SOURCE_CHANGED: [
        409,
        'The employee record changed after review. Verify the record again before separation.',
    ],
    EXIT_WITHDRAWAL_REQUIRED: [
        400,
        'A withdrawal must originate from the employee; record their request first.',
    ],
};
export function createEmploymentExitRouter({
    client = supabase,
    onCommit = (result) =>
        publishExitUpdate(result.record.employee_id, {
            separated: result.action === 'separate',
        }),
} = {}) {
    const router = express.Router();
    router.param('id', validateUuidParam);
    router.use((req, res, next) =>
        req.user?.employee_identity_verified === true &&
        req.user?.role_verified === true &&
        ['employee', 'admin', 'hr'].includes(req.user.role)
            ? next()
            : res
                  .status(403)
                  .json({ error: 'A verified employee identity is required.' })
    );
    const manager = (req, res, next) =>
        hasVerifiedManagerRole(req.user)
            ? next()
            : res
                  .status(403)
                  .json({
                      error: 'Verified HR or administrator access is required.',
                  });
    const run = (action) => async (req, res) => {
        try {
            const mutation = !['list', 'get', 'open', 'letter'].includes(action),
                ids = exitRequestIds(action === 'open' ? req.query : req.body, mutation);
            if (
                (mutation || action === 'open') &&
                ids.employeeId &&
                ids.employeeId !== req.user.id &&
                !hasVerifiedManagerRole(req.user)
            )
                return res
                    .status(403)
                    .json({ error: 'You can submit only your own request.' });
            const payload = mutation
                ? exitPayload(req.body, action)
                : action === 'list'
                  ? {
                        page: req.query.page || '1',
                        limit: '25',
                        status: req.query.status || 'all',
                    }
                  : {};
            if (
                action === 'submit' &&
                payload.source !== 'employee_app' &&
                !hasVerifiedManagerRole(req.user)
            )
                return res
                    .status(403)
                    .json({
                        error: 'Only HR may record assisted or external submissions.',
                    });
            if (action === 'submit' && requiresRetirementLetter(payload.kind, payload.source)) {
                const invalidLetter = () => Object.assign(new Error('Upload a valid retirement letter belonging to your employee account before submitting.'), { status: 400 });
                let letter;
                try {
                    letter = await findDocument(client, retirementLetterDocumentId(payload.evidence_reference));
                } catch (error) {
                    if (error.status === 404) throw invalidLetter();
                    throw error;
                }
                if (letter.employee_id !== req.user.id ||
                    letter.document_type !== 'Retirement Letter' ||
                    !['pending', 'approved'].includes(letter.status) ||
                    !validRetirementLetterFile(letter.file_name, Number(letter.file_size)))
                    throw invalidLetter();
                normalizeDocumentPath(letter.file_path, req.user.id, client.supabaseUrl);
            }
            const { data, error } = await client
                .rpc(action === 'open' ? 'hris_employment_exit_open' : 'hris_employment_exit_command', action === 'open' ? {
                    p_actor_id: req.user.id,
                    p_employee_id: ids.employeeId,
                } : {
                    p_actor_id: req.user.id,
                    p_action: action === 'letter' ? 'get' : action,
                    p_request_id: req.params.id || null,
                    p_employee_id: ids.employeeId,
                    p_payload: payload,
                    p_operation_id: ids.operationId,
                })
                .abortSignal(AbortSignal.timeout(10000));
            if (error) {
                if (error.code === '23505' && /exit_one_open_(retirement|kind)/.test(error.message || ''))
                    throw Object.assign(new Error(errors.EXIT_DUPLICATE[1]), { status: 409, code: 'EXIT_DUPLICATE' });
                const code = Object.keys(errors).find((code) =>
                    error.message?.includes(code)
                );
                if (code)
                    throw Object.assign(new Error(errors[code][1]), {
                        status: errors[code][0],
                        code,
                    });
                if (['22007', '22008', '22P02'].includes(error.code))
                    throw Object.assign(
                        new Error('Provide valid dates and request values.'),
                        { status: 400 }
                    );
                throw Object.assign(
                    new Error(
                        'Employment Exit storage is unavailable. Contact the administrator.'
                    ),
                    { status: 503, code: 'EXIT_UNAVAILABLE' }
                );
            }
            if (!data || typeof data !== 'object')
                throw new Error('Invalid receipt response');
            if (action === 'letter') {
                const id = retirementLetterDocumentId(data.record?.evidence_reference);
                if (!id) return res.status(404).json({ error: 'No uploaded retirement letter is attached to this receipt.' });
                const letter = await findDocument(client, id);
                if (letter.employee_id !== data.record.employee_id)
                    return res.status(404).json({ error: 'The retirement letter is unavailable.' });
                normalizeDocumentPath(letter.file_path, data.record.employee_id, client.supabaseUrl);
                return res.json({ document: {
                    id: letter.id, title: letter.title || 'Retirement Letter', file_name: letter.file_name,
                    file_size: letter.file_size, category: letter.category, status: letter.status,
                } });
            }
            if (mutation && !data.replayed) {
                try {
                    onCommit(data);
                } catch {
                    console.warn(
                        '[EMPLOYMENT_EXIT] Committed receipt requires a refresh.'
                    );
                }
            }
            res.json(data);
        } catch (error) {
            const status = error.status || 503;
            if (status === 503) res.setHeader('Retry-After', '2');
            res.status(status).json({
                success: false,
                code: error.code,
                error: error.status
                    ? error.message
                    : 'The outcome could not be confirmed. Refresh the register and retry using the same request.',
            });
        }
    };
    router.get('/', run('list'));
    router.get('/open', run('open'));
    router.get('/:id/retirement-letter', run('letter'));
    router.get('/:id', run('get'));
    router.post('/', run('submit'));
    router.post('/:id/review', manager, run('review'));
    router.post('/:id/separate', manager, run('separate'));
    router.post('/:id/reply', run('reply'));
    router.post('/:id/review-request', run('request_review'));
    router.post('/:id/withdrawal-request', run('request_withdrawal'));
    return router;
}
export default createEmploymentExitRouter();
