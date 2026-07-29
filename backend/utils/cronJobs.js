import cron from 'node-cron';
import { supabase } from '../supabaseClient.js';

/**
 * Initializes all Enterprise Cron Jobs for Background Data Management.
 */
export const startCronJobs = () => {
    // -------------------------------------------------------------------------
    // ORPHAN NOTIFICATION CLEANUP (DATA TIERING / TTL)
    // -------------------------------------------------------------------------
    // Runs every day exactly at Midnight (00:00) server time.
    // Deletes all notifications older than 90 days to prevent DB bloat.
    cron.schedule('0 0 * * *', async () => {
        console.log('[CRON] Initiating Enterprise Data Tiering: Notification Cleanup...');
        try {
            // Calculate the exact date 90 days ago
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const cutoffDateStr = ninetyDaysAgo.toISOString();

            // Perform a bulk delete on Supabase for old records
            const { data, error, count } = await supabase
                .from('notifications')
                .delete({ count: 'exact' })
                .lt('created_at', cutoffDateStr);

            if (error) {
                console.error('[CRON_ERROR] Failed to purge old notifications:', error.message);
                return;
            }

            console.log(`[CRON_SUCCESS] Data Tiering Complete. Shredded ${count || 0} expired notifications (older than 90 days).`);
        } catch (err) {
            console.error('[CRON_ERROR] Unexpected error during notification cleanup:', err);
        }
    });

    console.log('[SYSTEM] Enterprise Cron Jobs Initialized and Scheduled.');
};
