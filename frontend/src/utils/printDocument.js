import printStylesUrl from './printDocument.css?url&no-inline';

/**
 * Universal Isolated Print Engine for C-Point HRIS
 * 
 * Clones the targeted printable document into an isolated hidden iframe
 * with dedicated A4 page styles and desktop corporate letterhead rules.
 * 
 * Completely eliminates:
 * - Parent container overflow clipping and truncation
 * - Modal backdrop / dashboard background bleed-through
 * - Viewport responsive squishing (ensures pristine A4 vector export on mobile & desktop)
 */
export function printHtmlElement(elementId, documentTitle = 'Official_Document') {
    const element = document.getElementById(elementId);
    if (!element) {
        window.print();
        return;
    }

    // Clean up any pre-existing print iframe
    const existingIframe = document.getElementById('cpoint-print-sandbox');
    if (existingIframe) {
        existingIframe.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'cpoint-print-sandbox';
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '1024px'; // Ensure desktop canvas inside sandbox
    iframe.style.height = '1000px';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;

    // Collect all stylesheets and font definitions from host document
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=1024, initial-scale=1.0">
            <title></title>
        </head>
        <body>
        </body>
        </html>
    `;

    doc.open();
    doc.write(htmlContent);
    doc.close();
    doc.title = documentTitle;

    // Clone DOM rather than reparsing serialized style attributes or interpolating document titles as HTML.
    const assetPromises = [];
    const printStyle = document.createElement('link');
    printStyle.rel = 'stylesheet';
    printStyle.href = printStylesUrl;
    for (const node of [...styles, printStyle]) {
        const clone = doc.importNode(node, true);
        if (node.nonce) clone.nonce = node.nonce;
        if (clone.tagName === 'LINK') {
            assetPromises.push(new Promise((resolve, reject) => {
                const finish = (error) => { clearTimeout(timeout); error ? reject(new Error('Print stylesheet unavailable.')) : resolve(); };
                const timeout = setTimeout(() => finish(true), 8000);
                clone.onload = () => finish(false);
                clone.onerror = () => finish(true);
            }));
        }
        doc.head.appendChild(clone);
    }
    doc.body.appendChild(doc.importNode(element, true));

    // Wait for all assets (logos, images) to settle before triggering print
    const images = Array.from(doc.images);
    assetPromises.push(...images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    }));

    Promise.allSettled(assetPromises).then(results => {
        setTimeout(() => {
            try {
                if (results.some(result => result.status === 'rejected')) throw new Error('Print stylesheet unavailable.');
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (err) {
                console.warn('Iframe print delegation failed, falling back to window.print():', err);
                const originalTitle = document.title;
                document.title = documentTitle;
                window.print();
                setTimeout(() => {
                    document.title = originalTitle;
                }, 1500);
            } finally {
                setTimeout(() => {
                    if (iframe && iframe.parentNode) {
                        iframe.remove();
                    }
                }, 5000);
            }
        }, 120);
    });
}
