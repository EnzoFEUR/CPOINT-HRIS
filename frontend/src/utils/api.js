import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';
import { API_BASE_URL } from './apiBaseUrl.mjs';
import { revokeBrowserPush } from './devicePush.mjs';

export { API_BASE_URL };

/**
 * Fetch wrapper that attaches Supabase auth token
 * and handles 401 session expiration redirects.
 */
export const fetchWithAuth = async (endpoint, options = {}) => {
    try {
        options.signal?.throwIfAborted();
        // 1. Get the current active session token from Supabase
        const { data: { session } } = await supabase.auth.getSession();
        options.signal?.throwIfAborted();
        const token = session?.access_token;

        // 2. Prepare headers with injected token & conditional Content-Type
        const headers = new Headers(options.headers);

        // Do NOT set Content-Type to application/json if sending FormData
        if (!(options.body instanceof FormData)) {
            headers.set('Content-Type', 'application/json');
        }

        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }

        const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

        const response = await fetch(url, {
            cache: 'no-cache',
            ...options,
            headers
        });

        // 5. Global Error Handling for Unauthorized access
        if (response.status === 401) {
            console.error('[API_INTERCEPTOR] 401 Unauthorized. Session expired or missing token.');
            try { await revokeBrowserPush(); } catch { /* Session cleanup must still finish if device APIs fail. */ }
            try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Continue local cleanup if sign-out fails. */ }
            localStorage.removeItem('user');
            try {
                Object.keys(sessionStorage).forEach((key) => {
                    if (key.startsWith('cpoint_') || key.includes('profile') || key.includes('auth')) {
                        sessionStorage.removeItem(key);
                    }
                });
            } catch { /* Storage restrictions must not prevent the login redirect. */ }
            
            // Only redirect if not already on the login page
            if (window.location.pathname !== '/login') {
                toast.error('Session expired. Please log in again.');
                window.location.replace('/login');
            }
            throw new Error('Unauthorized');
        }

        // 6. Global Error Handling for Mandatory Password Change & Tamper Protection
        if (response.status === 403) {
            try {
                const cloned = response.clone();
                const errData = await cloned.json();
                if (errData?.code === 'SECOND_FACTOR_REQUIRED') {
                    try { await revokeBrowserPush(); } catch { /* Keep the sign-in redirect available. */ }
                    localStorage.removeItem('user');
                    sessionStorage.removeItem('cpoint_login_2fa_session');
                    if (window.location.pathname !== '/login') {
                        toast.error('Please complete sign-in verification.');
                        window.location.replace('/login');
                    }
                }
                if (errData?.code === 'PASSWORD_CHANGE_REQUIRED') {
                    const stored = localStorage.getItem('user');
                    if (stored) {
                        const currentUser = JSON.parse(stored);
                        currentUser.requires_password_change = true;
                        localStorage.setItem('user', JSON.stringify(currentUser));
                    }
                    if (window.location.pathname !== '/force-password-change') {
                        toast.error('Password change required.');
                        window.location.replace('/force-password-change');
                    }
                }
            } catch {
                // Continue if response body is non-JSON
            }
        }

        return response;
    } catch (error) {
        // Superseded queries and unmounted views cancel requests intentionally.
        if (error?.name === 'AbortError' || (options.signal?.aborted && error === options.signal.reason)) {
            throw error;
        }
        console.error('[API_INTERCEPTOR] Network Request Failed:', error);
        throw error;
    }
};
