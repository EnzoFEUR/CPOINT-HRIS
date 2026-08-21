import React, { useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';

// Module-level memoization cache for instant, zero-flicker synchronous renders
const qrCache = new Map();

export default function QRCode({ 
  value = '', 
  size = 200, 
  fgColor = '#0f172a', 
  bgColor = '#ffffff', 
  level = 'H',
  margin = 2,
  className = '' 
}) {
  const cacheKey = `${value}_${size}_${fgColor}_${bgColor}_${level}_${margin}`;
  const [dataUrl, setDataUrl] = useState(() => qrCache.get(cacheKey) || '');

  useEffect(() => {
    let isMounted = true;
    if (!value) {
      setDataUrl('');
      return;
    }

    if (qrCache.has(cacheKey)) {
      setDataUrl(qrCache.get(cacheKey));
      return;
    }

    QRCodeLib.toDataURL(String(value), {
      width: size * 2, // 2x retina supersampling for ultra-crisp optical edge detection
      margin: margin,
      color: {
        dark: fgColor,
        light: bgColor,
      },
      errorCorrectionLevel: level || 'H'
    })
      .then(url => {
        qrCache.set(cacheKey, url);
        if (isMounted) setDataUrl(url);
      })
      .catch(err => {
        console.error('QR code generation failed:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [value, size, fgColor, bgColor, level, margin, cacheKey]);

  return (
    <div 
      style={{ width: `${size}px`, height: `${size}px` }} 
      className={`inline-flex items-center justify-center relative select-none ${className}`}
    >
      {dataUrl ? (
        <img 
          src={dataUrl} 
          alt={`QR Code for ${value}`} 
          width={size} 
          height={size} 
          className="w-full h-full object-contain select-none will-change-transform" 
          style={{ width: `${size}px`, height: `${size}px` }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300 rounded-xl">
          <i className="ti ti-qrcode text-3xl animate-pulse" />
        </div>
      )}
    </div>
  );
}
