import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { env as runtimeEnv } from 'node:process';
import react from '@vitejs/plugin-react';
import { offlineAssetManifest } from './offlineAssets.js';
import { frontendSecurityHeaders } from '../shared/securityPolicy.mjs';
import { DEV_NONCE_PLACEHOLDER, createBackendProxy, frontendHttpSecurity } from './devSecurity.mjs';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const allowedFsPaths = [frontendRoot, fileURLToPath(new URL('../shared', import.meta.url)), fileURLToPath(new URL('../node_modules', import.meta.url))];

const securityHeadersFor = mode => {
  const env = loadEnv(mode, frontendRoot, 'VITE_');
  return frontendSecurityHeaders({ apiUrl: env.VITE_API_URL, supabaseUrl: env.VITE_SUPABASE_URL, modelUrl: env.VITE_MODEL_URL, development: mode === 'development', nonce: mode === 'development' ? DEV_NONCE_PLACEHOLDER : undefined });
};

export default defineConfig(({ mode }) => ({
  plugins: [frontendHttpSecurity(securityHeadersFor(mode), { development: mode === 'development', allowedFsPaths }), react(), offlineAssetManifest({ enabled: loadEnv(mode, frontendRoot, 'VITE_').VITE_ENABLE_OFFLINE_ATTENDANCE === 'true' })],
  html: { cspNonce: mode === 'development' ? DEV_NONCE_PLACEHOLDER : undefined },
  resolve: { alias: [{ find: /^react-hot-toast$/, replacement: 'react-hot-toast/headless' }] },
  define: { 'import.meta.env.VERCEL_DEPLOYMENT': JSON.stringify(runtimeEnv.VERCEL === '1') },
  server: {
    fs: { allow: allowedFsPaths },
    proxy: {
      '/api': createBackendProxy(loadEnv(mode, frontendRoot, 'VITE_').VITE_API_URL),
    },
  },
  preview: { headers: securityHeadersFor(mode) },
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
            if (normalizedId.includes('@dropdowns/psgc')) {
              return 'vendor-psgc';
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
