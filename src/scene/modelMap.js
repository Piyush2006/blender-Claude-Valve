import * as THREE from 'three';
import { COMPONENTS, PIPING } from '../components/componentRegistry.js';

/**
 * Builds the mapping layer between the loaded GLB hierarchy and the simulation.
 * Nothing in the GLB is renamed; we only index existing objects and remember
 * their rest transforms so animations can be expressed relative to them.
 */
export function buildModelMap(root) {
  const byName = new Map();
  root.traverse((obj) => {
    // GLTFLoader keeps the original glTF node name in userData.name even when it
    // has to de-duplicate obj.name, so prefer that.
    const original = obj.userData?.name;
    if (original && !byName.has(original)) byName.set(original, obj);
    if (obj.name && !byName.has(obj.name)) byName.set(obj.name, obj);
  });

  const missing = [];
  const get = (name) => {
    const o = byName.get(name);
    if (!o) missing.push(name);
    return o || null;
  };

  const components = {};
  for (const def of COMPONENTS) {
    const rootObj = get(def.root);
    const parts = {};
    const rest = {};
    for (const [key, name] of Object.entries(def.parts)) {
      const o = get(name);
      parts[key] = o;
      if (o) rest[key] = snapshot(o);
    }
    if (rootObj) {
      rest.root = snapshot(rootObj);
      // Tag every mesh under this component so picking can resolve it.
      rootObj.traverse((o) => { o.userData.componentId = def.id; });
    }
    components[def.id] = { def, root: rootObj, parts, rest };
  }

  const piping = {};
  for (const [group, names] of Object.entries(PIPING)) {
    piping[group] = names.map((n) => get(n)).filter(Boolean);
  }

  return { root, byName, components, piping, missing };
}

function snapshot(obj) {
  return {
    position: obj.position.clone(),
    quaternion: obj.quaternion.clone(),
    scale: obj.scale.clone(),
  };
}

/** Console report of what was found — satisfies "inspect and report actual object names". */
export function reportModelMap(map) {
  const rows = [];
  for (const { def, root, parts } of Object.values(map.components)) {
    rows.push({ component: def.label, role: 'root', glbName: def.root, found: !!root, type: root?.type ?? '-' });
    for (const [key, name] of Object.entries(def.parts)) {
      rows.push({ component: def.label, role: key, glbName: name, found: !!parts[key], type: parts[key]?.type ?? '-' });
    }
  }
  console.groupCollapsed('[DigitalTwin] GLB component mapping');
  console.table(rows);
  for (const [group, objs] of Object.entries(map.piping)) {
    console.log(`${group}: ${objs.map((o) => o.userData.name || o.name).join(', ')}`);
  }
  if (map.missing.length) console.warn('Missing GLB objects:', map.missing);
  console.groupEnd();
}

/** World-space bounding box of an object (used for labels / camera framing). */
export function worldBox(obj) {
  return new THREE.Box3().setFromObject(obj);
}
