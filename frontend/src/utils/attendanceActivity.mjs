import { ATTENDANCE_ACTIVITY_TOPIC, ATTENDANCE_ACTIVITY_EVENT, isAttendanceActivity } from '../../../shared/attendanceActivity.mjs';

export function subscribeAttendanceActivity({ client, onActivity, onRefresh, canNotify }) {
    const seen = new Set();
    let timer, batch, stopped = false, lastFlush = 0;
    const clear = () => { clearTimeout(timer); timer = undefined; batch = undefined; };
    const flush = () => {
        const current = batch;
        clear();
        if (stopped || !current) return;
        lastFlush = Date.now();
        onRefresh();
        if (!current.silent && canNotify() && Date.now() - Date.parse(current.latest.published_at) <= 30000) onActivity(current);
    };
    const channel = client.channel(ATTENDANCE_ACTIVITY_TOPIC, { config: { private: true } })
        .on('broadcast', { event: ATTENDANCE_ACTIVITY_EVENT }, ({ payload }) => {
            if (stopped || !isAttendanceActivity(payload) || seen.has(payload.event_id)) return;
            const age = Date.now() - Date.parse(payload.published_at);
            const delay = Date.parse(payload.published_at) - Date.parse(payload.occurred_at);
            if (age < -10000 || age > 30000 || delay < 0 || delay > 30000) return;
            seen.add(payload.event_id);
            if (seen.size > 512) seen.delete(seen.values().next().value);
            batch ||= { count: 0, timeIn: 0, timeOut: 0, latest: payload };
            batch.count++;
            batch[payload.action === 'TIME_IN' ? 'timeIn' : 'timeOut']++;
            if (Date.parse(payload.occurred_at) >= Date.parse(batch.latest.occurred_at)) batch.latest = payload;
            if (!canNotify()) batch.silent = true;
            if (timer === undefined) timer = setTimeout(flush, Math.max(600, 5000 - (Date.now() - lastFlush)));
        })
        .subscribe(status => {
            if (stopped) return;
            if (status === 'SUBSCRIBED') onRefresh();
            else clear();
        });
    return () => {
        stopped = true;
        clear();
        void client.removeChannel(channel);
    };
}
