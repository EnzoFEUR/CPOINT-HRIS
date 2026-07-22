import cron from 'node-cron';
import { supabase } from '../index.js';

// Schedule job to run every day at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Running daily missed punch check...');
    try {
        // Find attendance records that have a time_in but no time_out
        const { data, error } = await supabase
            .from('attendance')
            .select('id')
            .is('time_out', null);
            
        if (error) {
            console.error('[CRON] Error fetching active attendance records:', error);
            return;
        }
        
        if (data && data.length > 0) {
            const idsToUpdate = data.map(record => record.id);
            
            // Auto-close them and flag as Missed Punch
            const { error: updateError } = await supabase
                .from('attendance')
                .update({ 
                    status: 'Missed Punch',
                    notes: 'System auto-closed at midnight due to missing clock-out.'
                })
                .in('id', idsToUpdate);
                
            if (updateError) {
                console.error('[CRON] Error updating missed punches:', updateError);
            } else {
                console.log(`[CRON] Successfully marked ${data.length} records as Missed Punch.`);
            }
        } else {
            console.log('[CRON] No missed punches found. All employees successfully clocked out.');
        }
    } catch (err) {
        console.error('[CRON] Unexpected error in midnight cron job:', err);
    }
});

export default cron;
