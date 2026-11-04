export const ATTENDANCE_ACTIVITY_TOPIC = 'attendance-activity';
export const ATTENDANCE_ACTIVITY_EVENT = 'ATTENDANCE_RECORDED';

export function isAttendanceActivity(event) {
    return event?.version === 1
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.employee_id)
        && ['TIME_IN', 'TIME_OUT'].includes(event.action)
        && typeof event.name === 'string' && event.name.trim().length > 0 && event.name.length <= 160
        && typeof event.occurred_at === 'string' && Number.isFinite(Date.parse(event.occurred_at))
        && typeof event.published_at === 'string' && Number.isFinite(Date.parse(event.published_at))
        && event.event_id === `${event.employee_id}:${event.action}:${event.occurred_at}`;
}
