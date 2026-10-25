/**
 * C-Point HRIS - Universal Workforce Architecture Helper
 * 
 * Defines standard filters and utilities to cleanly separate active workforce employees
 * from technical system operators and gate security (Admins, Kiosk Security Guards, HR).
 */

export const SYSTEM_ROLES = [
    'admin', 
    'security', 
    'guard', 
    'security_guard',
    'hr',
    'hr_manager'
];

const EXEMPT_DEPARTMENTS = ['security', 'admin', 'hr', 'human resources', 'administration'];
const EXEMPT_TITLES = ['guard', 'security', 'administrator', 'admin', 'gate attendant', 'hr'];

/**
 * Checks if a given employee object or role is an attendance-exempt operator
 * (Admins, HR Administrators, and Security Guards).
 * Workforce employees are strictly operational personnel (Factory, Retail, etc.).
 */
export const isAttendanceExempt = (employee) => {
    if (!employee) return false;
    const role = (employee.role || '').toLowerCase().replace(/[\s_-]/g, '');
    const dept = (employee.department || '').toLowerCase();
    const title = (employee.job_title || employee.position || '').toLowerCase();

    // Any role other than 'employee' is exempt (admin, security, guard, hr, etc.)
    if (role && role !== 'employee') return true;

    const isSystemRole = [
        'admin', 
        'security', 
        'guard', 
        'securityguard',
        'hr',
        'hrmanager'
    ].includes(role) || role.includes('admin') || role.includes('security') || role.includes('guard') || role.includes('hr');

    const isExemptDept = EXEMPT_DEPARTMENTS.some(value => dept.includes(value));
    const isExemptTitle = EXEMPT_TITLES.some(value => title.includes(value));

    return Boolean(isSystemRole || isExemptDept || isExemptTitle);
};

/**
 * Checks if a given employee object or role represents an active workforce employee
 * who is required to log attendance and be tracked in operational headcount and payroll.
 */
export const isWorkforceEmployee = (employee) => {
    if (!employee) return false;
    if (!employee.company_id) return false;
    if (employee.status && employee.status !== 'active') return false;
    const role = (employee.role || '').toLowerCase();
    if (role && role !== 'employee') return false;
    return !isAttendanceExempt(employee);
};

// Filter an empty eligibility embed without changing the displayed employee relationship.
export function applyAttendanceWorkforceFilters(query, department) {
    const referencedTable = 'workforce';
    query = query.not('workforce.company_id', 'is', null).neq('workforce.company_id', '')
        .or('status.is.null,status.eq."",status.eq.active', { referencedTable })
        .or('role.is.null,role.eq."",role.ilike.employee', { referencedTable });
    for (const [field, terms] of [['department', EXEMPT_DEPARTMENTS], ['job_title', EXEMPT_TITLES]]) {
        query = query.or(`${field}.is.null,and(${terms.map(term => `${field}.not.ilike.${JSON.stringify(`%${term}%`)}`).join(',')})`, { referencedTable });
    }
    if (department && department.toLowerCase() !== 'all') {
        return query.ilike('workforce.department', department.replace(/[\\%_]/g, '\\$&')).not('workforce', 'is', null);
    }
    // History has always retained orphan relationships; department-specific reads exclude them.
    return query.or('workforce.not.is.null,employees.is.null');
}

/**
 * Applies universal workforce filtering to any Supabase query on the `employees` table.
 * Excludes accounts without a company_id and strictly selects workforce employees.
 */
export const applyWorkforceFilter = (supabaseQuery) => {
    return supabaseQuery
        .not('company_id', 'is', null)
        .eq('role', 'employee');
};
