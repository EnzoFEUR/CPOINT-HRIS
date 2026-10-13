import { parentPort, workerData } from 'node:worker_threads';

let parser;
try {
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: workerData, isEvalSupported: false, useSystemFonts: false });
    const info = await parser.getInfo();
    if (info.total !== 1) parentPort.postMessage(null);
    else {
        const result = await parser.getText({ partial: [1] });
        parentPort.postMessage(result.text.length <= 64000 ? { pages: info.total, text: result.text } : null);
    }
} catch {
    parentPort.postMessage(null);
} finally {
    await parser?.destroy();
}
