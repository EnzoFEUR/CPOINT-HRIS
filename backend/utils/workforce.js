/**
 * C-Point HRIS - Universal Workforce Architecture Helper
 * 
 * Defines standard filters and utilities to cleanly separate active workforce employees
 * from technical system operators and gate security (Admins, Kiosk Security Guards, HR).
 */

export const SYSTEM_ROLES = [
    'admin', 
    'superadmin', 
    'super_admin', 
    'security', 
    'guard', 
    'security_guard',
    'hr',
    'hr_manager'
];

/**
 * Checks if a given employee object or role is an attendance-exempt operator
 * (Admins, Superadmins, HR Administrators, and Security Guards).
 */
export const isAttendanceExempt = (employee) => {
    if (!employee) return false;
    const role = (employee.role || '').toLowerCase().replace(/_/g, '');
    const dept = (employee.department || '').toLowerCase();
    const title = (employee.job_title || employee.position || '').toLowerCase();

    const isSystemRole = [
        'admin', 
        'superadmin', 
        'security', 
        'guard', 
        'securityguard',
        'hr',
        'hrmanager'
    ].includes(role);

    const isExemptDept = dept === 'security' || dept === 'administration' || dept === 'human resources';
    const isExemptTitle = title.includes('guard') || title.includes('security') || title.includes('administrator') || title.includes('gate attendant');

    return Boolean(isSystemRole || isExemptDept || isExemptTitle);
};

/**
 * Checks if a given employee object or role represents an active workforce employee
 * who is required to log attendance and be tracked in operational headcount.
 */
export const isWorkforceEmployee = (employee) => {
    if (!employee) return false;
    if (!employee.company_id) return false;
    return !isAttendanceExempt(employee);
};

/**
 * Applies universal workforce filtering to any Supabase query on the `employees` table.
 * Excludes accounts without a company_id and excludes admin / security / HR roles.
 */
export const applyWorkforceFilter = (supabaseQuery) => {
    return supabaseQuery
        .not('company_id', 'is', null)
        .not('role', 'in', '("admin","superadmin","super_admin","security","guard","security_guard","hr","hr_manager")');
};
