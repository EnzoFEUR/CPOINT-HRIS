export function getFactoryPayReasons(item, preview = {}) {
    const reasons = [];
    const add = (kind, label) => { if (!reasons.some(r => r.kind === kind && r.label === label)) reasons.push({kind, label}); };
    if (item.paidLeavePay > 0) {
        for (const leave of preview.leaves || []) {
            if (leave.is_paid && !['Maternity Leave', 'Paternity Leave'].includes(leave.type)) add('leave', leave.type || 'Paid leave');
        }
        if (!reasons.length) add('leave', 'Paid leave');
    }
    if (item.statutory?.maternity_sss_pay > 0 || item.statutory?.maternity_salary_differential > 0) add('statutory', 'Maternity Leave');
    if (item.statutory?.paternity_additional_pay > 0) add('statutory', 'Paternity Leave');
    if (item.silCashPay > 0) add('sil', 'SIL cash-out');
    if (item.holidayPay > 0) add('holiday', 'Holiday pay');
    if (item.thirteenthMonthPay > 0) add('thirteenth', '13th month');
    return reasons;
}
