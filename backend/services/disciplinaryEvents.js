import { supabase } from '../supabaseClient.js';
import { invalidateCache } from '../middleware/cacheMiddleware.js';
import { invalidateAuthUser } from '../middleware/authMiddleware.js';

// Real-time high-throughput broadcast bus (Persistent singleton socket connection)
let realtimeSyncChannel = null;
function getRealtimeChannel() {
    if (!realtimeSyncChannel) {
        realtimeSyncChannel = supabase.channel('disciplinary_realtime_sync');
        realtimeSyncChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[REALTIME_SYNC] Disciplinary broadcast channel active.');
            }
        });
    }
    return realtimeSyncChannel;
}


// Dispatch after commit without holding up the HTTP response.
// These are existing channel topics; audience authorization is configured in Supabase.
const dynamicChannelPool = new Map();
function getChannelForTopic(topic) {
    if (topic === 'disciplinary_realtime_sync') return getRealtimeChannel();
    let ch = dynamicChannelPool.get(topic);
    if (!ch) {
        ch = supabase.channel(topic);
        ch.subscribe();
        dynamicChannelPool.set(topic, ch);
        if (dynamicChannelPool.size > 100) {
            const oldestKey = dynamicChannelPool.keys().next().value;
            try { supabase.removeChannel(dynamicChannelPool.get(oldestKey)); } catch (_) {}
            dynamicChannelPool.delete(oldestKey);
        }
    }
    return ch;
}

export function broadcastDisciplinaryUpdate(event, payload = {}) {
    const timestamp = new Date().toISOString();
    const enrichedPayload = { ...payload, broadcast_timestamp: timestamp };

    const targetTopics = [
        'disciplinary_realtime_sync',
        'disciplinary-updates',
        'admin-live-employees-directory',
        'scanner_disciplinary_realtime'
    ];

    const empId = payload.employee_id || payload.employeeId;
    if (empId) {
        invalidateAuthUser(empId);
        targetTopics.push(
            `dashboard-disciplinary-sync-${empId}`,
            `employee-live-dashboard-${empId}`,
            `myprofile-realtime-${empId}`,
            `qr-disciplinary-sync-${empId}`,
            `qr-realtime-${empId}`
        );
    }

    // Concurrent non-blocking dispatch across all target channels
    targetTopics.forEach(topic => {
        try {
            const ch = getChannelForTopic(topic);
            ch.send({
                type: 'broadcast',
                event,
                payload: enrichedPayload
            }).catch(() => {});
        } catch (_) {}
    });
}

export function publishCommittedDisciplinary(result) {
    if (result.replayed) return;
    const record = result.record, source = result.employee;
    const employee = Object.fromEntries(['id','company_id','first_name','last_name','department','job_title','status','is_active','biometric_baseline_path'].map(key => [key, source[key]]));
    invalidateAuthUser(employee.id);
    invalidateCache(['/api/disciplinary','/api/dashboard','/api/employees','/api/attendance','/api/profile','/api/notifications']);
    const payload = { id: record.id, employee_id: employee.id, record: { ...record, employees: employee }, employees: employee,
        status: record.status, employee_status: employee.status, employee_is_active: employee.is_active, company_id: employee.company_id };
    const events = { issue: 'DISCIPLINARY_CREATED', status: 'DISCIPLINARY_STATUS_UPDATED', resolve: 'DISCIPLINARY_RESOLVED',
        expire: 'DISCIPLINARY_RESOLVED', overturn: 'DISCIPLINARY_OVERTURNED', acknowledge: 'DISCIPLINARY_STATUS_UPDATED', delete: 'DISCIPLINARY_DELETED' };
    const event = ['resolve','expire','overturn'].includes(result.action) && !result.employment_restored ? 'DISCIPLINARY_STATUS_UPDATED' : events[result.action];
    broadcastDisciplinaryUpdate(event, payload);
    if (result.employment_restored) broadcastDisciplinaryUpdate('EMPLOYEE_RESTORED', { ...payload, status: employee.status, is_active: employee.is_active });
    if (result.action === 'issue' && record.type === 'Suspension' && employee.status === 'suspended') broadcastDisciplinaryUpdate('EMPLOYEE_SUSPENDED', { ...payload, status: employee.status, is_active: false, is_suspended: true, operational_status: 'Suspended' });
    if (result.action === 'issue' && record.type === 'Termination') broadcastDisciplinaryUpdate('EMPLOYEE_TERMINATED', { ...payload, status: employee.status, is_active: false, is_terminated: true, operational_status: 'Terminated' });
}
