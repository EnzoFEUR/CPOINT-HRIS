/**
 * C-Point HRIS - Universal Disciplinary & Compliance Standing Engine
 *
 * Implements Philippine Labor Code (DOLE Rule XIV, Book V / Art. 297) and
 * enterprise progressive discipline standards.
 *
 * Tiers:
 * - Tier 5: TERMINATED / SEPARATED
 * - Tier 4: SUSPENDED (Active administrative sanction)
 * - Tier 3.5: ACTIVE_NOTICE (NTE / memo requiring action)
 * - Tier 3: CRITICAL (2+ served suspensions -> Final Warning Threshold before dismissal)
 * - Tier 2: CONDITIONAL (1 served suspension OR 3+ written warnings ->Strict Monitoring)
 * - Tier 1: ADVISORY (1-2 written warnings -> Monitored Advisory)
 * - Tier 0.5: CLEARED (All records overturned/exonerated -> Good Standing Restored)
 * - Tier 0: CLEAN (Zero infractions -> Full Good Standing)
 */

export function isExoneratedOrCleared(log) {
    if (!log) return false;
    const status = (log.status || '').toLowerCase();
    const reason = (log.reason || '').toLowerCase();
    return (
        status === 'overturned' ||
        status === 'dismissed' ||
        status === 'cleared' ||
        reason.includes('[cleared') ||
        reason.includes('[exonerated') ||
        reason.includes('[reinstated')
    );
}

export function computeDisciplinaryStanding({
    isTerminated = false,
    isSuspended = false,
    status = 'active',
    operational_status = 'Active',
    disciplinaryLogs = []
} = {}) {
    const logs = Array.isArray(disciplinaryLogs) ? disciplinaryLogs : [];

    // 1. Classify logs
    const clearedLogs = logs.filter(isExoneratedOrCleared);
    const sustainedLogs = logs.filter(l => !isExoneratedOrCleared(l));

    const activeNotices = sustainedLogs.filter(l => l.status === 'Active' || l.status === 'Under Review');
    const servedSuspensions = sustainedLogs.filter(l => l.type === 'Suspension' && (l.status === 'Resolved' || l.status === 'Closed'));
    const clearedSuspensions = clearedLogs.filter(l => l.type === 'Suspension');
    const sustainedWarnings = sustainedLogs.filter(l => l.type !== 'Suspension' && l.type !== 'Termination');
    const sustainedTerminations = sustainedLogs.filter(l => l.type === 'Termination');

    const servedSuspCount = servedSuspensions.length;
    const clearedSuspCount = clearedSuspensions.length;
    const warningsCount = sustainedWarnings.length;
    const activeNoticesCount = activeNotices.length;
    const hasDisciplinaryDismissal = sustainedTerminations.length > 0;

    // 2. Separation / Termination checks
    const isTerm = isTerminated || status === 'terminated' || operational_status === 'Terminated';
    if (isTerm) {
        if (hasDisciplinaryDismissal) {
            return {
                tier: 5,
                tier_code: 'DISMISSED_FOR_CAUSE',
                level_name: 'Disciplinary Dismissal',
                badge_label: 'Dismissed for Cause',
                short_label: 'Dismissed',
                badge_color: 'danger',
                title: 'Disciplinary Dismissal',
                description: 'Employment was ended due to disciplinary dismissal.',
                employee_description: 'Employment was ended due to disciplinary dismissal.',
                is_good_standing: false,
                served_suspensions_count: servedSuspCount,
                cleared_suspensions_count: clearedSuspCount,
                warnings_count: warningsCount,
                active_notices_count: activeNoticesCount,
                total_logs_count: logs.length
            };
        }

        if (servedSuspCount > 0) {
            return {
                tier: 2.5,
                tier_code: 'SEPARATED_WITH_RECORD',
                level_name: 'Separated · Prior Sanctions on File',
                badge_label: `Separated · ${servedSuspCount} Suspension${servedSuspCount === 1 ? '' : 's'} Served`,
                short_label: 'Separated (Sanctions)',
                badge_color: 'secondary',
                title: 'Separated · Prior Disciplinary Records',
                description: `Employment ended with ${servedSuspCount} past suspension${servedSuspCount === 1 ? '' : 's'} on record.`,
                employee_description: `Employment ended with ${servedSuspCount} past suspension${servedSuspCount === 1 ? '' : 's'} on file.`,
                is_good_standing: false,
                served_suspensions_count: servedSuspCount,
                cleared_suspensions_count: clearedSuspCount,
                warnings_count: warningsCount,
                active_notices_count: activeNoticesCount,
                total_logs_count: logs.length
            };
        }

        if (warningsCount > 0) {
            return {
                tier: 1.5,
                tier_code: 'SEPARATED_WITH_WARNINGS',
                level_name: 'Separated · Warnings on File',
                badge_label: `Separated · ${warningsCount} Warning${warningsCount === 1 ? '' : 's'}`,
                short_label: 'Separated (Warnings)',
                badge_color: 'secondary',
                title: 'Separated · Policy Warnings on File',
                description: `Employment ended with ${warningsCount} past written warning${warningsCount === 1 ? '' : 's'} on record.`,
                employee_description: `Employment ended with ${warningsCount} past warning${warningsCount === 1 ? '' : 's'} on file.`,
                is_good_standing: false,
                served_suspensions_count: 0,
                cleared_suspensions_count: clearedSuspCount,
                warnings_count: warningsCount,
                active_notices_count: activeNoticesCount,
                total_logs_count: logs.length
            };
        }

        // Clean separation (Voluntary Resignation, Retirement, End of Contract, Redundancy, Clean Archive)
        return {
            tier: 0,
            tier_code: 'SEPARATED_CLEAN',
            level_name: 'Separated · Clean Standing',
            badge_label: 'Clean Record · Separated',
            short_label: 'Clean (Separated)',
            badge_color: 'success',
            title: 'Good Standing · Separated',
            description: 'Employment ended in good standing with zero violations.',
            employee_description: 'You left the company in good standing with a clean record.',
            is_good_standing: true,
            served_suspensions_count: 0,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: 0,
            active_notices_count: 0,
            total_logs_count: logs.length
        };
    }

    // 3. Operational holds
    const isSusp = isSuspended || status === 'suspended' || operational_status === 'Suspended';
    if (isSusp) {
        return {
            tier: 4,
            tier_code: 'SUSPENDED',
            level_name: 'Active Suspension',
            badge_label: 'Suspended (Active Hold)',
            short_label: 'Suspended',
            badge_color: 'warning',
            title: 'Account Suspended',
            description: 'Employee is currently serving a suspension. Clock-in and system access are paused.',
            employee_description: 'Your account is currently suspended. Time clocking and system access are temporarily paused.',
            is_good_standing: false,
            served_suspensions_count: servedSuspCount,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: warningsCount,
            active_notices_count: activeNoticesCount,
            total_logs_count: logs.length
        };
    }

    // 3. Active unacknowledged or pending notices (NTE / Memos)
    if (activeNoticesCount > 0) {
        return {
            tier: 3.5,
            tier_code: 'ACTIVE_NOTICE',
            level_name: 'Active Notice',
            badge_label: 'Action Required · Active Notice',
            short_label: 'Active Notice',
            badge_color: 'warning',
            title: 'Notice Pending Review',
            description: `${activeNoticesCount} active notice${activeNoticesCount === 1 ? '' : 's'} waiting for employee review or HR response.`,
            employee_description: `You have ${activeNoticesCount} active notice${activeNoticesCount === 1 ? '' : 's'} waiting for your review and acknowledgment.`,
            is_good_standing: false,
            served_suspensions_count: servedSuspCount,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: warningsCount,
            active_notices_count: activeNoticesCount,
            total_logs_count: logs.length
        };
    }

    // 4. Tier 3: Critical Standing (2+ Suspensions Served)
    // Threshold right before dismissal review under progressive discipline
    if (servedSuspCount >= 2) {
        return {
            tier: 3,
            tier_code: 'CRITICAL',
            level_name: 'Level 3 · Final Warning',
            badge_label: `Critical Standing · ${servedSuspCount} Suspensions`,
            short_label: `Critical Standing (L3)`,
            badge_color: 'danger',
            title: 'Critical Standing · Final Warning',
            description: `Employee has ${servedSuspCount} past suspensions on record. Account is on final warning—further violations may result in dismissal.`,
            employee_description: `You have ${servedSuspCount} past suspensions on record. Your account is on final warning—further violations may lead to dismissal.`,
            is_good_standing: false,
            served_suspensions_count: servedSuspCount,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: warningsCount,
            active_notices_count: 0,
            total_logs_count: logs.length
        };
    }

    // 5. Tier 2: Conditional Standing (1 Suspension Served OR 3+ Warnings)
    if (servedSuspCount === 1 || warningsCount >= 3) {
        const details = servedSuspCount === 1 
            ? '1 past suspension' 
            : `${warningsCount} written warnings`;
        const clearedNote = clearedSuspCount > 0 ? ` (${clearedSuspCount} cleared)` : '';
        return {
            tier: 2,
            tier_code: 'CONDITIONAL',
            level_name: 'Level 2 · Close Monitoring',
            badge_label: `Conditional Standing · ${servedSuspCount === 1 ? '1 Suspension' : 'Close Monitoring'}`,
            short_label: `Conditional Standing (L2)`,
            badge_color: 'warning',
            title: 'Conditional Standing · Close Monitoring',
            description: `Employee has ${details} on record${clearedNote}. The suspension has ended and the account is active under close monitoring.`,
            employee_description: `You have ${details} on record${clearedNote}. Your account is active—please keep good attendance and follow company rules.`,
            is_good_standing: false,
            served_suspensions_count: servedSuspCount,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: warningsCount,
            active_notices_count: 0,
            total_logs_count: logs.length
        };
    }

    // 6. Tier 1: Advisory Standing (1-2 Warnings, 0 Suspensions)
    if (warningsCount > 0) {
        return {
            tier: 1,
            tier_code: 'ADVISORY',
            level_name: 'Level 1 · Advisory',
            badge_label: `Advisory Standing · ${warningsCount} Warning${warningsCount === 1 ? '' : 's'}`,
            short_label: `Advisory Standing (L1)`,
            badge_color: 'info',
            title: 'Advisory Standing · Warnings on File',
            description: `Employee has ${warningsCount} written warning${warningsCount === 1 ? '' : 's'} on record. Account is active under regular observation.`,
            employee_description: `You have ${warningsCount} written warning${warningsCount === 1 ? '' : 's'} on record. Please keep following company rules.`,
            is_good_standing: false,
            served_suspensions_count: 0,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: warningsCount,
            active_notices_count: 0,
            total_logs_count: logs.length
        };
    }

    // 7. Tier 0.5: Cleared / Overturned Only
    if (clearedLogs.length > 0) {
        return {
            tier: 0.5,
            tier_code: 'CLEARED',
            level_name: 'Good Standing · Records Cleared',
            badge_label: 'Good Standing · Cleared',
            short_label: 'Good Standing (Cleared)',
            badge_color: 'success',
            title: 'Good Standing · Past Record Cleared',
            description: 'All past disciplinary records were cleared by HR. Account is in good standing.',
            employee_description: 'Your past disciplinary record was cleared by HR. Your account is in good standing.',
            is_good_standing: true,
            served_suspensions_count: 0,
            cleared_suspensions_count: clearedSuspCount,
            warnings_count: 0,
            active_notices_count: 0,
            total_logs_count: logs.length
        };
    }

    // 8. Tier 0: Pristine Clean Record
    return {
        tier: 0,
        tier_code: 'CLEAN',
        level_name: 'Good Standing',
        badge_label: 'Good Standing',
        short_label: 'Good Standing',
        badge_color: 'success',
        title: 'Good Standing',
        description: 'Clean record with zero warnings or violations.',
        employee_description: 'You have a clean record with no warnings or violations. Keep up the good work!',
        is_good_standing: true,
        served_suspensions_count: 0,
        cleared_suspensions_count: 0,
        warnings_count: 0,
        active_notices_count: 0,
        total_logs_count: 0
    };
}
