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
          // Normalize Windows and POSIX path separators
          const normalizedId = id.replace(/\\/g, '/');
          
          // Shared Application Utilities & Infrastructure (Prevents circular imports from entry)
          if (
            normalizedId.includes('/src/utils/') || 
            normalizedId.includes('/src/supabaseClient') || 
            normalizedId.includes('/src/components/')
          ) {
            return 'app-shared';
          }

          // Isolated Vendor Dependencies
          if (normalizedId.includes('node_modules')) {
            if (normalizedId.includes('face-api.js')) {
              return 'vendor-faceapi';
            }
            if (normalizedId.includes('html5-qrcode')) {
              return 'vendor-scanner';
            }
            if (normalizedId.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (normalizedId.includes('framer-motion')) {
              return 'vendor-motion';
            }
            if (normalizedId.includes('@tanstack/react-query')) {
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
