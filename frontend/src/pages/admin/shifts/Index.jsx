import React from 'react';
import { Navigate } from 'react-router-dom';

/**
 * Shift Management Module decommissioned per company HR policy.
 * Schedules are fixed by Worker Classification:
 * - Factory Worker: 08:00 AM - 05:00 PM (No Overtime)
 * - Regular Worker: 08:00 AM - 08:00 PM (Overtime Eligible)
 */
export default function ShiftsIndex() {
    return <Navigate to="/admin/employees" replace />;
}
