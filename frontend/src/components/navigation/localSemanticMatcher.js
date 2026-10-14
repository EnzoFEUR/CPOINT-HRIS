/**
 * Enterprise Layer-0 Semantic Intent Matcher for C-Point HRIS
 * 
 * Provides instantaneous (<1ms) client-side intent resolution for core
 * Philippine workplace keywords, Taglish operational queries, and navigational intents.
 * 
 * Benefits:
 * - 0ms perceived latency (instant response on keystroke)
 * - 0 API tokens consumed (preserves Google Gemini free tier quota)
 * - Seamless fallback to Gemini for complex legal/advisory inquiries
 */

const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

// Queries asking for deep legal explanations or formulas are routed to Gemini Brain
const DEEP_ADVISORY_REGEX = /^(what is|how is|how do we|why is|explain|what are the rules|penalty for|formula for|labor code|dole rule|department order|legal basis|article \d+)\b/i;

const ADMIN_INTENTS = [
  // High-specificity action routes first
  {
    id: 'employee-create',
    title: 'Add New Employee',
    route: '/admin/employees/create',
    icon: 'ti-user-plus',
    description: 'Onboard a new employee with salary and role details',
    intent_title: 'Employee Onboarding',
    ai_answer: 'Register a new employee with personal information, wage rates, department placement, and statutory details.',
    keywords: [
      'add employee', 'new employee', 'hire', 'onboard', 'onboarding',
      'create employee', 'register employee', 'mag-add', 'magdagdag',
      'magdagdag ng tao', 'paano mag-add', 'new hire', 'bagong empleyado'
    ],
    suggested_actions: [
      {
        title: 'Employee Directory',
        route: '/admin/employees',
        icon: 'ti-users-group',
        description: 'View staff directory'
      }
    ]
  },
  {
    id: 'qr-print',
    title: 'Print Employee ID Badges',
    route: '/admin/employees/qr-print',
    icon: 'ti-printer',
    description: 'Generate printable gate pass badges with QR codes',
    intent_title: 'Print Employee QR Badges',
    ai_answer: 'Generate printable official company ID cards formatted with scannable QR passes for gate terminal entry.',
    keywords: [
      'print qr', 'qr print', 'id badge', 'id cards', 'id print', 'print id',
      'badge', 'badges', 'gate pass print', 'print badge', 'generate qr'
    ],
    suggested_actions: [
      {
        title: 'Employee Directory',
        route: '/admin/employees',
        icon: 'ti-users-group',
        description: 'Select employees to print'
      }
    ]
  },
  {
    id: 'payroll-process',
    title: 'Compute Payroll',
    route: '/admin/payroll/process',
    icon: 'ti-calculator',
    description: 'Calculate employee cutoff earnings, overtime hours, and piece rates',
    intent_title: 'Payroll Processing & Computation',
    ai_answer: 'You can process and compute employee payroll, overtime rates, deductions, and cutoff compensation in the Payroll Process module.',
    keywords: [
      'pasahod', 'magpasahod', 'mag-pasahod', 'saan magpapasahod', 'where can i pasahod',
      'sahod', 'sweldo', 'payroll process', 'process payroll', 'compute payroll',
      'calculate pay', 'run payroll', 'payout', 'cutoff pay', 'kaltas'
    ],
    suggested_actions: [
      {
        title: 'Payroll Ledger',
        route: '/admin/payroll',
        icon: 'ti-wallet',
        description: 'View cutoff payouts, payslip archives, and past payroll records'
      },
      {
        title: 'Statutory Settings & DOLE Rules',
        route: '/admin/payroll/statutory-settings',
        icon: 'ti-adjustments-horizontal',
        description: 'Configure SSS, PhilHealth, Pag-IBIG brackets'
      }
    ]
  },
  {
    id: 'payroll-ledger',
    title: 'Payroll Ledger',
    route: '/admin/payroll',
    icon: 'ti-wallet',
    description: 'View cutoff payouts, payslip archives, and past payroll records',
    intent_title: 'Payroll Ledger & Archives',
    ai_answer: 'Access historical cutoff payout records, view approved payroll summaries, and inspect employee payslips.',
    keywords: [
      'payroll ledger', 'payslip', 'payslips', 'past payroll', 'payroll history',
      'sahod records', 'previous cutoff', 'payout history', 'sweldo records'
    ],
    suggested_actions: [
      {
        title: 'Compute Payroll',
        route: '/admin/payroll/process',
        icon: 'ti-calculator',
        description: 'Process current cutoff compensation'
      }
    ]
  },
  {
    id: 'statutory-settings',
    title: 'Statutory Settings & DOLE Rules',
    route: '/admin/payroll/statutory-settings',
    icon: 'ti-adjustments-horizontal',
    description: 'Configure SSS, PhilHealth, Pag-IBIG brackets and DOLE standards',
    intent_title: 'Statutory Settings & DOLE Rules',
    ai_answer: 'Configure Philippine mandatory contribution tables (SSS, PhilHealth, Pag-IBIG) and tax withholding configurations.',
    keywords: [
      'sss', 'philhealth', 'pag-ibig', 'pagibig', 'tin', 'bir', 'withholding',
      'tax table', 'statutory', 'dole contribution', 'mandatory deduction', 'bracket'
    ],
    suggested_actions: [
      {
        title: 'Compute Payroll',
        route: '/admin/payroll/process',
        icon: 'ti-calculator',
        description: 'Apply settings to cutoff payroll computation'
      }
    ]
  },
  {
    id: 'attendance-logs',
    title: 'Attendance Daily Logs',
    route: '/admin/attendance',
    icon: 'ti-list-details',
    description: 'Daily clock-ins, late arrivals, and missed shifts',
    intent_title: 'Attendance Daily Logs',
    ai_answer: 'Monitor real-time employee biometric clock-ins, daily work hours, tardiness logs, and missed shifts.',
    keywords: [
      'dtr', 'bundy', 'bundy clock', 'attendance', 'clock in', 'clock out',
      'time in', 'time out', 'daily attendance', 'daily logs', 'tardy', 'tardiness',
      'late arrivals', 'orasan'
    ],
    suggested_actions: [
      {
        title: 'Workforce Timeline & Calendar',
        route: '/admin/attendance/calendar',
        icon: 'ti-calendar',
        description: 'Shift roster and monthly attendance'
      },
      {
        title: 'Gate Terminal Scanner',
        route: '/scanner',
        icon: 'ti-scan',
        description: 'Kiosk attendance terminal'
      }
    ]
  },
  {
    id: 'attendance-calendar',
    title: 'Workforce Timeline & Calendar',
    route: '/admin/attendance/calendar',
    icon: 'ti-calendar',
    description: 'Shift roster, presence calendar, and absent records',
    intent_title: 'Workforce Presence & Shift Calendar',
    ai_answer: 'Track employee absences, shift schedules, and overall workforce presence across the monthly calendar.',
    keywords: [
      'absent', 'absence', 'absences', 'sino absent', 'who is absent', 'shift',
      'shifts', 'roster', 'workforce calendar', 'timeline', 'presence calendar', 'schedule'
    ],
    suggested_actions: [
      {
        title: 'Attendance Daily Logs',
        route: '/admin/attendance',
        icon: 'ti-list-details',
        description: 'Daily attendance logs'
      },
      {
        title: 'Leave Approvals',
        route: '/admin/leaves',
        icon: 'ti-plane-departure',
        description: 'Review leave applications'
      }
    ]
  },
  {
    id: 'terminal-scanner',
    title: 'Gate Terminal Scanner',
    route: '/scanner',
    icon: 'ti-scan',
    description: 'Facial verification and QR kiosk attendance terminal',
    intent_title: 'Gate Attendance Terminal',
    ai_answer: 'Launch the standalone gate terminal for employee QR barcode scanning and biometric facial verification.',
    keywords: [
      'scanner', 'gate scanner', 'kiosk', 'biometric terminal', 'facial terminal',
      'face scan', 'gate kiosk', 'gate terminal'
    ],
    suggested_actions: [
      {
        title: 'Attendance Daily Logs',
        route: '/admin/attendance',
        icon: 'ti-list-details',
        description: 'Live attendance feed'
      },
      {
        title: 'Print Employee ID Badges',
        route: '/admin/employees/qr-print',
        icon: 'ti-printer',
        description: 'Print badge passes'
      }
    ]
  },
  {
    id: 'leave-approvals',
    title: 'Leave Approvals',
    route: '/admin/leaves',
    icon: 'ti-plane-departure',
    description: 'Approve or decline employee vacation and sick leave requests',
    intent_title: 'Leave Management & Approvals',
    ai_answer: 'Review pending employee leave applications including vacation leave (VL), sick leave (SL), and emergency time off.',
    keywords: [
      'leave', 'leaves', 'vacation leave', 'sick leave', 'vl', 'sl', 'pto',
      'maternity', 'paternity', 'file leave', 'leave request', 'leave approval',
      'approvals', 'where to file leave'
    ],
    suggested_actions: [
      {
        title: 'Workforce Timeline & Calendar',
        route: '/admin/attendance/calendar',
        icon: 'ti-calendar',
        description: 'Check workforce calendar'
      }
    ]
  },
  {
    id: 'disciplinary-records',
    title: 'Disciplinary Records',
    route: '/admin/disciplinary',
    icon: 'ti-alert-triangle',
    description: 'Policy violations, incident reports, and Notice to Explain (NTE)',
    intent_title: 'Disciplinary Records & Compliance',
    ai_answer: 'Manage formal disciplinary proceedings, track company rule infractions, and issue Notices to Explain (NTE).',
    keywords: [
      'memo', 'memorandum', 'disciplinary', 'nte', 'notice to explain',
      'violation', 'incident report', 'incident', 'awol', 'sanction', 'hearing', 'suspension'
    ],
    suggested_actions: [
      {
        title: 'System Audit Trail',
        route: '/admin/audit-logs',
        icon: 'ti-history',
        description: 'Review system history'
      }
    ]
  },
  {
    id: 'employee-directory',
    title: 'Employee Directory',
    route: '/admin/employees',
    icon: 'ti-users-group',
    description: 'Staff directory, wage structures, and profiles',
    intent_title: 'Employee Master Directory',
    ai_answer: 'View and manage complete employee records, job positions, salary configurations, and department assignments.',
    keywords: [
      'employees', 'employee directory', 'staff', 'workers', 'directory',
      'personnel', 'masterlist', 'empleyado', 'list of employees'
    ],
    suggested_actions: [
      {
        title: 'Add New Employee',
        route: '/admin/employees/create',
        icon: 'ti-user-plus',
        description: 'Onboard a new hire'
      },
      {
        title: 'Employee Archive',
        route: '/admin/archive',
        icon: 'ti-archive',
        description: 'Separated records'
      }
    ]
  },
  {
    id: 'employee-archive',
    title: 'Employee Archive',
    route: '/admin/archive',
    icon: 'ti-archive',
    description: 'Separated and archived employee clearance records',
    intent_title: 'Separated Employee Archive',
    ai_answer: 'Review archived employee profiles, separation clearances, termination notices, and historical employment records.',
    keywords: [
      'archive', 'separated', 'resigned', 'terminated', 'clearance',
      'offboard', 'alumni', 'inactive employees', 'exit'
    ],
    suggested_actions: [
      {
        title: 'Employee Directory',
        route: '/admin/employees',
        icon: 'ti-users-group',
        description: 'Active workforce directory'
      }
    ]
  },
  {
    id: 'system-audit',
    title: 'System Audit Trail',
    route: '/admin/audit-logs',
    icon: 'ti-history',
    description: 'Audit logs of administrator and manager actions',
    intent_title: 'Enterprise System Audit Trail',
    ai_answer: 'Inspect immutable audit records capturing user logins, permission updates, attendance overrides, and payroll actions.',
    keywords: [
      'audit', 'audit logs', 'audit trail', 'system logs', 'activity history',
      'security logs', 'user logs'
    ],
    suggested_actions: [
      {
        title: 'Employee Directory',
        route: '/admin/employees',
        icon: 'ti-users-group',
        description: 'Employee directory'
      }
    ]
  },
  {
    id: 'documents-index',
    title: 'Documents & Forms',
    route: '/admin/documents',
    icon: 'ti-file-text',
    description: 'Employee handbook, form templates, and legal contracts',
    intent_title: 'Document Templates & Forms',
    ai_answer: 'Access company document templates, onboarding contracts, compliance memos, and administrative forms.',
    keywords: [
      'document', 'documents', 'contract', 'contracts', 'template',
      'forms', 'handbook', 'manual', 'memo template'
    ],
    suggested_actions: [
      {
        title: 'Disciplinary Records',
        route: '/admin/disciplinary',
        icon: 'ti-alert-triangle',
        description: 'Disciplinary records'
      }
    ]
  },
  {
    id: 'profile-settings',
    title: 'My Profile & Settings',
    route: '/profile',
    icon: 'ti-user-circle',
    description: 'Account credentials and security settings',
    intent_title: 'Account Profile & Settings',
    ai_answer: 'Manage your account login credentials, contact information, and security preferences.',
    keywords: [
      'profile', 'my profile', 'account', 'settings', 'password',
      'change password', 'security settings'
    ],
    suggested_actions: [
      {
        title: 'System Audit Trail',
        route: '/admin/audit-logs',
        icon: 'ti-history',
        description: 'Review security logs'
      }
    ]
  }
];

const EMPLOYEE_INTENTS = [
  {
    id: 'emp-qr',
    title: 'My Digital QR Pass',
    route: '/employee/qr',
    icon: 'ti-qrcode',
    description: 'Personal gate pass barcode for clocking in',
    intent_title: 'Personal Digital Gate Pass',
    ai_answer: 'Display your personal QR gate pass barcode to scan in and out at company entrance terminals.',
    keywords: [
      'qr', 'gate pass', 'my qr', 'barcode', 'pass', 'digital pass',
      'clock in qr', 'code'
    ],
    suggested_actions: [
      {
        title: 'My Portal Dashboard',
        route: '/employee/dashboard',
        icon: 'ti-smart-home',
        description: 'View dashboard'
      }
    ]
  },
  {
    id: 'emp-dashboard',
    title: 'My Portal Dashboard',
    route: '/employee/dashboard',
    icon: 'ti-smart-home',
    description: 'Personal work schedule, attendance history, and payslips',
    intent_title: 'Employee Self-Service Portal',
    ai_answer: 'Check your work schedule, attendance logs, overtime hours, and cutoff payslips.',
    keywords: [
      'dashboard', 'portal', 'payslip', 'payslips', 'sweldo', 'sahod',
      'dtr', 'bundy', 'attendance', 'hours', 'schedule', 'shift', 'my payslip'
    ],
    suggested_actions: [
      {
        title: 'My Digital QR Pass',
        route: '/employee/qr',
        icon: 'ti-qrcode',
        description: 'Show QR pass'
      }
    ]
  },
  {
    id: 'emp-scanner',
    title: 'Gate Clocking Pass',
    route: '/employee/qr',
    icon: 'ti-camera',
    description: 'Clock in using your personal gate pass',
    intent_title: 'Clocking Terminal',
    ai_answer: 'Access your clocking pass to record your shift attendance at the gate.',
    keywords: [
      'camera', 'scanner', 'clock in', 'time in', 'clock out', 'time out'
    ],
    suggested_actions: [
      {
        title: 'My Portal Dashboard',
        route: '/employee/dashboard',
        icon: 'ti-smart-home',
        description: 'View attendance records'
      }
    ]
  },
  {
    id: 'emp-profile',
    title: 'My Profile & Account',
    route: '/profile',
    icon: 'ti-user-circle',
    description: 'Password and profile details',
    intent_title: 'Account Profile & Settings',
    ai_answer: 'Update your personal contact details, password, and security preferences.',
    keywords: [
      'profile', 'account', 'password', 'settings', 'my profile'
    ],
    suggested_actions: [
      {
        title: 'My Portal Dashboard',
        route: '/employee/dashboard',
        icon: 'ti-smart-home',
        description: 'Return to dashboard'
      }
    ]
  }
];

function checkKeywordMatch(normalizedQuery, tokens, keywords) {
  return keywords.some((kw) => {
    const foldedKw = fold(kw);
    // If the keyword contains multiple words, check substring containment
    if (foldedKw.includes(' ')) {
      return normalizedQuery.includes(foldedKw);
    }
    // For short tokens (<= 3 chars, e.g. "vl", "sl", "ot", "tin", "bir", "dtr"), require exact token match
    if (foldedKw.length <= 3) {
      return tokens.includes(foldedKw);
    }
    // Otherwise check substring
    return normalizedQuery.includes(foldedKw);
  });
}

/**
 * Evaluates a query against the local semantic intent registry.
 * 
 * @param {string} rawQuery - The user's input query
 * @param {boolean} isAdminUser - Whether the active user holds administrative privileges
 * @returns {object|null} Structured intent payload or null if query requires Gemini AI
 */
export function matchLocalIntent(rawQuery, isAdminUser) {
  if (!rawQuery || typeof rawQuery !== 'string') return null;

  const cleanQuery = rawQuery.trim();
  if (cleanQuery.length < 2) return null;

  // Let Gemini Brain handle complex legal, regulatory, or explanatory questions
  if (DEEP_ADVISORY_REGEX.test(cleanQuery)) {
    return null;
  }

  const normalized = fold(cleanQuery);
  const tokens = normalized.split(/[^a-z0-9]+/i).filter(Boolean);
  if (tokens.length === 0) return null;

  const intents = isAdminUser ? ADMIN_INTENTS : EMPLOYEE_INTENTS;

  for (const intent of intents) {
    if (checkKeywordMatch(normalized, tokens, intent.keywords)) {
      return {
        intent_title: intent.intent_title,
        ai_answer: intent.ai_answer,
        primary_action: {
          title: intent.title,
          description: intent.description,
          route: intent.route,
          icon: intent.icon
        },
        suggested_actions: intent.suggested_actions || [],
        is_local: true,
        is_cached: true
      };
    }
  }

  return null;
}
