/**
 * Top bar: Twin / Dashboard tabs plus a live clock.
 * Views are plain sections toggled with `hidden`; the Twin keeps running its
 * simulation while hidden, only its WebGL rendering is paused.
 */
export function createNavigation({ onViewChange }) {
  const tabs = [...document.querySelectorAll('#topbar .tab')];
  const views = [...document.querySelectorAll('#views > [data-view]')];
  let current = 'twin';

  function showView(name) {
    if (!views.some((v) => v.dataset.view === name)) return;
    current = name;
    for (const v of views) v.hidden = v.dataset.view !== name;
    for (const t of tabs) {
      const active = t.dataset.view === name;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    }
    try { localStorage.setItem('twin.view', name); } catch { /* ignore */ }
    onViewChange?.(name);
  }

  for (const t of tabs) t.addEventListener('click', () => showView(t.dataset.view));

  // Live clock (browser local time — never a hard-coded demo date).
  const dateEl = document.getElementById('clock-date');
  const timeEl = document.getElementById('clock-time');
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  function tickClock() {
    const now = new Date();
    dateEl.textContent = dateFmt.format(now);
    timeEl.textContent = `${timeFmt.format(now)} (Local Time)`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  let initial = 'twin';
  try { initial = localStorage.getItem('twin.view') || 'twin'; } catch { /* ignore */ }
  showView(initial);

  return { showView, get current() { return current; } };
}
