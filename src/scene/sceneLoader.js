import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PROCESS_SCENE_NAME, STEAM_PIPE_GLASS_MATERIALS, PIPING, VALVE_SHELLS } from '../components/componentRegistry.js';

export const MODEL_URL = '/model/Yankee_Steam_DigitalTwin.glb';

/**
 * Loads the GLB and returns the "YankeeProcess" scene (the full process). The
 * file also contains standalone exterior / cutaway scenes for each valve; those
 * are left untouched and simply not added to the Three.js scene.
 */
export function loadModel(onProgress) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      MODEL_URL,
      (gltf) => {
        const process = gltf.scenes.find((s) => s.name === PROCESS_SCENE_NAME) || gltf.scene;
        prepareMaterials(process);
        resolve({ gltf, root: process });
      },
      (evt) => {
        if (onProgress) onProgress(evt.total ? evt.loaded / evt.total : 0);
      },
      reject,
    );
  });
}

/**
 * Runtime-only material adjustments (the GLB itself is not modified):
 *  - shadows on/off per object type
 *  - glass sight-tube of the steam line: no depth write, softer reflections
 *  - valve bodies / actuator housings get a see-through clone ("valve internals" X-ray)
 *  - steam-flow volumes get their own material later (steamFlow.js)
 */
function prepareMaterials(root) {
  const steamLineNames = new Set([...PIPING.steamLine, ...PIPING.steamSupply]);
  const shellNames = new Set(VALVE_SHELLS);
  const overrides = { pipeGlass: [], valveShells: [] };

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;

    const ownerName = findOwnerName(obj);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

    if (ownerName === 'Process_Ground') {
      obj.castShadow = false;
      return;
    }

    if (shellNames.has(ownerName)) {
      mats.forEach((m, i) => {
        const clone = m.clone();
        clone.name = `${m.name}__xray`;
        clone.transparent = true;
        clone.opacity = 0.4;
        clone.depthWrite = false;
        clone.side = THREE.DoubleSide;
        clone.envMapIntensity = 0.6;
        overrides.valveShells.push({ mesh: obj, index: i, material: clone, original: m });
      });
      obj.renderOrder = 1;
      return;
    }

    if (steamLineNames.has(ownerName)) {
      mats.forEach((m) => {
        if (STEAM_PIPE_GLASS_MATERIALS.includes(m.name)) {
          // Shared glass material: keep the author's opacity, but stop the bright studio
          // environment from turning the 7 %-opacity tube into a frosted-looking rod.
          m.depthWrite = false;
          m.envMapIntensity = 0.35;
          obj.castShadow = false;
          obj.renderOrder = 1;
          overrides.pipeGlass.push({ mesh: obj, material: m });
        }
      });
    }
  });

  root.userData.materialOverrides = overrides;
}

function replaceMaterial(mesh, index, material) {
  if (Array.isArray(mesh.material)) mesh.material[index] = material;
  else mesh.material = material;
}

/** Walk up to the glTF node that owns this mesh (multi-primitive nodes become Groups). */
function findOwnerName(obj) {
  let o = obj;
  while (o) {
    if (o.userData?.name) return o.userData.name;
    o = o.parent;
  }
  return obj.name;
}

/** Toggle the see-through valve bodies / actuator housings (mechanisms visible). */
export function applyValveXray(root, enabled) {
  const ov = root.userData.materialOverrides;
  if (!ov) return;
  for (const { mesh, material, original } of ov.valveShells) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const idx = mats.findIndex((m) => m === material || m === original);
    if (idx >= 0) replaceMaterial(mesh, idx, enabled ? material : original);
  }
}

/** Frees GPU resources of a loaded subtree. */
export function disposeModel(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    }
  });
}
