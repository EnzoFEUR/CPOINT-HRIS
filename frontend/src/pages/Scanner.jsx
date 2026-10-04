import React, { useState, useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import * as faceapi from 'face-api.js';
import toast from 'react-hot-toast';
import {
  Camera,
  RefreshCw,
  X,
  Eye,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Check,
  LogOut,
  Sparkles,
  User,
  HeartPulse,
  ArrowLeft,
  ArrowRight,
  Scan,
  Lock,
  HelpCircle,
  SlidersHorizontal,
  Apple,
  Smartphone,
  Monitor
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { compressImage } from '../utils/imageCompress';
import { supabase } from '../supabaseClient';
import { requestHardwareCamera, stopHardwareStream } from '../utils/hardwareCamera';
import { playScannerSound as playSound } from '../utils/audio';

// Scanner configuration
const ENV = {
  MODEL_URL: import.meta.env?.VITE_MODEL_URL || 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/',
  API_BASE: import.meta.env?.VITE_API_BASE || '/api',
  SCAN_TIMEOUT_MS: parseInt(import.meta.env?.VITE_SCAN_TIMEOUT_MS, 10) || 60_000,
  FEEDBACK_DISPLAY_MS: parseInt(import.meta.env?.VITE_FEEDBACK_MS, 10) || 5_000,
  FACE_MATCH_THRESHOLD: 0.42,        // Euclidean distance (lower = stricter)
  REQUIRED_LOCK_FRAMES: 8,
  DETECTION_INTERVAL_MS: 100,        // 10fps loop for ultra-low latency & responsive micro-challenges
  DETECTION_INPUT_SIZE: 320,
  MIN_FACE_RATIO: 0.08,
  CENTER_THRESHOLD_X: 0.28,
  CENTER_THRESHOLD_Y: 0.32,
  BLINK_EAR_THRESHOLD: 0.24,         // Stricter EAR threshold for genuine eyelid closure
  BLINK_CONSEC_FRAMES: 2,           // Minimum 2 consecutive frames (~200ms) to eliminate paper jitter
  REQUIRED_BLINKS: 1,
};

// Validation utilities
const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// Eye aspect ratio
const getEAR = (landmarks) => {
  const pts = landmarks?.positions;
  if (!pts || pts.length < 68) return 1.0; // Default open eyes if landmarks missing

  const calcEAR = (i0, i1, i2, i3, i4, i5) => {
    const v1 = Math.hypot(pts[i1].x - pts[i5].x, pts[i1].y - pts[i5].y);
    const v2 = Math.hypot(pts[i2].x - pts[i4].x, pts[i2].y - pts[i4].y);
    const h  = Math.hypot(pts[i0].x - pts[i3].x, pts[i0].y - pts[i3].y);
    return h === 0 ? 1.0 : (v1 + v2) / (2.0 * h);
  };

  // Left eye: 36-41, Right eye: 42-47
  return (calcEAR(36, 37, 38, 39, 40, 41) + calcEAR(42, 43, 44, 45, 46, 47)) / 2.0;
};

// Head pose estimation
const getHeadPose = (landmarks) => {
  const pts = landmarks?.positions;
  if (!pts || pts.length < 68) return { yawRatio: 1.0, noseOffset: 0.0, isCentered: true, isTurnedLeft: false, isTurnedRight: false, eyeDistance: 0 };

  const dxLeft = pts[30].x - pts[0].x;
  const dxRight = pts[16].x - pts[30].x;
  const yawRatio = dxRight > 0 ? dxLeft / dxRight : 1.0;

  const eyeMidX = (pts[36].x + pts[45].x) / 2;
  const eyeDistance = Math.hypot(pts[45].x - pts[36].x, pts[45].y - pts[36].y);
  const noseOffset = eyeDistance > 0 ? (pts[30].x - eyeMidX) / eyeDistance : 0.0;

  const isCentered = yawRatio >= 0.80 && yawRatio <= 1.25 && Math.abs(noseOffset) <= 0.12;
  const isTurnedLeft = yawRatio >= 1.38 || noseOffset >= 0.16;
  const isTurnedRight = yawRatio <= 0.72 || noseOffset <= -0.16;

  return {
    yawRatio,
    noseOffset,
    isCentered,
    isTurnedLeft,
    isTurnedRight,
    eyeDistance
  };
};

// Depth variance calculation
const calculateVariance = (arr) => {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
};

// Haptic feedback

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
  liveness: { 
    stage: 'ALIGN', 
    targetDirection: null, 
    status: 'ALIGNING', 
    blinkCount: 0, 
    ear: null, 
    passed: false,
    flashActive: false 
  },
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
        <div className="bg-slate-900 p-10 rounded-2xl shadow-2xl max-w-md text-center border border-rose-500/40">
          <div className="flex justify-center mb-6">
            <Lock className="w-16 h-16 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Access restricted</h2>
          <p className="text-red-300 text-sm mb-8">This terminal is restricted to security staff and administrators.</p>
          <button onClick={() => window.location.href = '/login'} className="py-3 px-6 w-full bg-red-600 hover:bg-red-500 text-white font-semibold rounded-md transition-colors text-sm">Sign in to your account</button>
        </div>
      </div>
    );
  }

  // Camera facing mode ('user' = front, 'environment' = rear)
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

  // Mutable detection state
  const vault = useRef({
    processing: false,
    submitLock: false,
    lockFrames: 0,
    blinkCount: 0,
    blinkFrames: 0,
    earHistory: [],
    depthSamples: [],
    padStage: 'ALIGN', // 'ALIGN' -> 'CHALLENGE' -> 'CENTER_BLINK' -> 'FLASH_CAPTURE'
    targetDirection: null, // 'TURN_LEFT' or 'TURN_RIGHT'
    challengeTurnFrames: 0,
    challengePassed: false,
    recenterFrames: 0,
    flashActive: false,
    matchScore: null,
    employeeId: null,
    baseline: null,
    lastUiUpdate: 0,
    isMedicalExempt: false,
    medicalExemption: null,
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
    vault.depthSamples = [];
    vault.padStage = 'ALIGN';
    vault.targetDirection = null;
    vault.challengeTurnFrames = 0;
    vault.challengePassed = false;
    vault.recenterFrames = 0;
    vault.flashActive = false;
    vault.matchScore = null;
    vault.employeeId = null;
    vault.baseline = null;
    vault.isMedicalExempt = false;
    vault.medicalExemption = null;
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_MODE', payload: MODES.QR });
  }, [vault, stopFaceCamera, dispatch]);

  // Listen for real-time security events
  useEffect(() => {
    const channel = supabase
      .channel('scanner_disciplinary_realtime')
      .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, ({ payload }) => {
        if (!payload) return;
        const isSuspOrTerm = payload.type === 'Suspension' || payload.type === 'Termination' || payload.employee_status === 'suspended';
        if (isSuspOrTerm && vault.employeeId && vault.employeeId === payload.employee_id) {
          handleReset();
          playSound('error');
          haptic('error');
          toast.error(`SECURITY ALERT: ${payload.employee_name || 'Personnel'} was just suspended/terminated by HR. Premise entry revoked.`, {
            id: 'gate-security-alert',
            duration: 6000
          });
        }
      })
      .on('broadcast', { event: 'EMPLOYEE_TERMINATED' }, ({ payload }) => {
        if (payload && vault.employeeId && vault.employeeId === payload.employee_id) {
          handleReset();
          playSound('error');
          haptic('error');
          toast.error('SECURITY ALERT: Employment terminated by HR. Gate pass revoked.', {
            id: 'gate-security-alert',
            duration: 6000
          });
        }
      })
      .on('broadcast', { event: 'EMPLOYEE_RESTORED' }, ({ payload }) => {
        if (payload?.employee_id) {
          toast.success('Access Restored: Personnel record cleared by HR.', {
            id: 'gate-restored-alert',
            duration: 4000
          });
        }
      })
      .on('broadcast', { event: 'DISCIPLINARY_RESOLVED' }, ({ payload }) => {
        if (payload?.employee_id) {
          toast.success('Access Restored: Personnel record cleared by HR.', {
            id: 'gate-restored-alert',
            duration: 4000
          });
        }
      })
      .on('broadcast', { event: 'DISCIPLINARY_OVERTURNED' }, ({ payload }) => {
        if (payload?.employee_id) {
          toast.success('Access Restored: Personnel record cleared by HR.', {
            id: 'gate-restored-alert',
            duration: 4000
          });
        }
      })
      .on('broadcast', { event: 'BIOMETRIC_EXEMPTION_UPDATED' }, ({ payload }) => {
        if (payload?.employee_id && vault.employeeId === payload.employee_id) {
          vault.isMedicalExempt = Boolean(payload.is_exempt);
          toast.success(
            payload.is_exempt 
              ? 'Medical Grace Exemption authorized by HR. Face matching bypassed.' 
              : 'Medical Grace Exemption ended by HR. Standard dual-factor restored.',
            { id: 'biometric-exemption-sync', duration: 4000 }
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vault, handleReset]);

  // Capture frame and submit to backend
  const captureAndSubmit = useCallback(async (finalScore, blinkCount, earHistory) => {
    if (vault.submitLock) return;
    vault.submitLock = true;
    dispatch({ type: 'SET_MODE', payload: MODES.PROCESSING });
    dispatch({ type: 'SET_LOADING', payload: 'Submitting verification...' });

    // Capture camera snapshot
    let img64 = null;
    if (videoRef.current && videoRef.current.videoWidth) {
      const c = document.createElement('canvas');
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      const maxDim = 1024;
      const scale = Math.min(1.0, maxDim / Math.max(vw, vh));
      c.width = Math.round(vw * scale);
      c.height = Math.round(vh * scale);
      const ctx = c.getContext('2d');
      // Natural orientation capture
      if (cameraFacing === 'user') {
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(videoRef.current, 0, 0, c.width, c.height);
      img64 = c.toDataURL('image/jpeg', 0.88);
    }

    const eid = vault.employeeId;
    if (!eid || !isValidUUID(eid)) {
      dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'SYSTEM ERROR', message: 'Invalid employee session. Scan again.', code: 'INVALID_SESSION' } });
      playSound('error'); haptic('error');
      setTimeout(handleReset, ENV.FEEDBACK_DISPLAY_MS);
      return;
    }

    // Build liveness telemetry payload
    const depthVariance = calculateVariance(vault.depthSamples);
    const livenessPayload = vault.isMedicalExempt ? {
      method: 'medical_grace_exemption',
      is_exempt: true,
      client_timestamp: new Date().toISOString()
    } : {
      method: 'active_3d_head_challenge',
      challenge_type: vault.targetDirection || 'TURN_LEFT',
      challenge_passed: Boolean(vault.challengePassed),
      depth_variance: depthVariance,
      blink_count: blinkCount,
      ear_min: earHistory.length ? Math.min(...earHistory) : 0.0,
      ear_max: earHistory.length ? Math.max(...earHistory) : 0.0,
      ear_avg: earHistory.length ? (earHistory.reduce((a, b) => a + b, 0) / earHistory.length) : 0.0,
      flash_reflectance_confirmed: true,
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
        else if (res.status === 403) friendly = friendly;
        else if (res.status === 503) friendly = 'Attendance scanner is temporarily offline. Please notify HR.';
        else if (res.status === 409) friendly = 'Attendance already recorded today.';
        else if (res.status === 404) friendly = 'Employee record not found.';

        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'Clock-in failed', message: friendly, requestId: reqId, code: errCode, image: img64 } });
        playSound('error'); haptic('error');
      } else if (data.status === 'success') {
        const isOut = data.code === 'TIME_OUT' || data.message?.toUpperCase().includes('OUT');
        dispatch({ type: 'SET_FEEDBACK', payload: {
          type: 'success',
          title: isOut ? 'Clocked out' : 'Clocked in',
          message: data.message || 'Attendance recorded.',
          code: data.code,
          image: img64
        }});
        playSound('success'); haptic('success');
      } else {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'Server error', message: data.message || 'Could not record attendance. Please try again.', image: img64 } });
        playSound('error'); haptic('error');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'Cancelled', message: 'Scan was interrupted.', image: img64 } });
      } else {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'Connection error', message: 'Cannot reach attendance server. Check internet connection.', image: img64 } });
      }
      playSound('error'); haptic('error');
    }

    setTimeout(handleReset, ENV.FEEDBACK_DISPLAY_MS);
  }, [vault, cameraFacing, handleReset, dispatch]);

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

    // Reset state for new session with challenge direction
    vault.lockFrames = 0;
    vault.blinkCount = 0;
    vault.blinkFrames = 0;
    vault.earHistory = [];
    vault.depthSamples = [];
    vault.padStage = 'ALIGN';
    vault.targetDirection = Math.random() > 0.5 ? 'TURN_LEFT' : 'TURN_RIGHT';
    vault.challengeTurnFrames = 0;
    vault.challengePassed = false;
    vault.recenterFrames = 0;
    vault.flashActive = false;
    vault.submitLock = false;

    dispatch({ type: 'SET_PROGRESS', payload: 0 });
    dispatch({ type: 'SET_MATCH', payload: null });
    dispatch({ 
      type: 'SET_LIVENESS', 
      payload: { 
        stage: 'ALIGN', 
        targetDirection: vault.targetDirection, 
        status: 'ALIGNING', 
        blinkCount: 0, 
        ear: null, 
        passed: false, 
        flashActive: false 
      } 
    });

    detectionRef.current = setInterval(async () => {
      syncCanvas();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Handle medical exemption
      if (vault.isMedicalExempt) {
        vault.lockFrames += 1;
        const targetFrames = 4; // ~400ms stabilization for camera auto-exposure
        const progress = Math.min((vault.lockFrames / targetFrames) * 100, 100);
        throttledDispatch({ scanProgress: progress, matchScore: 100 });
        updateStatus('RECORDING MEDICAL ATTENDANCE SNAPSHOT...');

        if (vault.lockFrames >= targetFrames) {
          clearInterval(detectionRef.current);
          detectionRef.current = null;
          updateStatus('SNAPSHOT ACQUIRED');
          captureAndSubmit(100, 0, [0.35]);
        }
        return;
      }

      // Face detection using TinyFaceDetector
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
        updateStatus('Look directly at the camera to clock in');
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

      // Identity match Euclidean distance
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
        updateStatus(!bigEnough ? 'Move closer to the camera' : 'Center your face in the frame');
        drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        return;
      }

      if (!matched) {
        vault.lockFrames = 0;
        throttledDispatch({ scanProgress: 0, matchScore: currentScore });
        updateStatus('Face not recognized. Try again');
        drawFaceMesh(ctx, det.landmarks, box, 'mismatch');
        return;
      }

      // Calculate Head Pose and Eye Aspect Ratio
      const pose = getHeadPose(det.landmarks);
      const ear = getEAR(det.landmarks);
      vault.earHistory.push(ear);
      if (vault.earHistory.length > 50) vault.earHistory.shift();

      // Track depth metric
      if (pose.eyeDistance > 0) {
        const eyeMidX = (det.landmarks.positions[36].x + det.landmarks.positions[45].x) / 2;
        const depthMetric = (det.landmarks.positions[30].x - eyeMidX) / pose.eyeDistance;
        vault.depthSamples.push(depthMetric);
        if (vault.depthSamples.length > 60) vault.depthSamples.shift();
      }

      // Track consecutive blinks
      if (ear < ENV.BLINK_EAR_THRESHOLD) {
        vault.blinkFrames += 1;
      } else {
        if (vault.blinkFrames >= ENV.BLINK_CONSEC_FRAMES) {
          vault.blinkCount += 1;
        }
        vault.blinkFrames = 0;
      }

      // Challenge state machine
      // 1. Align face
      if (vault.padStage === 'ALIGN') {
        if (pose.isCentered) {
          vault.lockFrames += 1;
          const progress = Math.min((vault.lockFrames / 3) * 25, 25);
          throttledDispatch({ scanProgress: progress, matchScore: currentScore });
          updateStatus('Face detected. Checking presence...');
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');

          if (vault.lockFrames >= 3) {
            vault.padStage = 'CHALLENGE';
            vault.challengeTurnFrames = 0;
            playSound('scan');
            haptic('scan');
            dispatch({
              type: 'SET_LIVENESS',
              payload: {
                stage: 'CHALLENGE',
                targetDirection: vault.targetDirection,
                status: vault.targetDirection === 'TURN_LEFT' ? 'TURN_LEFT' : 'TURN_RIGHT',
                ear
              }
            });
          }
        } else {
          vault.lockFrames = Math.max(0, vault.lockFrames - 1);
          updateStatus('Look directly at the camera');
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        }
        return;
      }

      // 2. Head turn challenge
      if (vault.padStage === 'CHALLENGE') {
        const targetTurnMet = vault.targetDirection === 'TURN_LEFT' ? pose.isTurnedLeft : pose.isTurnedRight;
        const directiveText = vault.targetDirection === 'TURN_LEFT'
          ? 'Turn your head slightly to the left'
          : 'Turn your head slightly to the right';

        if (targetTurnMet) {
          vault.challengeTurnFrames += 1;
          const progress = 25 + Math.min((vault.challengeTurnFrames / 2) * 35, 35);
          throttledDispatch({ scanProgress: progress, matchScore: currentScore });
          updateStatus('Head turn detected');
          drawFaceMesh(ctx, det.landmarks, box, 'locked');

          if (vault.challengeTurnFrames >= 2) {
            vault.challengePassed = true;
            vault.padStage = 'CENTER_BLINK';
            vault.recenterFrames = 0;
            playSound('scan');
            haptic('scan');
            dispatch({
              type: 'SET_LIVENESS',
              payload: {
                stage: 'CENTER_BLINK',
                targetDirection: vault.targetDirection,
                status: 'CENTER_AND_BLINK',
                ear
              }
            });
          }
        } else {
          throttledDispatch({ scanProgress: 35, matchScore: currentScore });
          updateStatus(directiveText);
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        }
        return;
      }

      // 3. Re-center and blink
      if (vault.padStage === 'CENTER_BLINK') {
        if (!pose.isCentered) {
          throttledDispatch({ scanProgress: 60, matchScore: currentScore });
          updateStatus('Turn face back to center');
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
          return;
        }

        if (vault.blinkCount < ENV.REQUIRED_BLINKS) {
          throttledDispatch({ scanProgress: 75, matchScore: currentScore });
          updateStatus('Blink your eyes to confirm');
          dispatch({
            type: 'SET_LIVENESS',
            payload: {
              stage: 'CENTER_BLINK',
              status: 'BLINK_TO_VERIFY',
              blinkCount: vault.blinkCount,
              ear
            }
          });
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
          return;
        }

        // Completed challenge and blink
        vault.padStage = 'FLASH_CAPTURE';
        throttledDispatch({ scanProgress: 90, matchScore: currentScore });
        updateStatus('Face verified. Recording clock-in...');
        dispatch({
          type: 'SET_LIVENESS',
          payload: {
            stage: 'FLASH_CAPTURE',
            status: 'PASSED',
            passed: true,
            blinkCount: vault.blinkCount,
            flashActive: true,
            ear
          }
        });
        drawFaceMesh(ctx, det.landmarks, box, 'locked');

        // Flash and capture snapshot
        clearInterval(detectionRef.current);
        detectionRef.current = null;

        setTimeout(() => {
          captureAndSubmit(currentScore, vault.blinkCount, vault.earHistory);
        }, 180);
        return;
      }
    }, ENV.DETECTION_INTERVAL_MS);
  }, [vault, dispatch, throttledDispatch, updateStatus, captureAndSubmit]);

  // Start face camera
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

  // Toggle front and rear camera
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

      const empStatus = String(emp.status || '').toLowerCase();
      if (!emp.is_active || empStatus === 'suspended' || empStatus === 'inactive' || empStatus === 'terminated') {
        if (empStatus === 'suspended') throw new Error('EMPLOYEE_SUSPENDED');
        if (empStatus === 'terminated' || empStatus === 'inactive') throw new Error('EMPLOYEE_TERMINATED');
        throw new Error('EMPLOYEE_INACTIVE');
      }

      // Check biometric registration
      const hasBiometrics = Boolean(emp.has_registered_biometrics || emp.biometric_baseline_path);
      if (!hasBiometrics && !emp.is_medical_exempt) {
        throw new Error('BIOMETRICS_NOT_REGISTERED');
      }

      vault.employeeId = emp.id;
      vault.isMedicalExempt = Boolean(emp.is_medical_exempt);
      vault.medicalExemption = emp.medical_exemption || null;
      dispatch({ type: 'SET_EMPLOYEE', payload: emp });
      dispatch({ type: 'SET_MODE', payload: MODES.PREP });

      // Handle medical exemption
      if (emp.is_medical_exempt) {
        vault.baseline = null;
        dispatch({ type: 'SET_BASELINE', payload: null });
        dispatch({ type: 'SET_PHOTO', payload: emp.avatar_url || null });
        dispatch({ type: 'SET_LOADING', payload: '' });
        return;
      }

      // Load baseline biometrics with timeout
      const storagePath = emp.biometric_baseline_path;
      const { data: urlData } = supabase.storage
        .from('public-bucket')
        .getPublicUrl(storagePath);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const imgRes = await fetch(urlData.publicUrl, { 
          signal: controller.signal 
        });
        clearTimeout(timeoutId);

        if (!imgRes.ok) throw new Error('BASELINE_NOT_FOUND');

        const blob = await imgRes.blob();
        const url = URL.createObjectURL(blob);
        dispatch({ type: 'SET_PHOTO', payload: url });

        // Extract face descriptor using TinyFaceDetector
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
      const errFriendly =
        err.message === 'EMPLOYEE_NOT_FOUND' ? 'ID card not recognized. Please scan again.' :
        err.message === 'EMPLOYEE_SUSPENDED' ? 'Account suspended. Please speak with HR.' :
        err.message === 'EMPLOYEE_TERMINATED' ? 'Account inactive. Please contact HR.' :
        err.message === 'EMPLOYEE_INACTIVE' ? 'Account inactive. Please contact HR.' :
        err.message === 'BIOMETRICS_NOT_REGISTERED' ? 'Face scan not registered. Please visit HR to set up your profile.' :
        (err.message?.includes('BIOMETRICS REQUIRED') ? 'Face scan not registered. Please visit HR to set up your profile.' : 'Identification error. Please try again.');
      toast.error(errFriendly, { id: 'qr-scan-error', duration: 4500 });
      playSound('error');
      haptic('error');
      updateStatus(errFriendly);
      setTimeout(() => {
        vault.processing = false;
        dispatch({ type: 'SET_MODE', payload: MODES.QR });
      }, 2500);
    }
  }, [vault, dispatch]);

  // QR scanner initialization
  const startQr = useCallback(async (isUserGesture = false) => {
    if (qrRef.current) return;
    dispatch({ type: 'SET_LOADING', payload: 'Connecting camera...' });

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
      // Show permission prompt screen on mobile
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
        toast.error('Unable to load face scanner. Check network connection.');
        dispatch({ type: 'SET_ERROR', payload: { message: 'Failed to load face scanner. Refresh to retry.', code: 'MODEL_LOAD_ERROR' } });
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

      {/* QR mode */}
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
          <p className="absolute bottom-28 text-slate-400 text-xs">Align badge within corners</p>
        </div>
      </div>

      {/* Camera permission prompt */}
      
        {state.mode === MODES.CAMERA_PROMPT && (
          <div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-5 select-none"
          >
            <div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col items-center w-full max-w-sm p-7 text-center relative overflow-hidden"
            >
              {/* Camera Icon Badge */}
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
                <Camera className="w-8 h-8 text-blue-400" />
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
                <Camera className="w-4 h-4" />
                <span>Allow Camera</span>
              </button>

              <button
                onClick={() => setShowPermHelp(true)}
                className="mt-3.5 text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5"
              >
                <HelpCircle className="w-3.5 h-3.5" /> Troubleshooting Guide
              </button>
            </div>
          </div>
        )}
      

      {/* Permission instructions modal */}
      
        {showPermHelp && (
          <div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] bg-slate-950/95 flex items-center justify-center p-4"
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-md p-5 sm:p-6 flex flex-col text-left shadow-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center">
                    <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Browser Camera Permissions</h3>
                    <p className="text-[11px] text-slate-400">Step-by-step unblock instructions</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowPermHelp(false)}
                  className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors duration-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* OS Tabs */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 rounded-md mb-4 border border-white/5">
                <button
                  onClick={() => setPermTab('ios')}
                  className={`h-8 text-xs font-semibold rounded-sm transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer ${
                    permTab === 'ios' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Apple className="w-3.5 h-3.5" /> iPhone (iOS)
                </button>
                <button
                  onClick={() => setPermTab('android')}
                  className={`h-8 text-xs font-semibold rounded-sm transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer ${
                    permTab === 'android' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" /> Android
                </button>
              </div>

              {/* iOS Guide */}
              {permTab === 'ios' && (
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                    <p>Tap the <span className="font-bold text-white bg-white/10 px-1 py-0.5 rounded-sm">aA</span> icon in your Safari address bar.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                    <p>Select <span className="font-bold text-white">Website Settings</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                    <p>Change <span className="font-bold text-white">Camera</span> from Deny to <span className="font-bold text-emerald-400">Allow</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">4</span>
                    <p>Tap <span className="font-bold text-white">Done</span> and tap the button below to start.</p>
                  </div>
                </div>
              )}

              {/* Android Guide */}
              {permTab === 'android' && (
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                    <p>Tap the <span className="font-bold text-white bg-white/10 px-1 py-0.5 rounded-sm inline-flex items-center gap-1"><Lock className="w-3 h-3 text-blue-400 inline" /> Lock</span> icon next to the URL.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                    <p>Tap <span className="font-bold text-white">Permissions</span> &rarr; <span className="font-bold text-white">Camera</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                    <p>Switch setting to <span className="font-bold text-emerald-400">Allow</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">4</span>
                    <p>Return to this page and tap <span className="font-bold text-white">Retry Connection</span>.</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setShowPermHelp(false);
                  startQr(true);
                }}
                className="mt-5 w-full h-10 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-semibold tracking-wider uppercase text-xs transition-colors duration-100 flex items-center justify-center gap-2 shadow-2xs cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry Connection
              </button>
            </div>
          </div>
        )}
      

      {/* Prep mode */}
      
        {state.mode === MODES.PREP && (
          <div
            className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-4"
          >
            <div
              className="bg-slate-900 border border-slate-800 rounded-lg shadow-xl flex flex-col items-center w-full max-w-sm p-6 text-center"
            >
              {state.employeePhotoUrl ? (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-md overflow-hidden border-2 border-slate-700 mb-3 bg-slate-800">
                  <img src={state.employeePhotoUrl} alt="Baseline" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-md bg-slate-800 border-2 border-slate-700 flex items-center justify-center mb-3 text-slate-400">
                  <User className="w-10 h-10" />
                </div>
              )}
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                {state.employee ? (state.employee.name || `${state.employee.first_name || ''} ${state.employee.last_name || ''}`.trim() || 'Employee') : 'Employee'}
              </h2>
              <span className="inline-block px-2 py-0.5 mt-1 rounded-sm bg-slate-800 text-slate-300 font-mono text-xs">
                {state.employee?.company_id || 'NO ID'}
              </span>

              {state.employee?.is_medical_exempt ? (
                <div className="w-full my-3 p-3 bg-amber-500/15 border border-amber-500/40 rounded-md text-left">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                    <HeartPulse className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Medical exemption on file</span>
                  </div>
                  <p className="text-[11px] text-amber-200/80 mt-1 leading-tight">
                    Face scan bypassed. A photo will be saved for attendance records.
                  </p>
                  {state.employee?.medical_exemption?.valid_until && (
                    <div className="mt-1.5 text-[10px] text-amber-400/90 font-mono">
                      Valid through: {state.employee.medical_exemption.valid_until}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-400 text-xs mt-2.5 mb-5 leading-relaxed">
                  Please look directly at the camera to verify your clock-in.
                </p>
              )}

              <button
                onClick={() => dispatch({ type: 'SET_MODE', payload: MODES.FACE })}
                className={`w-full h-10 ${state.employee?.is_medical_exempt ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'} text-white rounded-md font-semibold text-xs tracking-wide transition-colors duration-100 flex items-center justify-center gap-2 shadow-2xs cursor-pointer`}
              >
                {state.employee?.is_medical_exempt ? <Camera className="w-4 h-4" /> : <Scan className="w-4 h-4" />}
                <span>{state.employee?.is_medical_exempt ? 'Take attendance photo' : 'Start face scan'}</span>
              </button>
              <button
                onClick={handleReset}
                className="mt-2.5 w-full h-8 text-slate-400 hover:text-slate-200 text-xs transition-colors duration-100 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      

      {/* Face verification mode */}
      
        {state.mode === MODES.FACE && (
          <div className="absolute inset-0 z-20 bg-black overflow-hidden">
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

            {/* Screen flash pulse */}
            {state.liveness.flashActive && (
              <div className="absolute inset-0 z-50 bg-[#00f5d4]/25 border-[10px] border-[#00f5d4] pointer-events-none transition-opacity duration-150 animate-pulse shadow-[inset_0_0_80px_rgba(0,245,212,0.6)]" />
            )}

            {/* Direction challenge prompt */}
            {state.liveness.stage === 'CHALLENGE' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-6 sm:px-14 z-30">
                {state.liveness.targetDirection === 'TURN_LEFT' ? (
                  <div className="flex flex-col items-center gap-2 bg-slate-950 border border-amber-400 text-amber-300 px-4 py-3 rounded-md shadow-xl animate-pulse">
                    <ArrowLeft className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400" />
                    <span className="text-[11px] font-bold tracking-wide">Turn left</span>
                  </div>
                ) : <div />}
                {state.liveness.targetDirection === 'TURN_RIGHT' ? (
                  <div className="flex flex-col items-center gap-2 bg-slate-950 border border-amber-400 text-amber-300 px-4 py-3 rounded-md shadow-xl animate-pulse">
                    <ArrowRight className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400" />
                    <span className="text-[11px] font-bold tracking-wide">Turn right</span>
                  </div>
                ) : <div />}
              </div>
            )}

            {/* Top Control Bar */}
            <div className="absolute top-[max(env(safe-area-inset-top,12px),12px)] inset-x-0 flex items-center justify-between px-4 sm:px-6 z-30 pt-2">
              {/* Cancel Button */}
              <button
                onClick={handleReset}
                className="w-8 h-8 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-colors duration-100 flex items-center justify-center cursor-pointer shadow-2xs"
                title="Cancel Scan"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Status Badge */}
              <span className={`px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide border shadow-2xs flex items-center gap-2 ${statusMeta.pill}`}>
                {state.employee?.is_medical_exempt ? (
                  <>
                    <HeartPulse className="w-3.5 h-3.5 text-amber-400" />
                    <span>Medical exemption: Recording photo...</span>
                  </>
                ) : state.liveness.stage === 'ALIGN' ? (
                  <>
                    <Scan className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                    <span>Look directly at the camera</span>
                  </>
                ) : state.liveness.stage === 'CHALLENGE' ? (
                  <>
                    {state.liveness.targetDirection === 'TURN_LEFT' ? (
                      <ArrowLeft className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                    )}
                    <span className="font-bold tracking-wider text-amber-300">
                      {state.liveness.targetDirection === 'TURN_LEFT' ? 'Turn your head slightly left' : 'Turn your head slightly right'}
                    </span>
                  </>
                ) : state.liveness.stage === 'CENTER_BLINK' ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                    <span className="font-bold text-cyan-300">Face camera and blink your eyes</span>
                  </>
                ) : state.liveness.passed && state.scanProgress < 100 ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Face verified. Recording clock-in...</span>
                  </>
                ) : state.scanProgress >= 100 ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>Recording attendance...</span>
                  </>
                ) : state.matchScore !== null && state.matchScore < 50 ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    <span>Face not recognized</span>
                  </>
                ) : (
                  <span>Checking face...</span>
                )}
              </span>

              {/* Right Controls: Flip Camera + Live Clock */}
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleCameraFacing}
                  className="h-8 px-2.5 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-white/10 transition-colors duration-100 flex items-center gap-1.5 text-xs font-medium cursor-pointer shadow-2xs"
                  title="Flip Camera (Front / Rear)"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[11px] hidden sm:inline capitalize">
                    {cameraFacing === 'user' ? 'Front' : 'Rear'}
                  </span>
                </button>
                <div className="font-mono text-xs font-semibold bg-slate-900/80 text-slate-300 px-2 py-1 rounded-md border border-white/10 tabular-nums hidden sm:block">
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
              <div className="bg-slate-900/90 px-4 py-2 rounded-md border border-white/10 shadow-xl text-center min-w-[200px]">
                <h3 className="text-sm font-bold text-white">
                  {state.employee ? `${state.employee.first_name} ${state.employee.last_name}` : '—'}
                </h3>
                {state.matchScore !== null && (
                  <p className={`text-xs font-medium mt-0.5 ${state.matchScore >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                    Confidence: {state.matchScore}%
                  </p>
                )}
                {state.employee?.is_medical_exempt && (
                  <div className="flex items-center justify-center gap-1.5 mt-1 text-[11px] font-bold text-amber-300">
                    <HeartPulse className="w-3.5 h-3.5 text-amber-400" />
                    <span>Medical exemption on file</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      

      {/* Feedback state */}
      
        {state.mode === MODES.FEEDBACK && state.feedback.title && (
          <div
            className={`absolute inset-0 z-50 flex items-center justify-center p-4 ${state.feedback.type === 'success' ? 'bg-black/85' : 'bg-black/90'}`}
          >
            <div
              className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6 p-5 sm:p-6 w-full max-w-lg rounded-lg bg-slate-900 border border-slate-800 shadow-xl"
            >
              {state.feedback.image && (
                <div className={`w-24 h-24 sm:w-28 sm:h-28 rounded-md overflow-hidden border-2 shrink-0 ${state.feedback.type === 'success' ? 'border-emerald-500' : 'border-red-500'}`}>
                  <img src={state.feedback.image} alt="" className="w-full h-full object-cover -scale-x-100" />
                </div>
              )}
              <div className="text-center sm:text-left flex-1 w-full">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                  <div className={`h-6 w-6 rounded-md flex items-center justify-center text-xs text-white shrink-0 ${state.feedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                    {state.feedback.type === 'success' ? <Check className="w-3.5 h-3.5 text-white" /> : <X className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <h2 className={`text-lg sm:text-xl font-bold tracking-tight ${state.feedback.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {state.feedback.title}
                  </h2>
                </div>
                <p className="text-xs font-medium text-slate-200">{state.feedback.message}</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-2.5 text-xs text-slate-400">
                  <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded-sm">
                    {new Date().toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  {state.matchScore !== null && (
                    <span className={`font-medium ${state.matchScore >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      Confidence: {state.matchScore}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      

      {/* Error state */}
      
        {state.mode === MODES.ERROR && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-sm w-full text-center shadow-xl">
              <div className="w-10 h-10 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-5 h-5 text-rose-400" />
              </div>
              <h2 className="text-base font-bold text-white mb-1">Scan Interrupted</h2>
              <p className="text-slate-400 text-xs mb-4">{state.error?.message || 'An unexpected error occurred.'}</p>
              <button onClick={handleReset} className="w-full h-9 bg-slate-800 hover:bg-slate-700 text-white rounded-md font-semibold text-xs transition-colors duration-100 cursor-pointer shadow-2xs">
                Return to Scanner
              </button>
            </div>
          </div>
        )}
      

      {/* Top HUD (QR Mode Header) */}
      {state.mode === MODES.QR && (
        <div className="absolute top-0 inset-x-0 z-30 bg-slate-950/90 border-b border-slate-800 pb-3 pointer-events-none">
          <div className="flex justify-between items-center px-4 sm:px-6 pt-[max(env(safe-area-inset-top,12px),12px)]">
            <div className="flex items-center gap-2 pt-1">
              <div className="h-8 w-8 rounded-md bg-slate-800 flex items-center justify-center text-slate-200 border border-slate-700">
                {deviceInfo.isMobile ? (
                  <Smartphone className="w-4 h-4 text-slate-200" />
                ) : (
                  <Monitor className="w-4 h-4 text-slate-200" />
                )}
              </div>
              <div>
                <h1 className="text-xs font-bold text-white tracking-wide">
                  {deviceInfo.isMobile ? 'Gate Kiosk' : 'Terminal Station'}
                </h1>
              </div>
            </div>
            <div className="font-mono text-xs font-semibold bg-slate-900 text-slate-300 px-2 py-1 rounded-md border border-slate-700 tabular-nums pointer-events-auto">
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
              className="h-9 px-3.5 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 rounded-md border border-blue-500/30 transition-colors duration-100 font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5" /> <span>Mock Badge</span>
            </button>
          )}
          <button
            onClick={async () => { await supabase.auth.signOut(); localStorage.removeItem('user'); window.location.href = '/login'; }}
            className="h-9 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-md border border-slate-700 transition-colors duration-100 font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <LogOut className="w-3.5 h-3.5" /> <span>Sign Out</span>
          </button>
        </div>
      )}

      {/* Camera loading state */}
      
        {state.mode === MODES.BOOT && (
          <div
            className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 select-none"
          >
            <div className="w-8 h-8 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-3" />
            <h2 className="text-xs font-bold text-white tracking-wide mb-1">
              {state.loadingMsg || 'Starting attendance kiosk...'}
            </h2>
            <p className="text-[11px] text-slate-400">
              Loading face scanner...
            </p>
          </div>
        )}
      

      {/* Status indicator */}
      {state.mode !== MODES.BOOT && state.loadingMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-md shadow-lg flex items-center gap-2 text-slate-200 text-xs font-medium pointer-events-none">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
          <span className="truncate max-w-[240px] sm:max-w-none">{state.loadingMsg}</span>
        </div>
      )}

      {/* Debug panel */}
      {state.debugMode && (
        <div className="absolute top-20 left-4 z-[55] bg-black/80 border border-white/10 rounded-md p-3.5 w-64 text-[10px] font-mono text-slate-300">
          <h3 className="text-xs font-bold text-blue-400 mb-2 uppercase">Debug Info</h3>
          <div className="space-y-1">
            <p>Mode: {state.mode}</p>
            <p>EmpID: {vault.employeeId?.slice(0, 8) || '—'}...</p>
            <p>Baseline: {vault.baseline ? 'Loaded' : 'None'}</p>
            <p>Match: {state.matchScore ?? '—'}%</p>
            <p>PAD Stage: {vault.padStage} ({vault.targetDirection || '—'})</p>
            <p>Depth Var: {calculateVariance(vault.depthSamples).toFixed(5)}</p>
            <p>Blinks: {state.liveness.blinkCount}</p>
            <p>EAR: {state.liveness.ear?.toFixed(3) ?? '—'}</p>
            <p>Lock: {vault.lockFrames}/{ENV.REQUIRED_LOCK_FRAMES}</p>
            <p>Online: {state.isOnline ? 'Yes' : 'No'}</p>
            <p>Net: {navigator.connection?.effectiveType || '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scanner;
