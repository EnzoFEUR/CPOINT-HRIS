import { createContext, useContext } from 'react';

export const ConfirmContext = createContext(null);

/**
 * Enterprise confirmation dialog hook.
 * Returns an async function `confirm(options)` that resolves to `true` (confirmed) or `false` (cancelled).
 */
export function useConfirm() {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used within a <ConfirmProvider>');
    }
    return context;
}
