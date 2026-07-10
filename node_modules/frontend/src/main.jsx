import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { supabase } from './supabaseClient'

// Intercept all fetch requests to automatically reroute to the Cloud API and inject JWT
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const originalFetch = window.fetch;

window.fetch = async (...args) => {
    let [resource, config] = args;
    
    if (typeof resource === 'string' && resource.includes('http://localhost:5000')) {
        // Dynamically reroute to cloud/local API
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
    <App />
  </StrictMode>,
)
