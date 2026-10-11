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
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map(node => node.outerHTML)
        .join('\n');

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=1024, initial-scale=1.0">
            <title>${documentTitle}</title>
            ${styles}
            <style>
                @page {
                    size: A4 portrait;
                    margin: 8mm 10mm 8mm 10mm;
                }

                *, *::before, *::after {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    box-sizing: border-box !important;
                }

                html, body {
                    background: #ffffff !important;
                    color: #0f172a !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    height: auto !important;
                    min-height: auto !important;
                    overflow: visible !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                    font-size: 11px !important;
                    line-height: 1.4 !important;
                }

                .no-print,
                .print\\:hidden,
                [data-print-hide],
                .payslip-screen-actions,
                .payslip-modal-backdrop {
                    display: none !important;
                }

                #official-payslip-document,
                #official-remuneration-history-document {
                    display: block !important;
                    position: static !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    height: auto !important;
                    max-height: none !important;
                    overflow: visible !important;
                    border: 1px solid #0f172a !important;
                    box-shadow: none !important;
                    border-radius: 0 !important;
                    background: #ffffff !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }

                /* Enforce desktop corporate 2-column letterhead format regardless of caller viewport */
                .payslip-header-layout {
                    display: flex !important;
                    flex-direction: row !important;
                    justify-content: space-between !important;
                    align-items: flex-start !important;
                    padding: 16px 20px !important;
                    border-bottom: 2px solid #0f172a !important;
                }

                .payslip-telemetry-strip {
                    display: grid !important;
                    grid-template-columns: repeat(4, 1fr) !important;
                    background: #f8fafc !important;
                    border-bottom: 1px solid #cbd5e1 !important;
                }

                .payslip-telemetry-col {
                    border-right: 1px solid #cbd5e1 !important;
                    border-bottom: none !important;
                    padding: 8px 14px !important;
                }

                .payslip-telemetry-col:last-child {
                    border-right: none !important;
                }

                .payslip-employee-grid {
                    display: grid !important;
                    grid-template-columns: 1fr 1fr !important;
                    padding: 14px 20px !important;
                    border-bottom: 1px solid #cbd5e1 !important;
                    gap: 24px !important;
                }

                .payslip-employee-statutory-col {
                    border-top: none !important;
                    border-left: 1px solid #cbd5e1 !important;
                    padding-top: 0 !important;
                    padding-left: 20px !important;
                }

                .payslip-ledger-grid {
                    display: grid !important;
                    grid-template-columns: 1fr 1fr !important;
                    border: 1px solid #cbd5e1 !important;
                    gap: 0 !important;
                }

                .payslip-ledger-earnings {
                    border-right: 1px solid #cbd5e1 !important;
                    border-bottom: none !important;
                }

                .payslip-net-strip {
                    display: flex !important;
                    flex-direction: row !important;
                    justify-content: space-between !important;
                    align-items: center !important;
                    background: #f8fafc !important;
                    color: #0f172a !important;
                    border: 2px solid #0f172a !important;
                    padding: 12px 18px !important;
                    margin-top: 14px !important;
                    border-radius: 4px !important;
                }

                .payslip-net-title {
                    color: #475569 !important;
                }

                .payslip-net-amount {
                    color: #0f172a !important;
                }

                .payslip-print-watermark {
                    display: block !important;
                }
            </style>
        </head>
        <body>
            ${element.outerHTML}
        </body>
        </html>
    `;

    doc.open();
    doc.write(htmlContent);
    doc.close();

    // Wait for all assets (logos, images) to settle before triggering print
    const images = Array.from(doc.images);
    const assetPromises = images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
        });
    });

    Promise.all(assetPromises).then(() => {
        setTimeout(() => {
            try {
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
