import React, { useState, useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import * as faceapi from 'face-api.js';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWithAuth } from '../utils/api';
import { compressImage } from '../utils/imageCompress';
import { supabase } from '../supabaseClient';
import { requestHardwareCamera, stopHardwareStream } from '../utils/hardwareCamera';

// Scanner configuration
const ENV = {
  MODEL_URL: import.meta.env?.VITE_MODEL_URL || 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/',
  API_BASE: import.meta.env?.VITE_API_BASE || '/api',
  SCAN_TIMEOUT_MS: parseInt(import.meta.env?.VITE_SCAN_TIMEOUT_MS, 10) || 60_000,
  FEEDBACK_DISPLAY_MS: parseInt(import.meta.env?.VITE_FEEDBACK_MS, 10) || 5_000,
  FACE_MATCH_THRESHOLD: 0.42,        // Euclidean distance (lower = stricter)
  REQUIRED_LOCK_FRAMES: 10,
  DETECTION_INTERVAL_MS: 120,
  DETECTION_INPUT_SIZE: 320,
  MIN_FACE_RATIO: 0.08,
  CENTER_THRESHOLD_X: 0.30,
  CENTER_THRESHOLD_Y: 0.35,
  BLINK_EAR_THRESHOLD: 0.26,
  BLINK_CONSEC_FRAMES: 1,
  REQUIRED_BLINKS: 1,
};

// Validation utilities
const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// Eye aspect ratio (ear) — anti-spoofing
const getEAR = (landmarks) => {
  const pts = landmarks?.positions;
  if (!pts || pts.length < 68) return 1.0; // Eyes open by default if landmarks invalid

  const calcEAR = (i0, i1, i2, i3, i4, i5) => {
    const v1 = Math.hypot(pts[i1].x - pts[i5].x, pts[i1].y - pts[i5].y);
    const v2 = Math.hypot(pts[i2].x - pts[i4].x, pts[i2].y - pts[i4].y);
    const h  = Math.hypot(pts[i0].x - pts[i3].x, pts[i0].y - pts[i3].y);
    return h === 0 ? 1.0 : (v1 + v2) / (2.0 * h);
  };

  // Left eye: 36-41, Right eye: 42-47
  return (calcEAR(36, 37, 38, 39, 40, 41) + calcEAR(42, 43, 44, 45, 46, 47)) / 2.0;
};

// Audio and haptic feedback
const playSound = (type) => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;

    if (type === 'scan') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.start(t); osc.stop(t + 0.12);
    } else if (type === 'success') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.setValueAtTime(880, t + 0.08);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.start(t); osc.stop(t + 0.35);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.linearRampToValueAtTime(120, t + 0.35);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.start(t); osc.stop(t + 0.4);
    }
  } catch { /* silent */ }
};

const haptic = (type) => {
  if (!navigator.vibrate) return;
  if (type === 'success') navigator.vibrate([40, 30, 60]);
  else if (type === 'error') navigator.vibrate([80, 50, 80, 50, 120]);
  else navigator.vibrate(30);
};

// Canvas renderer
const drawFaceMesh = (ctx, landmarks, box, state) => {
  const pts = landmarks.positions;
  const palette = {
    scanning: { dot: '#3b82f6', line: 'rgba(59,130,246,0.45)', corner: 'rgba(59,130,246,0.55)' },
    locked:   { dot: '#22c55e', line: 'rgba(34,197,94,0.55)',  corner: 'rgba(34,197,94,0.7)' },
    mismatch: { dot: '#ef4444', line: 'rgba(239,68,68,0.55)',  corner: 'rgba(239,68,68,0.7)' },
  };
  const c = palette[state] || palette.scanning;
  const r = state === 'locked' ? 2.8 : 1.6;
  const lw = state === 'locked' ? 2 : 1;

  ctx.fillStyle = c.dot;
  for (const pt of pts) { ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill(); }

  const drawPath = (indices, close = false) => {
    if (indices.length < 2) return;
    ctx.strokeStyle = c.line; ctx.lineWidth = lw; ctx.beginPath();
    ctx.moveTo(pts[indices[0]].x, pts[indices[0]].y);
    for (let i = 1; i < indices.length; i++) ctx.lineTo(pts[indices[i]].x, pts[indices[i]].y);
    if (close) ctx.closePath();
    ctx.stroke();
  };

  // Jaw, brows, nose, eyes, mouth
  drawPath([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
  drawPath([17,18,19,20,21]);
  drawPath([22,23,24,25,26]);
  drawPath([27,28,29,30]);
  drawPath([31,32,33,34,35]);
  drawPath([36,37,38,39,40,41], true);
  drawPath([42,43,44,45,46,47], true);
  drawPath([48,49,50,51,52,53,54,55,56,57,58,59], true);
  drawPath([60,61,62,63,64,65,66,67], true);

  // Corner bracket
  const { x, y, width: w, height: h } = box;
  const cl = Math.min(32, w * 0.18);
  ctx.strokeStyle = c.corner; ctx.lineWidth = 3; ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
  ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl);
  ctx.moveTo(x + w, y + h - cl); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cl, y + h);
  ctx.moveTo(x + cl, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cl);
  ctx.stroke();
};

// State machine
const MODES = Object.freeze({
  BOOT: 'boot', QR: 'qr', PREP: 'prep', FACE: 'face',
  PROCESSING: 'processing', FEEDBACK: 'feedback', ERROR: 'error', UNAUTHORIZED: 'unauthorized',
  CAMERA_PROMPT: 'camera_prompt',
});

const initialState = {
  mode: MODES.BOOT,
  modelsLoaded: false,
  loadingMsg: 'Starting attendance kiosk...',
  clockTime: '',
  employee: null,
  baselineDescriptor: null,
  employeePhotoUrl: null,
  scanProgress: 0,
  matchScore: null,
  liveness: { blinkCount: 0, status: 'WAITING', ear: null, passed: false },
  feedback: { type: '', title: '', message: '', image: null, requestId: null, code: '' },
  error: null,
  isOnline: navigator.onLine,
  debugMode: false,
  debugInfo: {},
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_MODE': return { ...state, mode: action.payload };
    case 'SET_MODELS_LOADED': return { ...state, modelsLoaded: true, loadingMsg: '' };
    case 'SET_LOADING': return { ...state, loadingMsg: action.payload };
    case 'SET_CLOCK': return { ...state, clockTime: action.payload };
    case 'SET_EMPLOYEE': return { ...state, employee: action.payload };
    case 'SET_BASELINE': return { ...state, baselineDescriptor: action.payload };
    case 'SET_PHOTO': return { ...state, employeePhotoUrl: action.payload };
    case 'SET_PROGRESS': return { ...state, scanProgress: action.payload };
    case 'SET_MATCH': return { ...state, matchScore: action.payload };
    case 'SET_LIVENESS': return { ...state, liveness: { ...state.liveness, ...action.payload } };
    case 'SET_FEEDBACK': return { ...state, mode: MODES.FEEDBACK, feedback: action.payload };
    case 'SET_ERROR': return { ...state, mode: MODES.ERROR, error: action.payload };
    case 'SET_ONLINE': return { ...state, isOnline: action.payload };
    case 'SET_DEBUG_INFO': return { ...state, debugInfo: { ...state.debugInfo, ...action.payload } };
    case 'TOGGLE_DEBUG': return { ...state, debugMode: !state.debugMode };
    case 'RESET': {
      if (state.employeePhotoUrl) URL.revokeObjectURL(state.employeePhotoUrl);
      return {
        ...initialState,
        modelsLoaded: state.modelsLoaded,
        clockTime: state.clockTime,
        isOnline: state.isOnline,
        debugMode: state.debugMode,
      };
    }
    default: return state;
  }
}

// Main component
const Scanner = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showPermHelp, setShowPermHelp] = useState(false);
  const [permTab, setPermTab] = useState('ios');
  
  // Dynamic Device & Orientation Detection
  const [deviceInfo, setDeviceInfo] = useState(() => {
    const isMobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024));
    const isPortrait = typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false;
    return {
      isMobile,
      isPortrait,
      width: typeof window !== 'undefined' ? window.innerWidth : 1280,
      height: typeof window !== 'undefined' ? window.innerHeight : 720,
    };
  });

  // Auth Gate
  const user = useMemo(() => {
    try { 
      const raw = localStorage.getItem('user');
      return (raw && raw !== 'undefined') ? JSON.parse(raw) : { name: 'Gate Guard', role: 'security' }; 
    }
    catch { return { name: 'Gate Guard', role: 'security' }; }
  }, []);

  const role = (user?.role || '').toLowerCase();
  const isAuthorized = role === 'security' || role === 'guard' || role === 'security_guard' || role === 'admin' || role === 'superadmin' || role === 'hr';

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-6">
        <div className="bg-red-950/30 p-10 rounded-3xl shadow-2xl max-w-md text-center border border-red-500/30 backdrop-blur-xl">
          <div className="text-6xl mb-6"><i className="ti ti-lock-square-rounded text-red-500"></i></div>
          <h2 className="text-3xl font-black text-white mb-2 tracking-widest uppercase">Access Denied</h2>
          <p className="text-red-300 text-sm mb-8">Security clearance insufficient.</p>
          <button onClick={() => window.location.href = '/login'} className="py-4 px-8 w-full bg-red-600 hover:bg-red-500 text-white font-bold tracking-widest uppercase rounded-xl transition-all">Sign In</button>
        </div>
      </div>
    );
  }

  // Camera Facing Lens State ('user' = Front Selfie, 'environment' = Back / Rear Guard Mode)
  const [cameraFacing, setCameraFacing] = useState('user');

  // Refs (Mutable Detection State)
  const qrRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectionRef = useRef(null);
  const abortControllerRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const debugHoldTimerRef = useRef(null);

  // Detection vault (immune to React re-renders)
  const vault = useRef({
    processing: false,
    submitLock: false,
    lockFrames: 0,
    blinkCount: 0,
    blinkFrames: 0,
    earHistory: [],
    matchScore: null,
    employeeId: null,
    baseline: null,
    lastUiUpdate: 0,
  }).current;

  // Derived Styles
  const statusMeta = useMemo(() => {
    if (state.mode === MODES.FEEDBACK) {
      return state.feedback.type === 'success'
        ? { color: 'green', ring: '#22c55e', pill: 'bg-emerald-500/25 text-emerald-200 border-emerald-500/40' }
        : { color: 'red', ring: '#ef4444', pill: 'bg-red-500/25 text-red-200 border-red-500/40' };
    }
    const isError = state.matchScore !== null && state.matchScore < 50;
    const isLocked = state.scanProgress >= 100;
    if (isError) return { color: 'red', ring: '#ef4444', pill: 'bg-red-500/25 text-red-200 border-red-500/40' };
    if (isLocked) return { color: 'green', ring: '#22c55e', pill: 'bg-emerald-500/25 text-emerald-200 border-emerald-500/40' };
    return { color: 'blue', ring: '#3b82f6', pill: 'bg-blue-500/25 text-blue-200 border-blue-500/40' };
  }, [state.mode, state.feedback.type, state.matchScore, state.scanProgress]);

  // Pure Image Loader
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  // UI status and throttled dispatch
  const updateStatus = useCallback((text) => {
    if (updateStatus.lastText === text) return;
    updateStatus.lastText = text;
    dispatch({ type: 'SET_DEBUG_INFO', payload: { statusText: text } });
  }, [dispatch]);

  const throttledDispatch = useCallback((updates) => {
    const now = Date.now();
    if (now - vault.lastUiUpdate < 80) return; // ~12fps UI updates
    vault.lastUiUpdate = now;
    if ('scanProgress' in updates) dispatch({ type: 'SET_PROGRESS', payload: updates.scanProgress });
    if ('matchScore' in updates) dispatch({ type: 'SET_MATCH', payload: updates.matchScore });
  }, [vault, dispatch]);

  // Camera Stop Controls
  const stopFaceCamera = useCallback(() => {
    if (detectionRef.current) {
      clearInterval(detectionRef.current);
      detectionRef.current = null;
    }
    stopHardwareStream(streamRef.current);
    streamRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const stopQr = useCallback(() => {
    if (!qrRef.current) return;
    try {
      qrRef.current.stop().then(() => {
        qrRef.current?.clear();
        qrRef.current = null;
      }).catch(() => {});
    } catch {
      qrRef.current?.clear();
      qrRef.current = null;
    }
  }, []);

  // Session Reset
  const handleReset = useCallback(() => {
    stopFaceCamera();
    vault.processing = false;
    vault.submitLock = false;
    vault.lockFrames = 0;
    vault.blinkCount = 0;
    vault.blinkFrames = 0;
    vault.earHistory = [];
    vault.matchScore = null;
    vault.employeeId = null;
    vault.baseline = null;
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_MODE', payload: MODES.QR });
  }, [vault, stopFaceCamera, dispatch]);

  // Capture frame and submit to backend
  const captureAndSubmit = useCallback(async (finalScore, blinkCount, earHistory) => {
    if (vault.submitLock) return;
    vault.submitLock = true;
    dispatch({ type: 'SET_MODE', payload: MODES.PROCESSING });
    dispatch({ type: 'SET_LOADING', payload: 'TRANSMITTING TO SERVER...' });

    // Capture frame
    let img64 = null;
    if (videoRef.current && videoRef.current.videoWidth) {
      const c = document.createElement('canvas');
      c.width = videoRef.current.videoWidth;
      c.height = videoRef.current.videoHeight;
      c.getContext('2d').drawImage(videoRef.current, 0, 0);
      const raw = c.toDataURL('image/jpeg', 0.85);
      img64 = await compressImage(raw, { maxWidth: 640, maxHeight: 640, quality: 0.75 });
    }

    const eid = vault.employeeId;
    if (!eid || !isValidUUID(eid)) {
      dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'SYSTEM ERROR', message: 'Invalid employee session. Scan again.', code: 'INVALID_SESSION' } });
      playSound('error'); haptic('error');
      setTimeout(handleReset, ENV.FEEDBACK_DISPLAY_MS);
      return;
    }

    // Build liveness payload for backend audit
    const livenessPayload = {
      method: 'ear_blink',
      blink_count: blinkCount,
      ear_min: Math.min(...earHistory, 0.5),
      ear_max: Math.max(...earHistory, 0),
      ear_avg: earHistory.reduce((a, b) => a + b, 0) / (earHistory.length || 1),
      confidence: blinkCount >= ENV.REQUIRED_BLINKS ? 0.95 : 0.0,
      client_timestamp: new Date().toISOString(),
    };

    abortControllerRef.current = new AbortController();

    try {
      const res = await fetchWithAuth(`${ENV.API_BASE}/attendance/scan`, {
        method: 'POST',
        signal: abortControllerRef.current.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: eid,
          image_data: img64,
          face_match_score: finalScore ?? vault.matchScore ?? 0,
          liveness_data: livenessPayload,
        }),
      });

      let data;
      try { data = await res.json(); } catch { data = { status: 'error', message: 'Invalid server response' }; }

      if (!res.ok) {
        // Backend returns structured errors: { status, code, message, requestId }
        const errCode = data.code || `HTTP_${res.status}`;
        const reqId = data.requestId || 'unknown';
        let friendly = data.message || 'Verification failed.';

        // Map HTTP status codes to user-friendly messages
        if (res.status === 429) friendly = 'Too many scans. Please wait 60 seconds.';
        else if (res.status === 403) friendly = `SECURITY ALERT: ${friendly}`;
        else if (res.status === 503) friendly = 'Biometric AI engine offline. Contact IT.';
        else if (res.status === 409) friendly = 'Attendance already recorded today.';
        else if (res.status === 404) friendly = 'Employee record not found.';

        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'ACCESS DENIED', message: friendly, requestId: reqId, code: errCode, image: img64 } });
        playSound('error'); haptic('error');
      } else if (data.status === 'success') {
        const isOut = data.code === 'TIME_OUT' || data.message?.toUpperCase().includes('OUT');
        dispatch({ type: 'SET_FEEDBACK', payload: {
          type: 'success',
          title: isOut ? 'CLOCKED OUT' : 'CLOCKED IN',
          message: data.message || 'Attendance recorded.',
          code: data.code,
          image: img64
        }});
        playSound('success'); haptic('success');
      } else {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'UNKNOWN RESPONSE', message: data.message || 'Unexpected server state.', image: img64 } });
        playSound('error'); haptic('error');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'CANCELLED', message: 'Scan was interrupted.', image: img64 } });
      } else {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'OFFLINE', message: 'Cannot reach attendance server. Check network.', image: img64 } });
      }
      playSound('error'); haptic('error');
    }

    setTimeout(handleReset, ENV.FEEDBACK_DISPLAY_MS);
  }, [vault, handleReset, dispatch]);

  // Face Detection Loop
  const runDetectionLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const syncCanvas = () => {
      const nw = video.videoWidth, nh = video.videoHeight;
      if (nw && nh && (canvas.width !== nw || canvas.height !== nh)) {
        canvas.width = nw;
        canvas.height = nh;
      }
    };
    syncCanvas();

    // Reset vault for new session
    vault.lockFrames = 0;
    vault.blinkCount = 0;
    vault.blinkFrames = 0;
    vault.earHistory = [];
    vault.submitLock = false;
    dispatch({ type: 'SET_PROGRESS', payload: 0 });
    dispatch({ type: 'SET_MATCH', payload: null });
    dispatch({ type: 'SET_LIVENESS', payload: { blinkCount: 0, status: 'WAITING', ear: null, passed: false } });

    detectionRef.current = setInterval(async () => {
      syncCanvas();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // TinyFaceDetector for speed
      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({
          inputSize: ENV.DETECTION_INPUT_SIZE,
          scoreThreshold: 0.45
        }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!det) {
        vault.lockFrames = Math.max(0, vault.lockFrames - 2);
        throttledDispatch({ scanProgress: Math.max(0, (vault.lockFrames / ENV.REQUIRED_LOCK_FRAMES) * 100), matchScore: null });
        updateStatus('SEARCHING FOR FACE...');
        return;
      }

      const box = det.detection.box;
      const liveDsc = det.descriptor;
      const nw = canvas.width, nh = canvas.height;

      // Geometry checks
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const centered = Math.abs(cx - nw / 2) < nw * ENV.CENTER_THRESHOLD_X &&
                       Math.abs(cy - nh / 2) < nh * ENV.CENTER_THRESHOLD_Y;
      const bigEnough = box.width >= nw * ENV.MIN_FACE_RATIO;

      // Identity match
      let matched = true;
      let dist = 0;
      let currentScore = 0;

      if (vault.baseline && liveDsc) {
        dist = faceapi.euclideanDistance(vault.baseline, liveDsc);
        matched = dist < ENV.FACE_MATCH_THRESHOLD;
        currentScore = Math.round((1 - dist) * 100);
        vault.matchScore = currentScore;
      } else if (!vault.baseline) {
        // No baseline = photo-only mode (backend will decide if allowed)
        currentScore = 0;
        matched = true;
      }

      if (!centered || !bigEnough) {
        vault.lockFrames = Math.max(0, vault.lockFrames - 1);
        throttledDispatch({ scanProgress: Math.max(0, (vault.lockFrames / ENV.REQUIRED_LOCK_FRAMES) * 100) });
        updateStatus(!bigEnough ? 'MOVE CLOSER TO CAMERA' : 'CENTER YOUR FACE');
        drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        return;
      }

      if (!matched) {
        vault.lockFrames = 0;
        throttledDispatch({ scanProgress: 0, matchScore: currentScore });
        updateStatus(`IDENTITY MISMATCH [${currentScore}%] — ACCESS DENIED`);
        drawFaceMesh(ctx, det.landmarks, box, 'mismatch');
        return;
      }

      // Liveness blink detection
      const ear = getEAR(det.landmarks);
      vault.earHistory.push(ear);
      if (vault.earHistory.length > 50) vault.earHistory.shift();

      if (ear < ENV.BLINK_EAR_THRESHOLD) {
        vault.blinkFrames += 1;
      } else {
        if (vault.blinkFrames >= ENV.BLINK_CONSEC_FRAMES) {
          vault.blinkCount += 1;
        }
        vault.blinkFrames = 0;
      }

      const livenessOk = vault.blinkCount >= ENV.REQUIRED_BLINKS;

      if (!livenessOk) {
        dispatch({ type: 'SET_LIVENESS', payload: { blinkCount: vault.blinkCount, status: 'BLINK_TO_VERIFY', ear } });
        updateStatus('BLINK YOUR EYES TO VERIFY LIVENESS');
        drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        return;
      }

      dispatch({ type: 'SET_LIVENESS', payload: { blinkCount: vault.blinkCount, status: 'PASSED', ear, passed: true } });

      // Lock-in progression
      vault.lockFrames += 1;
      const progress = Math.min((vault.lockFrames / ENV.REQUIRED_LOCK_FRAMES) * 100, 100);
      throttledDispatch({ scanProgress: progress, matchScore: currentScore });

      if (vault.lockFrames >= ENV.REQUIRED_LOCK_FRAMES) {
        clearInterval(detectionRef.current);
        detectionRef.current = null;
        updateStatus(`IDENTITY CONFIRMED [${currentScore}%]`);
        drawFaceMesh(ctx, det.landmarks, box, 'locked');
        captureAndSubmit(currentScore, vault.blinkCount, vault.earHistory);
      } else {
        updateStatus(vault.baseline
          ? `VERIFYING [${vault.lockFrames}/${ENV.REQUIRED_LOCK_FRAMES}]`
          : `LOCKING [${vault.lockFrames}/${ENV.REQUIRED_LOCK_FRAMES}]`);
        drawFaceMesh(ctx, det.landmarks, box, 'scanning');
      }
    }, ENV.DETECTION_INTERVAL_MS);
  }, [vault, dispatch, throttledDispatch, updateStatus, captureAndSubmit]);

  // Face Camera Starter with Hardware Sensor Controls
  const startFaceCamera = useCallback(async (facing = cameraFacing) => {
    dispatch({ type: 'SET_LOADING', payload: 'Starting camera...' });
    try {
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
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play().catch(e => console.warn('[Video] Play error:', e));
          dispatch({ type: 'SET_LOADING', payload: '' });
          runDetectionLoop();
        };
      }
    } catch {
      toast.error('Camera access denied');
      dispatch({ type: 'SET_ERROR', payload: { message: 'Camera access denied. Enable permissions.', code: 'CAMERA_DENIED' } });
    }
  }, [cameraFacing, runDetectionLoop, dispatch]);

  // Flip Camera Lens (Front ⟷ Rear)
  const toggleCameraFacing = useCallback(async () => {
    playSound('scan');
    haptic('scan');
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    setCameraFacing(nextFacing);
    if (detectionRef.current) {
      clearInterval(detectionRef.current);
      detectionRef.current = null;
    }
    toast.success(nextFacing === 'user' ? 'Front Camera Active' : 'Rear Camera Active', {
      id: 'camera-flip',
      duration: 1500,
    });
    await startFaceCamera(nextFacing);
  }, [cameraFacing, startFaceCamera]);

  // QR Success Handler
  const onQrSuccess = useCallback(async (text) => {
    if (vault.processing) return;
    vault.processing = true;
    playSound('scan');
    haptic('scan');
    dispatch({ type: 'SET_LOADING', payload: 'Verifying employee...' });

    const companyId = text.trim();

    try {
      // 1. Fast employee lookup via backend
      const res = await fetchWithAuth(`/api/attendance/verify-qr/${companyId}`);
      const data = await res.json();
      
      if (!res.ok || data.status !== 'success') {
        throw new Error('EMPLOYEE_NOT_FOUND');
      }
      
      const emp = data.data;

      if (!emp.is_active) {
        throw new Error('EMPLOYEE_INACTIVE');
      }

      vault.employeeId = emp.id;
      dispatch({ type: 'SET_EMPLOYEE', payload: emp });
      dispatch({ type: 'SET_MODE', payload: MODES.PREP });

      // Fast-path: If employee has no registered biometrics, immediately proceed with zero delay
      if (!emp.has_registered_biometrics) {
        vault.baseline = null;
        dispatch({ type: 'SET_BASELINE', payload: null });
        dispatch({ type: 'SET_PHOTO', payload: emp.avatar_url || null });
        dispatch({ type: 'SET_LOADING', payload: '' });
        return;
      }

      // 2. High-speed baseline load with 3.5s timeout protection
      const storagePath = emp.biometric_baseline_path || `face-baselines/${emp.company_id}/${emp.id}.jpg`;
      const { data: urlData } = supabase.storage
        .from('public-bucket')
        .getPublicUrl(storagePath);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const imgRes = await fetch(`${urlData.publicUrl}?t=${Date.now()}`, { 
          cache: 'no-store',
          signal: controller.signal 
        });
        clearTimeout(timeoutId);

        if (!imgRes.ok) throw new Error('BASELINE_NOT_FOUND');

        const blob = await imgRes.blob();
        const url = URL.createObjectURL(blob);
        dispatch({ type: 'SET_PHOTO', payload: url });

        // 3. Fast face descriptor extraction using lightweight TinyFaceDetector (15x faster)
        dispatch({ type: 'SET_LOADING', payload: 'Loading facial profile...' });
        const img = await loadImage(url);

        let det = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!det?.descriptor) {
          // Fallback to SsdMobilenetv1 only if tiny detector missed
          det = await faceapi
            .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.1 }))
            .withFaceLandmarks()
            .withFaceDescriptor();
        }

        if (det?.descriptor) {
          vault.baseline = det.descriptor;
          dispatch({ type: 'SET_BASELINE', payload: det.descriptor });
        } else {
          vault.baseline = null;
          dispatch({ type: 'SET_BASELINE', payload: null });
        }
      } catch (baselineErr) {
        console.warn('[QR_FLOW] Baseline image skipped or timed out:', baselineErr);
        vault.baseline = null;
        dispatch({ type: 'SET_BASELINE', payload: null });
        dispatch({ type: 'SET_PHOTO', payload: emp.avatar_url || null });
      }

      dispatch({ type: 'SET_LOADING', payload: '' });
    } catch (err) {
      console.error('[QR_FLOW]', err);
      vault.baseline = null;
      dispatch({ type: 'SET_BASELINE', payload: null });
      dispatch({ type: 'SET_LOADING', payload: '' });
      dispatch({ type: 'SET_MODE', payload: MODES.PREP });
      toast.error(err.message === 'EMPLOYEE_NOT_FOUND' ? 'Invalid ID card.' :
                  err.message === 'EMPLOYEE_INACTIVE' ? 'Account deactivated.' :
                  'Identification error.');
    }
  }, [vault, dispatch]);

  // QR scanner initialization
  const startQr = useCallback(async (isUserGesture = false) => {
    if (qrRef.current) return;
    dispatch({ type: 'SET_LOADING', payload: 'CONNECTING OPTICAL CAMERA...' });

    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024);
    const isPortrait = window.innerHeight > window.innerWidth;

    // When explicitly triggered by user tap, trigger explicit getUserMedia to prompt OS permission dialog
    if (isUserGesture && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isMobile ? { facingMode: { ideal: 'environment' } } : { facingMode: 'user' },
          audio: false
        });
        stream.getTracks().forEach(t => t.stop());
      } catch (permErr) {
        console.warn('[Scanner] Explicit user camera permission error:', permErr);
        if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
          toast.error('Camera permission was denied. Tap help to enable.');
          setShowPermHelp(true);
          dispatch({ type: 'SET_MODE', payload: MODES.CAMERA_PROMPT });
          dispatch({ type: 'SET_LOADING', payload: '' });
          return;
        }
      }
    }

    try {
      qrRef.current = new Html5Qrcode('qr-reader');
      
      const qrConfig = { 
        fps: isMobile ? 20 : 30, 
        disableFlip: !isMobile, // Don't flip back camera, flip front camera on desktop
        formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ],
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        },
        videoConstraints: isMobile ? {
          facingMode: { ideal: 'environment' },
          width: { ideal: isPortrait ? 1080 : 1920 },
          height: { ideal: isPortrait ? 1920 : 1080 },
          aspectRatio: { ideal: isPortrait ? (window.innerWidth / (window.innerHeight || 1)) : 1.7777777778 }
        } : {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 1.7777777778 }
        }
      };

      // Try preferred camera first (back on mobile, webcam on desktop)
      try {
        await qrRef.current.start(
          isMobile ? { facingMode: { ideal: 'environment' } } : { facingMode: 'user' },
          qrConfig,
          onQrSuccess,
          () => {} // ignore decode failures
        );
        dispatch({ type: 'SET_MODE', payload: MODES.QR });
        dispatch({ type: 'SET_LOADING', payload: '' });
      } catch (primaryCamErr) {
        console.warn('[Scanner] Primary camera unavailable, trying fallback camera:', primaryCamErr);
        await qrRef.current.start(
          isMobile ? { facingMode: 'user' } : { facingMode: { ideal: 'environment' } },
          { 
            fps: 20, 
            disableFlip: false, 
            formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ] 
          },
          onQrSuccess,
          () => {}
        );
        dispatch({ type: 'SET_MODE', payload: MODES.QR });
        dispatch({ type: 'SET_LOADING', payload: '' });
      }
    } catch (err) {
      console.warn('[Scanner] Automated camera start paused (permission required on mobile):', err);
      try { qrRef.current?.clear(); } catch {}
      qrRef.current = null;
      dispatch({ type: 'SET_LOADING', payload: '' });
      // Transition to clean permission prompt screen for mobile devices
      dispatch({ type: 'SET_MODE', payload: MODES.CAMERA_PROMPT });
    }
  }, [onQrSuccess, dispatch]);

  // Mode Lifecycle
  useEffect(() => {
    if (state.mode === MODES.QR && state.modelsLoaded) {
      startQr(false);
    }
    if (state.mode !== MODES.QR) {
      stopQr();
    }
    if (state.mode === MODES.FACE) {
      startFaceCamera();
    }

    // Session safety timer
    clearTimeout(sessionTimerRef.current);
    if (state.mode === MODES.PREP || state.mode === MODES.FACE) {
      sessionTimerRef.current = setTimeout(() => {
        toast.error('Session timed out. Returning to scanner.');
        handleReset();
      }, ENV.SCAN_TIMEOUT_MS);
    }
  }, [state.mode, state.modelsLoaded, startQr, stopQr, startFaceCamera, handleReset]);

  // Initialize models, clock, and viewport
  useEffect(() => {
    let mounted = true;
    let wakeLock = null;

    // Load models
    (async () => {
      try {
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(ENV.MODEL_URL),
          faceapi.nets.tinyFaceDetector.loadFromUri(ENV.MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(ENV.MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(ENV.MODEL_URL),
        ]);
        if (mounted) {
          dispatch({ type: 'SET_MODELS_LOADED' });
          dispatch({ type: 'SET_MODE', payload: MODES.QR });
        }
      } catch (err) {
        console.error('[BOOT]', err);
        toast.error('Neural net failed to load. Check network.');
        dispatch({ type: 'SET_ERROR', payload: { message: 'Failed to load AI models. Refresh to retry.', code: 'MODEL_LOAD_ERROR' } });
      }
    })();

    // Dynamic Orientation & Resize Listener
    const handleViewportChange = () => {
      const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024);
      const isPortrait = window.innerHeight > window.innerWidth;
      setDeviceInfo({
        isMobile,
        isPortrait,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);

    // Clock
    const tick = setInterval(() => {
      dispatch({ type: 'SET_CLOCK', payload: new Date().toLocaleTimeString('en-US', { hour12: false }) });
    }, 1000);

    // Online status
    const onOnline = () => dispatch({ type: 'SET_ONLINE', payload: true });
    const onOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Dynamic Responsive Camera CSS
    const style = document.createElement('style');
    style.id = 'scanner-css';
    style.textContent = `
      #qr-reader {
        width: 100vw !important;
        height: 100dvh !important;
        overflow: hidden !important;
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: #000 !important;
      }
      #qr-reader video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
        position: absolute !important;
        inset: 0 !important;
      }
      #qr-reader__dashboard_section_csr, #qr-reader__dashboard_section_swaplink,
      #qr-reader__status_span, #qr-reader__header_message { display:none!important; }
    `;
    document.head.appendChild(style);

    // Wake lock (keep screen on)
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
    }

    return () => {
      mounted = false;
      clearInterval(tick);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.getElementById('scanner-css')?.remove();
      wakeLock?.release().catch(() => {});
    };
  }, []);

  // Debug Mode Trigger (hold top-left 3s)
  const handleDebugTouchStart = () => {
    debugHoldTimerRef.current = setTimeout(() => {
      dispatch({ type: 'TOGGLE_DEBUG' });
      toast(state.debugMode ? 'Debug mode OFF' : 'Debug mode ON');
    }, 3000);
  };
  const handleDebugTouchEnd = () => clearTimeout(debugHoldTimerRef.current);

  // RENDER
  return (
    <div className="h-[100dvh] w-screen bg-black text-white relative overflow-hidden font-sans select-none">

      {/* Debug corner trigger */}
      <div
        className="absolute top-0 left-0 w-16 h-16 z-[60] opacity-0"
        onMouseDown={handleDebugTouchStart}
        onMouseUp={handleDebugTouchEnd}
        onMouseLeave={handleDebugTouchEnd}
        onTouchStart={handleDebugTouchStart}
        onTouchEnd={handleDebugTouchEnd}
      />

      {/* MODE: QR */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${state.mode === MODES.QR ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
        <div id="qr-reader" className="w-full h-full" />
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center overflow-hidden px-4">
          <div className="absolute top-20 text-center">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white drop-shadow-sm">Scan Employee Badge</h2>
            <p className="text-xs text-slate-400 mt-0.5">Hold QR code steady in front of camera</p>
          </div>
          <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 shadow-[0_0_0_4000px_rgba(0,0,0,0.60)] rounded-2xl border border-white/20 overflow-hidden flex-shrink-0">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
          </div>
          <p className="absolute bottom-28 text-slate-400 font-mono text-xs tracking-wider uppercase">Align badge within corners</p>
        </div>
      </div>

      {/* MODE: CAMERA PROMPT (Mobile User Gesture Activation) */}
      <AnimatePresence>
        {state.mode === MODES.CAMERA_PROMPT && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-5 select-none"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col items-center w-full max-w-sm p-7 text-center relative overflow-hidden"
            >
              {/* Camera Icon Badge */}
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4 text-2xl">
                <i className="ti ti-camera" />
              </div>

              <h2 className="text-xl font-bold text-white tracking-tight mb-1.5">
                Enable Camera Access
              </h2>
              <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                Attendance gate requires camera access to scan employee badges and verify photo identity.
              </p>

              <button
                onClick={() => startQr(true)}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold tracking-wide text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
              >
                <i className="ti ti-camera" />
                <span>Allow Camera</span>
              </button>

              <button
                onClick={() => setShowPermHelp(true)}
                className="mt-3.5 text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1"
              >
                <i className="ti ti-help-circle" /> Troubleshooting Guide
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PERMISSION INSTRUCTIONS MODAL (iOS & Android) */}
      <AnimatePresence>
        {showPermHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.94, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-slate-900 border border-white/10 rounded-[2rem] w-full max-w-md p-6 sm:p-8 flex flex-col text-left shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center text-xl">
                    <i className="ti ti-adjustments-horizontal" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Browser Camera Permissions</h3>
                    <p className="text-[11px] text-slate-400">Step-by-step unblock instructions</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPermHelp(false)}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                >
                  <i className="ti ti-x text-base" />
                </button>
              </div>

              {/* OS Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 rounded-xl mb-5 border border-white/5">
                <button
                  onClick={() => setPermTab('ios')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    permTab === 'ios' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <i className="ti ti-brand-apple" /> iPhone (iOS)
                </button>
                <button
                  onClick={() => setPermTab('android')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    permTab === 'android' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <i className="ti ti-brand-android" /> Android
                </button>
              </div>

              {/* iOS Guide */}
              {permTab === 'ios' && (
                <div className="space-y-3.5 text-xs text-slate-300">
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                    <p>Tap the <span className="font-bold text-white bg-white/10 px-1.5 py-0.5 rounded">aA</span> icon in your Safari address bar.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                    <p>Select <span className="font-bold text-white">Website Settings</span>.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                    <p>Change <span className="font-bold text-white">Camera</span> from Deny to <span className="font-bold text-emerald-400">Allow</span>.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">4</span>
                    <p>Tap <span className="font-bold text-white">Done</span> and tap the button below to start.</p>
                  </div>
                </div>
              )}

              {/* Android Guide */}
              {permTab === 'android' && (
                <div className="space-y-3.5 text-xs text-slate-300">
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                    <p>Tap the <span className="font-bold text-white bg-white/10 px-1.5 py-0.5 rounded">🔒 Lock</span> icon next to the URL.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                    <p>Tap <span className="font-bold text-white">Permissions</span> &rarr; <span className="font-bold text-white">Camera</span>.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                    <p>Switch setting to <span className="font-bold text-emerald-400">Allow</span>.</p>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                    <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">4</span>
                    <p>Return to this page and tap <span className="font-bold text-white">Retry Connection</span>.</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setShowPermHelp(false);
                  startQr(true);
                }}
                className="mt-6 w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold tracking-wider uppercase text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
              >
                <i className="ti ti-refresh" /> Retry Connection
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODE: PREP */}
      <AnimatePresence>
        {state.mode === MODES.PREP && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col items-center w-full max-w-sm p-7 text-center"
            >
              {state.employeePhotoUrl ? (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-2 border-slate-700 mb-4 bg-slate-800">
                  <img src={state.employeePhotoUrl} alt="Baseline" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center mb-4 text-slate-400 text-3xl">
                  <i className="ti ti-user" />
                </div>
              )}
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                {state.employee ? (state.employee.name || `${state.employee.first_name || ''} ${state.employee.last_name || ''}`.trim() || 'Employee') : 'Employee'}
              </h2>
              <span className="inline-block px-2.5 py-0.5 mt-1 rounded-md bg-slate-800 text-slate-300 font-mono text-xs">
                {state.employee?.company_id || 'NO ID'}
              </span>
              <p className="text-slate-400 text-xs mt-3 mb-6 leading-relaxed">
                Please look directly at the camera to verify your clock-in.
              </p>
              <button
                onClick={() => dispatch({ type: 'SET_MODE', payload: MODES.FACE })}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs tracking-wide active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
              >
                <i className="ti ti-face-id text-base" />
                <span>Start Face Verification</span>
              </button>
              <button
                onClick={handleReset}
                className="mt-3 w-full py-2.5 text-slate-400 hover:text-slate-200 text-xs transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODE: FACE */}
      <AnimatePresence>
        {state.mode === MODES.FACE && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 bg-black overflow-hidden">
            <video 
              ref={videoRef} 
              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-300 ${cameraFacing === 'user' ? '-scale-x-100' : 'scale-x-100'}`} 
              playsInline 
              muted 
              autoPlay 
            />
            <canvas 
              ref={canvasRef} 
              className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-transform duration-300 ${cameraFacing === 'user' ? '-scale-x-100' : 'scale-x-100'}`} 
            />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_45%,_rgba(0,0,0,0.6)_100%)] pointer-events-none" />

            {/* Top Control Bar */}
            <div className="absolute top-[max(env(safe-area-inset-top,12px),12px)] inset-x-0 flex items-center justify-between px-4 sm:px-6 z-30 pt-2">
              {/* Cancel Button */}
              <button
                onClick={handleReset}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 active:scale-95 transition-all flex items-center justify-center tap-active"
                title="Cancel Scan"
              >
                <i className="ti ti-x text-base" />
              </button>

              {/* Status Badge */}
              <span className={`px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide border shadow-md ${statusMeta.pill}`}>
                {state.liveness.status === 'BLINK_TO_VERIFY' ? 'Please blink once to verify' :
                 state.liveness.status === 'PASSED' && state.scanProgress < 100 ? 'Liveness confirmed — hold still' :
                 state.scanProgress >= 100 ? 'Processing attendance...' :
                 state.matchScore !== null && state.matchScore < 50 ? 'Photo mismatch' :
                 'Verifying face...'}
              </span>

              {/* Right Controls: Flip Camera + Live Clock */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleCameraFacing}
                  className="px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-white/10 active:scale-95 transition-all flex items-center gap-1.5 text-xs font-medium tap-active"
                  title="Flip Camera (Front / Rear)"
                >
                  <i className="ti ti-camera-rotate text-sm text-blue-400" />
                  <span className="text-[11px] hidden sm:inline capitalize">
                    {cameraFacing === 'user' ? 'Front' : 'Rear'}
                  </span>
                </button>
                <div className="font-mono text-xs font-semibold bg-slate-900/80 text-slate-300 px-2.5 py-1 rounded-lg border border-white/10 tabular-nums hidden sm:block">
                  {state.clockTime}
                </div>
              </div>
            </div>

            {/* Bottom HUD */}
            <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),16px)] flex flex-col items-center">
              {/* Progress Indicator */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center mb-3">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
                  <circle cx="50" cy="50" r="44" fill="none"
                    stroke={statusMeta.ring} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 44}`}
                    strokeDashoffset={`${2 * Math.PI * 44 * (1 - state.scanProgress / 100)}`}
                    className="transition-all duration-200 ease-out"
                  />
                </svg>
                <span className="font-bold text-base sm:text-lg text-white">{Math.round(state.scanProgress)}%</span>
              </div>

              {/* Identity Card */}
              <div className="bg-slate-900/85 px-5 py-2.5 rounded-2xl border border-white/10 shadow-xl text-center min-w-[200px]">
                <h3 className="text-sm sm:text-base font-bold text-white">
                  {state.employee ? `${state.employee.first_name} ${state.employee.last_name}` : '—'}
                </h3>
                {state.matchScore !== null && (
                  <p className={`text-xs font-medium mt-0.5 ${state.matchScore >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Confidence: {state.matchScore}%
                  </p>
                )}
                <div className={`flex items-center justify-center gap-1 mt-1 text-[11px] font-medium ${state.liveness.passed ? 'text-emerald-400' : 'text-amber-300'}`}>
                  <i className={`ti ${state.liveness.passed ? 'ti-check' : 'ti-eye'}`} />
                  <span>{state.liveness.passed ? 'Liveness confirmed' : 'Blink to verify'}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODE: FEEDBACK */}
      <AnimatePresence>
        {state.mode === MODES.FEEDBACK && state.feedback.title && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`absolute inset-0 z-50 flex items-center justify-center p-4 ${state.feedback.type === 'success' ? 'bg-black/85' : 'bg-black/90'}`}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }} animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6 p-6 sm:p-8 w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl"
            >
              {state.feedback.image && (
                <div className={`w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-2 shrink-0 ${state.feedback.type === 'success' ? 'border-emerald-500' : 'border-red-500'}`}>
                  <img src={state.feedback.image} alt="" className="w-full h-full object-cover -scale-x-100" />
                </div>
              )}
              <div className="text-center sm:text-left flex-1 w-full">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-sm text-white shrink-0 ${state.feedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                    <i className={`ti ${state.feedback.type === 'success' ? 'ti-check' : 'ti-x'}`} />
                  </div>
                  <h2 className={`text-xl sm:text-2xl font-bold tracking-tight ${state.feedback.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {state.feedback.title}
                  </h2>
                </div>
                <p className="text-sm font-medium text-slate-200">{state.feedback.message}</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3 text-xs text-slate-400">
                  <span className="font-mono bg-slate-800 px-2 py-0.5 rounded">
                    {new Date().toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  {state.matchScore !== null && (
                    <span className={`font-medium ${state.matchScore >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      Confidence: {state.matchScore}%
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODE: ERROR */}
      <AnimatePresence>
        {state.mode === MODES.ERROR && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 max-w-sm w-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center text-2xl mx-auto mb-3">
                <i className="ti ti-alert-circle" />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">Scan Interrupted</h2>
              <p className="text-slate-400 text-xs mb-5">{state.error?.message || 'An unexpected error occurred.'}</p>
              <button onClick={handleReset} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-xs transition-all">
                Return to Scanner
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top HUD (QR Mode Header) */}
      {state.mode === MODES.QR && (
        <div className="absolute top-0 inset-x-0 z-30 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-8 pointer-events-none">
          <div className="flex justify-between items-center px-4 sm:px-6 pt-[max(env(safe-area-inset-top,12px),12px)]">
            <div className="flex items-center gap-2.5 pt-1">
              <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center text-slate-200 border border-white/10">
                <i className={`ti ${deviceInfo.isMobile ? (deviceInfo.isPortrait ? 'ti-device-mobile' : 'ti-device-mobile-rotated') : 'ti-device-desktop'} text-sm`} />
              </div>
              <div>
                <h1 className="text-xs font-bold text-white tracking-wide">
                  {deviceInfo.isMobile ? 'Gate Kiosk' : 'Terminal Station'}
                </h1>
              </div>
            </div>
            <div className="font-mono text-xs font-semibold bg-slate-900/80 text-slate-300 px-2.5 py-1 rounded-lg border border-white/10 tabular-nums pointer-events-auto">
              {state.clockTime}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Controls (QR Mode) */}
      {state.mode === MODES.QR && (
        <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),16px)] flex justify-center gap-2.5 px-4">
          {state.debugMode && (
            <button
              onClick={async () => {
                try {
                  let { data } = await supabase.from('employees').select('company_id').eq('has_registered_biometrics', true).not('company_id', 'is', null).limit(1);
                  if (!data || data.length === 0) {
                    const res = await supabase.from('employees').select('company_id').not('company_id', 'is', null).limit(1);
                    data = res.data;
                  }
                  if (data?.[0]) onQrSuccess(data[0].company_id);
                  else toast.error('No employees found');
                } catch { toast.error('Mock scan failed'); }
              }}
              className="h-9 px-3.5 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 rounded-xl border border-blue-500/30 transition-all font-semibold text-xs flex items-center gap-1.5"
            >
              <i className="ti ti-wand" /> <span>Mock Badge</span>
            </button>
          )}
          <button
            onClick={async () => { await supabase.auth.signOut(); localStorage.removeItem('user'); window.location.href = '/login'; }}
            className="h-9 px-4 bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white rounded-xl border border-white/10 transition-all font-semibold text-xs flex items-center gap-1.5"
          >
            <i className="ti ti-logout" /> <span>Sign Out</span>
          </button>
        </div>
      )}

      {/* Initial System Boot Loader */}
      <AnimatePresence>
        {state.mode === MODES.BOOT && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 select-none"
          >
            <div className="w-10 h-10 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4" />
            <h2 className="text-sm font-bold text-white tracking-wide mb-1">
              {state.loadingMsg || 'Starting attendance kiosk...'}
            </h2>
            <p className="text-xs text-slate-400">
              Loading facial recognition models...
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle Runtime Status Pill */}
      <AnimatePresence>
        {state.mode !== MODES.BOOT && state.loadingMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-[80] px-4 py-1.5 bg-slate-900 border border-slate-700 rounded-full shadow-lg flex items-center gap-2 text-slate-200 text-xs font-medium pointer-events-none"
          >
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="truncate max-w-[240px] sm:max-w-none">{state.loadingMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Debug panel */}
      <AnimatePresence>
        {state.debugMode && (
          <motion.div initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} className="absolute top-20 left-4 z-[55] bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-4 w-64 text-[10px] font-mono text-slate-300">
            <h3 className="text-xs font-bold text-blue-400 mb-2 uppercase">Debug Telemetry</h3>
            <div className="space-y-1">
              <p>Mode: {state.mode}</p>
              <p>EmpID: {vault.employeeId?.slice(0, 8) || '—'}...</p>
              <p>Baseline: {vault.baseline ? 'Loaded' : 'None'}</p>
              <p>Match: {state.matchScore ?? '—'}%</p>
              <p>Blinks: {state.liveness.blinkCount}</p>
              <p>EAR: {state.liveness.ear?.toFixed(3) ?? '—'}</p>
              <p>Lock: {vault.lockFrames}/{ENV.REQUIRED_LOCK_FRAMES}</p>
              <p>Online: {state.isOnline ? 'Yes' : 'No'}</p>
              <p>Net: {navigator.connection?.effectiveType || '—'}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Scanner;
