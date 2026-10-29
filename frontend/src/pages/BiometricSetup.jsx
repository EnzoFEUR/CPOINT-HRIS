import { isBiometricSetupTestAccess } from '../utils/biometricSetupTestAccess.mjs';
import { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../utils/api';
import { requestHardwareCamera, stopHardwareStream } from '../utils/hardwareCamera';
import { startVideoFrameLoop, copyVideoFrame } from '../utils/cameraFrames.mjs';
import { loadFaceModels } from '../utils/faceModels';
import { BLINK_PROMPTS, createBlinkState, calibrateBlink, updateBlink, resetBlinkCycle, areEyesOpen } from '../utils/blinkDetection.mjs';
import { createBlinkDetector } from '../utils/blinkDetector.mjs';
import { readBlinkEyes } from '../utils/blinkExpression.mjs';
import { trackFace, resetCaptureHold, updateCaptureHold } from '../utils/faceCapture.mjs';
import { playBiometricSound as playSound } from '../utils/audio';
import { isSecurity, isAdmin, isMedicalExempt } from '../routes/guards';
import { needsProfileCompletion } from '../utils/userAccess.mjs';
import { performLogout } from '../utils/authSession';
import BackButton from '../components/ui/BackButton';
import BlinkStatus from '../components/ui/BlinkStatus';

const ENV = {
  API_BASE: import.meta.env?.VITE_API_BASE || '/api',
  ENROLL_TIMEOUT_MS: parseInt(import.meta.env?.VITE_ENROLL_TIMEOUT_MS, 10) || 120_000,
  HOLD_FRAMES: 8,
  CALIBRATION_FRAMES: 12,
  DETECTION_INTERVAL_MS: 50,
  DETECTION_INPUT_SIZE: 320,
  FACE_CONFIDENCE_MIN: 0.55,
  FACE_WIDTH_MIN_PX: 45,
  REQUIRED_BLINKS: 1,
  DESC_CONSISTENCY_THRESHOLD: 0.52,
};

const POSE = Object.freeze({
  CENTER: { id: 0, label: 'CENTER', instruction: 'Look straight at camera', color: '#3b82f6', yaw: 0.00, pitch: 0.00, yawTol: 0.12, pitchTol: 0.14 },
  LEFT:   { id: 1, label: 'LEFT',   instruction: 'Turn slightly LEFT',   color: '#8b5cf6', yaw: 0.28, pitch: 0.00, yawTol: 0.12, pitchTol: 0.18 },
  RIGHT:  { id: 2, label: 'RIGHT',  instruction: 'Turn slightly RIGHT',  color: '#06b6d4', yaw: -0.28, pitch: 0.00, yawTol: 0.12, pitchTol: 0.18 },
  UP:     { id: 3, label: 'UP',     instruction: 'Tilt chin slightly UP',   color: '#f59e0b', yaw: 0.00, pitch: -0.14, yawTol: 0.18, pitchTol: 0.09 },
  DOWN:   { id: 4, label: 'DOWN',   instruction: 'Tilt chin slightly DOWN', color: '#ef4444', yaw: 0.00, pitch: 0.14, yawTol: 0.18, pitchTol: 0.09 },
});

const PHASE_LIST = Object.values(POSE);

// 3D head pose estimation normalized by inter-ocular distance
const estimateHeadPose = (landmarks) => {
  const p = landmarks.positions;
  const leftEyeOuter  = p[36];
  const rightEyeOuter = p[45];
  const noseTip       = p[30];
  const chin          = p[8];
  const leftMouth     = p[48];
  const rightMouth    = p[54];

  const eyeMid = {
    x: (leftEyeOuter.x + rightEyeOuter.x) / 2,
    y: (leftEyeOuter.y + rightEyeOuter.y) / 2,
  };

  const iod = Math.hypot(rightEyeOuter.x - leftEyeOuter.x, rightEyeOuter.y - leftEyeOuter.y) || 1;
  const yaw = (noseTip.x - eyeMid.x) / (iod * 0.5);
  const eyeToNoseY = eyeMid.y - noseTip.y;
  const noseToChinY = chin.y - noseTip.y;
  const pitch = (noseToChinY - eyeToNoseY * 1.4) / iod;
  const roll = Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x);
  const mouthW = Math.hypot(rightMouth.x - leftMouth.x, rightMouth.y - leftMouth.y);
  const symmetry = Math.abs(1 - (mouthW / (iod * 0.85)));

  return { yaw, pitch, roll, iod, scale: iod, symmetry };
};


const haptic = (type) => {
  if (!navigator.vibrate) return;
  if (type === 'phase') navigator.vibrate([20, 40, 20]);
  else if (type === 'success') navigator.vibrate([30, 40, 50, 40, 80]);
  else if (type === 'error') navigator.vibrate([100, 50, 100]);
};

// Canvas face mesh and direction pointer
const drawMesh = (ctx, landmarks, box, color, isLocked, pose = null) => {
  const pts = landmarks.positions;
  const r = isLocked ? 2.5 : 1.5;
  const lw = isLocked ? 1.8 : 1;

  ctx.fillStyle = color;
  pts.forEach(pt => { ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill(); });

  const line = (idxs, close) => {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
    idxs.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    if (close) ctx.closePath(); ctx.stroke();
  };

  line(pts.slice(0, 17), false);
  line(pts.slice(17, 22), false);
  line(pts.slice(22, 27), false);
  line(pts.slice(27, 31), false);
  line(pts.slice(31, 36), false);
  line(pts.slice(36, 42), true);
  line(pts.slice(42, 48), true);
  line(pts.slice(48, 60), true);
  line(pts.slice(60, 68), true);

  // Direction pointer vector
  if (pose && pts[30]) {
    const nose = pts[30];
    const arrowLength = 70;
    const dx = Math.sin(pose.yaw) * arrowLength;
    const dy = Math.sin(pose.pitch) * arrowLength;
    const tipX = nose.x + dx;
    const tipY = nose.y - dy;

    ctx.beginPath();
    ctx.moveTo(nose.x, nose.y);
    ctx.lineTo(tipX, tipY);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = isLocked ? '#22c55e' : '#3b82f6';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
    ctx.fillStyle = isLocked ? '#22c55e' : '#3b82f6';
    ctx.fill();
  }

  // Facial bracket corners
  const cl = Math.min(28, box.width * 0.15);
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash([]);
  const { x, y, width: w, height: h } = box;
  ctx.beginPath();
  ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
  ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl);
  ctx.moveTo(x + w, y + h - cl); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cl, y + h);
  ctx.moveTo(x + cl, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cl);
  ctx.stroke();
};

const MODES = Object.freeze({
  BOOT: 'boot', READY: 'ready', CALIBRATING: 'calibrating', ENROLLING: 'enrolling',
  VALIDATING: 'validating', UPLOADING: 'uploading', SUCCESS: 'success', ERROR: 'error',
});

const initialState = {
  mode: MODES.BOOT,
  modelsLoaded: false,
  cameraReady: false,
  currentPhaseIdx: -1,
  overallProgress: 0,
  phaseProgress: 0,
  statusText: 'Initializing optical sensor...',
  pose: { yaw: 0, pitch: 0, roll: 0, symmetry: 0 },
  confidence: 0,
  blinkCount: 0,
  blinkPhase: 'CALIBRATING',
  livenessOk: false,
  captured: [],
  error: null,
  isOnline: navigator.onLine,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_MODE': return { ...state, mode: action.payload };
    case 'SET_MODELS_LOADED': return { ...state, modelsLoaded: true };
    case 'SET_CAMERA_READY': return { ...state, cameraReady: true };
    case 'SET_PHASE': return { ...state, currentPhaseIdx: action.payload };
    case 'SET_PROGRESS': return { ...state, overallProgress: action.payload.overall, phaseProgress: action.payload.phase };
    case 'SET_STATUS': return { ...state, statusText: action.payload };
    case 'SET_POSE': return { ...state, pose: action.payload };
    case 'SET_CONFIDENCE': return { ...state, confidence: action.payload };
    case 'SET_LIVENESS': return { ...state, blinkCount: action.blinkCount, livenessOk: action.livenessOk, blinkPhase: action.blinkPhase };
    case 'PUSH_CAPTURE': return { ...state, captured: [...state.captured, action.payload] };
    case 'SET_ERROR': return { ...state, mode: MODES.ERROR, error: action.payload };
    case 'RESTART_SEQUENCE': return { ...state, mode: MODES.CALIBRATING, currentPhaseIdx: -1, captured: [], overallProgress: 0, phaseProgress: 0, confidence: 0, blinkCount: 0, blinkPhase: 'CALIBRATING', livenessOk: false, statusText: action.payload };
    case 'SET_ONLINE': return { ...state, isOnline: action.payload };
    case 'RESET':
      return {
        ...initialState,
        modelsLoaded: state.modelsLoaded,
        cameraReady: state.cameraReady,
        isOnline: state.isOnline,
      };
    default: return state;
  }
}

export default function BiometricSetup() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const navigate = useNavigate();
  const [cameraFacing, setCameraFacing] = useState('user');

  const [deviceInfo, setDeviceInfo] = useState(() => {
    const isMobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024));
    const isPortrait = typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : true;
    return { isMobile, isPortrait };
  });

  useEffect(() => {
    const handleResize = () => {
      const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024);
      const isPortrait = window.innerHeight > window.innerWidth;
      setDeviceInfo({ isMobile, isPortrait });
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const user = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user')) || null; }
    catch { return null; }
  }, []);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const blinkDetectorRef = useRef(null);
  const loopRef = useRef(null);
  const abortRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const cameraPromiseRef = useRef(null);
  const cameraStartingRef = useRef(false);
  const [cameraStarting, setCameraStarting] = useState(false);

  const vault = useRef({
    processing: false,
    holdCount: 0,
    calibrationSamples: [],
    baseline: null,
    blinkCount: 0,
    blinkState: null,
    phaseIdx: 0,
  }).current;

  // Camera boot with hardware ISP & focus controls
  const startCameraStream = useCallback(async (facing = 'user') => {
    const request = ++cameraRequestRef.current;
    if (streamRef.current) {
      stopHardwareStream(streamRef.current);
      streamRef.current = null;
    }
    if (cameraPromiseRef.current) await cameraPromiseRef.current.catch(() => {});
    if (request !== cameraRequestRef.current) return null;
    const opening = requestHardwareCamera({ facingMode: facing });
    cameraPromiseRef.current = opening;
    let stream;
    try { stream = await opening; }
    finally { if (cameraPromiseRef.current === opening) cameraPromiseRef.current = null; }
    if (request !== cameraRequestRef.current || !videoRef.current) {
      stopHardwareStream(stream);
      return null;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    video.srcObject = stream;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    try { await video.play(); }
    catch (error) {
      stopHardwareStream(stream);
      if (streamRef.current === stream) { streamRef.current = null; video.srcObject = null; }
      throw error;
    }
    if (request !== cameraRequestRef.current) {
      stopHardwareStream(stream);
      return null;
    }
    const actualFacing = stream.getVideoTracks?.()[0]?.getSettings?.().facingMode;
    setCameraFacing(['user', 'environment'].includes(actualFacing) ? actualFacing : facing);
    return stream;
  }, []);

  // Lens Switcher (Front Ã¢Å¸Â· Rear)
  const toggleCameraFacing = useCallback(async () => {
    if (cameraStartingRef.current) return;
    cameraStartingRef.current = true;
    setCameraStarting(true);
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    try {
      const stream = await startCameraStream(nextFacing);
      if (!stream) return;
      const actualFacing = stream.getVideoTracks?.()[0]?.getSettings?.().facingMode || nextFacing;
      toast.success(actualFacing === 'user' ? 'Front Camera Active' : 'Rear Camera Active', {
        id: 'bio-flip',
        duration: 1500,
      });
    } catch {
      toast.error('Camera could not switch. Check camera permissions and retry.');
      dispatch({ type: 'SET_ERROR', payload: { message: 'Camera could not switch. Retry to reopen it.', code: 'CAMERA_SWITCH_FAILED' } });
    } finally {
      cameraStartingRef.current = false;
      setCameraStarting(false);
    }
  }, [cameraFacing, startCameraStream]);

  useEffect(() => {
    let mounted = true;
    let wakeLock = null;
    let blinkDetector;
    const pendingCamera = cameraRequestRef;

    const boot = async () => {
      try {
        // Authoritative verification against backend database before booting sensors or neural weights
        if (user && !isAdmin(user) && !isSecurity(user)) {
          try {
            const profileRes = await fetchWithAuth('/api/profile');
            if (profileRes.ok) {
              const profileData = await profileRes.json();
              const authoritativeUser = profileData?.user || profileData?.employee;
              if (authoritativeUser && needsProfileCompletion(authoritativeUser)) {
                toast.error('Please complete mandatory profile details before enrolling biometrics.');
                navigate('/onboarding', { replace: true });
                return;
              }
            }
          } catch { /* The enrollment endpoint rechecks profile completion if this refresh fails. */ }
        }

        if (!mounted) return;
        blinkDetector = createBlinkDetector();
        blinkDetectorRef.current = blinkDetector;
        await Promise.all([loadFaceModels(), blinkDetector.ready]);
        if (!mounted) return;
        dispatch({ type: 'SET_MODELS_LOADED' });
        dispatch({ type: 'SET_STATUS', payload: 'Requesting optical sensor...' });

        await startCameraStream();
        if (!mounted) return;

        dispatch({ type: 'SET_CAMERA_READY' });
        dispatch({ type: 'SET_MODE', payload: MODES.READY });
        dispatch({ type: 'SET_STATUS', payload: 'Press Start Registration when ready' });

        if ('wakeLock' in navigator) {
          navigator.wakeLock.request('screen').then(l => { if (mounted) wakeLock = l; else l.release().catch(() => {}); }).catch(() => {});
        }
      } catch (err) {
        blinkDetector?.close();
        if (blinkDetectorRef.current === blinkDetector) blinkDetectorRef.current = null;
        if (!mounted) return;
        console.error('[BOOT]', err);
        const isPermissionDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        const msg = err.code?.startsWith('BLINK_') ? 'Blink detection could not load. Reload this page to retry.' : isPermissionDenied
          ? 'Camera permission denied. Please allow camera access in browser settings.'
          : 'Unable to load camera or facial recognition weights. Please refresh.';
        dispatch({ type: 'SET_ERROR', payload: { message: msg, code: 'BOOT_FAILURE' } });
      }
    };

    boot();

    return () => {
      mounted = false;
      pendingCamera.current++;
      loopRef.current?.stop();
      loopRef.current = null;
      blinkDetector?.close();
      if (blinkDetectorRef.current === blinkDetector) blinkDetectorRef.current = null;
      stopHardwareStream(streamRef.current);
      streamRef.current = null;
      if (abortRef.current) abortRef.current.abort();
      wakeLock?.release().catch(() => {});
    };
  }, [startCameraStream, user, navigate]);

  const validateAndSubmit = useCallback(async () => {
    const captures = state.captured;
    if (captures.length < PHASE_LIST.length) {
      dispatch({ type: 'SET_ERROR', payload: { message: 'Incomplete sequence. Please retry.', code: 'INCOMPLETE_CAPTURE' } });
      return;
    }

    const centerCap = captures.find(c => c.phase === 'CENTER') || captures[0];
    const centerDesc = centerCap?.descriptor;
    const otherDescs = captures.filter(c => c !== centerCap && c.descriptor);

    if (centerDesc && otherDescs.length >= 1) {
      // Anchored comparison: verify each peripheral angle against the primary frontal center anchor
      let maxDistFromCenter = 0;
      for (const cap of otherDescs) {
        const d = faceapi.euclideanDistance(centerDesc, cap.descriptor);
        if (d > maxDistFromCenter) maxDistFromCenter = d;
      }
      if (maxDistFromCenter > ENV.DESC_CONSISTENCY_THRESHOLD) {
        dispatch({ type: 'SET_ERROR', payload: { message: `Inconsistency detected across angles. Please maintain steady posture and face the camera.`, code: 'IDENTITY_INCONSISTENCY' } });
        playSound('error'); haptic('error');
        return;
      }
    }

    const primaryImage = centerCap.image;

    dispatch({ type: 'SET_MODE', payload: MODES.UPLOADING });
    dispatch({ type: 'SET_STATUS', payload: 'Verifying and saving registration...' });

    try {
      const companyId = user.company_id || (isAdmin(user) ? 'CP-MAIN' : user.id);
      const telemetry = {
        angles_captured: captures.map(c => c.phase),
        client_timestamp: new Date().toISOString(),
      };

      abortRef.current = new AbortController();

      const res = await fetchWithAuth(`${ENV.API_BASE}/attendance/register-baseline`, {
        method: 'POST',
        signal: abortRef.current.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: user.id,
          company_id: companyId,
          image_base64: primaryImage,
          angles: telemetry.angles_captured,
          telemetry,
        }),
      });

      let data;
      try { data = await res.json(); } catch { data = { status: 'error', message: 'Malformed server response' }; }

      if (!res.ok) {
        throw new Error(data.message || 'Enrollment rejected.');
      }

      dispatch({ type: 'SET_MODE', payload: MODES.SUCCESS });
      dispatch({ type: 'SET_STATUS', payload: 'Biometric Enrollment Complete' });
      playSound('success'); haptic('success');

      const updated = { 
        ...user, 
        has_registered_biometrics: true,
        company_id: user.company_id || (isAdmin(user) ? 'CP-MAIN' : user.company_id)
      };
      localStorage.setItem('user', JSON.stringify(updated));

      setTimeout(() => {
        if (isAdmin(user)) navigate('/');
        else if (isSecurity(user)) navigate('/scanner');
        else navigate('/employee/dashboard');
      }, 2000);

    } catch (err) {
      if (err.name === 'AbortError') return;
      dispatch({ type: 'SET_ERROR', payload: { message: err.message || 'Failed to submit profile.', code: 'UPLOAD_ERROR' } });
      playSound('error'); haptic('error');
    }
  }, [state.captured, user, navigate]);

  useEffect(() => {
    if (state.mode === MODES.VALIDATING) {
      validateAndSubmit();
    }
  }, [state.mode, validateAndSubmit]);

  const startLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const frame = video.ownerDocument.createElement('canvas');
    vault.blinkState = createBlinkState();
    vault.faceTrack = {};
    vault.captureHold = {};
    vault.enrollmentAnchor = null;
    vault.pendingReacquisition = false;
    const interruptEvidence = () => {
      vault.holdCount = 0;
      resetCaptureHold(vault.captureHold);
      dispatch({ type: 'SET_CONFIDENCE', payload: 0 });
      dispatch({ type: 'SET_PROGRESS', payload: { overall: (vault.phaseIdx / PHASE_LIST.length) * 100, phase: 0 } });
      if (!vault.enrollmentAnchor) {
        vault.blinkCount = 0;
        resetBlinkCycle(vault.blinkState);
        dispatch({ type: 'SET_LIVENESS', blinkCount: 0, livenessOk: false, blinkPhase: vault.blinkState.phase });
      }
      if (!vault.baseline) vault.calibrationSamples = [];
    };
    const restartSequence = message => {
      vault.baseline = null;
      vault.calibrationSamples = [];
      vault.phaseIdx = 0;
      vault.enrollmentAnchor = null;
      vault.pendingReacquisition = false;
      vault.faceTrack = {};
      vault.blinkState = createBlinkState();
      interruptEvidence();
      dispatch({ type: 'RESTART_SEQUENCE', payload: message });
      dispatch({ type: 'SET_STATUS', payload: message });
    };
    const readConsistentDescriptor = async (landmarks, isActive) => {
      const [face] = await faceapi.extractFaces(frame, [landmarks.align(null, { useDlibAlignment: true })]);
      const descriptor = await faceapi.computeFaceDescriptor(face);
      if (!isActive()) return null;
      const valid = descriptor?.length === 128 && Array.from(descriptor).every(Number.isFinite);
      const distance = valid && vault.enrollmentAnchor ? faceapi.euclideanDistance(vault.enrollmentAnchor, descriptor) : 0;
      if (!valid || !Number.isFinite(distance) || distance > ENV.DESC_CONSISTENCY_THRESHOLD) {
        restartSequence('Face consistency changed. Look at the camera to restart');
        return null;
      }
      // Descriptor work blocks this loop; it is not evidence that the detector lost the face.
      vault.faceTrack.at = performance.now();
      return descriptor;
    };

    const syncCanvas = () => {
      const nw = frame.width, nh = frame.height;
      if (nw && nh && (canvas.width !== nw || canvas.height !== nh)) {
        canvas.width = nw; canvas.height = nh;
      }
    };
    syncCanvas();

    loopRef.current?.stop();

    loopRef.current = startVideoFrameLoop(video, async isActive => {
      if (!copyVideoFrame(video, frame)) return;
      const observedAt = performance.now();
      syncCanvas();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const [faces, blinkResult] = await Promise.all([faceapi
        .detectAllFaces(frame, new faceapi.TinyFaceDetectorOptions({
          inputSize: ENV.DETECTION_INPUT_SIZE,
          scoreThreshold: 0.40,
        }))
        .withFaceLandmarks(), blinkDetectorRef.current.analyze(frame)]);

      if (!isActive()) return;

      if (performance.now() - observedAt > 650) {
        interruptEvidence();
        dispatch({ type: 'SET_STATUS', payload: 'Face processing is slow. Hold steady in good lighting' });
        return;
      }
      if (blinkResult?.faces?.length > 1) {
        restartSequence('Only one person should be in the frame');
        return;
      }
      if (faces.length !== 1) {
        if (faces.length === 0 && vault.enrollmentAnchor && performance.now() - vault.faceTrack.at <= 650) {
          vault.pendingReacquisition = true;
          dispatch({ type: 'SET_CONFIDENCE', payload: 0 });
          dispatch({ type: 'SET_LIVENESS', blinkCount: vault.blinkCount, livenessOk: vault.blinkCount >= ENV.REQUIRED_BLINKS, blinkPhase: 'PAUSED' });
          vault.holdCount = 0;
          resetCaptureHold(vault.captureHold);
          dispatch({ type: 'SET_PROGRESS', payload: { overall: (vault.phaseIdx / PHASE_LIST.length) * 100, phase: 0 } });
          dispatch({ type: 'SET_STATUS', payload: 'Face briefly lost. Turn slightly back toward the camera' });
          return;
        }
        restartSequence(faces.length > 1 ? 'Only one person should be in the frame' : 'Place your face inside the guide');
        dispatch({ type: 'SET_CONFIDENCE', payload: 0 });
        dispatch({ type: 'SET_POSE', payload: { yaw: 0, pitch: 0, roll: 0, symmetry: 0 } });
        dispatch({ type: 'SET_PROGRESS', payload: { overall: (vault.phaseIdx / PHASE_LIST.length) * 100, phase: 0 } });
        return;
      }
      const [det] = faces;

      const box = det.detection.box;
      const lm = det.landmarks;
      const score = det.detection.score;
      const eyes = readBlinkEyes(blinkResult, box, frame.width, frame.height);
      if (!eyes) {
        interruptEvidence();
        dispatch({ type: 'SET_STATUS', payload: 'Move closer so both eyes are clear' });
        return;
      }
      const pose = estimateHeadPose(lm);
      if (!Number.isFinite(pose.yaw) || !Number.isFinite(pose.pitch) || !Number.isFinite(pose.roll)) {
        interruptEvidence();
        return;
      }

      dispatch({ type: 'SET_POSE', payload: pose });

      const minConfidence = (vault.baseline && vault.phaseIdx === 0 && !vault.blinkCount) ? 0.42 : ENV.FACE_CONFIDENCE_MIN;
      if (score < minConfidence) {
        interruptEvidence();
        dispatch({ type: 'SET_PROGRESS', payload: { overall: (vault.phaseIdx / PHASE_LIST.length) * 100, phase: 0 } });
        dispatch({ type: 'SET_STATUS', payload: 'Hold still and face the light' });
        drawMesh(ctx, lm, box, '#f59e0b', false, pose);
        return;
      }

      if (box.width < ENV.FACE_WIDTH_MIN_PX) {
        interruptEvidence();
        dispatch({ type: 'SET_PROGRESS', payload: { overall: (vault.phaseIdx / PHASE_LIST.length) * 100, phase: 0 } });
        dispatch({ type: 'SET_STATUS', payload: 'Move slightly closer' });
        drawMesh(ctx, lm, box, '#f59e0b', false, pose);
        return;
      }

      // Neutral Calibration Phase
      const now = observedAt;
      if (!trackFace(vault.faceTrack, box, now)) {
        restartSequence('Face tracking changed. Look at the camera to restart');
        return;
      }
      dispatch({ type: 'SET_CONFIDENCE', payload: Math.round(score * 100) });
      if (vault.pendingReacquisition) {
        if (!await readConsistentDescriptor(lm, isActive)) return;
        vault.pendingReacquisition = false;
        resetCaptureHold(vault.captureHold);
        dispatch({ type: 'SET_STATUS', payload: PHASE_LIST[vault.phaseIdx].instruction });
        return;
      }
      if (!vault.baseline) {
        drawMesh(ctx, lm, box, '#3b82f6', false, pose);
        vault.calibrationSamples.push(pose);
        if (vault.calibrationSamples.length > ENV.CALIBRATION_FRAMES) vault.calibrationSamples.shift();
        // Let positioning settle before freezing the open-eye baseline for this challenge.
        const eyesReady = vault.calibrationSamples.length >= ENV.CALIBRATION_FRAMES && calibrateBlink(vault.blinkState, eyes, now);
        dispatch({ type: 'SET_STATUS', payload: eyesReady ? `Calibrating position (${vault.calibrationSamples.length}/${ENV.CALIBRATION_FRAMES})` : BLINK_PROMPTS.CALIBRATING });

        if (vault.calibrationSamples.length >= ENV.CALIBRATION_FRAMES && eyesReady) {
          const avgYaw = vault.calibrationSamples.reduce((s, p) => s + p.yaw, 0) / ENV.CALIBRATION_FRAMES;
          const avgPitch = vault.calibrationSamples.reduce((s, p) => s + p.pitch, 0) / ENV.CALIBRATION_FRAMES;
          vault.baseline = { yaw: avgYaw, pitch: avgPitch };
          resetBlinkCycle(vault.blinkState);
          vault.blinkCount = 0;
          dispatch({ type: 'SET_MODE', payload: MODES.ENROLLING });
          dispatch({ type: 'SET_PHASE', payload: 0 });
          dispatch({ type: 'SET_STATUS', payload: POSE.CENTER.instruction });
        }
        return;
      }

      const phaseIdx = vault.phaseIdx;
      const target = PHASE_LIST[phaseIdx];
      const dy = pose.yaw - vault.baseline.yaw;
      const dp = pose.pitch - vault.baseline.pitch;

      const yawMatch = Math.abs(dy - target.yaw) < target.yawTol;
      const pitchMatch = Math.abs(dp - target.pitch) < target.pitchTol;
      const match = yawMatch && pitchMatch;

      const color = match ? '#22c55e' : target.color;
      drawMesh(ctx, lm, box, color, match, pose);

      // Allow slight landmark drift during a blink; photo capture still uses the strict pose.
      const blinkInProgress = ['ARMED', 'CLOSING', 'CLOSED', 'REOPEN', 'PASSED'].includes(vault.blinkState.phase);
      const blinkPoseOk = match || (blinkInProgress && Math.abs(dy - target.yaw) < target.yawTol + .14 && Math.abs(dp - target.pitch) < target.pitchTol + .16);
      if (phaseIdx === 0) {
        if (blinkPoseOk) {
          updateBlink(vault.blinkState, eyes, now);
        } else if (Math.abs(dy - target.yaw) > target.yawTol + .24 || Math.abs(dp - target.pitch) > target.pitchTol + .26) {
          resetBlinkCycle(vault.blinkState);
        }
        vault.blinkCount = vault.blinkState.count;

        // Instant multimodal cue so user knows when eyelids closed without peeking
        if (vault.lastBlinkPhase !== vault.blinkState.phase) {
          if (vault.blinkState.phase === 'CLOSED') {
            playSound('phase');
            haptic('phase');
          }
          vault.lastBlinkPhase = vault.blinkState.phase;
        }
      }
      const livenessOk = vault.blinkCount >= ENV.REQUIRED_BLINKS;
      dispatch({ type: 'SET_LIVENESS', blinkCount: vault.blinkCount, livenessOk, blinkPhase: vault.blinkState.phase });
      if (!livenessOk && phaseIdx === 0) {
        vault.holdCount = 0;
        resetCaptureHold(vault.captureHold);
        dispatch({ type: 'SET_STATUS', payload: blinkPoseOk ? (BLINK_PROMPTS[vault.blinkState.phase] || target.instruction) : target.instruction });
        return;
      }

      if (match) {
        // For Phase 0 (CENTER baseline), ensure eyes are fully open and looking at the camera before accumulating capture hold
        if (!areEyesOpen(vault.blinkState, eyes)) {
          vault.holdCount = 0;
          resetCaptureHold(vault.captureHold);
          dispatch({ type: 'SET_STATUS', payload: 'Look straight at camera with eyes open' });
          return;
        }

        vault.holdCount += 1;
        const stability = updateCaptureHold(vault.captureHold, { box, yaw: dy, pitch: dp }, now);
        const pp = Math.min(vault.holdCount / ENV.HOLD_FRAMES, stability) * 100;
        const ob = (phaseIdx / PHASE_LIST.length) * 100;
        const op = Math.min(ob + (pp / PHASE_LIST.length), 100);
        dispatch({ type: 'SET_PROGRESS', payload: { overall: op, phase: pp } });
        dispatch({ type: 'SET_STATUS', payload: `${target.instruction}. Hold steady.` });

        if (vault.holdCount >= ENV.HOLD_FRAMES && stability === 1) {
          // Match attendance's dlib-aligned crop and keep image/landmarks on the same frozen frame.
          const desc = await readConsistentDescriptor(lm, isActive);
          if (!desc) return;
          vault.enrollmentAnchor ||= desc;
          const img = frame.toDataURL('image/jpeg', 0.9);
          const capture = {
            phase: target.label,
            image: img,
            descriptor: desc,
            pose: { yaw: dy, pitch: dp, roll: pose.roll },
          };
          dispatch({ type: 'PUSH_CAPTURE', payload: capture });
          playSound('phase');
          haptic('phase');

          vault.holdCount = 0;
          resetCaptureHold(vault.captureHold);
          const nextIdx = phaseIdx + 1;

          if (nextIdx >= PHASE_LIST.length) {
            loopRef.current?.stop();
            loopRef.current = null;
            dispatch({ type: 'SET_MODE', payload: MODES.VALIDATING });
            dispatch({ type: 'SET_STATUS', payload: 'Capture complete. Verifying registration...' });
            dispatch({ type: 'SET_PROGRESS', payload: { overall: 100, phase: 100 } });
          } else {
            vault.phaseIdx = nextIdx;
            dispatch({ type: 'SET_PHASE', payload: nextIdx });
            dispatch({ type: 'SET_PROGRESS', payload: { overall: op, phase: 0 } });
            dispatch({ type: 'SET_STATUS', payload: PHASE_LIST[nextIdx].instruction });
          }
        }
      } else {
        vault.holdCount = 0;
        resetCaptureHold(vault.captureHold);
        dispatch({ type: 'SET_PROGRESS', payload: { overall: (phaseIdx / PHASE_LIST.length) * 100, phase: 0 } });
        dispatch({ type: 'SET_STATUS', payload: target.instruction });
      }
    }, { intervalMs: ENV.DETECTION_INTERVAL_MS, onError: error => {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      stopHardwareStream(streamRef.current);
      streamRef.current = null;
      vault.holdCount = 0;
      resetBlinkCycle(vault.blinkState);
      dispatch({ type: 'SET_ERROR', payload: {
        message: error?.code?.startsWith('BLINK_') ? 'Blink detection interrupted. Reload this page to retry.' : error?.code === 'FACE_PROCESSING_TIMEOUT' ? 'Face processing timed out. Reload this page to retry.' : 'Face tracking interrupted. Restart registration to retry.',
        code: error?.code || 'FACE_PROCESSING_FAILED',
      } });
    } });
  }, [vault]);

  const startEnrollment = useCallback(() => {
    dispatch({ type: 'SET_MODE', payload: MODES.CALIBRATING });
    dispatch({ type: 'SET_STATUS', payload: 'Calibrating neutral position...' });
    dispatch({ type: 'SET_PHASE', payload: -1 });
    dispatch({ type: 'SET_PROGRESS', payload: { overall: 0, phase: 0 } });

    vault.processing = false;
    vault.holdCount = 0;
    vault.calibrationSamples = [];
    vault.baseline = null;
    vault.blinkCount = 0;
    vault.blinkState = null;
    vault.phaseIdx = 0;

    startLoop();
  }, [vault, startLoop]);

  const handleReset = useCallback(async () => {
    loopRef.current?.stop();
    loopRef.current = null;
    vault.processing = false;
    vault.holdCount = 0;
    vault.calibrationSamples = [];
    vault.baseline = null;
    vault.blinkCount = 0;
    vault.blinkState = null;
    vault.phaseIdx = 0;
    if (!state.modelsLoaded || state.error?.code === 'FACE_PROCESSING_TIMEOUT' || state.error?.code?.startsWith('BLINK_')) { window.location.reload(); return; }
    dispatch({ type: 'RESET' });
    if (!streamRef.current?.active || state.mode === MODES.ERROR || videoRef.current?.paused) {
      dispatch({ type: 'SET_MODE', payload: MODES.BOOT });
      dispatch({ type: 'SET_STATUS', payload: 'Starting camera...' });
      try { if (!await startCameraStream(cameraFacing)) return; }
      catch {
        dispatch({ type: 'SET_ERROR', payload: { message: 'Camera could not start. Check permissions and retry.', code: 'CAMERA_RESTART_FAILED' } });
        return;
      }
    }
    dispatch({ type: 'SET_MODE', payload: MODES.READY });
    dispatch({ type: 'SET_STATUS', payload: 'Press Start Registration when ready' });
  }, [vault, state.modelsLoaded, state.mode, state.error?.code, startCameraStream, cameraFacing]);

  // Session timeout handler
  useEffect(() => {
    clearTimeout(sessionTimerRef.current);
    if (state.mode === MODES.CALIBRATING || state.mode === MODES.ENROLLING) {
      sessionTimerRef.current = setTimeout(() => {
        toast.error('Enrollment session timed out.');
        handleReset();
      }, ENV.ENROLL_TIMEOUT_MS);
    }
    return () => clearTimeout(sessionTimerRef.current);
  }, [state.mode, handleReset]);

  const handleLogout = useCallback(async () => {
    cameraRequestRef.current++;
    loopRef.current?.stop();
    stopHardwareStream(streamRef.current);
    await performLogout('/login');
  }, []);

  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/biometric-setup' }} />;
  }

  if (user.requires_password_change) {
    return <Navigate to="/force-password-change" replace />;
  }

  if (isSecurity(user)) {
    return <Navigate to="/scanner" replace />;
  }

  if (isAdmin(user)) {
    return <Navigate to="/" replace />;
  }

  const hasBiometrics = Boolean(user.has_registered_biometrics || user.biometric_baseline_path);
  if (hasBiometrics || isMedicalExempt(user) || isBiometricSetupTestAccess(user)) {
    return <Navigate to="/employee/dashboard" replace />;
  }

  const displayName = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Authorized Staff';
  const activePhase = state.currentPhaseIdx >= 0 ? PHASE_LIST[state.currentPhaseIdx] : null;
  const doneCount = state.captured.length;

  return (
    <div className="h-[100dvh] w-screen bg-slate-950 text-white flex flex-col justify-between items-center p-3 sm:p-5 relative overflow-hidden font-sans select-none">
      
      {/* Header bar */}
      <div className="w-full max-w-[420px] z-10 pt-1 sm:pt-2 text-center relative">
        <div className="absolute left-0 top-1 sm:top-2">
          <BackButton fallback="/employee/dashboard" variant="dark" compact label="Exit Setup" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-slate-900 border border-slate-800 rounded-sm text-[10px] font-medium text-slate-300 tracking-wide uppercase mb-1">
          <i className={`ti ${state.isOnline ? 'ti-wifi' : 'ti-wifi-off'} text-xs ${state.isOnline ? 'text-ink' : 'text-danger'}`} />
          {deviceInfo.isMobile ? 'Mobile Station' : 'Workstation'}
        </div>
        <h1 className="text-base sm:text-lg font-bold text-white">Face Scan Registration</h1>
        <p className="text-slate-400 text-xs truncate max-w-full">
          Employee: <span className="font-medium text-slate-200">{displayName}</span>
        </p>
      </div>

      {/* 5-Phase Steps Indicator */}
      <div className="w-full max-w-[340px] z-10 flex items-center justify-center gap-2 my-1">
        {PHASE_LIST.map((ph, i) => {
          const isDone = i < doneCount;
          const isActive = i === state.currentPhaseIdx && state.mode !== MODES.SUCCESS;
          return (
            <div key={ph.id} aria-label={`${ph.label}${isDone ? ' captured' : isActive ? ' current' : ''}`} aria-current={isActive ? 'step' : undefined} className="flex items-center gap-1.5">
              <div 
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md flex items-center justify-center text-xs font-semibold transition-colors duration-100 border ${
                  isDone ? 'bg-ink-subtle border-line text-white' :
                  isActive ? 'bg-accent border-accent text-white' : 'bg-slate-900 text-slate-500 border-slate-800'
                }`}
              >
                {isDone ? <i className="ti ti-check text-xs" /> : i + 1}
              </div>
              {i < PHASE_LIST.length - 1 && (
                <div className={`w-2 h-0.5 rounded-sm ${isDone ? 'bg-ink-subtle' : 'bg-slate-800'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Camera Viewport */}
      <div data-camera-viewport="registration" className="relative z-10 w-full max-w-[360px] min-h-0 flex-1 max-h-[54dvh] sm:max-h-[58dvh] aspect-[3/4] sm:aspect-[4/5] bg-black rounded-lg overflow-hidden shadow-xl border border-slate-800 my-auto flex items-center justify-center">
        
        {/* Mirrored / Normal Video Stream */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className={`absolute inset-0 w-full h-full object-contain ${cameraFacing === 'user' ? 'scale-x-[-1]' : 'scale-x-100'}`}
        />
        <canvas 
          ref={canvasRef} 
          className={`absolute inset-0 w-full h-full object-contain pointer-events-none z-10 ${cameraFacing === 'user' ? 'scale-x-[-1]' : 'scale-x-100'}`}
        />

        {/* Camera Flip Button */}
        {[MODES.CALIBRATING, MODES.ENROLLING].includes(state.mode) && (
          <button type="button" onClick={handleReset} aria-label="Restart face registration" className="absolute top-3 left-3 z-30 h-8 px-2.5 rounded-md bg-slate-900/90 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer">
            Restart
          </button>
        )}
        <button
          type="button"
          onClick={toggleCameraFacing}
          disabled={cameraStarting || ![MODES.READY, MODES.ERROR].includes(state.mode)}
          className="absolute top-3 right-3 z-30 h-8 px-2.5 rounded-md bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700/50 shadow-2xs transition-colors duration-100 flex items-center gap-1.5 text-xs font-medium cursor-pointer"
          title="Flip Camera (Front / Rear)"
        >
          <i className="ti ti-camera-rotate text-sm text-accent-on-dark" />
          <span className="text-[10px] hidden sm:inline capitalize">
            {cameraFacing === 'user' ? 'Front' : 'Rear'}
          </span>
        </button>

        {/* Boot & Ready Overlays */}
        {(state.mode === MODES.BOOT || state.mode === MODES.READY) && (
          <div className="absolute inset-0 z-20 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
            {state.mode === MODES.BOOT ? (
              <>
                <div className="w-8 h-8 border-2 border-slate-700 border-t-accent rounded-full animate-spin mb-3" />
                <p className="font-medium text-slate-200 text-xs sm:text-sm">{state.statusText}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Loading face scanner...</p>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center text-accent-on-dark text-xl mb-3">
                  <i className="ti ti-face-id" />
                </div>
                <h2 className="text-base font-bold text-white mb-1">Face Registration</h2>
                <p className="text-slate-400 text-xs mb-5 max-w-[240px] leading-relaxed">
                  Follow the guide through 5 angles. Close both eyes briefly, then reopen; a tone confirms closure.
                </p>
                <button
                  onClick={startEnrollment}
                  disabled={cameraStarting}
                  className="w-full max-w-[200px] h-10 bg-accent hover:bg-accent text-white rounded-md font-semibold text-xs transition-colors duration-100 shadow-2xs cursor-pointer"
                >
                  Start Registration
                </button>
                <button 
                  onClick={handleLogout} 
                  className="mt-3 text-slate-400 hover:text-slate-200 text-xs transition-colors duration-100 cursor-pointer"
                >
                  Cancel &amp; Sign Out
                </button>
              </>
            )}
          </div>
        )}

        {/* Live Active Scanning HUD */}
        {(state.mode === MODES.ENROLLING || state.mode === MODES.CALIBRATING) && (
          <>
            {/* Direction Hint Badge */}
            {activePhase && state.mode === MODES.ENROLLING && (
              <div 
                key={activePhase.id} 
                className="absolute z-20 pointer-events-none" 
                style={{
                  top: activePhase.id === 3 ? '15%' : activePhase.id === 4 ? '78%' : '50%',
                  left: activePhase.id === 1 ? '14%' : activePhase.id === 2 ? '86%' : '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="w-8 h-8 rounded-md bg-accent text-white flex items-center justify-center text-base font-bold shadow-2xs">
                  {activePhase.id === 0 ? '•' : activePhase.id === 1 ? '←' : activePhase.id === 2 ? '→' : activePhase.id === 3 ? '↑' : '↓'}
                </div>
              </div>
            )}

            {/* Circular Progress Ring */}
            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <div className="w-36 h-36 sm:w-40 sm:h-40 relative">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="94" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                  <circle 
                    cx="100" 
                    cy="100" 
                    r="94" 
                    fill="none"
                    stroke={state.phaseProgress >= 100 ? '#22c55e' : '#3b82f6'}
                    strokeWidth="4" 
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 94}`}
                    strokeDashoffset={`${2 * Math.PI * 94 * (1 - state.overallProgress / 100)}`}
                    transform="rotate(-90 100 100)" 
                    className="transition-all duration-150" 
                  />
                </svg>
              </div>
            </div>

          </>
        )}

        {/* Uploading State */}
        {state.mode === MODES.UPLOADING && (
          <div className="absolute inset-0 z-20 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-8 h-8 border-2 border-slate-700 border-t-accent rounded-full animate-spin mb-3" />
            <h3 className="text-sm font-bold text-white">Saving profile</h3>
            <p className="text-slate-400 text-xs mt-0.5">Saving your face scan securely...</p>
          </div>
        )}

        {/* Success State */}
        {state.mode === MODES.SUCCESS && (
          <div 
            className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="w-10 h-10 rounded-md bg-ink-subtle text-white flex items-center justify-center text-lg shadow-2xs mb-3">
              <i className="ti ti-check" />
            </div>
            <h3 className="text-base font-bold text-white">Face scan registered successfully</h3>
            <p className="text-slate-400 text-xs mt-0.5">Redirecting to your workspace...</p>
          </div>
        )}

        {/* Error State */}
        {state.mode === MODES.ERROR && (
          <div 
            className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-5 text-center"
          >
            <div className="w-10 h-10 rounded-md bg-danger/10 text-danger border border-danger/20 flex items-center justify-center text-lg mb-2">
              <i className="ti ti-alert-triangle" />
            </div>
            <h3 className="text-sm font-bold text-white">Registration incomplete</h3>
            <p role="alert" className="text-slate-400 text-xs mt-0.5 max-w-[240px] leading-snug">{state.error?.message || 'Could not complete face scan. Please try again.'}</p>
            <button 
              onClick={handleReset}
              className="mt-4 h-9 px-4 bg-slate-800 hover:bg-slate-700 text-white rounded-md font-medium text-xs transition-colors duration-100 cursor-pointer"
            >
              {state.error?.code === 'FACE_PROCESSING_TIMEOUT' || state.error?.code?.startsWith('BLINK_') ? 'Reload Registration' : 'Try Again'}
            </button>
          </div>
        )}
      </div>

      {[MODES.CALIBRATING, MODES.ENROLLING].includes(state.mode) && (
        <div data-blink-feedback="registration" className="w-full max-w-[360px] shrink-0 my-2 z-10 px-3 py-2 bg-slate-900/95 border border-slate-800 rounded-md text-center">
          <div className="flex items-center justify-between gap-3 text-[11px] font-medium mb-1.5">
            <span className={state.confidence > 0 ? 'text-emerald-300' : 'text-slate-400'}>{state.confidence > 0 ? 'Face detected' : 'Finding face'}</span>
            <span className="text-slate-200 tabular-nums">Capture readiness: {Math.round(state.phaseProgress)}%</span>
          </div>
          <div role="progressbar" aria-label="Current angle capture readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.phaseProgress)} className="h-1 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full bg-emerald-400" style={{ width: `${state.phaseProgress}%` }} />
          </div>
          <div className="mt-1.5"><BlinkStatus phase={state.confidence > 0 ? state.blinkPhase : 'PAUSED'} /></div>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-xs font-medium text-white mt-1.5">{state.statusText}</p>
        </div>
      )}

      {/* Bottom Footer Details */}
      <div className="w-full max-w-[360px] z-10 pb-1 text-center flex items-center justify-between px-2 text-[10px] text-slate-500">
        <span>C-Point HRIS</span>
        <span>Gate pass</span>
      </div>

    </div>
  );
}
