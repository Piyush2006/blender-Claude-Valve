import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { subscribe } from '../simulation/simulationState.js';

/**
 * Small physical-state annotations anchored in the 3D scene:
 *  - condensate flow direction at the check valve (forward / reverse / none)
 *  - "VENTING" at the safety valve while its disc is lifted
 * Pure presentation: reads simulationState only.
 */
export function createFlowTags({ scene, map }) {
  const tags = [];

  const check = map.components.checkValve;
  if (check?.box) {
    const c = check.box.getCenter(new THREE.Vector3());
    const el = document.createElement('div');
    el.className = 'tag tag-static tag-flow';
    el.innerHTML = '<span class="tag-name"></span>';
    const obj = new CSS2DObject(el);
    obj.position.set(c.x, check.box.min.y - 0.12, c.z);
    obj.center.set(0.5, 0);
    scene.add(obj);
    tags.push({ obj, el, update(s) {
      const dir = s.condensate.direction, flow = s.condensate.flow;
      const text = dir < 0 ? '◀ REVERSE FLOW' : flow > 0 ? 'CONDENSATE ▶' : 'NO FLOW';
      const span = el.firstElementChild;
      if (span.textContent !== text) span.textContent = text;
      el.classList.toggle('is-alarm', dir < 0);
    } });
  }

  const psv = map.components.safetyValve;
  if (psv?.root) {
    const el = document.createElement('div');
    el.className = 'tag tag-static tag-flow is-alarm';
    el.innerHTML = '<span class="tag-name">▲ VENTING</span>';
    const obj = new CSS2DObject(el);
    const c = psv.box.getCenter(new THREE.Vector3());
    obj.position.set(c.x + 0.35, psv.box.max.y + 0.05, c.z);
    obj.center.set(0.5, 1);
    obj.visible = false;
    scene.add(obj);
    tags.push({ obj, el, update(s) { obj.visible = s.safetyValve.lift > 0.5; } });
  }

  subscribe((s) => { for (const t of tags) t.update(s); });

  return { dispose() { for (const t of tags) { scene.remove(t.obj); t.el.remove(); } } };
}
