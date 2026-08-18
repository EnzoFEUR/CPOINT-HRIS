import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { supabase } from './supabaseClient'

// Error Boundary to eliminate mobile white screens
class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RootErrorBoundary] Caught unhandled error:', error, errorInfo);
  }

  handleReload = () => {
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center'
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: '900',
            marginBottom: '20px',
            boxShadow: '0 10px 25px rgba(59, 130, 246, 0.4)'
          }}>
            CP
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: '800', marginBottom: '8px' }}>C-Point HRIS</h1>
          <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '300px', marginBottom: '24px' }}>
            A new version was updated. Tap below to reload fresh assets.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '12px 28px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
            }}
          >
            Refresh App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Configure React Query to cache data for 5 minutes
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, 
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Intercept all fetch requests to automatically reroute to the Cloud API and inject JWT
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const originalFetch = window.fetch;

window.fetch = async (...args) => {
    let [resource, config] = args;
    
    if (typeof resource === 'string' && resource.includes('http://localhost:5000')) {
        resource = resource.replace('http://localhost:5000', API_URL);
        const { data: { session } } = await supabase.auth.getSession();
        config = config || {};
        config.headers = { ...config.headers };
        if (session?.access_token) {
            config.headers['Authorization'] = `Bearer ${session.access_token}`;
        }
    }
    return originalFetch(resource, config);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
          <App />
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

// Register Progressive Web App Service Worker with auto-update
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service Worker active with scope:', registration.scope);
        // Periodically check for updates
        registration.update();
      })
      .catch((error) => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  });
}
