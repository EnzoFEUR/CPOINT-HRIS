import client from 'prom-client';
import { register } from './telemetry.js';

const tasks = new Set(['summary', 'document', 'biometric_enrollment', 'biometric_attendance']);
const prices = { 'gemini-3.5-flash-lite': [.30, 2.50], 'gemini-3.1-flash-lite': [.25, 1.50], 'gemini-2.5-flash': [.30, 2.50] };
const knownModels = new Set([...Object.keys(prices), 'gemini-3.8-flash', 'gemini-flash-lite-latest']);
const requests = new client.Counter({ name: 'hris_ai_requests_total', help: 'AI provider attempts; excludes local/cache results', labelNames: ['task', 'model', 'status'], registers: [register] });
const tokens = new client.Counter({ name: 'hris_ai_tokens_total', help: 'Provider token counts; input includes cached and output includes thinking, so kinds must not be summed', labelNames: ['task', 'model', 'kind'], registers: [register] });
const latency = new client.Histogram({ name: 'hris_ai_request_duration_seconds', help: 'AI provider attempt duration', labelNames: ['task', 'model'], buckets: [.1, .25, .5, 1, 2, 4, 8, 15, 30], registers: [register] });
const cost = new client.Counter({ name: 'hris_ai_estimated_cost_usd_total', help: 'Estimated standard token charges using dated public prices; excludes unknown models, tools, tax and unavailable usage', labelNames: ['task', 'model'], registers: [register] });

export function estimateAiCost({ model, inputTokens, outputTokens, cachedTokens = 0, at = Date.now() }) {
    const rates = model === 'gemini-3.8-flash' ? (at < Date.UTC(2027, 0, 1) ? [.75, 3.75] : [1.50, 7.50]) : prices[model];
    if (!rates) return null;
    return ((inputTokens - cachedTokens) * rates[0] + cachedTokens * rates[0] * .1 + outputTokens * rates[1]) / 1e6;
}
export function recordAiUsage(event) {
    const labels = { task: tasks.has(event.task) ? event.task : 'other', model: knownModels.has(event.model) ? event.model : 'other' };
    requests.inc({ ...labels, status: event.status === 'success' ? 'success' : 'error' });
    latency.observe(labels, event.latencyMs / 1000);
    if (!event.usageAvailable) return;
    for (const [kind, value] of Object.entries({ input: event.inputTokens, output: event.outputTokens, thinking: event.thinkingTokens, cached: event.cachedTokens })) tokens.inc({ ...labels, kind }, value);
    const estimated = estimateAiCost(event);
    if (estimated !== null) cost.inc(labels, estimated);
}
