/**
 * C-Point HRIS - Universal Workforce Architecture Helper
 * 
 * Defines standard filters and utilities to cleanly separate active workforce employees
 * from technical system operators (Admins, Kiosk Security Guards).
 */

export const SYSTEM_ROLES = ['admin', 'superadmin', 'security', 'guard', 'security_guard'];

/**
 * Checks if a given employee object or role represents an active workforce employee
 */
export const isWorkforceEmployee = (employee) => {
    if (!employee) return false;
    if (!employee.company_id) return false;
    const role = (employee.role || '').toLowerCase();
    return !SYSTEM_ROLES.includes(role);
};

/**
 * Applies universal workforce filtering to any Supabase query on the `employees` table
 * Excludes accounts without a company_id and excludes admin / security roles.
 */
export const applyWorkforceFilter = (supabaseQuery) => {
    return supabaseQuery
        .not('company_id', 'is', null)
        .not('role', 'in', '("admin","superadmin","security","guard","security_guard")');
};
