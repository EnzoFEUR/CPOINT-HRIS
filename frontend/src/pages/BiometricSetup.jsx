import React, { useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate, Navigate } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWithAuth } from '../utils/api';
import { compressImage } from '../utils/imageCompress';
import { requestHardwareCamera, stopHardwareStream, getDeviceCameraMetrics } from '../utils/hardwareCamera';

// Primary CDN with high reliability and fallback
const MODEL_SOURCES = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/',
  '/models'
];

const ENV = {
  API_BASE: import.meta.env?.VITE_API_BASE || '/api',
  ENROLL_TIMEOUT_MS: parseInt(import.meta.env?.VITE_ENROLL_TIMEOUT_MS, 10) || 120_000,
  HOLD_FRAMES: 8,
  CALIBRATION_FRAMES: 12,
  DETECTION_INTERVAL_MS: 120,
  DETECTION_INPUT_SIZE: 320,
  FACE_CONFIDENCE_MIN: 0.55,
  FACE_WIDTH_MIN_PX: 45,
  BLINK_EAR_THRESHOLD: 0.26,
  BLINK_CONSEC_FRAMES: 1,
  REQUIRED_BLINKS: 1,
  DESC_CONSISTENCY_THRESHOLD: 0.52,
};

const POSE = Object.freeze({
  CENTER: { id: 0, label: 'CENTER', instruction: 'Look straight at camera', color: '#3b82f6', yaw: 0.00, pitch: 0.00, yawTol: 0.12, pitchTol: 0.14 },
  LEFT:   { id: 1, label: 'LEFT',   instruction: 'Turn head slowly LEFT',   color: '#8b5cf6', yaw: 0.28, pitch: 0.00, yawTol: 0.12, pitchTol: 0.18 },
  RIGHT:  { id: 2, label: 'RIGHT',  instruction: 'Turn head slowly RIGHT',  color: '#06b6d4', yaw: -0.28, pitch: 0.00, yawTol: 0.12, pitchTol: 0.18 },
  UP:     { id: 3, label: 'UP',     instruction: 'Tilt chin slightly UP',   color: '#f59e0b', yaw: 0.00, pitch: -0.14, yawTol: 0.18, pitchTol: 0.18 },
  DOWN:   { id: 4, label: 'DOWN',   instruction: 'Tilt chin slightly DOWN', color: '#ef4444', yaw: 0.00, pitch: 0.14, yawTol: 0.18, pitchTol: 0.18 },
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

const getEAR = (landmarks) => {
  const p = landmarks?.positions;
  if (!p || p.length < 68) return 1.0;
  const calc = (i0, i1, i2, i3, i4, i5) => {
    const v1 = Math.hypot(p[i1].x - p[i5].x, p[i1].y - p[i5].y);
    const v2 = Math.hypot(p[i2].x - p[i4].x, p[i2].y - p[i4].y);
    const h  = Math.hypot(p[i0].x - p[i3].x, p[i0].y - p[i3].y);
    return h === 0 ? 1.0 : (v1 + v2) / (2.0 * h);
  };
  return (calc(36, 37, 38, 39, 40, 41) + calc(42, 43, 44, 45, 46, 47)) / 2.0;
};

const playSound = (type) => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;

    if (type === 'phase') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.start(t); osc.stop(t + 0.12);
    } else if (type === 'success') {
      osc.type = 'triangle';
      [523, 659, 784, 1047].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.2, t + i * 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.25);
        o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.25);
      });
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, t);
      osc.frequency.linearRampToValueAtTime(100, t + 0.35);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    }
  } catch { /* silent */ }
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
    case 'SET_LIVENESS': return { ...state, blinkCount: action.blinkCount, livenessOk: action.livenessOk };
    case 'PUSH_CAPTURE': return { ...state, captured: [...state.captured, action.payload] };
    case 'SET_ERROR': return { ...state, mode: MODES.ERROR, error: action.payload };
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
  const loopRef = useRef(null);
  const abortRef = useRef(null);
  const sessionTimerRef = useRef(null);

  const vault = useRef({
    processing: false,
    holdCount: 0,
    calibrationSamples: [],
    baseline: null,
    blinkCount: 0,
    blinkFrames: 0,
    phaseIdx: 0,
  }).current;

  // Load models from CDN with immediate fallback
  const loadModels = async () => {
    for (const src of MODEL_SOURCES) {
      try {
        console.log('[AI] Loading neural models from:', src);
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(src),
          faceapi.nets.faceLandmark68Net.loadFromUri(src),
          faceapi.nets.faceRecognitionNet.loadFromUri(src),
        ]);
        console.log('[AI] Neural models loaded successfully.');
        return true;
      } catch (err) {
        console.warn('[AI] Failed loading from source:', src, err?.message);
      }
    }
    throw new Error('All model sources failed to load.');
  };

  // Camera boot with hardware ISP & focus controls
  const startCameraStream = useCallback(async (facing = cameraFacing) => {
    if (streamRef.current) {
      stopHardwareStream(streamRef.current);
      streamRef.current = null;
    }
    const stream = await requestHardwareCamera({ facingMode: facing, preferHighFps: true });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('webkit-playsinline', 'true');
      videoRef.current.play().catch(e => console.warn('[Video] Play error:', e));
    }
    return stream;
  }, [cameraFacing]);

  // Lens Switcher (Front ⟷ Rear)
  const toggleCameraFacing = useCallback(async () => {
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    setCameraFacing(nextFacing);
    await startCameraStream(nextFacing);
    toast.success(nextFacing === 'user' ? 'Front Camera Active' : 'Rear Camera Active', {
      id: 'bio-flip',
      duration: 1500,
    });
  }, [cameraFacing, startCameraStream]);

  useEffect(() => {
    let mounted = true;
    let wakeLock = null;

    const boot = async () => {
      try {
        await loadModels();
        if (!mounted) return;
        dispatch({ type: 'SET_MODELS_LOADED' });
        dispatch({ type: 'SET_STATUS', payload: 'Requesting optical sensor...' });

        await startCameraStream();
        if (!mounted) return;

        dispatch({ type: 'SET_CAMERA_READY' });
        dispatch({ type: 'SET_MODE', payload: MODES.READY });
        dispatch({ type: 'SET_STATUS', payload: 'Press Start Registration when ready' });

        if ('wakeLock' in navigator) {
          navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
        }
      } catch (err) {
        console.error('[BOOT]', err);
        const isPermissionDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        const msg = isPermissionDenied 
          ? 'Camera permission denied. Please allow camera access in browser settings.'
          : 'Unable to load camera or facial recognition weights. Please refresh.';
        dispatch({ type: 'SET_ERROR', payload: { message: msg, code: 'BOOT_FAILURE' } });
      }
    };

    boot();

    return () => {
      mounted = false;
      if (loopRef.current) clearInterval(loopRef.current);
      stopHardwareStream(streamRef.current);
      if (abortRef.current) abortRef.current.abort();
      wakeLock?.release().catch(() => {});
    };
  }, [startCameraStream]);

  // Session timeout handler
  useEffect(() => {
    clearTimeout(sessionTimerRef.current);
    if (state.mode === MODES.CALIBRATING || state.mode === MODES.ENROLLING) {
      sessionTimerRef.current = setTimeout(() => {
        toast.error('Enrollment session timed out.');
        handleReset();
      }, ENV.ENROLL_TIMEOUT_MS);
    }
  }, [state.mode]);

  const snapFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const raw = c.toDataURL('image/jpeg', 0.90);
    return await compressImage(raw, { maxWidth: 640, maxHeight: 640, quality: 0.75 });
  };

  const validateAndSubmit = useCallback(async () => {
    const captures = state.captured;
    if (captures.length < PHASE_LIST.length) {
      dispatch({ type: 'SET_ERROR', payload: { message: 'Incomplete sequence. Please retry.', code: 'INCOMPLETE_CAPTURE' } });
      return;
    }

    const descs = captures.map(c => c.descriptor).filter(Boolean);
    if (descs.length >= 2) {
      let maxDist = 0;
      for (let i = 0; i < descs.length; i++) {
        for (let j = i + 1; j < descs.length; j++) {
          const d = faceapi.euclideanDistance(descs[i], descs[j]);
          if (d > maxDist) maxDist = d;
        }
      }
      if (maxDist > ENV.DESC_CONSISTENCY_THRESHOLD) {
        dispatch({ type: 'SET_ERROR', payload: { message: `Inconsistency detected across angles. Please maintain steady posture.`, code: 'IDENTITY_INCONSISTENCY' } });
        playSound('error'); haptic('error');
        return;
      }
    }

    const centerCap = captures.find(c => c.phase === 'CENTER') || captures[0];
    const primaryImage = centerCap.image;

    dispatch({ type: 'SET_MODE', payload: MODES.UPLOADING });
    dispatch({ type: 'SET_STATUS', payload: 'Transmitting encrypted biometric profile...' });

    try {
      const companyId = user.company_id || user.id;
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

      const updated = { ...user, has_registered_biometrics: true };
      localStorage.setItem('user', JSON.stringify(updated));

      setTimeout(() => {
        if (user.role === 'admin') navigate('/');
        else if (user.role === 'security') navigate('/scanner');
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

    const syncCanvas = () => {
      const nw = video.videoWidth, nh = video.videoHeight;
      if (nw && nh && (canvas.width !== nw || canvas.height !== nh)) {
        canvas.width = nw; canvas.height = nh;
      }
    };
    syncCanvas();

    if (loopRef.current) clearInterval(loopRef.current);

    loopRef.current = setInterval(async () => {
      syncCanvas();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({
          inputSize: ENV.DETECTION_INPUT_SIZE,
          scoreThreshold: 0.45,
        }))
        .withFaceLandmarks();

      if (!det) {
        dispatch({ type: 'SET_CONFIDENCE', payload: 0 });
        dispatch({ type: 'SET_POSE', payload: { yaw: 0, pitch: 0, roll: 0, symmetry: 0 } });
        dispatch({ type: 'SET_PROGRESS', payload: { overall: state.overallProgress, phase: Math.max(0, (vault.holdCount / ENV.HOLD_FRAMES) * 100) } });
        dispatch({ type: 'SET_STATUS', payload: 'Center face in frame' });
        return;
      }

      const box = det.detection.box;
      const lm = det.landmarks;
      const score = det.detection.score;
      const pose = estimateHeadPose(lm);

      dispatch({ type: 'SET_CONFIDENCE', payload: Math.round(score * 100) });
      dispatch({ type: 'SET_POSE', payload: pose });

      if (score < ENV.FACE_CONFIDENCE_MIN) {
        dispatch({ type: 'SET_STATUS', payload: 'Hold still and face the light' });
        drawMesh(ctx, lm, box, '#f59e0b', false, pose);
        return;
      }

      if (box.width < ENV.FACE_WIDTH_MIN_PX) {
        dispatch({ type: 'SET_STATUS', payload: 'Move slightly closer' });
        drawMesh(ctx, lm, box, '#f59e0b', false, pose);
        return;
      }

      const ear = getEAR(lm);
      if (ear < ENV.BLINK_EAR_THRESHOLD) {
        vault.blinkFrames += 1;
      } else {
        if (vault.blinkFrames >= ENV.BLINK_CONSEC_FRAMES) {
          vault.blinkCount += 1;
        }
        vault.blinkFrames = 0;
      }
      const livenessOk = vault.blinkCount >= ENV.REQUIRED_BLINKS;
      dispatch({ type: 'SET_LIVENESS', blinkCount: vault.blinkCount, livenessOk });

      // Neutral Calibration Phase
      if (!vault.baseline) {
        drawMesh(ctx, lm, box, '#3b82f6', false, pose);
        vault.calibrationSamples.push(pose);
        dispatch({ type: 'SET_STATUS', payload: `Calibrating position (${vault.calibrationSamples.length}/${ENV.CALIBRATION_FRAMES})` });

        if (vault.calibrationSamples.length >= ENV.CALIBRATION_FRAMES) {
          const avgYaw = vault.calibrationSamples.reduce((s, p) => s + p.yaw, 0) / ENV.CALIBRATION_FRAMES;
          const avgPitch = vault.calibrationSamples.reduce((s, p) => s + p.pitch, 0) / ENV.CALIBRATION_FRAMES;
          vault.baseline = { yaw: avgYaw, pitch: avgPitch };
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

      if (!livenessOk && phaseIdx === 0) {
        dispatch({ type: 'SET_STATUS', payload: 'Blink eyes once to verify liveness' });
        return;
      }

      if (match) {
        vault.holdCount += 1;
        const pp = Math.min((vault.holdCount / ENV.HOLD_FRAMES) * 100, 100);
        const ob = (phaseIdx / PHASE_LIST.length) * 100;
        const op = Math.min(ob + (pp / PHASE_LIST.length), 100);
        dispatch({ type: 'SET_PROGRESS', payload: { overall: op, phase: pp } });
        dispatch({ type: 'SET_STATUS', payload: `${target.instruction} — Hold...` });

        if (vault.holdCount >= ENV.HOLD_FRAMES) {
          const img = await snapFrame();
          if (!img) return;

          const desc = await faceapi.computeFaceDescriptor(video, lm);
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
          const nextIdx = phaseIdx + 1;

          if (nextIdx >= PHASE_LIST.length) {
            clearInterval(loopRef.current);
            loopRef.current = null;
            dispatch({ type: 'SET_MODE', payload: MODES.VALIDATING });
            dispatch({ type: 'SET_STATUS', payload: 'Finalizing biometric baseline...' });
            dispatch({ type: 'SET_PROGRESS', payload: { overall: 100, phase: 100 } });
          } else {
            vault.phaseIdx = nextIdx;
            dispatch({ type: 'SET_PHASE', payload: nextIdx });
            dispatch({ type: 'SET_PROGRESS', payload: { overall: op, phase: 0 } });
            dispatch({ type: 'SET_STATUS', payload: PHASE_LIST[nextIdx].instruction });
          }
        }
      } else {
        dispatch({ type: 'SET_PROGRESS', payload: { overall: state.overallProgress, phase: Math.max(0, (vault.holdCount / ENV.HOLD_FRAMES) * 100) } });
        dispatch({ type: 'SET_STATUS', payload: target.instruction });
      }
    }, ENV.DETECTION_INTERVAL_MS);
  }, [state.overallProgress, vault]);

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
    vault.blinkFrames = 0;
    vault.phaseIdx = 0;

    startLoop();
  }, [vault, startLoop]);

  const handleReset = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current);
    vault.processing = false;
    vault.holdCount = 0;
    vault.calibrationSamples = [];
    vault.baseline = null;
    vault.blinkCount = 0;
    vault.blinkFrames = 0;
    vault.phaseIdx = 0;
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_MODE', payload: MODES.READY });
    dispatch({ type: 'SET_STATUS', payload: 'Press Start Registration when ready' });
  }, [vault]);

  const handleLogout = useCallback(async () => {
    if (loopRef.current) clearInterval(loopRef.current);
    stopHardwareStream(streamRef.current);
    try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* silent */ }
    localStorage.removeItem('user');
    navigate('/login');
  }, [navigate]);

  if (!user) {
    return <Navigate to="/login" replace state={{ from: '/biometric-setup' }} />;
  }

  const displayName = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Authorized Staff';
  const activePhase = state.currentPhaseIdx >= 0 ? PHASE_LIST[state.currentPhaseIdx] : null;
  const activeColor = activePhase?.color || '#3b82f6';
  const doneCount = state.captured.length;

  return (
    <div className="h-[100dvh] w-screen bg-slate-950 text-white flex flex-col justify-between items-center p-3 sm:p-5 relative overflow-hidden font-sans select-none">
      
      {/* Header bar */}
      <div className="w-full max-w-[420px] z-10 pt-1 sm:pt-2 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-0.5 bg-slate-900 border border-slate-800 rounded-full text-[10px] font-medium text-slate-300 tracking-wide uppercase mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${state.isOnline ? 'bg-emerald-400' : 'bg-red-500'}`} />
          {deviceInfo.isMobile ? 'Mobile Station' : 'Workstation'}
        </div>
        <h1 className="text-base sm:text-lg font-bold text-white">Biometric Registration</h1>
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
            <div key={ph.id} className="flex items-center gap-1.5">
              <div 
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all border ${
                  isDone ? 'bg-emerald-600 border-emerald-500 text-white' :
                  isActive ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900 text-slate-500 border-slate-800'
                }`}
              >
                {isDone ? <i className="ti ti-check text-xs" /> : i + 1}
              </div>
              {i < PHASE_LIST.length - 1 && (
                <div className={`w-2 h-0.5 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-slate-800'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Camera Viewport */}
      <div className="relative z-10 w-full max-w-[360px] flex-1 max-h-[54dvh] sm:max-h-[58dvh] aspect-[3/4] sm:aspect-[4/5] bg-black rounded-3xl overflow-hidden shadow-2xl border border-slate-800 my-auto flex items-center justify-center">
        
        {/* Mirrored / Normal Video Stream */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className={`absolute inset-0 w-full h-full object-cover transition-transform duration-300 ${cameraFacing === 'user' ? 'scale-x-[-1]' : 'scale-x-100'}`} 
        />
        <canvas 
          ref={canvasRef} 
          className={`absolute inset-0 w-full h-full object-cover pointer-events-none z-10 transition-transform duration-300 ${cameraFacing === 'user' ? 'scale-x-[-1]' : 'scale-x-100'}`} 
        />

        {/* Camera Flip Button */}
        <button
          type="button"
          onClick={toggleCameraFacing}
          className="absolute top-3 right-3 z-30 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-white/10 shadow-md active:scale-95 transition-all flex items-center gap-1.5 text-xs font-medium tap-active"
          title="Flip Camera (Front / Rear)"
        >
          <i className="ti ti-camera-rotate text-sm text-blue-400" />
          <span className="text-[10px] hidden sm:inline capitalize">
            {cameraFacing === 'user' ? 'Front' : 'Rear'}
          </span>
        </button>

        {/* Boot & Ready Overlays */}
        {(state.mode === MODES.BOOT || state.mode === MODES.READY) && (
          <div className="absolute inset-0 z-20 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
            {state.mode === MODES.BOOT ? (
              <>
                <div className="w-10 h-10 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-3" />
                <p className="font-medium text-slate-200 text-xs sm:text-sm">{state.statusText}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Loading facial recognition models...</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-2xl mb-3">
                  <i className="ti ti-face-id" />
                </div>
                <h2 className="text-base font-bold text-white mb-1">Face Registration</h2>
                <p className="text-slate-400 text-xs mb-5 max-w-[240px] leading-relaxed">
                  Position your face clearly in natural light to complete 5 quick verification angles.
                </p>
                <button 
                  onClick={startEnrollment}
                  className="w-full max-w-[200px] py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white rounded-xl font-bold text-xs transition-all shadow-md shadow-blue-600/20"
                >
                  Start Registration
                </button>
                <button 
                  onClick={handleLogout} 
                  className="mt-3 text-slate-400 hover:text-slate-200 text-xs transition-colors"
                >
                  Cancel & Sign Out
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
              <motion.div 
                key={activePhase.id} 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="absolute z-20 pointer-events-none" 
                style={{
                  top: activePhase.id === 3 ? '15%' : activePhase.id === 4 ? '78%' : '50%',
                  left: activePhase.id === 1 ? '14%' : activePhase.id === 2 ? '86%' : '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center text-lg font-bold shadow-lg">
                  {activePhase.id === 0 ? '◉' : activePhase.id === 1 ? '←' : activePhase.id === 2 ? '→' : activePhase.id === 3 ? '↑' : '↓'}
                </div>
              </motion.div>
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

            {/* Bottom Status Pill */}
            <div className="absolute bottom-3 inset-x-3 z-20 flex justify-center">
              <div className="px-3.5 py-1.5 bg-slate-900/90 border border-slate-800 rounded-full text-center shadow-lg">
                <p className="text-xs font-medium text-white">{state.statusText}</p>
              </div>
            </div>
          </>
        )}

        {/* Uploading State */}
        {state.mode === MODES.UPLOADING && (
          <div className="absolute inset-0 z-20 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-10 h-10 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-3" />
            <h3 className="text-sm font-bold text-white">Saving Profile</h3>
            <p className="text-slate-400 text-xs mt-0.5">Uploading facial baseline to secure database...</p>
          </div>
        )}

        {/* Success State */}
        {state.mode === MODES.SUCCESS && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xl shadow-lg mb-3">
              <i className="ti ti-check" />
            </div>
            <h3 className="text-base font-bold text-white">Registration Complete</h3>
            <p className="text-slate-400 text-xs mt-0.5">Redirecting to your workspace...</p>
          </motion.div>
        )}

        {/* Error State */}
        {state.mode === MODES.ERROR && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-20 bg-slate-950/95 flex flex-col items-center justify-center p-5 text-center"
          >
            <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center text-lg mb-2">
              <i className="ti ti-alert-triangle" />
            </div>
            <h3 className="text-sm font-bold text-white">Registration Incomplete</h3>
            <p className="text-slate-400 text-xs mt-0.5 max-w-[240px] leading-snug">{state.error?.message || 'Biometric scan could not be completed.'}</p>
            <button 
              onClick={handleReset}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium text-xs transition-all"
            >
              Try Again
            </button>
          </motion.div>
        )}
      </div>

      {/* Bottom Footer Details */}
      <div className="w-full max-w-[360px] z-10 pb-1 text-center flex items-center justify-between px-2 text-[10px] text-slate-500">
        <span>C-Point HRIS</span>
        <span>Biometric Gate Pass</span>
      </div>

    </div>
  );
}
