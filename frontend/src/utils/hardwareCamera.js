/**
 * Hardware Camera Abstraction Layer
 * Provides low-level hardware sensor controls, continuous auto-focus,
 * dynamic exposure compensation, 60fps capture, and zero-copy frame grabbing.
 */

// Detect device form factor and orientation
export const getDeviceCameraMetrics = () => {
  const isMobile = typeof navigator !== 'undefined' && (
    /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && window.innerWidth < 1024)
  );
  const isPortrait = typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : true;
  return { isMobile, isPortrait };
};

/**
 * Requests camera stream with hardware-optimized constraints and progressive fallbacks.
 * @param {Object} options
 * @param {'user'|'environment'} options.facingMode - 'user' for front biometric, 'environment' for gate QR/rear.
 * @param {boolean} options.preferHighFps - Request 60fps sensor rate.
 * @returns {Promise<MediaStream>}
 */
export const requestHardwareCamera = async (options = {}) => {
  const { facingMode = 'user', preferHighFps = true } = options;
  const { isMobile, isPortrait } = getDeviceCameraMetrics();

  // Tier 1: 1080p/720p constraints
  const tier1Constraints = {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: isMobile && isPortrait ? 720 : 1920, min: 640 },
      height: { ideal: isMobile && isPortrait ? 1280 : 1080, min: 480 },
      aspectRatio: { ideal: isMobile && isPortrait ? 9 / 16 : 16 / 9 },
      frameRate: preferHighFps ? { ideal: 60, min: 30 } : { ideal: 30 },
    },
    audio: false,
  };

  // Tier 2: Standard 720p Stream
  const tier2Constraints = {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: isMobile && isPortrait ? 720 : 1280 },
      height: { ideal: isMobile && isPortrait ? 1280 : 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };

  // Tier 3: Basic Stream Fallback
  const tier3Constraints = {
    video: { facingMode },
    audio: false,
  };

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia(tier1Constraints);
  } catch (err1) {
    console.warn('[Camera Hardware] Tier 1 failed, retrying Tier 2:', err1.message);
    try {
      stream = await navigator.mediaDevices.getUserMedia(tier2Constraints);
    } catch (err2) {
      console.warn('[Camera Hardware] Tier 2 failed, falling back to basic constraints:', err2.message);
      stream = await navigator.mediaDevices.getUserMedia(tier3Constraints);
    }
  }

  // Engage hardware ISP optimizations on the active track
  await applyHardwareEnhancements(stream);

  return stream;
};

/**
 * Inspects underlying hardware capabilities and engages continuous auto-focus & exposure.
 * @param {MediaStream} stream
 * @returns {Promise<Object>} applied capabilities
 */
export const applyHardwareEnhancements = async (stream) => {
  if (!stream) return {};

  const [track] = stream.getVideoTracks();
  if (!track || !track.getCapabilities || !track.applyConstraints) {
    return {};
  }

  try {
    const capabilities = track.getCapabilities() || {};
    const advanced = {};

    // 1. Continuous auto-focus
    if (capabilities.focusMode?.includes('continuous')) {
      advanced.focusMode = 'continuous';
    }

    // 2. Continuous auto-exposure
    if (capabilities.exposureMode?.includes('continuous')) {
      advanced.exposureMode = 'continuous';
    }

    // 3. Continuous white balance
    if (capabilities.whiteBalanceMode?.includes('continuous')) {
      advanced.whiteBalanceMode = 'continuous';
    }

    if (Object.keys(advanced).length > 0) {
      await track.applyConstraints({ advanced: [advanced] });
    }

    return capabilities;
  } catch (err) {
    console.warn('[Camera Hardware] Could not apply advanced constraints:', err.message);
    return {};
  }
};

/**
 * Toggles device hardware torch (flashlight) if supported.
 * @param {MediaStream} stream
 * @param {boolean} enable
 * @returns {Promise<boolean>}
 */
export const toggleHardwareTorch = async (stream, enable = true) => {
  if (!stream) return false;
  const [track] = stream.getVideoTracks();
  if (!track || !track.getCapabilities || !track.applyConstraints) return false;

  try {
    const caps = track.getCapabilities();
    if (caps.torch) {
      await track.applyConstraints({ advanced: [{ torch: Boolean(enable) }] });
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[Camera Hardware] Torch toggle failed:', err.message);
    return false;
  }
};

/**
 * Safely stops all tracks associated with a MediaStream.
 * @param {MediaStream} stream
 */
export const stopHardwareStream = (stream) => {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // silent
      }
    });
  } catch {
    // silent
  }
};
