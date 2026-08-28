import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          
          if (
            normalizedId.includes('/src/utils/') || 
            normalizedId.includes('/src/supabaseClient')
          ) {
            return 'app-shared';
          }

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
            if (normalizedId.includes('flatpickr') || normalizedId.includes('sweetalert2')) {
              return 'vendor-ui-heavy';
            }
            if (normalizedId.includes('@tabler/icons-react') || normalizedId.includes('lucide-react')) {
              return 'vendor-icons';
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
