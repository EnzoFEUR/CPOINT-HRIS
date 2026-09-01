import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import { fetchWithAuth } from '../../utils/api';

const Scanner = () => {
    const navigate = useNavigate();
    
    const operatorName = "Operator";

    const [isScanning, setIsScanning] = useState(false);
    const [scannedData, setScannedData] = useState(null);
    const [feedback, setFeedback] = useState({ show: false, type: '', title: '', message: '' });
    
    // AI Face State
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [faceLockedIn, setFaceLockedIn] = useState(false);
    const [lockProgress, setLockProgress] = useState(0); // 0 to 100
    const [aiStatus, setAiStatus] = useState("Waiting for ID Scan..."); // Waiting, Detecting, Locking, Verifying

    const html5QrCodeRef = useRef(null);
    const isProcessingRef = useRef(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const detectionInterval = useRef(null);
    const lockFrames = useRef(0);

    const REQUIRED_LOCK_FRAMES = 15; // Approx 1.5 seconds at 10fps

    // Helpers and feedback
    const showFeedback = useCallback((type, title, message) => {
        setFeedback({ show: true, type, title, message });
    }, []);

    const resetState = useCallback(() => {
        if (detectionInterval.current) clearInterval(detectionInterval.current);
        isProcessingRef.current = false;
        setScannedData(null);
        setFaceLockedIn(false);
        setLockProgress(0);
        lockFrames.current = 0;
        setAiStatus("Waiting for ID Scan...");
        setFeedback({ show: false, type: '', title: '', message: '' });
        
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    }, []);

    // Capture and submit attendance
    const captureAndSubmit = useCallback(() => {
        let imageBase64 = null;
        if (videoRef.current) {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const context = canvas.getContext('2d');
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        }

        fetchWithAuth("/api/attendance/scan", {
            method: "POST",
            body: JSON.stringify({ 
                employee_id: scannedData ? scannedData.trim() : '',
                image_data: imageBase64 
            }) 
        })
        .then(response => response.json())
        .then(data => {
            showFeedback(
                data.status === 'success' ? 'success' : 'error', 
                data.status === 'success' ? 'Verified!' : 'Error',
                data.message
            );
            
            setTimeout(() => { resetState(); }, 3000);
        })
        .catch(error => {
            showFeedback('error', 'Failed', 'Connection Error');
            setTimeout(() => { resetState(); }, 3000);
        });
    }, [scannedData, showFeedback, resetState]);

    // Face Detection
    const startFaceDetection = useCallback(() => {
        if (!videoRef.current || !canvasRef.current || !modelsLoaded) return;
        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        // Match canvas to video size
        const displaySize = { width: video.videoWidth, height: video.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);

        detectionInterval.current = setInterval(async () => {
            // Run TinyFaceDetector
            const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }));
            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            
            // Clear previous drawings
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (resizedDetections.length > 0) {
                // Draw AI Bounding Box
                const box = resizedDetections[0].box;
                ctx.strokeStyle = '#3b82f6'; // Blue Box
                ctx.lineWidth = 4;
                ctx.strokeRect(box.x, box.y, box.width, box.height);

                // Check if face is centered and large enough
                const boxCenterX = box.x + (box.width / 2);
                const boxCenterY = box.y + (box.height / 2);
                const videoCenterX = displaySize.width / 2;
                const videoCenterY = displaySize.height / 2;
                
                // Tolerance for centered face
                const isCentered = Math.abs(boxCenterX - videoCenterX) < 100 && Math.abs(boxCenterY - videoCenterY) < 100;
                
                if (isCentered) {
                    lockFrames.current += 1;
                    setAiStatus("Locking Target...");
                    setLockProgress(Math.min((lockFrames.current / REQUIRED_LOCK_FRAMES) * 100, 100));

                    if (lockFrames.current >= REQUIRED_LOCK_FRAMES) {
                        // Trigger capture when face is aligned
                        clearInterval(detectionInterval.current);
                        setFaceLockedIn(true);
                        setAiStatus("Verifying Identity...");
                        
                        // Draw green box
                        ctx.strokeStyle = '#22c55e';
                        ctx.strokeRect(box.x, box.y, box.width, box.height);
                        
                        captureAndSubmit();
                    }
                } else {
                    lockFrames.current = 0;
                    setLockProgress(0);
                    setAiStatus("Center Face in Frame");
                }
            } else {
                lockFrames.current = 0;
                setLockProgress(0);
                setAiStatus("No Face Detected");
            }
        }, 100); // 10 fps
    }, [modelsLoaded, captureAndSubmit]);

    // QR Success
    const onScanSuccess = useCallback((decodedText) => {
        if (isProcessingRef.current) return;
        
        // 1. QR Scanned! Start Face Detection Mode
        isProcessingRef.current = true;
        setScannedData(decodedText);
        setAiStatus("Detecting Face...");
        startFaceDetection();
    }, [startFaceDetection]);

    // Scanner Controls
    const stopScanner = useCallback(() => {
        if (detectionInterval.current) clearInterval(detectionInterval.current);
        if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().then(() => {
                html5QrCodeRef.current.clear();
                resetState();
                setIsScanning(false);
            }).catch(err => console.error(err));
        } else {
            resetState();
            setIsScanning(false);
        }
    }, [resetState]);

    const startScanner = useCallback(async () => {
        setIsScanning(true);
        setAiStatus("Waiting for ID Scan...");

        try {
            html5QrCodeRef.current = new Html5Qrcode("reader");
            const config = { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
            
            try {
                await html5QrCodeRef.current.start(
                    { facingMode: { ideal: "environment" } }, 
                    config, 
                    (decodedText) => onScanSuccess(decodedText)
                );
            } catch (camErr) {
                console.warn('[Scanner] Fallback to user facing camera:', camErr);
                await html5QrCodeRef.current.start(
                    { facingMode: "user" }, 
                    config, 
                    (decodedText) => onScanSuccess(decodedText)
                );
            }

            const videoElement = document.querySelector('#reader video');
            if (videoElement) {
                videoElement.setAttribute('playsinline', 'true');
                videoElement.setAttribute('webkit-playsinline', 'true');
                videoRef.current = videoElement;
            }
        } catch (err) {
            console.error('[Scanner] Camera activation error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showFeedback('error', 'Camera Permission Denied', 'Please allow camera access in your browser settings to scan QR codes.');
            } else {
                showFeedback('error', 'Camera Unavailable', 'Could not access camera device. Check device settings.');
            }
            setIsScanning(false);
        }
    }, [onScanSuccess, showFeedback]);

    // Load face detection models
    useEffect(() => {
        const loadModels = async () => {
            const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';
            try {
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                ]);
                setModelsLoaded(true);
            } catch (err) {
                console.error("Failed to load Face AI Models:", err);
            }
        };
        loadModels();
    }, []);

    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .ios-btn { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
            .ios-btn:active { transform: scale(0.96); }
            
            @keyframes scan-laser {
                0% { top: 0; opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { top: 100%; opacity: 0; }
            }
            .laser-line {
                animation: scan-laser 2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                background: #3b82f6;
            }
    
            #reader button { display: none !important; }
            #reader video { object-fit: cover; border-radius: 1.5rem; width: 100%; height: 100%; }
        `;
        document.head.appendChild(style);
        return () => document.head.removeChild(style);
    }, []);

    useEffect(() => {
        return () => {
            stopScanner();
        };
    }, [stopScanner]);

    const handleLogout = (e) => {
        e.preventDefault();
        navigate('/login');
    };

    return (
        <div className="max-w-md mx-auto py-10 px-6 min-h-screen flex flex-col justify-center">
            
            {/* Header */}
            <div className="text-center mb-10 space-y-3">
                <div className="flex mx-auto items-center justify-center h-16 w-16 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/30 mb-2 relative overflow-hidden">
                    <i className="ti ti-scan text-3xl relative z-10"></i>
                    {modelsLoaded && <div className="absolute inset-0 bg-blue-400/20 laser-line pointer-events-none"></div>}
                </div>
                <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Security Terminal</h2>
                <p className="text-slate-500 font-medium text-sm flex items-center justify-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${modelsLoaded ? 'bg-green-500' : 'bg-amber-500'}`}></span>
                    {modelsLoaded ? 'AI Models Loaded' : 'Loading AI Models...'}
                </p>
            </div>

            {/* Scanner interface */}
            <div className={`relative w-full bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden ${isScanning ? 'h-[500px]' : 'h-[300px]'}`}>
                
                {/* Idle state */}
                {!isScanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-6">
                        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center text-3xl shadow-inner">
                            <i className="ti ti-camera"></i>
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-xl font-bold text-slate-800">Scanner Ready</h3>
                            <p className="text-slate-400 text-sm max-w-[200px] mx-auto">Activate the camera to begin checking in employees.</p>
                        </div>
                        <button 
                            onClick={startScanner} 
                            disabled={!modelsLoaded}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base rounded-2xl shadow-lg shadow-blue-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            <i className="ti ti-power text-xl"></i>
                            Launch Camera
                        </button>
                    </div>
                )}

                {/* Camera view */}
                <div className={`absolute inset-0 bg-black flex flex-col items-center justify-between p-6 ${isScanning ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                    
                    {/* Top overlay */}
                    <div className="w-full flex items-center justify-between z-20 text-white">
                        <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-500"></span> Live
                        </span>
                        <button 
                            onClick={stopScanner} 
                            className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/30"
                        >
                            <i className="ti ti-x"></i>
                        </button>
                    </div>

                    {/* QR scanner */}
                    <div className="absolute inset-0 z-0">
                        <div id="reader" className="w-full h-full"></div>
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
                    </div>

                    {/* Face target overlay */}
                    {scannedData && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
                            <div className="relative w-64 h-64 border-2 border-dashed border-white/40 rounded-full flex items-center justify-center">
                                {/* Circular progress ring */}
                                <svg className="absolute inset-0 w-full h-full -rotate-90">
                                    <circle
                                        cx="128"
                                        cy="128"
                                        r="120"
                                        className="stroke-current text-white/10"
                                        strokeWidth="8"
                                        fill="transparent"
                                    />
                                    <circle
                                        cx="128"
                                        cy="128"
                                        r="120"
                                        className="stroke-current text-blue-500"
                                        strokeWidth="8"
                                        strokeDasharray={2 * Math.PI * 120}
                                        strokeDashoffset={(2 * Math.PI * 120) * (1 - lockProgress / 100)}
                                        strokeLinecap="round"
                                        fill="transparent"
                                    />
                                </svg>
                                <i className={`ti ti-user text-6xl ${faceLockedIn ? 'text-green-400' : 'text-white/40'}`}></i>
                            </div>
                        </div>
                    )}

                    {/* Status card */}
                    <div className="w-full z-20 bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex items-center justify-between text-white">
                        <div className="space-y-0.5">
                            <p className="text-xs text-slate-400 font-medium tracking-wide uppercase">AI Subsystem</p>
                            <p className="text-sm font-bold flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${faceLockedIn ? 'bg-green-400' : 'bg-blue-400'}`}></span>
                                {aiStatus}
                            </p>
                        </div>
                        {lockProgress > 0 && !faceLockedIn && (
                            <span className="text-lg font-mono font-extrabold text-blue-400">
                                {Math.round(lockProgress)}%
                            </span>
                        )}
                    </div>
                </div>

                {/* Feedback modal */}
                {feedback.show && (
                    <div className="absolute inset-0 z-30 bg-white flex flex-col items-center justify-center p-8 text-center space-y-4">
                        <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl shadow-lg ${
                            feedback.type === 'success' 
                                ? 'bg-green-100 text-green-600 shadow-green-500/20' 
                                : 'bg-red-100 text-red-600 shadow-red-500/20'
                        }`}>
                            <i className={`ti ${feedback.type === 'success' ? 'ti-check' : 'ti-alert-triangle'}`}></i>
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-2xl font-black text-slate-800 tracking-tight">{feedback.title}</h3>
                            <p className="text-slate-500 text-sm font-medium">{feedback.message}</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="mt-8 text-center">
                <button 
                    onClick={handleLogout}
                    className="text-slate-400 hover:text-slate-600 font-semibold text-sm transition-colors"
                >
                    &larr; Exit Terminal Mode
                </button>
            </div>
        </div>
    );
};

export default Scanner;
