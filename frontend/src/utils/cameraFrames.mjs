let activeAnalysis = null;

// Schedule after inference completes so slow devices never queue overlapping biometric work.
export function startVideoFrameLoop(video, analyze, { intervalMs = 100, onError = () => {} } = {}) {
  let stopped = false, handle = null, timer = null, inferenceTimer = null, scheduled = 0, frameVersion = 0;
  let lastStarted = -Infinity, lastMediaTime = null, lastVideoTime = null, lastPresented = null, lastDisplayed = null;
  let lastFreshAt = performance.now();
  let frameCallbacks = typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function';
  const document = video.ownerDocument;
  const track = video.srcObject?.getVideoTracks?.()[0];
  const isPlaying = () => document?.visibilityState !== 'hidden' && !video.paused;
  const invalidateFrame = () => { frameVersion++; };
  const interrupted = () => fail(Object.assign(new Error('Camera was interrupted. Restart to retry.'), { code: 'CAMERA_INTERRUPTED' }));
  const visibilityChanged = () => { if (document.visibilityState === 'hidden') interrupted(); };
  const stop = () => {
    stopped = true;
    scheduled++;
    if (handle !== null) video.cancelVideoFrameCallback(handle);
    handle = null;
    clearTimeout(timer);
    clearTimeout(inferenceTimer);
    document?.removeEventListener?.('visibilitychange', visibilityChanged);
    video.removeEventListener?.('pause', interrupted);
    video.removeEventListener?.('resize', invalidateFrame);
    track?.removeEventListener?.('ended', interrupted);
    track?.removeEventListener?.('mute', interrupted);
  };
  const fail = error => { if (!stopped) { stop(); onError(error); } };
  const watchInference = () => {
    inferenceTimer = setTimeout(() => {
      fail(Object.assign(new Error('Face processing timed out. Reload to retry.'), { code: 'FACE_PROCESSING_TIMEOUT' }));
    }, 10000);
  };
  const schedule = (minimumDelay = 0) => {
    if (stopped) return;
    const delay = Math.max(minimumDelay, Number.isFinite(lastStarted) ? intervalMs - (performance.now() - lastStarted) : 0);
    const request = ++scheduled;
    if (frameCallbacks) {
      handle = video.requestVideoFrameCallback((now, metadata) => {
        if (stopped || request !== scheduled) return;
        clearTimeout(timer);
        handle = null;
        void tick(now, metadata);
      });
      // Some camera/browser combinations stop callbacks while the video keeps playing.
      timer = setTimeout(() => {
        if (stopped || request !== scheduled) return;
        video.cancelVideoFrameCallback(handle);
        handle = null;
        frameCallbacks = false;
        void tick(performance.now(), { mediaTime: video.currentTime });
      }, Math.max(500, intervalMs * 4));
    } else {
      timer = setTimeout(() => {
        if (!stopped && request === scheduled) void tick(performance.now(), { mediaTime: video.currentTime });
      }, delay);
    }
  };
  async function tick(now, metadata) {
    if (stopped) return;
    scheduled++;
    // Stopping a camera cannot cancel model work already running on the shared GPU.
    if (activeAnalysis) {
      watchInference();
      await activeAnalysis;
      clearTimeout(inferenceTimer);
      lastFreshAt = performance.now();
      schedule(intervalMs);
      return;
    }
    const mediaTime = metadata.mediaTime;
    const presented = metadata.presentedFrames;
    let displayed;
    try {
      const quality = video.getVideoPlaybackQuality?.();
      // The total includes dropped frames, which cannot count toward liveness.
      displayed = quality ? quality.totalVideoFrames - quality.droppedVideoFrames : undefined;
    }
    catch { /* Optional playback metrics must not interrupt camera processing. */ }
    const hasPresented = Number.isFinite(presented) && lastPresented !== null;
    const hasDisplayed = Number.isFinite(displayed) && displayed > 0 && lastDisplayed !== null;
    const fresh = lastMediaTime === null || (frameCallbacks
      ? (hasPresented ? presented > lastPresented : mediaTime > lastMediaTime)
      : (hasDisplayed ? displayed > lastDisplayed : video.currentTime > lastVideoTime));
    if (!isPlaying() || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !fresh || now - lastStarted < intervalMs) {
      if (isPlaying() && performance.now() - lastFreshAt >= 5000) {
        fail(Object.assign(new Error('Camera frames stopped. Restart to retry.'), { code: 'CAMERA_FRAMES_STALLED' }));
      } else schedule(intervalMs);
      return;
    }
    lastStarted = now;
    lastMediaTime = mediaTime;
    lastVideoTime = video.currentTime;
    if (Number.isFinite(presented)) lastPresented = presented;
    if (Number.isFinite(displayed) && displayed > 0) lastDisplayed = displayed;
    const width = video.videoWidth, height = video.videoHeight, source = video.srcObject, version = frameVersion;
    const isActive = () => !stopped && isPlaying() && frameVersion === version && video.srcObject === source && video.videoWidth === width && video.videoHeight === height;
    let release;
    activeAnalysis = new Promise(resolve => { release = resolve; });
    watchInference();
    try { await analyze(isActive); }
    catch (error) { fail(error); }
    finally {
      activeAnalysis = null;
      release();
      clearTimeout(inferenceTimer);
      lastFreshAt = performance.now();
      schedule();
    }
  }
  document?.addEventListener?.('visibilitychange', visibilityChanged);
  video.addEventListener?.('pause', interrupted);
  video.addEventListener?.('resize', invalidateFrame);
  track?.addEventListener?.('ended', interrupted);
  track?.addEventListener?.('mute', interrupted);
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
