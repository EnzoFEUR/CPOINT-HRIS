import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { supabase } from './supabaseClient.js'
import logoIcon from './assets/logo-icon.png'

// Resilient embedded SVG monogram for offline & crash recovery
const FALLBACK_LOGO_URI = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="14" fill="%230f172a"/><image href="data:image/png;base64,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" x="10.0" y="12.0" width="44" height="40"/></svg>';

// Error Boundary to eliminate mobile white screens and provide actionable recovery
class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RootErrorBoundary] Caught unhandled error:', error, errorInfo);
  }

  handleGoToLogin = () => {
    window.location.href = '/login';
  };

  handleHardReset = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) {
          await caches.delete(k);
        }
      }
    } catch (e) {
      console.warn('Cache clearing error:', e);
    }
    localStorage.removeItem('user');
    sessionStorage.clear();
    window.location.href = '/login';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#090d16',
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
            width: '60px',
            height: '60px',
            borderRadius: '16px',
            background: '#0f172a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.15)'
          }}>
            <img 
              src={logoIcon} 
              alt="C-Point" 
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = FALLBACK_LOGO_URI;
              }}
              style={{ width: '38px', height: '38px', objectFit: 'contain' }} 
            />
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.02em' }}>C-Point HRIS</h1>
          <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '320px', marginBottom: '28px', lineHeight: '1.5' }}>
            The session was refreshed. Tap below to navigate safely to the portal.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '280px' }}>
            <button
              onClick={this.handleGoToLogin}
              style={{
                padding: '14px 24px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '14px',
                fontWeight: '700',
                fontSize: '15px',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4)',
                transition: 'transform 0.15s ease'
              }}
            >
              Sign In to HRIS
            </button>
            
            <button
              onClick={this.handleHardReset}
              style={{
                padding: '12px 24px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '14px',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              Clear Cache & Reset
            </button>
          </div>

          {this.state.error && (
            <div style={{ marginTop: '32px', maxWidth: '340px' }}>
              <button
                onClick={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                {this.state.showDetails ? 'Hide Diagnostics' : 'Show Diagnostics'}
              </button>
              {this.state.showDetails && (
                <pre style={{
                  marginTop: '8px',
                  padding: '12px',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  borderRadius: '8px',
                  color: '#f87171',
                  fontSize: '11px',
                  textAlign: 'left',
                  overflowX: 'auto',
                  border: '1px solid rgba(239, 68, 68, 0.2)'
                }}>
                  {this.state.error.toString()}
                </pre>
              )}
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// Configure React Query
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

// Register Service Worker with background update checking
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        // Auto-check for updates on load
        registration.update().catch(() => {});

        // Auto-check for updates whenever user returns to the tab / app
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {});
          }
        });
      })
      .catch((error) => {
        console.warn('[PWA] Service Worker registration note:', error);
      });

    // Handle service worker updates
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] Upgraded to newest Service Worker version.');
      }
    });
  });
}
