import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import * as faceapi from 'face-api.js';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../supabaseClient';

// 
//  CONFIGURATION
// 
const CONFIG = {
    REQUIRED_LOCK_FRAMES: 10,          // Consecutive matching frames needed
    FACE_MATCH_THRESHOLD: 0.42,        // Euclidean distance: lower = stricter (was 0.50, tightened for accuracy)
    DETECTION_INTERVAL_MS: 150,        // Detection loop interval
    DETECTION_INPUT_SIZE: 320,         // TinyFaceDetector input size (used for fast pre-check)
    BASELINE_INPUT_SIZE: 416,          // Baseline computation input size
    MIN_FACE_RATIO: 0.12,             // Minimum face-to-screen width ratio
    CENTER_THRESHOLD_X: 0.30,         // X centering tolerance (% of screen width)
    CENTER_THRESHOLD_Y: 0.35,         // Y centering tolerance (% of screen height)
    FEEDBACK_DISPLAY_MS: 4500,        // How long feedback shows before reset
    BLINK_EAR_THRESHOLD: 0.24,        // Eye Aspect Ratio below this = eyes closed (blink detected)
    BLINK_CONSEC_FRAMES: 2,           // Consecutive frames with closed eyes to count as 1 blink
    REQUIRED_BLINKS: 1,               // Minimum blinks required to pass liveness check
    MODEL_URL: 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/',
    API_BASE: 'http://localhost:5000/api',
};

// 
//  EYE ASPECT RATIO (EAR) — Anti-Spoofing Liveness Detection
//  Uses the 68-point facial landmark model to calculate how "open" each eye is.
//  A printed photo or phone screen cannot blink, so this defeats spoofing attacks.
//  Formula: EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
//  where p1-p6 are the 6 landmark points around each eye.
// 
const getEAR = (landmarks) => {
    const pts = landmarks.positions;
    // Left eye landmarks: indices 36-41
    const leftEye = [pts[36], pts[37], pts[38], pts[39], pts[40], pts[41]];
    // Right eye landmarks: indices 42-47
    const rightEye = [pts[42], pts[43], pts[44], pts[45], pts[46], pts[47]];

    const calcEAR = (eye) => {
        // Vertical distances
        const v1 = Math.hypot(eye[1].x - eye[5].x, eye[1].y - eye[5].y);
        const v2 = Math.hypot(eye[2].x - eye[4].x, eye[2].y - eye[4].y);
        // Horizontal distance
        const h = Math.hypot(eye[0].x - eye[3].x, eye[0].y - eye[3].y);
        return (v1 + v2) / (2.0 * h);
    };

    // Average EAR of both eyes for stability
    return (calcEAR(leftEye) + calcEAR(rightEye)) / 2.0;
};

// 
//  AUDIO FEEDBACK ENGINE
// 
const playSound = (type) => {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t = ctx.currentTime;

        if (type === 'scan') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(1200, t);
            gain.gain.setValueAtTime(0.25, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
            osc.start(t); osc.stop(t + 0.1);
        } else if (type === 'success') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, t); osc.frequency.setValueAtTime(900, t + 0.1);
            gain.gain.setValueAtTime(0.4, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
            osc.start(t); osc.stop(t + 0.3);
        } else {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, t);
            gain.gain.setValueAtTime(0.4, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
            osc.start(t); osc.stop(t + 0.4);
        }
    } catch (_) { /* silent */ }
};

// 
//  FACE MESH RENDERER
// 
const drawFaceMesh = (ctx, landmarks, box, state) => {
    const points = landmarks.positions;
    const palette = {
        scanning: { dot: '#3b82f6', line: 'rgba(59,130,246,0.5)',  corner: 'rgba(59,130,246,0.6)' },
        locked:   { dot: '#22c55e', line: 'rgba(34,197,94,0.6)',   corner: 'rgba(34,197,94,0.7)' },
        mismatch: { dot: '#ef4444', line: 'rgba(239,68,68,0.6)',   corner: 'rgba(239,68,68,0.7)' },
    };
    const c = palette[state] || palette.scanning;
    const r = state === 'locked' ? 2.5 : 1.5;
    const lw = state === 'locked' ? 1.8 : 1;

    // 68-point dots
    ctx.fillStyle = c.dot;
    for (const pt of points) { ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill(); }

    // Structural lines (jaw, brows, nose, eyes, lips)
    const drawPath = (pts, close = false) => {
        if (pts.length < 2) return;
        ctx.strokeStyle = c.line; ctx.lineWidth = lw; ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (close) ctx.closePath();
        ctx.stroke();
    };
    const s = points.slice.bind(points);
    drawPath(s(0, 17)); drawPath(s(17, 22)); drawPath(s(22, 27)); drawPath(s(27, 31)); drawPath(s(31, 36));
    drawPath(s(36, 42), true); drawPath(s(42, 48), true); drawPath(s(48, 60), true); drawPath(s(60, 68), true);

    // Corner bracket frame
    const { x, y, width: w, height: h } = box;
    const cl = Math.min(28, w * 0.15);
    ctx.strokeStyle = c.corner; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y + cl); ctx.lineTo(x, y); ctx.lineTo(x + cl, y);
    ctx.moveTo(x + w - cl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cl);
    ctx.moveTo(x + w, y + h - cl); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - cl, y + h);
    ctx.moveTo(x + cl, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - cl);
    ctx.stroke();
};

// 
//  MAIN COMPONENT
// 
const Scanner = () => {
    const [user] = useState(() => JSON.parse(localStorage.getItem('user')) || { name: 'Gate Guard', role: 'security' });

    //  ACCESS GATE 
    if (user.role !== 'security' && user.role !== 'admin') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black p-6 font-mono">
                <div className="bg-red-950/30 p-10 rounded-3xl shadow-2xl max-w-md text-center border border-red-500/30 backdrop-blur-xl">
                    <i className="ti ti-lock text-6xl text-red-500 mb-6 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
                    <h2 className="text-3xl font-black text-white mb-2 tracking-widest uppercase">Access Denied</h2>
                    <p className="text-red-300 text-sm mb-8">Security clearance insufficient.</p>
                    <button onClick={() => window.location.href = '/'} className="py-4 px-8 w-full bg-red-600 hover:bg-red-500 text-white font-bold tracking-widest uppercase rounded-xl transition-all">Abort</button>
                </div>
            </div>
        );
    }

    //  STATE 
    const [mode, setMode] = useState('qr'); // qr | prep | face | feedback
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('BOOTING NEURAL NET...');
    const [clockTime, setClockTime] = useState('');

    // Face scan state
    const [aiStatus, setAiStatus] = useState('AWAITING ID SCAN...');
    const [lockProgress, setLockProgress] = useState(0);
    const [faceLockedIn, setFaceLockedIn] = useState(false);
    const [matchScore, setMatchScore] = useState(null);

    // Liveness detection state (anti-spoofing)
    const [blinkDetected, setBlinkDetected] = useState(false);
    const [livenessStatus, setLivenessStatus] = useState('WAITING');

    // Employee state
    const [employeeName, setEmployeeName] = useState('');
    const [employeePhoto, setEmployeePhoto] = useState(null);

    // Feedback state
    const [feedback, setFeedback] = useState({ type: '', title: '', message: '', image: null });

    //  REFS 
    const qrRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const detectionRef = useRef(null);
    const lockFramesRef = useRef(0);
    const processingRef = useRef(false);
    const employeeIdRef = useRef(null);
    const baselineRef = useRef(null);  // Float32Array[128] — the registered face descriptor
    const blinkCountRef = useRef(0);   // Counts total blinks detected during scan
    const blinkFramesRef = useRef(0);  // Consecutive frames where eyes are closed

    // 
    //  BOOT: Load AI Models + Clock + Inject CSS
    // 
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                // Loading SsdMobilenetv1 for higher accuracy face detection (heavier but more reliable)
                // plus TinyFaceDetector as a fast fallback for initial detection
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri(CONFIG.MODEL_URL),
                    faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(CONFIG.MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.MODEL_URL),
                ]);
                if (mounted) { setModelsLoaded(true); setLoadingMsg(''); }
            } catch (err) {
                console.error('[BOOT]', err);
                toast.error('Neural Net failed to load');
                if (mounted) setLoadingMsg('');
            }
        })();

        const tick = setInterval(() => {
            setClockTime(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }, 1000);

        // CSS overrides for html5-qrcode's video element
        const style = document.createElement('style');
        style.id = 'scanner-css';
        style.textContent = `
            #qr-reader video { object-fit:cover!important; width:100vw!important; height:100dvh!important; }
            #qr-reader { width:100vw; height:100dvh; overflow:hidden; }
            #qr-reader__dashboard_section_csr, #qr-reader__dashboard_section_swaplink,
            #qr-reader__status_span, #qr-reader__header_message { display:none!important; }
        `;
        document.head.appendChild(style);

        return () => {
            mounted = false;
            clearInterval(tick);
            document.getElementById('scanner-css')?.remove();
        };
    }, []);

    // 
    //  MODE LIFECYCLE: Start/stop cameras on mode change
    // 
    useEffect(() => {
        if (mode === 'qr' && modelsLoaded) startQr();
        if (mode !== 'qr') stopQr();
        if (mode === 'face') startFaceCamera();
        if (mode !== 'face') stopFaceCamera();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, modelsLoaded]);

    // 
    //  QR SCANNER
    // 
    const startQr = useCallback(() => {
        if (qrRef.current) return;
        setAiStatus('AWAITING ID SCAN...');
        qrRef.current = new Html5Qrcode('qr-reader');
        qrRef.current.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 260, height: 260 }, disableFlip: false },
            onQrScan,
        ).catch(() => toast.error('Camera unavailable'));
    }, []);

    const stopQr = useCallback(() => {
        if (!qrRef.current) return;
        try { qrRef.current.stop().then(() => { qrRef.current?.clear(); qrRef.current = null; }).catch(() => {}); }
        catch (_) { qrRef.current?.clear(); qrRef.current = null; }
    }, []);

    // 
    //  QR SCANNED → Fetch baseline → Show prep screen
    // 
    const onQrScan = useCallback(async (text) => {
        if (processingRef.current) return;
        processingRef.current = true;
        playSound('scan');
        setLoadingMsg('LOADING BIOMETRIC PROFILE...');
        setMode('prep');

        const id = text.trim();
        employeeIdRef.current = id;

        try {
            // 1. Fetch employee info using the clean company_id (e.g., CP-2026-001)
            const { data: emp } = await supabase.from('employees').select('id, first_name, last_name').eq('company_id', id).single();
            setEmployeeName(emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown');
            
            // Re-assign the internal UUID to the ref so the attendance API still links correctly to the database row
            if (emp) employeeIdRef.current = emp.id;

            // 2. Download registered baseline face image
            const { data: blob, error: dlErr } = await supabase.storage.from('public-bucket').download(`face-baselines/${id}.jpg`);

            if (dlErr || !blob) {
                baselineRef.current = null;
                setEmployeePhoto(null);
                setAiStatus('NO BASELINE — REGISTER BIOMETRICS FIRST');
                setLoadingMsg('');
                return;
            }

            const url = URL.createObjectURL(blob);
            setEmployeePhoto(url);

            // 3. Compute 128-dim face descriptor from baseline image using SsdMobilenetv1
            //    SSD is used here for maximum accuracy on the saved profile photo.
            setLoadingMsg('COMPUTING FACE DESCRIPTOR...');
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = url;
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

            const det = await faceapi
                .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
                .withFaceLandmarks()
                .withFaceDescriptor();

            baselineRef.current = det ? det.descriptor : null;
            setAiStatus(det ? 'BASELINE LOCKED. READY.' : 'BASELINE UNREADABLE');
        } catch (err) {
            console.error('[BASELINE]', err);
            baselineRef.current = null;
            setAiStatus('BASELINE ERROR');
        }
        setLoadingMsg('');
    }, []);

    // 
    //  FACE CAMERA: Start / Stop
    // 
    const startFaceCamera = useCallback(async () => {
        setLoadingMsg('STARTING CAMERA...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current.play();
                    setLoadingMsg('');
                    runDetectionLoop();
                };
            }
        } catch (_) {
            toast.error('Camera access denied');
            setLoadingMsg('');
            resetAll();
        }
    }, []);

    const stopFaceCamera = useCallback(() => {
        if (detectionRef.current) { clearInterval(detectionRef.current); detectionRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    }, []);

    // 
    //  FACE DETECTION LOOP — Identity Verification
    // 
    const runDetectionLoop = useCallback(() => {
        setAiStatus('SCANNING FACE...');
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        // Set canvas to the video's NATIVE resolution.
        // Both video and canvas use CSS object-fit:cover, so they crop identically.
        // This means raw face-api coordinates map 1:1 onto the canvas — no resizeResults needed.
        const syncCanvas = () => {
            const nw = video.videoWidth, nh = video.videoHeight;
            if (nw && nh && (canvas.width !== nw || canvas.height !== nh)) {
                canvas.width = nw;
                canvas.height = nh;
            }
        };
        syncCanvas();

        detectionRef.current = setInterval(async () => {
            syncCanvas();
            const det = await faceapi
                .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: CONFIG.DETECTION_INPUT_SIZE, scoreThreshold: 0.4 }))
                .withFaceLandmarks()
                .withFaceDescriptor();

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (!det) {
                lockFramesRef.current = Math.max(0, lockFramesRef.current - 2);
                setLockProgress(Math.max(0, (lockFramesRef.current / CONFIG.REQUIRED_LOCK_FRAMES) * 100));
                setMatchScore(null);
                setAiStatus('SEARCHING FOR FACE...');
                return;
            }

            // Use raw detection coords — no resizeResults needed since canvas = video native res
            const box = det.detection.box;
            const liveDsc = det.descriptor;

            //  Centering check 
            const nw = canvas.width, nh = canvas.height;
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const centered = Math.abs(cx - nw / 2) < nw * CONFIG.CENTER_THRESHOLD_X
                          && Math.abs(cy - nh / 2) < nh * CONFIG.CENTER_THRESHOLD_Y;
            const bigEnough = box.width >= nw * CONFIG.MIN_FACE_RATIO;

            //  Identity match (128-dim Euclidean distance) 
            let matched = true, dist = 0;
            if (baselineRef.current && liveDsc) {
                dist = faceapi.euclideanDistance(baselineRef.current, liveDsc);
                matched = dist < CONFIG.FACE_MATCH_THRESHOLD;
                setMatchScore(Math.round((1 - dist) * 100));
            }

            if (!centered || !bigEnough) {
                lockFramesRef.current = Math.max(0, lockFramesRef.current - 1);
                setLockProgress(Math.max(0, (lockFramesRef.current / CONFIG.REQUIRED_LOCK_FRAMES) * 100));
                setAiStatus(!bigEnough ? 'MOVE CLOSER' : 'CENTER YOUR FACE');
                drawFaceMesh(ctx, det.landmarks, box, 'scanning');
                return;
            }

            if (!matched) {
                lockFramesRef.current = 0;
                setLockProgress(0);
                setAiStatus('IDENTITY MISMATCH — ACCESS DENIED');
                drawFaceMesh(ctx, det.landmarks, box, 'mismatch');
                return;
            }

            // ──────────────────────────────────────────────────────
            //  ANTI-SPOOFING: Blink-Based Liveness Detection
            //  A printed photo or phone screen cannot blink.
            //  We use the Eye Aspect Ratio (EAR) algorithm to
            //  detect when the user's eyes close and reopen.
            //  The scan will NOT proceed until at least 1 blink
            //  is detected, proving this is a live human.
            // ──────────────────────────────────────────────────────
            const ear = getEAR(det.landmarks);
            if (ear < CONFIG.BLINK_EAR_THRESHOLD) {
                // Eyes are closed
                blinkFramesRef.current += 1;
            } else {
                // Eyes just reopened after being closed — count as 1 blink
                if (blinkFramesRef.current >= CONFIG.BLINK_CONSEC_FRAMES) {
                    blinkCountRef.current += 1;
                    setBlinkDetected(true);
                    setLivenessStatus('PASSED');
                }
                blinkFramesRef.current = 0;
            }

            const livenessOk = blinkCountRef.current >= CONFIG.REQUIRED_BLINKS;

            if (!livenessOk) {
                // Face matches but liveness not yet confirmed — prompt user to blink
                setLivenessStatus('BLINK TO VERIFY');
                setAiStatus('BLINK YOUR EYES');
                drawFaceMesh(ctx, det.landmarks, box, 'scanning');
                return;
            }

            //  Lock-in progression (only starts after liveness is confirmed) 
            lockFramesRef.current += 1;
            const progress = Math.min((lockFramesRef.current / CONFIG.REQUIRED_LOCK_FRAMES) * 100, 100);
            setLockProgress(progress);

            if (lockFramesRef.current >= CONFIG.REQUIRED_LOCK_FRAMES) {
                clearInterval(detectionRef.current);
                detectionRef.current = null;
                setFaceLockedIn(true);
                setAiStatus('IDENTITY CONFIRMED');
                drawFaceMesh(ctx, det.landmarks, box, 'locked');
                captureAndSubmit();
            } else {
                setAiStatus(baselineRef.current
                    ? `VERIFYING [${lockFramesRef.current}/${CONFIG.REQUIRED_LOCK_FRAMES}]`
                    : `LOCKING [${lockFramesRef.current}/${CONFIG.REQUIRED_LOCK_FRAMES}]`);
                drawFaceMesh(ctx, det.landmarks, box, 'scanning');
            }
        }, CONFIG.DETECTION_INTERVAL_MS);
    }, []);

    // 
    //  CAPTURE & SUBMIT — Send face + id to backend
    // 
    const captureAndSubmit = useCallback(async () => {
        let img64 = null;
        if (videoRef.current) {
            const c = document.createElement('canvas');
            c.width = videoRef.current.videoWidth;
            c.height = videoRef.current.videoHeight;
            c.getContext('2d').drawImage(videoRef.current, 0, 0);
            img64 = c.toDataURL('image/jpeg', 0.8);
        }

        const eid = employeeIdRef.current || '';
        try {
            const res = await fetch(`${CONFIG.API_BASE}/attendance/scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employee_id: eid,
                    image_data: img64,
                    face_match_score: matchScore,
                }),
            });
            const data = await res.json();
            setMode('feedback');

            if (data.status === 'success') {
                const action = data.message?.includes('OUT') ? 'OUT' : 'IN';
                setFeedback({ type: 'success', title: `CLOCKED ${action}`, message: data.message, image: img64 });
                playSound('success');
            } else {
                setFeedback({ type: 'error', title: 'DENIED', message: data.message || 'Verification Failed', image: img64 });
                playSound('error');
            }
        } catch (_) {
            setMode('feedback');
            setFeedback({ type: 'error', title: 'OFFLINE', message: 'Server unreachable.', image: img64 });
            playSound('error');
        }

        setTimeout(resetAll, CONFIG.FEEDBACK_DISPLAY_MS);
    }, [matchScore]);

    // 
    //  RESET
    // 
    const resetAll = useCallback(() => {
        processingRef.current = false;
        lockFramesRef.current = 0;
        baselineRef.current = null;
        employeeIdRef.current = null;
        blinkCountRef.current = 0;
        blinkFramesRef.current = 0;
        setFaceLockedIn(false);
        setLockProgress(0);
        setMatchScore(null);
        setBlinkDetected(false);
        setLivenessStatus('WAITING');
        setEmployeeName('');
        setEmployeePhoto(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
        setAiStatus('AWAITING ID SCAN...');
        setFeedback({ type: '', title: '', message: '', image: null });
        if (canvasRef.current) canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setMode('qr');
    }, []);

    // 
    //  STATUS PILL COLOR LOGIC
    // 
    const statusColor = aiStatus.includes('MISMATCH') || aiStatus.includes('DENIED')
        ? 'red' : (faceLockedIn || aiStatus.includes('CONFIRMED')) ? 'green' : 'blue';
    const pillClasses = {
        red:   'bg-red-500/25 text-red-200 border-red-500/40 shadow-red-500/30',
        green: 'bg-emerald-500/25 text-emerald-200 border-emerald-500/40 shadow-emerald-500/30',
        blue:  'bg-blue-500/25 text-blue-200 border-blue-500/40 shadow-blue-500/30',
    }[statusColor];
    const ringColor = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6' }[statusColor];

    // 
    //  RENDER
    // 
    return (
        <div className="h-[100dvh] w-screen bg-black text-white relative overflow-hidden font-sans select-none">

            {/* QR mode */}
            <div className={`absolute inset-0 transition-opacity duration-500 ${mode === 'qr' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
                <div id="qr-reader" className="w-full h-full" />
                
                {/* Reticle and "Hole" Overlay */}
                <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center overflow-hidden px-4">
                    <h2 className="absolute top-24 text-xl sm:text-2xl font-bold tracking-widest text-white drop-shadow-md uppercase">Scan QR Code</h2>
                    
                    <div className="relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 shadow-[0_0_0_4000px_rgba(0,0,0,0.65)] rounded-3xl border border-white/20 overflow-hidden flex-shrink-0">
                        {/* Corners */}
                        <div className="absolute top-0 left-0 w-10 h-10 border-t-[4px] border-l-[4px] border-blue-400 rounded-tl-3xl" />
                        <div className="absolute top-0 right-0 w-10 h-10 border-t-[4px] border-r-[4px] border-blue-400 rounded-tr-3xl" />
                        <div className="absolute bottom-0 left-0 w-10 h-10 border-b-[4px] border-l-[4px] border-blue-400 rounded-bl-3xl" />
                        <div className="absolute bottom-0 right-0 w-10 h-10 border-b-[4px] border-r-[4px] border-blue-400 rounded-br-3xl" />
                        {/* Laser */}
                        <motion.div
                            animate={{ top: ['0%', '100%', '0%'] }}
                            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                            className="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_15px_#3b82f6]"
                        />
                    </div>
                    
                    <p className="absolute bottom-32 text-white/70 font-mono text-sm tracking-[0.25em] uppercase">Align ID Within Frame</p>
                </div>
            </div>

            {/* Prep mode */}
            <AnimatePresence>
                {mode === 'prep' && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-40 bg-black/70 backdrop-blur-2xl flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                            className="bg-slate-900/90 border border-white/10 rounded-[2rem] shadow-2xl shadow-blue-500/5 flex flex-col items-center w-full max-w-sm p-8 sm:p-10"
                        >
                            {/* Profile photo */}
                            {employeePhoto ? (
                                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden border-4 border-blue-500/40 shadow-[0_0_30px_rgba(59,130,246,0.25)] mb-5">
                                    <img src={employeePhoto} alt="Baseline" className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-slate-800/80 border-4 border-white/10 flex items-center justify-center mb-5">
                                    <i className="ti ti-user-scan text-4xl sm:text-5xl text-slate-500" />
                                </div>
                            )}
                            <h2 className="text-xl sm:text-2xl font-black text-white text-center tracking-tight mb-1">{employeeName || 'Employee'}</h2>
                            <p className="text-slate-400 text-center text-xs sm:text-sm mb-7 leading-relaxed">
                                Remove masks & sunglasses.<br />Look directly into the camera.
                            </p>
                            <button
                                onClick={() => setMode('face')}
                                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold tracking-[0.15em] uppercase transition-all shadow-[0_0_20px_rgba(59,130,246,0.35)] active:scale-[0.97] flex items-center justify-center gap-2.5 text-sm"
                            >
                                <i className="ti ti-face-id text-lg" /> Ready for Scan
                            </button>
                            <button
                                onClick={resetAll}
                                className="mt-3 w-full py-3 text-slate-500 hover:text-white rounded-2xl font-bold tracking-[0.15em] uppercase transition-colors text-xs"
                            >
                                Cancel
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Face scan mode */}
            <AnimatePresence>
                {mode === 'face' && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-20 bg-black overflow-hidden"
                    >
                        {/* Live camera — full bleed, mirrored */}
                        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover -scale-x-100" playsInline muted autoPlay />

                        {/* AI canvas overlay (also mirrored to align with video) */}
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover -scale-x-100 pointer-events-none" />

                        {/* Cinematic vignette */}
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_40%,_rgba(0,0,0,0.75)_100%)] pointer-events-none" />

                        {/* Status pill */}
                        <div className="absolute top-[max(env(safe-area-inset-top,12px),12px)] inset-x-0 flex justify-center z-30 pt-3">
                            <span className={`px-4 py-1.5 rounded-full text-[10px] sm:text-xs font-black tracking-[0.25em] uppercase backdrop-blur-xl border shadow-lg ${pillClasses}`}>
                                {aiStatus}
                            </span>
                        </div>

                        {/* Bottom HUD: progress ring + identity */}
                        <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),16px)] flex flex-col items-center">
                            {/* Progress ring */}
                            <div className="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center mb-4">
                                <svg className="absolute inset-0 w-full h-full -rotate-90 drop-shadow-lg" viewBox="0 0 100 100">
                                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                                    <circle cx="50" cy="50" r="44" fill="none"
                                        stroke={ringColor} strokeWidth="5" strokeLinecap="round"
                                        strokeDasharray={`${2 * Math.PI * 44}`}
                                        strokeDashoffset={`${2 * Math.PI * 44 * (1 - lockProgress / 100)}`}
                                        className="transition-all duration-200 ease-out"
                                    />
                                </svg>
                                <span className="font-black text-lg sm:text-xl tracking-widest drop-shadow-md">{Math.round(lockProgress)}%</span>
                            </div>

                            {/* Identity card */}
                            <div className="bg-black/50 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 shadow-xl text-center min-w-[200px]">
                                <h3 className="text-lg sm:text-xl font-black tracking-tight">{employeeName}</h3>
                                {matchScore !== null && (
                                    <p className={`text-[10px] sm:text-xs font-bold tracking-[0.2em] mt-1 ${matchScore >= 58 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        MATCH: {matchScore}%
                                    </p>
                                )}
                                {/* Liveness indicator */}
                                <div className={`flex items-center justify-center gap-1.5 mt-1.5 text-[9px] sm:text-[10px] font-black tracking-[0.2em] uppercase ${blinkDetected ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                                    <i className={`ti ${blinkDetected ? 'ti-eye-check' : 'ti-eye'} text-xs`} />
                                    {blinkDetected ? 'LIVENESS PASSED' : 'BLINK TO VERIFY'}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Top HUD */}
            {mode !== 'feedback' && (
                <div className="absolute top-0 inset-x-0 z-30 bg-gradient-to-b from-black/70 to-transparent pb-8 pointer-events-none">
                    <div className="flex justify-between items-start px-4 sm:px-6 pt-[max(env(safe-area-inset-top,12px),12px)]">
                        <div className="flex items-center gap-3 pt-2">
                            <div className="h-9 w-9 sm:h-11 sm:w-11 rounded-xl bg-white/5 backdrop-blur-md flex items-center justify-center text-blue-400 border border-white/10">
                                <i className="ti ti-shield-check text-lg sm:text-xl" />
                            </div>
                            <div>
                                <h1 className="text-xs sm:text-sm font-black tracking-[0.2em] uppercase">Gateway</h1>
                                <p className="text-[8px] sm:text-[10px] text-blue-300/60 font-mono tracking-widest flex items-center gap-1.5 mt-0.5">
                                    <span className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${modelsLoaded ? 'bg-blue-400 shadow-[0_0_4px_#3b82f6]' : 'bg-amber-400 animate-pulse'}`} />
                                    {modelsLoaded ? 'Online' : 'Booting...'}
                                </p>
                            </div>
                        </div>
                        <div className="font-mono text-xs sm:text-sm font-bold bg-black/40 px-3 py-1.5 rounded-lg border border-white/10 mt-2 tabular-nums pointer-events-auto">
                            {clockTime}
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom HUD */}
            {mode === 'qr' && (
                <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),16px)] flex justify-center gap-3 px-4">
                    <button onClick={async () => {
                        // Mock scan now grabs the clean company_id instead of the UUID
                        const { data } = await supabase.from('employees').select('company_id').not('company_id', 'is', null).limit(1);
                        if (data?.[0]) onQrScan(data[0].company_id);
                        else toast.error('No employees with a company_id found');
                    }}
                        className="h-11 px-5 bg-blue-600/10 hover:bg-blue-600/25 text-blue-400 rounded-2xl border border-blue-500/20 transition-all font-bold text-[10px] uppercase tracking-[0.2em] flex items-center gap-2">
                        <i className="ti ti-wand" /> <span className="hidden sm:inline">Mock Scan</span>
                    </button>
                    <button onClick={() => { localStorage.removeItem('user'); window.location.href = '/login'; }}
                        className="h-11 px-5 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-2xl border border-white/10 transition-all font-bold text-[10px] uppercase tracking-[0.2em] flex items-center gap-2">
                        <i className="ti ti-power" /> <span className="hidden sm:inline">Sign Out</span>
                    </button>
                </div>
            )}

            {/* Feedback overlay */}
            <AnimatePresence>
                {mode === 'feedback' && feedback.title && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className={`absolute inset-0 z-50 flex items-center justify-center backdrop-blur-2xl p-4 ${feedback.type === 'success' ? 'bg-emerald-950/90' : 'bg-red-950/90'}`}
                    >
                        <motion.div
                            initial={{ scale: 0.85, y: 16 }} animate={{ scale: 1, y: 0 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                            className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8 p-6 sm:p-10 w-full max-w-2xl rounded-[2rem] bg-black/40 border border-white/10 shadow-2xl"
                        >
                            {feedback.image && (
                                <div className={`w-28 h-28 sm:w-40 sm:h-40 rounded-full sm:rounded-2xl overflow-hidden border-4 shrink-0 ${
                                    feedback.type === 'success' ? 'border-emerald-500 shadow-emerald-500/30' : 'border-red-500 shadow-red-500/30'
                                } shadow-[0_0_30px]`}>
                                    <img src={feedback.image} alt="" className="w-full h-full object-cover -scale-x-100" />
                                </div>
                            )}
                            <div className="text-center sm:text-left flex-1 w-full">
                                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 mb-4">
                                    <div className={`h-12 w-12 rounded-full flex items-center justify-center text-2xl shadow-xl shrink-0 ${
                                        feedback.type === 'success' ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-red-500 shadow-red-500/50'
                                    }`}>
                                        <i className={`ti ${feedback.type === 'success' ? 'ti-check' : 'ti-x'}`} />
                                    </div>
                                    <h2 className={`text-2xl sm:text-4xl font-black tracking-tighter uppercase ${
                                        feedback.type === 'success' ? 'text-emerald-400' : 'text-red-400'
                                    }`}>{feedback.title}</h2>
                                </div>
                                <div className={`p-4 rounded-xl border bg-black/50 ${feedback.type === 'success' ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
                                    <p className="text-base sm:text-xl font-bold tracking-wide">{feedback.message}</p>
                                    <div className="flex flex-wrap items-center gap-3 mt-3">
                                        <span className="text-xs font-mono text-slate-400 bg-white/5 px-2.5 py-1 rounded-lg">
                                            {new Date().toLocaleTimeString('en-US', { hour12: false })}
                                        </span>
                                        {matchScore !== null && (
                                            <span className={`text-xs font-bold tracking-widest ${matchScore >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                MATCH: {matchScore}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Loading overlay */}
            <AnimatePresence>
                {loadingMsg && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 backdrop-blur-3xl"
                    >
                        <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center mb-6">
                            <div className="absolute inset-0 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin" style={{ animationDuration: '1.4s' }} />
                            <div className="absolute inset-2 border-l-2 border-r-2 border-white/20 rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                            <i className="ti ti-brain text-3xl sm:text-4xl text-blue-400 drop-shadow-[0_0_12px_rgba(59,130,246,0.5)] animate-pulse" />
                        </div>
                        <h2 className="text-base sm:text-xl font-black tracking-[0.25em] uppercase mb-1 px-4 text-center">{loadingMsg}</h2>
                        <p className="text-[10px] sm:text-xs text-blue-400/50 font-mono tracking-widest uppercase animate-pulse">Please stand by...</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Scanner;
