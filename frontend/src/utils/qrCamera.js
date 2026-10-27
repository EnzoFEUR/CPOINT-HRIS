import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { applyHardwareEnhancements, getCameraVideoConstraints, stopHardwareStream } from './hardwareCamera';

let cameraQueue = Promise.resolve();
let activeScanner = null;

function enqueue(task) {
  const pending = cameraQueue.then(task);
  cameraQueue = pending.catch(() => {});
  return pending;
}

export function createQrScanner(elementId) {
  return { elementId, version: 0, wanted: false, reader: null };
}

function isCurrent(scanner, version) {
  return scanner.wanted && scanner.version === version && scanner.options.isActive();
}

async function closeScanner(scanner) {
  clearTimeout(scanner.resizeTimer);
  scanner.mutations?.disconnect();
  scanner.resize?.disconnect();
  scanner.mutations = null;
  scanner.resize = null;
  const reader = scanner.reader;
  const started = scanner.started;
  scanner.started = false;
  scanner.reader = null;
  if (!reader) {
    if (activeScanner === scanner) activeScanner = null;
    return;
  }
  const video = scanner.element?.querySelector('video');
  const stream = video?.srcObject;
  try {
    if (started || reader.isScanning) await reader.stop();
  } catch {
    // SDK cleanup can fail before the first playing event creates its canvas.
    video?.pause?.();
    if (video) video.srcObject = null;
  } finally {
    stopHardwareStream(stream);
    if (activeScanner === scanner) activeScanner = null;
    if (document.getElementById(scanner.elementId) === scanner.element) {
      try { reader.clear(); }
      catch { scanner.element.replaceChildren(); }
    }
  }
}

function prepareViewport(scanner, version) {
  const element = scanner.element;
  Object.assign(element.style, { display: 'flex', alignItems: 'center', justifyContent: 'center' });
  const fitVideo = () => {
    const video = element.querySelector('video');
    if (!video) return;
    // Decoder coordinates use the video element box, so that box must match the complete image.
    Object.assign(video.style, {
      width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%',
      position: 'static', objectFit: 'contain', flex: 'none',
    });
  };
  scanner.mutations = new MutationObserver(fitVideo);
  scanner.mutations.observe(element, { childList: true });
  let width = element.clientWidth;
  let height = element.clientHeight;
  if (typeof ResizeObserver !== 'undefined') {
    scanner.resize = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight) return;
      width = element.clientWidth;
      height = element.clientHeight;
      if (!width || !height || !isCurrent(scanner, version) || scanner.resizeQueued) return;
      // html5-qrcode fixes the decoder region at startup; rebuild it after a viewport resize.
      clearTimeout(scanner.resizeTimer);
      scanner.resizeTimer = setTimeout(() => {
        scanner.resizeQueued = true;
        enqueue(async () => {
          if (!isCurrent(scanner, version)) return;
          await closeScanner(scanner);
          if (isCurrent(scanner, version)) await openScanner(scanner, version);
        }).catch(error => {
          if (isCurrent(scanner, version)) scanner.options.onError?.(error);
        }).finally(() => { scanner.resizeQueued = false; });
      }, 150);
    });
    scanner.resize.observe(element);
  }
}

async function openScanner(scanner, version, attempt = 0) {
  if (!isCurrent(scanner, version)) return false;
  scanner.element = document.getElementById(scanner.elementId);
  if (!scanner.element) return false;
  if (activeScanner && activeScanner !== scanner) {
    activeScanner.wanted = false;
    activeScanner.version++;
    await closeScanner(activeScanner);
  }
  activeScanner = scanner;
  try {
    prepareViewport(scanner, version);
    const decoderConfig = {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      useBarCodeDetectorIfSupported: true,
      verbose: false,
    };
    try {
      scanner.reader = new Html5Qrcode(scanner.elementId, decoderConfig);
    } catch {
      // Some Android browsers expose BarcodeDetector but cannot construct a usable detector.
      scanner.reader = new Html5Qrcode(scanner.elementId, { ...decoderConfig, useBarCodeDetectorIfSupported: false });
    }
    const { facingMode, onScan } = scanner.options;
    const selectedFacing = attempt < 2 ? facingMode : (facingMode === 'environment' ? 'user' : 'environment');
    const videoConstraints = attempt === 0
      ? getCameraVideoConstraints(selectedFacing)
      : { facingMode: { ideal: selectedFacing } };
    await scanner.reader.start(
      { facingMode: { ideal: selectedFacing } },
      { fps: 12, disableFlip: false, videoConstraints },
      (text, result) => {
        if (isCurrent(scanner, version)) onScan(text, result);
      },
      () => {},
    );
    // SDK start resolves before its public isScanning flag is set by the first playing event.
    scanner.started = true;
    if (!isCurrent(scanner, version)) {
      await closeScanner(scanner);
      return false;
    }
    applyHardwareEnhancements(scanner.element.querySelector('video')?.srcObject).catch(() => {});
    return true;
  } catch (error) {
    await closeScanner(scanner);
    const cameraFailure = `${error?.name || ''} ${error?.message || error}`;
    const canRetry = /Overconstrained|ConstraintNotSatisfied|NotFound|DevicesNotFound|NotReadable|TrackStart|TypeError/.test(cameraFailure)
      && !/NotAllowed|PermissionDenied|SecurityError|permission denied/i.test(cameraFailure);
    if (isCurrent(scanner, version) && canRetry && attempt < 2) {
      return openScanner(scanner, version, attempt + 1);
    }
    if (isCurrent(scanner, version)) scanner.options.onError?.(error);
    return false;
  }
}

export function startQrCamera(scanner, { facingMode = 'environment', onScan, onError, isActive = () => true }) {
  scanner.wanted = true;
  scanner.options = { facingMode, onScan, onError, isActive };
  const version = ++scanner.version;
  return enqueue(async () => {
    if (!isCurrent(scanner, version)) return false;
    try {
      await closeScanner(scanner);
      return await openScanner(scanner, version);
    } catch (error) {
      if (isCurrent(scanner, version)) scanner.options.onError?.(error);
      return false;
    }
  });
}

export function stopQrCamera(scanner) {
  if (!scanner) return Promise.resolve();
  scanner.wanted = false;
  scanner.version++;
  return enqueue(() => closeScanner(scanner));
}
