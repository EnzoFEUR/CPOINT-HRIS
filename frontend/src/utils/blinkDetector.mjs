import { createMainThreadBlinkDetector } from './blinkMainThread.mjs';

export function createBlinkDetector({
  workerFactory,
  bitmapFactory = frame => createImageBitmap(frame),
  compatibilityFactory = createMainThreadBlinkDetector,
  timeoutMs = 8000,
} = {}) {
  if (!workerFactory && (typeof OffscreenCanvas !== 'function' || typeof Worker !== 'function' || typeof createImageBitmap !== 'function')) return createMainThreadBlinkDetector();
  const worker = workerFactory ? workerFactory() : new Worker(`${import.meta.env.BLINK_ASSET_BASE}/blink.worker.js`);
  let closed = false, pending = null, sequence = 0, initialized = false, compatibility = null;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Boot failures may arrive before the page has attached its own await.
  ready.catch(() => {});
  const failure = (message, code = 'BLINK_MODEL_UNAVAILABLE') => Object.assign(new Error(message), { code });
  const close = (error = failure('Blink detector closed.')) => {
    if (closed) return;
    closed = true;
    clearTimeout(bootTimer);
    worker.terminate();
    compatibility?.close();
    rejectReady(error);
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
  };
  const bootTimer = setTimeout(() => close(failure('Blink model initialization timed out. Reload to retry.')), 20000);
  worker.onerror = () => { if (!compatibility) close(failure('Blink model unavailable. Reload to retry.')); };
  worker.onmessageerror = worker.onerror;
  worker.onmessage = ({ data }) => {
    if (closed) return;
    if (data?.type === 'unsupported' && !initialized && !compatibility) {
      worker.terminate();
      compatibility = compatibilityFactory();
      compatibility.ready.then(() => {
        if (closed) return;
        initialized = true; clearTimeout(bootTimer); resolveReady();
      }).catch(() => close(failure('Blink model unavailable. Reload to retry.')));
      return;
    }
    if (data?.type === 'ready' && !initialized) {
      initialized = true; clearTimeout(bootTimer); resolveReady(); return;
    }
    if (data?.type === 'error') { close(failure('Blink model unavailable. Reload to retry.')); return; }
    if (data?.type !== 'result' || !pending || data.id !== pending.id) return;
    if (!data.result || !Array.isArray(data.result.faces)) { close(failure('Invalid blink model response.')); return; }
    const request = pending; pending = null;
    clearTimeout(request.timer);
    request.resolve(data.result);
  };
  return {
    ready, close,
    async analyze(frame) {
      if (closed) throw failure('Blink detector closed.');
      await ready;
      if (closed) throw failure('Blink detector closed.');
      if (compatibility) return compatibility.analyze(frame);
      if (pending) throw failure('Blink detector busy.');
      return new Promise((resolve, reject) => {
        const request = { id: ++sequence, resolve, reject, timer: null };
        pending = request;
        request.timer = setTimeout(() => close(failure('Blink processing timed out. Reload to retry.', 'BLINK_PROCESSING_TIMEOUT')), timeoutMs);
        Promise.resolve().then(() => bitmapFactory(frame)).then(bitmap => {
          if (closed || pending !== request) { bitmap.close(); return; }
          try { worker.postMessage({ type: 'analyze', id: request.id, timestamp: performance.now(), bitmap }, [bitmap]); }
          catch { bitmap.close(); close(failure('Blink processing unavailable. Reload to retry.')); }
        }).catch(() => close(failure('Camera frame unavailable for blink detection. Restart to retry.')));
      });
    },
  };
}
