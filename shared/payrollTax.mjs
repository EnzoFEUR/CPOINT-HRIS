const toSafeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
export const calculateBIRWithholdingTax = (taxableIncome, frequency = 'weekly') => {
    const taxable = Math.max(0, toSafeNumber(taxableIncome));

    if (frequency === 'weekly') {
        // BIR Revised Withholding Tax Table - WEEKLY
        // Bracket 1: <= ₱4,807.69 (Annual <= P250,000 / 52) -> 0% Tax
        if (taxable <= 4807.69) return 0;
        // Bracket 2: ₱4,807.70 to ₱7,692.30 -> 15% of excess over ₱4,807.69
        if (taxable <= 7692.30) return round2((taxable - 4807.69) * 0.15);
        // Bracket 3: ₱7,692.31 to ₱15,384.61 -> ₱432.69 + 20% of excess over ₱7,692.31
        if (taxable <= 15384.61) return round2(432.69 + (taxable - 7692.31) * 0.20);
        // Bracket 4: ₱15,384.62 to ₱38,461.53 -> ₱1,971.15 + 25% of excess over ₱15,384.62
        if (taxable <= 38461.53) return round2(1971.15 + (taxable - 15384.62) * 0.25);
        // Bracket 5: ₱38,461.54 to ₱153,846.15 -> ₱7,740.38 + 30% of excess over ₱38,461.54
        if (taxable <= 153846.15) return round2(7740.38 + (taxable - 38461.54) * 0.30);
        // Bracket 6: > ₱153,846.15 -> ₱42,355.77 + 35% of excess over ₱153,846.15
        return round2(42355.77 + (taxable - 153846.15) * 0.35);
    } else if (frequency === 'semi-monthly') {
        // BIR Revised Withholding Tax Table - SEMI-MONTHLY
        if (taxable <= 10416.67) return 0;
        if (taxable <= 16666.67) return round2((taxable - 10416.67) * 0.15);
        if (taxable <= 33333.33) return round2(937.50 + (taxable - 16666.67) * 0.20);
        if (taxable <= 83333.33) return round2(4270.83 + (taxable - 33333.33) * 0.25);
        if (taxable <= 333333.33) return round2(16770.83 + (taxable - 83333.33) * 0.30);
        return round2(91770.83 + (taxable - 333333.33) * 0.35);
    } else {
        // BIR Revised Withholding Tax Table - MONTHLY
        if (taxable <= 20833.33) return 0;
        if (taxable <= 33333.33) return round2((taxable - 20833.33) * 0.15);
        if (taxable <= 66666.67) return round2(1875.00 + (taxable - 33333.33) * 0.20);
        if (taxable <= 166666.67) return round2(8541.67 + (taxable - 66666.67) * 0.25);
        if (taxable <= 666666.67) return round2(33541.67 + (taxable - 166666.67) * 0.30);
        return round2(183541.67 + (taxable - 666666.67) * 0.35);
    }
};

