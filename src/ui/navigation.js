/**
 * Top bar navigation: Twin / Dashboard tabs. The maintenance ticket list
 * ("reports") has no tab — it is reached from the Dashboard's detail menu.
 * The Twin keeps running its simulation while hidden, only its WebGL
 * rendering is paused.
 */
const NAV_VIEW = { dashboard: 'dashboard', twin: 'twin', controls: 'twin', analytics: 'dashboard', reports: 'maintenance' };

export function createNavigation({ onViewChange, onNav }) {
  const tabs = [...document.querySelectorAll('#topbar .tab[data-nav]')];
  const views = [...document.querySelectorAll('#views > [data-view]')];
  let current = 'twin', currentNav = 'twin';

  function showView(name, nav = null) {
    if (!views.some((v) => v.dataset.view === name)) return;
    current = name;
    currentNav = nav || (NAV_VIEW[currentNav] === name ? currentNav : Object.keys(NAV_VIEW).find((k) => NAV_VIEW[k] === name));
    for (const v of views) v.hidden = v.dataset.view !== name;
    for (const t of tabs) {
      const active = t.dataset.nav === currentNav;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    }
    try { localStorage.setItem('twin.nav', currentNav); } catch { /* ignore */ }
    onViewChange?.(name);
  }
  function go(nav) {
    showView(NAV_VIEW[nav] || 'dashboard', nav);
    onNav?.(nav);
  }

  for (const t of tabs) t.addEventListener('click', () => go(t.dataset.nav));

  let initial = 'dashboard';
  try { initial = localStorage.getItem('twin.nav') || 'dashboard'; } catch { /* ignore */ }
  if (!NAV_VIEW[initial] || initial === 'reports') initial = 'dashboard';
  go(initial);

  return { showView, go, get current() { return current; } };
}
