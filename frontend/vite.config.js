import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', // Change 8000 to your backend server port
        changeOrigin: true,
        secure: false,
      },
    },
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/src/supabaseClient')) {
            return 'app-supabase';
          }

          if (normalizedId.includes('node_modules')) {
            if (
              normalizedId.includes('/react/') ||
              normalizedId.includes('/react-dom/') ||
              normalizedId.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            if (
              normalizedId.includes('/react-router/') ||
              normalizedId.includes('/react-router-dom/')
            ) {
              return 'vendor-router';
            }
            if (normalizedId.includes('/react-hot-toast/')) {
              return 'vendor-toast';
            }
            if (normalizedId.includes('face-api.js') || normalizedId.includes('@tensorflow')) {
              return 'vendor-faceapi';
            }
            if (normalizedId.includes('html5-qrcode')) {
              return 'vendor-scanner';
            }
            if (normalizedId.includes('jszip') || normalizedId.includes('file-saver')) {
              return 'vendor-export';
            }
            if (normalizedId.includes('qrcode') || normalizedId.includes('dijkstrajs')) {
              return 'vendor-qrcode';
            }
            if (normalizedId.includes('@supabase') || normalizedId.includes('iceberg-js')) {
              return 'vendor-supabase';
            }
            if (normalizedId.includes('@tanstack')) {
              return 'vendor-query';
            }
            if (normalizedId.includes('lucide-react') || normalizedId.includes('@tabler/icons-react')) {
              return 'vendor-icons';
            }
            if (normalizedId.includes('dayjs')) {
              return 'vendor-dayjs';
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
      '@supabase/supabase-js',
    ],
  },
}));
