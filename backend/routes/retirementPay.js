import express from 'express';
import { supabase } from '../supabaseClient.js';
import { hasVerifiedManagerRole } from '../middleware/authMiddleware.js';
import {
    postgrestValue,
    validateUuidParam,
} from '../middleware/requestValidation.js';
import { isCreditUuid, isLeaveDate } from '../../shared/leaveCredits.mjs';
import { hasUnsafeDisplayCharacters } from '../../shared/inputLimits.mjs';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { publishExitUpdate } from '../services/employmentExitEvents.js';

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const money = (value) =>
    ['number', 'string'].includes(typeof value) &&
    /^[0-9]{1,13}(\.[0-9]{1,2})?$/.test(String(value));
const calculationFields = [
    'retirement_date',
    'rate_basis',
    'daily_rate',
    'earnings_12_months',
    'actual_workdays',
    'rate_note',
    'exit_request_id',
];
const reviewFields = [
    'expected_status',
    'coverage_confirmed',
    'rate_confirmed',
    'retirement_confirmed',
    'review_note',
];
const paymentFields = [
    'expected_status',
    'payment_date',
    'payment_reference',
    'tax_withheld',
    'tax_review_confirmed',
    'tax_review_note',
];
let retirementChannel;
function publishRetirementChange(result) {
    if (result.replayed) return;
    if (result.record?.employee_id) publishExitUpdate(result.record.employee_id);
    invalidateCache(['/api/retirement-pay']);
    retirementChannel ||= supabase.channel('retirement-pay-ledger', {
        config: { private: true },
    });
    // No wages or employee identities are sent through the invalidation channel.
    retirementChannel
        .send({
            type: 'broadcast',
            event: 'RETIREMENT_CHANGED',
            payload: { changed: true },
        })
        .catch(() =>
            console.warn(
                '[RETIREMENT_REALTIME] Refresh signal could not be delivered.'
            )
        );
}
function checkedPayload(body, fields) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw invalid('Provide valid retirement details.');
    const payload = Object.fromEntries(
        fields
            .filter((key) => Object.hasOwn(body, key))
            .map((key) => [key, body[key]])
    );
    for (const key of [
        'rate_note',
        'review_note',
        'tax_review_note',
        'reason',
        'payment_reference',
        'expected_status',
    ]) {
        if (
            payload[key] !== undefined &&
            (typeof payload[key] !== 'string' ||
                payload[key].length >
                    (key === 'payment_reference' ? 120 : 1000) ||
                hasUnsafeDisplayCharacters(payload[key]))
        )
            throw invalid(
                'Review notes and references must be bounded readable text.'
            );
    }
    for (const key of [
        'coverage_confirmed',
        'rate_confirmed',
        'retirement_confirmed',
        'tax_review_confirmed',
    ]) {
        if (payload[key] !== undefined && typeof payload[key] !== 'boolean')
            throw invalid('Review confirmations must be checked explicitly.');
    }
    return payload;
}
function calculationPayload(body, save) {
    if (!isCreditUuid(body?.employee_id)) throw invalid('Select an employee.');
    const payload = checkedPayload(body, calculationFields);
    if (payload.exit_request_id !== undefined && !isCreditUuid(payload.exit_request_id)) throw invalid('Invalid Employment Exit receipt.');
    if (save && !payload.exit_request_id) throw Object.assign(new Error('Open a reviewed Employment Exit case before saving retirement pay.'), { status: 409, code: 'RETIREMENT_EXIT_REQUIRED' });
    if (!isLeaveDate(payload.retirement_date))
        throw invalid('Enter a valid retirement date.');
    if (
        !['daily', 'monthly_equivalent', 'piece_rate'].includes(
            payload.rate_basis
        )
    )
        throw invalid('Select the verified wage basis.');
    if (payload.rate_basis === 'piece_rate') {
        if (
            !money(payload.earnings_12_months) ||
            Number(payload.earnings_12_months) <= 0 ||
            Number(payload.earnings_12_months) > 1000000000 ||
            !/^[1-9][0-9]{0,2}$/.test(String(payload.actual_workdays)) ||
            Number(payload.actual_workdays) > 366
        )
            throw invalid(
                'Provide twelve-month basic earnings and 1–366 actual workdays.'
            );
        delete payload.daily_rate;
    } else {
        if (
            !money(payload.daily_rate) ||
            Number(payload.daily_rate) <= 0 ||
            Number(payload.daily_rate) > 1000000
        )
            throw invalid(
                'Provide a positive basic daily rate up to PHP 1,000,000.'
            );
        delete payload.earnings_12_months;
        delete payload.actual_workdays;
    }
    if (save && (!payload.rate_note || payload.rate_note.trim().length < 10))
        throw invalid(
            'Explain the wage basis and supporting records in at least 10 characters.'
        );
    return payload;
}
const databaseErrors = {
    RETIREMENT_EXIT_REQUIRED: [409, 'This settlement needs a reviewed Employment Exit case. Cancel an unlinked unpaid calculation and prepare it from the case.'],
    RETIREMENT_EXIT_REQUEST: [409, 'The linked receipt must match a verified retirement, employee and date. Refresh HR review first.'],
    RETIREMENT_FORBIDDEN: [
        403,
        'Verified HR or administrator access is required.',
    ],
    RETIREMENT_NOT_FOUND: [404, 'Employee or settlement was not found.'],
    RETIREMENT_CONFLICT: [
        409,
        'This settlement changed. Refresh and review the current record.',
    ],
    RETIREMENT_DUPLICATE: [
        409,
        'An uncancelled settlement already exists for this employment period.',
    ],
    RETIREMENT_SOURCE_CHANGED: [
        409,
        'Employee dates or wage data changed. Cancel this unpaid settlement and create a fresh calculation.',
    ],
    RETIREMENT_INELIGIBLE: [
        400,
        'The standard statutory eligibility checks are not satisfied. Review the calculation details.',
    ],
    RETIREMENT_REVIEW_REQUIRED: [
        400,
        'Complete the required review confirmations and supporting notes.',
    ],
    RETIREMENT_SEPARATION_REQUIRED: [
        409,
        'Record the employee’s Retirement separation with the matching retirement date before recording payment.',
    ],
    RETIREMENT_INVALID: [
        400,
        'Check the retirement details, dates, rate and payment reference.',
    ],
};
export function createRetirementRouter({
    client = supabase,
    onCommit = publishRetirementChange,
} = {}) {
    const router = express.Router();
    router.param('id', validateUuidParam);
    async function command(req, action, payload, mutation = false) {
        if (mutation && !isCreditUuid(req.body?.operation_id))
            throw invalid(
                'A valid request ID is required. Retry from the current screen.'
            );
        const response = await client
            .rpc('hris_retirement_command', {
                p_actor_id: req.user.id,
                p_action: action,
                p_employee_id: req.body?.employee_id || null,
                p_record_id: req.params.id || null,
                p_payload: payload,
                p_operation_id: mutation ? req.body.operation_id : null,
            })
            .abortSignal(AbortSignal.timeout(10000));
        if (response.error) {
            const match = Object.keys(databaseErrors).find((code) =>
                response.error.message?.includes(code)
            );
            if (match)
                throw Object.assign(new Error(databaseErrors[match][1]), {
                    status: databaseErrors[match][0],
                    code: match,
                });
            if (['22007', '22008', '22P02'].includes(response.error.code))
                throw invalid('Provide valid dates and decimal amounts.');
            throw Object.assign(
                new Error(
                    'Retirement pay storage is unavailable. Contact the system administrator.'
                ),
                { status: 503, code: 'RETIREMENT_UNAVAILABLE' }
            );
        }
        if (!response.data || typeof response.data !== 'object')
            throw Object.assign(
                new Error(
                    'The action could not be confirmed. Retry using the same request.'
                ),
                { status: 503 }
            );
        if (mutation && !response.data.replayed) {
            try {
                onCommit(response.data);
            } catch {
                console.warn(
                    '[RETIREMENT_REALTIME] Committed action requires a refresh.'
                );
            }
        }
        return response.data;
    }
    const handle = (callback) => async (req, res) => {
        try {
            res.json(await callback(req));
        } catch (error) {
            const status = error.status || 503;
            if (status === 503) res.setHeader('Retry-After', '2');
            res.status(status).json({
                success: false,
                code: error.code,
                error: error.status
                    ? error.message
                    : 'The action outcome could not be confirmed. Refresh before retrying the same request.',
            });
        }
    };
    router.get('/my-statements', (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        next();
    }, handle(async (req) => {
        if (req.user?.employee_identity_verified !== true || !isCreditUuid(req.user.id))
            throw Object.assign(new Error('A verified employee account is required.'), { status: 403 });
        const page = req.query.page ?? '1';
        if (Object.keys(req.query).some(key => key !== 'page') || typeof page !== 'string' || !/^[1-9][0-9]{0,4}$/.test(page))
            throw invalid('Provide a valid statement page.');
        const { data, error } = await client.rpc('hris_retirement_statements', {
            p_actor_id: req.user.id, p_page: Number(page),
        }).abortSignal(AbortSignal.timeout(10000));
        if (error || !Array.isArray(data?.data)) {
            if (error?.message?.includes('RETIREMENT_FORBIDDEN'))
                throw Object.assign(new Error('Retirement statements are unavailable for this account.'), { status: 403 });
            throw Object.assign(new Error('Retirement statements could not refresh. Please retry.'), { status: 503 });
        }
        return data;
    }));
    router.use((req, res, next) =>
        hasVerifiedManagerRole(req.user)
            ? next()
            : res.status(403).json({ error: 'Verified HR or administrator access is required.' })
    );
    router.get(
        '/employees',
        handle(async (req) => {
            const search = req.query.search || '',
                page = req.query.page || '1';
            if (
                typeof search !== 'string' ||
                search.length > 160 ||
                hasUnsafeDisplayCharacters(search) ||
                typeof page !== 'string' ||
                !/^[1-9][0-9]{0,4}$/.test(page)
            )
                throw invalid('Provide a valid employee search and page.');
            let query = client
                .from('employees')
                .select(
                    'id,company_id,first_name,last_name,department,birth_date,date_hired,daily_rate,archived_at,separation_type,separation_date',
                    { count: 'exact' }
                )
                .is('deleted_at', null);
            if (req.query.employee_id !== undefined) {
                if (!isCreditUuid(req.query.employee_id)) throw invalid('Invalid employee identifier.');
                query = query.eq('id', req.query.employee_id);
            }
            if (search.trim()) {
                const pattern = postgrestValue(
                    '%' + search.trim().replace(/[\\%_]/g, '\\$&') + '%'
                );
                query = query.or(
                    `first_name.ilike.${pattern},last_name.ilike.${pattern},company_id.ilike.${pattern}`
                );
            }
            const { data, count, error } = await query
                .order('last_name')
                .order('id')
                .range((Number(page) - 1) * 50, Number(page) * 50 - 1)
                .abortSignal(AbortSignal.timeout(10000));
            if (error) throw error;
            return {
                data: data || [],
                total: count || 0,
                page: Number(page),
                limit: 50,
            };
        })
    );
    router.get(
        '/',
        handle((req) =>
            command(
                req,
                'list',
                checkedPayload(req.query, ['page', 'limit', 'status'])
            )
        )
    );
    router.get('/cases/:id', (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        next();
    }, handle(async req => {
        const { data, error } = await client.rpc('hris_retirement_case', {
            p_actor_id: req.user.id, p_request_id: req.params.id,
        }).abortSignal(AbortSignal.timeout(10000));
        if (error) {
            const code = Object.keys(databaseErrors).find(code => error.message?.includes(code));
            if (code) throw Object.assign(new Error(databaseErrors[code][1]), { status: databaseErrors[code][0], code });
            throw Object.assign(new Error('The retirement case could not refresh. Please retry.'), { status: 503 });
        }
        if (!data?.record || !data.employee) throw Object.assign(new Error('The retirement case could not refresh. Please retry.'), { status: 503 });
        return data;
    }));
    router.post(
        '/preview',
        handle((req) =>
            command(req, 'preview', calculationPayload(req.body, false))
        )
    );
    router.post(
        '/drafts',
        handle((req) =>
            command(req, 'save', calculationPayload(req.body, true), true)
        )
    );
    router.post(
        '/:id/approve',
        handle((req) =>
            command(
                req,
                'approve',
                checkedPayload(req.body, reviewFields),
                true
            )
        )
    );
    router.post(
        '/:id/payment',
        handle((req) =>
            command(req, 'pay', checkedPayload(req.body, paymentFields), true)
        )
    );
    router.post(
        '/:id/cancel',
        handle((req) =>
            command(
                req,
                'cancel',
                checkedPayload(req.body, ['expected_status', 'reason']),
                true
            )
        )
    );
    return router;
}
export default createRetirementRouter();
