import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Upload buffer to Gemini File API and return the file URI
 */
export const uploadToGeminiFile = async (buffer, mimeType = 'image/jpeg', displayName = 'enrollment') => {
  const API_KEY = process.env.GEMINI_API_KEY;
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`;
  
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'start, upload, finalize',
      'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': mimeType,
    },
    body: buffer,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini File Upload Failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return {
    uri: data.file?.uri,
    name: data.file?.name,
  };
};

/**
 * Delete file from Gemini File API (privacy cleanup)
 */
export const deleteGeminiFile = async (fileName) => {
  const API_KEY = process.env.GEMINI_API_KEY;
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    console.warn('[GEMINI] Failed to delete temp file:', err.message);
  }
};

/**
 * Run liveness check using File API (immune to image size)
 */
export const checkLivenessWithFile = async (reqId, buffer, isEnrollment = false) => {
  const API_KEY = process.env.GEMINI_API_KEY;
  const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!API_KEY) throw new Error('GEMINI_API_KEY missing');

  let fileUri = null;
  let fileName = null;

  try {
    // 1. Upload to Gemini File API (~200-500ms)
    const upload = await uploadToGeminiFile(buffer, 'image/jpeg', isEnrollment ? 'enrollment' : 'scan');
    fileUri = upload.uri;
    fileName = upload.name;

    // 2. Run analysis
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL });

    const prompt = `You are an enterprise-grade biometric anti-spoofing forensic AI. Perform a 7-point liveness analysis:

1. DEPTH: Natural 3D depth vs flat 2D surface
2. SCREEN: LCD/OLED pixels, moire, bezels
3. PRINT: Paper texture, ink dots, creases
4. SKIN: Pores, micro-textures, subsurface scattering
5. EYES: Specular highlights, moisture, iris detail
6. LIGHTING: Face lighting matches environment
7. MASK: Unnatural edges, seams, rigid surfaces

${isEnrollment ? 'Be STRICT during enrollment. When in doubt, reject.' : ''}
Reply with ONLY valid JSON: {"is_real_person": true/false, "confidence": 0.0-1.0, "reason": "<brief forensic summary>"}`;

    const result = await model.generateContent([
      prompt,
      { fileData: { mimeType: 'image/jpeg', fileUri } }
    ]);

    const text = result.response.text().trim();
    
    // Parse JSON
    let analysis;
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      const looksReal = /real|genuine|live|actual person|not a spoof/i.test(text);
      analysis = { is_real_person: looksReal, confidence: looksReal ? 0.7 : 0.3, reason: text.substring(0, 150) };
    }

    const minConf = isEnrollment ? 0.60 : 0.55;
    const passed = analysis.is_real_person === true && (analysis.confidence ?? 0) >= minConf;

    return {
      passed,
      confidence: analysis.confidence ?? 0,
      reason: analysis.reason || 'No reason provided',
      raw: analysis,
    };

  } finally {
    // 3. Always cleanup the temp file
    if (fileName) await deleteGeminiFile(fileName);
  }
};
