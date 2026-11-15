// js/app.js
// App bootstrap. Wires together storage, the first-run setup gate, the tab
// router, and PWA registration. No business logic lives here — this module
// only sequences calls into the other modules.

import './installPrompt.js';
import { openDB } from './db.js';
import { runFirstRunSetupIfNeeded, runInstallPromptIfNeeded, renderSettingsTab } from './ui/settings.js';
import { initRouter } from './ui/router.js';
import { renderTodayTab } from './ui/today.js';
import { renderDietTab } from './ui/diet.js';
import { renderBodyTab } from './ui/body.js';
import { renderProgressTab } from './ui/progress.js';

async function main() {
  await openDB();

  // Blocks (via its returned promise) until the user completes the profile
  // form, but only when no settings record exists yet. Resolves immediately
  // on every subsequent load.
  await runFirstRunSetupIfNeeded(document.getElementById('app'));

  // Shows the "add to home screen" overlay exactly once (ever) — including
  // once for installs that predate this feature — then never again; see
  // js/ui/settings.js for the persisted flag and js/installPrompt.js for the
  // native-install-button plumbing it shares with the permanent Settings card.
  await runInstallPromptIfNeeded(document.getElementById('app'));

  initRouter({
    today: renderTodayTab,
    diet: renderDietTab,
    body: renderBodyTab,
    progress: renderProgressTab,
    settings: renderSettingsTab,
  });

  // Best-effort: ask the browser not to evict IndexedDB data under storage
  // pressure. Not supported everywhere, so guard defensively.
  if (navigator.storage?.persist) {
    navigator.storage.persist();
  }

  // Register the service worker last and only when supported, so offline
  // caching never blocks (or breaks) the interactive app from loading.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  }
}

main();
