import { Worker } from 'node:worker_threads';

// Optional parser: a missing package never prevents startup or the vision fallback.
let parserAvailable;
let activeWorkers = 0;
export async function extractDocumentPdfText(buffer, { signal } = {}) {
    signal?.throwIfAborted();
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 10 * 1024 * 1024 || activeWorkers >= 2) return null;
    parserAvailable ??= (() => { try { import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'); return true; } catch { return false; } })();
    if (!parserAvailable) return null;
    activeWorkers++;
    return new Promise((resolve, reject) => {
        let worker;
        try {
            worker = new Worker(new URL('./documentPdfWorker.js', import.meta.url), {
                workerData: new Uint8Array(buffer), resourceLimits: { maxOldGenerationSizeMb: 96 },
                execArgv: process.execArgv.filter(arg => arg.startsWith('--preserve-symlinks')),
            });
        } catch { activeWorkers--; resolve(null); return; }
        let settled = false;
        const finish = (error, result = null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            void worker.terminate().catch(() => {}).finally(() => {
                activeWorkers--;
                if (error) reject(error); else resolve(result);
            });
        };
        const abort = () => finish(signal.reason);
        const timer = setTimeout(() => finish(null), 2000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.once('message', result => finish(null, result));
        worker.once('error', () => finish(null));
        worker.once('exit', () => finish(null));
        if (signal?.aborted) abort();
    });
}
