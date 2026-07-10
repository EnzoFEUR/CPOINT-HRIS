import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { supabase } from './supabaseClient'

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
    <QueryClientProvider client={queryClient}>
        <App />
    </QueryClientProvider>
  </StrictMode>,
)
