export function documentImageDimensions(width, height, maxDimension = 1600) {
    if (![width, height, maxDimension].every(value => Number.isFinite(value) && value > 0) || width * height > 48000000) throw new Error('Image dimensions exceed the preview limit.');
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Analysis uses a smaller copy; the confirmed vault upload retains the original.
export async function compressDocumentImage(file, maxDimension = 1600, quality = 0.82) {
    if (!/^image\/(?:jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const { width, height } = documentImageDimensions(bitmap.width, bitmap.height, maxDimension);
        if (width === bitmap.width && height === bitmap.height && file.size <= 280000) return file;
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff'; // Flatten transparent scans onto paper, not a black background.
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        let best = file;
        for (const level of [quality, 0.72, 0.62]) {
            const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality: level }) : await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', level));
            if (blob?.size && blob.size < best.size) best = blob;
            if (best.size < 300000) break;
        }
        // Keep legibility instead of endlessly lowering quality to hit a byte target.
        return best === file ? file : new File([best], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
    } catch {
        return file;
    } finally { bitmap?.close(); }
}

