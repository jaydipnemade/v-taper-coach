// js/ui/router.js
// Minimal hash-based tab router. No business logic — just shows/hides the
// `<section id="tab-{name}">` containers defined in index.html and delegates
// actual content rendering to the render function each tab registers.

const DEFAULT_TAB = 'today';

/**
 * Reads the current `location.hash`, strips the leading "#", and falls back
 * to the default tab when the hash is empty or doesn't match a known tab.
 * @param {string[]} validTabs
 * @returns {string}
 */
function currentTabName(validTabs) {
  const raw = (location.hash || '').replace(/^#/, '').trim();
  return validTabs.includes(raw) ? raw : DEFAULT_TAB;
}

/**
 * Wires up the hash-based tab router.
 *
 * - Defaults to `#today` when there is no hash (or an unrecognized one).
 * - Shows the matching `<section id="tab-{name}">`, hides the rest via the
 *   `hidden` attribute, and calls that tab's render function with its
 *   container element.
 * - Listens for `hashchange` (back/forward, programmatic hash changes) and
 *   for clicks on `#tabbar` buttons (`[data-tab]`) to switch tabs.
 *
 * Render functions are called every time their tab becomes active (not just
 * once), so a tab can refresh its content when revisited.
 *
 * @param {Record<string, (container: HTMLElement) => void>} tabs
 *   Map of tab name -> render function, e.g. `{ today: renderToday, ... }`.
 */
export function initRouter(tabs) {
  const validTabs = Object.keys(tabs);
  const tabbar = document.getElementById('tabbar');

  function showTab(name) {
    for (const tabName of validTabs) {
      const section = document.getElementById(`tab-${tabName}`);
      if (!section) continue;
      section.hidden = tabName !== name;
    }

    if (tabbar) {
      const buttons = tabbar.querySelectorAll('[data-tab]');
      buttons.forEach((btn) => {
        const isActive = btn.getAttribute('data-tab') === name;
        btn.classList.toggle('is-active', isActive);
        if (isActive) {
          btn.setAttribute('aria-current', 'true');
        } else {
          btn.removeAttribute('aria-current');
        }
      });
    }

    const renderFn = tabs[name];
    const container = document.getElementById(`tab-${name}`);
    if (typeof renderFn === 'function' && container) {
      renderFn(container);
    }
  }

  function route() {
    showTab(currentTabName(validTabs));
  }

  window.addEventListener('hashchange', route);

  if (tabbar) {
    tabbar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      const name = button.getAttribute('data-tab');
      if (!validTabs.includes(name)) return;

      if (currentTabName(validTabs) === name) {
        // Hash won't change (no hashchange event fires), so route directly.
        showTab(name);
      } else {
        location.hash = `#${name}`;
      }
    });
  }

  if (!location.hash) {
    location.hash = `#${DEFAULT_TAB}`;
  }

  route();
}
