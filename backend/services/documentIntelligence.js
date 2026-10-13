import { getDocumentType } from '../../shared/documentTypes.mjs';

const GROUPS = { sss: [2, 7, 1], philhealth: [2, 9, 1], pagibig: [4, 4, 4], philsys: [4, 4, 4, 4], umid: [4, 7, 1] };
export function normalizeDocumentId(type, value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const compact = value.toUpperCase().replace(/[\s-]/g, '');
    if (type === 'drivers_license') return /^[A-Z]\d{10}$/.test(compact) ? `${compact.slice(0, 3)}-${compact.slice(3, 5)}-${compact.slice(5)}` : null;
    if (type === 'passport') return /^(?:[A-Z]\d{7}[A-Z]|[A-Z]{2}\d{7})$/.test(compact) ? compact : null;
    if (type === 'nbi_clearance') return /^[A-Z0-9]{8,30}$/.test(compact) ? compact : null;
    const groups = type === 'tin' ? (compact.length === 9 ? [3, 3, 3] : [3, 3, 3, 3]) : GROUPS[type];
    if (!groups || !/^\d+$/.test(compact) || compact.length !== groups.reduce((a, b) => a + b, 0)) return null;
    let start = 0;
    // Preserve printed TIN branches; never invent a missing branch or repair OCR digits.
    return groups.map(size => { const part = compact.slice(start, start + size); start += size; return part; }).join('-');
}

export function cleanDocumentText(value, maxLength = 160) {
    if (typeof value !== 'string' || value.length > maxLength || /[<>\p{Extended_Pictographic}\p{Cc}\p{Cf}]/u.test(value)) return null;
    return value.trim().replace(/\s+/g, ' ') || null;
}
export function documentDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function reconcileIdentity(name, employee) {
    const tokens = value => (typeof value === 'string' ? value : '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const first = tokens(employee?.first_name), last = tokens(employee?.last_name), printed = tokens(name);
    if (!first.length || !last.length || !printed.length) return { matched: false, score: 0, status: 'unverified', message: 'Compare the document owner with the personnel record.' };
    const expected = [...new Set([...first, ...last])];
    const score = expected.filter(token => printed.includes(token)).length / expected.length;
    const matched = score === 1;
    return { matched, score: Math.round(score * 100) / 100, status: matched ? 'verified' : 'name_mismatch', message: matched ? 'Name matches the personnel record. This does not verify identity or document authenticity.' : 'The printed name differs from the personnel record. Check the intended employee before importing.' };
}

// A local bypass needs both a document heading and a labeled owner identifier.
// Payslips and other records mentioning several agencies must continue to vision.
const PDF_RULES = [
    { type: 'tin', agency: /bureau of internal revenue/i, heading: /\b(?:BIR\s*)?Form\s*(1902|2316)\b/i, id: /\b(?:TIN|taxpayer identification (?:number|no\.?))\s*[:#]?\s*(\d{3}[- ]?\d{3}[- ]?\d{3}(?:[- ]?\d{3})?)\b/i, issuer: 'Bureau of Internal Revenue' },
    { type: 'sss', agency: /social security system/i, heading: /\b(?:personal record|static information|E[ -]?[14])\b/i, id: /\b(?:SSS?|social security)\s*(?:number|no\.?)\s*[:#]?\s*(\d{2}[- ]?\d{7}[- ]?\d)\b/i, issuer: 'Social Security System' },
    { type: 'philhealth', agency: /philippine health insurance corporation/i, heading: /\b(?:member data record|MDR)\b/i, id: /\b(?:PIN|PhilHealth\s*(?:identification\s*)?(?:number|no\.?))\s*[:#]?\s*(\d{2}[- ]?\d{9}[- ]?\d)\b/i, issuer: 'Philippine Health Insurance Corporation' },
    { type: 'pagibig', agency: /home development mutual fund|pag[ -]?ibig fund/i, heading: /\b(?:member'?s? data form|MDF)\b/i, id: /\b(?:MID|membership identification)\s*(?:number|no\.?)?\s*[:#]?\s*(\d{4}[- ]?\d{4}[- ]?\d{4})\b/i, issuer: 'Home Development Mutual Fund' },
];
export function classifyPdfText({ text, pages } = {}) {
    // More than one page needs visual inspection so hidden/scanned pages are not omitted.
    if (pages !== 1 || typeof text !== 'string' || text.length > 64000 || /\b(?:payslip|pay slip|payroll|employment contract)\b/i.test(text)) return null;
    const rules = PDF_RULES.filter(rule => rule.agency.test(text) && rule.heading.test(text));
    if (rules.length !== 1) return null;
    const rule = rules[0];
    let ownerText = text;
    if (rule.type === 'tin') {
        // BIR forms also contain employer numbers; require an explicit employee section.
        ownerText = text.match(/(?:Part\s*I\b[^\n]*employee|employee(?:'s)?\s+information)\s*\n([\s\S]+?)(?=\n[^\n]*(?:Part\s*II\b|employer(?:'s)?\s+information)|$)/i)?.[1];
        if (!ownerText) return null;
    }
    const ids = [...ownerText.matchAll(new RegExp(rule.id.source, 'gi'))].map(match => normalizeDocumentId(rule.type, match[1])).filter(Boolean);
    if (new Set(ids).size !== 1) return null;
    const name = ownerText.match(/^(?:full name|name|taxpayer name|member name)\s*:\s*([^\r\n]{2,160})$/im)?.[1];
    // Multiple name fields may represent different owners on a composite PDF page.
    if ([...ownerText.matchAll(/^(?:full name|name|taxpayer name|member name)\s*:/gim)].length > 1) return null;
    const issue = text.match(/^(?:issue date|date issued)\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/im)?.[1];
    const expiry = text.match(/^(?:expiry date|expiration date)\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/im)?.[1];
    return {
        document_type: rule.type, category: getDocumentType(rule.type).category,
        document_variant: rule.type === 'tin' ? `BIR Form ${text.match(rule.heading)[1]}` : null,
        id_number: ids[0], full_name_on_document: cleanDocumentText(name), issue_date: documentDate(issue), expiry_date: documentDate(expiry),
        issuing_agency: rule.issuer, confidence: 'high', is_readable: true,
        multiple_documents: false, conflicting_agencies: false,
        quality_assessment: null, evidence: ['agency_name', 'document_heading', 'statutory_id_format'],
    };
}
