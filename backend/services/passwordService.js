import { supabase, createIsolatedAuthClient } from '../supabaseClient.js';

export async function closePasswordSession(client, scope = 'local') {
    try {
        const { error } = await client.auth.signOut({ scope });
        if (error) throw error;
        return true;
    } catch (error) {
        console.warn('[PASSWORD_SESSION_CLEANUP]', { code: error?.code || 'UNAVAILABLE' });
        return false;
    }
}

// Supabase's user update checks the current password; admin password overrides do not.
export async function resetVerifiedPassword({ authUserId, email, password }, admin = supabase, createSessionClient = createIsolatedAuthClient) {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    if (linkError) throw linkError;
    if (link?.user?.id !== authUserId || !link?.properties?.hashed_token) {
        throw Object.assign(new Error('Recovery account could not be verified.'), { code: 'RESET_IDENTITY_MISMATCH' });
    }

    const client = createSessionClient();
    let hasSession = false;
    let updated = false;
    let sessionsInvalidated = false;
    try {
        const { data, error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'recovery' });
        hasSession = Boolean(data?.session?.access_token);
        if (error) throw error;
        if (!hasSession || data?.user?.id !== authUserId) {
            throw Object.assign(new Error('Recovery account could not be verified.'), { code: 'RESET_IDENTITY_MISMATCH' });
        }
        const { error: updateError } = await client.auth.updateUser({ password });
        if (updateError) throw updateError;
        updated = true;
    } finally {
        if (hasSession) sessionsInvalidated = await closePasswordSession(client, updated ? 'global' : 'local');
    }
    return { sessionsInvalidated };
}
