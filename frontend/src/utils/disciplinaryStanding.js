/**
 * C-Point HRIS - Universal Disciplinary & Compliance Standing Engine (Frontend)
 *
 * Implements Philippine Labor Code (DOLE Rule XIV, Book V / Art. 297) and
 * enterprise progressive discipline standards.
 *
 * Tiers:
 * - Tier 5: TERMINATED / SEPARATED
 * - Tier 4: SUSPENDED (Active administrative sanction)
 * - Tier 3.5: ACTIVE_NOTICE (NTE / memo requiring action)
 * - Tier 3: CRITICAL (2+ served suspensions -> Final Warning Threshold before dismissal)
 * - Tier 2: CONDITIONAL (1 served suspension OR 3+ written warnings -> Strict Monitoring)
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
                tierCode: 'DISMISSED_FOR_CAUSE',
                levelName: 'Disciplinary Dismissal',
                badgeLabel: 'Dismissed for Cause',
                shortLabel: 'Dismissed',
                badgeClass: 'bg-danger-subtle text-danger-ink border-danger/20',
                bannerClass: 'bg-danger-subtle border-danger/20 text-danger-ink',
                icon: 'ti-ban',
                title: 'Disciplinary Dismissal',
                description: 'Employment was ended due to disciplinary dismissal.',
                employeeDescription: 'Employment was ended due to disciplinary dismissal.',
                isGoodStanding: false,
                servedSuspensionsCount: servedSuspCount,
                clearedSuspensionsCount: clearedSuspCount,
                warningsCount,
                activeNoticesCount,
                totalLogsCount: logs.length
            };
        }

        if (servedSuspCount > 0) {
            return {
                tier: 2.5,
                tierCode: 'SEPARATED_WITH_RECORD',
                levelName: 'Separated · Prior Sanctions on File',
                badgeLabel: `Separated · ${servedSuspCount} Suspension${servedSuspCount === 1 ? '' : 's'} Served`,
                shortLabel: 'Separated (Sanctions)',
                badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
                bannerClass: 'bg-slate-50 border-slate-200 text-slate-800',
                icon: 'ti-archive',
                title: 'Separated · Prior Disciplinary Records',
                description: `Employment ended with ${servedSuspCount} past suspension${servedSuspCount === 1 ? '' : 's'} on record.`,
                employeeDescription: `Employment ended with ${servedSuspCount} past suspension${servedSuspCount === 1 ? '' : 's'} on file.`,
                isGoodStanding: false,
                servedSuspensionsCount: servedSuspCount,
                clearedSuspensionsCount: clearedSuspCount,
                warningsCount,
                activeNoticesCount,
                totalLogsCount: logs.length
            };
        }

        if (warningsCount > 0) {
            return {
                tier: 1.5,
                tierCode: 'SEPARATED_WITH_WARNINGS',
                levelName: 'Separated · Warnings on File',
                badgeLabel: `Separated · ${warningsCount} Warning${warningsCount === 1 ? '' : 's'}`,
                shortLabel: 'Separated (Warnings)',
                badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
                bannerClass: 'bg-slate-50 border-slate-200 text-slate-800',
                icon: 'ti-archive',
                title: 'Separated · Policy Warnings on File',
                description: `Employment ended with ${warningsCount} past written warning${warningsCount === 1 ? '' : 's'} on record.`,
                employeeDescription: `Employment ended with ${warningsCount} past warning${warningsCount === 1 ? '' : 's'} on file.`,
                isGoodStanding: false,
                servedSuspensionsCount: 0,
                clearedSuspensionsCount: clearedSuspCount,
                warningsCount,
                activeNoticesCount,
                totalLogsCount: logs.length
            };
        }

        // Clean separation (Voluntary Resignation, Retirement, End of Contract, Redundancy, Clean Archive)
        return {
            tier: 0,
            tierCode: 'SEPARATED_CLEAN',
            levelName: 'Separated · Clean Standing',
            badgeLabel: 'Clean Record · Separated',
            shortLabel: 'Clean (Separated)',
            badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
            bannerClass: 'bg-emerald-50 border-emerald-200 text-emerald-900',
            icon: 'ti-shield-check',
            title: 'Good Standing · Separated',
            description: 'Employment ended in good standing with zero violations.',
            employeeDescription: 'You left the company in good standing with a clean record.',
            isGoodStanding: true,
            servedSuspensionsCount: 0,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount: 0,
            activeNoticesCount: 0,
            totalLogsCount: logs.length
        };
    }

    // 3. Operational holds
    const isSusp = isSuspended || status === 'suspended' || operational_status === 'Suspended';
    if (isSusp) {
        return {
            tier: 4,
            tierCode: 'SUSPENDED',
            levelName: 'Active Suspension',
            badgeLabel: 'Suspended (Active Hold)',
            shortLabel: 'Suspended',
            badgeClass: 'bg-warning-subtle text-warning-ink border-warning/20',
            bannerClass: 'bg-warning-subtle border-warning/20 text-warning-ink',
            icon: 'ti-player-pause',
            title: 'Account Suspended',
            description: 'Employee is currently serving a suspension. Clock-in and system access are paused.',
            employeeDescription: 'Your account is currently suspended. Time clocking and system access are temporarily paused.',
            isGoodStanding: false,
            servedSuspensionsCount: servedSuspCount,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount,
            activeNoticesCount,
            totalLogsCount: logs.length
        };
    }

    // 3. Active unacknowledged or pending notices (NTE / Memos)
    if (activeNoticesCount > 0) {
        return {
            tier: 3.5,
            tierCode: 'ACTIVE_NOTICE',
            levelName: 'Active Notice',
            badgeLabel: 'Active Notice · Action Required',
            shortLabel: 'Active Notice',
            badgeClass: 'bg-warning-subtle text-warning-ink border-warning/20',
            bannerClass: 'bg-warning-subtle border-warning/20 text-warning-ink',
            icon: 'ti-alert-triangle',
            title: 'Notice Pending Review',
            description: `${activeNoticesCount} active notice${activeNoticesCount === 1 ? '' : 's'} waiting for employee review or HR response.`,
            employeeDescription: `You have ${activeNoticesCount} active notice${activeNoticesCount === 1 ? '' : 's'} waiting for your review and acknowledgment.`,
            isGoodStanding: false,
            servedSuspensionsCount: servedSuspCount,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount,
            activeNoticesCount,
            totalLogsCount: logs.length
        };
    }

    // 4. Tier 3: Critical Standing (2+ Suspensions Served)
    // Threshold right before dismissal review under progressive discipline
    if (servedSuspCount >= 2) {
        return {
            tier: 3,
            tierCode: 'CRITICAL',
            levelName: 'Level 3 · Final Warning',
            badgeLabel: `Critical Standing · ${servedSuspCount} Suspensions`,
            shortLabel: `Critical Standing (L3)`,
            badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 font-bold',
            bannerClass: 'bg-rose-50 border-rose-200 text-rose-900',
            icon: 'ti-alert-octagon',
            title: 'Critical Standing · Final Warning',
            description: `Employee has ${servedSuspCount} past suspensions on record. Account is on final warning—further violations may result in dismissal.`,
            employeeDescription: `You have ${servedSuspCount} past suspensions on record. Your account is on final warning—further violations may lead to dismissal.`,
            isGoodStanding: false,
            servedSuspensionsCount: servedSuspCount,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount,
            activeNoticesCount: 0,
            totalLogsCount: logs.length
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
            tierCode: 'CONDITIONAL',
            levelName: 'Level 2 · Close Monitoring',
            badgeLabel: `Conditional Standing · ${servedSuspCount === 1 ? '1 Suspension Served' : 'Close Monitoring'}`,
            shortLabel: `Conditional Standing (L2)`,
            badgeClass: 'bg-warning-subtle text-warning-ink border-warning/30 font-semibold',
            bannerClass: 'bg-amber-50 border-amber-200 text-amber-900',
            icon: 'ti-shield-exclamation',
            title: 'Conditional Standing · Close Monitoring',
            description: `Employee has ${details} on record${clearedNote}. The suspension has ended and the account is active under close monitoring.`,
            employeeDescription: `You have ${details} on record${clearedNote}. Your account is active—please keep good attendance and follow company rules.`,
            isGoodStanding: false,
            servedSuspensionsCount: servedSuspCount,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount,
            activeNoticesCount: 0,
            totalLogsCount: logs.length
        };
    }

    // 6. Tier 1: Advisory Standing (1-2 Warnings, 0 Suspensions)
    if (warningsCount > 0) {
        return {
            tier: 1,
            tierCode: 'ADVISORY',
            levelName: 'Level 1 · Advisory',
            badgeLabel: `Advisory Standing · ${warningsCount} Warning${warningsCount === 1 ? '' : 's'}`,
            shortLabel: `Advisory Standing (L1)`,
            badgeClass: 'bg-accent-subtle text-accent-ink border-accent/30 font-semibold',
            bannerClass: 'bg-slate-50 border-slate-200 text-slate-800',
            icon: 'ti-file-alert',
            title: 'Advisory Standing · Warnings on File',
            description: `Employee has ${warningsCount} written warning${warningsCount === 1 ? '' : 's'} on record. Account is active under regular observation.`,
            employeeDescription: `You have ${warningsCount} written warning${warningsCount === 1 ? '' : 's'} on record. Please keep following company rules.`,
            isGoodStanding: false,
            servedSuspensionsCount: 0,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount,
            activeNoticesCount: 0,
            totalLogsCount: logs.length
        };
    }

    // 7. Tier 0.5: Cleared / Overturned Only
    if (clearedLogs.length > 0) {
        return {
            tier: 0.5,
            tierCode: 'CLEARED',
            levelName: 'Good Standing · Records Cleared',
            badgeLabel: 'Good Standing · Cleared',
            shortLabel: 'Good Standing (Cleared)',
            badgeClass: 'bg-surface-muted text-ink border-line font-semibold',
            bannerClass: 'bg-slate-50 border-slate-200 text-slate-800',
            icon: 'ti-shield-check',
            title: 'Good Standing · Past Record Cleared',
            description: 'All past disciplinary records were cleared by HR. Account is in good standing.',
            employeeDescription: 'Your past disciplinary record was cleared by HR. Your account is in good standing.',
            isGoodStanding: true,
            servedSuspensionsCount: 0,
            clearedSuspensionsCount: clearedSuspCount,
            warningsCount: 0,
            activeNoticesCount: 0,
            totalLogsCount: logs.length
        };
    }

    // 8. Tier 0: Pristine Clean Record
    return {
        tier: 0,
        tierCode: 'CLEAN',
        levelName: 'Good Standing',
        badgeLabel: 'Good Standing',
        shortLabel: 'Good Standing',
        badgeClass: 'bg-surface-muted text-ink border-line font-semibold',
        bannerClass: 'bg-surface-muted border-line text-ink',
        icon: 'ti-shield-check',
        title: 'Good Standing',
        description: 'Clean record with zero warnings or violations.',
        employeeDescription: 'You have a clean record with no warnings or violations. Keep up the good work!',
        isGoodStanding: true,
        servedSuspensionsCount: 0,
        clearedSuspensionsCount: 0,
        warningsCount: 0,
        activeNoticesCount: 0,
        totalLogsCount: 0
    };
}
