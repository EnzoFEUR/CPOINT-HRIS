import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useNavigate } from 'react-router-dom';
import * as faceapi from 'face-api.js';

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

    // 1. Load AI Models on mount
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

    // 2. Global Styles
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
                background: linear-gradient(to right, transparent, #3b82f6, transparent);
            }
    
            #reader button { display: none !important; }
            #reader video { object-fit: cover; border-radius: 1.5rem; width: 100%; height: 100%; }
        `;
        document.head.appendChild(style);
        return () => document.head.removeChild(style);
    }, []);

    // Cleanup
    useEffect(() => {
        return () => {
            stopScanner();
        };
    }, []);

    const startScanner = () => {
        setIsScanning(true);
        setAiStatus("Waiting for ID Scan...");
        html5QrCodeRef.current = new Html5Qrcode("reader");
        
        const config = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };
        
        html5QrCodeRef.current.start(
            { facingMode: "environment" }, 
            config, 
            (decodedText) => onScanSuccess(decodedText)
        ).then(() => {
            // Find the video element created by html5-qrcode
            const videoElement = document.querySelector('#reader video');
            if (videoElement) {
                videoRef.current = videoElement;
            }
        }).catch(err => {
            console.error(err);
            showFeedback('error', 'Camera Error', 'Could not access camera.');
            setIsScanning(false);
        });
    };

    const stopScanner = () => {
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
    };

    const onScanSuccess = (decodedText) => {
        if (isProcessingRef.current) return;
        
        // 1. QR Scanned! Start Face Detection Mode
        isProcessingRef.current = true;
        setScannedData(decodedText);
        setAiStatus("Detecting Face...");
        startFaceDetection();
    };

    const startFaceDetection = () => {
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
                        // FACE LOCKED IN! Trigger Capture.
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
    };

    const captureAndSubmit = () => {
        let imageBase64 = null;
        if (videoRef.current) {
            const canvas = document.createElement('canvas');
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            const context = canvas.getContext('2d');
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        }

        fetch("http://localhost:5000/api/attendance/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
    };

    const showFeedback = (type, title, message) => {
        setFeedback({ show: true, type, title, message });
    };

    const resetState = () => {
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
    };

    const handleLogout = (e) => {
        e.preventDefault();
        navigate('/login');
    };

    return (
        <div className="max-w-md mx-auto py-10 px-6 min-h-screen flex flex-col justify-center">
            
            {/* HEADER */}
            <div className="text-center mb-10 space-y-3">
                <div className="flex mx-auto items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 mb-2 relative overflow-hidden">
                    <i className="ti ti-scan text-3xl relative z-10"></i>
                    {modelsLoaded && <div className="absolute inset-0 bg-blue-400/20 laser-line pointer-events-none"></div>}
                </div>
                <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Security Terminal</h2>
                <p className="text-slate-500 font-medium text-sm flex items-center justify-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${modelsLoaded ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}></span>
                    {modelsLoaded ? 'AI Models Loaded' : 'Loading AI Models...'}
                </p>
            </div>

            {/* MAIN INTERFACE */}
            <div className={`relative w-full bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden transition-all duration-500 ease-out ${isScanning ? 'h-[500px]' : 'h-[300px]'}`}>
                
                {/* STATE 1: IDLE */}
                {!isScanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 transition-opacity duration-300">
                        <div className="h-24 w-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 animate-pulse">
                            <i className="ti ti-camera text-4xl text-slate-300"></i>
                        </div>

                        <button onClick={startScanner} disabled={!modelsLoaded}
                                className={`ios-btn w-full py-4 ${modelsLoaded ? 'bg-slate-900 shadow-xl hover:shadow-2xl hover:-translate-y-1' : 'bg-slate-300'} text-white font-bold text-lg rounded-2xl flex items-center justify-center gap-3`}>
                            <i className={`ti ${modelsLoaded ? 'ti-player-play-filled' : 'ti-loader animate-spin'}`}></i>
                            {modelsLoaded ? 'Start Terminal' : 'Loading AI...'}
                        </button>
                        <p className="text-xs text-slate-400 mt-4 font-medium">Biometric ID Scanner</p>
                    </div>
                )}

                {/* STATE 2: ACTIVE SCANNER & AI */}
                {isScanning && (
                    <div className="absolute inset-0 bg-black transition-opacity duration-300">
                        
                        {/* Camera Viewport */}
                        <div id="reader" className="absolute inset-0 w-full h-full"></div>
                        
                        {/* AI Canvas Overlay */}
                        <canvas ref={canvasRef} className="absolute inset-0 z-10 w-full h-full object-cover pointer-events-none"></canvas>

                        {/* UI Overlay */}
                        {!feedback.show && (
                            <div className="absolute inset-0 z-20 flex flex-col justify-between p-6 pointer-events-none">
                                {/* Top Status Bar */}
                                <div className="flex justify-between items-center bg-black/60 backdrop-blur-md rounded-2xl p-3 border border-white/10 shadow-lg">
                                    <div className="flex flex-col">
                                        <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">AI Status</span>
                                        <span className={`text-sm font-bold ${scannedData ? 'text-blue-400' : 'text-white'}`}>
                                            {aiStatus}
                                        </span>
                                    </div>
                                    {scannedData && (
                                        <div className="h-10 w-10 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center">
                                            <i className="ti ti-user-scan text-blue-400 text-xl"></i>
                                        </div>
                                    )}
                                </div>

                                {/* Target Box (QR Phase) */}
                                {!scannedData && (
                                    <div className="relative w-64 h-64 mx-auto border border-white/30 rounded-3xl mt-4">
                                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-3xl"></div>
                                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-3xl"></div>
                                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-3xl"></div>
                                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-3xl"></div>
                                        <div className="absolute left-0 w-full h-0.5 laser-line top-1/2"></div>
                                    </div>
                                )}

                                {/* Progress Bar (Face Lock Phase) */}
                                {scannedData && (
                                    <div className="w-full mt-auto mb-4">
                                        <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden border border-white/10 backdrop-blur-md">
                                            <div className={`h-full transition-all duration-100 ease-out ${faceLockedIn ? 'bg-green-500' : 'bg-blue-500'}`} 
                                                 style={{ width: `${lockProgress}%` }}></div>
                                        </div>
                                    </div>
                                )}

                                {/* Stop Button */}
                                <div className="pointer-events-auto text-center mt-auto">
                                    <button onClick={stopScanner} 
                                            className="ios-btn bg-white/10 backdrop-blur-md border border-white/20 text-white font-bold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors flex items-center justify-center gap-2 mx-auto shadow-lg shadow-black/50">
                                        <i className="ti ti-player-stop-filled text-red-400"></i>
                                        Abort
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Result Feedback Overlay */}
                        {feedback.show && (
                            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-md transition-opacity duration-200">
                                <div className={`text-center transform transition-transform duration-300 ${feedback.show ? 'scale-100' : 'scale-90'}`}>
                                    {feedback.type === 'success' && (
                                        <div className="h-24 w-24 mx-auto rounded-full bg-green-500 text-white flex items-center justify-center text-5xl mb-4 shadow-[0_0_40px_rgba(34,197,94,0.4)]">
                                            <i className="ti ti-check"></i>
                                        </div>
                                    )}
                                    {feedback.type === 'error' && (
                                        <div className="h-24 w-24 mx-auto rounded-full bg-red-500 text-white flex items-center justify-center text-5xl mb-4 shadow-[0_0_40px_rgba(239,68,68,0.4)]">
                                            <i className="ti ti-x"></i>
                                        </div>
                                    )}
                                    <h3 className="text-3xl font-black text-white mb-2">{feedback.title}</h3>
                                    <p className="text-slate-300 text-base font-medium bg-black/50 px-4 py-2 rounded-lg border border-white/10 inline-block">{feedback.message}</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* FOOTER */}
            <div className="text-center mt-10">
                <form onSubmit={handleLogout}>
                    <button type="submit" className="ios-btn text-red-400 hover:text-red-500 font-bold text-sm bg-red-50 hover:bg-red-100 px-6 py-3 rounded-xl transition-colors">
                        End Shift (Sign Out)
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Scanner;
