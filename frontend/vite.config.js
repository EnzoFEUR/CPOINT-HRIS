import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Enterprise Vite Build Configuration
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('face-api.js')) {
              return 'vendor-faceapi';
            }
            if (id.includes('html5-qrcode')) {
              return 'vendor-scanner';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'vendor-query';
            }
            return 'vendor-core';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      'react', 
      'react-dom', 
      'react-router-dom', 
      '@tanstack/react-query', 
      'framer-motion', 
      '@supabase/supabase-js'
    ],
  },
});
