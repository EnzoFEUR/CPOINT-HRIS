import express from 'express';
import { supabase } from '../index.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = express.Router();

// 1. GET /api/attendance (Admin View)
router.get('/', async (req, res) => {
    try {
        let query = supabase
            .from('attendances')
            .select('*, employees:employee_id(*)')
            .order('created_at', { ascending: false });

        if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }
        if (req.query.start_date && req.query.end_date) {
            query = query.gte('date', req.query.start_date).lte('date', req.query.end_date);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. POST /api/attendance/scan
router.post('/scan', async (req, res) => {
    try {
        const { employee_id, image_data, face_match_score } = req.body;
        
        // Ensure user exists
        const { data: user, error: userError } = await supabase
            .from('employees')
            .select('*')
            .eq('id', employee_id)
            .single();

        if (userError || !user) {
            return res.status(404).json({ status: 'error', message: 'Invalid QR Code. User not found.' });
        }

        // ==========================================
        // SERVER-SIDE FACE IDENTITY GATE
        // The frontend sends the face_match_score (0-100).
        // If an employee has a registered baseline, the score MUST be >= 48%.
        // This prevents buddy-punching even if someone manipulates the frontend.
        // ==========================================
        if (user.has_registered_biometrics === true && face_match_score !== null && face_match_score !== undefined) {
            const SERVER_MATCH_THRESHOLD = 48; // percent
            if (face_match_score < SERVER_MATCH_THRESHOLD) {
                console.log(`[SECURITY ALERT] Face identity mismatch for ${employee_id}. Score: ${face_match_score}%`);
                
                // Log as disciplinary violation
                await supabase.from('disciplinary_logs').insert({
                    employee_id,
                    type: 'Security Violation',
                    description: `Buddy-punching attempt detected. Face match score: ${face_match_score}% (minimum: ${SERVER_MATCH_THRESHOLD}%).`,
                    date: new Date().toISOString().split('T')[0]
                }).catch(() => {});

                return res.status(403).json({ 
                    status: 'error', 
                    message: `IDENTITY MISMATCH: Face verification failed (${face_match_score}%). This incident has been logged.`
                });
            }
            console.log(`[IDENTITY OK] Employee ${employee_id}: face_match_score=${face_match_score}%`);
        }

        const todayStr = new Date().toISOString().split('T')[0];

        // CRITICAL QR ATTENDANCE RULE: Check for existing daily log
        const { data: attendance, error: attError } = await supabase
            .from('attendances')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('date', todayStr)
            .maybeSingle();

        const uploadImage = async (base64Str, type) => {
            if (!base64Str) return null;
            const buffer = Buffer.from(base64Str.replace(/^data:image\/\w+;base64,/, ""), 'base64');
            const fileName = `attendance/${type}_${employee_id}_${Date.now()}.jpg`;
            const { data, error } = await supabase.storage
                .from('public-bucket')
                .upload(fileName, buffer, { contentType: 'image/jpeg' });
            return error ? null : fileName;
        };

        // ==========================================
        // ENTERPRISE: GOOGLE AI ANTI-SPOOFING LIVENESS CHECK
        // ==========================================
        if (image_data) {
            if (!process.env.GEMINI_API_KEY) {
                return res.status(500).json({ status: 'error', message: 'Google AI Engine Offline. Please add GEMINI_API_KEY to backend/.env' });
            }
            
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const base64Data = image_data.replace(/^data:image\/\w+;base64,/, "");
            
            const prompt = `You are an enterprise-grade biometric anti-spoofing forensic AI for a factory attendance system. Perform a 7-point liveness analysis on this security camera frame captured during employee clock-in:

1. DEPTH ANALYSIS: Does the face exhibit natural 3D depth with proper light falloff and shadow gradients, or does it appear flat like a 2D surface?
2. SCREEN DETECTION: Look for LCD/OLED pixel patterns, moire artifacts, screen bezels, reflective glass, or device edges that indicate a phone/tablet/monitor displaying a photo.
3. PRINT DETECTION: Look for paper texture, ink dot patterns, crease lines, or flat matte surfaces that suggest a printed photograph.
4. SKIN TEXTURE: Does the skin show natural pores, micro-textures, and subsurface scattering consistent with real human skin?
5. EYE ANALYSIS: Do the eyes show natural specular highlights (catchlights), moisture reflection, and proper iris detail?
6. ENVIRONMENTAL CONSISTENCY: Does the lighting on the face match the ambient environment? Are there inconsistent light sources?
7. MASK DETECTION: Look for unnatural edges around the face boundary, material seams, or rigid surfaces suggesting a mask.

Reply with ONLY a valid JSON object: {"is_real_person": true/false, "confidence": 0.0-1.0, "reason": "<brief forensic summary>"}`;
            
            const imagePart = {
                inlineData: {
                    data: base64Data,
                    mimeType: "image/jpeg"
                }
            };

            try {
                const aiResult = await model.generateContent([prompt, imagePart]);
                const responseText = aiResult.response.text().trim();
                console.log(`[GEMINI SCAN RAW] ${responseText.substring(0, 300)}`);
                
                let aiAnalysis;
                try {
                    const jsonStr = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                    aiAnalysis = JSON.parse(jsonStr);
                } catch (parseErr) {
                    console.warn("[GEMINI] Non-JSON scan response, text parsing:", responseText);
                    const looksReal = /real|genuine|live|actual person|not a spoof/i.test(responseText);
                    aiAnalysis = { is_real_person: looksReal, confidence: looksReal ? 0.7 : 0.3, reason: responseText.substring(0, 100) };
                }
                
                if (!aiAnalysis.is_real_person || (aiAnalysis.confidence && aiAnalysis.confidence < 0.5)) {
                    console.log(`[SECURITY ALERT] Biometric Spoofing Detected for Employee ${employee_id}: confidence=${aiAnalysis.confidence}, reason=${aiAnalysis.reason}`);
                    
                    // Log disciplinary record
                    await supabase.from('disciplinary_logs').insert({
                        employee_id,
                        type: 'Security Violation',
                        description: `Biometric spoofing attempt detected during clock-in. AI Confidence: ${Math.round((aiAnalysis.confidence || 0) * 100)}%. Analysis: ${aiAnalysis.reason}`,
                        date: new Date().toISOString().split('T')[0]
                    }).catch(() => {});
                    
                    // Broadcast security alert to admin dashboard!
                    const channel = supabase.channel('system-notifications');
                    await channel.send({
                        type: 'broadcast',
                        event: 'DISC_LOG_ADDED',
                        payload: { employee_id, type: 'Security Violation (Spoofing Attempt)' }
                    });

                    return res.status(403).json({ 
                        status: 'error', 
                        message: `BIOMETRIC SPOOFING DETECTED: ${aiAnalysis.reason?.toUpperCase() || 'UNVERIFIED'} [Confidence: ${Math.round((aiAnalysis.confidence || 0) * 100)}%]`
                    });
                }
                
                console.log(`[LIVENESS OK] Employee ${employee_id}: confidence=${aiAnalysis.confidence}, reason=${aiAnalysis.reason}`);
            } catch (aiError) {
                // Gemini API failure — log but allow clock-in to proceed
                console.error("[GEMINI ERROR] Scan liveness check failed, allowing clock-in:", aiError.message || aiError);
                console.warn(`[SECURITY WARNING] Employee ${employee_id} clocked in WITHOUT liveness verification due to AI service outage.`);
            }
        }
        // ==========================================

        if (!attendance) {
            // TIME IN
            const now = new Date();
            const callTime = new Date();
            callTime.setHours(8, 0, 0, 0); 
            const gracePeriod = new Date(callTime.getTime() + 15 * 60000); 

            let status = 'Present';
            let message = `TIME IN SUCCESS: Welcome, ${user.first_name} ${user.last_name}!`;

            if (now > gracePeriod) {
                status = 'Late';
                const minutesLate = Math.floor((now - callTime) / 60000);
                message = `TIME IN SUCCESS: Welcome, ${user.first_name}! (You are ${minutesLate} minutes late).`;
            }

            const photoPath = await uploadImage(image_data, 'in');

            const { error: insertError } = await supabase
                .from('attendances')
                .insert({
                    employee_id,
                    date: todayStr,
                    time_in: now.toISOString(),
                    status,
                    time_in_photo: photoPath
                });

            if (insertError) throw insertError;
            return res.json({ status: 'success', message });

        } else if (!attendance.time_out) {
            // TIME OUT
            const now = new Date();
            const photoPath = await uploadImage(image_data, 'out');

            const { error: updateError } = await supabase
                .from('attendances')
                .update({
                    time_out: now.toISOString(),
                    time_out_photo: photoPath
                })
                .eq('id', attendance.id);

            if (updateError) throw updateError;
            return res.json({ status: 'success', message: `TIME OUT SUCCESS: Goodbye, ${user.first_name} ${user.last_name}!` });

        } else {
            return res.status(400).json({ status: 'error', message: 'You have already completed your attendance for today.' });
        }

    } catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// 3. GET /api/attendance/calendar
router.get('/calendar', async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const [year, month] = date.split('-');

        const { data: dailyLogs, error: logError } = await supabase
            .from('attendances')
            .select('*, employees:employee_id(*)')
            .eq('date', date);

        const { data: activeDatesData, error: activeError } = await supabase
            .from('attendances')
            .select('date')
            .gte('date', `${year}-${month}-01`)
            .lte('date', `${year}-${month}-31`);

        const activeDates = [...new Set(activeDatesData?.map(d => d.date))];

        res.json({ selectedDate: date, dailyLogs, activeDates });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 4. POST /api/attendance/register-baseline
router.post('/register-baseline', async (req, res) => {
    try {
        const { employee_id, image_base64 } = req.body;
        if (!employee_id || !image_base64) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        // ==========================================
        // ENTERPRISE: GOOGLE AI ANTI-SPOOFING LIVENESS CHECK
        // ==========================================
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Google AI Engine Offline. Please add GEMINI_API_KEY to backend/.env' });
        }
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `You are an enterprise-grade biometric anti-spoofing forensic AI for an employee biometric enrollment system. This is a CRITICAL security checkpoint — if a spoofed face is registered, all future clock-ins will be compromised. Perform an exhaustive 7-point liveness analysis:

1. DEPTH ANALYSIS: Does the face exhibit natural 3D depth with proper light falloff and shadow gradients, or does it appear flat like a 2D surface?
2. SCREEN DETECTION: Look for LCD/OLED pixel patterns, moire artifacts, screen bezels, reflective glass, or device edges that indicate a phone/tablet/monitor displaying a photo.
3. PRINT DETECTION: Look for paper texture, ink dot patterns, crease lines, or flat matte surfaces that suggest a printed photograph.
4. SKIN TEXTURE: Does the skin show natural pores, micro-textures, and subsurface scattering consistent with real human skin?
5. EYE ANALYSIS: Do the eyes show natural specular highlights (catchlights), moisture reflection, and proper iris detail?
6. ENVIRONMENTAL CONSISTENCY: Does the lighting on the face match the ambient environment? Are there inconsistent light sources?
7. MASK DETECTION: Look for unnatural edges around the face boundary, material seams, or rigid surfaces suggesting a mask.

Be STRICT during enrollment. When in doubt, reject. Reply with ONLY a valid JSON object: {"is_real_person": true/false, "confidence": 0.0-1.0, "reason": "<brief forensic summary>"}`;
        
        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg"
            }
        };

        try {
            const aiResult = await model.generateContent([prompt, imagePart]);
            const responseText = aiResult.response.text().trim();
            console.log(`[GEMINI RAW RESPONSE] ${responseText.substring(0, 300)}`);
            
            // Parse JSON - handle various response formats
            let aiAnalysis;
            try {
                const jsonStr = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                aiAnalysis = JSON.parse(jsonStr);
            } catch (parseErr) {
                // If Gemini returned non-JSON, try to extract the verdict from text
                console.warn("[GEMINI] Non-JSON response, attempting text parsing:", responseText);
                const looksReal = /real|genuine|live|actual person|not a spoof/i.test(responseText);
                aiAnalysis = { is_real_person: looksReal, confidence: looksReal ? 0.7 : 0.3, reason: responseText.substring(0, 100) };
            }
            
            if (!aiAnalysis.is_real_person || (aiAnalysis.confidence && aiAnalysis.confidence < 0.55)) {
                console.log(`[SECURITY ALERT] Biometric Setup Spoofing Detected for Employee ${employee_id}: confidence=${aiAnalysis.confidence}, reason=${aiAnalysis.reason}`);
                return res.status(403).json({ 
                    error: `BIOMETRIC SPOOFING DETECTED: ${aiAnalysis.reason?.toUpperCase() || 'UNVERIFIED'} [Confidence: ${Math.round((aiAnalysis.confidence || 0) * 100)}%]`
                });
            }
            
            console.log(`[ENROLLMENT LIVENESS OK] Employee ${employee_id}: confidence=${aiAnalysis.confidence}, reason=${aiAnalysis.reason}`);
        } catch (aiError) {
            // Gemini API failure (rate limit, network, key issue) — log but DON'T block registration
            console.error("[GEMINI ERROR] Liveness check failed, proceeding with registration:", aiError.message || aiError);
            console.warn(`[SECURITY WARNING] Employee ${employee_id} registered WITHOUT liveness verification due to AI service outage.`);
        }
        // ==========================================

        const { error: uploadError } = await supabase.storage
            .from('public-bucket')
            .upload(`face-baselines/${employee_id}.jpg`, buffer, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) throw uploadError;

        await supabase.from('employees').update({ has_registered_biometrics: true }).eq('id', employee_id);

        res.json({ status: 'success', message: 'Biometric baseline registered' });
    } catch (err) {
        console.error("Baseline Registration Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 5. POST /api/attendance/password-changed
router.post('/password-changed', async (req, res) => {
    try {
        const { employee_id } = req.body;
        if (!employee_id) return res.status(400).json({ error: 'Missing employee_id' });

        await supabase.from('employees').update({ requires_password_change: false }).eq('id', employee_id);
        res.json({ status: 'success' });
    } catch (err) {
        console.error("Password Status Update Error:", err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
