export const compressImage = (dataUrl, options = {}) => {
  return new Promise((resolve, reject) => {
    const { maxWidth = 640, maxHeight = 640, quality = 0.75 } = options;
    const img = new Image();
    
    img.onload = () => {
      let { width, height } = img;
      const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      // Fill black first to prevent alpha bloat
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const out = canvas.toDataURL('image/jpeg', quality);
      
      const before = Math.round((dataUrl.length * 0.75) / 1024);
      const after = Math.round((out.length * 0.75) / 1024);
      console.log(`[COMPRESS] ${before}KB → ${after}KB (${Math.round((1 - after/before)*100)}% saved)`);
      
      resolve(out);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};
