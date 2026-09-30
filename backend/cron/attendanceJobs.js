import cron from 'node-cron';
import { supabase } from '../supabaseClient.js';

// Enterprise Midnight & Shift-Cycle Auto-Close Cron Job
// Configured strictly with Asia/Manila timezone to ensure accurate scheduling across cloud environments
cron.schedule('0 0,12 * * *', async () => {
    const manilaTimestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' });
    console.log(`[CRON] [${manilaTimestamp}] Running shift attendance reconciliation check...`);
    try {
        // Safe Threshold: Auto-close only unclosed shifts that started more than 14 hours ago.
        // This guarantees active graveyard/night shift workers (e.g., 10 PM - 6 AM or 8 PM - 5 AM)
        // are NEVER prematurely closed at midnight while actively on shift.
        const cutoffTime = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('attendances')
            .select('id, employee_id, date, time_in')
            .is('time_out', null)
            .lte('time_in', cutoffTime);
            
        if (error) {
            console.error('[CRON] Error fetching abandoned attendance records:', error);
            return;
        }
        
        if (data && data.length > 0) {
            const idsToUpdate = data.map(record => record.id);
            
            // Auto-close them and flag as Missed Punch
            const { error: updateError } = await supabase
                .from('attendances')
                .update({ 
                    status: 'Missed Punch',
                    notes: 'System auto-reconciled: Unpunched clock-out after shift cutoff (>14h active window).',
                    updated_at: new Date().toISOString()
                })
                .in('id', idsToUpdate);
                
            if (updateError) {
                console.error('[CRON] Error updating abandoned punches:', updateError);
            } else {
                console.log(`[CRON] Successfully marked ${data.length} abandoned record(s) as Missed Punch.`);
            }
        } else {
            console.log('[CRON] No abandoned punches found. Active shifts preserved.');
        }
    } catch (err) {
        console.error('[CRON] Unexpected error in attendance reconciliation cron job:', err);
    }
}, {
    timezone: 'Asia/Manila'
});

export default cron;

