import { summarizeBlinkResult } from './blinkExpression.mjs';

// Compatibility path for browsers without worker canvas support; never substitutes simulated eye readings.
export function createMainThreadBlinkDetector({ load = () => import('@mediapipe/tasks-vision'), base = import.meta.env.BLINK_ASSET_BASE, timeoutMs = 20000 } = {}) {
  let model, closed = false, busy = false, rejectReady;
  const error = message => Object.assign(new Error(message), { code: 'BLINK_MODEL_UNAVAILABLE' });
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); model?.close(); rejectReady(error('Blink detector closed.')); };
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    Promise.resolve().then(load).then(async ({ FilesetResolver, FaceLandmarker }) => {
      if (closed) return;
      const files = await FilesetResolver.forVisionTasks(base);
      if (closed) return;
      const result = await FaceLandmarker.createFromOptions(files, {
        canvas: document.createElement('canvas'),
        baseOptions: { modelAssetPath: `${base}/face-landmarker.task`, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true,
        minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
      });
      if (closed) { result.close(); return; }
      model = result; clearTimeout(timer); resolve();
    }).catch(() => { reject(error('Blink model unavailable. Reload to retry.')); close(); });
  });
  ready.catch(() => {});
  const timer = setTimeout(() => { rejectReady(error('Blink model initialization timed out. Reload to retry.')); close(); }, timeoutMs);
  return {
    ready, close,
    async analyze(frame) {
      await ready;
      if (closed) throw error('Blink detector closed.');
      if (busy) throw error('Blink detector busy.');
      busy = true;
      try {
        const start = performance.now();
        const result = model.detectForVideo(frame, start);
        return summarizeBlinkResult(result, performance.now() - start);
      } catch {
        close();
        throw error('Blink processing unavailable. Reload to retry.');
      } finally { busy = false; }
    },
  };
}
