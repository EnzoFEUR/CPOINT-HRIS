export const HOLIDAY_LABELS = {
    regular: 'Regular Holiday',
    special_non_working: 'Special Non-Working Day',
};

export const cleanDeductionName = (rawName) => {
    if (!rawName) return '';
    let name = rawName.trim();

    // Check for Pag-IBIG variations first before hyphen splitting
    const lowerRaw = name.toLowerCase();
    if (lowerRaw.includes('pag-ibig') || lowerRaw.includes('pagibig') || lowerRaw.includes('hdmf') || lowerRaw === 'ibig') {
        return 'Pag-IBIG';
    }

    // Strip long/verbose system prefixes using ' - ' (spaced hyphen) so 'Pag-IBIG' isn't split
    if (name.includes(' - ')) {
        const parts = name.split(' - ');
        const lastPart = parts[parts.length - 1].trim();
        if (lastPart) name = lastPart;
    }

    // Normalize names for consistent display
    const lower = name.toLowerCase();
    if (lower === 'tax' || lower.includes('withholding tax')) return 'Withholding Tax';
    if (lower === 'sss' || lower.includes('sss contribution')) return 'SSS Contribution';
    if (lower === 'philhealth' || lower === 'ph') return 'PhilHealth';
    if (lower.includes('pag-ibig') || lower.includes('pagibig') || lower.includes('hdmf') || lower.includes('ibig')) return 'Pag-IBIG';
    if (lower.includes('late') || lower.includes('tardiness')) return 'Late / Tardiness';
    if (lower.includes('absence') || lower.includes('undertime')) return 'Absences / Undertime';
    return name;
};

export const parsePayrollFinancials = (payroll) => {
    if (!payroll) {
        return {
            basicPay: 0,
            overtimePay: 0,
            holidayPay: 0,
            paidHolidayItems: [],
            hasHolidayPay: false,
            grossEarnings: 0,
            deductionsList: [],
            totalDeductions: 0,
            netPay: 0,
        };
    }

    const basicPay = Number(payroll.basic_pay || 0);
    const overtimePay = Number(payroll.overtime_pay || 0);

    const holidayBreakdown = Array.isArray(payroll.holiday_breakdown) ? payroll.holiday_breakdown : [];
    const holidayPay = Number(payroll.holiday_pay || 0);
    const paidHolidayItems = holidayBreakdown.filter((h) => Number(h?.pay) > 0);
    const hasHolidayPay = holidayPay > 0 && paidHolidayItems.length > 0;

    const grossEarnings = basicPay + overtimePay + holidayPay;

    // Deductions Parser
    const deductionsMap = new Map();

    const setDeduction = (rawName, rawAmount) => {
        if (!rawName) return;
        const cleanedStr = String(rawAmount || '').replace(/[^\d.-]/g, '');
        const amount = Number(cleanedStr);
        if (isNaN(amount) || amount <= 0) return;

        const displayName = cleanDeductionName(rawName);
        const normKey = displayName.toLowerCase();

        // Deduplicate items
        let targetKey = normKey;
        for (const existingKey of deductionsMap.keys()) {
            if (
                (existingKey.includes('sss') && normKey.includes('sss')) ||
                (existingKey.includes('philhealth') && normKey.includes('philhealth')) ||
                (existingKey.includes('ibig') && normKey.includes('ibig')) ||
                (existingKey.includes('tax') && normKey.includes('tax')) ||
                (existingKey.includes('late') && normKey.includes('late')) ||
                (existingKey.includes('absence') && normKey.includes('absence')) ||
                existingKey === normKey
            ) {
                targetKey = existingKey;
                break;
            }
        }

        deductionsMap.set(targetKey, { name: displayName, amount });
    };

    // 1. Direct statutory fields
    if (payroll.sss_deduction || payroll.sss) setDeduction('SSS Contribution', payroll.sss_deduction || payroll.sss);
    if (payroll.philhealth_deduction || payroll.philhealth) setDeduction('PhilHealth', payroll.philhealth_deduction || payroll.philhealth);
    if (payroll.pagibig_deduction || payroll.pagibig) setDeduction('Pag-IBIG', payroll.pagibig_deduction || payroll.pagibig);
    if (payroll.tax_deduction || payroll.tax || payroll.withholding_tax) setDeduction('Withholding Tax', payroll.tax_deduction || payroll.tax || payroll.withholding_tax);

    // 2. Parse string remarks using Regex
    if (payroll.remarks) {
        const deductionRegex = /(SSS|PhilHealth|Pag-IBIG|PagIBIG|HDMF|IBIG|Tax|Withholding Tax|Late|Tardiness|Absence|Undertime):\s*₱?\s*([\d,]+(?:\.\d+)?)/gi;
        let match;
        while ((match = deductionRegex.exec(payroll.remarks)) !== null) {
            setDeduction(match[1], match[2]);
        }
    }

    // 3. Late & Absence deductions directly from object fields
    const lateAmt = Number(
        payroll.late_deductions ??
        payroll.late_deduction ??
        payroll.tardiness_deduction ??
        payroll.late_and_absence_deductions ??
        payroll.late_amount ??
        payroll.lates ??
        0
    );

    const absenceAmt = Number(
        payroll.absence_deductions ??
        payroll.absence_deduction ??
        payroll.absences ??
        payroll.absence_amount ??
        0
    );

    if (lateAmt > 0) setDeduction('Late / Tardiness', lateAmt);
    if (absenceAmt > 0) setDeduction('Absences / Undertime', absenceAmt);

    // 4. Optional loans / advances
    if (Number(payroll.loan || payroll.loans || 0) > 0) {
        setDeduction('Company Loan', Number(payroll.loan || payroll.loans));
    }
    if (Number(payroll.cash_advance || payroll.advances || 0) > 0) {
        setDeduction('Cash Advance', Number(payroll.cash_advance || payroll.advances));
    }

    const deductionsList = Array.from(deductionsMap.values());

    // Fallback if no itemized deductions but total deductions recorded
    if (deductionsList.length === 0 && Number(payroll.deductions || 0) > 0) {
        deductionsList.push({ name: 'Total Deductions', amount: Number(payroll.deductions) });
    }

    const totalDeductions = deductionsList.reduce((sum, item) => sum + item.amount, 0);
    
    // Calculate net pay with fallback to payroll.net_pay
    const calculatedNet = grossEarnings - totalDeductions;
    const netPay = payroll.net_pay !== undefined && payroll.net_pay !== null && !isNaN(Number(payroll.net_pay))
        ? Number(payroll.net_pay)
        : calculatedNet;

    return {
        basicPay,
        overtimePay,
        holidayPay,
        paidHolidayItems,
        hasHolidayPay,
        grossEarnings,
        deductionsList,
        totalDeductions,
        netPay,
    };
};

export const formatCurrency = (amount) => {
    return '₱' + Number(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};
