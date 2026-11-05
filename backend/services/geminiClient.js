import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { recordAiUsage } from '../utils/aiTelemetry.js';

let client, clientKey;
function getClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw Object.assign(new Error('AI service is not configured.'), { code: 'AI_UNCONFIGURED' });
    if (!client || clientKey !== apiKey) {
        client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
        clientKey = apiKey;
    }
    return client;
}

export function generationSettings(model, task, mimeType) {
    const config = { maxOutputTokens: task === 'summary' ? 1024 : 2048, automaticContinuation: false };
    if (/^gemini-3\.[15]-flash-lite/.test(model)) config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
    else if (/^gemini-[34]/.test(model)) config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    else if (/^gemini-2\.5-flash/.test(model)) config.thinkingConfig = { thinkingBudget: 0 };
    if (mimeType) config.mediaResolution = mimeType === 'application/pdf' ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_HIGH';
    return config;
}

const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const providerStatus = error => Number.isInteger(error?.status) ? error.status : undefined;
const safeError = (code, status) => Object.assign(new Error(status ? `AI service request failed (${status}).` : 'AI service request could not complete.'), { code, status });

// One deadline and at most one fallback, including calls whose provider ignores cancellation.
export function createGeminiGenerator({ getClient: loadClient = getClient, observe = recordAiUsage, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    return async function generate({ models, task = 'summary', contents, config = {}, timeoutMs = 12000, signal, mimeType }) {
        signal?.throwIfAborted();
        const candidates = [...new Set(models.filter(Boolean))].slice(0, 2);
        if (!candidates.length) throw safeError('AI_UNCONFIGURED');
        const duration = Math.min(30000, Math.max(1, Number(timeoutMs) || 12000));
        const expires = now() + duration;
        const controller = new AbortController();
        const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        const timer = setTimer(() => controller.abort(safeError('AI_TIMEOUT')), duration);
        let rejectAbort;
        const aborted = new Promise((_, reject) => { rejectAbort = () => reject(signal?.aborted ? signal.reason : controller.signal.reason); });
        combined.addEventListener('abort', rejectAbort, { once: true });
        try {
            for (let index = 0; index < candidates.length; index++) {
                combined.throwIfAborted();
                const model = candidates[index], started = now();
                let usage;
                try {
                    const settings = { ...generationSettings(model, task, mimeType), ...config,
                        maxOutputTokens: Math.min(4096, Math.max(128, config.maxOutputTokens || generationSettings(model, task).maxOutputTokens)),
                        automaticContinuation: false, abortSignal: combined,
                        httpOptions: { timeout: Math.max(1, expires - now()), retryOptions: { attempts: 1 } } };
                    const result = await Promise.race([loadClient().models.generateContent({ model, contents, config: settings }), aborted]);
                    combined.throwIfAborted();
                    usage = result.usageMetadata;
                    const reason = result.candidates?.[0]?.finishReason;
                    if (result.promptFeedback?.blockReason || reason && reason !== 'STOP' || typeof result.text !== 'string' || !result.text.trim()) throw safeError('AI_INVALID_RESPONSE');
                    report('success');
                    return result.text;
                } catch (error) {
                    report('error');
                    if (combined.aborted) throw signal?.aborted ? signal.reason : controller.signal.reason;
                    const status = providerStatus(error);
                    if (index + 1 < candidates.length && [404, 500, 502, 503, 504].includes(status)) continue;
                    throw safeError(error.code === 'AI_INVALID_RESPONSE' || error.code === 'AI_UNCONFIGURED' ? error.code : 'AI_PROVIDER_ERROR', status);
                }
                function report(status) {
                    const inputTokens = tokenCount(usage?.promptTokenCount);
                    try { observe({ task, model, status, latencyMs: Math.max(0, now() - started), inputTokens,
                        outputTokens: tokenCount(usage?.candidatesTokenCount) + tokenCount(usage?.thoughtsTokenCount),
                        thinkingTokens: tokenCount(usage?.thoughtsTokenCount), cachedTokens: Math.min(inputTokens, tokenCount(usage?.cachedContentTokenCount)),
                        usageAvailable: Boolean(usage), at: now() }); } catch { /* Metrics must not change authorization or document outcomes. */ }
                }
            }
        } finally {
            clearTimer(timer);
            combined.removeEventListener('abort', rejectAbort);
        }
    };
}

export const generateGemini = createGeminiGenerator();
