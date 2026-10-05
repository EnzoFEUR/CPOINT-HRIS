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
        'superadmin', 
        'security', 
        'guard', 
        'securityguard',
        'hr',
        'hrmanager'
    ].includes(role) || role.includes('admin') || role.includes('security') || role.includes('guard') || role.includes('hr');

    const isExemptDept = dept.includes('security') || dept.includes('admin') || dept.includes('hr') || dept.includes('human resources') || dept.includes('administration');
    const isExemptTitle = title.includes('guard') || title.includes('security') || title.includes('administrator') || title.includes('admin') || title.includes('gate attendant') || title.includes('hr');

    return Boolean(isSystemRole || isExemptDept || isExemptTitle);
};

/**
 * Checks if a given employee object or role represents an active workforce employee
 * who is required to log attendance and be tracked in operational headcount and payroll.
 */
export const isWorkforceEmployee = (employee) => {
    if (!employee) return false;
    if (!employee.company_id) return false;
    const role = (employee.role || '').toLowerCase();
    if (role && role !== 'employee') return false;
    return !isAttendanceExempt(employee);
};

/**
 * Applies universal workforce filtering to any Supabase query on the `employees` table.
 * Excludes accounts without a company_id and strictly selects workforce employees.
 */
export const applyWorkforceFilter = (supabaseQuery) => {
    return supabaseQuery
        .not('company_id', 'is', null)
        .eq('role', 'employee');
};
