import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Fetch wrapper that attaches Supabase auth token
 * and handles 401 session expiration redirects.
 */
export const fetchWithAuth = async (endpoint, options = {}) => {
    try {
        // 1. Get the current active session token from Supabase
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        // 2. Prepare headers with the injected token
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // 3. Ensure the URL is correctly formatted
        const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

        // 4. Execute the network request
        const response = await fetch(url, { ...options, headers });

        // 5. Global Error Handling for Unauthorized access
        if (response.status === 401) {
            console.error('[API_INTERCEPTOR] 401 Unauthorized. Session expired or missing token.');
            await supabase.auth.signOut();
            localStorage.removeItem('user');
            
            // Only redirect if not already on the login page
            if (window.location.pathname !== '/login') {
                toast.error('Session expired. Please log in again.');
                window.location.href = '/login';
            }
            throw new Error('Unauthorized');
        }

        return response;
    } catch (error) {
        console.error('[API_INTERCEPTOR] Network Request Failed:', error);
        throw error;
    }
};
