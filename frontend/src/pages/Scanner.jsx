import scannerStylesUrl from './Scanner.css?url&no-inline';
import { useState, useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Monitor,
  WifiOff
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import { supabase } from '../supabaseClient';
import ProtectedImage from '../components/ProtectedImage';
import { getPrivateMediaSession, resolvePrivateMedia } from '../utils/privateMedia';
import { requestHardwareCamera, stopHardwareStream } from '../utils/hardwareCamera';
import { startVideoFrameLoop, captureVideoFrame, copyVideoFrame } from '../utils/cameraFrames.mjs';
import { createQrScanner, startQrCamera, stopQrCamera } from '../utils/qrCamera';
import { loadFaceModels, loadBaselineFallbackModel } from '../utils/faceModels';
import { BLINK_PROMPTS, createBlinkState, getEyeOpenness, calibrateBlink, updateBlink, resetBlinkCycle } from '../utils/blinkDetection.mjs';
import { playScannerSound as playSound } from '../utils/audio';
import { performLogout } from '../utils/authSession';
import { isOfflineFeatureActive } from '../routes/OfflineRouteGate.js';
import { hasRegisteredFace } from '../../../shared/medicalGrace.mjs';
import { getStoredUser } from '../utils/storedUser.mjs';
import { isAdmin, isSecurity } from '../utils/userAccess.mjs';

// Scanner configuration
const ENV = {
  API_BASE: import.meta.env?.VITE_API_BASE || '/api',
  SCAN_TIMEOUT_MS: parseInt(import.meta.env?.VITE_SCAN_TIMEOUT_MS, 10) || 60_000,
  FEEDBACK_DISPLAY_MS: parseInt(import.meta.env?.VITE_FEEDBACK_MS, 10) || 5_000,
  FACE_MATCH_THRESHOLD: 0.42,        // Euclidean distance (lower = stricter)
  REQUIRED_LOCK_FRAMES: 8,
  DETECTION_INTERVAL_MS: 80,
  DETECTION_INPUT_SIZE: 320,
  MIN_FACE_RATIO: 0.08,
  CENTER_THRESHOLD_X: 0.28,
  CENTER_THRESHOLD_Y: 0.32,
  REQUIRED_BLINKS: 1,
};

// Validation utilities
const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

// Head pose estimation
const getHeadPose = (landmarks) => {
  const pts = landmarks?.positions;
  if (!pts || pts.length < 68 || ![0, 16, 30, 36, 45].every(i => Number.isFinite(pts[i]?.x) && Number.isFinite(pts[i]?.y))) return null;
  const eyeDistance = Math.hypot(pts[45].x - pts[36].x, pts[45].y - pts[36].y);
  if (eyeDistance < 16) return null;
  // Measure along the eye axis so rolling a flat photo cannot imitate head yaw.
  const ux = (pts[45].x - pts[36].x) / eyeDistance;
  const uy = (pts[45].y - pts[36].y) / eyeDistance;
  const along = (a, b) => (a.x - b.x) * ux + (a.y - b.y) * uy;
  const dxLeft = along(pts[30], pts[0]), dxRight = along(pts[16], pts[30]);
  if (dxLeft <= 0 || dxRight <= 0) return null;
  const yawRatio = dxLeft / dxRight;
  const eyeMid = { x: (pts[36].x + pts[45].x) / 2, y: (pts[36].y + pts[45].y) / 2 };
  const noseOffset = along(pts[30], eyeMid) / eyeDistance;

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
  mode: MODES.QR,
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
const ScannerTerminal = () => {
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
  const cameraRequestRef = useRef(0);
  const cameraFacingRef = useRef('user');
  const captureTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const scanRequestRef = useRef(0);
  const qrAbortRef = useRef(null);
  const cameraPromiseRef = useRef(null);
  const cameraStartingRef = useRef(false);
  const photoObjectUrlRef = useRef(null);

  // Mutable detection state
  const vaultRef = useRef({
    processing: false,
    submitLock: false,
    lockFrames: 0,
    blinkCount: 0,
    blinkState: null,
    neutralPose: null,
    lastFaceAt: null,
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
    lastStatusText: null,
    modelsLoaded: false,
  });

  // Derived Styles
  const statusMeta = useMemo(() => {
    if (state.mode === MODES.FEEDBACK) {
      return state.feedback.type === 'success'
        ? { color: 'green', ring: '#22c55e', pill: 'bg-surface-muted text-white/80 border-line' }
        : { color: 'red', ring: '#ef4444', pill: 'bg-danger/25 text-white/80 border-danger/40' };
    }
    const isError = state.matchScore !== null && state.matchScore < 50;
    const isLocked = state.scanProgress >= 100;
    if (isError) return { color: 'red', ring: '#ef4444', pill: 'bg-danger/25 text-white/80 border-danger/40' };
    if (isLocked) return { color: 'green', ring: '#22c55e', pill: 'bg-surface-muted text-white/80 border-line' };
    return { color: 'blue', ring: '#3b82f6', pill: 'bg-accent/25 text-white/80 border-accent/40' };
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
    if (vaultRef.current.lastStatusText === text) return;
    vaultRef.current.lastStatusText = text;
    dispatch({ type: 'SET_LIVENESS', payload: { prompt: text } });
  }, [dispatch]);

  const throttledDispatch = useCallback((updates) => {
    const now = Date.now();
    if (now - vaultRef.current.lastUiUpdate < 80) return; // ~12fps UI updates
    vaultRef.current.lastUiUpdate = now;
    if ('scanProgress' in updates) dispatch({ type: 'SET_PROGRESS', payload: updates.scanProgress });
    if ('matchScore' in updates) dispatch({ type: 'SET_MATCH', payload: updates.matchScore });
  }, [dispatch]);

  // Camera Stop Controls
  const stopFaceCamera = useCallback(() => {
    cameraRequestRef.current++;
    clearTimeout(captureTimerRef.current);
    if (detectionRef.current) {
      detectionRef.current.stop();
      detectionRef.current = null;
    }
    stopHardwareStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.onloadedmetadata = null;
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopQr = useCallback(() => {
    return stopQrCamera(qrRef.current);
  }, []);

  // Session Reset
  const handleReset = useCallback(() => {
    scanRequestRef.current++;
    clearTimeout(feedbackTimerRef.current);
    qrAbortRef.current?.abort();
    qrAbortRef.current = null;
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
    photoObjectUrlRef.current = null;
    stopFaceCamera();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    vaultRef.current.processing = false;
    vaultRef.current.submitLock = false;
    vaultRef.current.lockFrames = 0;
    vaultRef.current.blinkCount = 0;
    vaultRef.current.blinkState = null;
    vaultRef.current.neutralPose = null;
    vaultRef.current.lastFaceAt = null;
    vaultRef.current.earHistory = [];
    vaultRef.current.depthSamples = [];
    vaultRef.current.padStage = 'ALIGN';
    vaultRef.current.targetDirection = null;
    vaultRef.current.challengeTurnFrames = 0;
    vaultRef.current.challengePassed = false;
    vaultRef.current.recenterFrames = 0;
    vaultRef.current.flashActive = false;
    vaultRef.current.matchScore = null;
    vaultRef.current.employeeId = null;
    vaultRef.current.baseline = null;
    vaultRef.current.isMedicalExempt = false;
    vaultRef.current.medicalExemption = null;
    dispatch({ type: 'RESET' });
    dispatch({ type: 'SET_MODE', payload: MODES.QR });
  }, [stopFaceCamera, dispatch]);

  // Listen for real-time security events
  useEffect(() => {
    const channel = supabase
      .channel('scanner_disciplinary_realtime')
      .on('broadcast', { event: 'DISCIPLINARY_CREATED' }, ({ payload }) => {
        if (!payload) return;
        const isSuspOrTerm = payload.type === 'Suspension' || payload.type === 'Termination' || payload.employee_status === 'suspended';
        if (isSuspOrTerm && vaultRef.current.employeeId && vaultRef.current.employeeId === payload.employee_id) {
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
        if (payload && vaultRef.current.employeeId && vaultRef.current.employeeId === payload.employee_id) {
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
        if (payload?.employee_id && vaultRef.current.employeeId === payload.employee_id) {
          handleReset();
          toast('Medical Grace changed. Scan the QR again to verify the current authorization.', { id: 'biometric-exemption-sync', duration: 4000 });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleReset]);

  // Capture frame and submit to backend
  const captureAndSubmit = useCallback(async (finalScore, blinkCount, earHistory, verifiedImage = null) => {
    if (vaultRef.current.submitLock) return;
    const request = scanRequestRef.current;
    vaultRef.current.submitLock = true;
    dispatch({ type: 'SET_MODE', payload: MODES.PROCESSING });
    dispatch({ type: 'SET_LOADING', payload: 'Submitting verification...' });

    // Capture camera snapshot
    let img64;
    try {
      const captureVideo = vaultRef.current.isMedicalExempt ? document.querySelector('#qr-reader video') : videoRef.current;
      img64 = verifiedImage || captureVideoFrame(captureVideo);
    } catch {
      // An optional QR-camera audit frame must not start or require face verification.
      img64 = null;
    }

    const eid = vaultRef.current.employeeId;
    if (!eid || !isValidUUID(eid)) {
      dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'SYSTEM ERROR', message: 'Invalid employee session. Scan again.', code: 'INVALID_SESSION' } });
      playSound('error'); haptic('error');
      feedbackTimerRef.current = setTimeout(() => { if (request === scanRequestRef.current) handleReset(); }, ENV.FEEDBACK_DISPLAY_MS);
      return;
    }

    // Build liveness telemetry payload
    const depthVariance = calculateVariance(vaultRef.current.depthSamples);
    const livenessPayload = vaultRef.current.isMedicalExempt ? {
      method: 'medical_grace_exemption',
      is_exempt: true,
      client_timestamp: new Date().toISOString()
    } : {
      method: 'active_3d_head_challenge',
      challenge_type: vaultRef.current.targetDirection || 'TURN_LEFT',
      challenge_passed: Boolean(vaultRef.current.challengePassed),
      depth_variance: depthVariance,
      blink_count: blinkCount,
      ear_min: earHistory.length ? Math.min(...earHistory) : 0.0,
      ear_max: earHistory.length ? Math.max(...earHistory) : 0.0,
      ear_avg: earHistory.length ? (earHistory.reduce((a, b) => a + b, 0) / earHistory.length) : 0.0,
      flash_reflectance_confirmed: false,
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
          face_match_score: vaultRef.current.isMedicalExempt ? undefined : finalScore ?? vaultRef.current.matchScore ?? 0,
          liveness_data: livenessPayload,
        }),
      });

      let data;
      try { data = await res.json(); } catch { data = { status: 'error', message: 'Invalid server response' }; }
      if (request !== scanRequestRef.current) return;

      if (!res.ok) {
        // Backend returns structured errors: { status, code, message, requestId }
        const errCode = data.code || `HTTP_${res.status}`;
        const reqId = data.requestId || 'unknown';
        let friendly = data.message || 'Verification failed.';

        // Map HTTP status codes to user-friendly messages
        if (res.status === 429) friendly = 'Too many scans. Please wait 60 seconds.';
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
      if (request !== scanRequestRef.current) return;
      if (err.name === 'AbortError') {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'Cancelled', message: 'Scan was interrupted.', image: img64 } });
      } else {
        dispatch({ type: 'SET_FEEDBACK', payload: { type: 'error', title: 'Connection error', message: 'Cannot reach attendance server. Check internet connection.', image: img64 } });
      }
      playSound('error'); haptic('error');
    }

    feedbackTimerRef.current = setTimeout(() => { if (request === scanRequestRef.current) handleReset(); }, ENV.FEEDBACK_DISPLAY_MS);
  }, [handleReset, dispatch]);

  // Face Detection Loop
  const runDetectionLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const frame = video.ownerDocument.createElement('canvas');
    detectionRef.current?.stop();

    const syncCanvas = () => {
      const nw = frame.width, nh = frame.height;
      if (nw && nh && (canvas.width !== nw || canvas.height !== nh)) {
        canvas.width = nw;
        canvas.height = nh;
      }
    };
    syncCanvas();

    const vault = vaultRef.current;
    const interruptEvidence = () => {
      resetBlinkCycle(vault.blinkState);
      vault.blinkCount = 0;
      vault.lockFrames = 0;
      vault.challengeTurnFrames = 0;
      vault.recenterFrames = 0;
    };
    const resetChallenge = () => {
      vault.blinkState = createBlinkState();
      interruptEvidence();
      vault.earHistory = [];
      vault.depthSamples = [];
      vault.neutralPose = null;
      vault.lastFaceAt = null;
      vault.lastStatusText = null;
      vault.padStage = 'ALIGN';
      vault.targetDirection = crypto.getRandomValues(new Uint32Array(1))[0] % 2 ? 'TURN_RIGHT' : 'TURN_LEFT';
      vault.challengePassed = false;
      vault.flashActive = false;
      vault.submitLock = false;
      dispatch({ type: 'SET_PROGRESS', payload: 0 });
      dispatch({ type: 'SET_MATCH', payload: null });
      dispatch({ type: 'SET_LIVENESS', payload: {
        stage: 'ALIGN', targetDirection: vault.targetDirection, status: 'ALIGNING',
        blinkCount: 0, ear: null, passed: false, flashActive: false, prompt: 'Look directly at the camera',
      } });
    };
    resetChallenge();

    detectionRef.current = startVideoFrameLoop(video, async isActive => {
      if (!copyVideoFrame(video, frame)) return;
      syncCanvas();
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Face detection using TinyFaceDetector
      const det = await faceapi
        .detectSingleFace(frame, new faceapi.TinyFaceDetectorOptions({
          inputSize: ENV.DETECTION_INPUT_SIZE,
          scoreThreshold: 0.40
        }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!isActive()) return;

      if (!det) {
        interruptEvidence();
        throttledDispatch({ scanProgress: Math.max(0, (vaultRef.current.lockFrames / ENV.REQUIRED_LOCK_FRAMES) * 100), matchScore: null });
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
      let currentScore = 0;

      if (vaultRef.current.baseline && liveDsc) {
        const dist = faceapi.euclideanDistance(vaultRef.current.baseline, liveDsc);
        matched = dist < ENV.FACE_MATCH_THRESHOLD;
        currentScore = Math.round((1 - dist) * 100);
        vaultRef.current.matchScore = currentScore;
      } else if (!vaultRef.current.baseline) {
        // No baseline = photo-only mode (backend will decide if allowed)
        currentScore = 0;
        matched = true;
      }

      if (!centered || !bigEnough) {
        interruptEvidence();
        throttledDispatch({ scanProgress: Math.max(0, (vaultRef.current.lockFrames / ENV.REQUIRED_LOCK_FRAMES) * 100) });
        updateStatus(!bigEnough ? 'Move closer to the camera' : 'Center your face in the frame');
        drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        return;
      }

      if (!matched) {
        resetChallenge();
        throttledDispatch({ scanProgress: 0, matchScore: currentScore });
        updateStatus('Face not recognized. Try again');
        drawFaceMesh(ctx, det.landmarks, box, 'mismatch');
        return;
      }

      // Calculate Head Pose and Eye Aspect Ratio
      const pose = getHeadPose(det.landmarks);
      const eyes = getEyeOpenness(det.landmarks);
      const minConfidence = vault.padStage === 'CENTER_BLINK' ? 0.42 : .55;
      if (!eyes || !pose || det.detection.score < minConfidence || !Number.isFinite(pose.yawRatio) || pose.yawRatio <= 0 || !Number.isFinite(pose.noseOffset)) {
        interruptEvidence();
        updateStatus('Move closer so both eyes are clear');
        dispatch({ type: 'SET_LIVENESS', payload: { status: 'EYES_UNCLEAR', blinkCount: 0 } });
        return;
      }
      const now = performance.now();
      if (vault.lastFaceAt !== null && now - vault.lastFaceAt > 650) resetChallenge();
      vault.lastFaceAt = now;
      const ear = eyes.mean;
      vaultRef.current.earHistory.push(ear);
      if (vaultRef.current.earHistory.length > 50) vaultRef.current.earHistory.shift();

      // A 2D movement proxy, not a depth-camera measurement or proof of liveness.
      if (vault.padStage !== 'CENTER_BLINK') {
        vault.depthSamples.push(pose.noseOffset);
        if (vault.depthSamples.length > 60) vault.depthSamples.shift();
      }
      const relativeYaw = vault.neutralPose ? pose.yawRatio / vault.neutralPose.yawRatio : 1;
      const relativeNose = vault.neutralPose ? pose.noseOffset - vault.neutralPose.noseOffset : 0;

      // Challenge state machine
      // 1. Align face
      if (vaultRef.current.padStage === 'ALIGN') {
        if (pose.isCentered) {
          const eyesReady = calibrateBlink(vault.blinkState, eyes, now);
          vaultRef.current.lockFrames += 1;
          const progress = Math.min((vaultRef.current.lockFrames / 3) * 25, 25);
          throttledDispatch({ scanProgress: progress, matchScore: currentScore });
          updateStatus(eyesReady ? 'Face detected. Checking presence...' : BLINK_PROMPTS.CALIBRATING);
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');

          if (vaultRef.current.lockFrames >= 3 && eyesReady) {
            vault.neutralPose = { yawRatio: pose.yawRatio, noseOffset: pose.noseOffset };
            vaultRef.current.padStage = 'CHALLENGE';
            vaultRef.current.challengeTurnFrames = 0;
            playSound('scan');
            haptic('scan');
            dispatch({
              type: 'SET_LIVENESS',
              payload: {
                stage: 'CHALLENGE',
                targetDirection: vaultRef.current.targetDirection,
                status: vaultRef.current.targetDirection === 'TURN_LEFT' ? 'TURN_LEFT' : 'TURN_RIGHT',
                ear
              }
            });
          }
        } else {
          interruptEvidence();
          updateStatus('Look directly at the camera');
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        }
        return;
      }

      // 2. Head turn challenge
      if (vaultRef.current.padStage === 'CHALLENGE') {
        const targetTurnMet = vaultRef.current.targetDirection === 'TURN_LEFT'
          ? relativeYaw >= 1.38 || relativeNose >= .16
          : relativeYaw <= .72 || relativeNose <= -.16;
        const directiveText = vaultRef.current.targetDirection === 'TURN_LEFT'
          ? 'Turn your head slightly to the left'
          : 'Turn your head slightly to the right';

        if (targetTurnMet) {
          vaultRef.current.challengeTurnFrames += 1;
          const progress = 25 + Math.min((vaultRef.current.challengeTurnFrames / 2) * 35, 35);
          throttledDispatch({ scanProgress: progress, matchScore: currentScore });
          updateStatus('Head turn detected');
          drawFaceMesh(ctx, det.landmarks, box, 'locked');

          if (vaultRef.current.challengeTurnFrames >= 2) {
            if (calculateVariance(vault.depthSamples) < .0005) {
              updateStatus('Turn a little farther');
              return;
            }
            vaultRef.current.challengePassed = true;
            vaultRef.current.padStage = 'CENTER_BLINK';
            vaultRef.current.recenterFrames = 0;
            resetBlinkCycle(vault.blinkState);
            vault.blinkCount = 0;
            playSound('scan');
            haptic('scan');
            dispatch({
              type: 'SET_LIVENESS',
              payload: {
                stage: 'CENTER_BLINK',
                targetDirection: vaultRef.current.targetDirection,
                status: 'RECENTER',
                ear
              }
            });
          }
        } else {
          vault.challengeTurnFrames = 0;
          throttledDispatch({ scanProgress: 35, matchScore: currentScore });
          updateStatus(directiveText);
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
        }
        return;
      }

      // 3. Re-center and blink
      if (vaultRef.current.padStage === 'CENTER_BLINK') {
        const blinkInProgress = vault.blinkState && ['ARMED', 'CLOSING', 'CLOSED', 'REOPEN', 'PASSED'].includes(vault.blinkState.phase);
        const maxLogYaw = blinkInProgress ? .38 : .24;
        const maxNose = blinkInProgress ? .22 : .13;
        const returned = vault.neutralPose && Math.abs(Math.log(relativeYaw)) <= maxLogYaw && Math.abs(relativeNose) <= maxNose;
        if (!returned) {
          vault.recenterFrames = 0;
          resetBlinkCycle(vault.blinkState);
          vault.blinkCount = 0;
          dispatch({ type: 'SET_LIVENESS', payload: { status: 'RECENTER', blinkCount: 0 } });
          throttledDispatch({ scanProgress: 60, matchScore: currentScore });
          updateStatus('Turn face back to center');
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
          return;
        }

        vault.recenterFrames++;
        if (vault.recenterFrames < 3) {
          updateStatus('Face the camera');
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
          return;
        }
        updateBlink(vault.blinkState, eyes, now);
        vault.blinkCount = vault.blinkState.count;

        // Instant audio cue when eyes close so employee knows to reopen without peeking
        if (vault.lastBlinkPhase !== vault.blinkState.phase) {
          if (vault.blinkState.phase === 'CLOSED') {
            playSound('scan');
          }
          vault.lastBlinkPhase = vault.blinkState.phase;
        }

        if (vaultRef.current.blinkCount < ENV.REQUIRED_BLINKS) {
          throttledDispatch({ scanProgress: 75, matchScore: currentScore });
          updateStatus(BLINK_PROMPTS[vault.blinkState.phase]);
          dispatch({
            type: 'SET_LIVENESS',
            payload: {
              stage: 'CENTER_BLINK',
              status: vault.blinkState.phase,
              blinkCount: vaultRef.current.blinkCount,
              ear
            }
          });
          drawFaceMesh(ctx, det.landmarks, box, 'scanning');
          return;
        }

        // Completed challenge and blink
        vaultRef.current.padStage = 'FLASH_CAPTURE';
        throttledDispatch({ scanProgress: 90, matchScore: currentScore });
        updateStatus('Presence check complete. Verifying attendance...');
        dispatch({
          type: 'SET_LIVENESS',
          payload: {
            stage: 'FLASH_CAPTURE',
            status: 'PASSED',
            passed: true,
            blinkCount: vaultRef.current.blinkCount,
            flashActive: true,
            ear
          }
        });
        drawFaceMesh(ctx, det.landmarks, box, 'locked');

        // Flash and capture snapshot
        detectionRef.current?.stop();
        detectionRef.current = null;

        const request = cameraRequestRef.current;
        const verifiedImage = frame.toDataURL('image/jpeg', 0.9);
        captureTimerRef.current = setTimeout(() => {
          if (request !== cameraRequestRef.current) return;
          captureAndSubmit(currentScore, vaultRef.current.blinkCount, vaultRef.current.earHistory, verifiedImage);
        }, 0);
        return;
      }
    }, { intervalMs: ENV.DETECTION_INTERVAL_MS, onError: error => {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      dispatch({ type: 'SET_ERROR', payload: {
        message: error?.code === 'FACE_PROCESSING_TIMEOUT' ? 'Face processing timed out. Reload this page to retry.' : 'Face tracking interrupted. Restart the scanner to retry.',
        code: error?.code || 'FACE_PROCESSING_FAILED',
      } });
    } });
  }, [dispatch, throttledDispatch, updateStatus, captureAndSubmit]);

  // Start face camera
  const startFaceCamera = useCallback(async (facing = cameraFacingRef.current) => {
    stopFaceCamera();
    const request = ++cameraRequestRef.current;
    cameraStartingRef.current = true;
    dispatch({ type: 'SET_LOADING', payload: 'Starting camera...' });
    try {
      await stopQr();
      if (request !== cameraRequestRef.current) return;
      if (cameraPromiseRef.current) await cameraPromiseRef.current.catch(() => {});
      if (request !== cameraRequestRef.current) return;
      const opening = requestHardwareCamera({ facingMode: facing });
      cameraPromiseRef.current = opening;
      let stream;
      try { stream = await opening; }
      finally { if (cameraPromiseRef.current === opening) cameraPromiseRef.current = null; }
      if (request !== cameraRequestRef.current || !videoRef.current) {
        stopHardwareStream(stream);
        return;
      }
      streamRef.current = stream;
      const actualFacing = stream.getVideoTracks?.()[0]?.getSettings?.().facingMode;
      cameraFacingRef.current = ['user', 'environment'].includes(actualFacing) ? actualFacing : facing;
      setCameraFacing(cameraFacingRef.current);
      if (videoRef.current) {
        const video = videoRef.current;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.onloadedmetadata = async () => {
          if (request !== cameraRequestRef.current) return;
          try {
            await video.play();
            if (request !== cameraRequestRef.current) return;
            dispatch({ type: 'SET_LOADING', payload: '' });
            runDetectionLoop();
          } catch {
            if (request === cameraRequestRef.current) {
              stopFaceCamera();
              dispatch({ type: 'SET_ERROR', payload: { message: 'Camera playback could not start. Retry the scanner.', code: 'CAMERA_PLAYBACK_FAILED' } });
            }
          }
        };
        video.srcObject = stream;
      }
    } catch (error) {
      if (request !== cameraRequestRef.current) return;
      const denied = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name);
      const message = denied ? 'Camera access denied. Enable permissions.' : 'Camera is busy or unavailable. Close other camera apps and retry.';
      toast.error(message);
      dispatch({ type: 'SET_ERROR', payload: { message, code: denied ? 'CAMERA_DENIED' : 'CAMERA_UNAVAILABLE' } });
    } finally {
      if (request === cameraRequestRef.current) cameraStartingRef.current = false;
    }
  }, [runDetectionLoop, stopFaceCamera, stopQr, dispatch]);

  // Toggle front and rear camera
  const toggleCameraFacing = useCallback(async () => {
    if (cameraStartingRef.current) return;
    playSound('scan');
    haptic('scan');
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    cameraFacingRef.current = nextFacing;
    setCameraFacing(nextFacing);
    if (detectionRef.current) {
      detectionRef.current.stop();
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
    if (vaultRef.current.processing) return;
    const request = ++scanRequestRef.current;
    clearTimeout(feedbackTimerRef.current);
    qrAbortRef.current?.abort();
    const qrController = new AbortController();
    qrAbortRef.current = qrController;
    vaultRef.current.processing = true;
    playSound('scan');
    haptic('scan');
    dispatch({ type: 'SET_LOADING', payload: 'Verifying employee...' });

    const companyId = text.trim();

    try {
      // 1. Fast employee lookup via backend
      const res = await fetchWithAuth(`/api/attendance/verify-qr/${encodeURIComponent(companyId)}`, { signal: qrController.signal });
      const data = await res.json();
      if (request !== scanRequestRef.current) return;
      
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message?.includes('BIOMETRICS REQUIRED') ? 'BIOMETRICS_NOT_REGISTERED' : 'EMPLOYEE_NOT_FOUND');
      }
      
      const emp = data.data;

      if (emp.is_attendance_exempt) {
        throw new Error('ATTENDANCE_EXEMPT');
      }

      const empStatus = String(emp.status || '').toLowerCase();
      if (!emp.is_active || empStatus === 'suspended' || empStatus === 'inactive' || empStatus === 'terminated') {
        if (empStatus === 'suspended') throw new Error('EMPLOYEE_SUSPENDED');
        if (empStatus === 'terminated' || empStatus === 'inactive') throw new Error('EMPLOYEE_TERMINATED');
        throw new Error('EMPLOYEE_INACTIVE');
      }

      // Check biometric registration
      const hasBiometrics = hasRegisteredFace(emp);
      if (!hasBiometrics) {
        throw new Error('BIOMETRICS_NOT_REGISTERED');
      }

      vaultRef.current.employeeId = emp.id;
      vaultRef.current.isMedicalExempt = Boolean(emp.is_medical_exempt);
      vaultRef.current.medicalExemption = emp.medical_exemption || null;
      dispatch({ type: 'SET_EMPLOYEE', payload: emp });

      // HR-authorized grace records attendance directly from this QR scan.
      if (emp.is_medical_exempt) {
        vaultRef.current.baseline = null;
        dispatch({ type: 'SET_BASELINE', payload: null });
        dispatch({ type: 'SET_PHOTO', payload: emp.avatar_url || null });
        await captureAndSubmit(null, 0, []);
        return;
      }

      if (!vaultRef.current.modelsLoaded) throw new Error('FACE_MODELS_NOT_READY');
      dispatch({ type: 'SET_MODE', payload: MODES.PREP });

      // Load baseline biometrics with timeout
      const storagePath = emp.biometric_baseline_path;
      const mediaSession = getPrivateMediaSession();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const abortBaseline = () => controller.abort();
        qrController.signal.addEventListener('abort', abortBaseline, { once: true });
        if (qrController.signal.aborted) abortBaseline();

        let blob;
        try {
          const signal = controller.signal;
          const media = await resolvePrivateMedia(storagePath, { signal });
          if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;
          const imgRes = await fetch(media.url, { signal, cache: 'no-store' });
          if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;
          if (!imgRes.ok) throw new Error('BASELINE_NOT_FOUND');
          blob = await imgRes.blob();
        }
        finally {
          clearTimeout(timeoutId);
          qrController.signal.removeEventListener('abort', abortBaseline);
        }
        if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;

        const url = URL.createObjectURL(blob);
        if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = url;
        dispatch({ type: 'SET_PHOTO', payload: url });

        // Extract face descriptor using TinyFaceDetector
        dispatch({ type: 'SET_LOADING', payload: 'Loading facial profile...' });
        const img = await loadImage(url);
        if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;

        let det = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 }))
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;

        if (!det?.descriptor) {
          // Fallback to SsdMobilenetv1 only if tiny detector missed
          await loadBaselineFallbackModel();
          if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;
          det = await faceapi
            .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.1 }))
            .withFaceLandmarks()
            .withFaceDescriptor();
          if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;
        }

        if (det?.descriptor) {
          vaultRef.current.baseline = det.descriptor;
          dispatch({ type: 'SET_BASELINE', payload: det.descriptor });
        } else {
          vaultRef.current.baseline = null;
          dispatch({ type: 'SET_BASELINE', payload: null });
        }
      } catch (baselineErr) {
        if (request !== scanRequestRef.current || mediaSession !== getPrivateMediaSession()) return;
        if (['MEDIA_FORBIDDEN', 'MEDIA_INVALID_PATH', 'MEDIA_UNAUTHENTICATED', 'MEDIA_INVALID_RESPONSE'].includes(baselineErr.message)) throw baselineErr;
        console.warn('[QR_FLOW] Baseline image skipped or timed out:', baselineErr);
        vaultRef.current.baseline = null;
        dispatch({ type: 'SET_BASELINE', payload: null });
        dispatch({ type: 'SET_PHOTO', payload: emp.avatar_url || null });
      }

      dispatch({ type: 'SET_LOADING', payload: '' });
    } catch (err) {
      if (request !== scanRequestRef.current) return;
      console.error('[QR_FLOW]', err);
      const mediaDenied = ['MEDIA_FORBIDDEN', 'MEDIA_INVALID_PATH', 'MEDIA_UNAUTHENTICATED', 'MEDIA_INVALID_RESPONSE'].includes(err.message);
      if (mediaDenied) {
        vaultRef.current.employeeId = null;
        dispatch({ type: 'SET_EMPLOYEE', payload: null });
        dispatch({ type: 'SET_PHOTO', payload: null });
      }
      vaultRef.current.baseline = null;
      dispatch({ type: 'SET_BASELINE', payload: null });
      dispatch({ type: 'SET_LOADING', payload: '' });
      dispatch({ type: 'SET_MODE', payload: mediaDenied ? MODES.QR : MODES.PREP });
      const errFriendly =
        err.message === 'ATTENDANCE_EXEMPT' ? 'Personnel is an attendance-exempt operator (Admin / Guard). Attendance clock-in is not required.' :
        err.message === 'EMPLOYEE_NOT_FOUND' ? 'ID card not recognized. Please scan again.' :
        err.message === 'EMPLOYEE_SUSPENDED' ? 'Account suspended. Please speak with HR.' :
        err.message === 'EMPLOYEE_TERMINATED' ? 'Account inactive. Please contact HR.' :
        err.message === 'EMPLOYEE_INACTIVE' ? 'Account inactive. Please contact HR.' :
        err.message === 'FACE_MODELS_NOT_READY' ? 'Face verification is still loading or unavailable. Please wait or refresh the kiosk.' :
        mediaDenied ? 'Facial profile access is unavailable. Please contact HR or sign in again.' :
        err.message === 'BIOMETRICS_NOT_REGISTERED' ? 'Face scan not registered. Please visit HR to set up your profile.' :
        (err.message?.includes('BIOMETRICS REQUIRED') ? 'Face scan not registered. Please visit HR to set up your profile.' : 'Identification error. Please try again.');
      toast.error(errFriendly, { id: 'qr-scan-error', duration: 4500 });
      playSound('error');
      haptic('error');
      updateStatus(errFriendly);
      feedbackTimerRef.current = setTimeout(() => {
        if (request !== scanRequestRef.current) return;
        vaultRef.current.processing = false;
        dispatch({ type: 'SET_MODE', payload: MODES.QR });
      }, 2500);
    }
  }, [dispatch, updateStatus, captureAndSubmit]);

  // QR scanner initialization
  const startQr = useCallback(async () => {
    if (qrRef.current?.wanted) return;
    dispatch({ type: 'SET_LOADING', payload: 'Connecting camera...' });
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1024);
    qrRef.current ||= createQrScanner('qr-reader');
    const started = await startQrCamera(qrRef.current, {
      facingMode: isMobile ? 'environment' : 'user',
      onScan: onQrSuccess,
      onError: error => {
        if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) setShowPermHelp(true);
        dispatch({ type: 'SET_LOADING', payload: '' });
        dispatch({ type: 'SET_MODE', payload: MODES.CAMERA_PROMPT });
      },
    });
    if (started) {
      dispatch({ type: 'SET_MODE', payload: MODES.QR });
      dispatch({ type: 'SET_LOADING', payload: '' });
    }
  }, [onQrSuccess, dispatch]);

  // Mode Lifecycle
  useEffect(() => {
    if (state.mode === MODES.QR) {
      stopFaceCamera();
      startQr();
    }
    if (state.mode === MODES.FACE) {
      startFaceCamera();
    } else if (state.mode !== MODES.QR) {
      stopFaceCamera();
      stopQr();
    }

    // Session safety timer
    clearTimeout(sessionTimerRef.current);
    if (state.mode === MODES.PREP || state.mode === MODES.FACE) {
      sessionTimerRef.current = setTimeout(() => {
        toast.error('Session timed out. Returning to scanner.');
        handleReset();
      }, ENV.SCAN_TIMEOUT_MS);
    }
  }, [state.mode, startQr, stopQr, startFaceCamera, stopFaceCamera, handleReset]);

  // Initialize models, clock, and viewport
  useEffect(() => {
    let mounted = true;
    let wakeLock = null;
    const pendingScan = scanRequestRef;

    // Load models
    (async () => {
      try {
        await loadFaceModels();
        if (mounted) {
          vaultRef.current.modelsLoaded = true;
          dispatch({ type: 'SET_MODELS_LOADED' });
        }
      } catch (err) {
        console.error('[BOOT]', err);
        if (mounted) toast.error('Face verification unavailable. Approved Medical Grace QR attendance remains available. Refresh to retry face verification.');
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
      const vault = vaultRef.current;
      dispatch({ type: 'SET_DEBUG_INFO', payload: {
        employeeId: vault.employeeId, hasBaseline: Boolean(vault.baseline),
        padStage: vault.padStage, targetDirection: vault.targetDirection,
        depthVariance: calculateVariance(vault.depthSamples), lockFrames: vault.lockFrames,
      } });
    }, 1000);

    // Online status
    const onOnline = () => dispatch({ type: 'SET_ONLINE', payload: true });
    const onOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Dynamic Responsive Camera CSS
    const style = document.createElement('link');
    style.id = 'scanner-css';
    style.rel = 'stylesheet';
    style.href = scannerStylesUrl;
    document.head.appendChild(style);

    // Lock viewport meta on mobile devices to strictly prevent browser zooming
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const originalViewportContent = viewportMeta ? viewportMeta.getAttribute('content') : null;
    if (viewportMeta) {
      viewportMeta.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      );
    }

    // Multi-tier touch & gesture anti-zoom barrier
    const preventPinchZoom = (e) => {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const preventGestureZoom = (e) => {
      e.preventDefault();
    };

    let lastTouchEndTime = 0;
    const preventDoubleTapZoom = (e) => {
      const now = Date.now();
      if (now - lastTouchEndTime <= 300) {
        e.preventDefault();
      }
      lastTouchEndTime = now;
    };

    window.addEventListener('touchstart', preventPinchZoom, { passive: false });
    window.addEventListener('touchmove', preventPinchZoom, { passive: false });
    window.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
    window.addEventListener('gesturestart', preventGestureZoom, { passive: false });
    window.addEventListener('gesturechange', preventGestureZoom, { passive: false });
    window.addEventListener('gestureend', preventGestureZoom, { passive: false });

    // Wake lock (keep screen on)
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(lock => { if (mounted) wakeLock = lock; else lock.release().catch(() => {}); }).catch(() => {});
    }

    return () => {
      mounted = false;
      pendingScan.current++;
      clearTimeout(feedbackTimerRef.current);
      qrAbortRef.current?.abort();
      if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
      stopFaceCamera();
      stopQr();
      abortControllerRef.current?.abort();
      clearInterval(tick);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('touchstart', preventPinchZoom);
      window.removeEventListener('touchmove', preventPinchZoom);
      window.removeEventListener('touchend', preventDoubleTapZoom);
      window.removeEventListener('gesturestart', preventGestureZoom);
      window.removeEventListener('gesturechange', preventGestureZoom);
      window.removeEventListener('gestureend', preventGestureZoom);
      if (viewportMeta && originalViewportContent) {
        viewportMeta.setAttribute('content', originalViewportContent);
      }
      document.getElementById('scanner-css')?.remove();
      wakeLock?.release().catch(() => {});
    };
  }, [stopFaceCamera, stopQr]);

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
    <div className="scanner-root h-[100dvh] w-screen bg-black text-white relative overflow-hidden font-sans select-none touch-none overscroll-none">


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
              <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent-on-dark mb-4">
                <Camera className="w-8 h-8 text-accent-on-dark" />
              </div>

              <h2 className="text-xl font-bold text-white tracking-tight mb-1.5">
                Enable Camera Access
              </h2>
              <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                Attendance gate requires camera access to scan employee badges and verify photo identity.
              </p>

              <button
                onClick={() => startQr(true)}
                className="w-full py-3.5 bg-accent hover:bg-accent text-white rounded-xl font-bold tracking-wide text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-slate-900/20"
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
                  <div className="w-8 h-8 rounded-md bg-accent/10 text-accent-on-dark border border-accent/20 flex items-center justify-center">
                    <SlidersHorizontal className="w-4 h-4 text-accent-on-dark" />
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
                    permTab === 'ios' ? 'bg-accent text-white shadow-2xs' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Apple className="w-3.5 h-3.5" /> iPhone (iOS)
                </button>
                <button
                  onClick={() => setPermTab('android')}
                  className={`h-8 text-xs font-semibold rounded-sm transition-colors duration-100 flex items-center justify-center gap-1.5 cursor-pointer ${
                    permTab === 'android' ? 'bg-accent text-white shadow-2xs' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" /> Android
                </button>
              </div>

              {/* iOS Guide */}
              {permTab === 'ios' && (
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                    <p>Tap the <span className="font-bold text-white bg-white/10 px-1 py-0.5 rounded-sm">aA</span> icon in your Safari address bar.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                    <p>Select <span className="font-bold text-white">Website Settings</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                    <p>Change <span className="font-bold text-white">Camera</span> from Deny to <span className="font-bold text-ink">Allow</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">4</span>
                    <p>Tap <span className="font-bold text-white">Done</span> and tap the button below to start.</p>
                  </div>
                </div>
              )}

              {/* Android Guide */}
              {permTab === 'android' && (
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                    <p>Tap the <span className="font-bold text-white bg-white/10 px-1 py-0.5 rounded-sm inline-flex items-center gap-1"><Lock className="w-3 h-3 text-accent-on-dark inline" /> Lock</span> icon next to the URL.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                    <p>Tap <span className="font-bold text-white">Permissions</span> &rarr; <span className="font-bold text-white">Camera</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                    <p>Switch setting to <span className="font-bold text-ink">Allow</span>.</p>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 bg-white/5 rounded-md border border-white/5">
                    <span className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">4</span>
                    <p>Return to this page and tap <span className="font-bold text-white">Retry Connection</span>.</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setShowPermHelp(false);
                  startQr(true);
                }}
                className="mt-5 w-full h-10 bg-accent hover:bg-accent text-white rounded-md font-semibold tracking-wider uppercase text-xs transition-colors duration-100 flex items-center justify-center gap-2 shadow-2xs cursor-pointer"
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
                  <ProtectedImage src={state.employeePhotoUrl} alt="Baseline" className="w-full h-full object-cover" />
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
                <div className="w-full my-3 p-3 bg-warning/15 border border-warning/40 rounded-md text-left">
                  <div className="flex items-center gap-2 text-warning font-bold text-xs">
                    <HeartPulse className="w-4 h-4 text-warning shrink-0" />
                    <span>Medical exemption on file</span>
                  </div>
                  <p className="text-[11px] text-white/80 mt-1 leading-tight">
                    HR-authorized QR-only attendance. No face scan or liveness challenge is required.
                  </p>
                  {state.employee?.medical_exemption?.valid_until && (
                    <div className="mt-1.5 text-[10px] text-warning/90 font-mono">
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
                onClick={() => state.employee?.is_medical_exempt ? captureAndSubmit(null, 0, []) : dispatch({ type: 'SET_MODE', payload: MODES.FACE })}
                className={`w-full h-10 ${state.employee?.is_medical_exempt ? 'bg-warning hover:bg-warning' : 'bg-accent hover:bg-accent'} text-white rounded-md font-semibold text-xs tracking-wide transition-colors duration-100 flex items-center justify-center gap-2 shadow-2xs cursor-pointer`}
              >
                {state.employee?.is_medical_exempt ? <Camera className="w-4 h-4" /> : <Scan className="w-4 h-4" />}
                <span>{state.employee?.is_medical_exempt ? 'Record QR attendance' : 'Start face scan'}</span>
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
              className={`absolute inset-0 w-full h-full object-contain ${cameraFacing === 'user' ? '-scale-x-100' : 'scale-x-100'}`}
              playsInline 
              muted 
              autoPlay 
            />
            <canvas 
              ref={canvasRef} 
              className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${cameraFacing === 'user' ? '-scale-x-100' : 'scale-x-100'}`}
            />

            {/* Screen flash pulse */}
            {state.liveness.flashActive && (
              <div className="absolute inset-0 z-50 bg-accent/20 border-[8px] border-accent pointer-events-none transition-opacity duration-150 animate-pulse shadow-[inset_0_0_80px_rgba(37,99,235,0.35)]" />
            )}

            {/* Direction challenge prompt */}
            {state.liveness.stage === 'CHALLENGE' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-6 sm:px-14 z-30">
                {state.liveness.targetDirection === 'TURN_LEFT' ? (
                  <div className="flex flex-col items-center gap-2 bg-slate-950 border border-warning text-warning px-4 py-3 rounded-md shadow-xl animate-pulse">
                    <ArrowLeft className="w-7 h-7 sm:w-8 sm:h-8 text-warning" />
                    <span className="text-[11px] font-bold tracking-wide">Turn left</span>
                  </div>
                ) : <div />}
                {state.liveness.targetDirection === 'TURN_RIGHT' ? (
                  <div className="flex flex-col items-center gap-2 bg-slate-950 border border-warning text-warning px-4 py-3 rounded-md shadow-xl animate-pulse">
                    <ArrowRight className="w-7 h-7 sm:w-8 sm:h-8 text-warning" />
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
              <span role="status" aria-live="polite" aria-atomic="true" className={`px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide border shadow-2xs flex items-center gap-1.5 sm:gap-2 max-w-[56vw] sm:max-w-xs md:max-w-none whitespace-normal text-center leading-snug shrink min-w-0 ${statusMeta.pill}`}>
                {state.employee?.is_medical_exempt ? (
                  <>
                    <HeartPulse className="w-3.5 h-3.5 text-warning" />
                    <span>Medical Grace: Recording QR attendance...</span>
                  </>
                ) : state.liveness.stage === 'ALIGN' ? (
                  <>
                    <Scan className="w-3.5 h-3.5 text-accent-on-dark animate-pulse" />
                    <span>{state.liveness.prompt || 'Look directly at the camera'}</span>
                  </>
                ) : state.liveness.stage === 'CHALLENGE' ? (
                  <>
                    {state.liveness.targetDirection === 'TURN_LEFT' ? (
                      <ArrowLeft className="w-3.5 h-3.5 text-warning animate-bounce" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-warning animate-bounce" />
                    )}
                    <span className="font-bold tracking-wider text-warning">
                      {state.liveness.prompt || (state.liveness.targetDirection === 'TURN_LEFT' ? 'Turn your head slightly left' : 'Turn your head slightly right')}
                    </span>
                  </>
                ) : state.liveness.stage === 'CENTER_BLINK' ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-accent-on-dark animate-pulse" />
                    <span className="font-bold text-accent-on-dark">{state.liveness.prompt || 'Face the camera'}</span>
                  </>
                ) : state.liveness.passed && state.scanProgress < 100 ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-ink" />
                    <span>Face verified. Recording clock-in...</span>
                  </>
                ) : state.scanProgress >= 100 ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-ink" />
                    <span>Recording attendance...</span>
                  </>
                ) : state.matchScore !== null && state.matchScore < 50 ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                    <span>Face not recognized</span>
                  </>
                ) : (
                  <span>Checking face...</span>
                )}
              </span>

              {/* Right Controls: Offline Terminal + Flip Camera + Live Clock */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {isOfflineFeatureActive && (
                  <a
                    href="/attendance-terminal"
                    className="h-8 w-8 sm:w-auto px-0 sm:px-2.5 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-white/10 transition-colors duration-100 flex items-center justify-center gap-1.5 text-xs font-medium cursor-pointer shadow-2xs shrink-0"
                    title="Switch to Offline Attendance Terminal"
                  >
                    <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-[11px] hidden md:inline">Offline</span>
                  </a>
                )}
                <button
                  onClick={toggleCameraFacing}
                  disabled={state.loadingMsg === 'Starting camera...'}
                  className="h-8 w-8 sm:w-auto px-0 sm:px-2.5 rounded-md bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-white/10 transition-colors duration-100 flex items-center justify-center gap-1.5 text-xs font-medium cursor-pointer shadow-2xs shrink-0"
                  title="Flip Camera (Front / Rear)"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-accent-on-dark shrink-0" />
                  <span className="text-[11px] hidden sm:inline capitalize">
                    {cameraFacing === 'user' ? 'Front' : 'Rear'}
                  </span>
                </button>
                <div className="font-mono text-xs font-semibold bg-slate-900/80 text-slate-300 px-2 py-1 rounded-md border border-white/10 tabular-nums hidden sm:block shrink-0">
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
                  <p className={`text-xs font-medium mt-0.5 ${state.matchScore >= 50 ? 'text-ink' : 'text-danger'}`}>
                    Confidence: {state.matchScore}%
                  </p>
                )}
                {state.employee?.is_medical_exempt && (
                  <div className="flex items-center justify-center gap-1.5 mt-1 text-[11px] font-bold text-warning">
                    <HeartPulse className="w-3.5 h-3.5 text-warning" />
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
                <div className={`w-24 h-24 sm:w-28 sm:h-28 rounded-md overflow-hidden border-2 shrink-0 ${state.feedback.type === 'success' ? 'border-line' : 'border-danger'}`}>
                  <img src={state.feedback.image} alt="" className={`w-full h-full object-contain ${cameraFacing === 'user' ? '-scale-x-100' : ''}`} />
                </div>
              )}
              <div className="text-center sm:text-left flex-1 w-full">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                  <div className={`h-6 w-6 rounded-md flex items-center justify-center text-xs text-white shrink-0 ${state.feedback.type === 'success' ? 'bg-ink-subtle' : 'bg-danger'}`}>
                    {state.feedback.type === 'success' ? <Check className="w-3.5 h-3.5 text-white" /> : <X className="w-3.5 h-3.5 text-white" />}
                  </div>
                  <h2 className={`text-lg sm:text-xl font-bold tracking-tight ${state.feedback.type === 'success' ? 'text-ink' : 'text-danger'}`}>
                    {state.feedback.title}
                  </h2>
                </div>
                <p className="text-xs font-medium text-slate-200">{state.feedback.message}</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-2.5 text-xs text-slate-400">
                  <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded-sm">
                    {new Date().toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  {state.matchScore !== null && (
                    <span className={`font-medium ${state.matchScore >= 50 ? 'text-ink' : 'text-danger'}`}>
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
              <div className="w-10 h-10 rounded-md bg-danger/10 text-danger border border-danger/20 flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-5 h-5 text-danger" />
              </div>
              <h2 className="text-base font-bold text-white mb-1">Scan Interrupted</h2>
              <p className="text-slate-400 text-xs mb-4">{state.error?.message || 'An unexpected error occurred.'}</p>
              <button onClick={state.error?.code === 'FACE_PROCESSING_TIMEOUT' ? () => window.location.reload() : handleReset} className="w-full h-9 bg-slate-800 hover:bg-slate-700 text-white rounded-md font-semibold text-xs transition-colors duration-100 cursor-pointer shadow-2xs">
                {state.error?.code === 'FACE_PROCESSING_TIMEOUT' ? 'Reload Scanner' : 'Return to Scanner'}
              </button>
            </div>
          </div>
        )}
      

      {/* Top HUD (QR Mode Header) */}
      {state.mode === MODES.QR && (
        <div className="absolute top-0 inset-x-0 z-30 bg-slate-950/90 border-b border-slate-800 pb-3 pointer-events-none">
          <div className="flex justify-between items-center px-4 sm:px-6 pt-[max(env(safe-area-inset-top,12px),12px)]">
            <div className="flex items-center gap-2 pt-1 pointer-events-auto">
              <div className="h-7 w-7 rounded-md bg-slate-800 flex items-center justify-center text-slate-200 border border-slate-700">
                {deviceInfo.isMobile ? (
                  <Smartphone className="w-3.5 h-3.5 text-slate-200" />
                ) : (
                  <Monitor className="w-3.5 h-3.5 text-slate-200" />
                )}
              </div>
              <div className="hidden xs:block">
                <h1 className="text-xs font-bold text-white tracking-wide">
                  {deviceInfo.isMobile ? 'Gate Kiosk' : 'Terminal Station'}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto shrink-0">
              {isOfflineFeatureActive && (
                <a
                  href="/attendance-terminal"
                  className="h-7 w-7 sm:w-auto px-0 sm:px-2.5 rounded-md bg-slate-900/90 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700/80 transition-colors duration-100 flex items-center justify-center gap-1.5 text-xs font-medium shadow-2xs shrink-0"
                  title="Switch to Offline Attendance Terminal"
                >
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-[11px] hidden sm:inline">Offline</span>
                </a>
              )}
              <div className="font-mono text-xs font-semibold bg-slate-900 text-slate-300 px-2.5 py-1 rounded-md border border-slate-700 tabular-nums shrink-0">
                {state.clockTime}
              </div>
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
              className="h-9 px-3.5 bg-accent/20 text-accent-on-dark hover:bg-accent/30 rounded-md border border-accent/30 transition-colors duration-100 font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5" /> <span>Mock Badge</span>
            </button>
          )}
          <button
            onClick={() => performLogout('/login')}
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
            <div className="w-8 h-8 border-2 border-slate-700 border-t-accent rounded-full animate-spin mb-3" />
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
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-on-dark shrink-0" />
          <span className="truncate max-w-[240px] sm:max-w-none">{state.loadingMsg}</span>
        </div>
      )}

      {/* Debug panel */}
      {state.debugMode && (
        <div className="absolute top-20 left-4 z-[55] bg-black/80 border border-white/10 rounded-md p-3.5 w-64 text-[10px] font-mono text-slate-300">
          <h3 className="text-xs font-bold text-accent-on-dark mb-2 uppercase">Debug Info</h3>
          <div className="space-y-1">
            <p>Mode: {state.mode}</p>
            <p>EmpID: {state.debugInfo.employeeId?.slice(0, 8) || '—'}...</p>
            <p>Baseline: {state.debugInfo.hasBaseline ? 'Loaded' : 'None'}</p>
            <p>Match: {state.matchScore ?? '—'}%</p>
            <p>PAD Stage: {state.debugInfo.padStage || 'ALIGN'} ({state.debugInfo.targetDirection || '—'})</p>
            <p>Depth Var: {(state.debugInfo.depthVariance || 0).toFixed(5)}</p>
            <p>Blinks: {state.liveness.blinkCount}</p>
            <p>EAR: {state.liveness.ear?.toFixed(3) ?? '—'}</p>
            <p>Lock: {state.debugInfo.lockFrames || 0}/{ENV.REQUIRED_LOCK_FRAMES}</p>
            <p>Online: {state.isOnline ? 'Yes' : 'No'}</p>
            <p>Net: {navigator.connection?.effectiveType || '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

const Scanner = () => {
  const [user] = useState(getStoredUser);
  const isAuthorized = isSecurity(user) || isAdmin(user);

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black p-6">
        <div className="bg-slate-900 p-10 rounded-2xl shadow-2xl max-w-md text-center border border-danger/40">
          <div className="flex justify-center mb-6">
            <Lock className="w-16 h-16 text-danger-ink" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Access restricted</h2>
          <p className="text-danger text-sm mb-8">This terminal is restricted to security staff and administrators.</p>
          <button onClick={() => window.location.href = '/login'} className="py-3 px-6 w-full bg-danger hover:bg-danger text-white font-semibold rounded-md transition-colors text-sm">Sign in to your account</button>
        </div>
      </div>
    );
  }

  return <ScannerTerminal />;
};

export default Scanner;
