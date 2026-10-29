// Classic worker: MediaPipe's WASM loader uses importScripts. No camera images leave this worker.
const base = new URL('.', self.location.href).href;
self.exports = {};
importScripts(`${base}vision_bundle.js`);
const vision = self.exports;
let detector;
const ready = (async () => {
  let canvas;
  try {
    canvas = new OffscreenCanvas(1, 1);
    if (!canvas.getContext('webgl2')) throw new Error('Worker WebGL unavailable');
  } catch { self.postMessage({ type: 'unsupported' }); return; }
  const files = await vision.FilesetResolver.forVisionTasks(base.slice(0, -1));
  detector = await vision.FaceLandmarker.createFromOptions(files, {
    canvas,
    baseOptions: { modelAssetPath: `${base}face-landmarker.task`, delegate: 'CPU' },
    runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true,
    minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
  });
  self.postMessage({ type: 'ready' });
})();
ready.catch(() => self.postMessage({ type: 'error' }));
self.onmessage = async ({ data }) => {
  if (data?.type !== 'analyze') return;
  const bitmap = data.bitmap;
  try {
    await ready;
    const start = performance.now();
    const result = detector.detectForVideo(bitmap, data.timestamp);
    self.postMessage({ type: 'result', id: data.id, result: summarizeBlinkResult(result, performance.now() - start) });
  } catch { self.postMessage({ type: 'error', id: data.id }); }
  finally { bitmap?.close(); }
};
import { summarizeBlinkResult } from './blinkExpression.mjs';
