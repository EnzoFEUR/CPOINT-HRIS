// A single vocabulary for the classifier, reviewer, and upload audit.
export const DOCUMENT_TYPES = Object.freeze([
    { id: 'sss', label: 'SSS document', category: 'Government ID' },
    { id: 'philhealth', label: 'PhilHealth document', category: 'Government ID' },
    { id: 'pagibig', label: 'Pag-IBIG document', category: 'Government ID' },
    { id: 'tin', label: 'BIR / TIN document', category: 'Government ID' },
    { id: 'umid', label: 'UMID card', category: 'Government ID' },
    { id: 'philsys', label: 'PhilSys / National ID', category: 'Government ID' },
    { id: 'passport', label: 'Passport', category: 'Government ID' },
    { id: 'drivers_license', label: "Driver's license", category: 'Government ID' },
    { id: 'employment_contract', label: 'Employment contract', category: 'Contract' },
    { id: 'offer_letter', label: 'Offer / appointment letter', category: 'Contract' },
    { id: 'employment_certificate', label: 'Certificate of employment', category: 'Certificate' },
    { id: 'nbi_clearance', label: 'NBI clearance', category: 'Clearance' },
    { id: 'police_clearance', label: 'Police clearance', category: 'Clearance' },
    { id: 'barangay_clearance', label: 'Barangay clearance', category: 'Clearance' },
    { id: 'medical_certificate', label: 'Medical certificate', category: 'Certificate' },
    { id: 'diploma', label: 'Diploma', category: 'Certificate' },
    { id: 'training_certificate', label: 'Training certificate', category: 'Certificate' },
    { id: 'birth_certificate', label: 'Birth certificate', category: 'Certificate' },
    { id: 'performance_review', label: 'Performance review', category: 'Performance' },
    { id: 'payslip', label: 'Payslip', category: 'Other' },
    { id: 'unknown', label: 'Other / manual classification', category: 'Other' },
]);

export const DOCUMENT_TYPE_IDS = DOCUMENT_TYPES.map(type => type.id);
export const getDocumentType = id => DOCUMENT_TYPES.find(type => type.id === id) || DOCUMENT_TYPES.at(-1);
export const CLASSIFICATION_EVIDENCE = ['agency_name', 'document_heading', 'form_code', 'logo', 'layout'];
