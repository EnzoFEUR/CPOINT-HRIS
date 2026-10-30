import { readBoundFace } from './blinkExpression.mjs';

// Observed contour indices from MediaPipe's face topology; never the face-api 68-point layout.
const CONTOURS = [
  [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10],
  [70,63,105,66,107], [336,296,334,293,300],
  [33,160,158,133,153,144,33], [362,385,387,263,373,380,362],
  [168,6,197,195,5,4,1,2],
  [61,40,37,0,267,270,291,321,314,17,84,91,61], [78,81,13,311,308,402,14,178,78],
];
const DOTS = [...new Set(CONTOURS.flat())];

function readPose(matrix) {
  if (matrix?.length !== 16 || !Array.from(matrix).every(Number.isFinite) ||
      Math.abs(matrix[15] - 1) > .001 || [3, 7, 11].some(i => Math.abs(matrix[i]) > .001)) return null;
  // MatrixData is column-major. Remove uniform fit scale before extracting Y-X-Z rotation.
  const axes = [0, 4, 8].map(i => [matrix[i], matrix[i + 1], matrix[i + 2]]);
  const scales = axes.map(axis => Math.hypot(...axis));
  if (Math.min(...scales) < 1e-6 || Math.max(...scales) / Math.min(...scales) > 1.1) return null;
  const [x, y, z] = axes.map((axis, i) => axis.map(value => value / scales[i]));
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const determinant = x[0] * (y[1] * z[2] - y[2] * z[1])
    - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  if ([dot(x, y), dot(x, z), dot(y, z)].some(value => Math.abs(value) > .05) || determinant < .9) return null;
  return {
    yaw: Math.atan2(z[0], z[2]),
    pitch: Math.atan2(-z[1], Math.hypot(z[0], z[2])),
    roll: -Math.atan2(x[1], y[1]),
  };
}

// Identity, eyes and geometry must describe the same frozen frame, but have distinct readiness gates.
export function readTrackedFace(result, identityBox, width, height) {
  const face = readBoundFace(result, identityBox, width, height);
  const packed = face?.landmarks;
  if (packed?.length !== 956) return null;
  const pose = readPose(face.matrix);
  if (!pose) return null;
  const points = new Float32Array(packed.length);
  for (let i = 0; i < packed.length; i++) {
    const value = packed[i];
    if (!Number.isFinite(value) || value < -.5 || value > 1.5) return null;
    points[i] = value * (i % 2 ? height : width);
  }
  return {
    points, pose,
    box: { x: face.box.x * width, y: face.box.y * height, width: face.box.width * width, height: face.box.height * height },
  };
}

export function drawTrackedFace(ctx, tracked, color, locked = false) {
  if (!tracked) return;
  const { points, box } = tracked;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = locked ? 1.8 : 1;
  ctx.globalAlpha = .7;
  for (const contour of CONTOURS) {
    ctx.beginPath();
    ctx.moveTo(points[contour[0] * 2], points[contour[0] * 2 + 1]);
    for (let j = 1; j < contour.length; j++) {
      const i = contour[j];
      ctx.lineTo(points[i * 2], points[i * 2 + 1]);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const i of DOTS) {
    ctx.beginPath();
    ctx.arc(points[i * 2], points[i * 2 + 1], locked ? 2.2 : 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const { x, y, width: w, height: h } = box;
  const cl = Math.min(28, w * .15);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
  ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl);
  ctx.moveTo(x + w, y + h - cl); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cl, y + h);
  ctx.moveTo(x + cl, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cl);
  ctx.stroke();
  const noseX = points[2], noseY = points[3];
  const tipX = noseX + Math.sin(tracked.pose.yaw) * 70;
  const tipY = noseY + Math.sin(tracked.pose.pitch) * 70;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(noseX, noseY); ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
