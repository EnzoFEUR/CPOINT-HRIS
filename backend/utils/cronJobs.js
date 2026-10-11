import cron from 'node-cron';
import { supabase } from '../supabaseClient.js';
import { isMissingCreditSchema } from '../routes/leaves.js';

// Background cron jobs
export const startCronJobs = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const { error } = await supabase.rpc('accrue_due_sil_credits');
            if (error && !isMissingCreditSchema(error)) console.error('[cron] SIL accrual failed:', error.code || 'UNKNOWN');
        } catch (error) { console.error('[cron] SIL accrual failed:', error.code || 'UNKNOWN'); }
    }, { timezone: 'Asia/Manila', noOverlap: true });
    cron.schedule('*/5 * * * *', async () => {
        try {
            const { error } = await supabase.rpc('review_due_sil_obligations');
            if (error && !isMissingCreditSchema(error)) console.error('[cron] SIL obligation review failed:', error.code || 'UNKNOWN');
        } catch (error) { console.error('[cron] SIL obligation review failed:', error.code || 'UNKNOWN'); }
    }, { timezone: 'Asia/Manila', noOverlap: true });
    // Delete notifications older than 90 days every midnight
    cron.schedule('0 0 * * *', async () => {
        try {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const cutoffDateStr = ninetyDaysAgo.toISOString();

            const { count, error } = await supabase
                .from('notifications')
                .delete({ count: 'exact' })
                .lt('created_at', cutoffDateStr);

            if (error) {
                console.error('[cron] Notification cleanup failed:', error.message);
                return;
            }

            if (count > 0) {
                console.log(`[cron] Cleaned up ${count} old notifications.`);
            }
        } catch (err) {
            console.error('[cron] Notification cleanup error:', err);
        }
    });

    console.log('[cron] Background jobs started.');
};
