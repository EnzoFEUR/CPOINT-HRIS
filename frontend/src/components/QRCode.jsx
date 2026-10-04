import React, { useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';
import logoIconDark from '../assets/logo-icon-dark.png';

// Cache for generated QR codes
const qrCache = new Map();

export default function QRCode({ 
  value = '', 
  size = 200, 
  fgColor = '#0f172a', 
  bgColor = '#ffffff', 
  level = 'H',
  margin = 2,
  showLogo = true,
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
      width: size * 2, // 2x supersampling for high optical scanner clarity
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

  // Optical golden ratio: 22% container occupies ~4.8% of QR area, safely preserving >25% error correction headroom
  const logoBoxSize = Math.max(24, Math.round(size * 0.22));
  const logoInnerSize = Math.max(16, Math.round(logoBoxSize * 0.76));

  return (
    <div 
      style={{ width: `${size}px`, height: `${size}px` }} 
      className={`inline-flex items-center justify-center relative select-none ${className}`}
    >
      {dataUrl ? (
        <>
          <img 
            src={dataUrl} 
            alt={`QR Code for ${value}`} 
            width={size} 
            height={size} 
            className="w-full h-full object-contain select-none" 
            style={{ width: `${size}px`, height: `${size}px` }}
          />
          {showLogo && (
            <div 
              className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
              aria-hidden="true"
            >
              <div 
                style={{ 
                  width: `${logoBoxSize}px`, 
                  height: `${logoBoxSize}px`,
                  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)'
                }}
                className="bg-white rounded-md flex items-center justify-center p-1 border border-slate-200/80"
              >
                <img 
                  src={logoIconDark} 
                  alt="C-Point" 
                  style={{ width: `${logoInnerSize}px`, height: `${logoInnerSize}px` }}
                  className="object-contain select-none"
                  loading="eager"
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300 rounded-md">
          <i className="ti ti-qrcode text-3xl" />
        </div>
      )}
    </div>
  );
}
