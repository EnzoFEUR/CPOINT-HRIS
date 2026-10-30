const MAX_GAP_MS = 650;

const validBox = box => box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
const copyBox = box => ({ x: box.x, y: box.y, width: box.width, height: box.height });
const displacement = (a, b) => Math.hypot((a.x + a.width / 2) - (b.x + b.width / 2), (a.y + a.height / 2) - (b.y + b.height / 2));

// Geometry continuity complements identity checks; it is not identity or liveness proof.
export function trackFace(state, box, now) {
  if (!validBox(box) || !Number.isFinite(now) || (state.at != null && now <= state.at)) return false;
  const previous = state.box;
  const continuous = !previous || (now - state.at <= MAX_GAP_MS &&
    displacement(previous, box) <= Math.max(previous.width, previous.height) * .6 &&
    box.width / previous.width >= .6 && box.width / previous.width <= 1.67 &&
    box.height / previous.height >= .6 && box.height / previous.height <= 1.67);
  state.box = copyBox(box); state.at = now;
  return continuous;
}

export function resetCaptureHold(state) {
  Object.assign(state, { anchor: null, since: null, lastAt: null, samples: 0 });
}

export function updateCaptureHold(state, face, now) {
  if (!validBox(face?.box) || ![face?.yaw, face?.pitch, now].every(Number.isFinite)) {
    resetCaptureHold(state);
    return 0;
  }
  if (state.lastAt != null && now <= state.lastAt) return 0;
  const anchor = state.anchor;
  const stable = anchor && now - state.lastAt <= MAX_GAP_MS &&
    displacement(anchor.box, face.box) <= anchor.box.width * .1 &&
    Math.abs(face.box.width / anchor.box.width - 1) <= .1 && Math.abs(face.box.height / anchor.box.height - 1) <= .1 &&
    Math.abs(face.yaw - anchor.yaw) <= .06 && Math.abs(face.pitch - anchor.pitch) <= .06;
  if (!stable) {
    state.anchor = { box: copyBox(face.box), yaw: face.yaw, pitch: face.pitch };
    state.since = now; state.samples = 0;
  }
  state.lastAt = now; state.samples++;
  // Require observed stability after liveness, not a timeout that can outlive the face.
  return Math.min((now - state.since) / 400, state.samples / 3, 1);
}
