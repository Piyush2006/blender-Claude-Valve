/**
 * Lightweight process schematic for the Dashboard (inline SVG). Mirrors the
 * Twin's process order without touching the 3D model:
 *
 *   Steam supply → Ball → ESD → V-Port → (PSV branch) → Rotary Joint → Yankee
 *   → Separator → Steam Trap → Check Valve → Condensate return, plus the
 *   separator blow-through → steam return.
 */
const NS = 'http://www.w3.org/2000/svg';
const W = 1000, H = 250;
const STEAM_Y = 150, COND_Y = 200;

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

// Equipment along the line: id maps to the Twin's component id (for status + click).
const NODES = [
  { id: 'ballValve', label: 'Ball Valve', x: 150, kind: 'valve' },
  { id: 'esdValve', label: 'ESD Valve', x: 245, kind: 'valve', actuator: true },
  { id: 'vPortValve', label: 'V-Port Control Valve', x: 350, kind: 'valve', actuator: true, big: true },
  { id: 'safetyValve', label: 'Safety Valve', x: 455, kind: 'psv' },
  { id: 'rotaryJoint', label: 'Rotary Joint', x: 512, kind: 'joint' },
  { id: 'yankee', label: 'Yankee Dryer', x: 640, kind: 'yankee' },
  { id: 'separator', label: 'Separator Tank', x: 760, kind: 'tank' },
  { id: 'steamTrap', label: 'Steam Trap', x: 850, kind: 'trap' },
  { id: 'checkValve', label: 'Check Valve', x: 925, kind: 'check' },
];

export function createSchematic(container, { onSelect }) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'schematic', role: 'img', 'aria-label': 'Yankee steam line schematic' });

  // --- pipes -------------------------------------------------------------------
  const pipes = el('g', { class: 'pipes' });
  pipes.appendChild(el('path', { class: 'pipe steam', d: `M40,${STEAM_Y} H590` }));                          // supply → Yankee
  pipes.appendChild(el('path', { class: 'pipe steam', d: `M455,${STEAM_Y} V95` }));                            // PSV branch up
  pipes.appendChild(el('path', { class: 'pipe steam thin', d: `M690,${STEAM_Y + 20} V${COND_Y} H760` }));       // Yankee condensate → separator
  pipes.appendChild(el('path', { class: 'pipe cond', d: `M760,${COND_Y} H960` }));                             // separator → trap → check → return
  pipes.appendChild(el('path', { class: 'pipe steam thin', d: `M760,${COND_Y - 60} V60 H900` }));               // blow-through → steam return
  svg.appendChild(pipes);

  // Flow arrows / labels
  svg.appendChild(arrow(20, STEAM_Y, 'steam'));
  svg.appendChild(el('text', { class: 'sch-label bold', x: 20, y: STEAM_Y - 30 }, 'Steam Supply'));
  svg.appendChild(el('text', { class: 'sch-label', x: 20, y: STEAM_Y - 16, id: 'sch-supply' }, ''));
  svg.appendChild(arrow(910, 60, 'steam'));
  svg.appendChild(el('text', { class: 'sch-label', x: 905, y: 48, 'text-anchor': 'end' }, 'Blow-through → Steam Return'));
  const condArrow = arrow(968, COND_Y, 'cond');
  condArrow.id = 'sch-cond-arrow';
  svg.appendChild(condArrow);
  const condLabel = el('text', { class: 'sch-label', x: 975, y: COND_Y - 12, 'text-anchor': 'end', id: 'sch-cond-label' }, 'Condensate Return');
  svg.appendChild(condLabel);

  // --- equipment ------------------------------------------------------------------
  const nodeEls = new Map();
  for (const n of NODES) {
    const g = el('g', { class: `node kind-${n.kind}`, 'data-id': n.id, tabindex: 0, role: 'button' });
    const y = n.kind === 'trap' || n.kind === 'check' || n.kind === 'tank' ? COND_Y : STEAM_Y;
    drawSymbol(g, n, y);
    const labelY = n.kind === 'psv' ? 30
      : y === COND_Y ? COND_Y + 30
      : n.actuator ? (n.big ? STEAM_Y - 80 : STEAM_Y - 72)
      : n.kind === 'yankee' ? STEAM_Y - 74
      : n.kind === 'joint' ? STEAM_Y - 34
      : STEAM_Y - 48;
    g.appendChild(el('text', { class: 'sch-name', x: n.x, y: labelY, 'text-anchor': 'middle' }, n.label));
    const dot = el('circle', { class: 'sch-dot', cx: n.x - 24, cy: labelY + 14, r: 4.5 });
    const st = el('text', { class: 'sch-status', x: n.x - 16, y: labelY + 18 }, '');
    // selection frame (shown for the component selected on the dashboard)
    const top = Math.min(labelY - 14, n.kind === 'psv' ? 30 : y - 50), bottom = n.kind === 'yankee' ? y + 50 : n.kind === 'tank' ? y + 40 : y + 22;
    const half = n.kind === 'yankee' ? 62 : n.big ? 68 : 46;
    const sel = el('rect', { class: 'sch-select', x: n.x - half, y: top, width: half * 2, height: bottom - top, rx: 8 });
    g.insertBefore(sel, g.firstChild);
    g.append(dot, st);
    g.addEventListener('click', () => onSelect?.(n.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(n.id); } });
    svg.appendChild(g);
    nodeEls.set(n.id, { g, dot, st });
  }
  // Live process values (same state as the Twin), kept small so the diagram stays readable.
  svg.appendChild(el('text', { class: 'sch-label bold', x: 392, y: STEAM_Y + 36, id: 'sch-flow-l' }, 'Steam Flow'));
  svg.appendChild(el('text', { class: 'sch-label mono', x: 392, y: STEAM_Y + 50, id: 'sch-flow' }, ''));
  svg.appendChild(el('text', { class: 'sch-label bold', x: 588, y: STEAM_Y + 78, id: 'sch-moist-l' }, 'Moisture'));
  svg.appendChild(el('text', { class: 'sch-label mono', x: 588, y: STEAM_Y + 92, id: 'sch-moist' }, ''));
  svg.appendChild(el('text', { class: 'sch-label mono', x: 975, y: COND_Y + 17, 'text-anchor': 'end', id: 'sch-cond-temp' }, ''));
  container.appendChild(svg);

  return {
    /** statuses: { id → { level: 'normal'|'attention'|'critical', text } } ; supply: string */
    update(statuses, supplyText, reverseCondensate = false, { selectedId = null, live = null } = {}) {
      const ar = svg.querySelector('#sch-cond-arrow');
      ar.setAttribute('transform', reverseCondensate ? `translate(${968 * 2 - 18},0) scale(-1,1)` : '');
      ar.classList.toggle('is-reverse', reverseCondensate);
      svg.querySelector('#sch-cond-label').textContent = reverseCondensate ? 'REVERSE FLOW ◀' : 'Condensate Return';
      for (const [id, { g, dot, st }] of nodeEls) {
        const s = statuses[id];
        if (!s) continue;
        g.dataset.level = s.level;
        dot.setAttribute('class', `sch-dot is-${s.level}`);
        st.textContent = s.text;
        g.classList.toggle('is-selected', id === selectedId);
      }
      svg.querySelector('#sch-supply').textContent = supplyText;
      if (live) {
        const f = svg.querySelector('#sch-flow'); f.textContent = live.flow; f.setAttribute('class', `sch-label mono ${live.flowTone ? `tone-${live.flowTone}` : ''}`);
        const m = svg.querySelector('#sch-moist'); m.textContent = `${live.moisture} · ${live.moistureTarget}`; m.setAttribute('class', `sch-label mono ${live.moistureTone ? `tone-${live.moistureTone}` : ''}`);
        svg.querySelector('#sch-cond-temp').textContent = live.condensateTemp;
      }
    },
  };
}

function arrow(x, y, cls) {
  return el('path', { class: `flow-arrow ${cls}`, d: `M${x - 18},${y - 7} L${x},${y} L${x - 18},${y + 7} Z` });
}

function drawSymbol(g, n, y) {
  const x = n.x;
  switch (n.kind) {
    case 'valve': {
      const s = n.big ? 16 : 13;
      g.appendChild(el('path', { class: 'sym body', d: `M${x - s},${y - s} L${x},${y} L${x - s},${y + s} Z M${x + s},${y - s} L${x},${y} L${x + s},${y + s} Z` }));
      g.appendChild(el('line', { class: 'sym stem', x1: x, y1: y, x2: x, y2: y - s - 8 }));
      if (n.actuator) g.appendChild(el('rect', { class: 'sym actuator', x: x - 12, y: y - s - 30, width: 24, height: 22, rx: 4 }));
      else g.appendChild(el('line', { class: 'sym handle', x1: x - 12, y1: y - s - 8, x2: x + 12, y2: y - s - 8 }));
      break;
    }
    case 'psv': {
      const py = 95;
      g.appendChild(el('path', { class: 'sym body', d: `M${x - 11},${py - 11} L${x},${py} L${x - 11},${py + 11} Z M${x + 11},${py - 11} L${x},${py} L${x + 11},${py + 11} Z` }));
      g.appendChild(el('rect', { class: 'sym spring', x: x - 6, y: py - 40, width: 12, height: 28, rx: 2 }));
      g.appendChild(el('line', { class: 'sym stem', x1: x, y1: py - 12, x2: x, y2: py }));
      g.appendChild(el('path', { class: 'pipe steam thin', d: `M${x + 11},${py} H${x + 30} V45` }));
      g.appendChild(el('text', { class: 'sch-label', x: x + 34, y: 40 }, 'Vent'));
      break;
    }
    case 'joint':
      g.appendChild(el('rect', { class: 'sym body', x: x - 16, y: y - 12, width: 32, height: 24, rx: 3 }));
      g.appendChild(el('circle', { class: 'sym rotor', cx: x + 22, cy: y, r: 7 }));
      break;
    case 'yankee':
      g.appendChild(el('rect', { class: 'sym drum', x: x - 45, y: y - 45, width: 100, height: 90, rx: 10 }));
      g.appendChild(el('circle', { class: 'sym head', cx: x - 45, cy: y, r: 45 }));
      g.appendChild(el('path', { class: 'sym paper', d: `M${x - 60},${y + 60} Q${x + 10},${y + 70} ${x + 90},${y + 40}` }));
      g.appendChild(el('rect', { class: 'sym pedestal', x: x - 60, y: y + 30, width: 16, height: 30 }));
      g.appendChild(el('rect', { class: 'sym pedestal', x: x + 45, y: y + 30, width: 16, height: 30 }));
      break;
    case 'tank':
      g.appendChild(el('rect', { class: 'sym vessel', x: x - 16, y: y - 62, width: 32, height: 56, rx: 12 }));
      g.appendChild(el('line', { class: 'sym leg', x1: x - 10, y1: y - 6, x2: x - 10, y2: y + 0 }));
      g.appendChild(el('line', { class: 'sym leg', x1: x + 10, y1: y - 6, x2: x + 10, y2: y + 0 }));
      break;
    case 'trap':
      g.appendChild(el('circle', { class: 'sym body', cx: x, cy: y, r: 14 }));
      g.appendChild(el('path', { class: 'sym cap', d: `M${x - 10},${y - 10} A10,10 0 0 1 ${x + 10},${y - 10}` }));
      break;
    case 'check':
      g.appendChild(el('path', { class: 'sym body', d: `M${x - 12},${y - 11} L${x + 12},${y} L${x - 12},${y + 11} Z` }));
      g.appendChild(el('line', { class: 'sym disc', x1: x + 12, y1: y - 12, x2: x + 12, y2: y + 12 }));
      break;
    default:
      break;
  }
}
