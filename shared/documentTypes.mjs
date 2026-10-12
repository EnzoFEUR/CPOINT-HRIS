// A single vocabulary for the classifier, reviewer, upload audit, and employee self-service.
export const DOCUMENT_CATEGORIES = Object.freeze([
    'Contract',
    'Government ID',
    'Clearance',
    'Certificate',
    'Performance',
    'Other'
]);

export const DOCUMENT_TYPES = Object.freeze([
    // Statutory & Government Identifications
    { id: 'tin', label: 'BIR Form 1902 / 2316 (TIN Document)', category: 'Government ID', is201Required: true, requiresExpiry: false, description: 'Taxpayer Identification Number, BIR Form 1902, or Form 2316 certificate.' },
    { id: 'sss', label: 'SSS E-1 Form / Static Info / ID', category: 'Government ID', is201Required: true, requiresExpiry: false, description: 'Social Security System registration, E-1 form, or digitized SSS ID card.' },
    { id: 'philhealth', label: 'PhilHealth MDR / ID', category: 'Government ID', is201Required: true, requiresExpiry: false, description: 'PhilHealth Member Data Record (MDR) or Member ID card.' },
    { id: 'pagibig', label: 'Pag-IBIG Member ID / MDF', category: 'Government ID', is201Required: true, requiresExpiry: false, description: 'Home Development Mutual Fund Member Data Form (MDF) or Loyalty Card.' },
    { id: 'philsys', label: 'PhilSys National ID', category: 'Government ID', is201Required: false, requiresExpiry: false, description: 'Philippine Identification Card or ePhilID.' },
    { id: 'umid', label: 'UMID Card', category: 'Government ID', is201Required: false, requiresExpiry: false, description: 'Unified Multi-Purpose Identification Card.' },
    { id: 'passport', label: 'Philippine Passport', category: 'Government ID', is201Required: false, requiresExpiry: true, description: 'Valid Philippine Passport bio-page.' },
    { id: 'drivers_license', label: "Driver's License (LTO)", category: 'Government ID', is201Required: false, requiresExpiry: true, description: 'Land Transportation Office official driver license card.' },

    // Employment & Contractual
    { id: 'employment_contract', label: 'Signed Employment Contract', category: 'Contract', is201Required: true, requiresExpiry: false, description: 'Executed company employment contract or appointment agreement.' },
    { id: 'offer_letter', label: 'Offer / Appointment Letter', category: 'Contract', is201Required: false, requiresExpiry: false, description: 'Formal job offer sheet and appointment notice.' },

    // Pre-employment Clearances
    { id: 'nbi_clearance', label: 'NBI Clearance', category: 'Clearance', is201Required: true, requiresExpiry: true, description: 'Official National Bureau of Investigation criminal record clearance.' },
    { id: 'police_clearance', label: 'Police Clearance', category: 'Clearance', is201Required: false, requiresExpiry: true, description: 'Local PNP police clearance certificate.' },
    { id: 'barangay_clearance', label: 'Barangay Clearance', category: 'Clearance', is201Required: false, requiresExpiry: true, description: 'Barangay certificate of residency and good moral conduct.' },

    // Medical & Academic Certificates
    { id: 'medical_certificate', label: 'Medical Certificate / Fit-to-Work', category: 'Certificate', is201Required: true, requiresExpiry: true, description: 'Pre-employment medical examination or physician fit-to-work clearance.' },
    { id: 'diploma', label: 'College Diploma / High School Certificate', category: 'Certificate', is201Required: false, requiresExpiry: false, description: 'Official academic graduation diploma or certificate of completion.' },
    { id: 'training_certificate', label: 'Training / Professional Certificate', category: 'Certificate', is201Required: false, requiresExpiry: false, description: 'Technical certifications, seminars, or TESDA/PRC credentials.' },
    { id: 'birth_certificate', label: 'PSA Birth Certificate', category: 'Certificate', is201Required: false, requiresExpiry: false, description: 'Philippine Statistics Authority birth certificate copy.' },
    { id: 'employment_certificate', label: 'Certificate of Employment (Previous)', category: 'Certificate', is201Required: false, requiresExpiry: false, description: 'Certificate of employment issued by previous employers.' },

    // Performance & Operational Records
    { id: 'performance_review', label: 'Performance Appraisal / KPI Form', category: 'Performance', is201Required: false, requiresExpiry: false, description: 'Official quarterly or annual performance evaluation report.' },
    { id: 'payslip', label: 'Historical Payslip / Remuneration Sheet', category: 'Other', is201Required: false, requiresExpiry: false, description: 'Remuneration statement or wage slip.' },
    { id: 'unknown', label: 'Other Document / Custom Submission', category: 'Other', is201Required: false, requiresExpiry: false, description: 'General HR documentation or unclassified personnel record.' },
]);

export const DOCUMENT_TYPE_IDS = DOCUMENT_TYPES.map(type => type.id);

export const getDocumentType = (idOrLabel) => {
    if (!idOrLabel || typeof idOrLabel !== 'string') return DOCUMENT_TYPES.at(-1);
    const query = idOrLabel.trim().toLowerCase();

    // 1. Exact id match
    const byId = DOCUMENT_TYPES.find(type => type.id.toLowerCase() === query);
    if (byId) return byId;

    // 2. Exact label match
    const byLabel = DOCUMENT_TYPES.find(type => type.label.toLowerCase() === query);
    if (byLabel) return byLabel;

    // 3. Normalized / alias matching
    const byNormalized = DOCUMENT_TYPES.find(type => {
        const typeIdLower = type.id.toLowerCase();
        const typeLabelLower = type.label.toLowerCase();
        return (
            typeLabelLower.includes(query) ||
            query.includes(typeLabelLower) ||
            query.includes(typeIdLower.replace(/_/g, ' ')) ||
            typeIdLower.includes(query.replace(/[\s-]/g, '_'))
        );
    });
    if (byNormalized) return byNormalized;

    return DOCUMENT_TYPES.at(-1);
};
export const getDocumentTypesByCategory = category => !category || category === 'All' ? DOCUMENT_TYPES : DOCUMENT_TYPES.filter(type => type.category === category);
export const getStandard201Requirements = () => DOCUMENT_TYPES.filter(type => type.is201Required);
export const CLASSIFICATION_EVIDENCE = ['agency_name', 'document_heading', 'form_code', 'logo', 'layout'];
