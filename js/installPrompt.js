// js/installPrompt.js
// Captures the browser's `beforeinstallprompt` event (fired by Chrome/Edge on
// Android and desktop, never by Safari/Firefox/iOS) so a later, deliberate UI
// action — not an unsolicited browser banner — can trigger the native
// one-tap install flow. A separate module from app.js/settings.js so neither
// has to import the other just to pass this event around.

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  // Stop the browser's own mini-infobar; the app's own UI decides when to
  // offer this.
  event.preventDefault();
  deferredPrompt = event;
});

// The event fires again for any future install opportunity (e.g. after the
// user dismisses it once); nothing needed here beyond letting the listener
// above overwrite the stale reference.
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
});

/** @returns {boolean} Whether a native install prompt is currently available. */
export function hasDeferredInstallPrompt() {
  return deferredPrompt !== null;
}

/**
 * Fires the captured native install prompt and waits for the user's choice.
 * No-op (resolves 'unavailable') if the browser never offered one.
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const promptEvent = deferredPrompt;
  // A captured BeforeInstallPromptEvent can only be used once.
  deferredPrompt = null;
  promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice;
  return outcome;
}

/** @returns {boolean} Whether the app is currently running installed (standalone). */
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
