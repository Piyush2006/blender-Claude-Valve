import { subscribe } from '../simulation/simulationState.js';
import { COMPONENTS } from '../components/componentRegistry.js';

/**
 * Makes a side panel collapsible: its first `.panel-title` becomes a header with
 * a chevron; collapsed panels shrink to a pill so the 3D view stays clear.
 * State is remembered per panel in localStorage.
 */
export function makeCollapsible(panel, { key, showAlarmBadge = false }) {
  const title = panel.querySelector('.panel-title');
  if (!title) return;

  const head = document.createElement('div');
  head.className = 'panel-head';
  title.replaceWith(head);
  head.appendChild(title);

  const badge = document.createElement('span');
  badge.className = 'panel-badge';
  badge.hidden = true;
  head.appendChild(badge);

  const btn = document.createElement('button');
  btn.className = 'btn-icon collapse-btn';
  btn.type = 'button';
  head.appendChild(btn);

  const storageKey = `twin.panel.${key}`;
  let collapsed = false;
  try { collapsed = localStorage.getItem(storageKey) === '1'; } catch { /* storage unavailable */ }

  function apply() {
    panel.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? '▸' : '▾';
    btn.title = collapsed ? 'Expand' : 'Collapse';
    btn.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(storageKey, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
  btn.addEventListener('click', () => { collapsed = !collapsed; apply(); });
  head.addEventListener('click', (e) => { if (collapsed && e.target !== btn) { collapsed = false; apply(); } });
  apply();

  if (showAlarmBadge) {
    subscribe((s) => {
      let anomalies = 0, detecting = 0;
      for (const c of COMPONENTS) {
        const st = s[c.stateKey]?.status;
        if (st === 'ANOMALY') anomalies++;
        else if (st === 'DETECTING' || st === 'WARNING') detecting++;
      }
      const text = anomalies ? `${anomalies} ANOMALY` : detecting ? (s.anomaly.status === 'WARNING' ? 'WARNING' : 'DETECTING') : '';
      if (badge.textContent !== text) badge.textContent = text;
      badge.hidden = !text;
      badge.classList.toggle('is-anomaly', anomalies > 0);
      badge.classList.toggle('is-detecting', !anomalies && detecting > 0);
    });
  }
}
