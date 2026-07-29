import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

// Phase configuration
const PHASES = [
    { id: 0, label: 'CENTER',  instruction: 'Hold still — looking straight',  color: '#3b82f6' },
    { id: 1, label: 'LEFT',  instruction: 'Turn your head LEFT',             color: '#8b5cf6' },
    { id: 2, label: 'RIGHT', instruction: 'Turn your head RIGHT',            color: '#06b6d4' },
    { id: 3, label: 'UP',    instruction: 'Tilt your head UP',               color: '#f59e0b' },
    { id: 4, label: 'DOWN',  instruction: 'Tilt your chin DOWN',             color: '#ef4444' },
];

const HOLD_FRAMES = 8;

export default function BiometricSetup() {
    const [user, setUser] = useState(null);
    const [cameraReady, setCameraReady] = useState(false);
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [faceLockedIn, setFaceLockedIn] = useState(false);
    const [overallProgress, setOverallProgress] = useState(0);
    const [currentPhase, setCurrentPhase] = useState(-1); // -1 = calibrating
    const [phaseProgress, setPhaseProgress] = useState(0);
    const [statusText, setStatusText] = useState('Initializing Neural Net...');
    const [qualityWarning, setQualityWarning] = useState('');
    const [confidence, setConfidence] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState('');
    const [headDot, setHeadDot] = useState({ x: 50, y: 50 });
    const [positionMatch, setPositionMatch] = useState(false);

    const navigate = useNavigate();
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const loopRef = useRef(null);
    const holdCount = useRef(0);
    const phaseRef = useRef(0);
    const mountedRef = useRef(true);
    const capturedAngles = useRef([]);

    // Calibration state
    const calibrationSamples = useRef([]);
    const baseline = useRef(null);
    const CALIBRATION_FRAMES = 10;

    
    //  LIFECYCLE
    
    useEffect(() => {
        mountedRef.current = true;
        const stored = localStorage.getItem('user');
        if (stored) {
            setUser(JSON.parse(stored));
            boot();
        } else {
            navigate('/login');
        }
        return () => {
            mountedRef.current = false;
            if (loopRef.current) clearInterval(loopRef.current);
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        };
    }, [navigate]);

    const boot = async () => {
        try {
            setStatusText('Downloading AI Models...');
            const W = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(W),
                faceapi.nets.faceLandmark68Net.loadFromUri(W),
                faceapi.nets.faceRecognitionNet.loadFromUri(W),
            ]);
            if (!mountedRef.current) return;
            setModelsLoaded(true);
            setStatusText('Starting camera...');

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }
            });
            if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
            setCameraReady(true);
        } catch (err) {
            console.error(err);
            toast.error('Camera access required.');
            setStatusText('CAMERA DENIED');
        }
    };

    
    //  HEAD POSE ESTIMATION (landmark-based)
    
    const getPose = (landmarks) => {
        const p = landmarks.positions;
        const noseTip  = p[30];
        const leftJaw  = p[0];
        const rightJaw = p[16];
        const chin     = p[8];

        const leftEye  = { x: (p[36].x + p[39].x) / 2, y: (p[36].y + p[39].y) / 2 };
        const rightEye = { x: (p[42].x + p[45].x) / 2, y: (p[42].y + p[45].y) / 2 };
        const eyeMid   = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };

        const faceW = rightJaw.x - leftJaw.x;
        const yaw   = faceW > 0 ? (noseTip.x - leftJaw.x) / faceW : 0.5;

        const faceH = chin.y - eyeMid.y;
        const pitch = faceH > 0 ? (noseTip.y - eyeMid.y) / faceH : 0.5;

        return { yaw, pitch };
    };

    
    //  PHASE CHECK  (relative to calibrated baseline)
    
    const isPhaseMatch = (pose, phase) => {
        if (!baseline.current) return false;
        const dy = pose.yaw   - baseline.current.yaw;   // + = nose moved toward right jaw in image
        const dp = pose.pitch - baseline.current.pitch;  // + = nose moved down

        switch (phase) {
            case 0: return Math.abs(dy) < 0.07 && Math.abs(dp) < 0.07;   // CENTER
            case 1: return dy >  0.07;                                     // LEFT  (nose toward right jaw = user's left in mirrored view)
            case 2: return dy < -0.07;                                     // RIGHT
            case 3: return dp < -0.06;                                     // UP
            case 4: return dp >  0.06;                                     // DOWN
            default: return false;
        }
    };

    
    //  MESH DRAWING
    
    const drawMesh = (ctx, landmarks, box, match, phaseIdx) => {
        const pts = landmarks.positions;
        const col = match ? '#22c55e' : (PHASES[phaseIdx]?.color || '#3b82f6');
        const dim = match ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.08)';

        // Dots
        ctx.fillStyle = col;
        pts.forEach(pt => { ctx.beginPath(); ctx.arc(pt.x, pt.y, match ? 2 : 1.4, 0, Math.PI * 2); ctx.fill(); });

        // Group lines
        const lines = (arr, close) => {
            ctx.strokeStyle = col; ctx.lineWidth = match ? 1.5 : 0.9; ctx.beginPath();
            arr.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            if (close) ctx.closePath(); ctx.stroke();
        };
        lines(pts.slice(0, 17), false);
        lines(pts.slice(17, 22), false);
        lines(pts.slice(22, 27), false);
        lines(pts.slice(27, 31), false);
        lines(pts.slice(31, 36), false);
        lines(pts.slice(36, 42), true);
        lines(pts.slice(42, 48), true);
        lines(pts.slice(48, 60), true);
        lines(pts.slice(60, 68), true);

        // Triangulation
        ctx.strokeStyle = dim; ctx.lineWidth = 0.4;
        [[pts[27], pts[17]], [pts[27], pts[26]], [pts[30], pts[0]], [pts[30], pts[16]], [pts[30], pts[8]],
         [pts[36], pts[1]], [pts[45], pts[15]], [pts[48], pts[5]], [pts[54], pts[11]]
        ].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });

        // Corners
        const cl = 16; ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash([]);
        const { x, y, width: w, height: h } = box;
        [[x,y,cl,0,0,cl],[x+w,y,-cl,0,0,cl],[x,y+h,cl,0,0,-cl],[x+w,y+h,-cl,0,0,-cl]].forEach(([cx,cy,a,b,c,d]) => {
            ctx.beginPath(); ctx.moveTo(cx+a,cy+b); ctx.lineTo(cx,cy); ctx.lineTo(cx+c,cy+d); ctx.stroke();
        });
    };

    
    //  CAPTURE
    
    const snap = () => {
        if (!videoRef.current) return null;
        const c = document.createElement('canvas');
        c.width = videoRef.current.videoWidth; c.height = videoRef.current.videoHeight;
        c.getContext('2d').drawImage(videoRef.current, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.85);
    };

    
    //  MAIN DETECTION LOOP
    
    const startLoop = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || !modelsLoaded) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const sz = { width: video.clientWidth, height: video.clientHeight };
        canvas.width = sz.width; canvas.height = sz.height;
        faceapi.matchDimensions(canvas, sz);

        // Reset everything
        baseline.current = null;
        calibrationSamples.current = [];
        phaseRef.current = 0;
        holdCount.current = 0;
        capturedAngles.current = [];
        setCurrentPhase(-1);
        setOverallProgress(0);
        setPhaseProgress(0);
        setStatusText('Calibrating — look straight at the camera...');

        if (loopRef.current) clearInterval(loopRef.current);

        loopRef.current = setInterval(async () => {
            if (!mountedRef.current) { clearInterval(loopRef.current); return; }

            const det = await faceapi
                .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
                .withFaceLandmarks();

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (!det) {
                holdCount.current = Math.max(0, holdCount.current - 1);
                setConfidence(0);
                setQualityWarning('');
                setHeadDot({ x: 50, y: 50 });
                setPositionMatch(false);
                if (baseline.current) setStatusText('Face lost — look at the camera');
                return;
            }

            const res = faceapi.resizeResults(det, sz);
            const box = res.detection.box;
            const lm  = res.landmarks;
            const sc  = res.detection.score;
            setConfidence(Math.round(sc * 100));

            // Quality gate
            if (box.width < 60) {
                setQualityWarning('Move closer');
                drawMesh(ctx, lm, box, false, Math.max(0, phaseRef.current));
                return;
            }
            setQualityWarning('');

            const pose = getPose(lm);

            // Live head-direction dot (map yaw 0→1 to x 0→100, mirrored for display)
            setHeadDot({ x: (1 - pose.yaw) * 100, y: pose.pitch * 100 });

              // CALIBRATION PHASE  =======
            if (!baseline.current) {
                calibrationSamples.current.push(pose);
                drawMesh(ctx, lm, box, false, 0);
                setStatusText(`Calibrating — hold still... (${calibrationSamples.current.length}/${CALIBRATION_FRAMES})`);

                if (calibrationSamples.current.length >= CALIBRATION_FRAMES) {
                    const avgY = calibrationSamples.current.reduce((s, p) => s + p.yaw, 0) / CALIBRATION_FRAMES;
                    const avgP = calibrationSamples.current.reduce((s, p) => s + p.pitch, 0) / CALIBRATION_FRAMES;
                    baseline.current = { yaw: avgY, pitch: avgP };
                    setCurrentPhase(0);
                    setStatusText(PHASES[0].instruction);
                }
                return;
            }

              // PHASE DETECTION  =======
            const phase = phaseRef.current;
            const match = isPhaseMatch(pose, phase);
            setPositionMatch(match);
            drawMesh(ctx, lm, box, match, phase);

            if (match) {
                holdCount.current += 1;

                const pp = Math.min((holdCount.current / HOLD_FRAMES) * 100, 100);
                setPhaseProgress(pp);

                const ob = (phase / PHASES.length) * 100;
                const op = (holdCount.current / HOLD_FRAMES) * (100 / PHASES.length);
                setOverallProgress(Math.min(ob + op, 100));
                setStatusText(`${PHASES[phase].instruction} — hold...`);

                if (holdCount.current >= HOLD_FRAMES) {
                    // Phase complete!
                    const img = snap();
                    if (img) capturedAngles.current.push({ phase: PHASES[phase].label, image: img });

                    holdCount.current = 0;
                    phaseRef.current += 1;

                    if (phaseRef.current >= PHASES.length) {
                        clearInterval(loopRef.current);
                        setFaceLockedIn(true);
                        setCurrentPhase(PHASES.length);
                        setOverallProgress(100);
                        setPhaseProgress(100);
                        setStatusText('PROCESSING 3D BIOMETRIC MESH...');
                        submitBaseline();
                    } else {
                        setCurrentPhase(phaseRef.current);
                        setPhaseProgress(0);
                        setStatusText(PHASES[phaseRef.current].instruction);
                    }
                }
            } else {
                holdCount.current = Math.max(0, holdCount.current - 1);
                setPhaseProgress(Math.max(0, (holdCount.current / HOLD_FRAMES) * 100));
                setStatusText(PHASES[phase].instruction);
            }
        }, 130);
    }, [modelsLoaded]);

    
    //  SUBMIT
    
    const submitBaseline = async () => {
        setIsUploading(true);
        setUploadStatus('Encrypting biometric data...');

        const primary = capturedAngles.current.find(a => a.phase === 'CENTER')?.image
            || capturedAngles.current[0]?.image;

        if (!primary) { toast.error('No capture. Retrying.'); resetScan(); return; }

        try {
            setUploadStatus('Retrieving Secure Identity ID...');
            
            // Fetch company_id directly from the database since it might not be in localStorage
            const { data: dbUser } = await supabase.from('employees').select('company_id').eq('id', user.id).single();
            const actualCompanyId = dbUser?.company_id || user.id;

            setUploadStatus('Running AI Liveness Analysis...');
            const res = await fetch('http://localhost:5000/api/attendance/register-baseline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_id: user.id, company_id: actualCompanyId, image_base64: primary, angles: capturedAngles.current.map(a => a.phase) })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Registration rejected');

            setUploadStatus('Biometric Identity Secured ');

            const cur = JSON.parse(localStorage.getItem('user'));
            if (cur) { cur.has_registered_biometrics = true; localStorage.setItem('user', JSON.stringify(cur)); }

            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            toast.success('Biometric Registration Complete!');
            setTimeout(() => {
                if (!mountedRef.current) return;
                if (user.role === 'admin') navigate('/');
                else if (user.role === 'security') navigate('/scanner');
                else navigate('/employee/dashboard');
            }, 1500);
        } catch (err) {
            console.error(err);
            toast.error(err.message || 'Registration failed.');
            resetScan();
        }
    };

    const resetScan = () => {
        setIsUploading(false); setUploadStatus(''); setFaceLockedIn(false);
        holdCount.current = 0; phaseRef.current = 0; capturedAngles.current = [];
        baseline.current = null; calibrationSamples.current = [];
        setCurrentPhase(-1); setOverallProgress(0); setPhaseProgress(0);
        setStatusText('Calibrating — look straight at the camera...');
        if (loopRef.current) clearInterval(loopRef.current);
        setTimeout(() => { if (mountedRef.current) startLoop(); }, 1500);
    };

    const handleLogout = async () => {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (loopRef.current) clearInterval(loopRef.current);
        await supabase.auth.signOut();
        localStorage.removeItem('user');
        navigate('/login');
    };

    if (!user) return null;

    const done = Math.max(0, currentPhase);
    const activeColor = PHASES[Math.min(Math.max(0, currentPhase), PHASES.length - 1)]?.color || '#3b82f6';
    const isCalibrating = currentPhase === -1;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
            className="bg-[#0a0a0f] min-h-screen flex items-center justify-center p-4 relative overflow-hidden font-sans selection:bg-blue-500 selection:text-white"
        >
            {/* BG Glow */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute top-1/3 left-1/4 w-[50rem] h-[50rem] rounded-full blur-[120px] transition-colors duration-1000" style={{ backgroundColor: `${activeColor}06` }} />
            </div>

            <div className="w-full max-w-lg relative z-10">

                {/* Header */}
                <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-4">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em] mb-3">
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                        Biometric Enrollment
                    </div>
                    <h2 className="text-3xl font-black text-white tracking-tight">Face ID Registration</h2>
                    <p className="text-slate-500 mt-1.5 text-sm">
                        Hello <span className="font-bold text-slate-300">{user.name}</span> — complete the 5-point scan.
                    </p>
                </motion.div>

                {/* Phase Steps */}
                <div className="flex items-center justify-center gap-1 mb-4">
                    {PHASES.map((ph, i) => (
                        <div key={ph.id} className="flex items-center gap-1">
                            <div className="relative">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-500
                                    ${i < done ? 'text-white scale-100' : i === done && !faceLockedIn && !isCalibrating ? 'text-white scale-105' : 'bg-slate-800/80 text-slate-600 border border-slate-700/50'}
                                `} style={
                                    i < done ? { backgroundColor: '#22c55e', boxShadow: '0 4px 12px rgba(34,197,94,0.25)' }
                                    : i === done && !faceLockedIn && !isCalibrating ? { backgroundColor: ph.color, boxShadow: `0 4px 12px ${ph.color}40` }
                                    : {}
                                }>
                                    {i < done ? <i className="ti ti-check text-sm" /> : <i className={`ti ${ph.icon} text-sm`} />}
                                </div>
                                {/* Per-phase ring */}
                                {i === done && !faceLockedIn && !isCalibrating && (
                                    <svg className="absolute -inset-0.5 w-[calc(100%+4px)] h-[calc(100%+4px)]" viewBox="0 0 40 40">
                                        <rect x="1" y="1" width="38" height="38" rx="11" ry="11" fill="none" stroke={`${ph.color}30`} strokeWidth="2" />
                                        <rect x="1" y="1" width="38" height="38" rx="11" ry="11" fill="none" stroke={ph.color} strokeWidth="2"
                                              strokeDasharray="152" strokeDashoffset={152 - (phaseProgress / 100) * 152}
                                              className="transition-all duration-100 ease-out" />
                                    </svg>
                                )}
                            </div>
                            {i < PHASES.length - 1 && <div className={`w-2.5 h-0.5 rounded-full transition-all duration-500 ${i < done ? 'bg-emerald-500' : 'bg-slate-800'}`} />}
                        </div>
                    ))}
                </div>

                {/* Camera */}
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
                    className="relative w-full aspect-square bg-black rounded-[2rem] overflow-hidden shadow-2xl shadow-black/50 mb-4"
                    style={{ borderWidth: 2, borderStyle: 'solid', borderColor: faceLockedIn ? '#22c55e55' : `${activeColor}30`, transition: 'border-color 0.5s' }}
                >
                    {/* Boot screen */}
                    {!cameraReady && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-[#0a0a0f]">
                            <div className="relative w-16 h-16 mb-4">
                                <div className="absolute inset-0 border-2 border-blue-500/30 rounded-full animate-ping" />
                                <div className="absolute inset-0 border-2 border-blue-500 rounded-full animate-spin border-t-transparent" />
                                <div className="absolute inset-2 border-2 border-indigo-500 rounded-full animate-spin border-b-transparent" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                            </div>
                            <p className="font-bold text-sm text-slate-300">{statusText}</p>
                            <p className="text-[10px] text-slate-600 mt-1 font-mono">Loading 3 AI Models...</p>
                        </div>
                    )}

                    <video ref={videoRef} autoPlay playsInline muted onPlay={startLoop}
                           className="absolute inset-0 w-full h-full object-cover scale-x-[-1]" />
                    <canvas ref={canvasRef}
                            className="absolute inset-0 z-10 w-full h-full pointer-events-none scale-x-[-1]" />

                    {/* Calibrating banner */}
                    {isCalibrating && cameraReady && (
                        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
                            <div className="bg-black/60 backdrop-blur-xl rounded-2xl px-6 py-4 text-center border border-blue-500/20">
                                <div className="flex items-center justify-center gap-3 mb-2">
                                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                    <p className="text-blue-400 text-sm font-bold uppercase tracking-widest">Calibrating</p>
                                </div>
                                <p className="text-slate-400 text-xs">Look straight at the camera and hold still</p>
                            </div>
                        </div>
                    )}

                    {/* Active scanning overlay */}
                    {!faceLockedIn && !isCalibrating && cameraReady && (
                        <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">

                            {/* Direction arrow for phases 1-4 */}
                            {currentPhase >= 1 && currentPhase < PHASES.length && (
                                <motion.div key={currentPhase} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
                                    className="absolute" style={{
                                        top: currentPhase === 3 ? '10%' : currentPhase === 4 ? '85%' : '50%',
                                        left: currentPhase === 1 ? '6%' : currentPhase === 2 ? '88%' : '50%',
                                        transform: 'translate(-50%, -50%)',
                                    }}>
                                    <div className="w-12 h-12 rounded-xl flex items-center justify-center animate-pulse"
                                         style={{ backgroundColor: `${PHASES[currentPhase].color}20`, border: `2px solid ${PHASES[currentPhase].color}50` }}>
                                        <i className={`ti ${PHASES[currentPhase].icon} text-xl`} style={{ color: PHASES[currentPhase].color }} />
                                    </div>
                                </motion.div>
                            )}

                            {/* Progress ring */}
                            <div className="w-48 h-48 sm:w-56 sm:h-56 relative">
                                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                                    <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
                                    <circle cx="100" cy="100" r="96" fill="none"
                                            stroke={overallProgress >= 100 ? '#22c55e' : activeColor}
                                            strokeWidth="2.5" strokeLinecap="round"
                                            strokeDasharray={`${2 * Math.PI * 96}`}
                                            strokeDashoffset={`${2 * Math.PI * 96 * (1 - overallProgress / 100)}`}
                                            transform="rotate(-90 100 100)"
                                            className="transition-all duration-200 ease-out" />
                                </svg>
                            </div>

                            {/* Status pill */}
                            <div className="absolute bottom-3 inset-x-3 flex justify-center">
                                <div className="bg-black/70 backdrop-blur-xl rounded-xl px-4 py-2 border border-slate-700/30 flex items-center gap-2.5">
                                    <div className="w-2 h-2 rounded-full transition-colors duration-300" style={{ backgroundColor: positionMatch ? '#22c55e' : activeColor, boxShadow: positionMatch ? '0 0 8px #22c55e' : 'none' }} />
                                    <p className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: positionMatch ? '#22c55e' : activeColor }}>
                                        {statusText}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quality warning */}
                    <AnimatePresence>
                        {qualityWarning && !faceLockedIn && (
                            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                                className="absolute top-3 inset-x-3 z-30 bg-amber-500/90 backdrop-blur-md rounded-xl px-4 py-2 flex items-center gap-3">
                                <i className="ti ti-alert-triangle text-black" />
                                <p className="text-[11px] font-bold text-black">{qualityWarning}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Confidence + Compass */}
                    {!faceLockedIn && cameraReady && confidence > 0 && (
                        <>
                            <div className="absolute top-3 right-3 z-30 bg-black/50 backdrop-blur-md rounded-lg px-2.5 py-1.5 border border-slate-700/40">
                                <p className="text-[7px] text-slate-500 font-bold uppercase tracking-widest">AI</p>
                                <p className={`text-sm font-black tabular-nums leading-tight ${confidence > 80 ? 'text-emerald-400' : confidence > 60 ? 'text-blue-400' : 'text-amber-400'}`}>{confidence}%</p>
                            </div>
                            <div className="absolute top-3 left-3 z-30 bg-black/50 backdrop-blur-md rounded-lg p-1.5 border border-slate-700/40">
                                <div className="w-9 h-9 relative rounded-full border border-slate-700/40">
                                    <div className="absolute w-2 h-2 rounded-full shadow-lg transition-all duration-100 ease-out"
                                         style={{
                                             backgroundColor: positionMatch ? '#22c55e' : '#3b82f6',
                                             boxShadow: `0 0 6px ${positionMatch ? '#22c55e' : '#3b82f6'}`,
                                             left: `${headDot.x}%`, top: `${headDot.y}%`,
                                             transform: 'translate(-50%, -50%)',
                                         }} />
                                    <div className="absolute inset-0 flex items-center justify-center"><div className="w-0.5 h-0.5 rounded-full bg-slate-700" /></div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Done overlay */}
                    <AnimatePresence>
                        {faceLockedIn && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                className="absolute inset-0 z-30 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center">
                                {isUploading && !uploadStatus.includes('') ? (
                                    <>
                                        <div className="relative w-20 h-20 mb-5">
                                            <div className="absolute inset-0 border-2 border-blue-500/30 rounded-full animate-ping" />
                                            <div className="absolute inset-0 border-2 border-blue-500 rounded-full animate-spin border-t-transparent" />
                                            <div className="absolute inset-3 border-2 border-indigo-500 rounded-full animate-spin border-b-transparent" style={{ animationDirection: 'reverse' }} />
                                            <div className="absolute inset-6 bg-blue-500/20 rounded-full flex items-center justify-center"><i className="ti ti-brain text-blue-400 text-lg" /></div>
                                        </div>
                                        <p className="text-white font-bold text-lg mb-1">{uploadStatus}</p>
                                        <p className="text-slate-500 text-xs font-mono">Powered by Google Gemini AI</p>
                                    </>
                                ) : uploadStatus.includes('') ? (
                                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }} className="text-center">
                                        <div className="h-24 w-24 bg-emerald-500 rounded-full flex items-center justify-center text-white text-5xl shadow-[0_0_60px_rgba(34,197,94,0.5)] mx-auto mb-4"><i className="ti ti-check" /></div>
                                        <p className="text-white font-black text-2xl tracking-wide">REGISTERED</p>
                                        <p className="text-emerald-300 text-xs mt-2 font-bold">Redirecting...</p>
                                    </motion.div>
                                ) : (
                                    <div className="text-center"><div className="h-20 w-20 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400 text-3xl mb-4 animate-pulse mx-auto"><i className="ti ti-scan" /></div><p className="text-white font-bold text-lg">{statusText}</p></div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                        { label: 'Phase', value: `${Math.min(done + 1, 5)}/${PHASES.length}`, color: 'text-white' },
                        { label: 'Overall', value: `${Math.round(overallProgress)}%`, color: overallProgress >= 100 ? 'text-emerald-400' : `text-[${activeColor}]` },
                        { label: 'AI', value: `${confidence}%`, color: confidence > 80 ? 'text-emerald-400' : confidence > 60 ? 'text-blue-400' : 'text-amber-400' },
                    ].map(s => (
                        <div key={s.label} className="bg-slate-800/30 border border-slate-700/20 rounded-xl px-3 py-2 text-center">
                            <p className="text-[7px] text-slate-600 font-bold uppercase tracking-widest">{s.label}</p>
                            <p className={`font-black text-lg leading-tight ${s.color}`}>{s.value}</p>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="bg-slate-800/20 border border-slate-700/15 rounded-xl px-4 py-2 mb-3">
                    <div className="flex items-center gap-3">
                        <i className="ti ti-shield-lock text-blue-500/50 text-sm" />
                        <p className="text-[9px] text-slate-600">Protected by Google Gemini AI anti-spoofing · Photos, masks & screens auto-rejected</p>
                    </div>
                </div>
                <div className="flex justify-center">
                    <button onClick={handleLogout} className="text-slate-600 hover:text-red-400 text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-colors px-4 py-2 hover:bg-white/5 rounded-xl">
                        <i className="ti ti-logout text-base" /> Logout & Abort
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
