export const reviewEventId = event => event.review_pair?.review_event_id || event.event_id || event.payload?.event_id;

export function reviewCanDecide(event, decision) {
  return ['needs_review', 'needs_verification'].includes(event.status) && event.review_pair?.complete === true && event.review_pair[`can_${decision}`] === true;
}

export function collapseOfflineReviewEvents(events) {
  const pairs = new Map();
  for (const event of events) {
    const id = reviewEventId(event);
    if (!pairs.has(id) || (event.event_id || event.payload?.event_id) === id) pairs.set(id, event);
  }
  return [...pairs.values()];
}
