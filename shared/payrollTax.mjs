import {getWithholdingTableError,getWithholdingTableVersionError} from './statutorySettings.mjs';
import {isLeaveDate} from './leaveCredits.mjs';
const toSafeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;

const makeTable = rows => Object.freeze(rows.map(([over, base, rate]) => Object.freeze({ over, base, rate })));

// BIR Revised Withholding Tax Tables, effective Jan 1, 2023 onwards (RA 10963 / TRAIN Law).
// Each bracket reads: tax = base + (taxable income - over) x rate%, using the highest bracket whose "over" is reached.
// These are only the built-in defaults. HR can save newer versions with an effective date in Statutory Settings.
export const DEFAULT_WITHHOLDING_TABLES = Object.freeze({
    weekly: makeTable([
        [0, 0, 0],
        [4808, 0, 15],
        [7692, 432.60, 20],
        [15385, 1971.20, 25],
        [38462, 7740.45, 30],
        [153846, 42355.65, 35],
    ]),
    'semi-monthly': makeTable([
        [0, 0, 0],
        [10417, 0, 15],
        [16667, 937.50, 20],
        [33333, 4270.70, 25],
        [83333, 16770.70, 30],
        [333333, 91770.70, 35],
    ]),
    monthly: makeTable([
        [0, 0, 0],
        [20833, 0, 15],
        [33333, 1875.00, 20],
        [66667, 8541.80, 25],
        [166667, 33541.80, 30],
        [666667, 183541.80, 35],
    ]),
});

const resolveTable = table => {
    if (Array.isArray(table)) {
        const error = getWithholdingTableError(table);
        if (error) throw new Error(error);
        return table;
    }
    return DEFAULT_WITHHOLDING_TABLES[table] ?? DEFAULT_WITHHOLDING_TABLES.monthly;
};

// Picks the saved table version in force on `asOfDate` (YYYY-MM-DD, normally the payroll period end).
// Falls back to the built-in BIR table when HR has not saved a version that has taken effect.
export const pickWithholdingTable = (versions, frequency, asOfDate) => {
    const asOf = String(asOfDate || '').slice(0, 10);
    if (!isLeaveDate(asOf)) throw new Error('Choose a valid tax calculation date.');
    let best = null;
    for (const version of versions || []) {
        const error = getWithholdingTableVersionError(version);
        if (error) throw new Error('Invalid saved withholding table: ' + error);
        const effectiveFrom = String(version?.effective_from || '').slice(0, 10);
        if (version?.frequency !== frequency || !Array.isArray(version.brackets) || !version.brackets.length) continue;
        if (!asOf || effectiveFrom > asOf) continue;
        if (!best || effectiveFrom > String(best.effective_from).slice(0, 10)) best = version;
    }
    return best ? best.brackets : resolveTable(frequency);
};

// `table` is a list of { over, base, rate } brackets, or a frequency name ('weekly' | 'semi-monthly' | 'monthly')
// to use the built-in table. Brackets are checked from the highest threshold down so nothing drops through.
export const calculateBIRWithholdingTax = (taxableIncome, table = 'weekly') => {
    const taxable = Math.max(0, toSafeNumber(taxableIncome));
    if (!Number.isSafeInteger(Math.round(taxable * 100))) throw new Error('Taxable income exceeds the supported range.');
    const brackets = [...resolveTable(table)].sort((a, b) => Number(b.over) - Number(a.over));

    for (const bracket of brackets) {
        const over = toSafeNumber(bracket.over);
        if (taxable >= over) {
            const excess = BigInt(Math.round(taxable * 100)) - BigInt(Math.round(over * 100));
            const numerator = excess * BigInt(Math.round(Number(bracket.rate) * 100));
            return Number(BigInt(Math.round(Number(bracket.base) * 100)) + (numerator + 5000n) / 10000n) / 100;
        }
    }
    return 0;
};
