import { parentPort, workerData } from 'node:worker_threads';

let document;
let result = null;
try {
    const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    document = await getDocument({ data: workerData, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
    if (document.numPages === 1) {
        const page = await document.getPage(1);
        const operators = await page.getOperatorList();
        // Only simple black text: images, hidden text, overlays, clipping and transparency need vision.
        const allowed = new Set(['dependency', 'beginText', 'endText', 'setFont', 'setTextMatrix', 'moveText',
            'setLeading', 'setLeadingMoveText', 'nextLine', 'showText', 'showSpacedText', 'nextLineShowText',
            'setCharSpacing', 'setWordSpacing', 'setHScale', 'setTextRise', 'save', 'restore'].map(name => OPS[name]));
        if (operators.fnArray.every(code => allowed.has(code))) {
            const content = await page.getTextContent();
            const items = content.items.filter(item => typeof item.str === 'string');
            const [, , width, height] = page.view;
            const visible = items.filter(item => item.str.trim()).every(item => {
                const [a, b, c, d, x, y] = item.transform;
                return [a,b,c,d,x,y,item.width,item.height].every(Number.isFinite) && a > 0 && d > 0 && b === 0 && c === 0 &&
                    x >= 0 && y >= 0 && x + item.width <= width && y + item.height <= height;
            });
            const text = items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
            result = visible && text.length <= 64000 ? { pages: 1, text } : null;
        }
    }
} catch {
    result = null;
} finally {
    try { await document?.destroy(); } catch { result = null; }
}
// Complete PDF cleanup before the parent is allowed to terminate this worker.
parentPort.postMessage(result);
