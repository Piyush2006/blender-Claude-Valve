import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { simulationState as S, setSelection, subscribe } from '../simulation/simulationState.js';
import { worldBox } from '../scene/modelMap.js';
import { anomalyShortName } from './detection.js';

/**
 * Click-to-select with highlight, plus a small floating status tag above every
 * major component (green = NORMAL, red = anomaly).
 */
export function createInteraction({ renderer, camera, scene, map, cameraRig, extraPickables = [] }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables = [];
  const highlightState = new Map(); // material → { emissive, intensity }
  const tintState = new Map();      // componentId → 'selected' | 'alarm'
  let selectedId = null;
  let hoverId = null;
  const TINT = {
    selected: { color: 0x1f6fe0, intensity: 0.55 },
    alarm: { color: 0xdc2626, intensity: 0.9 },
    warn: { color: 0xd97706, intensity: 0.7 },
  };

  for (const comp of Object.values(map.components)) {
    if (!comp.root) continue;
    comp.root.traverse((o) => { if (o.isMesh && !o.userData.isSteam) pickables.push(o); });
    comp.box = worldBox(comp.root);
    comp.label = makeLabel(comp);
    scene.add(comp.label);
  }
  // Runtime-added geometry tagged with a componentId (e.g. the PSV vent riser).
  for (const extra of extraPickables) {
    extra.traverse((o) => { if (o.isMesh) { o.userData.componentId ??= extra.userData.componentId; pickables.push(o); } });
  }

  // --- Pointer handling: distinguish clicks from orbit drags ---------------------
  let downPos = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 5) return;
    const id = pick(e);
    setSelection(id);
  });
  el.addEventListener('pointermove', (e) => {
    if (downPos) return;
    const id = pick(e);
    if (id !== hoverId) {
      hoverId = id;
      el.style.cursor = id ? 'pointer' : '';
    }
  });

  function pick(e) {
    const rect = el.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.componentId || null : null;
  }

  // --- Highlight -----------------------------------------------------------------
  // Each component carries at most one tint: an active ANOMALY tints it red and wins
  // over the blue selection tint. Original emissive values are restored on clear.
  function syncTints(state) {
    for (const comp of Object.values(map.components)) {
      const id = comp.def.id;
      const st = state[comp.def.stateKey]?.status;
      const wanted = st === 'ANOMALY' ? 'alarm' : st === 'WARNING' ? 'warn' : id === selectedId ? 'selected' : null;
      const current = tintState.get(id) || null;
      if (wanted === current) {
        if (wanted === 'alarm') pulse(comp, state.time);
        continue;
      }
      if (current) clearTint(comp);
      if (wanted) applyTint(comp, TINT[wanted]);
      if (wanted) tintState.set(id, wanted); else tintState.delete(id);
    }
  }

  function applyTint(comp, { color, intensity }) {
    comp.root?.traverse((o) => {
      if (!o.isMesh || o.userData.isSteam) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.emissive || highlightState.has(m)) continue;
        highlightState.set(m, { emissive: m.emissive.clone(), intensity: m.emissiveIntensity });
        m.emissive.setHex(color);
        m.emissiveIntensity = intensity;
      }
    });
  }

  /** Slow breathing of the red tint so an anomaly is unmistakable from the main view. */
  function pulse(comp, t) {
    const k = TINT.alarm.intensity * (0.7 + 0.3 * Math.sin(t * 4));
    comp.root?.traverse((o) => {
      if (!o.isMesh || o.userData.isSteam) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (highlightState.has(m)) m.emissiveIntensity = k;
    });
  }

  function clearTint(comp) {
    comp.root?.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const st = highlightState.get(m);
        if (!st) continue;
        m.emissive.copy(st.emissive);
        m.emissiveIntensity = st.intensity;
        highlightState.delete(m);
      }
    });
  }

  // --- Labels ------------------------------------------------------------------
  function makeLabel(comp) {
    const div = document.createElement('div');
    div.className = 'tag';
    div.innerHTML = `<span class="dot"></span><span class="tag-name">${comp.def.label}</span><span class="tag-value mono"></span>`;
    div.addEventListener('pointerdown', (e) => e.stopPropagation());
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelection(comp.def.id);
    });
    const label = new CSS2DObject(div);
    const c = comp.box.getCenter(new THREE.Vector3());
    const lift = comp.def.id === 'yankee' ? 0.55 : 0.16;   // keep the Yankee tag clear of the PSV tag
    label.position.set(c.x, comp.box.max.y + lift, c.z);
    label.center.set(0.5, 1);
    return label;
  }

  function focusSelected() {
    if (!selectedId) return;
    cameraRig.focusBox(map.components[selectedId].box);
  }

  subscribe((state) => {
    if (state.selection.componentId !== selectedId) {
      selectedId = state.selection.componentId;
      for (const comp of Object.values(map.components)) {
        comp.label?.element.classList.toggle('is-selected', comp.def.id === selectedId);
      }
    }
    syncTints(state);
    for (const comp of Object.values(map.components)) {
      const st = state[comp.def.stateKey]?.status || 'NORMAL';
      const el = comp.label?.element;
      if (!el) continue;
      el.classList.toggle('is-alarm', st === 'ANOMALY');
      el.classList.toggle('is-detecting', st === 'DETECTING' || st === 'WARNING');
      const v = liveValue(comp.def.id, state);
      const span = el.querySelector('.tag-value');
      if (span.textContent !== v) span.textContent = v;
    }
  });

  function liveValue(id, s) {
    const st = s[map.components[id]?.def.stateKey]?.status;
    if ((st === 'ANOMALY' || st === 'WARNING') && s.anomaly.component === id) return anomalyShortName(s.anomaly.type);
    switch (id) {
      case 'ballValve': return s.ballValve.position >= 99.5 ? 'OPEN' : s.ballValve.position <= 0.5 ? 'CLOSED' : `${Math.round(s.ballValve.position)}%`;
      case 'esdValve': return s.esdValve.position >= 99.5 ? 'OPEN' : s.esdValve.position <= 0.5 ? 'CLOSED' : `${Math.round(s.esdValve.position)}%`;
      case 'vPortValve': return `${Math.round(s.vPortValve.actualPosition)}%`;
      case 'yankee': return `${s.yankee.speedRpm.toFixed(1)} rpm`;
      case 'checkValve': return s.condensate.direction < 0 ? 'REVERSE' : s.checkValve.lift > 0.05 ? 'FLOW' : 'SEATED';
      default: return '';
    }
  }

  function dispose() {
    for (const comp of Object.values(map.components)) {
      if (comp.label) { scene.remove(comp.label); comp.label.element.remove(); }
    }
  }

  return { focusSelected, dispose, get selectedId() { return selectedId; } };
}
