import { fork } from 'node:child_process';

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
            // Native PDF faults must end only the parser, never the backend process.
            worker = fork(new URL('./documentPdfWorker.js', import.meta.url), [], {
                windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
                execArgv: ['--max-old-space-size=96', ...process.execArgv.filter(arg => arg.startsWith('--preserve-symlinks'))],
            });
        } catch { activeWorkers--; resolve(null); return; }
        let settled = false, failure, output = null;
        const finish = (error, result = null) => {
            if (settled) return;
            settled = true;
            failure = error;
            output = result;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            worker.kill();
        };
        const abort = () => finish(signal.reason);
        const timer = setTimeout(() => finish(null), 2000);
        signal?.addEventListener('abort', abort, { once: true });
        worker.once('message', result => finish(null, result));
        worker.once('error', () => finish(null));
        worker.once('close', () => {
            finish(null);
            activeWorkers--;
            if (failure) reject(failure); else resolve(output);
        });
        worker.send(new Uint8Array(buffer), error => { if (error) finish(null); });
        if (signal?.aborted) abort();
    });
}
