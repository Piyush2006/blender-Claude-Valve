import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Runtime layout corrections applied on top of the GLB (the file is untouched).
 *
 * Safety / relief valve:
 *  - In the export it sits on the first steam segment next to the supply. Its
 *    job is to protect the Yankee drum, so it is moved onto Steam_P5 — the last
 *    segment before the Yankee steam inlet. The three existing objects
 *    (P_SafetyValve, Steam_Branch_PSV, Safety_Discharge) are translated as a
 *    unit; no geometry is rebuilt.
 *  - The exported discharge elbow already turns upward but stops 0.65 m above
 *    the valve. A plain vent riser (cylinder + exhaust head) is added on top of
 *    it so the relief path visibly goes to atmosphere and never back into the
 *    process line.
 */
export const PSV_LAYOUT = {
  shift: new THREE.Vector3(6.6, 0, 0),   // branch centre x: 0.25 → 6.85 (on Steam_P5)
  ventTopY: 5.0,                          // m — top of the vent stack
  objects: ['P_SafetyValve', 'Steam_Branch_PSV', 'Safety_Discharge'],
};

/** GLB objects hidden at runtime (removed from the demo scene on request). */
export const HIDDEN_OBJECTS = ['Steam_Pressure_Sensor', 'Steam_Temperature_Sensor', 'Steam_Flow_Sensor'];

export function applyLayoutOverrides(map, scene) {
  for (const name of HIDDEN_OBJECTS) {
    const obj = map.byName.get(name);
    if (obj) obj.visible = false; else console.warn('[layout] missing', name);
  }
  relocateSafetyValve(map);
  const vent = buildVentRiser(map);
  if (vent) scene.add(vent);
  const spool = buildFlowSensorSpool(map);
  if (spool) map.root.add(spool);
  return { vent, spool };
}

/**
 * The hidden Steam_Flow_Sensor was an inline instrument: its body bridged the
 * flange of Steam_P4 (x = 6.194) and Steam_P5 (x = 6.406). Replace it with a
 * plain flanged spool piece of the same pipe size so the line stays connected.
 */
const SPOOL = { x0: 6.194, x1: 6.406, y: 1.1, pipeR: 0.063, flangeR: 0.115, flangeT: 0.03 };

function buildFlowSensorSpool(map) {
  const p4 = map.byName.get('Steam_P4');
  if (!p4) return null;
  let pipeMat = null, flangeMat = null;
  p4.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material?.name === 'YP_Pipe_Steam' && !pipeMat) pipeMat = o.material.clone();
    if (o.material?.name === 'YP_Flange' && !flangeMat) flangeMat = o.material.clone();
  });
  if (!pipeMat || !flangeMat) return null;
  pipeMat.name = 'YP_Pipe_Steam__spool';
  flangeMat.name = 'YP_Flange__spool';

  const g = new THREE.Group();
  g.name = 'Steam_Spool_P4_P5';
  g.userData.name = 'Steam_Spool_P4_P5';
  const along = (mesh, xCentre) => {
    mesh.rotation.z = Math.PI / 2;               // cylinder axis → X
    mesh.position.set(xCentre, SPOOL.y, 0);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  };
  const len = SPOOL.x1 - SPOOL.x0;
  along(new THREE.Mesh(new THREE.CylinderGeometry(SPOOL.pipeR, SPOOL.pipeR, len, 40, 1, true), pipeMat), SPOOL.x0 + len / 2);
  along(new THREE.Mesh(new THREE.CylinderGeometry(SPOOL.flangeR, SPOOL.flangeR, SPOOL.flangeT, 40), flangeMat), SPOOL.x0 + SPOOL.flangeT / 2);
  along(new THREE.Mesh(new THREE.CylinderGeometry(SPOOL.flangeR, SPOOL.flangeR, SPOOL.flangeT, 40), flangeMat), SPOOL.x1 - SPOOL.flangeT / 2);
  return g;
}

function relocateSafetyValve(map) {
  for (const name of PSV_LAYOUT.objects) {
    const obj = map.byName.get(name);
    if (!obj) { console.warn('[layout] missing', name); continue; }
    obj.position.add(PSV_LAYOUT.shift);
    obj.updateMatrixWorld(true);
  }
  const psv = map.components.safetyValve;
  if (psv?.root) {
    psv.rest.root.position.copy(psv.root.position);
  }
}

/** Extends the existing Safety_Discharge stub straight up to PSV_LAYOUT.ventTopY. */
function buildVentRiser(map) {
  const discharge = map.byName.get('Safety_Discharge');
  if (!discharge) return null;

  // Find the pipe primitive of the discharge and measure its open top ring.
  let pipeMesh = null;
  discharge.traverse((o) => { if (o.isMesh && o.material?.name === 'YP_Pipe_Steam') pipeMesh = o; });
  if (!pipeMesh) return null;

  const pos = pipeMesh.geometry.attributes.position;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  const ring = [];
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > maxY - 0.005) ring.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  const centre = ring.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(ring.length);
  const radius = ring.reduce((r, v) => Math.max(r, Math.hypot(v.x - centre.x, v.z - centre.z)), 0);
  // Discharge geometry is world-baked; the group itself carries the relocation offset.
  discharge.updateMatrixWorld(true);
  const topWorld = centre.clone().applyMatrix4(discharge.matrixWorld);

  // The discharge elbow and riser become a see-through "sight tube" (same treatment as the
  // main steam line) so the venting steam inside stays visible. Runtime clones only.
  const material = pipeMesh.material.clone();
  material.name = 'YP_Pipe_Steam__vent';
  material.transparent = true;
  material.opacity = 0.14;   // like the main line's sight-glass: the steam inside is what you see
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.color.multiplyScalar(0.7);
  material.envMapIntensity = 0.5;
  pipeMesh.material = material;
  pipeMesh.renderOrder = 1;
  pipeMesh.castShadow = false;
  const flangeMat = pipeMesh.material.clone();
  flangeMat.name = 'YP_Flange__vent';
  flangeMat.transparent = false; flangeMat.opacity = 1; flangeMat.depthWrite = true; flangeMat.side = THREE.FrontSide;

  const group = new THREE.Group();
  group.name = 'PSV_Vent_Riser';
  group.userData.name = 'PSV_Vent_Riser';
  group.userData.componentId = 'safetyValve';   // clicking the stack selects the PSV

  const height = PSV_LAYOUT.ventTopY - topWorld.y;
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32, 1, true), material);
  riser.position.set(topWorld.x, topWorld.y + height / 2, topWorld.z);
  riser.renderOrder = 1;
  group.add(riser);
  // Vent bore for the steam layer: from just above the elbow to the exhaust head.
  group.userData.ventBore = { x: topWorld.x, z: topWorld.z, y0: topWorld.y - 0.45, y1: PSV_LAYOUT.ventTopY - 0.05, radius: radius * 0.8 };

  // Coupling flange a little way up the riser, matching the model's flange proportions.
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(radius * 2.2, radius * 2.2, 0.04, 32), flangeMat);
  flange.position.set(topWorld.x, topWorld.y + 0.35, topWorld.z);
  group.add(flange);

  // Exhaust head: wider drip collar plus a rain cap with an open gap below it.
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.5, radius * 1.5, 0.26, 32, 1, true), flangeMat);
  collar.position.set(topWorld.x, PSV_LAYOUT.ventTopY - 0.13, topWorld.z);
  group.add(collar);

  const cap = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.4, 0.16, 32), flangeMat);
  cap.position.set(topWorld.x, PSV_LAYOUT.ventTopY + 0.18, topWorld.z);
  group.add(cap);

  for (let i = 0; i < 3; i++) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 8), flangeMat);
    const a = (i / 3) * Math.PI * 2;
    rod.position.set(topWorld.x + Math.cos(a) * radius * 1.3, PSV_LAYOUT.ventTopY + 0.05, topWorld.z + Math.sin(a) * radius * 1.3);
    group.add(rod);
  }

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Static annotation at the vent outlet.
  const tagEl = document.createElement('div');
  tagEl.className = 'tag tag-static';
  tagEl.innerHTML = '<span class="tag-name">PSV vent → atmosphere</span>';
  const tag = new CSS2DObject(tagEl);
  tag.position.set(topWorld.x, PSV_LAYOUT.ventTopY + 0.32, topWorld.z);
  tag.center.set(0.5, 1);
  group.add(tag);

  return group;
}
