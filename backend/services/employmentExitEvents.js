import { supabase } from '../supabaseClient.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { invalidateAuthUser } from '../middleware/authMiddleware.js';
const channels = new Map();
export function publishExitUpdate(employeeId, { separated = false } = {}) {
    invalidateCache([
        '/api/employment-exit',
        '/api/employees',
        '/api/dashboard',
        '/api/profile',
        '/api/retirement-pay',
        '/api/notifications',
    ]);
    if (separated) invalidateAuthUser(employeeId);
    for (const topic of [
        'employment-exit-hr',
        'employment-exit-' + employeeId,
    ]) {
        try {
            let channel = channels.get(topic);
            if (!channel) {
                channel = supabase.channel(topic, {
                    config: { private: true },
                });
                channels.set(topic, channel);
                if (channels.size > 50) {
                    const oldest = channels.keys().next().value;
                    supabase
                        .removeChannel(channels.get(oldest))
                        .catch(() => {});
                    channels.delete(oldest);
                }
            }
            channel
                .send(
                    {
                        type: 'broadcast',
                        event: 'EXIT_CHANGED',
                        payload: { changed: true },
                    },
                    { timeout: 3000 }
                )
                .then((status) => {
                    if (status !== 'ok')
                        console.warn(
                            '[EXIT_REALTIME] A refresh signal was not delivered.'
                        );
                })
                .catch(() =>
                    console.warn(
                        '[EXIT_REALTIME] A refresh signal was not delivered.'
                    )
                );
        } catch {
            console.warn('[EXIT_REALTIME] A refresh signal was not delivered.');
        }
    }
}
