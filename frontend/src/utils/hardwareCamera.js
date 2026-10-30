/**
 * Shared browser camera constraints and optional hardware controls.
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

// Let the camera choose its native orientation and avoid requesting a cropped feed.
export const getCameraVideoConstraints = (facingMode = 'user') => ({
  facingMode: { ideal: facingMode },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
  ...(typeof navigator !== 'undefined' && navigator.mediaDevices?.getSupportedConstraints?.().resizeMode
    ? { resizeMode: { ideal: 'none' } }
    : {}),
});

/**
 * Requests camera stream with hardware-optimized constraints and progressive fallbacks.
 * @param {Object} options
 * @param {'user'|'environment'} options.facingMode - 'user' for front biometric, 'environment' for gate QR/rear.
 * @param {boolean} options.preferHighFps - Request 60fps sensor rate.
 * @returns {Promise<MediaStream>}
 */
export const requestHardwareCamera = async (options = {}) => {
  const { facingMode = 'user', preferHighFps = false } = options;

  const tier1Constraints = {
    video: {
      ...getCameraVideoConstraints(facingMode),
      ...(preferHighFps ? { frameRate: { ideal: 60, max: 60 } } : {}),
    },
    audio: false,
  };

  // Reduce the preferred resolution if the first request is rejected.
  const tier2Constraints = {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  };

  // Tier 3: Basic Stream Fallback
  const tier3Constraints = {
    video: { facingMode: { ideal: facingMode } },
    audio: false,
  };

  const tiers = [tier1Constraints, tier2Constraints, tier3Constraints];
  for (let index = 0; index < tiers.length; index += 1) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(tiers[index]);
    } catch (error) {
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name) || index === tiers.length - 1) {
        throw error;
      }
      continue;
    }

    // Optional camera controls must not delay delivery of an otherwise usable stream.
    void applyHardwareEnhancements(stream);
    return stream;
  }
};

/**
 * Inspects underlying hardware capabilities and engages continuous auto-focus & exposure.
 * @param {MediaStream} stream
 * @returns {Promise<Object>} advertised capabilities
 */
export const applyHardwareEnhancements = async (stream) => {
  if (!stream) return {};

  try {
    const [track] = stream.getVideoTracks();
    if (!track || !track.getCapabilities || !track.applyConstraints) return {};
    const capabilities = track.getCapabilities() || {};
    const adjustments = [];
    for (const mode of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
      if (capabilities[mode]?.includes('continuous')) {
        adjustments.push({ [mode]: 'continuous' });
      }
    }

    const zoom = capabilities.zoom;
    if (Number.isFinite(zoom?.min) && Number.isFinite(zoom?.max) && zoom.min <= zoom.max) {
      if (zoom.min > 1) {
        adjustments.push({ zoom: zoom.min });
      } else if (zoom.max >= 1) {
        const steps = (1 - zoom.min) / zoom.step;
        if (!zoom.step || Math.abs(steps - Math.round(steps)) < 1e-6) {
          adjustments.push({ zoom: 1 });
        }
      }
    }

    let constraints = track.getConstraints?.() || {};
    for (const adjustment of adjustments) {
      try {
        // applyConstraints replaces prior constraints, including capture frame limits.
        const next = { ...constraints, advanced: [...(constraints.advanced || []), adjustment] };
        await track.applyConstraints(next);
        constraints = next;
      } catch {
        // A rejected optional control must not prevent the remaining adjustments.
      }
    }

    return capabilities;
  } catch {
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
      const constraints = track.getConstraints?.() || {};
      const advanced = (constraints.advanced || [])
        .map(({ torch: _torch, ...rest }) => rest)
        .filter((control) => Object.keys(control).length > 0);
      await track.applyConstraints({ ...constraints, advanced: [...advanced, { torch: Boolean(enable) }] });
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
