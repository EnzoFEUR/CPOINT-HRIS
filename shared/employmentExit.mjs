import { isCreditUuid, isLeaveDate } from './leaveCredits.mjs';
import { hasUnsafeDisplayCharacters } from './inputLimits.mjs';
export const EXIT_KINDS = Object.freeze({
    retirement_review: 'Retirement review',
    early_retirement_inquiry: 'Early-retirement inquiry',
    resignation_notice: 'Resignation notice',
});
export const EXIT_STATUSES = Object.freeze({
    received: 'Received',
    needs_information: 'Needs information',
    eligibility_verified: 'Retirement eligibility verified',
    eligibility_disputed: 'Eligibility disputed / alternative review',
    notice_acknowledged: 'Resignation notice acknowledged',
    withdrawn: 'Withdrawal confirmed',
    separated: 'Separation recorded',
});
export const EXIT_SOURCES = Object.freeze({
    employee_app: 'Employee app',
    paper: 'Signed paper',
    email: 'Email',
    hr_assisted: 'HR-assisted submission',
});
export const EXIT_REVIEW_ACTIONS = Object.freeze({
    needs_information: {
        button: 'Send information request',
        help: 'Tell the employee exactly what information or documents to provide. This does not approve retirement.',
        success: 'Information request saved. The employee should reply with the requested information.',
    },
    eligibility_disputed: {
        button: 'Save eligibility finding',
        help: 'Explain the eligibility issue and the next step. This keeps retirement pay and separation unavailable.',
        success: 'Eligibility issue saved. Retirement pay and separation remain unavailable pending the required review.',
    },
    response: {
        button: 'Send written reply',
        help: 'Send an explanation to the employee while keeping the current case status unchanged.',
        success: 'Written reply saved. The case status is unchanged.',
    },
    withdrawn: {
        button: 'Confirm withdrawal',
        help: 'Confirm the employee’s requested withdrawal and close this case. This does not retire or reactivate the employee.',
        success: 'Withdrawal confirmed. This case is now closed; the employee account was not changed.',
    },
    eligibility_verified: {
        button: 'Verify retirement eligibility',
        help: 'Confirm eligibility, intent and the effective date. You can then prepare retirement pay; separation still needs its own due-date confirmation.',
        success: 'Retirement eligibility verified. Use Prepare Retirement Pay to continue; the account remains unchanged until separation is finalized.',
    },
    notice_acknowledged: {
        button: 'Acknowledge resignation notice',
        help: 'Record the resignation notice and confirmed date. This does not immediately separate the employee.',
        success: 'Resignation notice acknowledged. HR can finalize separation on or after the confirmed effective date.',
    },
});
export const EXIT_INPUT_LIMITS = Object.freeze({ note: 2000, evidence: 500, search: 160, timestamp: 35 });
export const RETIREMENT_PAY_STATUSES = Object.freeze({
    draft: 'Draft calculation', approved: 'Approved — awaiting payment',
    paid: 'Payment recorded', cancelled: 'Cancelled calculation',
});
export function getRetirementWorkflow(context) {
    const { record, employee, settlement } = context || {};
    const reviewed = Boolean(context?.can_prepare && record?.kind === 'retirement_review' &&
        ['eligibility_verified', 'separated'].includes(record.status) && !record.review_pending && !record.withdrawal_requested);
    const linked = Boolean(record && settlement && settlement.id === record.retirement_settlement_id &&
        settlement.employee_id === record.employee_id && String(settlement.inputs?.exit_request_id).toLowerCase() === record.id &&
        settlement.retirement_date === record.effective_date);
    return {
        canCreate: reviewed && (!settlement || settlement.status === 'cancelled'),
        canApprove: reviewed && linked && settlement.status === 'draft',
        canPay: Boolean(reviewed && linked && settlement.status === 'approved' && record.status === 'separated' &&
            employee?.is_active === false && employee.archived_at && employee.separation_type === 'Retirement' && employee.separation_date === settlement.retirement_date),
        statusLabel: RETIREMENT_PAY_STATUSES[settlement?.status] || 'Calculation not started',
    };
}
export function getSeparationLabel(employee) {
    const type = String(employee?.separation_type || '').trim().toLowerCase();
    return type === 'retirement' ? 'Retired' : type === 'resignation' ? 'Resigned' : 'Separated';
}
export function isFinalVoluntarySeparation(employee) {
    return getSeparationLabel(employee) !== 'Separated' && Boolean(employee?.archived_at);
}
export function getArchiveReviewDaysRemaining(employee, now = Date.now()) {
    if (isFinalVoluntarySeparation(employee)) return 0;
    const reference = employee?.archived_at || employee?.separation_date || employee?.updated_at;
    if (!reference || !Number.isFinite(Date.parse(reference))) return null;
    return Math.max(0, Math.ceil(14 - (now - Date.parse(reference)) / 86400000));
}
export function getExitLifecycle(receipt, today) {
    if (receipt?.status === 'separated') return { stage: 'separated', label: 'Separated — records-only access', canFinalize: false,
        detail: 'Operational access has ended. The existing archive retains the separation reason and employment history. Final pay and retirement pay are handled separately.' };
    if (receipt?.status === 'withdrawn') return { stage: 'withdrawn', label: 'Withdrawal confirmed', canFinalize: false,
        detail: 'This case is closed. Withdrawal does not itself reactivate an account or change an existing separation.' };
    if (receipt?.review_pending || receipt?.withdrawal_requested) return { stage: 'held', label: 'HR follow-up pending', canFinalize: false,
        detail: 'HR must respond to the outstanding review or withdrawal request before finalizing this case. The account is not archived by this request.' };
    if (receipt?.status === 'needs_information') return { stage: 'review', label: 'Awaiting employee information', canFinalize: false,
        detail: 'HR requested more information. The employee should reply with the requested details; this does not approve retirement pay or change the account.' };
    if (receipt?.kind === 'early_retirement_inquiry') return { stage: 'inquiry', label: 'Early-retirement inquiry — HR advice', canFinalize: false,
        detail: 'This inquiry records HR advice or an eligibility issue. Saving a finding does not approve retirement pay, confirm a retirement date or archive the account. HR should explain the applicable policy and next steps.' };
    if (receipt?.status === 'eligibility_disputed') return { stage: 'review', label: 'Eligibility needs HR review', canFinalize: false,
        detail: 'HR recorded an eligibility issue. Review the written finding and required next steps before retirement eligibility or retirement pay can be confirmed.' };
    if (['eligibility_verified', 'notice_acknowledged'].includes(receipt?.status) && isLeaveDate(receipt?.effective_date) && isLeaveDate(today)) {
        const due = receipt.effective_date <= today;
        return { stage: due ? 'due' : 'scheduled', label: due ? 'Due for HR separation' : 'Exit scheduled', canFinalize: due,
            detail: due ? 'The confirmed effective date has arrived. HR must verify and finalize the separation; the system does not automatically end employment.' :
                'Acknowledgement or eligibility verification does not deactivate the account. Existing employment restrictions still apply until HR records separation on or after ' + receipt.effective_date + '.' };
    }
    return { stage: 'review', label: 'Under HR review', canFinalize: false,
        detail: 'Submitting or reviewing a request does not change the employee account. HR must record the applicable finding and effective date.' };
}
export function findOpenExitRequest(records, kind) {
    const retirement = ['retirement_review', 'early_retirement_inquiry'];
    return (records || []).find(record => !['withdrawn', 'separated'].includes(record.status) &&
        (retirement.includes(kind) ? retirement.includes(record.kind) : record.kind === kind));
}
export const RETIREMENT_LETTER_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';
export const RETIREMENT_LETTER_MAX_BYTES = 10 * 1024 * 1024;
export const requiresRetirementLetter = (kind, source = 'employee_app') =>
    source === 'employee_app' && ['retirement_review', 'early_retirement_inquiry'].includes(kind);
export const validRetirementLetterFile = (name, size) =>
    typeof name === 'string' && /\.(pdf|docx?|jpe?g|png)$/i.test(name) &&
    Number.isFinite(size) && size > 0 && size <= RETIREMENT_LETTER_MAX_BYTES;
export function retirementLetterDocumentId(reference) {
    const id = typeof reference === 'string' ? reference.match(/^Retirement letter document: (.+)$/)?.[1] : null;
    return id && (isCreditUuid(id) || /^[1-9]\d{0,19}$/.test(id)) ? id : null;
}
const bad = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
};
export function exitPayload(body, action) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        bad('Provide valid request details.');
    const p = {};
    const text = (key, max = EXIT_INPUT_LIMITS.note, minimum = 0) => {
        const v = body[key] ?? '';
        if (
            typeof v !== 'string' ||
            v.trim().length < minimum ||
            v.length > max ||
            hasUnsafeDisplayCharacters(v)
        )
            bad(
                'Provide readable notes and evidence within the displayed limits.'
            );
        p[key] = v.trim();
    };
    const flag = (key) => {
        if (body[key] !== undefined && typeof body[key] !== 'boolean')
            bad('Confirmations must be checked explicitly.');
        p[key] = body[key] === true;
    };
    if (action === 'submit') {
        if (
            !Object.hasOwn(EXIT_KINDS, body.kind) ||
            !isLeaveDate(body.requested_date)
        )
            bad('Select the request type and a valid proposed date.');
        p.kind = body.kind;
        p.requested_date = body.requested_date;
        p.source = body.source || 'employee_app';
        if (!Object.hasOwn(EXIT_SOURCES, p.source))
            bad('Select a valid submission source.');
        text('note');
        flag('consent_confirmed');
        if (requiresRetirementLetter(p.kind, p.source)) {
            const id = body.retirement_letter_document_id;
            if (typeof id !== 'string' || (!isCreditUuid(id) && !/^[1-9]\d{0,19}$/.test(id)))
                bad('Upload your retirement letter before sending this request to HR.');
            p.evidence_reference = 'Retirement letter document: ' + id;
        }
        if (p.source !== 'employee_app') {
            text('evidence_reference', EXIT_INPUT_LIMITS.evidence, 10);
            if (
                typeof body.received_at !== 'string' ||
                body.received_at.length > EXIT_INPUT_LIMITS.timestamp ||
                !/^\d{4}-\d{2}-\d{2}T/.test(body.received_at) ||
                !Number.isFinite(Date.parse(body.received_at))
            )
                bad('Record the original received date and time.');
            p.received_at = new Date(body.received_at).toISOString();
        }
    } else {
        if (!Number.isSafeInteger(body.version) || body.version < 1 || body.version > 999999999)
            bad('Refresh the receipt before submitting a change.');
        p.version = body.version;
        if (action !== 'separate') text('note', EXIT_INPUT_LIMITS.note, 10);
        if (action === 'review') {
            if (
                ![
                    'needs_information',
                    'eligibility_verified',
                    'eligibility_disputed',
                    'notice_acknowledged',
                    'withdrawn',
                    'response',
                ].includes(body.finding)
            )
                bad('Select a supported HR finding.');
            p.finding = body.finding;
            if (
                ['eligibility_verified', 'notice_acknowledged'].includes(
                    body.finding
                )
            ) {
                if (!isLeaveDate(body.effective_date))
                    bad('Enter a valid confirmed effective date.');
                p.effective_date = body.effective_date;
                for (const key of [
                    'coverage_confirmed',
                    'consent_confirmed',
                    'date_agreement_confirmed',
                ])
                    flag(key);
                if (body.notice_basis !== undefined) {
                    if (!['standard_notice', 'shorter_notice_agreed', 'immediate_exit_legal_review'].includes(body.notice_basis))
                        bad('Select a supported notice basis.');
                    p.notice_basis = body.notice_basis;
                }
            }
        }
    }
    return p;
}
export function exitRequestIds(body, mutation = true) {
    if (mutation && !isCreditUuid(body?.operation_id))
        bad('A valid request ID is required. Retry from the current screen.');
    if (body?.employee_id !== undefined && !isCreditUuid(body.employee_id))
        bad('Select a valid employee.');
    return {
        operationId: body?.operation_id || null,
        employeeId: body?.employee_id || null,
    };
}
