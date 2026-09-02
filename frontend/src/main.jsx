import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { supabase } from './supabaseClient.js'

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
            borderRadius: '18px',
            background: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            fontWeight: '900',
            marginBottom: '20px',
            boxShadow: '0 12px 30px rgba(37, 99, 235, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.15)'
          }}>
            CP
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

    // Seamlessly swap to new service worker controller without jarring reloads
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] Upgraded to newest Service Worker version.');
      }
    });
  });
}
