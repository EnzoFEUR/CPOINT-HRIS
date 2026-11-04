import { ATTENDANCE_ACTIVITY_TOPIC, ATTENDANCE_ACTIVITY_EVENT, isAttendanceActivity } from '../../shared/attendanceActivity.mjs';

export function createAttendanceActivityPublisher(client, warn = () => console.warn('[ATTENDANCE_ACTIVITY] Activity broadcast unavailable; saved attendance is unaffected.')) {
    let channel;
    let lastWarning = 0;
    const reportFailure = () => {
        if (Date.now() - lastWarning >= 30000) { lastWarning = Date.now(); warn(); }
    };
    return (employee, action, occurredAt) => {
        const payload = {
            version: 1,
            event_id: `${employee?.id}:${action}:${occurredAt}`,
            employee_id: employee?.id,
            name: [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160),
            action,
            occurred_at: occurredAt,
            published_at: new Date().toISOString(),
        };
        if (!isAttendanceActivity(payload)) return;
        try {
            channel ||= client.channel(ATTENDANCE_ACTIVITY_TOPIC, { config: { private: true } });
            // Transient activity is best effort; never delay or roll back a committed punch.
            Promise.resolve(channel.httpSend(ATTENDANCE_ACTIVITY_EVENT, payload, { timeout: 2000 }))
                .then(result => { if (!result?.success) reportFailure(); })
                .catch(reportFailure);
        } catch { reportFailure(); }
    };
}
