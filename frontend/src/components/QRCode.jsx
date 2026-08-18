import React, { useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';

export default function QRCode({ 
  value = '', 
  size = 180, 
  fgColor = '#1e293b', 
  bgColor = '#ffffff', 
  className = '' 
}) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let isMounted = true;
    if (!value) {
      setDataUrl('');
      return;
    }

    QRCodeLib.toDataURL(String(value), {
      width: size,
      margin: 1,
      color: {
        dark: fgColor,
        light: bgColor,
      },
      errorCorrectionLevel: 'M'
    })
      .then(url => {
        if (isMounted) setDataUrl(url);
      })
      .catch(err => {
        console.error('QR code generation failed:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [value, size, fgColor, bgColor]);

  if (!dataUrl) {
    return (
      <div 
        style={{ width: `${size}px`, height: `${size}px` }} 
        className={`flex items-center justify-center bg-slate-50 text-slate-300 rounded-xl ${className}`}
      >
        <i className="ti ti-qrcode text-3xl animate-pulse" />
      </div>
    );
  }

  return (
    <img 
      src={dataUrl} 
      alt={`QR Code for ${value}`} 
      width={size} 
      height={size} 
      className={`inline-block select-none ${className}`} 
      style={{ width: `${size}px`, height: `${size}px`, maxWidth: '100%' }}
    />
  );
}
