import { calculateSilConversion, isCreditUuid, isLeaveDate, isSilWageDocumentId } from '../../../shared/leavePolicy.js';

export function silRateReviewItems(value, asOf) {
    let validRate = false;
    try { validRate = calculateSilConversion(1, value.daily_rate) > 0; } catch { /* documentary rate pending */ }
    const validPeriod = (!value.reference_start && !value.reference_end) ||
        (isLeaveDate(value.reference_start) && isLeaveDate(value.reference_end) && value.reference_start <= value.reference_end && value.reference_end <= asOf);
    return [
        { id: 'rate', label: 'Conversion-date daily rate', complete: validRate, help: 'Enter the daily equivalent from the documented wage review.' },
        { id: 'source', label: 'Verified wage source', complete: isSilWageDocumentId(value.source_document_id), help: 'Select or upload an approved wage document for this employee.' },
        { id: 'confirmation', label: 'Current HR review', complete: value.verified === true && isLeaveDate(asOf) && value.as_of === asOf && validPeriod && value.source == null && value.calculation == null,
            help: validPeriod ? 'Verify the supporting record and applicable wage rules for this conversion date.' : 'Provide both valid evidence dates, ending no later than the conversion date.' },
    ];
}

export function findPreviousSilReview(requests, employeeId, asOf) {
    if (!Array.isArray(requests) || !isCreditUuid(employeeId) || !isLeaveDate(asOf)) return null;
    return requests.filter(request => {
        const basis = request?.valuation_basis;
        return request?.employee_id === employeeId && ['approved', 'queued_for_payroll', 'paid', 'payment_failed'].includes(request.status)
            && basis?.method === 'documented_conversion_rate' && isCreditUuid(basis.verified_by)
            && isLeaveDate(basis.as_of) && basis.as_of <= asOf && Number.isFinite(Date.parse(request.decided_at))
            && silRateReviewItems({ ...basis, as_of: asOf }, asOf).every(item => item.complete);
    }).sort((a, b) => Date.parse(b.decided_at) - Date.parse(a.decided_at))[0] || null;
}
