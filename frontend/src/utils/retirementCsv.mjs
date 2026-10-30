export function retirementCsv(records) {
    const cell = (value) => {
        let text = String(value ?? '');
        if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
    };
    const rows = [
        [
            'Settlement ID',
            'Employee ID',
            'Employee',
            'Hire date',
            'Retirement date',
            'Status',
            'Daily rate',
            'Credited years',
            'Statutory gross PHP',
            'Tax withheld PHP',
            'Net recorded PHP',
            'Payment date',
            'Payment reference',
        ],
    ];
    for (const record of records) {
        const employee = record.employee_snapshot;
        rows.push([
            record.id,
            employee.company_id,
            [employee.first_name, employee.last_name].filter(Boolean).join(' '),
            record.employment_start,
            record.retirement_date,
            record.status,
            record.calculation.daily_rate,
            record.calculation.credited_years,
            record.calculation.statutory_gross,
            record.tax_withheld,
            record.net_paid,
            record.payment_date,
            record.payment_reference,
        ]);
    }
    return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
