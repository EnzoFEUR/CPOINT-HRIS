// Schedule after inference completes so slow devices never queue overlapping biometric work.
export function startVideoFrameLoop(video, analyze, { intervalMs = 100, onError = () => {} } = {}) {
  let stopped = false, handle = null, lastStarted = -Infinity, lastMediaTime = null;
  const frameCallbacks = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function';
  const isActive = () => !stopped && video.ownerDocument?.visibilityState !== 'hidden' && !video.paused;
  const stop = () => {
    stopped = true;
    if (handle !== null) {
      if (frameCallbacks) video.cancelVideoFrameCallback(handle);
      else clearTimeout(handle);
      handle = null;
    }
  };
  const schedule = (minimumDelay = 0) => {
    if (stopped) return;
    const delay = Math.max(minimumDelay, Number.isFinite(lastStarted) ? intervalMs - (performance.now() - lastStarted) : 0);
    handle = frameCallbacks ? video.requestVideoFrameCallback(tick) : setTimeout(() => tick(performance.now(), { mediaTime: video.currentTime }), delay);
  };
  async function tick(now, metadata) {
    handle = null;
    if (stopped) return;
    const mediaTime = metadata.mediaTime;
    if (video.ownerDocument?.visibilityState === 'hidden' || video.paused || video.readyState < 2 || !video.videoWidth || !video.videoHeight ||
        mediaTime === lastMediaTime || now - lastStarted < intervalMs) { schedule(intervalMs); return; }
    lastStarted = now;
    lastMediaTime = mediaTime;
    try { await analyze(isActive); }
    catch (error) { if (!stopped) { stop(); onError(error); } }
    finally { schedule(); }
  }
  schedule();
  return { stop };
}

export function copyVideoFrame(video, canvas = null) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
  canvas ||= video.ownerDocument.createElement('canvas');
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function captureVideoFrame(video) {
  return copyVideoFrame(video)?.toDataURL('image/jpeg', 0.9) || null;
}
