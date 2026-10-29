export const BLINK_PROMPTS = Object.freeze({
  CALIBRATING: 'Keep both eyes open', OPEN: 'Keep both eyes open',
  ARMED: 'Close both eyes for about half a second, then open', CLOSING: 'Close both eyes for about half a second, then open', CLOSED: 'Open both eyes',
  REOPEN: 'Keep both eyes open', PASSED: 'Blink confirmed',
});

export function createBlinkState() {
  return resetBlinkCycle({ baseline: null });
}

export function resetBlinkCycle(state) {
  Object.assign(state, {
    phase: state.baseline ? 'OPEN' : 'CALIBRATING', samples: [], lastAt: null,
    openSince: null, openSamples: 0, lastOpenAt: null, closedAt: null,
    reopenedAt: null, reopenedSamples: 0, reopenMisses: 0, closedSamples: 0, openCalibration: null, count: 0,
  });
  return state;
}

export function getEyeOpenness(landmarks) {
  const points = landmarks?.positions;
  if (!points || points.length < 68) return null;
  const ratios = [];
  for (const start of [36, 42]) {
    const eye = points.slice(start, start + 6);
    if (!eye.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return null;
    const distance = (a, b) => Math.hypot(eye[a].x - eye[b].x, eye[a].y - eye[b].y);
    const width = distance(0, 3);
    if (!Number.isFinite(width) || width < 8) return null;
    const ratio = (distance(1, 5) + distance(2, 4)) / (2 * width);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > .8) return null;
    ratios.push(ratio);
  }
  const [left, right] = ratios;
  return { left, right, mean: (left + right) / 2 };
}

function acceptSample(state, eyes, now) {
  if (!eyes || ![eyes.left, eyes.right].every(value => Number.isFinite(value) && value >= 0 && value <= .8) || !Number.isFinite(now)) {
    resetBlinkCycle(state);
    return false;
  }
  if (state.lastAt !== null && now <= state.lastAt) {
    if (now < state.lastAt) resetBlinkCycle(state);
    return false;
  }
  if (state.lastAt !== null && now - state.lastAt > 650) resetBlinkCycle(state);
  state.lastAt = now;
  return true;
}

export function calibrateBlink(state, eyes, now) {
  if (!acceptSample(state, eyes, now)) return false;
  if (state.baseline) return true;
  if ([eyes.left, eyes.right].some(value => value < .14 || value > .55)) {
    state.samples = [];
    return false;
  }
  const previous = state.samples.at(-1);
  if (previous && now - previous.at < 60) return false;
  state.samples.push({ left: eyes.left, right: eyes.right, at: now });
  if (state.samples.length > 5) state.samples.shift();
  if (state.samples.length < 5 || now - state.samples[0].at < 240) return false;
  const baseline = {};
  for (const side of ['left', 'right']) {
    const sorted = state.samples.map(sample => sample[side]).sort((a, b) => a - b);
    if (sorted.at(-1) / sorted[0] > 1.3) return false;
    baseline[side] = sorted[2];
  }
  state.baseline = baseline;
  resetBlinkCycle(state);
  return true;
}

export function areEyesOpen(state, eyes) {
  return Boolean(state?.baseline && eyes && [eyes.left, eyes.right].every(Number.isFinite) &&
    eyes.left >= state.baseline.left * .84 && eyes.right >= state.baseline.right * .84);
}

// Require stable open eyes, substantial bilateral closure, then confirmed reopening.
export function updateBlink(state, eyes, now) {
  if (!acceptSample(state, eyes, now) || !state.baseline || state.phase === 'PASSED') return state;
  // Refresh only from stable bilateral increases before closure; closed eyes cannot train the open reference.
  if (['OPEN', 'ARMED'].includes(state.phase) && eyes.left >= state.baseline.left * 1.2 && eyes.right >= state.baseline.right * 1.2) {
    state.openCalibration ||= createBlinkState();
    if (calibrateBlink(state.openCalibration, eyes, now)) {
      state.baseline = state.openCalibration.baseline;
      resetBlinkCycle(state);
      state.lastAt = now;
    }
    return state;
  }
  state.openCalibration = null;
  const wink = (eyes.left <= state.baseline.left * .58 && eyes.right >= state.baseline.right * .85)
    || (eyes.right <= state.baseline.right * .58 && eyes.left >= state.baseline.left * .85);
  if (wink) { resetBlinkCycle(state); return state; }

  // An absolute cutoff can classify a person's accepted open baseline as closed.
  const closed = eyes.left <= state.baseline.left * .70 && eyes.right <= state.baseline.right * .70;

  // Moderate closure: start of eyelid closure or soft voluntary blink
  const closing = eyes.left <= state.baseline.left * .82 && eyes.right <= state.baseline.right * .82;

  // Clear open state: mutually exclusive with closing / closed
  const open = areEyesOpen(state, eyes);

  if (state.phase === 'OPEN') {
    if (open) {
      state.openSince ??= now;
      state.openSamples++;
      state.lastOpenAt = now;
      if (state.openSamples >= 3 && now - state.openSince >= 160) state.phase = 'ARMED';
    } else { state.openSince = null; state.openSamples = 0; }
  } else if (state.phase === 'ARMED') {
    if (open) state.lastOpenAt = now;
    else if (closed && now - state.lastOpenAt <= 1000) { state.phase = 'CLOSED'; state.closedAt = now; }
    else if (closing && now - state.lastOpenAt <= 1000) {
      state.phase = 'CLOSING'; state.closedAt = now; state.closedSamples = 1;
    }
    else if (now - state.lastOpenAt > 1000) resetBlinkCycle(state);
  } else if (state.phase === 'CLOSING') {
    if (!closing || now - state.closedAt > 1100) resetBlinkCycle(state);
    else {
      state.closedSamples++;
      if (closed || (state.closedSamples >= 2 && now - state.closedAt >= 50)) state.phase = 'CLOSED';
    }
  } else if (state.phase === 'CLOSED') {
    if (now - state.closedAt > 1000) resetBlinkCycle(state);
    else if (open) {
      if (now - state.closedAt < 50) resetBlinkCycle(state);
      else { state.phase = 'REOPEN'; state.reopenedAt = now; state.reopenedSamples = 1; }
    }
  } else if (state.phase === 'REOPEN') {
    if (!open) {
      state.reopenMisses = (state.reopenMisses || 0) + 1;
      if (state.reopenMisses >= 2 || now - state.reopenedAt > 800) resetBlinkCycle(state);
    } else {
      state.reopenMisses = 0;
      state.reopenedSamples++;
      if (state.reopenedSamples >= 2 && now - state.reopenedAt >= 50) {
        state.phase = 'PASSED'; state.count = 1;
      }
    }
  }
  return state;
}
