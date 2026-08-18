import cron from 'node-cron';
import { supabase } from '../supabaseClient.js';

// Background cron jobs
export const startCronJobs = () => {
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
