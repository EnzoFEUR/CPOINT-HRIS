export async function revokeBrowserPush(subscription) {
    if (!subscription) {
        const registration = await globalThis.navigator?.serviceWorker?.getRegistration();
        subscription = await registration?.pushManager?.getSubscription();
    }
    if (subscription) await subscription.unsubscribe();
}
