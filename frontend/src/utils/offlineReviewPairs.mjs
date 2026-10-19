export const reviewEventId = event => event.review_pair?.review_event_id || event.event_id || event.payload?.event_id;

export function reviewCanDecide(event, decision) {
  return ['needs_review', 'needs_verification'].includes(event.status) && event.review_pair?.complete === true && event.review_pair[`can_${decision}`] === true;
}

export function canResolveMissingTimeOut(event) {
  return ['needs_review', 'needs_verification', 'synced'].includes(event.status)
    && (event.payload?.action || event.action) === 'TIME_IN'
    && event.review_pair?.complete === false && event.review_pair.issue === 'Missing Time Out';
}

export function manilaDateTimeInput(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 480 * 60000).toISOString().slice(0, 16) : '';
}

export function verifiedTimeOutIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a valid verified Time Out in Philippine time.');
  const timestamp = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(timestamp) || manilaDateTimeInput(new Date(timestamp).toISOString()) !== value) throw new Error('Enter a valid verified Time Out in Philippine time.');
  return new Date(timestamp).toISOString();
}

export function batchReviewOutcome(eventIds, decision, results) {
  const ids = new Set(eventIds);
  const expected = { approve: 'synced', reject: 'rejected', needs_verification: 'needs_verification' }[decision];
  if (!expected || !Array.isArray(results) || results.length !== ids.size || !ids.size || ids.size !== eventIds.length) throw new Error('The server did not confirm all selected captures. Refresh before retrying.');
  const seen = new Set();
  const successfulIds = [], failedIds = [];
  let error = null;
  for (const result of results) {
    if (!result || !ids.has(result.event_id) || seen.has(result.event_id)) throw new Error('The server did not confirm all selected captures. Refresh before retrying.');
    seen.add(result.event_id);
    if (result.success === true && result.status === expected) successfulIds.push(result.event_id);
    else {
      failedIds.push(result.event_id);
      error ||= typeof result.error === 'string' ? result.error : 'The server did not confirm the requested attendance status.';
    }
  }
  return { successfulIds, failedIds, error };
}

export function collapseOfflineReviewEvents(events) {
  const pairs = new Map();
  for (const event of events) {
    const id = reviewEventId(event);
    if (!pairs.has(id) || (event.event_id || event.payload?.event_id) === id) pairs.set(id, event);
  }
  return [...pairs.values()];
}
